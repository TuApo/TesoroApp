import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ConfigParlantePublico } from '../../dashboard/submodule/seguridad/models/seguridad.models';
import { SeguridadPublicoService } from '../../dashboard/submodule/seguridad/services/seguridad-publico.service';
import { urlApi } from '../../dashboard/submodule/seguridad/services/seguridad.service';
import { SesionWebrtc, mensajeMicrofono, pedirMicrofono, publicarWhip, reproducirWhep } from '../../dashboard/submodule/seguridad/services/webrtc.util';
import { hora, isoLocal } from '../../dashboard/submodule/seguridad/utils/formato';
import { ConexionSse, conectarSse } from '../../dashboard/submodule/turnos/service/sse.util';
import { CapturaCanal, ClienteStt, EstadoCanal, UMBRAL_DESPERTAR } from '../../dashboard/submodule/turnos/service/transcripcion-en-vivo';
import type { TokenTranscripcion } from '../../dashboard/submodule/turnos/service/turnos.service';

type EstadoSse = 'conectando' | 'conectado' | 'reconectando' | 'cerrado';
interface Reproducir { reproduccion_id?: string; audio_url?: string; volumen?: number | null; repetir?: number | null; nombre?: string | null; }
interface Ptt { activo?: boolean; whep_url?: string | null; token?: string | null; }

const CLAVE_TOKEN = (codigo: string) => `sg-parlante-token:${codigo}`;

/**
 * El parlante de una sede en modo quiosco: cualquier navegador (PC, TV, tableta) con el enlace
 * abierto a pantalla completa.
 *
 * <p>Escucha el canal público (`/parlante/{codigo}/stream`): reproduce los audios y locuciones
 * que manda el centro, la voz del operador por PTT (WHEP), cambia el volumen y se recarga si
 * cambia su configuración. Si tiene micrófono, lo publica por WHIP para que el centro escuche
 * y, si está habilitado, lo transcribe en tiempo real (ElevenLabs con token de un solo uso)
 * para que las palabras clave disparen alarma. Manda un latido cada 30 s.
 *
 * <p>Los navegadores no dejan sonar nada sin un toque previo: la pantalla arranca con un botón
 * grande "Activar audio". El token del enlace se guarda en este equipo y se quita de la barra
 * de direcciones.
 */
@Component({
  selector: 'app-parlante-quiosco',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './parlante.html',
  styleUrl: './parlante.css',
})
export class ParlanteQuiosco implements OnInit {
  readonly codigo = input.required<string>();

  private readonly api = inject(SeguridadPublicoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly salidaPtt = viewChild<ElementRef<HTMLAudioElement>>('ptt');

  readonly config = signal<ConfigParlantePublico | null>(null);
  readonly error = signal<string | null>(null);
  readonly activado = signal(false);
  readonly canal = signal<EstadoSse>('cerrado');
  readonly reloj = signal(new Date());
  readonly reproduciendo = signal<string | null>(null);
  readonly pttActivo = signal(false);
  readonly microfono = signal<'apagado' | 'conectando' | 'publicando' | 'error'>('apagado');
  readonly errorMic = signal<string | null>(null);
  readonly transcripcion = signal<EstadoCanal>('apagado');
  readonly parcial = signal('');
  readonly ultimaFrase = signal<string | null>(null);
  readonly nivel = signal(0);
  readonly volumen = signal(80);

  readonly hora = computed(() => hora(this.reloj()));
  readonly fecha = computed(() => new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(this.reloj()));
  readonly estadoTexto = computed(() => {
    if (this.pttActivo()) return 'El centro de monitoreo está hablando';
    if (this.reproduciendo()) return 'Reproduciendo mensaje';
    if (this.canal() !== 'conectado') return 'Conectando con el centro…';
    return 'En línea · esperando mensajes';
  });

  private token: string | null = null;
  private sse: ConexionSse | null = null;
  private reproductor: HTMLAudioElement | null = null;
  private restantes = 0;
  private pendiente: Reproducir | null = null;
  private sesionPtt: SesionWebrtc | null = null;
  private sesionMic: SesionWebrtc | null = null;
  private flujoMic: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private captura: CapturaCanal | null = null;
  private stt: ClienteStt | null = null;
  private inicioFrase: Date | null = null;
  private reintentoMic: ReturnType<typeof setTimeout> | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private genPtt = 0;

  ngOnInit(): void {
    const codigo = this.codigo();
    const q = this.route.snapshot.queryParamMap.get('token');
    try {
      if (q) localStorage.setItem(CLAVE_TOKEN(codigo), q);
      this.token = q ?? localStorage.getItem(CLAVE_TOKEN(codigo));
    } catch { this.token = q; }
    // El token no se queda en la barra de direcciones (capturas de pantalla, historial).
    if (q) this.router.navigate([], { relativeTo: this.route, queryParams: { token: null }, queryParamsHandling: 'merge', replaceUrl: true });

    this.cargarConfig(true);
    const reloj = setInterval(() => this.reloj.set(new Date()), 1000);
    const latido = setInterval(() => this.latir(), 30_000);
    const visible = () => { if (document.visibilityState === 'visible' && this.activado()) void this.pedirPantallaEncendida(); };
    document.addEventListener('visibilitychange', visible);
    this.destroyRef.onDestroy(() => {
      clearInterval(reloj);
      clearInterval(latido);
      document.removeEventListener('visibilitychange', visible);
      this.apagarTodo();
    });
  }

  private cargarConfig(primera = false): void {
    this.api.configParlante(this.codigo(), this.token).subscribe({
      next: (c) => {
        const antes = this.config();
        this.config.set(c);
        this.volumen.set(c.volumen ?? 80);
        this.error.set(null);
        if (primera) this.conectar();
        else if (this.activado() && (antes?.microfono !== c.microfono || antes?.transcribir !== c.transcribir || antes?.mic_whip_url !== c.mic_whip_url)) {
          this.detenerMic();
          void this.iniciarMic();
        }
        this.aplicarVolumen();
      },
      error: (e) => {
        const st = (e as { status?: number })?.status;
        this.error.set(st === 401 || st === 403 ? 'Este enlace de parlante no es válido o fue reemplazado. Pida el enlace nuevo al administrador de seguridad.'
          : st === 404 ? 'No existe un parlante con este código.'
          : 'No se pudo conectar con el servidor. Se reintenta en unos segundos…');
        if (!st || st >= 500) setTimeout(() => this.cargarConfig(primera), 10_000);
      },
    });
  }

  private conectar(): void {
    this.sse?.cerrar();
    this.sse = conectarSse(this.api.urlStreamParlante(this.codigo(), this.token), {
      token: null,
      onEstado: (e) => { this.canal.set(e); if (e === 'conectado') this.latir(); },
      onEvento: (nombre, datos) => this.recibir(nombre, datos),
    });
  }

  private recibir(nombre: string, datos: unknown): void {
    const d = (datos && typeof datos === 'object' ? datos : {}) as Record<string, unknown>;
    switch (nombre) {
      case 'reproducir': this.reproducir(d as Reproducir); break;
      case 'detener': this.detenerAudio(); break;
      case 'ptt': void this.ptt(d as Ptt); break;
      case 'volumen': {
        const v = Number(d['valor']);
        if (!Number.isNaN(v)) { this.volumen.set(Math.max(0, Math.min(100, v))); this.aplicarVolumen(); }
        break;
      }
      case 'config': this.cargarConfig(false); break;
    }
  }

  // ── Activar (gesto del usuario) ──────────────────────────────────────────
  async activar(): Promise<void> {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) { this.ctx ??= new Ctor(); if (this.ctx.state === 'suspended') await this.ctx.resume(); }
    } catch { /* sin WebAudio: igual se intenta con <audio> */ }
    // Un audio vacío "desbloquea" la reproducción en navegadores estrictos.
    try {
      const a = new window.Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
      await a.play().catch(() => {});
    } catch { /* nada */ }
    this.activado.set(true);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* el usuario puede no permitirlo */ }
    void this.pedirPantallaEncendida();
    this.latir();
    void this.iniciarMic();
    if (this.pendiente) { const p = this.pendiente; this.pendiente = null; this.reproducir(p); }
  }

  private async pedirPantallaEncendida(): Promise<void> {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl) this.wakeLock = await wl.request('screen');
    } catch { /* sin permiso o sin soporte */ }
  }

  // ── Audios del centro ────────────────────────────────────────────────────
  private reproducir(r: Reproducir): void {
    if (!r.audio_url) return;
    if (!this.activado()) { this.pendiente = r; return; }
    this.detenerAudio();
    const url = this.api.conToken(urlApi(r.audio_url) ?? r.audio_url, this.token);
    const a = new window.Audio(url);
    this.reproductor = a;
    this.restantes = Math.max(1, Number(r.repetir) || 1);
    if (r.volumen != null) this.volumen.set(Math.max(0, Math.min(100, Number(r.volumen))));
    this.aplicarVolumen();
    this.reproduciendo.set(r.nombre || 'Mensaje del centro de monitoreo');
    a.onended = () => {
      this.restantes--;
      if (this.restantes > 0 && this.reproductor === a) { a.currentTime = 0; a.play().catch(() => this.finAudio(a)); }
      else this.finAudio(a);
    };
    a.onerror = () => this.finAudio(a);
    a.play().catch(() => { this.finAudio(a); this.activado.set(false); this.pendiente = r; });
    this.latir();
  }

  private finAudio(a: HTMLAudioElement): void {
    if (this.reproductor !== a) return;
    this.reproductor = null;
    this.reproduciendo.set(null);
    // El volumen pedido para un mensaje vale solo para ese mensaje.
    this.volumen.set(this.config()?.volumen ?? this.volumen());
    this.latir();
  }

  private detenerAudio(): void {
    const a = this.reproductor;
    this.reproductor = null;
    if (a) { try { a.pause(); a.src = ''; } catch { /* nada */ } }
    this.reproduciendo.set(null);
    this.pendiente = null;
  }

  private aplicarVolumen(): void {
    const v = this.volumen() / 100;
    // Mientras el operador habla, lo demás baja.
    if (this.reproductor) this.reproductor.volume = this.pttActivo() ? Math.min(v, 0.15) : v;
    const p = this.salidaPtt()?.nativeElement;
    if (p) p.volume = Math.max(v, 0.6);
  }

  // ── PTT entrante (WHEP) ──────────────────────────────────────────────────
  private async ptt(p: Ptt): Promise<void> {
    const g = ++this.genPtt;
    this.sesionPtt?.cerrar();
    this.sesionPtt = null;
    if (!p.activo || !p.whep_url) { this.pttActivo.set(false); this.aplicarVolumen(); this.latir(); return; }
    this.pttActivo.set(true);
    this.aplicarVolumen();
    try {
      // MediaMTX necesita un instante para tener la ruta publicada: se reintenta un par de veces.
      let ses: SesionWebrtc | null = null;
      for (let i = 0; i < 4 && !ses && g === this.genPtt; i++) {
        try { ses = await reproducirWhep(p.whep_url, p.token ?? null, { video: false, audio: true, timeoutMs: 6000 }); }
        catch { await new Promise((r) => setTimeout(r, 700)); }
      }
      if (!ses) throw new Error('sin audio');
      if (g !== this.genPtt) { ses.cerrar(); return; }
      this.sesionPtt = ses;
      const el = this.salidaPtt()?.nativeElement;
      if (el) { el.srcObject = ses.stream; el.muted = false; this.aplicarVolumen(); await el.play().catch(() => {}); }
      this.latir();
    } catch {
      if (g === this.genPtt) { this.pttActivo.set(false); this.aplicarVolumen(); }
    }
  }

  // ── Micrófono de la sede (WHIP) y transcripción ─────────────────────────
  private async iniciarMic(): Promise<void> {
    const c = this.config();
    if (!c?.microfono || !c.mic_whip_url || !this.activado()) return;
    if (this.reintentoMic) { clearTimeout(this.reintentoMic); this.reintentoMic = null; }
    this.microfono.set('conectando');
    this.errorMic.set(null);
    try {
      this.flujoMic ??= await pedirMicrofono();
      this.sesionMic = await publicarWhip(c.mic_whip_url, c.token_video ?? this.token, this.flujoMic, {
        detenerPistas: false, timeoutMs: 10_000,
        alEstado: (e) => {
          if ((e === 'failed' || e === 'disconnected') && this.microfono() === 'publicando') {
            this.microfono.set('error');
            this.programarMic();
          }
        },
      });
      this.microfono.set('publicando');
      if (c.transcribir) await this.iniciarStt();
    } catch (e) {
      const n = (e as { name?: string })?.name;
      this.microfono.set('error');
      this.errorMic.set(n && /NotAllowed|NotFound|NotReadable|Security/.test(n) ? mensajeMicrofono(e) : (e as Error)?.message || 'No se pudo publicar el micrófono.');
      // Sin permiso no se reintenta en bucle; un corte de red sí.
      if (!(n && /NotAllowed|NotFound|Security/.test(n))) this.programarMic();
    }
    this.latir();
  }

  private programarMic(): void {
    this.sesionMic?.cerrar();
    this.sesionMic = null;
    if (this.reintentoMic) return;
    this.reintentoMic = setTimeout(() => { this.reintentoMic = null; void this.iniciarMic(); }, 15_000);
  }

  private async iniciarStt(): Promise<void> {
    if (this.stt || !this.flujoMic) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx ??= new Ctor();
    const cliente = new ClienteStt({
      hablante: 'PERSONA',
      pedirToken: async (): Promise<TokenTranscripcion> => {
        const t = await firstValueFrom(this.api.sttToken(this.codigo(), this.token));
        return { token: t.token, url: '', modelo: t.modelo || 'scribe_v2_realtime', idioma: t.idioma || 'es', sample_rate: 16000 };
      },
      alParcial: (texto) => {
        if (texto && !this.inicioFrase) this.inicioFrase = new Date();
        this.parcial.set(texto);
      },
      alConfirmada: (texto) => {
        const fin = new Date();
        const inicio = this.inicioFrase ?? new Date(fin.getTime() - 2000);
        this.inicioFrase = null;
        this.ultimaFrase.set(texto);
        this.api.transcripcion(this.codigo(), this.token, { texto, inicio: isoLocal(inicio), fin: isoLocal(fin) }).subscribe({ error: () => {} });
      },
      alEstado: (e) => this.transcripcion.set(e),
    });
    this.stt = cliente;
    const cap = new CapturaCanal(this.ctx, this.flujoMic, (b) => cliente.enviarAudio(b), (n) => {
      this.nivel.set(n);
      if (n >= UMBRAL_DESPERTAR) cliente.despertar();
    });
    this.captura = cap;
    try {
      await cap.iniciar();
      await cliente.conectar();
    } catch {
      this.transcripcion.set('error');
    }
  }

  private detenerMic(): void {
    if (this.reintentoMic) { clearTimeout(this.reintentoMic); this.reintentoMic = null; }
    this.stt?.cerrar();
    this.stt = null;
    this.captura?.detener();
    this.captura = null;
    this.sesionMic?.cerrar();
    this.sesionMic = null;
    this.flujoMic?.getTracks().forEach((t) => t.stop());
    this.flujoMic = null;
    this.microfono.set('apagado');
    this.transcripcion.set('apagado');
  }

  // ── Latido ───────────────────────────────────────────────────────────────
  private latir(): void {
    if (!this.config()) return;
    const estado = !this.activado() ? 'SIN_AUDIO' : this.pttActivo() ? 'PTT' : this.reproduciendo() ? 'REPRODUCIENDO'
      : this.microfono() === 'error' ? 'MIC_ERROR' : 'LISTO';
    this.api.latido(this.codigo(), this.token, estado).subscribe({ error: () => {} });
  }

  private apagarTodo(): void {
    this.sse?.cerrar();
    this.sse = null;
    this.detenerAudio();
    this.genPtt++;
    this.sesionPtt?.cerrar();
    this.detenerMic();
    try { void this.ctx?.close(); } catch { /* nada */ }
    try { void this.wakeLock?.release(); } catch { /* nada */ }
  }
}

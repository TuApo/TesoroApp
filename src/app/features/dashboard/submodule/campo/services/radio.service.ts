import { Injectable, inject, signal } from '@angular/core';
import { CampoApiService } from './campo-api.service';
import { CampoService } from './campo.service';
import { vibrar } from './dispositivo';

/** Una transmisión que llegó o que está en el historial del canal. */
export interface Transmision {
  id: string;
  canalId: number;
  autorId: string;
  autorNombre: string;
  url: string | null;
  duracionMs: number | null;
  creadoMs: number;
  mia: boolean;
  tarde?: boolean;
  enCola?: boolean;
}

/**
 * Radio de campo: pulsar para hablar desde cualquier dispositivo (teléfono, escritorio,
 * APK). Graba con MediaRecorder mientras se mantiene el botón; al soltar, la nota de voz va
 * al canal —o a la cola si no hay señal— y a los demás les suena sola (SSE `campo-radio`),
 * una detrás de otra, como un radioteléfono.
 */
@Injectable({ providedIn: 'root' })
export class RadioService {
  private readonly api = inject(CampoApiService);
  private readonly campo = inject(CampoService);

  readonly canalId = signal<number | null>(null);
  readonly grabando = signal(false);
  readonly nivel = signal(0);
  readonly hablando = signal<Transmision | null>(null);
  readonly autoReproducir = signal(leerPreferencia());
  readonly historial = signal<Transmision[]>([]);
  readonly error = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private grabador: MediaRecorder | null = null;
  private trozos: Blob[] = [];
  private inicio = 0;
  private analizador: { ctx: AudioContext; raf: number } | null = null;
  private readonly cola: Transmision[] = [];
  private readonly audio = typeof Audio === 'undefined' ? null : new Audio();
  private escuchando = false;

  /** Empieza a escuchar el canal en vivo (se llama al abrir la radio). */
  escuchar(): void {
    if (this.escuchando) return;
    this.escuchando = true;
    this.campo.iniciar();
    this.campo.eventos$.subscribe(e => {
      if (e.nombre !== 'campo-radio') return;
      const d = e.datos;
      const t: Transmision = {
        id: String(d.mensaje_id), canalId: d.canal_id, autorId: d.autor_id, autorNombre: d.autor_nombre,
        url: this.api.absoluta(d.url), duracionMs: d.duracion_ms ?? null, creadoMs: d.grabado_ms ?? Date.now(), mia: false, tarde: !!d.tarde,
      };
      if (t.canalId === this.canalId()) this.historial.update(l => [t, ...l.filter(x => x.id !== t.id)].slice(0, 50));
      if (this.autoReproducir() && (t.canalId === this.canalId())) this.encolar(t);
    });
    if (this.audio) this.audio.onended = () => this.siguiente();
  }

  cambiarCanal(id: number): void {
    this.canalId.set(id);
    this.historial.set([]);
    if (!this.campo.enLinea()) return;
    this.api.recientes(id, 25).subscribe({
      next: ms => this.historial.set(ms
        .filter(m => m.adjuntos?.some((a: any) => a.clase === 'AUDIO'))
        .map(m => {
          const a = m.adjuntos.find((x: any) => x.clase === 'AUDIO');
          return {
            id: String(m.id), canalId: id, autorId: m.autor_id, autorNombre: m.autor_nombre, url: this.api.absoluta(a?.url),
            duracionMs: a?.duracion_ms ?? null, creadoMs: Date.parse(m.creado_en) || Date.now(),
            mia: m.autor_id === this.campo.paquete()?.usuario_id,
          } as Transmision;
        })
        .sort((a, b) => b.creadoMs - a.creadoMs)),
      error: () => undefined,
    });
  }

  alternarAuto(): void {
    this.autoReproducir.update(v => !v);
    try { localStorage.setItem('tuapo.campo.radio.auto', this.autoReproducir() ? '1' : '0'); } catch { /* sin storage */ }
  }

  // ─── Hablar ─────────────────────────────────────────────────────────────

  async presionar(): Promise<void> {
    if (this.grabando() || this.canalId() == null) return;
    this.error.set(null);
    try {
      if (!this.stream || this.stream.getAudioTracks().every(t => t.readyState === 'ended')) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      }
      const tipo = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => (window as any).MediaRecorder?.isTypeSupported?.(t));
      this.grabador = new MediaRecorder(this.stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 24_000 } : undefined);
      this.trozos = [];
      this.grabador.ondataavailable = ev => { if (ev.data.size) this.trozos.push(ev.data); };
      this.grabador.start(250);
      this.inicio = Date.now();
      this.grabando.set(true);
      this.audio?.pause();
      vibrar(30);
      this.medir();
    } catch (e: any) {
      this.error.set(e?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Actívalo en los ajustes del dispositivo.' : 'No se pudo usar el micrófono.');
    }
  }

  async soltar(): Promise<'enviada' | 'en-cola' | 'corta' | null> {
    if (!this.grabando() || !this.grabador) return null;
    const g = this.grabador;
    const dur = Date.now() - this.inicio;
    this.grabando.set(false);
    this.pararMedidor();
    const fin = new Promise<void>(ok => { g.onstop = () => ok(); });
    g.stop();
    await fin;
    vibrar([20, 30, 20]);
    if (dur < 500) return 'corta';
    const blob = new Blob(this.trozos, { type: g.mimeType || 'audio/webm' });
    const canal = this.canalId()!;
    const local: Transmision = {
      id: `local-${Date.now()}`, canalId: canal, autorId: this.campo.paquete()?.usuario_id ?? '', autorNombre: 'Tú',
      url: URL.createObjectURL(blob), duracionMs: dur, creadoMs: Date.now(), mia: true, enCola: true,
    };
    this.historial.update(l => [local, ...l]);
    const enviada = await this.campo.encolarRadio(canal, blob, dur);
    this.historial.update(l => l.map(x => x.id === local.id ? { ...x, enCola: !enviada } : x));
    return enviada ? 'enviada' : 'en-cola';
  }

  /** Libera el micrófono (al salir de la radio): el indicador del sistema se apaga. */
  soltarMicrofono(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  private medir(): void {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(this.stream!);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const datos = new Uint8Array(an.fftSize);
      const paso = () => {
        an.getByteTimeDomainData(datos);
        let max = 0;
        for (const v of datos) max = Math.max(max, Math.abs(v - 128));
        this.nivel.set(Math.min(1, max / 64));
        if (this.analizador) this.analizador.raf = requestAnimationFrame(paso);
      };
      this.analizador = { ctx, raf: requestAnimationFrame(paso) };
    } catch { /* sin medidor */ }
  }

  private pararMedidor(): void {
    if (!this.analizador) return;
    cancelAnimationFrame(this.analizador.raf);
    void this.analizador.ctx.close().catch(() => undefined);
    this.analizador = null;
    this.nivel.set(0);
  }

  // ─── Escuchar ───────────────────────────────────────────────────────────

  reproducir(t: Transmision): void {
    this.cola.length = 0;
    this.encolar(t, true);
  }

  private encolar(t: Transmision, ya = false): void {
    if (!t.url) return;
    this.cola.push(t);
    if (ya || !this.hablando()) this.siguiente();
  }

  private siguiente(): void {
    const t = this.cola.shift();
    if (!t || !this.audio) { this.hablando.set(null); return; }
    if (this.grabando()) { this.cola.unshift(t); return; }
    this.hablando.set(t);
    this.audio.src = t.url!;
    this.audio.play().catch(() => {
      // El navegador bloqueó el audio sin un toque previo: queda en el historial para darle play.
      this.hablando.set(null);
      this.error.set('Toca una transmisión para escucharla (el navegador bloqueó el sonido automático).');
    });
  }
}

function leerPreferencia(): boolean {
  try { return localStorage.getItem('tuapo.campo.radio.auto') !== '0'; } catch { return true; }
}

import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, model, output, signal,
  untracked, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, firstValueFrom } from 'rxjs';

import { AccionPtz, Calidad, Camara, Reproduccion } from '../../models/seguridad.models';
import { SeguridadService, urlApi } from '../../services/seguridad.service';
import { SeguridadVivoService } from '../../services/seguridad-vivo.service';
import { SesionWebrtc, reproducirWhep, soportaWebrtc } from '../../services/webrtc.util';
import { descargarBlob, hora } from '../../utils/formato';

type Modo = 'inactivo' | 'cargando' | 'webrtc' | 'hls' | 'mp4' | 'liviano' | 'error';

/** Agrega `token=` a una URL de video si no lo trae (MediaMTX lo acepta en la query para HLS y playback). */
function conToken(url: string, token: string | null | undefined): string {
  if (!token || /[?&](token|jwt)=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token.replace(/^Bearer /, ''))}`;
}

/**
 * Reproductor de una cámara.
 *
 * <p>EN VIVO: pide `/camaras/{id}/stream?calidad=` y abre WebRTC por WHEP (< 1 s de retraso).
 * Si en ~6 s no conecta (red que bloquea UDP, sede lenta, navegador viejo) cae a "modo
 * liviano": pide la captura JPEG 1–2 veces por segundo. Así SIEMPRE se ve algo.
 * Con calidad principal renueva el arriendo cada 60 s (el agente de sitio solo sube el
 * principal mientras alguien lo mira).
 *
 * <p>GRABACIÓN: con `reproduccion` usa las URLs dadas (WHEP, mp4 o HLS nativo).
 *
 * <p>Doble clic alterna sub ⇄ principal. Silenciado por defecto.
 */
@Component({
  selector: 'sg-visor-camara',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visor-camara.html',
  styleUrls: ['./visor-camara.css'],
  host: { '[class.compacto]': 'compacto()', '[class.pantalla-completa]': 'enPantallaCompleta()' },
})
export class VisorCamara {
  private readonly api = inject(SeguridadService);
  private readonly vivo = inject(SeguridadVivoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly camara = input<Camara | null>(null);
  readonly camaraId = input<string | null>(null);
  readonly calidad = model<Calidad>('sub');
  /** Mosaico: controles mínimos (aparecen al pasar el mouse). */
  readonly compacto = input(false);
  /** Grabación: URLs de reproducción ya pedidas. */
  readonly reproduccion = input<Reproduccion | null>(null);
  /** Para el nombre de la descarga en modo grabación. */
  readonly etiqueta = input<string | null>(null);
  readonly cerrar = output<void>();
  readonly conCerrar = input(false);
  /** Mosaico: botón para ver esta cámara sola. */
  readonly conAmpliar = input(false);
  readonly ampliar = output<void>();

  readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly modo = signal<Modo>('inactivo');
  readonly mensaje = signal<string | null>(null);
  readonly silenciado = signal(true);
  readonly cuadro = signal<string | null>(null);
  readonly ahora = signal(Date.now());
  readonly enPantallaCompleta = signal(false);
  readonly verPtz = signal(false);

  readonly id = computed(() => this.camaraId() ?? this.camara()?.id ?? null);
  readonly horaTexto = computed(() => hora(new Date(this.ahora())));
  readonly estadoCamara = computed(() => {
    const id = this.id();
    return (id && this.vivo.camaras().get(id)?.estado) || this.camara()?.estado || 'DESCONOCIDO';
  });
  readonly etiquetaModo = computed(() => {
    switch (this.modo()) {
      case 'webrtc': return this.reproduccion() ? 'Grabación' : 'En vivo';
      case 'hls': case 'mp4': return 'Grabación';
      case 'liviano': return 'Modo liviano';
      case 'cargando': return 'Conectando…';
      case 'error': return 'Sin señal';
      default: return '';
    }
  });

  private gen = 0;
  private sesion: SesionWebrtc | null = null;
  private arriendo: ReturnType<typeof setInterval> | null = null;
  private sondeo: ReturnType<typeof setTimeout> | null = null;
  private subCaptura: Subscription | null = null;
  private ultimoBlob: Blob | null = null;
  private cuadroUrl: string | null = null;
  private reintentoWebrtc: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const id = this.id();
      const cal = this.calidad();
      const rep = this.reproduccion();
      untracked(() => this.iniciar(id, cal, rep));
    });
    const reloj = setInterval(() => this.ahora.set(Date.now()), 1000);
    const alFs = () => this.enPantallaCompleta.set(document.fullscreenElement === this.host.nativeElement);
    document.addEventListener('fullscreenchange', alFs);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      document.removeEventListener('fullscreenchange', alFs);
      this.detener();
    });
  }

  // ── Ciclo de vida de la conexión ─────────────────────────────────────────
  private detener(): void {
    this.gen++;
    this.sesion?.cerrar();
    this.sesion = null;
    if (this.arriendo) { clearInterval(this.arriendo); this.arriendo = null; }
    if (this.sondeo) { clearTimeout(this.sondeo); this.sondeo = null; }
    if (this.reintentoWebrtc) { clearTimeout(this.reintentoWebrtc); this.reintentoWebrtc = null; }
    this.subCaptura?.unsubscribe();
    this.subCaptura = null;
    const v = this.video()?.nativeElement;
    if (v) { try { v.pause(); } catch { /* nada */ } v.srcObject = null; v.removeAttribute('src'); }
    if (this.cuadroUrl) { URL.revokeObjectURL(this.cuadroUrl); this.cuadroUrl = null; }
    this.cuadro.set(null);
    this.ultimoBlob = null;
  }

  reintentar(): void { this.iniciar(this.id(), this.calidad(), this.reproduccion()); }

  private async iniciar(id: string | null, calidad: Calidad, rep: Reproduccion | null): Promise<void> {
    this.detener();
    const g = this.gen;
    this.mensaje.set(null);
    // Un turno para que exista el <video> (el primer efecto corre antes de pintar la vista).
    await new Promise((r) => setTimeout(r, 0));
    if (g !== this.gen) return;
    if (rep) { await this.iniciarGrabacion(rep, g); return; }
    if (!id) { this.modo.set('inactivo'); return; }
    this.modo.set('cargando');
    let s;
    try {
      s = await firstValueFrom(this.api.stream(id, calidad));
    } catch (e: any) {
      if (g !== this.gen) return;
      // Sin permiso o sin ruta: igual se intenta la captura (puede existir el último cuadro del worker).
      this.mensaje.set(e?.status === 403 ? 'Su rol no puede ver esta cámara.' : null);
      if (e?.status === 403) { this.modo.set('error'); return; }
      this.iniciarLiviano(this.api.urlCaptura(id), g);
      return;
    }
    if (g !== this.gen) return;
    const urlCaptura = s.captura_url || this.api.urlCaptura(id);
    if (s.whep_url && soportaWebrtc()) {
      try {
        const ses = await reproducirWhep(s.whep_url, s.token, {
          timeoutMs: 6000,
          alEstado: (e) => { if ((e === 'failed' || e === 'disconnected') && g === this.gen) this.caidaWebrtc(urlCaptura, g); },
        });
        if (g !== this.gen) { ses.cerrar(); return; }
        this.sesion = ses;
        this.ponerStream(ses.stream);
        this.modo.set('webrtc');
        if (calidad === 'main') {
          this.arriendo = setInterval(() => this.api.stream(id, 'main').subscribe({ error: () => {} }), 60_000);
        }
        return;
      } catch {
        if (g !== this.gen) return;
      }
    }
    // HLS solo si el navegador lo reproduce nativo (Safari/iOS): no se agregan dependencias.
    const v = this.video()?.nativeElement;
    if (s.hls_url && v?.canPlayType('application/vnd.apple.mpegurl')) {
      v.srcObject = null;
      v.src = conToken(s.hls_url, s.token);
      v.play().catch(() => {});
      this.modo.set('hls');
      return;
    }
    this.iniciarLiviano(urlCaptura, g);
  }

  private caidaWebrtc(urlCaptura: string, g: number): void {
    if (this.modo() !== 'webrtc') return;
    this.sesion?.cerrar();
    this.sesion = null;
    this.iniciarLiviano(urlCaptura, g);
    // Se vuelve a probar el video en 30 s (la red pudo volver).
    this.reintentoWebrtc = setTimeout(() => { if (g === this.gen) this.reintentar(); }, 30_000);
  }

  private async iniciarGrabacion(rep: Reproduccion, g: number): Promise<void> {
    this.modo.set('cargando');
    if (rep.whep_url && soportaWebrtc()) {
      try {
        const ses = await reproducirWhep(rep.whep_url, rep.token, { timeoutMs: 8000 });
        if (g !== this.gen) { ses.cerrar(); return; }
        this.sesion = ses;
        this.ponerStream(ses.stream);
        this.modo.set('webrtc');
        return;
      } catch { if (g !== this.gen) return; }
    }
    const v = this.video()?.nativeElement;
    if (!v) return;
    v.srcObject = null;
    if (rep.mp4_url) {
      v.src = conToken(urlApi(rep.mp4_url) ?? rep.mp4_url, rep.token);
      v.play().catch(() => {});
      this.modo.set('mp4');
      return;
    }
    if (rep.hls_url && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = conToken(rep.hls_url, rep.token);
      v.play().catch(() => {});
      this.modo.set('hls');
      return;
    }
    this.modo.set('error');
    this.mensaje.set('Este navegador no puede reproducir la grabación. Descargue el clip en MP4.');
  }

  private ponerStream(stream: MediaStream): void {
    const v = this.video()?.nativeElement;
    if (!v) return;
    v.removeAttribute('src');
    v.srcObject = stream;
    v.muted = this.silenciado();
    v.play().catch(() => { v.muted = true; this.silenciado.set(true); v.play().catch(() => {}); });
  }

  /** 1–2 cuadros por segundo; nunca dos pedidos a la vez. */
  private iniciarLiviano(url: string, g: number): void {
    this.modo.set('liviano');
    let fallos = 0;
    const pedir = () => {
      if (g !== this.gen) return;
      this.subCaptura = this.api.captura(url).subscribe({
        next: (b) => {
          if (g !== this.gen) return;
          fallos = 0;
          this.ultimoBlob = b;
          const nueva = URL.createObjectURL(b);
          const vieja = this.cuadroUrl;
          this.cuadroUrl = nueva;
          this.cuadro.set(nueva);
          if (vieja) setTimeout(() => URL.revokeObjectURL(vieja), 1000);
          if (this.modo() !== 'liviano') this.modo.set('liviano');
          this.sondeo = setTimeout(pedir, document.hidden ? 5000 : 700);
        },
        error: (e) => {
          if (g !== this.gen) return;
          fallos++;
          if (fallos >= 3 && !this.cuadro()) {
            this.modo.set('error');
            this.mensaje.set(e?.status === 404 ? 'La cámara no entrega imagen ahora.' : 'No hay señal de la cámara.');
          }
          this.sondeo = setTimeout(pedir, Math.min(15_000, 1000 * fallos * 2));
        },
      });
    };
    pedir();
  }

  // ── Controles ────────────────────────────────────────────────────────────
  alternarCalidad(): void {
    if (this.reproduccion()) return;
    this.calidad.set(this.calidad() === 'sub' ? 'main' : 'sub');
  }

  alternarSonido(): void {
    const v = this.video()?.nativeElement;
    const nuevo = !this.silenciado();
    this.silenciado.set(nuevo);
    if (v) { v.muted = nuevo; if (!nuevo) v.play().catch(() => {}); }
  }

  async pantallaCompleta(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.host.nativeElement.requestFullscreen();
    } catch { /* el navegador no lo permite */ }
  }

  /** Descarga el cuadro actual en JPEG. */
  captura(): void {
    const nombre = `${(this.etiqueta() || this.camara()?.nombre || 'camara').replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    if (this.modo() === 'liviano' && this.ultimoBlob) { descargarBlob(this.ultimoBlob, nombre); return; }
    const v = this.video()?.nativeElement;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    c.toBlob((b) => { if (b) descargarBlob(b, nombre); }, 'image/jpeg', 0.92);
  }

  ptz(accion: AccionPtz): void {
    const id = this.id();
    if (id) this.api.ptz(id, accion, null, 0.5).subscribe({ error: () => {} });
  }
}

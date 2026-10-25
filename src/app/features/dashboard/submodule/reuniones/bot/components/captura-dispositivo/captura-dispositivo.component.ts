import {
  ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, inject, input, output, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { BotService } from '../../services/bot.service';
import { mensajeError } from '../../../utils/texto';

type Fuente = 'pantalla' | 'microfono';

interface Trozo { seq: number; blob: Blob; intentos: number; }

/** Duración de cada trozo de audio. Cada uno es un archivo COMPLETO (con cabecera). */
export const TROZO_MS = 10_000;
/** Cada cuánto se manda un fotograma de la pantalla compartida. */
export const FOTOGRAMA_MS = 20_000;
const ANCHO_MAX_FOTOGRAMA = 1280;

const MIMES_AUDIO = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

/**
 * Captura desde este dispositivo (modo CAPTURA): para lo que el bot no puede alcanzar,
 * como las llamadas de WhatsApp. Comparte la pantalla/ventana con el audio del sistema (y
 * opcionalmente mezcla el micrófono, que es la voz propia), o solo el micrófono para una
 * llamada en altavoz desde el celular.
 *
 * Por qué se reinicia el MediaRecorder cada 10 s en vez de usar `timeslice`: con timeslice
 * solo el primer trozo trae la cabecera WebM y los demás no se pueden transcribir por
 * separado. Arrancando uno nuevo antes de parar el anterior, cada trozo es un archivo
 * válido y el solape es de milisegundos.
 *
 * Los trozos van en cola, en orden y con reintentos indefinidos: perder uno es perder un
 * pedazo de conversación. Mientras haya pendientes se avisa antes de cerrar la pestaña.
 */
@Component({
  selector: 'app-captura-dispositivo',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './captura-dispositivo.component.html',
  styleUrls: ['../../../estilos/base.css', './captura-dispositivo.component.css'],
})
export class CapturaDispositivoComponent {
  private readonly api = inject(BotService);
  private readonly navegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly sessionId = input.required<string>();
  /** false cuando la sesión ya terminó: no se deja arrancar. */
  readonly habilitada = input(true);

  readonly capturandoCambio = output<boolean>();

  readonly fuente = signal<Fuente>('pantalla');
  readonly incluirMicro = signal(true);
  readonly capturando = signal(false);
  readonly arrancando = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly nivel = signal(0);
  readonly enviados = signal(0);
  readonly pendientes = signal(0);
  readonly fotogramas = signal(0);
  readonly ultimoError = signal('');
  readonly tieneVideo = signal(false);

  readonly nivelPct = computed(() => Math.round(this.nivel() * 100));

  readonly soportaPantalla = computed(() =>
    this.navegador && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);

  private streams: MediaStream[] = [];
  private contexto: AudioContext | null = null;
  private analizador: AnalyserNode | null = null;
  private mezcla: MediaStream | null = null;
  private grabador: MediaRecorder | null = null;
  private mime = '';
  private cicloTimer: ReturnType<typeof setInterval> | null = null;
  private fotoTimer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private video: HTMLVideoElement | null = null;
  private t0 = 0;
  private cola: Trozo[] = [];
  private enviando = false;
  private seq = -1;
  private vivo = true;

  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => { this.vivo = false; this.detener(); this.quitarAvisoSalida(); });
    if (this.navegador && 'mediaDevices' in navigator && !('getDisplayMedia' in navigator.mediaDevices)) {
      this.fuente.set('microfono');
    }
  }

  async iniciar(): Promise<void> {
    if (!this.navegador || this.capturando() || this.arrancando()) return;
    this.error.set('');
    this.aviso.set('');
    this.arrancando.set(true);
    try {
      this.mime = MIMES_AUDIO.find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
      if (typeof MediaRecorder === 'undefined') throw new Error('Este navegador no permite grabar audio.');
      this.contexto = new AudioContext();
      const destino = this.contexto.createMediaStreamDestination();
      this.analizador = this.contexto.createAnalyser();
      this.analizador.fftSize = 512;
      let pistasAudio = 0;

      if (this.fuente() === 'pantalla') {
        const pantalla = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        this.streams.push(pantalla);
        const audio = pantalla.getAudioTracks();
        if (audio.length) {
          this.contexto.createMediaStreamSource(new MediaStream(audio)).connect(destino);
          pistasAudio++;
        } else {
          this.aviso.set('No se compartió el audio del sistema: solo se oirá tu micrófono. Vuelve a empezar y marca «Compartir audio».');
        }
        const video = pantalla.getVideoTracks()[0];
        if (video) {
          this.tieneVideo.set(true);
          // Si la persona deja de compartir desde la barra del navegador, se cierra la captura.
          video.addEventListener('ended', () => this.detener());
          this.prepararVideo(new MediaStream([video]));
        }
      }
      if (this.fuente() === 'microfono' || this.incluirMicro()) {
        try {
          const micro = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          this.streams.push(micro);
          this.contexto.createMediaStreamSource(micro).connect(destino);
          pistasAudio++;
        } catch (e) {
          if (this.fuente() === 'microfono') throw e;
          this.aviso.set('No se pudo usar el micrófono: solo se captura el audio compartido.');
        }
      }
      if (!pistasAudio) throw new Error('No hay ningún audio que capturar.');

      const fuenteNivel = this.contexto.createMediaStreamSource(destino.stream);
      fuenteNivel.connect(this.analizador);
      this.mezcla = destino.stream;
      this.seq = this.leerSeq();
      this.t0 = Date.now();
      this.nuevoGrabador();
      this.cicloTimer = setInterval(() => this.rotar(), TROZO_MS);
      if (this.tieneVideo()) {
        this.fotoTimer = setInterval(() => void this.fotograma(), FOTOGRAMA_MS);
        setTimeout(() => void this.fotograma(), 1500);
      }
      this.medirNivel();
      this.capturando.set(true);
      this.capturandoCambio.emit(true);
      this.ponerAvisoSalida();
    } catch (e) {
      this.detener();
      this.error.set(this.explicar(e));
    } finally {
      this.arrancando.set(false);
    }
  }

  detener(): void {
    if (this.cicloTimer) { clearInterval(this.cicloTimer); this.cicloTimer = null; }
    if (this.fotoTimer) { clearInterval(this.fotoTimer); this.fotoTimer = null; }
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    const g = this.grabador;
    this.grabador = null;
    if (g && g.state !== 'inactive') g.stop();   // su último trozo entra a la cola en onstop
    for (const s of this.streams) for (const t of s.getTracks()) t.stop();
    this.streams = [];
    this.mezcla = null;
    if (this.contexto) { void this.contexto.close().catch(() => undefined); this.contexto = null; }
    this.analizador = null;
    if (this.video) { this.video.srcObject = null; this.video = null; }
    this.nivel.set(0);
    this.tieneVideo.set(false);
    if (this.capturando()) {
      this.capturando.set(false);
      this.capturandoCambio.emit(false);
    }
    if (!this.cola.length) this.quitarAvisoSalida();
  }

  // ── Audio ─────────────────────────────────────────────────────────────────

  private nuevoGrabador(): void {
    if (!this.mezcla) return;
    const g = new MediaRecorder(this.mezcla, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 48_000 } : undefined);
    const partes: Blob[] = [];
    g.ondataavailable = ev => { if (ev.data && ev.data.size) partes.push(ev.data); };
    g.onstop = () => {
      if (!partes.length) return;
      const blob = new Blob(partes, { type: (this.mime || partes[0].type || 'audio/webm').split(';')[0] });
      this.encolar(blob);
    };
    g.start();
    this.grabador = g;
  }

  /** Arranca el siguiente trozo antes de cerrar el actual: no queda hueco entre ambos. */
  private rotar(): void {
    const viejo = this.grabador;
    this.nuevoGrabador();
    if (viejo && viejo.state !== 'inactive') viejo.stop();
  }

  private encolar(blob: Blob): void {
    this.seq += 1;
    this.guardarSeq(this.seq);
    this.cola.push({ seq: this.seq, blob, intentos: 0 });
    this.pendientes.set(this.cola.length);
    void this.vaciarCola();
  }

  private async vaciarCola(): Promise<void> {
    if (this.enviando) return;
    this.enviando = true;
    try {
      while (this.cola.length && this.vivo) {
        const t = this.cola[0];
        try {
          await firstValueFrom(this.api.subirAudio(this.sessionId(), t.seq, t.blob));
          this.cola.shift();
          this.enviados.update(n => n + 1);
          this.ultimoError.set('');
        } catch (e) {
          const status = (e as { status?: number })?.status;
          // 409/410: la sesión ya cerró del lado del servidor; reintentar no sirve.
          if (status === 409 || status === 410) {
            this.ultimoError.set('La sesión ya terminó: se dejó de enviar audio.');
            this.cola = [];
            this.detener();
            break;
          }
          t.intentos++;
          this.ultimoError.set(mensajeError(e, 'No se pudo enviar un trozo de audio') + ' Reintentando…');
          await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(t.intentos, 5))));
        }
        this.pendientes.set(this.cola.length);
      }
    } finally {
      this.enviando = false;
      if (!this.cola.length && !this.capturando()) this.quitarAvisoSalida();
    }
  }

  private medirNivel(): void {
    const a = this.analizador;
    if (!a) return;
    const datos = new Uint8Array(a.fftSize);
    const paso = () => {
      if (!this.analizador) return;
      a.getByteTimeDomainData(datos);
      let suma = 0;
      for (const v of datos) { const x = (v - 128) / 128; suma += x * x; }
      this.nivel.set(Math.min(1, Math.sqrt(suma / datos.length) * 3));
      this.raf = requestAnimationFrame(paso);
    };
    this.raf = requestAnimationFrame(paso);
  }

  // ── Fotogramas ────────────────────────────────────────────────────────────

  private prepararVideo(stream: MediaStream): void {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
    this.video = v;
  }

  private async fotograma(): Promise<void> {
    const v = this.video;
    if (!v || !v.videoWidth) return;
    const escala = Math.min(1, ANCHO_MAX_FOTOGRAMA / v.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * escala);
    canvas.height = Math.round(v.videoHeight * escala);
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.72));
    if (!blob) return;
    try {
      await firstValueFrom(this.api.subirImagen(this.sessionId(), Date.now() - this.t0, blob));
      this.fotogramas.update(n => n + 1);
    } catch {
      // Un fotograma perdido no importa: el siguiente llega en 20 s.
    }
  }

  // ── Utilidades ────────────────────────────────────────────────────────────

  private claveSeq(): string { return `reuniones-bot-captura-seq-${this.sessionId()}`; }

  /** El seq sigue creciendo si se pausa y se reanuda la captura en la misma sesión. */
  private leerSeq(): number {
    if (this.seq >= 0) return this.seq;
    try {
      const v = Number(localStorage.getItem(this.claveSeq()));
      return Number.isFinite(v) && v >= 0 ? v : -1;
    } catch { return -1; }
  }

  private guardarSeq(v: number): void {
    try { localStorage.setItem(this.claveSeq(), `${v}`); } catch { /* sin almacenamiento: queda en memoria */ }
  }

  private readonly antesDeSalir = (ev: BeforeUnloadEvent) => {
    if (this.capturando() || this.cola.length) { ev.preventDefault(); ev.returnValue = ''; }
  };

  private ponerAvisoSalida(): void {
    if (this.navegador) window.addEventListener('beforeunload', this.antesDeSalir);
  }

  private quitarAvisoSalida(): void {
    if (this.navegador) window.removeEventListener('beforeunload', this.antesDeSalir);
  }

  private explicar(e: unknown): string {
    const nombre = (e as { name?: string })?.name;
    if (nombre === 'NotAllowedError') return 'No se dio permiso para capturar. Vuelve a intentarlo y acepta compartir.';
    if (nombre === 'NotFoundError') return 'No se encontró un micrófono en este dispositivo.';
    if (nombre === 'NotReadableError') return 'Otro programa está usando el micrófono o la pantalla.';
    return (e as Error)?.message || 'No se pudo iniciar la captura.';
  }
}

import {
  ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, Output, inject, signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Botón de grabar con el micrófono. Emite el audio al detener.
 *
 * Sirve para dos cosas: dictar una respuesta (segundos) y grabar una explicación como
 * material (minutos). Muestra el tiempo y un medidor de nivel: sin el medidor, la gente habla
 * un minuto con el micrófono equivocado y se entera cuando la transcripción sale vacía.
 */
@Component({
  selector: 'app-grabadora-voz',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <button type="button" class="gv" [class.gv--on]="grabando()" [class.gv--compacta]="compacta"
            [disabled]="deshabilitada" (click)="alternar()"
            [attr.aria-label]="grabando() ? 'Detener grabación' : etiqueta"
            [attr.title]="grabando() ? 'Detener' : etiqueta">
      <mat-icon>{{ grabando() ? 'stop' : 'mic' }}</mat-icon>
      @if (grabando()) {
        <span class="gv__nivel" aria-hidden="true"><i [style.transform]="'scaleY(' + nivel() + ')'"></i></span>
        <span class="gv__tiempo">{{ tiempo() }}</span>
      } @else if (!compacta) {
        <span>{{ etiqueta }}</span>
      }
    </button>
    @if (error()) { <span class="gv__error" role="alert">{{ error() }}</span> }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 8px; }
    .gv { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border-strong);
      background: var(--surface); color: var(--text); border-radius: 999px; padding: 0 16px;
      font: 600 14px var(--font-sans); cursor: pointer; transition: background .15s, border-color .15s; }
    .gv:hover:not(:disabled) { background: var(--surface-3); }
    .gv:disabled { opacity: .5; cursor: not-allowed; }
    .gv--compacta { width: 48px; justify-content: center; padding: 0; }
    .gv--on { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-fg); }
    .gv--on.gv--compacta { width: auto; padding: 0 14px; }
    .gv__nivel { width: 6px; height: 20px; border-radius: 3px; background: rgb(var(--ink-rgb) / .12); overflow: hidden; display: flex; align-items: flex-end; }
    .gv__nivel i { display: block; width: 100%; height: 100%; background: currentColor; transform-origin: bottom; transition: transform .08s linear; }
    .gv__tiempo { font-variant-numeric: tabular-nums; min-width: 38px; }
    .gv__error { color: var(--danger-fg); font-size: 12px; }
  `],
})
export class GrabadoraVoz {
  @Input() etiqueta = 'Dictar';
  @Input() compacta = false;
  @Input() deshabilitada = false;
  /** Tope en segundos; al llegar se detiene sola. */
  @Input() maximoSeg = 180;
  @Output() grabado = new EventEmitter<Blob>();

  readonly grabando = signal(false);
  readonly segundos = signal(0);
  readonly nivel = signal(0.05);
  readonly error = signal<string | null>(null);

  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private partes: Blob[] = [];
  private reloj: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private raf = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.liberar());
  }

  tiempo(): string {
    const s = this.segundos();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  async alternar(): Promise<void> {
    if (this.grabando()) { this.detener(); return; }
    this.error.set(null);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      this.error.set('No hay permiso para el micrófono');
      return;
    }
    const mime = GrabadoraVoz.mejorMime();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.partes = [];
    this.rec.ondataavailable = e => { if (e.data.size) this.partes.push(e.data); };
    this.rec.onstop = () => {
      const blob = new Blob(this.partes, { type: this.rec?.mimeType || mime || 'audio/webm' });
      this.liberar();
      if (blob.size > 0) this.grabado.emit(blob);
    };
    this.rec.start(1000);
    this.grabando.set(true);
    this.segundos.set(0);
    this.reloj = setInterval(() => {
      this.segundos.update(s => s + 1);
      if (this.segundos() >= this.maximoSeg) this.detener();
    }, 1000);
    this.medir();
  }

  detener(): void {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    else this.liberar();
  }

  /** Nivel de voz para el medidor (RMS de la señal, suavizado). */
  private medir(): void {
    if (!this.stream) return;
    try {
      this.audioCtx = new AudioContext();
      const an = this.audioCtx.createAnalyser();
      an.fftSize = 512;
      this.audioCtx.createMediaStreamSource(this.stream).connect(an);
      const datos = new Uint8Array(an.fftSize);
      const paso = () => {
        an.getByteTimeDomainData(datos);
        let suma = 0;
        for (const v of datos) { const x = (v - 128) / 128; suma += x * x; }
        const rms = Math.sqrt(suma / datos.length);
        this.nivel.set(Math.max(0.05, Math.min(1, rms * 4)));
        this.raf = requestAnimationFrame(paso);
      };
      paso();
    } catch { /* sin medidor: se graba igual */ }
  }

  private liberar(): void {
    if (this.reloj) { clearInterval(this.reloj); this.reloj = null; }
    cancelAnimationFrame(this.raf);
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.grabando.set(false);
  }

  static mejorMime(): string {
    for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }
}

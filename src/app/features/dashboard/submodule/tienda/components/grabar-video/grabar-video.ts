import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Grabar el video del empaque dentro de la app: cámara trasera a 640×480 y ~1 Mbps, unos
 * 7 MB por minuto, para que suba rápido con datos móviles. Máximo 3 minutos. Si el navegador
 * no deja grabar, se usa la cámara del teléfono (archivo de hasta 40 MB).
 */
@Component({
  selector: 'app-grabar-video',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (estado() === 'apagado') {
      <div class="botones">
        @if (puedeGrabar) { <button type="button" class="b" (click)="abrir()"><mat-icon>videocam</mat-icon> Grabar video del empaque</button> }
        <label class="b sec"><mat-icon>video_file</mat-icon> {{ puedeGrabar ? 'O usar la cámara del teléfono' : 'Grabar con la cámara' }}
          <input type="file" accept="video/*" capture="environment" hidden (change)="archivo($event)" /></label>
      </div>
    } @else {
      <div class="visor">
        <video #vista autoplay muted playsinline></video>
        @if (estado() === 'grabando') { <span class="rec"><i></i> {{ tiempo() }}</span> }
      </div>
      <div class="botones">
        @if (estado() === 'listo') {
          <button type="button" class="b rojo" (click)="grabar()"><mat-icon>fiber_manual_record</mat-icon> Empezar</button>
          <button type="button" class="b sec" (click)="apagar()">Cancelar</button>
        } @else {
          <button type="button" class="b" (click)="detener()"><mat-icon>stop</mat-icon> Terminar y subir</button>
        }
      </div>
    }
    @if (error()) { <p class="err">{{ error() }}</p> }
  `,
  styles: [`
    :host { display: block; }
    .botones { display: flex; flex-wrap: wrap; gap: 8px; }
    .b { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 1 1 160px; border: 1px solid #0b6b58; background: #0b6b58; color: #fff;
         border-radius: 10px; padding: 8px 12px; font: inherit; font-size: 14px; cursor: pointer; min-height: 44px; box-sizing: border-box; }
    .b.sec { background: var(--surface); color: var(--text); border-color: var(--border); }
    .b.rojo { background: #dc2626; border-color: #dc2626; }
    .visor { position: relative; border-radius: 12px; overflow: hidden; background: #000; margin-bottom: 8px; }
    video { width: 100%; max-height: 50vh; display: block; }
    .rec { position: absolute; top: 8px; left: 8px; display: inline-flex; align-items: center; gap: 6px; background: rgba(0,0,0,.6); color: #fff; padding: 2px 10px;
           border-radius: 999px; font: 600 13px system-ui; }
    .rec i { width: 10px; height: 10px; border-radius: 999px; background: #ef4444; animation: parpadeo 1s infinite; }
    @keyframes parpadeo { 50% { opacity: .2; } }
    .err { color: #b91c1c; font-size: 13px; margin: 6px 0 0; }
  `],
})
export class GrabarVideo implements OnDestroy {
  /** El video terminado (webm o mp4). */
  readonly video = output<{ blob: Blob; nombre: string }>();
  readonly vista = viewChild<ElementRef<HTMLVideoElement>>('vista');
  readonly estado = signal<'apagado' | 'listo' | 'grabando'>('apagado');
  readonly tiempo = signal('0:00');
  readonly error = signal<string | null>(null);
  readonly puedeGrabar = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  private flujo: MediaStream | null = null;
  private grabadora: MediaRecorder | null = null;
  private trozos: Blob[] = [];
  private reloj: ReturnType<typeof setInterval> | null = null;
  private inicio = 0;

  async abrir(): Promise<void> {
    this.error.set(null);
    try {
      const video = { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };
      // Con audio si lo dejan (se oye lo que se dice al empacar); si niegan el micrófono, solo video.
      try { this.flujo = await navigator.mediaDevices.getUserMedia({ video, audio: true }); }
      catch { this.flujo = await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
      this.estado.set('listo');
      setTimeout(() => { const v = this.vista()?.nativeElement; if (v && this.flujo) v.srcObject = this.flujo; });
    } catch {
      this.error.set('No se pudo abrir la cámara. Use "la cámara del teléfono".');
      this.apagar();
    }
  }

  grabar(): void {
    if (!this.flujo) return;
    const tipo = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported?.(t)) ?? '';
    this.trozos = [];
    this.grabadora = new MediaRecorder(this.flujo, { ...(tipo ? { mimeType: tipo } : {}), videoBitsPerSecond: 900_000, audioBitsPerSecond: 48_000 });
    this.grabadora.ondataavailable = e => { if (e.data.size) this.trozos.push(e.data); };
    this.grabadora.onstop = () => {
      const t = this.grabadora?.mimeType || tipo || 'video/webm';
      const blob = new Blob(this.trozos, { type: t });
      this.video.emit({ blob, nombre: 'empaque.' + (t.includes('mp4') ? 'mp4' : 'webm') });
      this.apagar();
    };
    this.grabadora.start(1000);
    this.inicio = Date.now();
    this.estado.set('grabando');
    this.reloj = setInterval(() => {
      const s = Math.floor((Date.now() - this.inicio) / 1000);
      this.tiempo.set(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      if (s >= 180) this.detener();
    }, 500);
  }

  detener(): void { if (this.grabadora && this.grabadora.state !== 'inactive') this.grabadora.stop(); }

  archivo(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (!f) return;
    if (f.size > 40_000_000) { this.error.set('El video pesa más de 40 MB: grábelo más corto o con "Grabar video del empaque".'); return; }
    this.video.emit({ blob: f, nombre: f.name || 'empaque.mp4' });
  }

  apagar(): void {
    if (this.reloj) { clearInterval(this.reloj); this.reloj = null; }
    this.flujo?.getTracks().forEach(t => t.stop());
    this.flujo = null; this.grabadora = null;
    this.estado.set('apagado'); this.tiempo.set('0:00');
  }

  ngOnDestroy(): void { this.apagar(); }
}

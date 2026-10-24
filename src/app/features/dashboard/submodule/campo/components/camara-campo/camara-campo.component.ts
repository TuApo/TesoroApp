import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { aJpeg, vibrar } from '../../services/dispositivo';

/**
 * Cámara a pantalla completa para el campo, en dos modos:
 *  · `qr`     → cámara trasera, busca el QR de la finca solo (BarcodeDetector nativo del
 *               sistema cuando existe —Android/Chrome—, si no jsQR) y lo emite.
 *  · `selfie` → cámara frontal con guía del rostro; el toque en el obturador emite el JPEG.
 * No necesita red. En el APK la cámara es la del teléfono vía la WebView de Capacitor.
 */
@Component({
  selector: 'app-camara-campo',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cam" role="dialog" [attr.aria-label]="modo() === 'qr' ? 'Escanear QR de la finca' : 'Tomar selfie'">
      <video #video playsinline muted autoplay [class.espejo]="modo() === 'selfie'"></video>
      <div class="guia" [class.rostro]="modo() === 'selfie'">
        @if (modo() === 'qr') { <span class="esq a"></span><span class="esq b"></span><span class="esq c"></span><span class="esq d"></span> }
      </div>
      <header>
        <button type="button" class="redondo" (click)="cerrar.emit()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
        <div class="titulo">
          <strong>{{ modo() === 'qr' ? 'Escanea el QR de la finca' : 'Tómate una selfie' }}</strong>
          <span>{{ modo() === 'qr' ? 'Apunta al cartel pegado en la entrada' : 'Rostro de frente, sin gafas oscuras ni gorra' }}</span>
        </div>
        @if (linterna()) {
          <button type="button" class="redondo" (click)="alternarLinterna()" aria-label="Linterna"><mat-icon>{{ luz() ? 'flash_on' : 'flash_off' }}</mat-icon></button>
        }
      </header>
      @if (error()) { <div class="error">{{ error() }}</div> }
      <footer>
        @if (modo() === 'selfie') {
          <button type="button" class="obturador" (click)="disparar()" [disabled]="!lista()" aria-label="Tomar foto"></button>
        } @else {
          <button type="button" class="texto" (click)="sinQr.emit()">No hay QR / no lo lee</button>
        }
      </footer>
    </div>
  `,
  styles: [`
    .cam { position: fixed; inset: 0; z-index: 2000; background: #000; color: #fff; }
    video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    video.espejo { transform: scaleX(-1); }
    .guia { position: absolute; left: 50%; top: 46%; width: min(70vw, 300px); aspect-ratio: 1; transform: translate(-50%, -50%); }
    .guia.rostro { width: min(62vw, 260px); aspect-ratio: 3 / 4; border: 3px dashed rgb(255 255 255 / .85); border-radius: 50%; }
    .esq { position: absolute; width: 42px; height: 42px; border: 5px solid #A3E635; }
    .esq.a { left: 0; top: 0; border-right: 0; border-bottom: 0; border-radius: 14px 0 0 0; }
    .esq.b { right: 0; top: 0; border-left: 0; border-bottom: 0; border-radius: 0 14px 0 0; }
    .esq.c { left: 0; bottom: 0; border-right: 0; border-top: 0; border-radius: 0 0 0 14px; }
    .esq.d { right: 0; bottom: 0; border-left: 0; border-top: 0; border-radius: 0 0 14px 0; }
    header { position: absolute; left: 0; right: 0; top: 0; display: flex; gap: 12px; align-items: center;
             padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 24px; background: linear-gradient(#000c, #0000); }
    .titulo { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .titulo strong { font: 700 17px/1.2 var(--font-sans, system-ui); }
    .titulo span { font: 13px/1.3 var(--font-sans, system-ui); opacity: .85; }
    .redondo { width: 44px; height: 44px; border-radius: 50%; border: 0; background: rgb(255 255 255 / .18); color: #fff; display: grid; place-items: center; }
    footer { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: center;
             padding: 24px 16px calc(env(safe-area-inset-bottom, 0px) + 28px); background: linear-gradient(#0000, #000c); }
    .obturador { width: 78px; height: 78px; border-radius: 50%; border: 5px solid #fff; background: rgb(255 255 255 / .25); }
    .obturador:active { background: #fff; }
    .obturador:disabled { opacity: .4; }
    .texto { border: 1px solid rgb(255 255 255 / .5); background: rgb(0 0 0 / .4); color: #fff; border-radius: 999px;
             padding: 12px 20px; font: 600 14px var(--font-sans, system-ui); }
    .error { position: absolute; left: 16px; right: 16px; top: 45%; background: #7F1D1D; padding: 14px; border-radius: 14px;
             font: 600 14px/1.4 var(--font-sans, system-ui); text-align: center; }
  `],
})
export class CamaraCampoComponent {
  readonly modo = input<'qr' | 'selfie'>('qr');
  readonly leido = output<string>();
  readonly foto = output<Blob>();
  readonly cerrar = output<void>();
  readonly sinQr = output<void>();

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly destroy = inject(DestroyRef);
  readonly error = signal<string | null>(null);
  readonly lista = signal(false);
  readonly linterna = signal(false);
  readonly luz = signal(false);
  private stream: MediaStream | null = null;
  private vivo = true;

  constructor() {
    afterNextRender(() => void this.abrir());
    this.destroy.onDestroy(() => { this.vivo = false; this.stream?.getTracks().forEach(t => t.stop()); });
  }

  private async abrir(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: this.modo() === 'qr' ? { ideal: 'environment' } : 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const v = this.video().nativeElement;
      v.srcObject = this.stream;
      await v.play().catch(() => undefined);
      this.lista.set(true);
      const pista = this.stream.getVideoTracks()[0];
      this.linterna.set(!!(pista?.getCapabilities?.() as any)?.torch);
      if (this.modo() === 'qr') void this.buscarQr();
    } catch (e: any) {
      this.error.set(e?.name === 'NotAllowedError'
        ? 'Permiso de cámara denegado. Actívalo en los ajustes del teléfono.'
        : 'No se pudo abrir la cámara de este dispositivo.');
    }
  }

  async alternarLinterna(): Promise<void> {
    const pista = this.stream?.getVideoTracks()[0];
    if (!pista) return;
    this.luz.update(x => !x);
    await pista.applyConstraints({ advanced: [{ torch: this.luz() } as any] }).catch(() => undefined);
  }

  private async buscarQr(): Promise<void> {
    const v = this.video().nativeElement;
    const Detector = (window as any).BarcodeDetector;
    let detector: any = null;
    if (Detector) {
      try { detector = new Detector({ formats: ['qr_code'] }); } catch { detector = null; }
    }
    const jsQR = detector ? null : (await import('jsqr')).default;
    const lienzo = document.createElement('canvas');
    const g = lienzo.getContext('2d', { willReadFrequently: true })!;
    while (this.vivo) {
      if (v.readyState >= 2 && v.videoWidth) {
        try {
          let texto: string | null = null;
          if (detector) {
            const r = await detector.detect(v);
            texto = r?.[0]?.rawValue ?? null;
          } else if (jsQR) {
            const esc = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
            lienzo.width = Math.round(v.videoWidth * esc);
            lienzo.height = Math.round(v.videoHeight * esc);
            g.drawImage(v, 0, 0, lienzo.width, lienzo.height);
            const img = g.getImageData(0, 0, lienzo.width, lienzo.height);
            texto = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (texto) {
            vibrar([30, 40, 30]);
            this.leido.emit(texto);
            return;
          }
        } catch { /* fotograma ilegible: sigue */ }
      }
      await new Promise(r => setTimeout(r, 180));
    }
  }

  async disparar(): Promise<void> {
    const v = this.video().nativeElement;
    if (!v.videoWidth) return;
    vibrar(25);
    this.foto.emit(await aJpeg(v, 900, 0.82, true));
  }
}

import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

/** Tomar una foto con la cámara del equipo (o la del celular) y adjuntarla al chat. */
@Component({
  selector: 'app-com-camara',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="cam">
      @if (error()) {
        <div class="error"><mat-icon>no_photography</mat-icon><p>{{ error() }}</p>
          <button type="button" class="sec" (click)="cerrar()">Cerrar</button></div>
      } @else {
        @if (foto(); as f) { <img [src]="f" alt="Foto tomada" /> }
        <video #video autoplay playsinline muted [hidden]="!!foto()"></video>
        <div class="barra">
          <button type="button" class="sec" (click)="cerrar()"><mat-icon>close</mat-icon></button>
          @if (!foto()) {
            <button type="button" class="disparo" (click)="disparar()" aria-label="Tomar foto"><span></span></button>
            <button type="button" class="sec" (click)="girar()" title="Cambiar de cámara"><mat-icon>flip_camera_android</mat-icon></button>
          } @else {
            <button type="button" class="sec" (click)="repetir()"><mat-icon>replay</mat-icon> Repetir</button>
            <button type="button" class="ok" (click)="usar()"><mat-icon>send</mat-icon> Adjuntar</button>
          }
        </div>
      }
    </div>`,
  styles: [`
    .cam { position: relative; background: #000; width: min(720px, 100vw); height: min(560px, 100vh); display: flex;
      align-items: center; justify-content: center; }
    video, img { max-width: 100%; max-height: 100%; }
    .barra { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center;
      gap: 1.25rem; padding: 1rem; background: linear-gradient(transparent, rgba(0,0,0,.6)); }
    .disparo { width: 64px; height: 64px; border-radius: 50%; border: 4px solid #fff; background: transparent; cursor: pointer; padding: 4px; }
    .disparo span { display: block; width: 100%; height: 100%; border-radius: 50%; background: #fff; }
    .sec, .ok { display: inline-flex; align-items: center; gap: .35rem; border: 0; border-radius: 999px; padding: .55rem .9rem;
      cursor: pointer; font: inherit; background: rgba(255,255,255,.18); color: #fff; }
    .ok { background: var(--lime, #9BD441); color: #0F1B2D; font-weight: 700; }
    .error { color: #fff; text-align: center; padding: 2rem; }
  `],
})
export class CamaraDialog implements OnInit, OnDestroy {
  private readonly ref = inject(MatDialogRef<CamaraDialog, File | undefined>);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  readonly foto = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  private stream: MediaStream | null = null;
  private frente: 'environment' | 'user' = 'environment';
  private blob: Blob | null = null;

  ngOnInit(): void { void this.abrir(); }
  ngOnDestroy(): void { this.stream?.getTracks().forEach(t => t.stop()); }

  private async abrir(): Promise<void> {
    this.stream?.getTracks().forEach(t => t.stop());
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.frente, width: { ideal: 1920 } }, audio: false });
      setTimeout(() => { const v = this.video()?.nativeElement; if (v) v.srcObject = this.stream; });
    } catch {
      this.error.set('No se pudo abrir la cámara. Revisa el permiso del navegador.');
    }
  }

  girar(): void { this.frente = this.frente === 'environment' ? 'user' : 'environment'; void this.abrir(); }

  disparar(): void {
    const v = this.video()?.nativeElement;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    const escala = Math.min(1, 2000 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * escala);
    c.height = Math.round(v.videoHeight * escala);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(b => { this.blob = b; this.foto.set(b ? URL.createObjectURL(b) : null); }, 'image/jpeg', 0.88);
  }

  repetir(): void { this.foto.set(null); this.blob = null; }

  usar(): void {
    if (!this.blob) return;
    const nombre = `foto-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    this.ref.close(new File([this.blob], nombre, { type: 'image/jpeg' }));
  }

  cerrar(): void { this.ref.close(); }
}

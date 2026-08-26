
import {  Component, ElementRef, OnDestroy, OnInit, ViewChild, inject , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';

export type CameraDialogResult = { file: File; previewUrl: string };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-camera-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule
],
  templateUrl: './camera-dialog.component.html',
  styleUrl: './camera-dialog.component.css'
} )
export class CameraDialogComponent implements OnInit, OnDestroy {
  private dialogRef = inject(MatDialogRef<CameraDialogComponent>);
  private dialogData = inject(MAT_DIALOG_DATA, { optional: true }) as { initialPreviewUrl?: string | null } | null;
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('videoEl', { static: false }) videoEl?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasEl', { static: false }) canvasEl?: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput', { static: false }) fileInput?: ElementRef<HTMLInputElement>;

  stream?: MediaStream;
  loadingCamera = false;
  cameraError = '';
  facingMode: 'user' | 'environment' = 'user'; // Default 'user' para selfies
  /**
   * Espejo de la VISTA PREVIA. Apagado a propósito.
   *
   * El archivo se guarda siempre sin voltear —es una foto de identificación:
   * volteada, la cara sale al revés respecto a la cédula y el texto del fondo
   * se lee espejado—. Con la previa en espejo, la foto "cambiaba de lado" al
   * confirmarla y no se parecía a lo que la persona acababa de ver. Ahora lo
   * que se ve ES lo que se guarda; el espejo sigue disponible a mano
   * (`toggleMirror`) para quien lo prefiera para encuadrarse.
   */
  isMirror = false;
  isUploadMode = false; // Modo "Adjuntar" recuperado como estado

  previewUrl: string | null = null; // Para mostrar antes de confirmar
  capturedFile: File | null = null;

  async ngOnInit(): Promise<void> {
    // Precargar foto existente si llega (dataURL o http(s))
    await this.loadInitialPreview(this.dialogData?.initialPreviewUrl || null);

    const supportsCamera =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      (typeof window === 'undefined' || (window as any).isSecureContext !== false);

    if (supportsCamera) {
      if (!this.previewUrl) {
        try {
          await this.startCamera();
        } catch {
          this.cameraError = 'No fue posible acceder a la cámara. Puedes adjuntar una imagen.';
        }
      }
    } else {
      this.cameraError = 'La cámara no está disponible (permiso/HTTPS). Puedes adjuntar una imagen.';
    }
  }

  ngOnDestroy(): void {
    this.stopCamera();
    this.revokePreview();
  }

  private async loadInitialPreview(initial: string | null): Promise<void> {
    if (!initial) return;

    // 1) Si es dataURL, úsalo tal cual y crea File para permitir "Usar esta imagen"
    if (initial.startsWith('data:')) {
      this.previewUrl = initial;
      this.capturedFile = this.dataURLToFile(initial, 'foto-actual.png');
      this.cdr.markForCheck();
      return;
    }

    // 2) Intenta descargarla como blob -> File -> objectURL
    try {
      const resp = await fetch(initial, { mode: 'cors' });
      if (!resp.ok) throw new Error(String(resp.status));
      const blob = await resp.blob();
      const ext = blob.type === 'image/jpeg' ? 'jpg'
        : blob.type === 'image/png' ? 'png'
          : 'bin';
      const file = new File([blob], `foto-actual.${ext}`, { type: blob.type || 'application/octet-stream' });
      this.capturedFile = file;
      this.previewUrl = URL.createObjectURL(file);
    } catch {
      // Si CORS falla, al menos mostrar la URL directamente (no habrá File)
      this.capturedFile = null;
      this.previewUrl = initial;
    } finally {
      this.cdr.markForCheck();
    }
  }

  /**
   * Sesión de cámara: cada arranque la incrementa y `stopCamera` también.
   * `getUserMedia` puede resolver DESPUÉS de cerrar el diálogo (el prompt de
   * permiso o una cámara lenta): sin este guard, el stream que llega tarde no
   * lo detenía nadie y el LED quedaba encendido hasta reiniciar la app. Lo
   * mismo con doble clic rápido en "Cambiar cámara".
   */
  private camSesion = 0;

  async startCamera(): Promise<void> {
    this.loadingCamera = true;
    this.cameraError = '';
    this.stopCamera();
    const sesion = ++this.camSesion;

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (sesion !== this.camSesion) {
        // Llegó tarde (diálogo cerrado u otra cámara arrancando): apagarlo ya.
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      this.stream = stream;
      if (this.videoEl?.nativeElement) {
        const v = this.videoEl.nativeElement;
        v.srcObject = this.stream;
        await v.play().catch(() => { /* algunos navegadores requieren interacción */ });
      }
    } catch {
      if (sesion === this.camSesion) {
        this.cameraError = 'No fue posible acceder a la cámara. Puedes adjuntar una imagen.';
      }
    } finally {
      if (sesion === this.camSesion) {
        this.loadingCamera = false;
        this.cdr.markForCheck();
      }
    }
  }

  stopCamera(): void {
    // Invalida cualquier getUserMedia en vuelo (ver camSesion).
    this.camSesion++;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = undefined;
    }
    if (this.videoEl?.nativeElement) {
      this.videoEl.nativeElement.srcObject = null;
    }
  }

  async toggleFacing(): Promise<void> {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    // Ni siquiera en selfie: la previa tiene que enseñar la foto que se va a
    // guardar (ver `isMirror`).
    this.isMirror = false;
    await this.startCamera();
  }

  toggleMirror(): void {
    this.isMirror = !this.isMirror;
  }

  toggleUploadMode(): void {
    this.isUploadMode = !this.isUploadMode;
    if (this.isUploadMode) {
      this.stopCamera();
    } else {
      this.clearSelection(); // Limpia foto anterior
      this.startCamera();
    }
  }

  /**
   * Pasa a modo "Adjuntar" desde la previsualizacion y abre el selector de
   * archivos de una vez.
   *
   * El dialogo arranca mostrando la foto que ya tiene el candidato, y en ese
   * estado la unica barra visible era Repetir/Confirmar: para adjuntar habia
   * que adivinar que primero tocaba pulsar Repetir.
   */
  adjuntarDesdePreview(): void {
    this.stopCamera();
    this.isUploadMode = true;
    this.clearSelection();
    // Tras el render del input, abrir el explorador de archivos.
    setTimeout(() => this.fileInput?.nativeElement?.click(), 0);
  }

  capture(): void {
    if (!this.videoEl?.nativeElement || !this.canvasEl?.nativeElement) return;
    const video = this.videoEl.nativeElement;
    const canvas = this.canvasEl.nativeElement;

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Se guarda SIEMPRE la imagen real, sin espejo.
    //
    // `isMirror` voltea unicamente la vista previa (CSS .mirror sobre el
    // <video>), que es lo que ayuda a encuadrarse como en un espejo. El frame
    // que entrega el <video> ya viene sin voltear, asi que dibujarlo tal cual
    // produce la foto correcta.
    //
    // Antes se replicaba el volteo en el canvas y el ARCHIVO quedaba invertido:
    // en una foto de identificacion la cara sale al reves respecto a la cedula,
    // y cualquier texto del fondo se lee espejado.
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const ts = new Date().toISOString().replace(/[:.]/g, '');
      const file = new File([blob], `foto-${ts}.png`, { type: blob.type || 'image/png' });
      this.setPreviewFile(file);
    }, 'image/png', 0.92);
  }

  onFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.setPreviewFile(file);
  }

  clearSelection(): void {
    this.capturedFile = null;
    this.revokePreview();
    this.previewUrl = null;
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
    // Si no es modo subida, reactivar cámara
    if (!this.isUploadMode) {
      this.startCamera();
    }
    this.cdr.markForCheck();
  }

  confirm(): void {
    if (!this.capturedFile || !this.previewUrl) return; // exige archivo para “Usar esta imagen”
    this.stopCamera();
    this.dialogRef.close({ file: this.capturedFile, previewUrl: this.previewUrl } satisfies CameraDialogResult);
  }

  cancel(): void {
    this.stopCamera();
    this.dialogRef.close(undefined);
  }

  private setPreviewFile(file: File): void {
    this.revokePreview();
    this.capturedFile = file;
    this.previewUrl = URL.createObjectURL(file);
    this.cdr.markForCheck();
  }

  private revokePreview(): void {
    if (this.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.previewUrl);
    }
  }

  private dataURLToFile(dataUrl: string, filename: string): File {
    const [meta, base64] = dataUrl.split(',');
    const mimeMatch = meta.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binStr = atob(base64 || '');
    const len = binStr.length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = binStr.charCodeAt(i);
    return new File([u8], filename, { type: mime });
  }
}

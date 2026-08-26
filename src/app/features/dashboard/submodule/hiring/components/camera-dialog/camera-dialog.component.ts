
import {  Component, ElementRef, OnDestroy, OnInit, ViewChild, inject , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { DeteccionRostroService } from '../../service/rostro/deteccion-rostro.service';

export type CameraDialogResult = { file: File; previewUrl: string };

/** Pasos de la comprobación de que hay una persona delante. */
export type PasoRostro =
  /** Cargando el detector. */
  | 'cargando'
  /** El detector no está disponible: se deja tomar la foto sin validar. */
  | 'sin-validador'
  | 'buscando'
  | 'acercate'
  | 'parpadea'
  | 'listo';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-camera-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    // El `matTooltip` del obturador dice POR QUÉ está esperando; sin el módulo
    // el binding ni siquiera compila.
    MatTooltipModule
],
  templateUrl: './camera-dialog.component.html',
  styleUrl: './camera-dialog.component.css'
} )
export class CameraDialogComponent implements OnInit, OnDestroy {
  private dialogRef = inject(MatDialogRef<CameraDialogComponent>);
  private dialogData = inject(MAT_DIALOG_DATA, { optional: true }) as { initialPreviewUrl?: string | null } | null;
  private cdr = inject(ChangeDetectorRef);
  private rostro = inject(DeteccionRostroService);

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

  // ══════════════════════════════════════════════════════════════════════
  // ¿HAY UNA PERSONA DELANTE?
  //
  // Antes se podía fotografiar una cédula, una pantalla o una silla vacía y
  // quedaba como foto de perfil. Se piden dos cosas que una foto impresa no
  // puede hacer: acercarse y parpadear. Todo ocurre en el equipo (MediaPipe
  // sobre wasm); la cara no viaja a ningún lado.
  //
  // Si el detector no carga, el paso queda en 'sin-validador' y el obturador
  // sigue habilitado: esto no puede dejar a nadie sin poder tomar la foto.
  // ══════════════════════════════════════════════════════════════════════

  /** La cara tiene que ocupar esta fracción del alto del cuadro. */
  private static readonly CERCA = 0.42;
  /** Ojo cerrado / ojo abierto: dos umbrales para no contar medio parpadeo. */
  private static readonly OJO_CERRADO = 0.5;
  private static readonly OJO_ABIERTO = 0.2;

  pasoRostro: PasoRostro = 'cargando';
  /** Qué tan cerca está, 0..1, para la barra de la guía. */
  cercania = 0;

  private rafId = 0;
  private ojosCerrados = false;
  private parpadeoHecho = false;

  /** ¿Se puede disparar la foto? */
  get puedeCapturar(): boolean {
    return this.pasoRostro === 'listo' || this.pasoRostro === 'sin-validador';
  }

  /** El texto de la guía. Dice SIEMPRE qué hacer ahora, no qué falló. */
  get mensajeRostro(): string {
    switch (this.pasoRostro) {
      case 'cargando': return 'Preparando la cámara…';
      case 'buscando': return 'Ubica la cara dentro del óvalo';
      case 'acercate': return 'Acércate un poco más';
      case 'parpadea': return 'Ahora parpadea';
      case 'listo': return '¡Listo! Toma la foto';
      default: return '';
    }
  }

  /** Arranca el detector y el bucle de lectura. */
  private async iniciarValidacion(): Promise<void> {
    this.pasoRostro = 'cargando';
    this.cdr.markForCheck();

    const ok = await this.rostro.iniciar();
    if (!ok) {
      this.pasoRostro = 'sin-validador';
      this.cdr.markForCheck();
      return;
    }
    this.reiniciarValidacion();
    this.bucle();
  }

  /** Vuelve a pedir cara + parpadeo (cambio de cámara, repetir foto). */
  private reiniciarValidacion(): void {
    if (this.pasoRostro === 'sin-validador') return;
    this.pasoRostro = 'buscando';
    this.cercania = 0;
    this.ojosCerrados = false;
    this.parpadeoHecho = false;
  }

  private detenerValidacion(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private bucle = (): void => {
    this.rafId = requestAnimationFrame(this.bucle);

    const video = this.videoEl?.nativeElement;
    // Con la previa en pantalla el vídeo está oculto: no hay nada que leer.
    if (!video || this.previewUrl || this.isUploadMode || !this.stream) return;

    const lectura = this.rostro.leer(video, performance.now());
    if (!lectura) return;

    const antes = this.pasoRostro;
    const cercaAntes = this.cercania;

    if (!lectura.hayCara) {
      this.cercania = 0;
      this.ojosCerrados = false;
      // Se pierde el avance a propósito: si la cara se fue, lo que venga
      // después puede ser otra persona.
      this.parpadeoHecho = false;
      this.pasoRostro = 'buscando';
    } else {
      this.cercania = Math.min(1, lectura.ocupacion / CameraDialogComponent.CERCA);
      const cerca = lectura.ocupacion >= CameraDialogComponent.CERCA;

      if (!cerca) {
        this.pasoRostro = 'acercate';
      } else {
        // Parpadeo = los dos ojos se cierran y se vuelven a abrir. Exigir los
        // dos evita contar un guiño o una sombra sobre un ojo.
        const cerrados = lectura.ojoIzq > CameraDialogComponent.OJO_CERRADO
                      && lectura.ojoDer > CameraDialogComponent.OJO_CERRADO;
        const abiertos = lectura.ojoIzq < CameraDialogComponent.OJO_ABIERTO
                      && lectura.ojoDer < CameraDialogComponent.OJO_ABIERTO;

        if (cerrados) this.ojosCerrados = true;
        else if (abiertos && this.ojosCerrados) {
          this.ojosCerrados = false;
          this.parpadeoHecho = true;
        }

        // 'listo' solo con los ojos ABIERTOS: si no, la foto sale pestañeando.
        this.pasoRostro = this.parpadeoHecho && abiertos ? 'listo' : 'parpadea';
      }
    }

    if (antes !== this.pasoRostro || Math.abs(cercaAntes - this.cercania) > 0.02) {
      this.cdr.markForCheck();
    }
  };

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
          // El detector se carga en paralelo: pesa, y la cámara no debe
          // esperarlo para encenderse.
          void this.iniciarValidacion();
        } catch {
          this.cameraError = 'No fue posible acceder a la cámara. Puedes adjuntar una imagen.';
        }
      }
    } else {
      this.cameraError = 'La cámara no está disponible (permiso/HTTPS). Puedes adjuntar una imagen.';
    }
  }

  ngOnDestroy(): void {
    this.detenerValidacion();
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
    this.reiniciarValidacion();
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
    if (!this.puedeCapturar) return;
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
      // Repetir la foto vuelve a exigir cara y parpadeo: si no, la segunda
      // toma se colaría con la validación de la primera.
      this.reiniciarValidacion();
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

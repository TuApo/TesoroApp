
import {  Component, ElementRef, OnDestroy, OnInit, ViewChild, inject , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Subscription } from 'rxjs';

import { DeteccionRostroService, LecturaRostro } from '../../service/rostro/deteccion-rostro.service';
import { FotoDocumentoService, FotoProcesada } from '../../service/rostro/foto-documento.service';
import { CajaRostro, TEXTO_AVISO, espejarCaja } from '../../service/rostro/foto-documento.util';
import { ValidacionFotoIa, ValidacionFotoIaService } from '../../service/rostro/validacion-foto-ia.service';

export type CameraDialogResult = { file: File; previewUrl: string };

/** Lo que puede recibir el diálogo. Todo opcional. */
export interface CameraDialogData {
  /** Foto que ya tiene la persona: se muestra al abrir. */
  initialPreviewUrl?: string | null;
  /** Cédula de la persona: solo viaja a la verificación por IA, para el registro. */
  numeroDocumento?: string | null;
  /**
   * `false` = foto LIBRE: sin recorte, sin fondo blanco y sin IA (el fotograma
   * tal cual, como antes). Por defecto es foto tipo documento.
   */
  fotoDocumento?: boolean;
}

/** Qué está pasando con la foto. */
export type FaseFoto =
  /** Cámara (o selector de archivo) a la espera. */
  | 'captura'
  /** Recortando, poniendo el fondo blanco. */
  | 'procesando'
  /** Foto en pantalla para aprobarla o repetirla. */
  | 'revision';

/** Veredicto de la IA sobre la foto en pantalla. */
export type EstadoIa =
  /** La foto no pasó por la IA (la que ya tenía la persona, o foto libre). */
  | 'nada'
  | 'verificando'
  | 'apta'
  | 'no-apta'
  /** La IA no respondió: se puede continuar, con los chequeos locales como guía. */
  | 'sin-ia';

/** Pasos de la comprobación de que hay una persona delante. */
export type PasoRostro =
  /** Cargando el detector. */
  | 'cargando'
  /** El detector no está disponible: se deja tomar la foto sin validar. */
  | 'sin-validador'
  | 'buscando'
  | 'acercate'
  | 'alejate'
  | 'centra'
  | 'frente'
  | 'parpadea'
  /** Todo en orden: la cuenta atrás del disparo automático está corriendo. */
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
    MatTooltipModule,
    // La foto en revisión es la misma pieza para la cámara y el adjunto.
    NgTemplateOutlet,
],
  templateUrl: './camera-dialog.component.html',
  styleUrl: './camera-dialog.component.css'
} )
export class CameraDialogComponent implements OnInit, OnDestroy {
  private dialogRef = inject(MatDialogRef<CameraDialogComponent>);
  private dialogData = inject(MAT_DIALOG_DATA, { optional: true }) as CameraDialogData | null;
  private cdr = inject(ChangeDetectorRef);
  private rostro = inject(DeteccionRostroService);
  private fotoDoc = inject(FotoDocumentoService);
  private validadorIa = inject(ValidacionFotoIaService);

  @ViewChild('videoEl', { static: false }) videoEl?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasEl', { static: false }) canvasEl?: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput', { static: false }) fileInput?: ElementRef<HTMLInputElement>;
  /** El óvalo de la guía: es contra ÉL contra lo que se mide el encuadre. */
  @ViewChild('ovaloEl', { static: false }) ovaloEl?: ElementRef<HTMLElement>;

  stream?: MediaStream;
  loadingCamera = false;
  cameraError = '';
  facingMode: 'user' | 'environment' = 'user'; // Default 'user' para selfies
  /**
   * Espejo. Se aplica A LA VEZ a la previa y al archivo, nunca a uno solo:
   * lo que se ve ES lo que se guarda. Cuando solo volteaba la previa, la foto
   * "cambiaba de lado" al confirmarla y no se parecía a lo que la persona
   * acababa de ver.
   *
   * Encendido para la cámara frontal, que es como la entregan los equipos con
   * los que se usa esto: sin voltearla, la foto salía invertida respecto a la
   * persona. La trasera no lo necesita —esa no espeja nada— y por eso
   * `toggleFacing` lo recalcula en vez de fijarlo.
   *
   * Contrapartida asumida: en una foto espejada el texto que haya de fondo se
   * lee al revés. El botón de la barra lo apaga para quien lo necesite crudo.
   */
  isMirror = true;
  isUploadMode = false; // Modo "Adjuntar" recuperado como estado

  previewUrl: string | null = null; // Para mostrar antes de confirmar
  capturedFile: File | null = null;

  // ══════════════════════════════════════════════════════════════════════
  // ¿HAY UNA PERSONA DELANTE?
  //
  // Antes se podía fotografiar una cédula, una pantalla o una silla vacía y
  // quedaba como foto de perfil. Se piden cuatro cosas: caber en el óvalo,
  // estar centrado, mirar de frente y parpadear —lo último, algo que una foto
  // impresa no puede hacer—. Todo ocurre en el equipo (MediaPipe sobre wasm);
  // la cara no viaja a ningún lado.
  //
  // Cuando las cuatro se cumplen la foto se toma SOLA, tras una cuenta atrás
  // corta que se cancela si la persona se mueve. Después se revisa y se
  // confirma o se repite: nadie se queda con una foto que no aprobó.
  //
  // Si el detector no carga, el paso queda en 'sin-validador' y el obturador
  // sigue habilitado: esto no puede dejar a nadie sin poder tomar la foto.
  // ══════════════════════════════════════════════════════════════════════

  /** Alto de la cara respecto al del óvalo: fuera de este rango, no encuadra. */
  private static readonly LLENADO_MIN = 0.52;
  private static readonly LLENADO_MAX = 0.95;
  /** Desvío tolerado del centro de la cara, en fracción del óvalo. */
  private static readonly DESVIO_X = 0.20;
  private static readonly DESVIO_Y = 0.18;
  /** De frente: giro de la cabeza (0 frontal, ±1 perfil) e inclinación en grados. */
  private static readonly GIRO_MAX = 0.30;
  private static readonly INCLINACION_MAX = 15;
  /** Ojo cerrado / ojo abierto: dos umbrales para no contar medio parpadeo. */
  private static readonly OJO_CERRADO = 0.5;
  private static readonly OJO_ABIERTO = 0.2;
  /** Cuenta atrás del disparo automático: tres números de medio segundo. */
  private static readonly CUENTA_MS = 1500;
  /**
   * Respaldo cuando el óvalo todavía no está pintado: el criterio de antes,
   * el alto de la cara sobre el alto del cuadro.
   */
  private static readonly CERCA = 0.42;

  pasoRostro: PasoRostro = 'cargando';
  /** Qué tan cerca está, 0..1, para la barra de la guía. */
  cercania = 0;
  /** Cuenta atrás visible del disparo automático (3..1; 0 = sin disparo armado). */
  cuenta = 0;
  /** La foto en pantalla salió de una cara viva, con su parpadeo comprobado. */
  personaVerificada = false;

  private rafId = 0;
  private ojosCerrados = false;
  private parpadeoHecho = false;
  /** Momento en que toca disparar. 0 = no hay disparo armado. */
  private disparoEn = 0;
  /**
   * El disparo ya salió y el PNG se está codificando. Sin esto el bucle
   * seguiría corriendo durante esos milisegundos y dispararía varias veces.
   */
  private capturaEnCurso = false;
  /**
   * La última lectura del detector. Su caja es de donde sale el recorte de la
   * foto: el disparo ocurre en el mismo fotograma (o el siguiente) que se leyó.
   */
  private ultimaLectura: LecturaRostro | null = null;

  // ══════════════════════════════════════════════════════════════════════
  // FOTO TIPO DOCUMENTO (pedidos #4 y #5 del 24-sep)
  //
  // Tras el disparo —o al elegir un archivo— la foto se RECORTA 3:4 alrededor
  // de la cara, se mide su luz y su nitidez, se pone sobre FONDO BLANCO y sale
  // en JPEG 600×800. Después la revisa la IA de visión: si dice que no sirve,
  // Confirmar queda apagado y se explica por qué; si no contesta, se avisa y
  // se deja continuar —una IA caída no puede dejar a nadie sin foto—.
  //
  // "que la IA confirme de que quedó bien y ya puede continuar"
  // ══════════════════════════════════════════════════════════════════════

  fase: FaseFoto = 'captura';
  /** Qué se está haciendo mientras `fase === 'procesando'`. */
  pasoProceso = '';
  /** La foto procesada en pantalla; null = foto que no pasó por aquí (la que ya tenía). */
  procesada: FotoProcesada | null = null;
  /** Comparar: mostrar el recorte ANTES del fondo blanco. */
  verAntes = false;
  estadoIa: EstadoIa = 'nada';
  ia: ValidacionFotoIa | null = null;
  /** Error que impide usar la foto (p. ej., un adjunto sin cara). */
  errorFoto = '';

  /**
   * Cada foto nueva (o "Repetir") incrementa la sesión. Lo asíncrono —el
   * procesado, la respuesta de la IA— comprueba que sigue siendo la suya antes
   * de pintar: sin esto, la respuesta tardía de la foto anterior aprobaba la
   * que la persona acababa de repetir.
   */
  private sesionFoto = 0;
  private iaSub?: Subscription;

  /** Foto tipo documento (recorte + fondo + IA) o foto libre. */
  private get modoDocumento(): boolean {
    return this.dialogData?.fotoDocumento !== false;
  }

  /** La imagen que se ve en la revisión: el antes o el después. */
  get imagenVisible(): string | null {
    return this.verAntes && this.procesada?.urlAntes ? this.procesada.urlAntes : this.previewUrl;
  }

  /**
   * Confirmar exige que la IA la apruebe —o que la IA no haya podido opinar—.
   * La foto que ya tenía la persona (sin procesar) se confirma como siempre.
   */
  get puedeConfirmar(): boolean {
    if (!this.capturedFile || !this.previewUrl || this.fase === 'procesando') return false;
    if (!this.procesada) return true;
    return this.estadoIa === 'apta' || this.estadoIa === 'sin-ia';
  }

  /** Por qué Confirmar está apagado (tooltip). */
  get motivoSinConfirmar(): string {
    if (this.estadoIa === 'verificando') return 'Esperando la verificación con IA…';
    if (this.estadoIa === 'no-apta') return 'La IA indicó que la foto no sirve: vuelve a tomarla';
    return '';
  }

  /** Avisos de luz y nitidez medidos en el equipo, ya en palabras. */
  get avisosLocales(): string[] {
    const p = this.procesada;
    if (!p) return [];
    const avisos = p.calidad.avisos.map((a) => TEXTO_AVISO[a]);
    if (p.fondo !== 'aplicado') avisos.push('No se pudo poner el fondo blanco');
    return avisos;
  }

  /** ¿Se muestran los avisos locales? Con la IA aprobando, solo confundirían. */
  get mostrarAvisosLocales(): boolean {
    return this.estadoIa !== 'apta' && this.avisosLocales.length > 0;
  }

  /** ¿Se puede disparar la foto a mano? */
  get puedeCapturar(): boolean {
    return this.pasoRostro === 'listo' || this.pasoRostro === 'sin-validador';
  }

  /** El texto de la guía. Dice SIEMPRE qué hacer ahora, no qué falló. */
  get mensajeRostro(): string {
    switch (this.pasoRostro) {
      case 'cargando': return 'Preparando la cámara…';
      case 'buscando': return 'Ubica la cara dentro del óvalo';
      case 'acercate': return 'Acércate un poco más';
      case 'alejate': return 'Aléjate un poco';
      case 'centra': return 'Centra la cara en el óvalo';
      case 'frente': return 'Mira de frente a la cámara';
      case 'parpadea': return 'Ahora parpadea';
      case 'listo': return this.cuenta > 0 ? 'No te muevas…' : '¡Listo!';
      default: return '';
    }
  }

  /** El detector y su bucle ya se arrancaron (una sola vez por diálogo). */
  private validacionArrancada = false;

  /**
   * Arranca la validación si todavía no corre; si ya corre, la reinicia.
   *
   * Hacía falta porque el diálogo que ABRE con la foto que ya tenía la persona
   * no enciende la cámara ni el detector, y "Repetir" solo reiniciaba un bucle
   * que nunca había arrancado: la guía se quedaba en "Ubica la cara" y el
   * obturador apagado para siempre.
   */
  private asegurarValidacion(): void {
    if (this.validacionArrancada) {
      this.reiniciarValidacion();
      return;
    }
    this.validacionArrancada = true;
    // El del fondo blanco (16 MB) va DESPUÉS del detector, no a la vez: los dos
    // compiten por la misma CPU y el que hace falta primero es el de la guía.
    void this.iniciarValidacion().then(() => {
      if (this.modoDocumento) this.fotoDoc.precargar();
    });
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

  /** Vuelve a pedir encuadre + parpadeo (cambio de cámara, repetir foto). */
  private reiniciarValidacion(): void {
    if (this.pasoRostro === 'sin-validador') return;
    this.pasoRostro = 'buscando';
    this.cercania = 0;
    this.ojosCerrados = false;
    this.parpadeoHecho = false;
    this.desarmar();
  }

  private detenerValidacion(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Cancela la cuenta atrás del disparo automático. */
  private desarmar(): void {
    this.disparoEn = 0;
    this.cuenta = 0;
  }

  private bucle = (): void => {
    this.rafId = requestAnimationFrame(this.bucle);

    const video = this.videoEl?.nativeElement;
    // Con la previa en pantalla el vídeo está oculto: no hay nada que leer.
    if (!video || this.previewUrl || this.isUploadMode || !this.stream) return;
    // El disparo ya salió y el archivo se está armando: no dispares otra vez.
    if (this.capturaEnCurso) return;

    const ahora = performance.now();
    const lectura = this.rostro.leer(video, ahora);
    if (!lectura) return;
    this.ultimaLectura = lectura;

    const antes = this.pasoRostro;
    const cercaAntes = this.cercania;
    const cuentaAntes = this.cuenta;

    if (!lectura.hayCara) {
      this.cercania = 0;
      this.ojosCerrados = false;
      // Se pierde el avance a propósito: si la cara se fue, lo que venga
      // después puede ser otra persona.
      this.parpadeoHecho = false;
      this.desarmar();
      this.pasoRostro = 'buscando';
    } else {
      const encuadre = this.medirEncuadre(video, lectura);
      this.cercania = encuadre.avance;

      if (encuadre.motivo) {
        // Se movió: el parpadeo ya hecho se conserva —la persona sigue ahí—,
        // pero el disparo armado se cancela y hay que volver a estar quieto.
        //
        // Los ojos solo se leen con la cara BIEN encuadrada: de lejos o de
        // perfil los blendshapes del párpado son ruido y colarían parpadeos
        // que nadie hizo.
        this.ojosCerrados = false;
        this.desarmar();
        this.pasoRostro = encuadre.motivo;
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

        // Se dispara solo con los ojos ABIERTOS: si no, la foto sale
        // pestañeando —y encima justo después del parpadeo que se pidió—.
        if (!this.parpadeoHecho || !abiertos) {
          this.desarmar();
          this.pasoRostro = 'parpadea';
        } else {
          this.pasoRostro = 'listo';
          if (!this.disparoEn) this.disparoEn = ahora + CameraDialogComponent.CUENTA_MS;

          const falta = this.disparoEn - ahora;
          if (falta <= 0) {
            this.cuenta = 0;
            this.tomarFoto();
            this.cdr.markForCheck();
            return;
          }
          this.cuenta = Math.ceil(falta / (CameraDialogComponent.CUENTA_MS / 3));
        }
      }
    }

    if (antes !== this.pasoRostro
      || cuentaAntes !== this.cuenta
      || Math.abs(cercaAntes - this.cercania) > 0.02) {
      this.cdr.markForCheck();
    }
  };

  /**
   * ¿La cara CABE, centrada y de frente, en el óvalo que se ve en pantalla?
   *
   * El óvalo es HTML y los puntos del detector vienen normalizados al
   * fotograma del vídeo, que se pinta con `object-fit: cover` —o sea,
   * recortado— y a veces en espejo. Hay que llevar la caja de la cara a
   * coordenadas de pantalla antes de compararla con el óvalo; medir contra el
   * fotograma, como se hacía antes, pedía acercarse mucho más de lo que el
   * óvalo daba a entender.
   */
  private medirEncuadre(
    video: HTMLVideoElement,
    lectura: LecturaRostro,
  ): { motivo: PasoRostro | null; avance: number } {
    const ovalo = this.ovaloEl?.nativeElement;
    const anchoVideo = video.videoWidth;
    const altoVideo = video.videoHeight;
    const cajaVideo = video.getBoundingClientRect();
    const cajaOvalo = ovalo?.getBoundingClientRect();

    // Todavía sin óvalo pintado o sin medidas del vídeo: el criterio de antes.
    if (!cajaOvalo?.height || !anchoVideo || !altoVideo || !cajaVideo.width) {
      const avance = Math.min(1, lectura.alto / CameraDialogComponent.CERCA);
      return { motivo: avance < 1 ? 'acercate' : null, avance };
    }

    // `object-fit: cover` escala el fotograma por el MAYOR de los dos factores
    // y recorta por igual a los dos lados lo que sobra.
    const escala = Math.max(cajaVideo.width / anchoVideo, cajaVideo.height / altoVideo);
    const anchoPintado = anchoVideo * escala;
    const altoPintado = altoVideo * escala;
    const izquierda = cajaVideo.left + (cajaVideo.width - anchoPintado) / 2;
    const arriba = cajaVideo.top + (cajaVideo.height - altoPintado) / 2;

    const x = izquierda + (this.isMirror ? 1 - lectura.centroX : lectura.centroX) * anchoPintado;
    const y = arriba + lectura.centroY * altoPintado;

    const llenado = (lectura.alto * altoPintado) / cajaOvalo.height;
    const desvioX = Math.abs(x - (cajaOvalo.left + cajaOvalo.width / 2)) / cajaOvalo.width;
    const desvioY = Math.abs(y - (cajaOvalo.top + cajaOvalo.height / 2)) / cajaOvalo.height;

    let motivo: PasoRostro | null = null;
    if (llenado < CameraDialogComponent.LLENADO_MIN) motivo = 'acercate';
    else if (llenado > CameraDialogComponent.LLENADO_MAX) motivo = 'alejate';
    else if (desvioX > CameraDialogComponent.DESVIO_X
          || desvioY > CameraDialogComponent.DESVIO_Y) motivo = 'centra';
    else if (Math.abs(lectura.giro) > CameraDialogComponent.GIRO_MAX
          || Math.abs(lectura.inclinacion) > CameraDialogComponent.INCLINACION_MAX) motivo = 'frente';

    return { motivo, avance: Math.min(1, llenado / CameraDialogComponent.LLENADO_MIN) };
  }

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
          this.asegurarValidacion();
        } catch {
          this.cameraError = 'No fue posible acceder a la cámara. Puedes adjuntar una imagen.';
        }
      }
    } else {
      this.cameraError = 'La cámara no está disponible (permiso/HTTPS). Puedes adjuntar una imagen.';
    }
  }

  ngOnDestroy(): void {
    // Lo que siga en vuelo (procesado, IA) ya no pinta nada ni deja URLs vivas.
    this.sesionFoto++;
    this.detenerValidacion();
    this.stopCamera();
    this.descartarProcesado();
    this.revokePreview();
  }

  private async loadInitialPreview(initial: string | null): Promise<void> {
    if (!initial) return;

    // La foto que ya tenía el candidato no la validó esta cámara: no se puede
    // decir de ella que haya un parpadeo detrás.
    this.personaVerificada = false;

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
    // Solo la frontal llega espejada; la trasera enseña la escena tal cual y
    // voltearla la estropearía (ver `isMirror`).
    this.isMirror = this.facingMode === 'user';
    await this.startCamera();
    this.reiniciarValidacion();
  }

  /**
   * Voltea previa y archivo a la vez. Existia y no lo llamaba nadie: ahora
   * tiene boton, porque no todas las camaras espejan y la unica forma de
   * saberlo es mirarse en la pantalla.
   */
  toggleMirror(): void {
    this.isMirror = !this.isMirror;
    this.cdr.markForCheck();
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

  /**
   * El obturador de siempre. Ya no es el camino normal —la foto se toma sola—
   * pero sigue ahí para quien no quiera esperar la cuenta atrás, y es el único
   * disparo posible cuando el detector no está disponible.
   */
  capture(): void {
    if (!this.puedeCapturar) return;
    this.tomarFoto();
  }

  /** Dispara. Lo llaman el obturador y la cuenta atrás al llegar a cero. */
  private tomarFoto(): void {
    if (this.capturaEnCurso) return;
    if (!this.videoEl?.nativeElement || !this.canvasEl?.nativeElement) return;
    const video = this.videoEl.nativeElement;
    const canvas = this.canvasEl.nativeElement;

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.capturaEnCurso = true;
    this.desarmar();

    // Se lee AQUÍ, no en el callback del blob: para entonces el bucle ya pudo
    // cambiar de paso. Con 'sin-validador' no hubo detector y no hay parpadeo
    // que afirmar; decir lo contrario sería mentir en la pantalla de revisión.
    const verificada = this.parpadeoHecho && this.pasoRostro !== 'sin-validador';

    // El archivo se voltea EXACTAMENTE igual que la previa.
    //
    // `isMirror` pone `transform: scaleX(-1)` sobre el <video>, y eso es puro
    // CSS: `drawImage` recibe el fotograma crudo y no se entera. Sin replicar
    // aqui el volteo, la foto salia del lado contrario al que la persona
    // acababa de aprobar en pantalla.
    if (this.isMirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);

    if (this.modoDocumento) {
      // La caja viene del fotograma CRUDO; si la foto va en espejo, la caja
      // también. Sin lectura con cara (detector no disponible) → recorte
      // centrado, y que decida la IA.
      const l = this.ultimaLectura;
      const caja: CajaRostro | null = l?.hayCara && l.caja
        ? (this.isMirror ? espejarCaja(l.caja) : l.caja)
        : null;
      this.personaVerificada = verificada;
      void this.procesar(canvas, caja, ++this.sesionFoto);
      return;
    }

    // Foto libre: el fotograma tal cual, como siempre.
    canvas.toBlob((blob) => {
      if (!blob) {
        // Sin archivo no hay nada que revisar: devolver la cámara al bucle.
        this.capturaEnCurso = false;
        this.cdr.markForCheck();
        return;
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '');
      const file = new File([blob], `foto-${ts}.png`, { type: blob.type || 'image/png' });
      this.personaVerificada = verificada;
      this.setPreviewFile(file);
    }, 'image/png', 0.92);
  }

  /**
   * "Adjuntar": la imagen pasa por lo mismo que la foto de la cámara. Antes
   * se aceptaba cualquier imagen —una cédula, un paisaje— como foto de perfil.
   * Ahora se busca la cara (detector en modo IMAGE) y, si no hay, se dice.
   */
  async onFileSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // Un archivo del disco no pasó por la cámara: nadie parpadeó delante.
    this.personaVerificada = false;
    if (!this.modoDocumento) {
      this.setPreviewFile(file);
      return;
    }

    const sesion = ++this.sesionFoto;
    this.errorFoto = '';
    this.fase = 'procesando';
    this.pasoProceso = 'Buscando el rostro…';
    this.cdr.markForCheck();

    let lienzo: HTMLCanvasElement;
    try {
      lienzo = await this.fotoDoc.cargarArchivo(file);
    } catch {
      return this.fallarAdjunto(sesion, 'No se pudo abrir la imagen. Prueba con otra en JPG o PNG.');
    }
    const det = await this.rostro.detectarEnImagen(lienzo);
    if (sesion !== this.sesionFoto) return;
    // det === null: no hay detector. No se bloquea: recorte centrado y la IA decide.
    if (det && det.caras === 0) {
      return this.fallarAdjunto(sesion,
        'No se encontró un rostro en la imagen. Elige una foto donde se vea la cara de frente.');
    }
    if (det && det.caras > 1) {
      return this.fallarAdjunto(sesion,
        'En la imagen hay más de una persona. Elige una foto donde salga solo quien se va a registrar.');
    }
    await this.procesar(lienzo, det?.caja ?? null, sesion);
  }

  private fallarAdjunto(sesion: number, mensaje: string): void {
    if (sesion !== this.sesionFoto) return;
    this.fase = 'captura';
    this.errorFoto = mensaje;
    if (this.fileInput?.nativeElement) this.fileInput.nativeElement.value = '';
    this.cdr.markForCheck();
  }

  /**
   * Recorte → calidad → fondo blanco → JPEG, y después la IA. Si algo del
   * procesado falla (navegador sin canvas, memoria), se dice y se vuelve a la
   * cámara: no se entrega una foto a medias.
   */
  private async procesar(fuente: HTMLCanvasElement, caja: CajaRostro | null, sesion: number): Promise<void> {
    this.capturaEnCurso = true;
    this.errorFoto = '';
    this.fase = 'procesando';
    this.pasoProceso = 'Recortando la foto…';
    this.cdr.markForCheck();

    let r: FotoProcesada;
    try {
      r = await this.fotoDoc.procesar(fuente, caja, (paso) => {
        if (sesion !== this.sesionFoto) return;
        this.pasoProceso = paso;
        this.cdr.markForCheck();
      });
    } catch (e) {
      console.warn('[camara] No se pudo preparar la foto:', e);
      if (sesion !== this.sesionFoto) return;
      this.fase = 'captura';
      this.capturaEnCurso = false;
      this.errorFoto = 'No se pudo preparar la foto. Intenta de nuevo.';
      this.cdr.markForCheck();
      return;
    }

    if (sesion !== this.sesionFoto) {
      // Se repitió o se cerró mientras tanto: esta foto ya no es de nadie.
      URL.revokeObjectURL(r.urlDespues);
      if (r.urlAntes) URL.revokeObjectURL(r.urlAntes);
      return;
    }

    this.descartarProcesado();
    this.procesada = r;
    this.verAntes = false;
    this.setPreviewFile(r.archivo, r.urlDespues);
    this.fase = 'revision';
    this.verificarConIa(r.dataUrl, sesion);
  }

  private verificarConIa(dataUrl: string, sesion: number): void {
    this.iaSub?.unsubscribe();
    this.ia = null;
    this.estadoIa = 'verificando';
    this.cdr.markForCheck();
    this.iaSub = this.validadorIa
      .validar(dataUrl, this.dialogData?.numeroDocumento ?? null)
      .subscribe((res) => {
        if (sesion !== this.sesionFoto) return;
        this.ia = res;
        this.estadoIa = !res.disponible || res.apta === null ? 'sin-ia' : res.apta ? 'apta' : 'no-apta';
        this.cdr.markForCheck();
      });
  }

  /** Suelta la foto procesada: la verificación en vuelo y la URL del "antes". */
  private descartarProcesado(): void {
    this.iaSub?.unsubscribe();
    this.iaSub = undefined;
    if (this.procesada?.urlAntes) URL.revokeObjectURL(this.procesada.urlAntes);
    // La URL del "después" es `previewUrl`: la revoca revokePreview().
    this.procesada = null;
    this.ia = null;
    this.estadoIa = 'nada';
    this.verAntes = false;
  }

  clearSelection(): void {
    // Invalida lo que esté en vuelo (procesado, IA) de la foto anterior.
    this.sesionFoto++;
    this.descartarProcesado();
    this.fase = 'captura';
    this.errorFoto = '';
    this.capturedFile = null;
    this.revokePreview();
    this.previewUrl = null;
    this.personaVerificada = false;
    this.capturaEnCurso = false;
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
    // Si no es modo subida, reactivar cámara
    if (!this.isUploadMode) {
      this.startCamera();
      // Repetir la foto vuelve a exigir encuadre y parpadeo: si no, la segunda
      // toma se colaría con la validación de la primera —y se dispararía sola
      // en el acto, sin dar tiempo ni a recolocarse—. Si el diálogo abrió con
      // la foto anterior, aquí es donde arranca el detector por primera vez.
      this.asegurarValidacion();
    }
    this.cdr.markForCheck();
  }

  confirm(): void {
    // Exige archivo para "Usar esta imagen" y, si la foto es nueva, que la IA
    // la haya aprobado (o que no haya podido opinar).
    if (!this.puedeConfirmar || !this.capturedFile || !this.previewUrl) return;
    this.stopCamera();
    this.dialogRef.close({ file: this.capturedFile, previewUrl: this.previewUrl } satisfies CameraDialogResult);
  }

  cancel(): void {
    this.sesionFoto++;
    this.stopCamera();
    this.dialogRef.close(undefined);
  }

  /** Cambia la vista de la revisión entre el recorte original y el de fondo blanco. */
  mostrarAntes(antes: boolean): void {
    this.verAntes = antes;
    this.cdr.markForCheck();
  }

  private setPreviewFile(file: File, url?: string): void {
    this.revokePreview();
    this.capturedFile = file;
    this.previewUrl = url ?? URL.createObjectURL(file);
    this.capturaEnCurso = false;
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

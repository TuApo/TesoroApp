import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Inject,
  OnDestroy,
  Output,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/** Cámara disponible, tal como la nombra el sistema. */
interface CamaraDisponible {
  deviceId: string;
  etiqueta: string;
}

/**
 * Lector de QR que abre la cámara en CUALQUIER dispositivo: escritorio, móvil web y la app
 * nativa de Android.
 *
 * ── DOS DECODIFICADORES, UNO POR PLATAFORMA ─────────────────────────────────────────────
 * `BarcodeDetector` (la API nativa del motor) es lo más rápido y lee con peor luz, pero
 * **sólo existe en Android, ChromeOS y macOS**. En el Chrome de Windows y Linux —el
 * escritorio de la oficina— NO está, y ahí la pantalla decía "este navegador no puede leer
 * códigos QR", que es exactamente lo que había que arreglar.
 *
 * Así que se elige en caliente: nativo si lo hay, y si no **jsQR** sobre los fotogramas del
 * canvas. jsQR es JavaScript puro, sin dependencias, y funciona en Chrome, Edge, Firefox y
 * Safari por igual. El usuario no nota cuál está usando.
 *
 * ── TRES CAMINOS A LA CÁMARA ────────────────────────────────────────────────────────────
 *   1. cámara en vivo — lo normal;
 *   2. cambiar de cámara — el escritorio suele abrir la frontal y en el móvil hace falta la
 *      trasera; se listan las disponibles DESPUÉS de conceder el permiso, que es cuando el
 *      navegador revela sus nombres;
 *   3. foto del QR — sirve sin cámara utilizable (equipo sin webcam, permiso denegado a nivel
 *      de sistema) y en el móvil el propio `capture` abre la cámara nativa. Es la red de
 *      seguridad que garantiza que SIEMPRE haya forma de leer un carné.
 *
 * ── PERMISOS ────────────────────────────────────────────────────────────────────────────
 * En web se piden solos al llamar a `getUserMedia`; lo que hace esta clase es traducir cada
 * fallo a una instrucción concreta ("el candado de la barra de direcciones", "otra app está
 * usando la cámara") en vez de un "no se pudo abrir" que no dice qué hacer. En la app de
 * Android el WebView de Capacitor pide el permiso del sistema, y para eso hace falta
 * `android.permission.CAMERA` en el AndroidManifest — está declarado.
 */
@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './qr-scanner.component.html',
  styleUrl: './qr-scanner.component.css',
})
export class QrScannerComponent implements OnDestroy {
  /** Texto crudo del QR leído. El padre decide qué hacer con él. */
  @Output() leido = new EventEmitter<string>();

  @ViewChild('videoEl') videoEl?: ElementRef<HTMLVideoElement>;
  @ViewChild('archivoEl') archivoEl?: ElementRef<HTMLInputElement>;

  activo = false;
  cargando = false;
  error = '';
  aviso = '';
  /** Nombre del decodificador en uso, para el pie de la vista. */
  motor: 'nativo' | 'jsqr' | '' = '';

  /** false sólo si el navegador no expone cámara en absoluto (o no es contexto seguro). */
  hayCamara = true;
  camaras: CamaraDisponible[] = [];
  camaraActual = '';

  private stream?: MediaStream;
  private detectorNativo: any = null;
  private jsQR: any = null;
  private bucle: ReturnType<typeof setInterval> | null = null;
  /** Lienzo reutilizado entre fotogramas: crear uno por tick dispara el recolector. */
  private lienzo?: HTMLCanvasElement;

  /** Invalida los `getUserMedia` que resuelven tarde (permiso lento, componente destruido). */
  private sesion = 0;
  /** Evita emitir el mismo código varias veces mientras sigue delante de la cámara. */
  private ultimoCodigo = '';
  private ultimoEn = 0;

  private readonly esNavegador: boolean;

  constructor(
    @Inject(PLATFORM_ID) platformId: object,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.esNavegador = isPlatformBrowser(platformId);
    if (this.esNavegador) {
      const seguro = (window as any).isSecureContext !== false;
      this.hayCamara =
        seguro && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
      if (!this.hayCamara) {
        this.aviso = seguro
          ? 'Este navegador no expone la cámara. Sube una foto del QR o identifica por cédula.'
          : 'La cámara sólo funciona sobre HTTPS. Sube una foto del QR o identifica por cédula.';
      }
    }
  }

  ngOnDestroy(): void {
    this.detener();
  }

  // ─────────────────────── cámara en vivo ───────────────────────

  /** @param deviceId cámara concreta; sin él se pide la trasera y se deja elegir al sistema. */
  async iniciar(deviceId?: string): Promise<void> {
    if (!this.esNavegador || !this.hayCamara) return;

    this.detener();
    const sesion = ++this.sesion;
    this.cargando = true;
    this.error = '';
    this.cdr.markForCheck();

    try {
      await this.prepararDecodificador();

      this.stream = await this.abrirCamara(deviceId);
      if (sesion !== this.sesion) {
        // Llegó después de que alguien cerrara la pantalla: apagar el LED de inmediato.
        this.stream.getTracks().forEach(t => t.stop());
        return;
      }

      const v = this.videoEl?.nativeElement;
      if (v) {
        v.srcObject = this.stream;
        // `playsinline` + `muted` es lo que impide que iOS abra el vídeo a pantalla completa.
        v.setAttribute('playsinline', 'true');
        v.muted = true;
        await v.play().catch(() => { /* algunos navegadores exigen un gesto del usuario */ });
      }

      this.camaraActual = this.stream.getVideoTracks()[0]?.getSettings?.().deviceId ?? '';
      await this.listarCamaras();

      this.activo = true;
      // 220 ms: unas cuatro lecturas por segundo se sienten instantáneas y dejan sitio de sobra
      // a jsQR, que decodifica en el hilo principal.
      this.bucle = setInterval(() => void this.leerCuadro(), 220);
    } catch (e: any) {
      if (sesion === this.sesion) this.error = this.explicar(e);
    } finally {
      if (sesion === this.sesion) {
        this.cargando = false;
        this.cdr.markForCheck();
      }
    }
  }

  detener(): void {
    this.sesion++;
    if (this.bucle) {
      clearInterval(this.bucle);
      this.bucle = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = undefined;
    }
    const v = this.videoEl?.nativeElement;
    if (v) v.srcObject = null;
    this.activo = false;
    this.cdr.markForCheck();
  }

  /** Pasa a la siguiente cámara de la lista (frontal ⇄ trasera, o varias traseras). */
  async cambiarCamara(): Promise<void> {
    if (this.camaras.length < 2) return;
    const i = this.camaras.findIndex(c => c.deviceId === this.camaraActual);
    const siguiente = this.camaras[(i + 1) % this.camaras.length];
    await this.iniciar(siguiente.deviceId);
  }

  /**
   * Abre la cámara con la mejor petición posible y va relajando restricciones.
   *
   * El orden importa: pedir `facingMode: 'environment'` de forma EXACTA falla en portátiles
   * (sólo tienen webcam frontal) y pedir una resolución alta falla en cámaras baratas. Cada
   * intento renuncia a algo, y el último pide "vídeo, lo que sea", que es lo que nunca falla
   * si hay cámara y permiso.
   */
  private async abrirCamara(deviceId?: string): Promise<MediaStream> {
    const intentos: MediaStreamConstraints[] = deviceId
      ? [{ video: { deviceId: { exact: deviceId } }, audio: false }]
      : [
          // Trasera preferida + buena resolución: el caso del móvil y de la app de Android.
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          // Sin resolución: cámaras que no admiten 720p.
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          // Lo que haya: la webcam del escritorio.
          { video: true, audio: false },
        ];

    let ultimo: any = null;
    for (const c of intentos) {
      try {
        return await navigator.mediaDevices.getUserMedia(c);
      } catch (e: any) {
        ultimo = e;
        // Un permiso denegado no se arregla relajando restricciones: cortar ya y decirlo.
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw e;
      }
    }
    throw ultimo;
  }

  /**
   * Nombres de las cámaras. Sólo tiene sentido DESPUÉS de conceder el permiso: antes, el
   * navegador devuelve etiquetas vacías por privacidad y el botón de cambiar no diría nada.
   */
  private async listarCamaras(): Promise<void> {
    try {
      const dispositivos = await navigator.mediaDevices.enumerateDevices();
      this.camaras = dispositivos
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, etiqueta: d.label || `Cámara ${i + 1}` }));
    } catch {
      this.camaras = [];
    }
  }

  // ─────────────────────── foto del QR ───────────────────────

  abrirSelectorArchivo(): void {
    this.archivoEl?.nativeElement.click();
  }

  /** Decodifica el QR de una imagen. En móvil, `capture` hace que esto abra la cámara nativa. */
  async onArchivo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    // Permite volver a elegir el mismo archivo tras un fallo.
    input.value = '';
    if (!file) return;

    this.error = '';
    this.cargando = true;
    this.cdr.markForCheck();

    try {
      await this.prepararDecodificador();
      const img = await this.cargarImagen(file);
      const texto = await this.decodificarImagen(img);
      if (texto) {
        this.emitir(texto);
      } else {
        this.error = 'No se encontró ningún QR en esa imagen. Acércate más y evita reflejos.';
      }
    } catch {
      this.error = 'No se pudo leer la imagen.';
    } finally {
      this.cargando = false;
      this.cdr.markForCheck();
    }
  }

  private cargarImagen(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen invalida')); };
      img.src = url;
    });
  }

  private async decodificarImagen(img: HTMLImageElement): Promise<string> {
    // Una foto de móvil son 12 Mpx; jsQR sobre eso tarda segundos. 1000 px de lado largo
    // conservan de sobra la trama de un QR.
    const max = 1000;
    const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * escala));
    const h = Math.max(1, Math.round(img.naturalHeight * escala));

    const canvas = this.lienzoDe(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, w, h);

    if (this.detectorNativo) {
      try {
        const codigos = await this.detectorNativo.detect(canvas);
        const texto = String(codigos?.[0]?.rawValue ?? '').trim();
        if (texto) return texto;
      } catch { /* se prueba con jsQR abajo */ }
    }
    if (!this.jsQR) return '';
    const datos = ctx.getImageData(0, 0, w, h);
    // 'attemptBoth' prueba también el QR en negativo: es el doble de lento, pero aquí se
    // decodifica UNA vez y merece la pena a cambio de leer fotos con exposición rara.
    const r = this.jsQR(datos.data, w, h, { inversionAttempts: 'attemptBoth' });
    return String(r?.data ?? '').trim();
  }

  // ─────────────────────── decodificación ───────────────────────

  /** Elige decodificador una sola vez: nativo si lo hay, si no jsQR bajo demanda. */
  private async prepararDecodificador(): Promise<void> {
    if (this.detectorNativo || this.jsQR) return;

    const Detector = (window as any).BarcodeDetector;
    if (typeof Detector === 'function') {
      try {
        const formatos: string[] = (await Detector.getSupportedFormats?.()) ?? [];
        // Se comprueba que soporte QR y no sólo que la clase exista: hay motores que la
        // exponen con una lista de formatos que no lo incluye.
        if (!formatos.length || formatos.includes('qr_code')) {
          // Sólo 'qr_code': pedir todos los formatos hace que pruebe códigos de barras 1D en
          // cada fotograma y baja los cuadros por segundo sin ninguna ganancia.
          this.detectorNativo = new Detector({ formats: ['qr_code'] });
          this.motor = 'nativo';
          return;
        }
      } catch { /* cae a jsQR */ }
    }

    const mod: any = await import('jsqr');
    this.jsQR = mod?.default ?? mod;
    this.motor = 'jsqr';
  }

  private async leerCuadro(): Promise<void> {
    const v = this.videoEl?.nativeElement;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    try {
      let texto = '';

      if (this.detectorNativo) {
        const codigos = await this.detectorNativo.detect(v);
        texto = String(codigos?.[0]?.rawValue ?? '').trim();
      } else if (this.jsQR) {
        // jsQR trabaja sobre píxeles: se reduce el fotograma a ~480 px de ancho antes de
        // decodificar. A 1280 px tarda ~150 ms por cuadro en un equipo de oficina y la vista
        // se siente trabada; a 480 baja a ~25 ms y un QR de carné sigue leyéndose entero.
        const ancho = 480;
        const alto = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * ancho));
        const canvas = this.lienzoDe(ancho, alto);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, ancho, alto);
        const datos = ctx.getImageData(0, 0, ancho, alto);
        const r = this.jsQR(datos.data, ancho, alto, { inversionAttempts: 'dontInvert' });
        texto = String(r?.data ?? '').trim();
      }

      if (texto) this.emitir(texto);
    } catch {
      // Un cuadro que no se pudo decodificar no es un error: el siguiente llega en 220 ms.
    }
  }

  /** Anti-rebote: el mismo carné sigue delante de la cámara varios segundos. */
  private emitir(texto: string): void {
    const ahora = Date.now();
    if (texto === this.ultimoCodigo && ahora - this.ultimoEn < 3000) return;
    this.ultimoCodigo = texto;
    this.ultimoEn = ahora;
    this.leido.emit(texto);
  }

  private lienzoDe(w: number, h: number): HTMLCanvasElement {
    if (!this.lienzo) this.lienzo = document.createElement('canvas');
    if (this.lienzo.width !== w) this.lienzo.width = w;
    if (this.lienzo.height !== h) this.lienzo.height = h;
    return this.lienzo;
  }

  /** Cada fallo de cámara tiene una salida distinta; el mensaje dice cuál. */
  private explicar(e: any): string {
    switch (e?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Permiso de cámara denegado. Actívalo en el candado de la barra de direcciones '
             + '(o en los ajustes de la app) y vuelve a intentarlo. También puedes subir una foto del QR.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'Este equipo no tiene cámara. Sube una foto del QR o identifica por cédula.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'La cámara está siendo usada por otra aplicación. Ciérrala y vuelve a intentarlo.';
      case 'OverconstrainedError':
        return 'La cámara no admite la configuración pedida. Prueba con "Cambiar cámara".';
      default:
        return 'No se pudo abrir la cámara. Sube una foto del QR o identifica por cédula.';
    }
  }
}

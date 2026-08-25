import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '@/environments/environment';

export interface EstadoGrabador {
  fase: 'inactivo' | 'preparando' | 'grabando' | 'pausado' | 'finalizando' | 'listo' | 'error';
  segundos: number;
  fragmentosEnviados: number;
  fragmentosPendientes: number;
  mensaje: string | null;
}

/** Cada cuántos segundos MediaRecorder suelta un trozo (y por tanto, cada cuánto se sube). */
const TROZO_SEGUNDOS = 15;
const REINTENTOS = 5;

/**
 * Grabación desde la aplicación.
 *
 * La decisión que sostiene todo esto: MediaRecorder trabaja con `timeslice`, así que
 * suelta un blob cada 15 s, y CADA BLOB SE SUBE EN CUANTO SALE. Cuando el usuario pulsa
 * "Finalizar", lo grabado ya está en el servidor; el botón sólo cierra la sesión de
 * carga. Es la respuesta directa al requisito de no perder una reunión de dos horas por
 * un fallo justo al final.
 *
 * La sesión de carga va en modo streaming (total_bytes = 0): una grabación en vivo no
 * sabe cuánto va a pesar.
 *
 * REQUISITO DE INFRAESTRUCTURA: Caddy debe enviar `Permissions-Policy: microphone=(self)`.
 * Con `microphone=()` el navegador niega el micrófono aunque la persona acepte el permiso.
 */
@Injectable({ providedIn: 'root' })
export class GrabadorService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/meetings`;

  readonly estado = signal<EstadoGrabador>({
    fase: 'inactivo', segundos: 0, fragmentosEnviados: 0, fragmentosPendientes: 0, mensaje: null,
  });

  private recorder: MediaRecorder | null = null;
  private pista: MediaStream | null = null;
  private uploadId: string | null = null;
  private indice = 0;
  private cola: Promise<void> = Promise.resolve();
  private cronometro: ReturnType<typeof setInterval> | null = null;

  /** ¿El navegador y el contexto permiten grabar? */
  static soportado(): boolean {
    return GrabadorService.motivoNoSoportado() === null;
  }

  /**
   * Por qué no se puede grabar aquí, o null si sí se puede.
   *
   * El caso que hay que separar es el del CONTEXTO INSEGURO: por HTTP —o entrando por IP en la
   * red interna— el navegador ni siquiera expone `navigator.mediaDevices`, así que el fallo
   * parece "el navegador no soporta grabar" cuando en realidad el mismo navegador funciona
   * perfectamente entrando por https. Con el diagnóstico equivocado, la persona cambia de
   * navegador y sigue sin poder.
   */
  static motivoNoSoportado(): string | null {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      return 'La grabación solo funciona desde el navegador.';
    }
    if (!window.isSecureContext) {
      return 'Para grabar hay que entrar por https://tesoro.tuapo.co. '
           + 'Por una dirección IP el navegador bloquea el micrófono.';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'Este navegador no permite grabar. En iPhone usa Safari; en Android, Chrome.';
    }
    if (typeof MediaRecorder === 'undefined') {
      return 'Este navegador es demasiado antiguo para grabar. Actualízalo e intenta de nuevo.';
    }
    return null;
  }

  async iniciar(reunionId: string, conVideo = false): Promise<void> {
    const impedimento = GrabadorService.motivoNoSoportado();
    if (impedimento) {
      this.estado.update(e => ({ ...e, fase: 'error', mensaje: impedimento }));
      throw new Error(impedimento);
    }
    this.estado.set({
      fase: 'preparando', segundos: 0, fragmentosEnviados: 0, fragmentosPendientes: 0,
      mensaje: null,
    });

    try {
      this.pista = await navigator.mediaDevices.getUserMedia(this.restricciones(conVideo));
    } catch (err) {
      const mensaje = this.explicar(err, conVideo);
      this.estado.update(e => ({ ...e, fase: 'error', mensaje }));
      throw new Error(mensaje);
    }

    const mime = this.mejorFormato(conVideo);
    const extension = GrabadorService.extensionDe(mime, conVideo);

    const sesion = await firstValueFrom(this.http.post<{ upload_id: string }>(
      `${this.base}/${reunionId}/uploads`,
      {
        filename: `grabacion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`,
        mime_type: mime,
        total_bytes: 0,          // streaming: el tamaño final aún no existe
        source: 'RECORDED',
      },
    ));
    this.uploadId = sesion.upload_id;
    this.indice = 0;

    this.recorder = new MediaRecorder(this.pista, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) this.encolarFragmento(ev.data);
    };
    this.recorder.start(TROZO_SEGUNDOS * 1000);
    this.arrancarCronometro();
    this.estado.update(e => ({ ...e, fase: 'grabando', mensaje: null }));
  }

  pausar(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.pause();
      this.pararCronometro();
      this.estado.update(e => ({ ...e, fase: 'pausado' }));
    }
  }

  continuar(): void {
    if (this.recorder?.state === 'paused') {
      this.recorder.resume();
      this.arrancarCronometro();
      this.estado.update(e => ({ ...e, fase: 'grabando' }));
    }
  }

  /** Cierra la grabación y devuelve el id de la grabación creada. */
  async finalizar(): Promise<string> {
    if (!this.recorder || !this.uploadId) throw new Error('No hay una grabación en curso');
    this.estado.update(e => ({ ...e, fase: 'finalizando', mensaje: 'Cerrando la grabación' }));
    this.pararCronometro();

    await new Promise<void>((resolve) => {
      this.recorder!.onstop = () => resolve();
      this.recorder!.stop();
    });
    this.pista?.getTracks().forEach(t => t.stop());

    // Esperar a que la cola de subida drene: los últimos segundos también cuentan.
    await this.cola;

    const { recording_id } = await firstValueFrom(this.http.post<{ recording_id: string }>(
      `${this.base}/uploads/${this.uploadId}/complete`, {},
    ));
    this.limpiar();
    this.estado.update(e => ({ ...e, fase: 'listo', mensaje: 'Grabación guardada' }));
    return recording_id;
  }

  /** Aborta y suelta el micrófono. Lo ya subido queda en el servidor. */
  async cancelar(): Promise<void> {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
      this.pista?.getTracks().forEach(t => t.stop());
      if (this.uploadId) {
        await firstValueFrom(this.http.delete(`${this.base}/uploads/${this.uploadId}`));
      }
    } finally {
      this.pararCronometro();
      this.limpiar();
      this.estado.set({
        fase: 'inactivo', segundos: 0, fragmentosEnviados: 0, fragmentosPendientes: 0,
        mensaje: null,
      });
    }
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  /**
   * Encola el fragmento. Se serializa a propósito: los trozos tienen que llegar EN
   * ORDEN, porque el servidor los ensambla por índice y un WebM con los bloques
   * desordenados no se puede decodificar.
   */
  private encolarFragmento(blob: Blob): void {
    const idx = this.indice++;
    this.estado.update(e => ({ ...e, fragmentosPendientes: e.fragmentosPendientes + 1 }));
    this.cola = this.cola.then(() => this.subirFragmento(idx, blob));
  }

  private async subirFragmento(idx: number, blob: Blob): Promise<void> {
    for (let intento = 1; intento <= REINTENTOS; intento++) {
      try {
        await firstValueFrom(this.http.put(
          `${this.base}/uploads/${this.uploadId}/parts/${idx}`,
          blob,
          { headers: new HttpHeaders({ 'Content-Type': 'application/octet-stream' }) },
        ));
        this.estado.update(e => ({
          ...e,
          fragmentosEnviados: e.fragmentosEnviados + 1,
          fragmentosPendientes: Math.max(0, e.fragmentosPendientes - 1),
        }));
        return;
      } catch {
        if (intento === REINTENTOS) {
          this.estado.update(e => ({
            ...e, fase: 'error',
            mensaje: `No se pudo enviar un fragmento (${idx}). La grabación puede quedar incompleta.`,
          }));
          return;
        }
        await new Promise(r => setTimeout(r, Math.min(8000, 500 * 2 ** (intento - 1))));
      }
    }
  }

  /**
   * Restricciones de captura.
   *
   * La resolución va como `ideal` y no fija: en un móvil de gama baja pedir 1280x720 exacto
   * hace que getUserMedia falle con OverconstrainedError en vez de devolver lo que la cámara
   * sí puede dar. `facingMode: user` abre la cámara frontal, que es la que se espera en una
   * reunión.
   */
  private restricciones(conVideo: boolean): MediaStreamConstraints {
    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (!conVideo) return { audio };
    return {
      audio,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: 'user',
      },
    };
  }

  /**
   * Traduce el fallo de getUserMedia a algo accionable.
   *
   * Antes todo decía "revise el permiso del micrófono", incluso cuando el problema era que el
   * equipo no tiene cámara o que otra aplicación la tenía tomada. Con el mensaje equivocado, la
   * persona revisa el permiso, lo ve concedido, y se queda sin saber qué hacer.
   */
  private explicar(err: unknown, conVideo: boolean): string {
    const dispositivo = conVideo ? 'la cámara o el micrófono' : 'el micrófono';
    const nombre = (err as { name?: string } | null)?.name ?? '';

    switch (nombre) {
      case 'NotAllowedError':
      case 'SecurityError':
        return `Diste "Bloquear" a ${dispositivo}. Toca el candado de la barra de direcciones, `
             + 'permite el acceso y vuelve a intentar.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return conVideo
          ? 'Este equipo no tiene cámara. Puedes grabar solo el audio.'
          : 'No se detectó ningún micrófono conectado.';
      case 'NotReadableError':
      case 'TrackStartError':
        return `Otra aplicación está usando ${dispositivo}. Ciérrala (Teams, Meet, Zoom) `
             + 'y vuelve a intentar.';
      case 'OverconstrainedError':
        return 'La cámara de este equipo no admite la calidad pedida. Intenta grabar solo audio.';
      case 'AbortError':
        return `No se pudo iniciar ${dispositivo}. Vuelve a intentar.`;
      default:
        return `No se pudo acceder a ${dispositivo}. Revisa los permisos del navegador `
             + 'y que ninguna otra aplicación lo esté usando.';
    }
  }

  /**
   * Extensión coherente con lo que el navegador GRABA de verdad.
   *
   * Safari (iPhone, iPad y macOS) no graba WebM: entrega MP4. Poner siempre `.webm` hacía que
   * el servidor clasificara por extensión un audio de iPhone como si fuera vídeo, y el nombre
   * del archivo mentía sobre su contenido.
   */
  static extensionDe(mime: string, conVideo: boolean): string {
    const m = (mime || '').toLowerCase();
    if (m.includes('mp4')) return conVideo ? 'mp4' : 'm4a';
    if (m.includes('ogg')) return 'ogg';
    if (m.includes('webm')) return 'webm';
    // Sin mime, MediaRecorder usa su formato por defecto: webm en Chrome/Firefox, mp4 en Safari.
    return GrabadorService.pareceSafari() ? (conVideo ? 'mp4' : 'm4a') : 'webm';
  }

  private static pareceSafari(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return /^((?!chrome|android|crios|fxios).)*safari/i.test(ua) || /iphone|ipad|ipod/i.test(ua);
  }

  /**
   * El primer formato que el navegador soporte de verdad.
   *
   * El orden pone MP4 antes que WebM cuando el navegador es de Apple: Safari devuelve `false`
   * en `isTypeSupported` para WebM, y si no hubiera candidato MP4 el grabador arrancaría sin
   * mimeType y con la extensión equivocada.
   */
  private mejorFormato(conVideo: boolean): string {
    const apple = GrabadorService.pareceSafari();
    const candidatos = conVideo
      ? (apple
          ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm']
          : ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'])
      : (apple
          ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm']
          : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']);
    for (const c of candidatos) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  private arrancarCronometro(): void {
    this.pararCronometro();
    this.cronometro = setInterval(() => {
      this.estado.update(e => ({ ...e, segundos: e.segundos + 1 }));
    }, 1000);
  }

  private pararCronometro(): void {
    if (this.cronometro) { clearInterval(this.cronometro); this.cronometro = null; }
  }

  private limpiar(): void {
    this.recorder = null;
    this.pista = null;
    this.uploadId = null;
    this.indice = 0;
    this.cola = Promise.resolve();
  }
}

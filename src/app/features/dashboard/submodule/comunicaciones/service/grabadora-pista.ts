import { firstValueFrom } from 'rxjs';
import { ComunicacionesApiService } from './comunicaciones-api.service';
import { idCliente } from '../utiles';

/**
 * Graba el micrófono PROPIO durante una llamada y lo sube por trozos de 10 s.
 * Cada persona sube solo su voz: así la transcripción sabe quién dijo qué sin
 * adivinarlo, y lo subido sobrevive aunque la pestaña se cierre de golpe.
 *
 * Los trozos se suben en orden y de a uno, con reintentos; el servidor acepta
 * el mismo índice dos veces (reemplaza), así que reintentar no duplica audio.
 */
export class GrabadoraPista {
  private rec: MediaRecorder | null = null;
  private readonly cola: Blob[] = [];
  private indice = 0;
  private subiendo: Promise<void> | null = null;
  private abierta: Promise<unknown> | null = null;
  readonly pistaId = idCliente();

  constructor(private readonly api: ComunicacionesApiService, private readonly llamadaId: string,
              private readonly pista: MediaStreamTrack, private readonly inicioServidorMs: number,
              /** AUDIO = el micrófono (se transcribe); PANTALLA = la pantalla compartida (para los clips de lo mostrado). */
              private readonly tipo: 'AUDIO' | 'PANTALLA' = 'AUDIO') {}

  static soportada(): boolean {
    return typeof window !== 'undefined' && 'MediaRecorder' in window;
  }

  iniciar(): boolean {
    const video = this.tipo === 'PANTALLA';
    const mime = (video ? ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'])
      .find(m => (window as any).MediaRecorder?.isTypeSupported?.(m)) ?? '';
    // La pantalla va liviana (lo que se muestra cambia poco) y con cuadro clave cada 4 s para poder cortar clips.
    const opciones: Record<string, unknown> = video
      ? { videoBitsPerSecond: 600_000, videoKeyFrameIntervalDuration: 4000 }
      : { audioBitsPerSecond: 32000 };
    try {
      this.rec = new MediaRecorder(new MediaStream([this.pista]), mime ? { mimeType: mime, ...opciones } as MediaRecorderOptions : undefined);
    } catch {
      return false;
    }
    this.abierta = firstValueFrom(this.api.abrirPista(this.llamadaId, this.pistaId, this.inicioServidorMs, this.rec.mimeType || mime, this.tipo))
      .catch(() => null);
    this.rec.ondataavailable = e => {
      if (e.data && e.data.size > 0) { this.cola.push(e.data); this.vaciar(); }
    };
    this.rec.start(10_000);
    return true;
  }

  private vaciar(): void {
    if (this.subiendo) return;
    this.subiendo = (async () => {
      await this.abierta;
      while (this.cola.length) {
        const parte = this.cola[0];
        const i = this.indice;
        let ok = false;
        for (let intento = 0; intento < 4 && !ok; intento++) {
          try {
            await firstValueFrom(this.api.subirParte(this.llamadaId, this.pistaId, i, parte));
            ok = true;
          } catch {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(3, intento)));
          }
        }
        this.cola.shift();
        this.indice++;
      }
    })().finally(() => { this.subiendo = null; if (this.cola.length) this.vaciar(); });
  }

  /** Detiene, sube lo que falte y cierra la pista. */
  async detener(): Promise<void> {
    const rec = this.rec;
    this.rec = null;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>(resolve => {
        rec.onstop = () => resolve();
        try { rec.stop(); } catch { resolve(); }
      });
    }
    this.vaciar();
    while (this.subiendo) await this.subiendo;
    await firstValueFrom(this.api.cerrarPista(this.llamadaId, this.pistaId)).catch(() => null);
  }
}

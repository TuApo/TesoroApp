import { Injectable } from '@angular/core';

import { componerSobreBlanco, mascaraCreible, redimensionarMascara } from './foto-documento.util';

/** Qué pasó al intentar poner el fondo blanco. */
export type ResultadoFondo =
  /** Persona sobre #FFFFFF. */
  | 'aplicado'
  /** No hay segmentador (modelo sin descargar, wasm bloqueado): la foto queda como estaba. */
  | 'no-disponible'
  /** El modelo no encontró a una persona creíble: se deja la foto como estaba. */
  | 'sin-persona';

/**
 * FONDO BLANCO para la foto tipo documento.
 *
 * Pedido del 24-sep: la foto de la persona tiene que salir sobre fondo blanco.
 * Se hace en el NAVEGADOR con MediaPipe Image Segmenter —el mismo wasm que ya
 * usa el detector de rostro, servido en `/mediapipe/wasm`— y el modelo
 * `selfie_multiclass_256x256`, que separa pelo, piel, ropa y fondo: es el que
 * mejor respeta el contorno del pelo, que es donde el segmentador binario
 * (`selfie_segmenter`) se come mechones.
 *
 * La foto no sale del equipo para esto. El modelo (16 MB) lo sirve la propia
 * app en `/mediapipe/models/` y el service worker lo guarda al primer uso.
 *
 * Nunca bloquea: si el modelo no carga, `aplicar` dice 'no-disponible', la foto
 * sigue con su fondo y la IA decide si sirve.
 */
@Injectable({ providedIn: 'root' })
export class FondoBlancoService {
  static readonly MODELO = '/mediapipe/models/selfie_multiclass_256x256.tflite';

  private segmentador: any | null = null;
  private cargando: Promise<boolean> | null = null;
  private imposible = false;
  /** Posición de la clase "fondo" entre las máscaras que devuelve el modelo. */
  private indiceFondo = 0;

  get disponible(): boolean {
    return !!this.segmentador;
  }

  /**
   * Carga perezosa. Conviene llamarla al abrir la cámara, en paralelo, para que
   * al tomar la foto el modelo ya esté listo.
   */
  async iniciar(): Promise<boolean> {
    if (this.segmentador) return true;
    if (this.imposible) return false;
    if (this.cargando) return this.cargando;

    this.cargando = (async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
        this.segmentador = await vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FondoBlancoService.MODELO },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        const etiquetas: string[] = this.segmentador.getLabels?.() ?? [];
        const i = etiquetas.findIndex((e) => /background|fondo/i.test(e));
        this.indiceFondo = i >= 0 ? i : 0;
        return true;
      } catch (e) {
        console.warn('[fondo-blanco] No se pudo cargar el segmentador; la foto queda con su fondo:', e);
        this.imposible = true;
        this.segmentador = null;
        return false;
      } finally {
        this.cargando = null;
      }
    })();
    return this.cargando;
  }

  /**
   * Probabilidad de "persona" por píxel del canvas (0..1), ya al tamaño del
   * canvas. null si no hay segmentador o si el modelo falló.
   */
  probabilidadPersona(canvas: HTMLCanvasElement): Float32Array | null {
    if (!this.segmentador) return null;
    let r: any;
    try {
      r = this.segmentador.segment(canvas);
    } catch (e) {
      console.warn('[fondo-blanco] Falló la segmentación:', e);
      return null;
    }
    try {
      const mascaras: any[] = r?.confidenceMasks ?? [];
      if (!mascaras.length) return null;
      // Un modelo multiclase trae una máscara por clase y la persona es "todo lo
      // que no es fondo"; uno binario puede traer solo la de persona.
      const unica = mascaras.length === 1;
      const m = unica ? mascaras[0] : mascaras[this.indiceFondo] ?? mascaras[0];
      const datos: Float32Array = m.getAsFloat32Array();
      const prob = redimensionarMascara(datos, m.width, m.height, canvas.width, canvas.height);
      if (!unica) for (let i = 0; i < prob.length; i++) prob[i] = 1 - prob[i];
      return prob;
    } finally {
      // Las máscaras viven en memoria del wasm: sin cerrarlas, cada foto la va
      // llenando hasta que la pestaña se cae.
      try { r?.close?.(); } catch { /* nada que liberar */ }
    }
  }

  /**
   * Pone a la persona sobre blanco EN el canvas.
   *
   * Si el modelo todavía se está descargando (16 MB en una red lenta) se le
   * esperan como mucho `esperaMaxMs`: pasado eso, esta foto sigue sin fondo
   * blanco —la IA dirá si sirve— y la descarga continúa para la siguiente.
   */
  async aplicar(canvas: HTMLCanvasElement, esperaMaxMs = 20_000): Promise<ResultadoFondo> {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<boolean>((ok) => (reloj = setTimeout(() => ok(false), esperaMaxMs)));
    const listo = await Promise.race([this.iniciar(), limite]);
    clearTimeout(reloj);
    if (!listo) return 'no-disponible';
    const prob = this.probabilidadPersona(canvas);
    if (!prob) return 'no-disponible';
    if (!mascaraCreible(prob)) return 'sin-persona';

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'no-disponible';
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Borde suavizado proporcional al tamaño: 2 px en una foto de 600×800.
    const radio = Math.max(1, Math.round(canvas.width / 300));
    componerSobreBlanco(img.data, prob, canvas.width, canvas.height, radio);
    ctx.putImageData(img, 0, 0);
    return 'aplicado';
  }
}

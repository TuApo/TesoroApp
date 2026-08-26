import { Injectable } from '@angular/core';

/** Lo que se ve de la persona en un fotograma. */
export interface LecturaRostro {
  /** Hay una cara en cuadro. */
  hayCara: boolean;
  /** Alto de la cara respecto al alto del cuadro (0..1). */
  ocupacion: number;
  /** Cuánto cerrado está cada ojo (0 abierto, 1 cerrado). */
  ojoIzq: number;
  ojoDer: number;
}

/**
 * ¿HAY UNA PERSONA DELANTE?
 *
 * La foto de perfil se toma con la persona enfrente, pero nada impedía
 * fotografiar una cédula, una pantalla o una silla vacía. Esto pide dos cosas
 * que una foto impresa no puede hacer: acercarse y parpadear.
 *
 * Corre ENTERO en el navegador —MediaPipe Face Landmarker sobre WebAssembly—:
 * la cara no sale del equipo, no viaja a ningún servicio y funciona sin
 * internet, con el modelo servido por la propia aplicación
 * (`/mediapipe/face_landmarker.task` y el wasm en `/mediapipe/wasm`).
 *
 * El parpadeo sale de los *blendshapes* `eyeBlinkLeft` / `eyeBlinkRight`, que
 * el propio modelo entrega: no hay que calcular relaciones de aspecto a mano.
 * Los 478 puntos que devuelve son además la base sobre la que después se monta
 * el reconocimiento facial (mismo modelo, otro cabezal).
 *
 * Si el modelo no carga —navegador viejo, wasm bloqueado, assets ausentes— el
 * servicio dice que NO está disponible y la cámara sigue funcionando sin
 * validación: esto no puede dejar a nadie sin poder tomar la foto.
 */
@Injectable({ providedIn: 'root' })
export class DeteccionRostroService {
  private landmarker: any | null = null;
  private cargando: Promise<boolean> | null = null;
  /** El modelo ya se intentó cargar y no se pudo. No se reintenta en bucle. */
  private imposible = false;

  get disponible(): boolean {
    return !!this.landmarker;
  }

  /** Carga perezosa: el modelo pesa, y solo hace falta al abrir la cámara. */
  async iniciar(): Promise<boolean> {
    if (this.landmarker) return true;
    if (this.imposible) return false;
    if (this.cargando) return this.cargando;

    this.cargando = (async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
        this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task' },
          runningMode: 'VIDEO',
          numFaces: 1,
          // El parpadeo viene de aquí; sin blendshapes habría que deducirlo de
          // los puntos del párpado, que es mucho más frágil.
          outputFaceBlendshapes: true,
        });
        return true;
      } catch (e) {
        console.warn('[rostro] No se pudo cargar el detector; la cámara sigue sin validación:', e);
        this.imposible = true;
        this.landmarker = null;
        return false;
      } finally {
        this.cargando = null;
      }
    })();

    return this.cargando;
  }

  /**
   * Lee un fotograma. `tsMs` tiene que ser creciente: es lo que usa el modelo
   * para seguir la cara entre cuadros.
   */
  leer(video: HTMLVideoElement, tsMs: number): LecturaRostro | null {
    if (!this.landmarker || video.readyState < 2) return null;
    let r: any;
    try {
      r = this.landmarker.detectForVideo(video, tsMs);
    } catch {
      return null;
    }

    const puntos = r?.faceLandmarks?.[0];
    if (!puntos?.length) return { hayCara: false, ocupacion: 0, ojoIzq: 0, ojoDer: 0 };

    // Alto de la caja de la cara en coordenadas normalizadas: es la medida de
    // "qué tan cerca está" que no depende de la resolución de la cámara.
    let min = 1;
    let max = 0;
    for (const p of puntos) {
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
    }

    const cat: Array<{ categoryName: string; score: number }> =
      r?.faceBlendshapes?.[0]?.categories ?? [];
    const valor = (nombre: string) =>
      cat.find((c) => c.categoryName === nombre)?.score ?? 0;

    return {
      hayCara: true,
      ocupacion: Math.max(0, Math.min(1, max - min)),
      ojoIzq: valor('eyeBlinkLeft'),
      ojoDer: valor('eyeBlinkRight'),
    };
  }
}

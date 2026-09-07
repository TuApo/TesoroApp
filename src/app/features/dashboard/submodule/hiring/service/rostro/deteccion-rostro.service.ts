import { Injectable } from '@angular/core';

/** Lo que se ve de la persona en un fotograma. */
export interface LecturaRostro {
  /** Hay una cara en cuadro. */
  hayCara: boolean;
  /**
   * Centro de la cara en coordenadas normalizadas del fotograma (0..1). El
   * encuadre se decide contra el óvalo que se dibuja en pantalla, y para eso
   * no basta el tamaño: hace falta saber dónde está.
   */
  centroX: number;
  centroY: number;
  /** Alto de la cara respecto al alto del cuadro (0..1). */
  alto: number;
  /** Giro horizontal de la cabeza: 0 de frente, ±1 de perfil. */
  giro: number;
  /** Inclinación de la cabeza en grados: 0 con los ojos a nivel. */
  inclinacion: number;
  /** Cuánto cerrado está cada ojo (0 abierto, 1 cerrado). */
  ojoIzq: number;
  ojoDer: number;
}

/** Sin cara en cuadro: valores neutros para no tener que comprobar nulos. */
const SIN_CARA: LecturaRostro = {
  hayCara: false,
  centroX: 0.5,
  centroY: 0.5,
  alto: 0,
  giro: 0,
  inclinacion: 0,
  ojoIzq: 0,
  ojoDer: 0,
};

/**
 * Puntos de la malla de 478 que hacen falta para saber si mira de frente.
 * Son índices fijos del modelo: la punta de la nariz y las esquinas externas
 * de los dos ojos.
 */
const P_NARIZ = 1;
const P_OJO_DERECHO = 33;
const P_OJO_IZQUIERDO = 263;

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
    if (!puntos?.length) return SIN_CARA;

    // Caja de la cara en coordenadas normalizadas: es la medida de "dónde
    // está y qué tan cerca" que no depende de la resolución de la cámara.
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (const p of puntos) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const cat: Array<{ categoryName: string; score: number }> =
      r?.faceBlendshapes?.[0]?.categories ?? [];
    const valor = (nombre: string) =>
      cat.find((c) => c.categoryName === nombre)?.score ?? 0;

    return {
      hayCara: true,
      centroX: (minX + maxX) / 2,
      centroY: (minY + maxY) / 2,
      alto: Math.max(0, Math.min(1, maxY - minY)),
      ...this.orientacion(video, puntos),
      ojoIzq: valor('eyeBlinkLeft'),
      ojoDer: valor('eyeBlinkRight'),
    };
  }

  /**
   * ¿Mira de frente?
   *
   * El giro sale de comparar cuánto dista la nariz de cada ojo: de frente las
   * dos distancias son iguales y de perfil una se come a la otra. Se mide así
   * —y no con la matriz de pose del modelo— porque es una proporción, o sea
   * que no depende de la escala de la cara ni de la resolución del vídeo.
   *
   * La inclinación es el ángulo de la línea entre los dos ojos, y ese sí hay
   * que calcularlo en píxeles: en coordenadas normalizadas cada eje va por su
   * cuenta y un vídeo 16:9 falsearía el ángulo.
   */
  private orientacion(
    video: HTMLVideoElement,
    puntos: Array<{ x: number; y: number }>,
  ): { giro: number; inclinacion: number } {
    const nariz = puntos[P_NARIZ];
    const ojoDer = puntos[P_OJO_DERECHO];
    const ojoIzq = puntos[P_OJO_IZQUIERDO];
    if (!nariz || !ojoDer || !ojoIzq) return { giro: 0, inclinacion: 0 };

    const aDer = Math.abs(nariz.x - ojoDer.x);
    const aIzq = Math.abs(ojoIzq.x - nariz.x);
    const suma = aDer + aIzq;

    const dx = (ojoIzq.x - ojoDer.x) * (video.videoWidth || 1);
    const dy = (ojoIzq.y - ojoDer.y) * (video.videoHeight || 1);

    return {
      giro: suma > 0 ? (aIzq - aDer) / suma : 0,
      inclinacion: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }
}

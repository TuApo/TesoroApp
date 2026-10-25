import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

declare global {
  interface Window {
    cv: any;
    Module: any;
  }
}

/**
 * De dónde sale OpenCV.js, en orden.
 *
 * 1. Copia PROPIA en `public/opencv/<versión>/` (la sirve el mismo nginx de la app). La
 *    CSP de `index.html` solo deja `script-src 'self'`, así que desde un CDN el escáner
 *    no cargaba nunca y se quedaba siempre en "Modo manual". La versión va en la ruta
 *    porque nginx cachea los `.js` un año como inmutables.
 * 2. El CDN oficial, de respaldo (entornos sin esa CSP o una imagen sin el archivo).
 *    Ojo: `docs.opencv.org/4.10.0/opencv.js` responde 404; 4.9.0 sí existe.
 *
 * Si ninguna carga, el escáner sigue funcionando con el recorte MANUAL.
 */
export const OPENCV_VERSION = '4.9.0';
const OPENCV_LOCAL = `opencv/${OPENCV_VERSION}/opencv.js`;
const OPENCV_CDN = `https://docs.opencv.org/${OPENCV_VERSION}/opencv.js`;
/** Tiempo para que el WASM (embebido en el .js) quede listo después de descargarlo. */
const TIEMPO_INICIO_MS = 45_000;

@Injectable({ providedIn: 'root' })
export class OpencvLoaderService {
  private loadPromise: Promise<any> | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) { }

  isReady(): boolean {
    return isPlatformBrowser(this.platformId) && !!(window as any).cv && !!(window as any).cv.Mat;
  }

  load(): Promise<any> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('OpenCV only available in browser'));
    }
    if (this.isReady()) return Promise.resolve((window as any).cv);
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.cargarDesde(this.rutaLocal())
      .catch((e) => {
        console.warn('[opencv] copia local no disponible, probando el CDN', e);
        return this.cargarDesde(OPENCV_CDN);
      })
      .catch((e) => {
        // Sin esto la promesa rechazada quedaba guardada y ya no se reintentaba
        // nunca en toda la sesión (aunque volviera la red).
        this.loadPromise = null;
        throw e;
      });
    return this.loadPromise;
  }

  /** Ruta local resuelta contra el `<base href>` (la app se construye con base "./"). */
  private rutaLocal(): string {
    try {
      return new URL(OPENCV_LOCAL, document.baseURI).href;
    } catch {
      return OPENCV_LOCAL;
    }
  }

  private cargarDesde(src: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const w = window as any;
      let hecho = false;

      /**
       * El `Module` de OpenCV.js es "thenable" (`Module.then(fn)` llama `fn(Module)` y
       * devuelve el mismo Module). Resolver una promesa con él hace que la promesa lo
       * vuelva a "desenvolver" sin fin: la pestaña se queda colgada. Se le quita el
       * `then` antes de entregarlo.
       */
      const listo = (cv: any) => {
        if (hecho || !cv?.Mat) return;
        hecho = true;
        try { delete cv.then; } catch { /* propiedad no configurable: no pasa en 4.x */ }
        w.cv = cv;
        resolve(cv);
      };
      const fallo = (e: Error) => {
        if (hecho) return;
        hecho = true;
        reject(e);
      };

      const esperarInicio = () => {
        const cv = w.cv;
        if (cv?.Mat) return listo(cv);
        // `Module.then` NO devuelve una promesa (devuelve el Module): nada de `.catch`.
        if (cv && typeof cv.then === 'function') {
          try { cv.then((m: any) => listo(m)); } catch { /* sigue el sondeo */ }
        }
        const inicio = Date.now();
        const tick = () => {
          if (hecho) return;
          if (w.cv?.Mat) return listo(w.cv);
          if (Date.now() - inicio > TIEMPO_INICIO_MS) return fallo(new Error('Timeout iniciando OpenCV'));
          setTimeout(tick, 80);
        };
        tick();
      };

      const existente = Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-opencv]'))
        .find(s => s.src === src);
      if (existente) {
        if (existente.dataset['opencv'] === 'cargado') return esperarInicio();
        if (existente.dataset['opencv'] === 'error') {
          existente.remove();
        } else {
          existente.addEventListener('load', esperarInicio, { once: true });
          existente.addEventListener('error', () => fallo(new Error(`No se pudo cargar OpenCV (${src})`)),
            { once: true });
          return;
        }
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      // Sin `crossOrigin`: un script clásico no necesita CORS y, si el CDN no manda
      // Access-Control-Allow-Origin, con `anonymous` el navegador lo descartaba.
      script.dataset['opencv'] = 'cargando';
      script.onload = () => {
        script.dataset['opencv'] = 'cargado';
        esperarInicio();
      };
      script.onerror = () => {
        script.dataset['opencv'] = 'error';
        fallo(new Error(`No se pudo cargar OpenCV (${src})`));
      };
      document.head.appendChild(script);
    });
  }
}

import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, from, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { NetworkStatusService } from '../services/network-status.service';
import { getLocalStorageItem } from '../utils/safe-storage';
import { toCacheKey } from '../utils/cache-key';
import { puenteOffline } from '../offline/puente-offline';

/**
 * Construye un HttpErrorResponse "fabricado" para que los callers offline
 * vean siempre la misma forma que un error de red real (status, statusText,
 * error). Antes el `from(persist())` propagaba un `Error` plano que rompía
 * los `error => Swal.fire(err.message)` de los componentes.
 */
const offlineErrorResponse = (req: HttpRequest<unknown>, message: string, cause?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({
    error: { offlineQueue: false, message, cause: cause ? String(cause) : undefined },
    status: 0,
    statusText: 'Offline (no se pudo encolar)',
    url: req.urlWithParams,
  });

const isFormData = (body: unknown): body is FormData =>
  typeof FormData !== 'undefined' && body instanceof FormData;

const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onloadend = () => {
      const result = String(fr.result || '');
      // Solo el contenido base64 (sin "data:...;base64,").
      resolve(result.replace(/^data:[^;]+;base64,/, ''));
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });

// Tope por archivo individual al encolar offline. Para PDFs/escaneos grandes
// `FileReader.readAsDataURL` carga todo en RAM como string base64 (1.33×); con
// archivos de >50MB el renderer se cuelga sin throw y el usuario nunca se
// entera. Cap conservador: 25MB por archivo y 100MB en total para todo el
// FormData. El usuario debe tener red para subir archivos más grandes.
const MAX_OFFLINE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_OFFLINE_TOTAL_BYTES = 100 * 1024 * 1024;

// Endpoints que NO deben encolarse offline. Reproducirlos después de un cambio
// de credenciales o sesión causa daño (login viejo se reproduce, refresh
// expirado, logout que cierra sesión nueva, etc.).
//
// También se excluyen DESCARGAS (responseType blob): si falla la red, no tiene
// sentido reencolar — la respuesta es un binario que el componente espera
// recibir AHORA. Reencolar oculta el error real al usuario y nunca le entrega
// el archivo.
const NEVER_QUEUE_PATHS = [
  '/gestion_admin/auth/login/',
  '/gestion_admin/auth/refresh/',
  '/gestion_admin/auth/logout/',
  '/gestion_admin/auth/register/',

  // Descargas binarias (ZIP, Excel, PDF generados): se devuelve Blob.
  '/gestion_documental/descargar-zip',
  '/EstadosRobots/descargar-zip',
  '/Robots/excel-antecedentes',
  '/Robots/full',                       // export
  '/gestion_documental/exportar',       // patrón genérico
];

const isNeverQueueable = (url: string): boolean =>
  NEVER_QUEUE_PATHS.some(p => url.includes(p));

// Las peticiones que esperan un Blob/ArrayBuffer tampoco deben encolarse,
// sin importar la URL. Reencolar un POST que devuelve binario no sirve:
// el componente que pidió la descarga necesita el binario en su Observable,
// no un "se reintentará después".
const isBinaryResponse = (req: HttpRequest<unknown>): boolean =>
  req.responseType === 'blob' || req.responseType === 'arraybuffer';

// Identificador del usuario que encola la request. Si en el futuro otro usuario
// se loguea en el mismo equipo, el sync service usa este campo para no
// reproducir la cola del usuario anterior (evita ejecutar mutaciones con el
// token equivocado).
const getCurrentUserId = (): string | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = getLocalStorageItem('user');
    if (!raw) return null;
    const u = JSON.parse(raw);
    return String(u?.numero_de_documento ?? u?.id ?? '') || null;
  } catch {
    return null;
  }
};

// Idempotency-Key reproducible: el backend (cuando lo soporte) puede deduplicar
// si la misma key se reproduce dos veces (por crash mid-replay). Vive durante
// toda la vida de la fila en sync_queue.
const generateIdempotencyKey = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fallthrough */ }
  // Fallback razonable; no necesita ser criptográficamente fuerte, solo único.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const offlineInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const networkStatus = inject(NetworkStatusService);
  // El almacén offline de este entorno: SQLite dentro de Electron, IndexedDB en
  // el navegador y en el APK. Misma forma en los tres, así que aquí no cambia
  // nada más. Devuelve null cuando no hay ninguno (SSR) y el código ya lo trata.
  const electron = puenteOffline();

  // Las peticiones de sync replay NO deben re-encolarse si fallan
  if (req.headers.has('X-Offline-Sync')) {
    return next(req);
  }

  /**
   * Encola una request multipart cuyo body es FormData. Cada File se persiste
   * a disco vía IPC y solo su referencia (ruta + metadata) queda en SQLite.
   * Así no inflamos la DB con archivos pesados ni perdemos los binarios al
   * serializar (JSON.stringify(FormData) devolvía "{}" antes de este cambio).
   */
  const handleOfflineWriteMultipart = (request: HttpRequest<FormData>): Observable<HttpEvent<unknown>> => {
    if (!electron?.offline?.saveUpload || !electron?.db?.saveMultipartRequest) {
      return throwError(() => new Error('Sin conexión. Esta build no soporta uploads offline.'));
    }

    const formData = request.body as FormData;
    const formFields: { name: string; value: string }[] = [];
    const filesToStore: { fieldName: string; file: File }[] = [];

    let formDataValid = true;
    let validationError: Error | null = null;

    formData.forEach((value, key) => {
      if (!formDataValid) return;
      if (value instanceof Blob) {
        const file = value instanceof File ? value : new File([value], 'upload.bin');
        filesToStore.push({ fieldName: key, file });
      } else if (typeof value === 'string') {
        formFields.push({ name: key, value });
      } else {
        // Defensa: el caller pasó algo que no es string ni File. String(value)
        // produciría "[object Object]" y se reproduciría así. Mejor abortar.
        formDataValid = false;
        validationError = new Error(
          `Campo "${key}" del FormData no es string ni File (${typeof value}). No se puede encolar offline.`
        );
      }
    });

    if (!formDataValid && validationError) {
      return throwError(() => validationError as Error);
    }

    // Validación de tamaño antes de tocar disco. Sin este cap, archivos
    // grandes cuelgan el renderer en `fileToBase64` o crashean por OOM.
    let totalBytes = 0;
    for (const { file } of filesToStore) {
      if (file.size > MAX_OFFLINE_FILE_BYTES) {
        return throwError(() => new Error(
          `El archivo "${file.name}" pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y excede el límite offline de ${MAX_OFFLINE_FILE_BYTES / 1024 / 1024} MB. Conéctate a la red para subirlo.`
        ));
      }
      totalBytes += file.size;
    }
    if (totalBytes > MAX_OFFLINE_TOTAL_BYTES) {
      return throwError(() => new Error(
        `El total de archivos (${(totalBytes / 1024 / 1024).toFixed(1)} MB) excede el límite offline de ${MAX_OFFLINE_TOTAL_BYTES / 1024 / 1024} MB.`
      ));
    }

    const idempotencyKey = generateIdempotencyKey();
    const userId = getCurrentUserId();

    const persist = async () => {
      const stored: { fieldName: string; fileName: string; mimeType: string | null; storedPath: string }[] = [];
      try {
        for (const { fieldName, file } of filesToStore) {
          const base64 = await fileToBase64(file);
          const res = await electron.offline.saveUpload({
            base64,
            fileName: file.name || 'upload.bin',
            mimeType: file.type || 'application/octet-stream',
          });
          if (!res?.success || !res.storedPath) {
            throw new Error(res?.error || 'No se pudo guardar el archivo offline');
          }
          stored.push({
            fieldName,
            fileName: file.name || 'upload.bin',
            mimeType: file.type || 'application/octet-stream',
            storedPath: res.storedPath,
          });
        }

        const saveRes = await electron.db.saveMultipartRequest({
          method: request.method,
          url: request.urlWithParams,
          // Content-Type se omite a propósito: al replay el browser lo regenera
          // con el boundary correcto para el nuevo FormData.
          headers: null,
          formFields,
          files: stored,
          idempotencyKey,
          userId,
        });
        if (!saveRes?.success) throw new Error(saveRes?.error || 'No se pudo guardar la request');

        window.dispatchEvent(new CustomEvent('offline-queue-updated'));
        // Evento rico para feedback al usuario (toast "guardado sin conexión").
        // Distinto de 'offline-queue-updated' (que solo refresca el contador):
        // este lleva metadata del envío para que la UI muestre un aviso claro.
        window.dispatchEvent(new CustomEvent('offline-write-queued', {
          detail: {
            method: request.method,
            url: request.urlWithParams,
            isMultipart: true,
            fileCount: stored.length,
            fileNames: stored.map(s => s.fileName),
          },
        }));
        return new HttpResponse({
          status: 200,
          body: { success: true, offlineQueue: true, id: saveRes.id, _isOfflineMock: true },
        });
      } catch (e) {
        // Rollback: si falló a mitad de camino, borrar los archivos ya escritos
        // para no acumular huérfanos en disco.
        for (const s of stored) {
          electron.offline.deleteUpload(s.storedPath).catch(() => { /* noop */ });
        }
        throw e;
      }
    };

    return (from(persist()) as Observable<HttpEvent<unknown>>).pipe(
      catchError((err: unknown) => {
        // El persist puede fallar por: error de validación previa (size cap,
        // form fields raros), saveUpload del main rechazando (disco lleno,
        // tope total), o saveMultipartRequest del DB. En todos los casos
        // devolvemos un HttpErrorResponse status 0 para que el caller del
        // HttpClient lo trate como "no se pudo subir".
        const message = (err as any)?.message || 'No se pudo encolar el envío offline';
        return throwError(() => offlineErrorResponse(request, message, err));
      })
    );
  };

  const handleOfflineWrite = (request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> => {
    if (isNeverQueueable(request.url)) {
      return throwError(() => new Error(
        'Esta operación requiere conexión y no puede encolarse offline.'
      ));
    }

    if (isFormData(request.body)) {
      return handleOfflineWriteMultipart(request as HttpRequest<FormData>);
    }
    if (electron && electron.db) {
      const idempotencyKey = generateIdempotencyKey();
      const userId = getCurrentUserId();

      // Persistencia AWAITED: si el INSERT falla (DB locked, disco lleno), la
      // promesa rechaza y la UI ve el error real en vez de un "guardado" falso
      // (antes el .then(...) era fire-and-forget).
      const persist = async (): Promise<HttpResponse<unknown>> => {
        const saveRes = await electron.db.saveRequestQueue({
          method: request.method,
          url: request.urlWithParams,
          body: request.body ? JSON.stringify(request.body) : null,
          // Headers no se persisten: replay cruza por los interceptors y se
          // re-aplican (Authorization, Content-Type). Antes JSON.stringify
          // aquí daba "{}" y era trampa para futuras refactors.
          headers: null,
          idempotencyKey,
          userId,
        });
        if (!saveRes?.success) {
          throw new Error(saveRes?.error || 'No se pudo guardar la request en la cola offline');
        }

        window.dispatchEvent(new CustomEvent('offline-queue-updated'));
        window.dispatchEvent(new CustomEvent('offline-write-queued', {
          detail: {
            method: request.method,
            url: request.urlWithParams,
            isMultipart: false,
            fileCount: 0,
            fileNames: [],
          },
        }));

        // El id real (negativo para distinguir de PKs reales) viene de la fila
        // recién insertada; antes era un random que no correspondía a nada.
        const fakeId = saveRes.id ? -Math.abs(saveRes.id) : -Math.floor(Math.random() * 1000000);
        let responseBody: any = { success: true, offlineQueue: true, id: fakeId, _isOfflineMock: true };
        if (request.body && typeof request.body === 'object') {
          const reqBody = request.body as any;
          responseBody = { ...reqBody, id: reqBody.id || fakeId, _isOfflineMock: true };
        }
        return new HttpResponse({ status: 200, body: responseBody });
      };

      return (from(persist()) as Observable<HttpEvent<unknown>>).pipe(
        catchError((err: unknown) => {
          const message = (err as any)?.message || 'No se pudo encolar el envío offline';
          return throwError(() => offlineErrorResponse(request, message, err));
        })
      );
    }

    return throwError(() => offlineErrorResponse(request, 'Offline. No se pudo guardar la petición.'));
  };

  const handleOfflineRead = (request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> => {
    if (electron && electron.db) {
      const cacheKey = toCacheKey(request.urlWithParams);
      return new Observable<HttpEvent<unknown>>(observer => {
        electron.db.cacheGet(cacheKey).then((cachedData: any) => {
          if (cachedData) {
            console.log(`[Cache Hit] Sirviendo ${request.urlWithParams} desde cache local`);
            observer.next(new HttpResponse({ status: 200, body: cachedData }));
            observer.complete();
          } else {
            observer.error(new Error('Sin conexion. No hay datos en cache para esta vista.'));
          }
        }).catch((err: any) => {
          observer.error(err);
        });
      });
    }

    return throwError(() => new Error('Sin conexion. No DB.'));
  };

  // Las requests "never-queueable" (auth + descargas binarias) saltan el
  // interceptor completo: pasan directo sin encolarse ni offline ni en retry.
  if (isNeverQueueable(req.urlWithParams) || isBinaryResponse(req)) {
    return next(req);
  }

  if (!networkStatus.isOnline) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      return handleOfflineWrite(req);
    }

    if (req.method === 'GET') {
      return handleOfflineRead(req);
    }

    return throwError(() => new Error('Sin conexion. Metodo no soportado offline.'));
  }

  return next(req).pipe(
    tap((event: HttpEvent<any>) => {
      if (event instanceof HttpResponse) {
        networkStatus.markOnline();

        if (req.method === 'GET' && electron && electron.db && event.body) {
          // Solo cacheamos respuestas JSON-serializables. Blobs/ArrayBuffers
          // se "stringificarían" como "{}" y corromperían el cache (sirviendo
          // un objeto vacío en vez del binario cuando se reusa offline).
          const isCacheable =
            req.responseType === 'json' &&
            !(event.body instanceof Blob) &&
            !(event.body instanceof ArrayBuffer) &&
            (typeof event.body === 'object' || Array.isArray(event.body));

          if (isCacheable) {
            electron.db.cacheSave({
              url: toCacheKey(req.urlWithParams),
              data: JSON.stringify(event.body)
            }).catch((error: any) => console.warn('No se pudo cachear:', error));
          }
        }
      }
    }),
    catchError((error: HttpErrorResponse) => {
      if (error.status === 0) {
        networkStatus.markOffline();

        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
          console.warn('Network call failed with status 0, queuing offline...', error);
          return handleOfflineWrite(req);
        }

        if (req.method === 'GET') {
          return handleOfflineRead(req);
        }
      }

      return throwError(() => error);
    })
  );
};

/**
 * La cola de envíos sin conexión, también fuera de Electron.
 *
 * Hasta ahora «Envíos pendientes» sólo existía en la aplicación de escritorio:
 * el interceptor y `OfflineSyncService` hablaban directamente con
 * `window.electron.db`, que es SQLite en el proceso principal. En el navegador
 * y en el APK no había cola de ninguna clase — si se caía la red a mitad de un
 * envío, se perdía y la persona sólo veía un error.
 *
 * Este puente expone EXACTAMENTE la misma forma que `window.electron`
 * (`.db.*` y `.offline.*`, mismos nombres, mismos parámetros, mismas
 * respuestas) sobre IndexedDB. Así el resto del código no cambia: pide el
 * puente en vez de leer `window.electron` y no se entera de dónde vive la cola.
 *
 * En Electron se devuelve el objeto nativo TAL CUAL: la app de escritorio, que
 * es la que hoy usan las oficinas, no cambia ni una línea de comportamiento.
 */

/** Filas de la cola, con los MISMOS nombres de columna que SQLite. */
interface FilaCola {
  id?: number;
  method: string;
  url: string;
  body: string | null;
  headers: string | null;
  timestamp: string;
  status: string;
  body_type: 'json' | 'multipart';
  idempotency_key: string | null;
  user_id: string | null;
  last_error: string | null;
  attempt_count: number;
}

interface FilaArchivo {
  id?: number;
  request_id: number;
  field_name: string;
  file_name: string;
  mime_type: string | null;
  stored_path: string;
}

const BD = 'tuapo-offline';
const VERSION = 1;
const COLA = 'sync_queue';
const ARCHIVOS = 'sync_queue_files';
const CACHE = 'api_cache';
const SUBIDAS = 'uploads';

/** Mismo tope que el proceso principal de Electron: 50 MB por archivo. */
const MAX_BYTES = 50 * 1024 * 1024;

/** Estados que acepta el proceso principal; se replican para no divergir. */
const ESTADOS = new Set(['pending', 'failed', 'syncing', 'done']);

function promesa<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let conexion: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  conexion ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(BD, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(COLA)) {
        const cola = db.createObjectStore(COLA, { keyPath: 'id', autoIncrement: true });
        cola.createIndex('status', 'status');
        cola.createIndex('user_id', 'user_id');
      }
      if (!db.objectStoreNames.contains(ARCHIVOS)) {
        const arch = db.createObjectStore(ARCHIVOS, { keyPath: 'id', autoIncrement: true });
        arch.createIndex('request_id', 'request_id');
      }
      if (!db.objectStoreNames.contains(CACHE)) {
        db.createObjectStore(CACHE, { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains(SUBIDAS)) {
        db.createObjectStore(SUBIDAS, { keyPath: 'storedPath' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
  });
  return conexion;
}

async function tx<T>(
  stores: string | string[],
  modo: IDBTransactionMode,
  trabajo: (t: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await abrir();
  const t = db.transaction(stores, modo);
  const resultado = await trabajo(t);
  // La transacción se confirma sola al vaciarse la cola de peticiones; esperarla
  // evita devolver "guardado" antes de que el dato esté realmente en disco.
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transacción abortada'));
  });
  return resultado;
}

/** Sólo lo necesario para ordenar y filtrar como hace el SQL de Electron. */
async function todasLasFilas(t: IDBTransaction): Promise<FilaCola[]> {
  return await promesa(t.objectStore(COLA).getAll() as IDBRequest<FilaCola[]>);
}

function filtrarPorUsuario(filas: FilaCola[], estado: string, userId?: string | null): FilaCola[] {
  return filas
    .filter(f => f.status === estado)
    // Igual que el SQL: sin user_id la fila es de todos (compat retro); con él,
    // sólo la ve su dueño, para que un segundo usuario del mismo equipo no
    // reproduzca la cola del primero con SU token.
    .filter(f => !userId || !f.user_id || f.user_id === userId)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

async function borrarArchivosDe(t: IDBTransaction, requestId: number): Promise<void> {
  const idx = t.objectStore(ARCHIVOS).index('request_id');
  const filas = await promesa(idx.getAll(requestId) as IDBRequest<FilaArchivo[]>);
  for (const f of filas) {
    if (f.id !== undefined) t.objectStore(ARCHIVOS).delete(f.id);
    t.objectStore(SUBIDAS).delete(f.stored_path);
  }
}

function base64ABytes(base64: string): Uint8Array {
  const limpio = base64.replace(/^data:[^;]+;base64,/, '');
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function bytesABase64(bytes: Uint8Array): string {
  // En trozos: un `String.fromCharCode(...bytes)` de 50 MB revienta la pila.
  let binario = '';
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}

/** Implementación IndexedDB con la forma exacta de `window.electron`. */
function puenteWeb() {
  return {
    db: {
      async saveRequestQueue(payload: {
        method: string; url: string; body?: string | null; headers?: string | null;
        idempotencyKey?: string | null; userId?: string | null;
      }) {
        const { method, url } = payload || ({} as never);
        if (!method || !url) throw new Error('method/url requeridos');
        const fila: FilaCola = {
          method, url,
          body: payload.body ?? null,
          headers: payload.headers ?? null,
          timestamp: new Date().toISOString(),
          status: 'pending',
          body_type: 'json',
          idempotency_key: payload.idempotencyKey ?? null,
          user_id: payload.userId ?? null,
          last_error: null,
          attempt_count: 0,
        };
        let id = 0;
        await tx(COLA, 'readwrite', async t => {
          id = (await promesa(t.objectStore(COLA).add(fila) as IDBRequest<number>)) as number;
        });
        return { success: true, id };
      },

      async saveMultipartRequest(payload: {
        method: string; url: string; headers?: string | null;
        formFields?: unknown[]; files?: { fieldName: string; fileName: string; mimeType: string | null; storedPath: string }[];
        idempotencyKey?: string | null; userId?: string | null;
      }) {
        const { method, url } = payload || ({} as never);
        if (!method || !url) throw new Error('method/url requeridos');
        const fila: FilaCola = {
          method, url,
          body: JSON.stringify(payload.formFields || []),
          headers: payload.headers ?? null,
          timestamp: new Date().toISOString(),
          status: 'pending',
          body_type: 'multipart',
          idempotency_key: payload.idempotencyKey ?? null,
          user_id: payload.userId ?? null,
          last_error: null,
          attempt_count: 0,
        };
        let id = 0;
        await tx([COLA, ARCHIVOS], 'readwrite', async t => {
          id = (await promesa(t.objectStore(COLA).add(fila) as IDBRequest<number>)) as number;
          for (const f of payload.files || []) {
            t.objectStore(ARCHIVOS).add({
              request_id: id,
              field_name: f.fieldName,
              file_name: f.fileName,
              mime_type: f.mimeType ?? null,
              stored_path: f.storedPath,
            } as FilaArchivo);
          }
        });
        return { success: true, id };
      },

      async getRequestFiles(requestId: number) {
        return await tx(ARCHIVOS, 'readonly', async t =>
          await promesa(t.objectStore(ARCHIVOS).index('request_id').getAll(requestId) as IDBRequest<FilaArchivo[]>));
      },

      async getPendingRequests(opts?: { userId?: string | null }) {
        return await tx(COLA, 'readonly', async t =>
          filtrarPorUsuario(await todasLasFilas(t), 'pending', opts?.userId));
      },

      async getFailedRequests(opts?: { userId?: string | null }) {
        return await tx(COLA, 'readonly', async t =>
          filtrarPorUsuario(await todasLasFilas(t), 'failed', opts?.userId));
      },

      async deleteRequest(id: number) {
        await tx([COLA, ARCHIVOS, SUBIDAS], 'readwrite', async t => {
          await borrarArchivosDe(t, id);
          t.objectStore(COLA).delete(id);
        });
        return { success: true, changes: 1 };
      },

      /** Descartar es explícito: se lleva por delante los archivos guardados. */
      async discardRequest(id: number) {
        return await this.deleteRequest(id);
      },

      async retryRequest(id: number) {
        await tx(COLA, 'readwrite', async t => {
          const fila = await promesa(t.objectStore(COLA).get(id) as IDBRequest<FilaCola | undefined>);
          if (fila) {
            fila.status = 'pending';
            fila.last_error = null;
            t.objectStore(COLA).put(fila);
          }
        });
        return { success: true, changes: 1 };
      },

      async markRequestStatus(payload: { id: number; status: string; error?: string | null }) {
        const { id, status } = payload || ({} as never);
        if (!ESTADOS.has(status)) throw new Error(`Estado no permitido: ${status}`);
        await tx(COLA, 'readwrite', async t => {
          const fila = await promesa(t.objectStore(COLA).get(id) as IDBRequest<FilaCola | undefined>);
          if (!fila) return;
          fila.status = status;
          // Como en SQLite: los archivos NO se borran al marcar 'failed', o la
          // persona no podría reintentar el envío con los datos corregidos.
          if (payload.error) fila.last_error = String(payload.error).slice(0, 1000);
          fila.attempt_count = (fila.attempt_count || 0) + 1;
          t.objectStore(COLA).put(fila);
        });
        return { success: true, changes: 1 };
      },

      async cacheSave(payload: { url: string; data: string }) {
        await tx(CACHE, 'readwrite', async t => {
          t.objectStore(CACHE).put({ url: payload.url, data: payload.data, updated_at: new Date().toISOString() });
        });
        return { success: true };
      },

      async cacheGet(url: string) {
        const fila = await tx(CACHE, 'readonly', async t =>
          await promesa(t.objectStore(CACHE).get(url) as IDBRequest<{ data: string } | undefined>));
        if (!fila?.data) return null;
        try {
          return JSON.parse(fila.data);
        } catch {
          // Igual que Electron: una fila corrupta se trata como "no hay caché".
          return null;
        }
      },

      async cacheGetAllUrls() {
        return await tx(CACHE, 'readonly', async t =>
          await promesa(t.objectStore(CACHE).getAllKeys() as IDBRequest<IDBValidKey[]>)) as string[];
      },

      async cacheInvalidatePrefix(prefix: string) {
        let borradas = 0;
        await tx(CACHE, 'readwrite', async t => {
          const claves = await promesa(t.objectStore(CACHE).getAllKeys() as IDBRequest<IDBValidKey[]>);
          for (const k of claves) {
            if (typeof k === 'string' && k.startsWith(prefix)) {
              t.objectStore(CACHE).delete(k);
              borradas++;
            }
          }
        });
        return { success: true, changes: borradas };
      },

      async clearCache() {
        await tx(CACHE, 'readwrite', async t => { t.objectStore(CACHE).clear(); });
        return { success: true };
      },

      /** Sólo en logout explícito: se lleva la cola y los archivos con ella. */
      async clearQueue() {
        await tx([COLA, ARCHIVOS, SUBIDAS], 'readwrite', async t => {
          t.objectStore(COLA).clear();
          t.objectStore(ARCHIVOS).clear();
          t.objectStore(SUBIDAS).clear();
        });
        return { success: true };
      },

      async clearUserData() {
        await this.clearCache();
        await this.clearQueue();
        return { success: true };
      },
    },

    offline: {
      async saveUpload(payload: { base64: string; fileName: string; mimeType: string }) {
        try {
          const { base64 } = payload || ({} as never);
          if (typeof base64 !== 'string' || !base64.length) {
            return { success: false, error: 'base64 vacío' };
          }
          const bytes = base64ABytes(base64);
          if (bytes.byteLength > MAX_BYTES) {
            return { success: false, error: `Archivo excede ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB` };
          }
          // `storedPath` es sólo una clave: en Electron es una ruta de disco y
          // aquí una clave de IndexedDB. El resto del código nunca la abre.
          const storedPath = `idb://uploads/${crypto.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2)}`;
          await tx(SUBIDAS, 'readwrite', async t => {
            t.objectStore(SUBIDAS).put({
              storedPath,
              blob: new Blob([bytes as BlobPart], { type: payload.mimeType || 'application/octet-stream' }),
              fileName: payload.fileName,
            });
          });
          return { success: true, storedPath };
        } catch (e: unknown) {
          // QuotaExceededError entra por aquí: el navegador no tiene sitio.
          return { success: false, error: (e as Error)?.message || 'No se pudo guardar el archivo' };
        }
      },

      async readUpload(storedPath: string) {
        try {
          const fila = await tx(SUBIDAS, 'readonly', async t =>
            await promesa(t.objectStore(SUBIDAS).get(storedPath) as IDBRequest<{ blob: Blob } | undefined>));
          if (!fila?.blob) return { success: false, error: 'Archivo no encontrado' };
          const bytes = new Uint8Array(await fila.blob.arrayBuffer());
          return { success: true, base64: bytesABase64(bytes) };
        } catch (e: unknown) {
          return { success: false, error: (e as Error)?.message || 'No se pudo leer el archivo' };
        }
      },

      async deleteUpload(storedPath: string) {
        try {
          await tx(SUBIDAS, 'readwrite', async t => { t.objectStore(SUBIDAS).delete(storedPath); });
          return { success: true };
        } catch (e: unknown) {
          return { success: false, error: (e as Error)?.message || 'No se pudo borrar el archivo' };
        }
      },
    },
  };
}

let cacheWeb: ReturnType<typeof puenteWeb> | null = null;

/**
 * El almacén offline de este entorno, o null si no hay ninguno (SSR, o un
 * navegador con IndexedDB bloqueada: modo privado estricto, cookies de
 * terceros desactivadas…). Quien lo llama ya sabe tratar el null — es
 * exactamente lo que hacía cuando `window.electron` no existía.
 */
export function puenteOffline(): any | null {
  if (typeof window === 'undefined') return null;

  const nativo = (window as any).electron;
  if (nativo?.db) return nativo;

  try {
    if (!('indexedDB' in window) || !window.indexedDB) return null;
  } catch {
    return null;
  }

  cacheWeb ??= puenteWeb();
  return cacheWeb;
}

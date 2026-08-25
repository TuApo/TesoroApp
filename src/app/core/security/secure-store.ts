/**
 * Almacén local para el acceso rápido, con dos backends según el entorno.
 *
 * **Escritorio (Electron)** → vault del proceso principal, cifrado con la
 * credencial del sistema operativo (`safeStorage`: DPAPI / Keychain /
 * libsecret) y escrito con permisos 0600 en el perfil del usuario. Se prefiere
 * este backend porque la ventana carga con `file://`, un origen que no ofrece
 * garantías de almacenamiento web.
 *
 * **Navegador y APK Android** → IndexedDB. Además de strings guarda objetos
 * `CryptoKey` **no extraíbles**: la clave existe dentro del navegador pero su
 * material nunca es visible para JavaScript (ni para un XSS, ni copiando el
 * perfil a mano). Ese es el ancla que ata el acceso rápido a ESE dispositivo.
 *
 * Por qué no localStorage en ningún caso: solo guarda strings (no serviría
 * para claves no extraíbles) y el logout llama `clearLocalStorage()`, con lo
 * que el acceso guardado se borraría en cada cierre de sesión — justo lo
 * contrario de lo que se busca.
 *
 * Todo va con guards de SSR y try/catch: si ningún backend está disponible, el
 * acceso rápido se apaga solo y el login normal sigue intacto.
 */

const DB_NAME = 'tuapo-secure';
const DB_VERSION = 1;
const STORE = 'vault';

function hasIndexedDb(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

/** Web Crypto solo existe en contextos seguros (https, localhost, WebView). */
export function hasWebCrypto(): boolean {
  try {
    return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
  } catch {
    return false;
  }
}

export type BackendAlmacen = 'electron' | 'indexeddb' | 'ninguno';

/** Puente `window.electron.secure` expuesto por el preload de Electron. */
export function electronSecure(): any | null {
  try {
    return (window as any)?.electron?.secure ?? null;
  } catch {
    return null;
  }
}

let backendCache: BackendAlmacen | null = null;

/**
 * Elige backend UNA vez por sesión. En Electron se exige que `safeStorage`
 * tenga un backend real del SO: en un Linux sin keyring, Electron cifraría con
 * una clave fija y eso no protegería nada, así que se cae a IndexedDB y, si
 * tampoco está, el acceso rápido queda deshabilitado.
 */
export async function elegirBackend(): Promise<BackendAlmacen> {
  if (backendCache) return backendCache;

  const secure = electronSecure();
  if (secure?.available) {
    try {
      if (await secure.available()) {
        backendCache = 'electron';
        return backendCache;
      }
    } catch { /* seguimos con IndexedDB */ }
  }

  if (hasIndexedDb() && hasWebCrypto() && (await openDb()) !== null) {
    backendCache = 'indexeddb';
    return backendCache;
  }

  backendCache = 'ninguno';
  return backendCache;
}

export async function secureStorageDisponible(): Promise<boolean> {
  return (await elegirBackend()) !== 'ninguno';
}

/** Solo para diagnóstico y textos de la UI; no decide nada por sí mismo. */
export function backendActual(): BackendAlmacen | null {
  return backendCache;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise(resolve => {
    let req: IDBOpenDBRequest;
    try {
      req = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then(db => {
    if (!db) return null;
    return new Promise<T | null>(resolve => {
      let request: IDBRequest;
      try {
        request = fn(db.transaction(STORE, mode).objectStore(STORE));
      } catch {
        db.close();
        resolve(null);
        return;
      }
      request.onsuccess = () => { db.close(); resolve(request.result as T); };
      request.onerror = () => { db.close(); resolve(null); };
    });
  }).catch(() => null);
}

export async function vaultGet<T>(key: string): Promise<T | null> {
  if (await elegirBackend() === 'electron') {
    try {
      return (await electronSecure().vaultGet(key)) as T | null;
    } catch {
      return null;
    }
  }
  return tx<T>('readonly', s => s.get(key));
}

export async function vaultSet(key: string, value: unknown): Promise<void> {
  if (await elegirBackend() === 'electron') {
    try { await electronSecure().vaultSet(key, value); } catch { /* noop */ }
    return;
  }
  await tx('readwrite', s => s.put(value, key));
}

export async function vaultDelete(key: string): Promise<void> {
  if (await elegirBackend() === 'electron') {
    try { await electronSecure().vaultDelete(key); } catch { /* noop */ }
    return;
  }
  await tx('readwrite', s => s.delete(key));
}

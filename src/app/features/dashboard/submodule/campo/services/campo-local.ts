import { ElementoCola, Paquete, Punto } from '../campo.models';

/**
 * Lo que el teléfono guarda para trabajar sin señal, en IndexedDB (sobrevive a cerrar la
 * app y al modo avión; localStorage se queda corto con las selfies y los audios):
 *  · `kv`     → el último paquete descargado (fincas, agenda, tareas, canales).
 *  · `cola`   → marcaciones, cierres de tarea y transmisiones de radio por mandar.
 *  · `puntos` → posiciones tomadas sin señal.
 * Los mosaicos del mapa van aparte, en Cache Storage (ver mapa-campo).
 *
 * Todo se separa por usuario: un mismo teléfono puede compartirse entre turnos.
 */
const BASE = 'tuapo-campo';
const VERSION = 1;

let abierta: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (abierta) return abierta;
  abierta = new Promise((ok, mal) => {
    if (typeof indexedDB === 'undefined') { mal(new Error('Sin IndexedDB')); return; }
    const r = indexedDB.open(BASE, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('cola')) d.createObjectStore('cola', { keyPath: 'id' }).createIndex('usuario', 'usuario');
      if (!d.objectStoreNames.contains('puntos')) d.createObjectStore('puntos', { autoIncrement: true }).createIndex('usuario', 'usuario');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { abierta = null; mal(r.error); };
  });
  return abierta;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
}

async function tienda(nombre: string, modo: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  return (await db()).transaction(nombre, modo).objectStore(nombre);
}

export const CampoLocal = {
  async guardarPaquete(usuario: string, p: Paquete): Promise<void> {
    await req((await tienda('kv', 'readwrite')).put(p, `paquete:${usuario}`));
  },

  async paquete(usuario: string): Promise<Paquete | null> {
    try { return (await req((await tienda('kv')).get(`paquete:${usuario}`))) as Paquete ?? null; }
    catch { return null; }
  },

  async guardarDato(clave: string, valor: unknown): Promise<void> {
    await req((await tienda('kv', 'readwrite')).put(valor, clave));
  },

  async dato<T>(clave: string): Promise<T | null> {
    try { return ((await req((await tienda('kv')).get(clave))) as T) ?? null; } catch { return null; }
  },

  async encolar(usuario: string, e: ElementoCola): Promise<void> {
    await req((await tienda('cola', 'readwrite')).put({ ...e, usuario }));
  },

  async cola(usuario: string): Promise<ElementoCola[]> {
    try {
      const l = (await req((await tienda('cola')).index('usuario').getAll(usuario))) as ElementoCola[];
      return l.sort((a, b) => a.creado_ms - b.creado_ms);
    } catch { return []; }
  },

  async actualizar(usuario: string, e: ElementoCola): Promise<void> {
    await req((await tienda('cola', 'readwrite')).put({ ...e, usuario }));
  },

  async quitar(id: string): Promise<void> {
    await req((await tienda('cola', 'readwrite')).delete(id));
  },

  async guardarPunto(usuario: string, p: Punto): Promise<void> {
    await req((await tienda('puntos', 'readwrite')).add({ ...p, usuario }));
  },

  /** Saca hasta `max` puntos guardados (con sus claves para borrarlos tras enviarlos). */
  async puntos(usuario: string, max = 400): Promise<{ claves: IDBValidKey[]; puntos: Punto[] }> {
    try {
      const t = await tienda('puntos');
      const claves = (await req(t.index('usuario').getAllKeys(usuario, max))) as IDBValidKey[];
      const filas = (await req(t.index('usuario').getAll(usuario, max))) as (Punto & { usuario: string })[];
      return { claves, puntos: filas.map(({ usuario: _u, ...p }) => p) };
    } catch { return { claves: [], puntos: [] }; }
  },

  async borrarPuntos(claves: IDBValidKey[]): Promise<void> {
    if (!claves.length) return;
    const t = (await db()).transaction('puntos', 'readwrite');
    const s = t.objectStore('puntos');
    for (const k of claves) s.delete(k);
    await new Promise<void>((ok, mal) => { t.oncomplete = () => ok(); t.onerror = () => mal(t.error); });
  },

  async contarPuntos(usuario: string): Promise<number> {
    try { return await req((await tienda('puntos')).index('usuario').count(usuario)); } catch { return 0; }
  },
};

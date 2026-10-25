/**
 * Archivos que la app guarda para trabajar sin señal (selfies, audios de radio, fotos, firmas y
 * adjuntos de formularios) y paquetes JSON grandes (personal, formularios).
 *
 * En el APK van a la carpeta PRIVADA de la app (`Directory.Data`, Filesystem de Capacitor):
 * no los ve la galería ni otras apps, no se borran al limpiar la caché del navegador interno y
 * solo desaparecen al desinstalar o con «Borrar datos». En web caen a IndexedDB.
 *
 * Todo cuelga de `tuapo/<usuario>/…`: un teléfono compartido no mezcla a dos personas, y al
 * cerrar sesión se puede borrar lo de esa persona.
 */

import { esNativo } from './nativo';

const RAIZ = 'tuapo';

let idb: Promise<IDBDatabase> | null = null;

function web(): Promise<IDBDatabase> {
  idb ??= new Promise((ok, mal) => {
    const r = indexedDB.open('tuapo-archivos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('archivos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { idb = null; mal(r.error); };
  });
  return idb;
}

async function webOp<T>(modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await web();
  return new Promise((ok, mal) => {
    const r = f(d.transaction('archivos', modo).objectStore('archivos'));
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

function ruta(usuario: string, rel: string): string {
  return `${RAIZ}/${usuario || 'anonimo'}/${rel.replace(/^\/+/, '')}`;
}

function aBase64(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onloadend = () => ok(String(fr.result).replace(/^data:[^;]*;base64,/, ''));
    fr.onerror = () => mal(fr.error);
    fr.readAsDataURL(b);
  });
}

function deBase64(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}

export const ArchivosNativos = {
  /** Guarda un archivo; devuelve la ruta relativa con la que se vuelve a leer. */
  async guardar(usuario: string, rel: string, b: Blob): Promise<string> {
    const p = ruta(usuario, rel);
    if (esNativo()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.writeFile({ path: p, data: await aBase64(b), directory: Directory.Data, recursive: true });
      await Filesystem.writeFile({ path: `${p}.mime`, data: b.type || 'application/octet-stream', directory: Directory.Data, encoding: 'utf8' as any });
    } else {
      await webOp('readwrite', s => s.put(b, p));
    }
    return rel;
  },

  async leer(usuario: string, rel: string): Promise<Blob | null> {
    const p = ruta(usuario, rel);
    try {
      if (esNativo()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const [d, m] = await Promise.all([
          Filesystem.readFile({ path: p, directory: Directory.Data }),
          Filesystem.readFile({ path: `${p}.mime`, directory: Directory.Data, encoding: 'utf8' as any }).catch(() => ({ data: 'application/octet-stream' })),
        ]);
        return deBase64(String(d.data), String(m.data));
      }
      return ((await webOp('readonly', s => s.get(p))) as Blob) ?? null;
    } catch {
      return null;
    }
  },

  async borrar(usuario: string, rel: string): Promise<void> {
    const p = ruta(usuario, rel);
    try {
      if (esNativo()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        await Filesystem.deleteFile({ path: p, directory: Directory.Data }).catch(() => undefined);
        await Filesystem.deleteFile({ path: `${p}.mime`, directory: Directory.Data }).catch(() => undefined);
      } else {
        await webOp('readwrite', s => s.delete(p));
      }
    } catch { /* ya no estaba */ }
  },

  async guardarJson(usuario: string, rel: string, v: unknown): Promise<void> {
    const texto = JSON.stringify(v);
    if (esNativo()) {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      await Filesystem.writeFile({ path: ruta(usuario, rel), data: texto, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    } else {
      await webOp('readwrite', s => s.put(texto, ruta(usuario, rel)));
    }
  },

  async leerJson<T>(usuario: string, rel: string): Promise<T | null> {
    try {
      if (esNativo()) {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        const d = await Filesystem.readFile({ path: ruta(usuario, rel), directory: Directory.Data, encoding: Encoding.UTF8 });
        return JSON.parse(String(d.data)) as T;
      }
      const t = await webOp('readonly', s => s.get(ruta(usuario, rel)));
      return typeof t === 'string' ? JSON.parse(t) as T : null;
    } catch {
      return null;
    }
  },

  /** Borra TODO lo guardado de una persona (al cerrar sesión). */
  async borrarUsuario(usuario: string): Promise<void> {
    try {
      if (esNativo()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        await Filesystem.rmdir({ path: `${RAIZ}/${usuario}`, directory: Directory.Data, recursive: true }).catch(() => undefined);
      } else {
        const d = await web();
        const pref = ruta(usuario, '');
        await new Promise<void>((ok, mal) => {
          const t = d.transaction('archivos', 'readwrite');
          const r = t.objectStore('archivos').openCursor();
          r.onsuccess = () => { const c = r.result; if (!c) return; if (String(c.key).startsWith(pref)) c.delete(); c.continue(); };
          t.oncomplete = () => ok();
          t.onerror = () => mal(t.error);
        });
      }
    } catch { /* nada que borrar */ }
  },
};

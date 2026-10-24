/**
 * Descargas en el APK.
 *
 * La app genera archivos en el navegador (PDF, Excel, ZIP, CSV…) y los «descarga» con un
 * `<a download href="blob:…">` (directo o vía file-saver). En la WebView de Android eso NO hace
 * nada: no hay gestor de descargas. Aquí, solo en nativo, se interceptan esas descargas: el
 * archivo se guarda en el teléfono (Filesystem) y se abre el menú del sistema para guardarlo en
 * Descargas/Drive, abrirlo con otra app o enviarlo por WhatsApp/correo (@capacitor/share).
 *
 * Se cubren los dos caminos que usa el código: `a.click()` y `a.dispatchEvent(new MouseEvent('click'))`
 * (file-saver crea el enlace sin insertarlo en el documento, así que un listener global no lo vería).
 */

import { esNativo } from './nativo';

let instalado = false;

function esDescargaLocal(a: HTMLAnchorElement): boolean {
  const href = a.getAttribute('href') || '';
  return a.hasAttribute('download') && (href.startsWith('blob:') || href.startsWith('data:'));
}

function nombreSeguro(n: string): string {
  return (n || 'archivo').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'archivo';
}

function aBase64(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onloadend = () => ok(String(fr.result).replace(/^data:[^;]*;base64,/, ''));
    fr.onerror = () => mal(fr.error);
    fr.readAsDataURL(b);
  });
}

async function guardarYCompartir(href: string, nombre: string): Promise<void> {
  try {
    const blob = await (await fetch(href)).blob();
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const archivo = nombreSeguro(nombre);
    const r = await Filesystem.writeFile({
      path: `descargas/${Date.now()}-${archivo}`, data: await aBase64(blob), directory: Directory.Cache, recursive: true,
    });
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: archivo, files: [r.uri], dialogTitle: 'Guardar o abrir el archivo' });
  } catch (e: any) {
    // Cancelar el menú del sistema no es un error.
    if (!/cancel/i.test(String(e?.message ?? e))) console.error('[descargas] no se pudo entregar el archivo', e);
  }
}

/** Se llama una vez al arrancar la app. En web y Electron no hace nada. */
export function instalarDescargasNativas(): void {
  if (instalado || typeof window === 'undefined' || !esNativo()) return;
  instalado = true;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    if (esDescargaLocal(this)) { void guardarYCompartir(this.getAttribute('href')!, this.getAttribute('download') || 'archivo'); return; }
    click.call(this);
  };
  const despachar = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (this: HTMLAnchorElement, ev: Event): boolean {
    if (ev.type === 'click' && esDescargaLocal(this)) {
      void guardarYCompartir(this.getAttribute('href')!, this.getAttribute('download') || 'archivo');
      return false;
    }
    return despachar.call(this, ev);
  };
}

/**
 * Archivos que se le dan a una IA desde el navegador: fotos reducidas antes de subir y capturas o
 * archivos pegados con nombre legible. Lo usan el chat estándar y MatIA (que lo importa directo,
 * sin el resto del chat).
 */

/** Fotos a máx. 1600 px en JPEG: suben rápido y la IA las lee igual de bien. GIF y SVG quedan igual. */
export async function reducirImagen(f: File): Promise<Blob> {
  try {
    if (f.type === 'image/gif' || f.type === 'image/svg+xml') return f;
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (k === 1 && f.size < 2_000_000 && f.type !== 'image/heic') return f;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>(ok => c.toBlob(b => ok(b ?? f), 'image/jpeg', 0.86));
  } catch {
    return f;
  }
}

/** Nombre con que sube un archivo: si la foto se pasó a JPEG, con extensión .jpg. */
export function nombreAlSubir(f: File, subido: Blob): string {
  return subido !== f && !/\.jpe?g$/i.test(f.name) ? (f.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg' : (f.name || 'archivo');
}

/** Los archivos de un pegado (captura, foto copiada, archivos del explorador); las capturas sin nombre se llaman captura-HHMMSS. */
export function archivosPegados(e: ClipboardEvent): File[] {
  const archivos = Array.from(e.clipboardData?.files ?? []);
  return archivos.map((f, i) => f.name && f.name !== 'image.png' ? f
    : new File([f], `captura-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}${i ? '-' + i : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }));
}

/** Si lo que se arrastra encima trae archivos (y no texto o un enlace). */
export function traeArchivos(e: DragEvent): boolean {
  return !!e.dataTransfer?.types?.includes('Files');
}

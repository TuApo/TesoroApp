/** Utilidades de piezas sin dependencias de componentes (evita ciclos entre páginas y renderizador). */

/** Id de un video de YouTube a partir de cualquiera de sus formas de enlace. */
export function idYoutube(url: string | null): string | null {
  if (!url) return null;
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(url);
  return m ? m[1] : null;
}

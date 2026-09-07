/**
 * Lo que comparten el plano y la escena SIN arrastrar three.js.
 *
 * Existe por una razon concreta de empaquetado: `oficina-plano` lo usa el
 * componente en carga normal, y `builders` lo usa la escena que entra por
 * import() dinamico. Si ambos lo sacaran de `builders`, el chunk de three (~570 KB)
 * quedaria enganchado al chunk de la ruta y el import() dinamico no serviria de nada.
 */

/** Hash estable de texto → entero, para repartir color por categoria sin sorpresas. */
export function hashTexto(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Un documento del modulo Conocimiento, tal como lo pinta el cerebro. */
export interface NodoCerebro {
  id: number;
  nombre: string;
  modulos: string[];
  peso: number;
}

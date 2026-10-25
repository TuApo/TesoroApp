/**
 * Saca el número de cédula de lo que leyó el escáner.
 *
 * <ul>
 *   <li>Solo dígitos (6 a 11): es el número tecleado o un código que ya lo trae limpio.</li>
 *   <li>PDF417 del reverso de la cédula amarilla con hologramas: el número va en las
 *       posiciones 48–58, con ceros a la izquierda.</li>
 *   <li>Cualquier otra cosa (QR de la cédula digital, carné): el primer grupo de 6 a 10
 *       dígitos seguidos.</li>
 * </ul>
 *
 * <p>Es una ayuda para no teclear: la pantalla pone el número en el campo y la persona lo
 * confirma antes de buscar. Si no hay nada que se parezca a una cédula devuelve null.
 */
export function cedulaDesdeCodigo(texto: string): string | null {
  const t = (texto || '').trim();
  if (!t) return null;
  if (/^\d{6,11}$/.test(t)) return t.replace(/^0+/, '') || null;
  if (t.length >= 58) {
    const bloque = t.substring(48, 58);
    if (/^\d{10}$/.test(bloque)) {
      const n = bloque.replace(/^0+/, '');
      if (n.length >= 6) return n;
    }
  }
  const m = t.match(/(?<!\d)\d{6,10}(?!\d)/);
  return m ? m[0].replace(/^0+/, '') : null;
}

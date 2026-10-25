/**
 * Régimen que reportó ADRES (ms-hr V65, `adres_regimen` de la vista de afiliaciones).
 *
 * Además de CONTRIBUTIVO / SUBSIDIADO / Sin Registro, ms-automation deja la marca
 * 'EXCEPCION O ESPECIAL (OBSERVACION ADRES)' cuando la observación solo viene en el PDF.
 * Régimen especial o de excepción (Fuerzas Militares, Policía, Magisterio, Ecopetrol) es
 * lo que hay que ver antes de afiliar: sale resaltado.
 */

/** Sin tildes, mayúsculas y espacios colapsados. */
function norm(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** `true` si ADRES reporta régimen especial o de excepción. */
export function esRegimenExcepcion(regimen: unknown): boolean {
  const r = norm(regimen);
  return r.includes('EXCEPCION') || r.includes('ESPECIAL');
}

/** Texto corto para la tabla: la marca larga del PDF se lee como "Especial/excepción". */
export function etiquetaRegimenAdres(regimen: unknown): string {
  if (!norm(regimen) || norm(regimen) === 'NULL') return '';
  return esRegimenExcepcion(regimen) ? 'Especial/excepción' : String(regimen).trim();
}

/** Clase del chip (reusa las de estado ADRES de confirmación de ingresos). */
export function regimenAdresClass(regimen: unknown): string {
  const r = norm(regimen);
  if (esRegimenExcepcion(r)) return 'adres-excepcion';
  if (r === 'SIN REGISTRO') return 'adres-bad';
  if (r === 'CONTRIBUTIVO' || r === 'SUBSIDIADO') return 'adres-ok';
  return 'adres-neutro';
}

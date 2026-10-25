/**
 * Precarga del registro de una persona NUEVA con lo que ya trajeron los robots.
 *
 * Contratación › Consulta de antecedentes consulta cédulas antes de que la persona
 * se registre; ADRES deja sus nombres y apellidos. Al buscar esa cédula en el
 * pipeline y no encontrar candidato, la entrevista arranca con esos datos en vez
 * de en blanco. Solo se proponen: el operador los revisa y guarda.
 */

export interface NombresPrecarga {
  primer_nombre: string | null;
  segundo_nombre: string | null;
  primer_apellido: string | null;
  segundo_apellido: string | null;
}

const limpio = (v: unknown): string | null => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s ? s : null;
};

/** "MARIA DE LOS ANGELES" → ["MARIA", "DE LOS ANGELES"]. */
function partir(v: unknown): [string | null, string | null] {
  const s = limpio(v);
  if (!s) return [null, null];
  const i = s.indexOf(' ');
  return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)];
}

/** Nombres de ADRES (dos campos de texto libre) → los cuatro campos del formulario. */
export function nombresDesdeAdres(nombre: unknown, apellido: unknown): NombresPrecarga | null {
  const [pn, sn] = partir(nombre);
  const [pa, sa] = partir(apellido);
  if (!pn && !pa) return null;
  return { primer_nombre: pn, segundo_nombre: sn, primer_apellido: pa, segundo_apellido: sa };
}

/** Solo cédulas numéricas: es lo único que la cola del robot consulta. */
export function cedulaPrecargable(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^\d{5,11}$/.test(s) ? s : null;
}

import { sinTildes } from './sin-tildes.helper';

/**
 * Fondo de cesantías (AFC) del contrato — requerimiento 6 de la ficha técnica (2026-10-22).
 *
 * La columna `cesantias` del contrato la llenaba solo el cruce del Excel ("PROTECCIÓN",
 * "PORVENIR"… y alguna errata como "PORTECCION"); en Contratación no había casilla.
 * Ahora es una lista cerrada y, si el contrato no la tiene, se propone la AFP de Selección:
 * casi siempre es el mismo fondo. Colpensiones no maneja cesantías, así que no propone nada.
 */
export const FONDOS_CESANTIAS = ['PORVENIR', 'PROTECCIÓN', 'COLFONDOS', 'SKANDIA', 'FONDO NACIONAL DEL AHORRO'] as const;

/** Palabras con las que se reconoce cada fondo en lo ya guardado (sin tildes, mayúsculas). */
const RECONOCER: ReadonlyArray<readonly [string, string]> = [
  ['PORVENIR', 'PORVENIR'],
  ['PROTEC', 'PROTECCIÓN'],
  ['PORTEC', 'PROTECCIÓN'],
  ['COLFONDOS', 'COLFONDOS'],
  ['SKANDIA', 'SKANDIA'],
  ['OLD MUTUAL', 'SKANDIA'],
  ['FONDO NACIONAL', 'FONDO NACIONAL DEL AHORRO'],
  ['FNA', 'FONDO NACIONAL DEL AHORRO'],
];

/**
 * El nombre del catálogo para un valor guardado; un texto que no es ningún fondo conocido
 * se devuelve tal cual (la casilla lo muestra como opción extra y no se pierde). Vacío = null.
 */
export function fondoCesantias(valor: unknown): string | null {
  const t = String(valor ?? '').trim();
  if (!t) return null;
  const clave = sinTildes(t).toUpperCase();
  const hit = RECONOCER.find(([palabra]) => clave.includes(palabra));
  return hit ? hit[1] : t;
}

/** Propuesta desde la AFP registrada en Selección (`proceso.antecedentes[nombre=AFP]`). */
export function fondoCesantiasDesdeAfp(antecedentes: unknown): string | null {
  if (!Array.isArray(antecedentes)) return null;
  const afp = antecedentes.find((a: any) => String(a?.nombre ?? '').trim().toUpperCase() === 'AFP');
  const fondo = fondoCesantias(afp?.observacion);
  return fondo && (FONDOS_CESANTIAS as readonly string[]).includes(fondo) ? fondo : null;
}

/** Opciones de la casilla: el catálogo y, si lo guardado no está en él, lo guardado. */
export function opcionesFondoCesantias(actual: unknown): string[] {
  const base: string[] = [...FONDOS_CESANTIAS];
  const t = String(actual ?? '').trim();
  return t && !base.includes(t) ? [...base, t] : base;
}

/**
 * Carga masiva de exámenes médicos (pedido #11) — lógica pura, sin Angular.
 *
 * La pantalla lee varios PDF (o un ZIP), el backend cruza la cédula del nombre
 * de cada archivo con la persona y su proceso abierto, el operador revisa y
 * confirma el concepto, y se sube por tandas. Aquí vive lo que no depende de
 * la pantalla: qué entradas de un ZIP son exámenes, cómo se arman las tandas y
 * qué le falta a una fila para poder subirse.
 */

import type { ConceptoExamen } from '../recruitment-pipeline/examen-medico.rules';

/** Tope por archivo: ms-hr acepta 12 MB por archivo y 15 MB por petición. */
export const TAM_MAX_ARCHIVO = 12 * 1024 * 1024;

/** Tanda por petición: pocas y livianas, para no rozar los 15 MB de ms-hr. */
export const TANDA_MAX_ARCHIVOS = 5;
export const TANDA_MAX_BYTES = 10 * 1024 * 1024;

/** Máximo de archivos por lote (lo mismo que acepta el backend). */
export const MAX_ARCHIVOS_LOTE = 500;

export type EstadoCruce =
  | 'OK' | 'AVISO' | 'SIN_CEDULA' | 'SIN_CANDIDATO' | 'VARIAS_CEDULAS'
  | 'SIN_PROCESO' | 'YA_CONTRATADO' | 'PROCESO_CERRADO' | 'FUERA_DE_ALCANCE';

export type EstadoCarga = 'PENDIENTE' | 'SUBIDO' | 'ERROR' | 'OMITIDO';

/** Estados de cruce con los que se puede subir (el backend usa la misma lista). */
export const CRUCES_SUBIBLES: readonly EstadoCruce[] = ['OK', 'AVISO'];

/** Estados de cruce que se arreglan escribiendo la cédula a mano. */
export const CRUCES_CORREGIBLES: readonly EstadoCruce[] = ['SIN_CEDULA', 'SIN_CANDIDATO', 'VARIAS_CEDULAS'];

export function nombreBase(ruta: string): string {
  const s = String(ruta ?? '').replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

export function esPdfPorNombre(nombre: string): boolean {
  return /\.pdf$/i.test(String(nombre ?? '').trim());
}

export function esZipPorNombre(nombre: string): boolean {
  return /\.zip$/i.test(String(nombre ?? '').trim());
}

/**
 * ¿Esta entrada de un ZIP es un examen? Un PDF que no sea una carpeta ni la
 * basura que meten macOS (`__MACOSX/`, `._archivo.pdf`) o los ocultos.
 */
export function entradaZipEsExamen(ruta: string, esCarpeta = false): boolean {
  if (esCarpeta) return false;
  const s = String(ruta ?? '').replace(/\\/g, '/');
  if (!s || s.startsWith('__MACOSX/') || s.includes('/__MACOSX/')) return false;
  const base = nombreBase(s);
  if (!base || base.startsWith('.')) return false;
  return esPdfPorNombre(base);
}

/**
 * Parte las filas en tandas de a lo sumo `maxArchivos` y `maxBytes`. Un archivo
 * que solo ya supera `maxBytes` va en su propia tanda (el backend decide).
 * Conserva el orden.
 */
export function armarTandas<T extends { tamano: number }>(
  filas: readonly T[],
  maxArchivos = TANDA_MAX_ARCHIVOS,
  maxBytes = TANDA_MAX_BYTES,
): T[][] {
  const tandas: T[][] = [];
  let actual: T[] = [];
  let bytes = 0;
  for (const f of filas) {
    const t = Math.max(0, Number(f.tamano) || 0);
    if (actual.length && (actual.length >= maxArchivos || bytes + t > maxBytes)) {
      tandas.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(f);
    bytes += t;
  }
  if (actual.length) tandas.push(actual);
  return tandas;
}

/** Lo mínimo de una fila de revisión que miran estas reglas. */
export interface FilaRevisable {
  estado_cruce: EstadoCruce | string | null;
  estado_carga: EstadoCarga | string | null;
  concepto: ConceptoExamen | null;
  restricciones: string | null;
  fecha_examen: string | null;
  excluida?: boolean;
}

/** ¿Se puede subir esta fila tal como está? null = sí; si no, el motivo. */
export function motivoNoSubible(f: FilaRevisable, hoy: string): string | null {
  if (f.excluida) return 'Quitada del lote';
  if (f.estado_carga === 'SUBIDO') return 'Ya se subió';
  if (!CRUCES_SUBIBLES.includes(f.estado_cruce as EstadoCruce)) return 'No se cruzó con un proceso abierto';
  if (!f.concepto) return 'Falta el concepto';
  if (f.concepto === 'APTO_CON_RESTRICCIONES' && !String(f.restricciones ?? '').trim()) {
    return 'Faltan las restricciones';
  }
  if (f.fecha_examen && f.fecha_examen > hoy) return 'La fecha de realización del examen es futura';
  return null;
}

/** Cuántas filas van con cada concepto (para la confirmación). */
export function contarConceptos(filas: readonly { concepto: ConceptoExamen | null }[]): Record<ConceptoExamen, number> {
  const out: Record<ConceptoExamen, number> = { APTO: 0, APTO_CON_RESTRICCIONES: 0, NO_APTO: 0, APLAZADO: 0 };
  for (const f of filas) if (f.concepto) out[f.concepto]++;
  return out;
}

/** "824 KB" / "2,1 MB". */
export function tamanoLegible(bytes: number | null | undefined): string {
  const b = Number(bytes) || 0;
  if (b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Hoy en hora local, AAAA-MM-DD. */
export function hoyLocal(d = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * Tipos compartidos del submódulo Vacantes.
 *
 * Viven aquí —y no dentro de una pantalla— porque desde la separación en
 * "Listado de Vacantes" e "Indicadores de Vacantes" las dos vistas trabajan
 * sobre las MISMAS filas y los MISMOS filtros. Duplicar estas formas era la
 * vía rápida a que una pantalla contara distinto de la otra.
 */

/** Embudo que ms-hr devuelve por publicación (`conteo_estados`). */
export interface ConteoEstados {
  pre_registro: number;
  entrevistado: number;
  prueba_tecnica: number;
  autorizado: number;
  examenes_medicos: number;
  contratado: number;
  ingreso: number;
  total_con_su_ultimo_registro: number;
}

export type AuxilioTransporte = 'Si' | 'No';

/**
 * Oficina que contrata, tal como se envía en el payload de guardado.
 *
 * SIN `ruta` a propósito. Esa bandera no es un dato de la vacante: vive en el catálogo
 * global `tabla_oficinas_vacante` y vale para todas. El formulario la mandaba en `false`
 * y `resolverOficina` la sobrescribía, así que guardar una vacante en SUBA apagaba la
 * ruta de SUBA para el resto. Omitiendo la clave, el backend la deja intacta.
 */
export interface OficinaPayload {
  nombre: string;
}

/** Fila de la distribución por municipio del payload de guardado. */
export interface DistPayload {
  municipio: string;
  cantidad: number;
}

/**
 * Línea del desglose del total solicitado por detalle de cargo.
 *
 * «Personas solicitadas (total)» dice CUÁNTAS, y esto dice DE QUÉ: dos operarios de
 * corte y uno de poscosecha dentro de la misma vacante de tres. La suma tiene que dar
 * exactamente el total; el formulario no deja guardar si no cuadra.
 */
export interface DetalleCargoPayload {
  detalle: string;
  cantidad: number;
}

/**
 * Vista de la pestaña activa.
 * `inactivas` es la única que cambia el CONJUNTO pedido al backend; el resto
 * son recortes en memoria sobre las activas ya cargadas.
 */
export type ViewMode = 'table' | 'faltantes' | 'completados' | 'inactivas';

/** Criterios de la cabecera de filtros. */
export interface VacancyFilters {
  oficina: string;
  finca: string;
  empresa: string;
  cargo: string;
  municipio: string;
  tipo: string;
  antiguedad: number;
  desde: Date | null;
  hasta: Date | null;
}

/** Opciones del desplegable de demora. */
export const OPC_ANTIGUEDAD: ReadonlyArray<{ valor: number; label: string }> = [
  { valor: 0, label: 'Cualquier antigüedad' },
  { valor: 8, label: 'Más de 7 días' },
  { valor: 16, label: 'Más de 15 días' },
  { valor: 31, label: 'Más de 30 días' },
  { valor: 61, label: 'Más de 60 días' },
];

/** Valores que existen en el conjunto cargado, para llenar los desplegables. */
export interface OpcionesFiltro {
  fincas: string[];
  empresas: string[];
  cargos: string[];
  municipios: string[];
  tipos: string[];
}

/**
 * Fila de vacante ya normalizada y con los derivados del embudo.
 *
 * Se deja `[k: string]: any` porque la publicación viene del contrato histórico
 * de Django y trae bastantes más claves de las que se declaran aquí; recortarla
 * a una interfaz cerrada perdería datos que el diálogo de edición sí manda de
 * vuelta al guardar.
 */
export interface VacanteRow {
  id: number | string;
  activo: boolean;
  motivo_inactivacion: string;
  salario: number;
  municipio: string[];
  observacionVacante: string;
  descripcion?: string;
  preseleccionados: string[];
  contratados: string[];
  personas_solicitadas: number;
  municipiosDistribucion: Array<{ municipio: string; cantidad: number }>;
  /** Desglose del total por detalle de cargo (columna JSON `detalles_cargo`, V17). */
  detallesCargo: DetalleCargoPayload[];
  /** Normalizadas a Date LOCAL en `VacancyDataService.mapRow` (ver el porqué allí). */
  fecha_publicado: Date | null;
  fechadeIngreso: Date | null;
  fechadePruebatecnica: Date | null;
  cargo: string | null;
  finca: string;
  area?: string | null;
  empresa_usuaria_solicita?: string | null;
  experiencia: string;
  auxilio_transporte: string;
  tipo_contratacion: string;
  oficinas_que_contratan?: Array<{ nombre?: string; ruta?: boolean } | string>;
  conteo_estados: ConteoEstados;

  // Derivados que calcula `VacancyDataService.enrichComputed`.
  req: number;
  falt: number;
  entrev: number;
  prueba: number;
  auto: number;
  exm: number;
  firm: number;
  ing: number;
  cumpl: number;
  municipioLabel: string;

  [k: string]: any;
}

/** Conteo en cero, para publicaciones a las que ms-hr no devolvió embudo. */
export function conteoVacio(): ConteoEstados {
  return {
    pre_registro: 0,
    entrevistado: 0,
    prueba_tecnica: 0,
    autorizado: 0,
    examenes_medicos: 0,
    contratado: 0,
    ingreso: 0,
    total_con_su_ultimo_registro: 0,
  };
}

/** '1.750.905' / '1750905.00' → 1750905. */
export function parseCurrency(val: any): number {
  return Number(String(val ?? '').replace(/[^\d.-]/g, '')) || 0;
}

/**
 * Salario mínimo legal mensual vigente (2026).
 *
 * Es el valor por defecto de TODA vacante: una publicación sin salario no le
 * sirve a nadie —ni al candidato que la mira ni a la nómina que la liquida—, y
 * era el hueco por el que salían vacantes en 0.
 */
export const SALARIO_MINIMO = 1750905;

/**
 * El salario de una vacante, o el mínimo legal si no trae uno válido.
 *
 * `parseCurrency` devuelve 0 para lo vacío, así que guardar sin tocar el campo
 * dejaba la vacante en 0 sin que nadie lo notara.
 */
export function salarioOMinimo(val: any): number {
  const n = parseCurrency(val);
  return n > 0 ? n : SALARIO_MINIMO;
}

/** Minúsculas sin acentos, para comparar nombres tecleados con los del maestro. */
export function normalizarTexto(s: any): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** 'YYYY-MM-DD' se arma en local para que no se corra un día por UTC. */
export function aFecha(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : soloFecha(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : soloFecha(d);
}

/** Copia sin hora, para comparar días completos. */
export function soloFecha(d: Date | null): Date | null {
  if (!d) return null;
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

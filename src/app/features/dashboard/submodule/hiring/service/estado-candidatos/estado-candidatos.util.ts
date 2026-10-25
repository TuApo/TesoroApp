/**
 * "Estado de candidatos" (Contratación, aprobado 16-oct-2026): contrato con ms-hr y reglas puras.
 *
 * `GET /gestion_contratacion/reporte/estado-candidatos/{resumen|en-espera|rechazados|contratados|inscritos}`
 * con `desde, hasta, oficina, q` (+ las facetas de cada lista, `formato=xlsx`, `page`, `size`).
 * La fuente es la observación del evaluador del proceso; ms-hr recorta por el alcance de sedes.
 */
import { TonoBadge } from '@/app/shared/components/tabla-estandar';

export type Vista = 'resumen' | 'en-espera' | 'rechazados' | 'contratados' | 'inscritos';
export type EstadoObs = 'APLICA' | 'EN_ESPERA' | 'NO_APLICA';
export type Etapa = 'EVALUACION' | 'PRUEBA_TECNICA' | 'EXAMEN_MEDICO';

/** Etiquetas de los códigos que manda el servidor (motivos agrupados, etapas, resultados). */
export const ETIQUETAS: Readonly<Record<string, string>> = {
  APLICA: 'Aplica',
  EN_ESPERA: 'En espera',
  NO_APLICA: 'No aplica',
  SIN_VACANTE: 'Sin vacante disponible',
  SIN_EXPERIENCIA: 'Sin experiencia',
  PREFIERE_AREA: 'Prefiere un área',
  SEMANAS: 'Semanas cotizadas',
  NO_SE_PRESENTO: 'No se presentó',
  OTRO: 'Otro',
  EDAD: 'Edad',
  ANTECEDENTES: 'Antecedentes',
  MEDIDAS: 'Medidas / IMC',
  BLOQUEO_CLIENTE: 'Bloqueo del cliente',
  EXAMEN_MEDICO: 'Examen médico',
  EPS_SEMANAS: 'EPS / semanas',
  NO_PASO: 'No pasó',
  EVALUACION: 'Evaluación',
  PRUEBA_TECNICA: 'Prueba técnica',
  AL: 'Apoyo Laboral',
  TA: 'Tu Alianza',
  OTRA: 'Otra / sin temporal',
  // Inscritos: qué pasó después de inscribirse.
  SIN_PROCESO: 'Sin proceso',
  EN_PROCESO: 'En proceso',
  CONTRATADO: 'Contratado',
};

export function etiqueta(codigo: string | null | undefined): string {
  if (!codigo) return '';
  return ETIQUETAS[codigo] ?? codigo;
}

/** Tramos de antigüedad de la espera, en el orden del servidor. */
export const TRAMOS: ReadonlyArray<{ id: string; etiqueta: string; tono: TonoBadge }> = [
  { id: '0-7', etiqueta: '0 a 7 días', tono: 'ok' },
  { id: '8-30', etiqueta: '8 a 30 días', tono: 'ok' },
  { id: '31-60', etiqueta: '31 a 60 días', tono: 'warn' },
  { id: '61-90', etiqueta: '61 a 90 días', tono: 'danger' },
  { id: '90+', etiqueta: 'Más de 90 días', tono: 'danger' },
];

export function tonoTramo(tramo: string | null | undefined): TonoBadge {
  return TRAMOS.find((t) => t.id === tramo)?.tono ?? 'neutro';
}

/** Pasos del formulario de inscripción (secciones del % de completitud), en el orden de la pantalla. */
export const SECCIONES: ReadonlyArray<{ id: SeccionFormulario; etiqueta: string }> = [
  { id: 'BASICA', etiqueta: 'Información básica' },
  { id: 'ADICIONAL', etiqueta: 'Información adicional' },
  { id: 'FAMILIA', etiqueta: 'Familia y referencias' },
  { id: 'EXPERIENCIA', etiqueta: 'Experiencia, hijos y vivienda' },
  { id: 'ADJUNTOS', etiqueta: 'Datos finales y adjuntos' },
];
export type SeccionFormulario = 'BASICA' | 'ADICIONAL' | 'FAMILIA' | 'EXPERIENCIA' | 'ADJUNTOS';

export function etiquetaSeccion(id: string): string {
  return SECCIONES.find((s) => s.id === id)?.etiqueta ?? id;
}

/** Tramos de completitud del formulario, en el orden del servidor. */
export const TRAMOS_COMPLETITUD: ReadonlyArray<{ id: string; etiqueta: string; tono: TonoBadge; color: string }> = [
  { id: '0-25', etiqueta: '0 a 25 %', tono: 'danger', color: '#e11d48' },
  { id: '26-50', etiqueta: '26 a 50 %', tono: 'warn', color: '#f97316' },
  { id: '51-75', etiqueta: '51 a 75 %', tono: 'warn', color: '#f59e0b' },
  { id: '76-99', etiqueta: '76 a 99 %', tono: 'info', color: '#0ea5e9' },
  { id: '100', etiqueta: '100 %', tono: 'ok', color: '#10b981' },
];

export function tramoCompletitud(id: string | null | undefined) {
  return TRAMOS_COMPLETITUD.find((t) => t.id === id) ?? TRAMOS_COMPLETITUD[0];
}

/** "¿Qué pasó después?" de un inscrito, del menos al más avanzado (mismo orden que el servidor). */
export const DESPUES_INSCRITO: ReadonlyArray<{ id: string; tono: TonoBadge }> = [
  { id: 'SIN_PROCESO', tono: 'neutro' },
  { id: 'EN_PROCESO', tono: 'info' },
  { id: 'EN_ESPERA', tono: 'warn' },
  { id: 'NO_APLICA', tono: 'danger' },
  { id: 'APLICA', tono: 'ok' },
  { id: 'CONTRATADO', tono: 'ok' },
];

export function tonoDespues(id: string | null | undefined): TonoBadge {
  return DESPUES_INSCRITO.find((d) => d.id === id)?.tono ?? 'neutro';
}

export interface ConteoMes { mes: string; [clave: string]: number | string }

export interface ResumenEstado {
  desde: string;
  hasta: string;
  evaluados: number;
  por_estado: Record<EstadoObs, number>;
  en_espera_vigentes: number;
  rechazos_etapa: number;
  pestanas: { en_espera: number; rechazados: number; contratados: number };
  recuperacion: Record<'EN_ESPERA' | 'NO_APLICA',
    { total: number; ingresaron: number; dias_promedio: number | null; volvieron: number }>;
  por_mes: ConteoMes[];
  ingresos_por_mes: ConteoMes[];
  antiguedad_espera: Record<string, number>;
  motivos_espera: Record<string, number>;
  motivos_no_aplica: Record<string, number>;
  por_oficina: OficinaEstado[];
  /** Bloque de inscripción (21-oct-2026). Opcional: un ms-hr anterior no lo manda. */
  inscripcion?: ResumenInscripcion;
}

export interface ResumenInscripcion {
  inscritos: number;
  completitud_promedio: number | null;
  completos: number;
  sin_proceso: number;
  por_completitud: Record<string, number>;
  /** % de inscritos con cada sección incompleta. */
  secciones_incompletas: Record<SeccionFormulario, number>;
  embudo: {
    inscritos: number; evaluados: number; aplica: number; contratados: number;
    /** % de cada etapa sobre la anterior; null si la anterior es 0. */
    tasas: { evaluados: number | null; aplica: number | null; contratados: number | null };
  };
  por_mes: Array<{ mes: string; inscritos: number }>;
}

export interface OficinaEstado {
  oficina: string;
  evaluados: number;
  APLICA: number;
  EN_ESPERA: number;
  NO_APLICA: number;
  ingresos: number;
  inscritos?: number;
  completitud_promedio?: number | null;
}

export interface FilaEspera {
  proceso_id: number;
  tipo_documento: string | null;
  cedula: string | null;
  nombre: string | null;
  oficina: string | null;
  /** 'YYYY-MM-DDTHH:mm[:ss]' en hora de Bogotá. */
  fecha: string | null;
  dias: number;
  antiguedad: string;
  motivo: string | null;
  categoria: string;
  experiencia: string | null;
  evaluador: string | null;
  sigue_en_espera: boolean;
  despues: string;
}

export interface FilaRechazo {
  proceso_id: number;
  tipo_documento: string | null;
  cedula: string | null;
  nombre: string | null;
  etapa: Etapa;
  resultado: string;
  fecha: string | null;
  motivo: string | null;
  categoria: string;
  oficina: string | null;
  evaluador: string | null;
  cargo: string | null;
  empresa_usuaria: string | null;
  despues: string;
  despues_tono: TonoBadge;
}

export interface FilaContratado {
  proceso_id: number;
  tipo_documento: string | null;
  cedula: string | null;
  nombre: string | null;
  fecha_ingreso: string | null;
  codigo_contrato: string | null;
  temporal: string | null;
  empresa_usuaria: string | null;
  oficina: string | null;
  usuario_contrata: string | null;
  dias_desde_evaluacion: number | null;
  antes_estuvo: EstadoObs | null;
  antes_dias: number | null;
}

export interface FilaInscrito {
  candidato_id: number;
  tipo_documento: string | null;
  cedula: string | null;
  nombre: string | null;
  /** 'YYYY-MM-DDTHH:mm:ss' en hora de Bogotá. */
  fecha_inscripcion: string | null;
  actualizado: string | null;
  oficina: string | null;
  /** % del formulario diligenciado (0-100). */
  completitud: number;
  tramo: string;
  campos_aplican: number;
  campos_llenos: number;
  /** % por sección; null si a la persona no le aplica ningún campo de esa sección. */
  secciones: Record<SeccionFormulario, number | null>;
  secciones_incompletas: SeccionFormulario[];
  faltantes: string[];
  despues: string;
  fecha_ingreso: string | null;
}

export interface ListaEstado<T> {
  desde: string;
  hasta: string;
  total: number;
  page: number;
  size: number;
  paginas: number;
  conteos: Record<string, Record<string, number>>;
  filas: T[];
}

export interface FiltrosEstado {
  /** YYYY-MM-DD */
  desde: string;
  /** YYYY-MM-DD */
  hasta: string;
  /** '' = todas las de su alcance. */
  oficina: string;
  q: string;
}

/** YYYY-MM-DD de una fecha LOCAL (no UTC: de noche en Bogotá UTC ya es mañana). */
export function isoLocal(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Por defecto: los últimos 12 meses (del 1 del mes de hace 11 meses a hoy), como el servidor. */
export function filtrosIniciales(hoy: Date = new Date()): FiltrosEstado {
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1);
  return { desde: isoLocal(desde), hasta: isoLocal(hoy), oficina: '', q: '' };
}

/** Query params; lo vacío no viaja. */
export function paramsEstado(f: FiltrosEstado, extra: Record<string, string | number | boolean | null | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.desde) out['desde'] = f.desde;
  if (f.hasta) out['hasta'] = f.hasta;
  if (f.oficina.trim()) out['oficina'] = f.oficina.trim();
  if (f.q.trim()) out['q'] = f.q.trim();
  for (const [k, v] of Object.entries(extra)) {
    if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  }
  return out;
}

/** Días de `desde` a `hasta` (YYYY-MM-DD) contando ambos extremos; null si falta alguna. */
export function diasDelRango(desde: string, hasta: string): number | null {
  if (!desde || !hasta) return null;
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

/** '2026-09-25T19:23:38' → '25/09/2026'; '2026-09-25' → '25/09/2026'. */
export function formatoFecha(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (v || '—');
}

/** '2026-03' → 'mar 26'. */
export function etiquetaMes(mes: string): string {
  const nombres = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  return m ? `${nombres[Number(m[2]) - 1]} ${m[1].slice(2)}` : mes;
}

/** Nombre del Excel: el de Content-Disposition, o uno armado. */
export function nombreArchivoEstado(contentDisposition: string | null, vista: Vista, f: FiltrosEstado): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? '');
  if (m?.[1]) return decodeURIComponent(m[1]);
  return `estado_candidatos_${vista}_${f.desde}_a_${f.hasta}.xlsx`;
}

/** Pares [código, total] en el orden del servidor, sin los ceros si se pide. */
export function pares(m: Record<string, number> | null | undefined, sinCeros = false): Array<[string, number]> {
  return Object.entries(m ?? {}).filter(([, n]) => !sinCeros || n > 0);
}

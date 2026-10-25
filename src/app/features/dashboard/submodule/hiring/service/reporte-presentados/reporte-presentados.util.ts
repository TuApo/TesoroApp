/**
 * Reporte de presentados (pedido #8): contrato con ms-hr y reglas puras de la pantalla.
 *
 * `GET /gestion_contratacion/reporte/presentados?desde&hasta&oficina&estado&q&formato&page&size`
 * — una fila por entrevista (fechada con `Entrevista.created_at`), recortada por el alcance de
 * sedes del usuario. Los KPIs vienen del rango SIN el filtro de estado.
 */

export type EstadoPresentado = 'APLICA' | 'NO_APLICA' | 'EN_ESPERA' | 'SIN_CLASIFICAR';

export const ESTADOS_PRESENTADO: ReadonlyArray<{
  id: EstadoPresentado;
  etiqueta: string;
  icono: string;
  tono: 'ok' | 'danger' | 'warn' | 'neutro';
}> = [
  { id: 'APLICA', etiqueta: 'Aplica', icono: 'check_circle', tono: 'ok' },
  { id: 'NO_APLICA', etiqueta: 'No aplica', icono: 'cancel', tono: 'danger' },
  { id: 'EN_ESPERA', etiqueta: 'En espera de vacante', icono: 'hourglass_top', tono: 'warn' },
  { id: 'SIN_CLASIFICAR', etiqueta: 'Sin clasificar', icono: 'help_outline', tono: 'neutro' },
];

export interface FilaPresentado {
  entrevista_id: number | null;
  proceso_id: number | null;
  /** 'YYYY-MM-DDTHH:mm[:ss]' en hora de Bogotá. */
  fecha: string | null;
  oficina: string | null;
  tipo_documento: string | null;
  cedula: string | null;
  nombre: string | null;
  estado: EstadoPresentado;
  motivo: string | null;
  evaluador: string | null;
  publicacion_id: number | null;
  cargo: string | null;
  cargo_especifico: string | null;
  empresa_usuaria: string | null;
  finca: string | null;
}

export type ConteoOficinaPresentados = { oficina: string; total: number } & Record<EstadoPresentado, number>;

export interface RespuestaPresentados {
  desde: string;
  hasta: string;
  /** Filas que pasan todos los filtros (con estado): lo que pagina la tabla. */
  total: number;
  /** Presentados del rango/oficina/búsqueda, sin el filtro de estado. */
  total_rango: number;
  page: number;
  size: number;
  paginas: number;
  kpis: {
    total: number;
    por_estado: Record<EstadoPresentado, number>;
    por_oficina: ConteoOficinaPresentados[];
  };
  filas: FilaPresentado[];
}

export interface FiltrosPresentados {
  /** YYYY-MM-DD */
  desde: string;
  /** YYYY-MM-DD */
  hasta: string;
  /** '' = todas las de su alcance. */
  oficina: string;
  /** '' = todos. */
  estado: EstadoPresentado | '';
  q: string;
}

/** YYYY-MM-DD de una fecha LOCAL (no UTC: de noche en Bogotá UTC ya es mañana). */
export function isoLocal(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Filtros por defecto: del 1 del mes a hoy, todas las oficinas y estados. */
export function filtrosIniciales(hoy: Date = new Date()): FiltrosPresentados {
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { desde: isoLocal(primero), hasta: isoLocal(hoy), oficina: '', estado: '', q: '' };
}

/** Query params del endpoint; lo vacío no viaja. */
export function paramsPresentados(
  f: FiltrosPresentados,
  extra: Record<string, string | number> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.desde) out['desde'] = f.desde;
  if (f.hasta) out['hasta'] = f.hasta;
  if (f.oficina.trim()) out['oficina'] = f.oficina.trim();
  if (f.estado) out['estado'] = f.estado;
  if (f.q.trim()) out['q'] = f.q.trim();
  for (const [k, v] of Object.entries(extra)) out[k] = String(v);
  return out;
}

/** Etiqueta legible del estado. */
export function etiquetaEstado(e: string | null | undefined): string {
  return ESTADOS_PRESENTADO.find((x) => x.id === e)?.etiqueta ?? String(e ?? '');
}

/** Porcentaje entero de `n` sobre `total` (0 sin total). */
export function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

/** Nombre del Excel: el que manda el servidor en Content-Disposition, o uno armado. */
export function nombreArchivoPresentados(contentDisposition: string | null, f: FiltrosPresentados): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? '');
  if (m?.[1]) return decodeURIComponent(m[1]);
  return `presentados_${f.desde}_a_${f.hasta}.xlsx`;
}

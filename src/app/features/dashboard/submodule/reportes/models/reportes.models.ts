/**
 * Contrato del módulo Reportes y Analítica (ms-reports).
 *
 * El backend serializa en snake_case (customizer de commons), así que las
 * interfaces lo respetan tal cual: no hay una capa de mapeo que traducir y
 * mantener, y lo que se ve en la pestaña de red es lo que dice este archivo.
 *
 * Nota importante sobre seguridad: lo único que viaja al servidor son CLAVES del
 * catálogo (`hr.trabajador`, `hr.contrato.empresa_usuaria`) y valores. El
 * frontend nunca envía nombres de tabla o de columna, ni SQL.
 */

// ─────────────────────────────── catálogo ───────────────────────────────

export type TipoCampo =
  | 'TEXTO' | 'ENTERO' | 'DECIMAL' | 'MONEDA'
  | 'FECHA' | 'FECHA_HORA' | 'BOOLEANO' | 'ENUM';

export type FormatoCampo =
  | 'text' | 'integer' | 'decimal' | 'currency' | 'percent'
  | 'date' | 'datetime' | 'badge';

export interface OrigenDatos {
  clave: string;
  nombre: string;
  descripcion: string | null;
  icono: string;
  color: string | null;
  orden: number;
  tablas: number;
}

export interface CampoCatalogo {
  clave: string;
  nombre: string;
  descripcion: string | null;
  /** Nombre técnico real, solo informativo (§5 pide mostrarlo junto al amigable). */
  columna: string;
  tipo: TipoCampo;
  formato: FormatoCampo | null;
  grupo: string | null;
  ancho: number | null;
  alineacion: string | null;
  filtrable: boolean;
  agrupable: boolean;
  agregable: boolean;
  ordenable: boolean;
  editable: boolean;
  sensible: boolean;
  es_pk: boolean;
  es_fk: boolean;
  operadores: string[];
  agregaciones: string[];
  opciones: unknown | null;
  orden: number;
}

export interface RelacionCatalogo {
  clave: string;
  nombre: string | null;
  dataset_izq: string;
  columna_izq: string;
  dataset_der: string;
  columna_der: string;
  tipo_default: 'INNER' | 'LEFT';
  cardinalidad: 'UNO_UNO' | 'UNO_N' | 'N_UNO';
  sugerido: boolean;
  origen: 'FK' | 'MANUAL';
  multiplica_filas: boolean;
  advertencia: string | null;
}

export interface DatasetCatalogo {
  clave: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  icono: string;
  origen: string;
  origen_nombre: string;
  tabla_fisica: string;
  esquema: string;
  pk_columna: string | null;
  fecha_columna_default: string | null;
  filas_estimadas: number | null;
  editable: boolean;
  orden: number;
  campos: CampoCatalogo[];
  relaciones: RelacionCatalogo[];
}

export interface Catalogo {
  version: number;
  origenes: OrigenDatos[];
  datasets: DatasetCatalogo[];
  relaciones: RelacionCatalogo[];
  categorias: string[];
  puede_construir: boolean;
  es_admin: boolean;
  edicion_habilitada: boolean;
}

export interface FuncionCalculada {
  nombre: string;
  descripcion: string;
  ejemplo: string;
  min_args: number;
  max_args: number;
  tipo_resultado: TipoCampo;
}

export interface OperadorMeta {
  nombre: string;
  etiqueta: string;
  aridad: number;
  ambito: string;
}

export interface LimitesModulo {
  max_filas: number;
  filas_vista_previa: number;
  max_filas_exportacion: number;
  max_pagina: number;
  max_tablas: number;
  max_columnas: number;
  max_condiciones: number;
}

export interface MetadatosModulo {
  funciones: FuncionCalculada[];
  operadores: OperadorMeta[];
  agregaciones: string[];
  transformaciones_fecha: string[];
  tipos_campo: TipoCampo[];
  formatos: FormatoCampo[];
  limites: LimitesModulo;
}

// ─────────────────────────── definición del reporte ───────────────────────────

export type Agregacion = 'COUNT' | 'COUNT_DISTINCT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
export type TransformacionFecha = 'FECHA' | 'DIA' | 'SEMANA' | 'MES' | 'TRIMESTRE' | 'ANIO' | 'HORA' | 'DIA_SEMANA';

export interface JoinSpec {
  relacion: string;
  tipo: 'INNER' | 'LEFT' | null;
  activo: boolean;
}

export interface FieldSpec {
  id: string;
  campo: string | null;
  calculado: string | null;
  alias: string;
  agregacion: Agregacion | null;
  transformacion: TransformacionFecha | null;
  agrupar: boolean | null;
  visible: boolean;
  formato: FormatoCampo | null;
  ancho: number | null;
  alineacion: string | null;
  orden: number | null;
}

export interface CalculatedSpec {
  id: string;
  alias: string;
  expresion: string;
  tipo: TipoCampo | null;
  formato: FormatoCampo | null;
}

export interface FilterNode {
  tipo: 'GRUPO' | 'CONDICION';
  union?: 'AND' | 'OR' | null;
  hijos?: FilterNode[];
  campo?: string | null;
  calculado?: string | null;
  operador?: string | null;
  valores?: unknown[];
}

export interface SortSpec {
  ref: string;
  direccion: 'ASC' | 'DESC';
}

export interface ReportDefinition {
  root: string | null;
  joins: JoinSpec[];
  fields: FieldSpec[];
  calculated: CalculatedSpec[];
  filters: FilterNode | null;
  sort: SortSpec[];
  limit: number | null;
  distinct: boolean | null;
}

// ─────────────────────────── resultado de la consulta ───────────────────────────

export interface ColumnaResultado {
  id: string;
  salida: string;
  alias: string;
  tipo: TipoCampo;
  formato: FormatoCampo | null;
  ancho: number | null;
  alineacion: string | null;
  visible: boolean;
  editable: boolean;
  es_agregacion: boolean;
  campo: string | null;
  dataset: string | null;
  agregacion: Agregacion | null;
  opciones: unknown | null;
}

export interface ResultadoConsulta {
  filas: Record<string, unknown>[];
  columnas: ColumnaResultado[];
  total: number | null;
  limite: number;
  offset: number;
  truncado: boolean;
  agregado: boolean;
  duracion_ms: number;
  advertencias: string[];
  datasets: string[];
  sql: string | null;
}

// ─────────────────────────── visualización ───────────────────────────

export type TipoVisualizacion =
  | 'TABLA' | 'BARRAS' | 'BARRAS_HORIZONTAL' | 'BARRAS_APILADAS' | 'COLUMNAS'
  | 'LINEA' | 'AREA' | 'CIRCULAR' | 'DONA' | 'DISPERSION' | 'HISTOGRAMA'
  | 'FUNNEL' | 'TREEMAP' | 'KPI';

export interface ConfigVisualizacion {
  tipo: TipoVisualizacion;
  titulo?: string | null;
  subtitulo?: string | null;
  /** id del FieldSpec que actúa como dimensión (eje X / categorías). */
  dimension?: string | null;
  /** ids de los FieldSpec que actúan como métricas (eje Y / valores). */
  metricas?: string[];
  /** id de un FieldSpec que separa en series (barras apiladas, líneas múltiples). */
  serie?: string | null;
  leyenda?: boolean;
  etiquetas?: boolean;
  top_n?: number | null;
  orientacion?: 'vertical' | 'horizontal';
  formato_numero?: FormatoCampo | null;
  paleta?: string | null;
  /** KPI: comparación con el periodo anterior. */
  kpi_metrica?: string | null;
  kpi_comparacion?: string | null;
  kpi_sufijo?: string | null;
  kpi_icono?: string | null;
  /** Tabla: totales y subtotales. */
  mostrar_totales?: boolean;
  columnas_totalizadas?: string[];
}

// ─────────────────────────── reportes guardados ───────────────────────────

export type VisibilidadReporte = 'PRIVADO' | 'ROL' | 'USUARIOS' | 'ORGANIZACION';
export type EstadoReporte = 'BORRADOR' | 'PUBLICADO' | 'ARCHIVADO';
export type TipoReporte = 'TABLA' | 'GRAFICA' | 'KPI' | 'MIXTO';

export interface Comparticion {
  sujeto_tipo: 'ROL' | 'USUARIO' | 'GRUPO' | 'SEDE';
  sujeto_ref: string;
  sujeto_nombre: string | null;
  permiso: 'VER' | 'EDITAR';
}

export interface ReporteResumen {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  tipo: TipoReporte;
  estado: EstadoReporte;
  visibilidad: VisibilidadReporte;
  creado_por: string;
  creado_por_nombre: string | null;
  fecha_creacion: string;
  fecha_actualizacion: string;
  ultima_ejecucion: string | null;
  ejecuciones: number;
  es_mio: boolean;
  es_favorito: boolean;
  puede_editar: boolean;
  compartido_con: number;
  datasets: string[];
}

export interface ReporteDetalle {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  tipo: TipoReporte;
  estado: EstadoReporte;
  visibilidad: VisibilidadReporte;
  definicion: ReportDefinition;
  visualizacion: ConfigVisualizacion | null;
  creado_por: string;
  creado_por_nombre: string | null;
  fecha_creacion: string;
  fecha_actualizacion: string;
  version: number;
  es_mio: boolean;
  es_favorito: boolean;
  puede_editar: boolean;
  comparticiones: Comparticion[];
  advertencias: string[];
}

export interface PaginaReportes {
  items: ReporteResumen[];
  total: number;
  page: number;
  size: number;
}

// ─────────────────────────── tableros ───────────────────────────

export type TipoWidget = 'KPI' | 'GRAFICA' | 'TABLA' | 'TEXTO';

export interface WidgetTablero {
  id?: string | null;
  tipo: TipoWidget;
  report_id: string | null;
  titulo: string | null;
  subtitulo: string | null;
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
  config: ConfigVisualizacion | null;
  filtros_extra: FilterNode | null;
  orden: number;
}

export interface FiltroGlobalTablero {
  id: string;
  campo: string;
  etiqueta: string;
  tipo: TipoCampo;
  operador: string;
  valores: unknown[];
}

export interface TableroResumen {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  estado: EstadoReporte;
  visibilidad: VisibilidadReporte;
  creado_por: string;
  creado_por_nombre: string | null;
  fecha_creacion: string;
  fecha_actualizacion: string;
  widgets: number;
  es_mio: boolean;
  es_favorito: boolean;
  puede_editar: boolean;
}

export interface TableroDetalle {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  estado: EstadoReporte;
  visibilidad: VisibilidadReporte;
  filtros_globales: FiltroGlobalTablero[] | null;
  layout_config: Record<string, unknown> | null;
  widgets: WidgetTablero[];
  creado_por: string;
  creado_por_nombre: string | null;
  fecha_creacion: string;
  fecha_actualizacion: string;
  es_mio: boolean;
  es_favorito: boolean;
  puede_editar: boolean;
  comparticiones: Comparticion[];
}

export interface DatosWidget {
  widget_id: string;
  tipo: TipoWidget;
  ok: boolean;
  titulo?: string;
  resultado?: ResultadoConsulta;
  error?: string;
}

export interface PaginaTableros {
  items: TableroResumen[];
  total: number;
  page: number;
  size: number;
}

// ─────────────────────────── auditoría ───────────────────────────

export interface FilaAuditoria {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  accion: string;
  recurso: string | null;
  recurso_id: string | null;
  exito: boolean;
  ip: string | null;
  metadata: string | null;
}

export interface PaginaAuditoria {
  items: FilaAuditoria[];
  total: number;
  page: number;
  size: number;
}

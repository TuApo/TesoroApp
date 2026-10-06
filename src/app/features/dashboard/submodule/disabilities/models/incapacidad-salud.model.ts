/**
 * Modelos de los modulos de Salud nacidos en la reunion funcional 2026-10-05:
 * Radicacion (+ Recobro), SEVENET y Liquidacion (Pagos y Negaciones).
 *
 * Espejo EXACTO del contrato de ms-hr (`/Incapacidades/v2/radicacion|recobros|liquidacion`):
 * JSON en camelCase, fechas `yyyy-MM-dd` (LocalDate) e instantes ISO-8601.
 */
import type {
  DondeRadicado,
  EstadoIncapacidad,
  Page,
  TipoIncapacidad,
} from './incapacidad-v2.model';

// ─────────────────────────────────────────────────────────────────────────
// Referencia compacta a una incapacidad (dto/IncapacidadRefResponse)
// ─────────────────────────────────────────────────────────────────────────

export interface IncapacidadRef {
  id: number;
  /** Codigo unico GENERAL sin guion bajo (cedula + yyyyMMdd [+ -n]). */
  codigoUnico: string;
  /** Codigo unico de OFICINA (visible de cartera, p. ej. TASB018); null en historicas. */
  codigoOficina: string | null;
  cedula: string;
  tipoDocumento: string | null;
  /** Apellidos primero. */
  nombreCompleto: string;
  eps: string | null;
  /** EPS, o "ARL SURA" para accidente de trabajo / enfermedad laboral. */
  entidadRadicacion: string | null;
  tipoIncapacidad: TipoIncapacidad | null;
  tipoIncapacidadEtiqueta: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  dias: number | null;
  estado: EstadoIncapacidad;
  estadoEtiqueta: string | null;
  oficina: string | null;
  empresa: string | null;
  temporal: string | null;
  entidadGrupo: 'APOYO' | 'ALIANZA' | null;
  numeroRadicado: string | null;
  fechaRadicado: string | null;
  dondeRadicado: DondeRadicado | null;
  dondeRadicadoEtiqueta: string | null;
  radicadoPor: string | null;
  origen: string | null;
}

/** Etiquetas de canal tal como las nombro la funcional (pagina web, correo o presencial). */
export const DONDE_RADICADO_OPCIONES: ReadonlyArray<{ valor: DondeRadicado; etiqueta: string }> = [
  { valor: 'PAGINA', etiqueta: 'Página web' },
  { valor: 'CORREO', etiqueta: 'Correo' },
  { valor: 'PUNTO_FISICO', etiqueta: 'Presencial' },
];

// ─────────────────────────────────────────────────────────────────────────
// Radicacion y Recobro
// ─────────────────────────────────────────────────────────────────────────

export type ModoBusquedaRadicacion = 'RADICACION' | 'RECOBRO';
export type TipoRadicado = 'RADICACION' | 'RECOBRO';

export interface BuscarCodigosRequest {
  codigos: string[];
  modo?: ModoBusquedaRadicacion;
}

export interface CodigoEncontrado {
  codigo: string;
  /** El codigo base resolvio a varias incapacidades (base y base-2). */
  ambiguo: boolean;
  puedeRadicar: boolean;
  /** Ya tenia radicado: volver a radicar es una correccion. */
  yaRadicada: boolean;
  motivo: string | null;
  incapacidad: IncapacidadRef;
}

export interface ResultadoBusquedaCodigos {
  encontrados: CodigoEncontrado[];
  noEncontrados: string[];
}

export interface AsignarRadicadoRequest {
  incapacidadIds: number[];
  numeroRadicado: string;
  fechaRadicado?: string | null;
  dondeRadicado: DondeRadicado;
  observaciones?: string | null;
  actor?: string;
  actorRol?: string;
}

export interface ResultadoAsignacionItem {
  incapacidadId: number;
  codigo: string | null;
  ok: boolean;
  mensaje: string;
  incapacidad: IncapacidadRef | null;
}

export interface ResultadoAsignacionRadicado {
  lote: string | null;
  total: number;
  exitosos: number;
  fallidos: number;
  resultados: ResultadoAsignacionItem[];
}

export interface RadicadoItem {
  /** null = radicado inicial historico que solo vive en la fila de la incapacidad. */
  id: number | null;
  incapacidadId: number;
  codigoUnico: string | null;
  codigoOficina: string | null;
  cedula: string | null;
  nombreCompleto: string | null;
  eps: string | null;
  tipo: TipoRadicado;
  tipoEtiqueta: string | null;
  numeroRadicado: string;
  fechaRadicado: string | null;
  dondeRadicado: DondeRadicado | null;
  dondeRadicadoEtiqueta: string | null;
  entidad: string | null;
  lote: string | null;
  numeroAnterior: string | null;
  negacionId: number | null;
  observaciones: string | null;
  radicadoPor: string | null;
  creadoEn: string | null;
  anulado: boolean;
}

export interface FiltrosPendientesRadicacion {
  q?: string;
  eps?: string;
  oficina?: string;
  entidadGrupo?: 'APOYO' | 'ALIANZA' | '';
  soloAplicativo?: boolean;
}

export type SituacionRecobro = 'PENDIENTE' | 'RADICADO' | 'TODOS';

export interface NegacionResumen {
  id: number;
  fechaRespuesta: string | null;
  causalTexto: string;
  causalCodigo: string | null;
  causalNombre: string | null;
  eps: string | null;
  creadoEn: string | null;
}

export interface RecobroItem {
  incapacidad: IncapacidadRef;
  negacion: NegacionResumen | null;
  recobros: RadicadoItem[];
  totalRadicados: number;
}

export interface FiltrosRecobro {
  situacion?: SituacionRecobro;
  q?: string;
  eps?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Liquidacion (Pagos y Negaciones)
// ─────────────────────────────────────────────────────────────────────────

export type EstadoCargaLiquidacion = 'SIMULADA' | 'APLICADA' | 'DESCARTADA' | 'ANULADA';
export type HojaLiquidacion = 'PAGOS' | 'NEGACIONES';
export type ResultadoFilaLiquidacion = 'CRUZA' | 'NO_CRUZA' | 'AMBIGUA' | 'DUPLICADA' | 'ERROR';
export type AccionCausal = 'FINALIZA' | 'RECOBRO';

export interface CargaLiquidacion {
  id: number;
  nombreArchivo: string | null;
  estado: EstadoCargaLiquidacion;
  estadoEtiqueta: string | null;
  filasPagos: number;
  filasNegaciones: number;
  cruzadas: number;
  noCruzadas: number;
  aplicadas: number;
  creadoPor: string | null;
  creadoEn: string | null;
  aplicadoPor: string | null;
  aplicadoEn: string | null;
  anuladoPor: string | null;
  anuladoEn: string | null;
}

export interface ResumenHoja {
  total: number;
  cruzan: number;
  noCruzan: number;
  ambiguas: number;
  duplicadas: number;
  errores: number;
}

export interface ResumenHojaNegaciones extends ResumenHoja {
  finalizan: number;
  recobro: number;
  sinHomologar: number;
}

export interface ResumenCarga {
  pagos: ResumenHoja;
  negaciones: ResumenHojaNegaciones;
  valorTotalPagos: number;
  incapacidadesDistintas: number;
}

export interface FilaLiquidacion {
  id: number;
  hoja: HojaLiquidacion;
  fila: number;
  eps: string | null;
  cedula: string | null;
  fechaInicio: string | null;
  codigoLeido: string | null;
  valorPagado: number | null;
  diasLiquidados: number | null;
  diasAutorizados: number | null;
  fechaPago: string | null;
  numeroIncapacidadEps: string | null;
  soporteContable: string | null;
  fechaRespuesta: string | null;
  causalTexto: string | null;
  causalId: number | null;
  causalCodigo: string | null;
  causalNombre: string | null;
  accion: AccionCausal | null;
  accionEtiqueta: string | null;
  sinHomologar: boolean;
  observaciones: string | null;
  resultado: ResultadoFilaLiquidacion;
  resultadoEtiqueta: string | null;
  mensaje: string | null;
  asignadaManual: boolean;
  aplicada: boolean;
  incapacidad: IncapacidadRef | null;
  sugerencias: IncapacidadRef[];
}

export interface CargaLiquidacionDetalle {
  carga: CargaLiquidacion;
  resumen: ResumenCarga;
  filas: FilaLiquidacion[];
}

export interface ResultadoAplicacion {
  carga: CargaLiquidacion;
  pagosAplicados: number;
  negacionesAplicadas: number;
  finalizadas: number;
  aRecobro: number;
  incapacidadesLiquidadas: number;
  noAplicadas: number;
  valorTotalPagos: number;
  /** "Usted acaba de liquidar N incapacidades: ..." */
  mensaje: string;
}

export interface PagoItem {
  id: number;
  incapacidad: IncapacidadRef;
  eps: string | null;
  valorPagado: number;
  diasLiquidados: number | null;
  diasAutorizados: number | null;
  fechaPago: string;
  numeroIncapacidadEps: string | null;
  soporteContable: string | null;
  observaciones: string | null;
  cargaId: number | null;
  creadoPor: string | null;
  creadoEn: string | null;
  anulado: boolean;
}

export interface PaginaPagos extends Page<PagoItem> {
  /** Suma de TODO el filtro (no solo de la pagina). */
  valorTotal: number;
}

export interface FiltrosPagos {
  q?: string;
  eps?: string;
  /** Rango por fecha de pago (yyyy-MM-dd). */
  desde?: string;
  hasta?: string;
  cargaId?: number;
}

export interface NegacionItem {
  id: number;
  incapacidad: IncapacidadRef;
  eps: string | null;
  diasLiquidados: number | null;
  fechaRespuesta: string | null;
  causalTexto: string;
  causalId: number | null;
  causalCodigo: string | null;
  causalNombre: string | null;
  accion: AccionCausal;
  accionEtiqueta: string | null;
  terminacion: string | null;
  sinHomologar: boolean;
  observaciones: string | null;
  cargaId: number | null;
  creadoPor: string | null;
  creadoEn: string | null;
  anulado: boolean;
}

export interface FiltrosNegaciones {
  q?: string;
  eps?: string;
  accion?: AccionCausal | '';
  sinHomologar?: boolean | null;
  cargaId?: number;
}

export interface CausalNegacion {
  id: number;
  codigo: string;
  nombre: string;
  accion: AccionCausal;
  accionEtiqueta: string | null;
  terminacion: string | null;
  activo: boolean;
  orden: number;
  equivalencias: number;
}

export interface CausalNegacionRequest {
  codigo: string;
  nombre: string;
  accion: AccionCausal;
  terminacion?: string | null;
  orden?: number | null;
  activo?: boolean | null;
  actor?: string;
}

export interface EquivalenciaCausal {
  id: number;
  causalId: number;
  causalCodigo: string | null;
  causalNombre: string | null;
  accion: AccionCausal | null;
  /** '*' = cualquier entidad. */
  eps: string;
  textoExterno: string;
  textoNormalizado: string;
  activo: boolean;
  creadoPor: string | null;
  creadoEn: string | null;
}

export interface CrearEquivalenciaRequest {
  causalId: number;
  eps?: string | null;
  textoExterno: string;
  reaplicar?: boolean;
  actor?: string;
}

export interface ResultadoEquivalencia {
  equivalencia: EquivalenciaCausal;
  negacionesActualizadas: number;
  incapacidadesRecalculadas: number;
}

export interface ActualizarEquivalenciaRequest {
  causalId: number;
  eps: string;
  textoExterno: string;
  activo: boolean;
}

export interface CausalSinHomologar {
  eps: string | null;
  textoExterno: string;
  textoNormalizado: string;
  veces: number;
  ultimaFecha: string | null;
}

export interface LiquidacionIncapacidad {
  pagos: PagoItem[];
  negaciones: NegacionItem[];
  valorPagadoTotal: number;
  terminacion: string | null;
}

/** Etiquetas cortas para chips. */
export const RESULTADO_FILA_ETIQUETA: Record<ResultadoFilaLiquidacion, string> = {
  CRUZA: 'Cruza',
  NO_CRUZA: 'No cruza',
  AMBIGUA: 'Varias posibles',
  DUPLICADA: 'Ya registrada',
  ERROR: 'Con error',
};

export const ACCION_CAUSAL_ETIQUETA: Record<AccionCausal, string> = {
  FINALIZA: 'Finaliza',
  RECOBRO: 'Pasa a recobro',
};

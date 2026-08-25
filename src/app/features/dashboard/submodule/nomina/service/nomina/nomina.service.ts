import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { environment } from '@/environments/environment';

export interface ConceptoNomina {
  id_concepto?: number;
  codigo: string;
  descripcion: string;
  abreviatura?: string | null;
  naturaleza: 'DEVENGO' | 'DEDUCCION' | 'APORTE_EMPLEADO' | 'APORTE_EMPLEADOR' | 'PROVISION' | 'OTRO';
  unidad: 'HORA' | 'DIA' | 'VALOR';
  /** Categoría funcional (DIA_AUSENCIA, HORA_EXTRA, VALOR_BONIFICACION…).
   *  Editable desde V16. */
  categoria?: string | null;
  /** Super-categoría de reporte (agrupador). Solo 3 valores al crear una
   *  novedad nueva: AUSENCIAS | INCAPACIDADES | EXTRAS_Y_BONIFICACIONES (V29). */
  agrupador?: 'AUSENCIAS' | 'INCAPACIDADES' | 'EXTRAS_Y_BONIFICACIONES' | null;
  /** Tabla satélite donde el motor escribe la novedad importada (V19).
   *  Es la fuente global de routing — el homologador puede sobreescribir
   *  por cliente, pero el camino feliz consulta esta columna. */
  tabla_destino?: string | null;
  /** Campo de {@link tabla_destino} que recibe la cantidad/valor. */
  campo_destino?: string | null;
  afecta_ibc: boolean;
  activo: boolean;
  naturaleza_display?: string;
  unidad_display?: string;
}

export type EstadoHomologacion = 'HOMOLOGADO' | 'HOMOLOGADO_CON_OBSERVACION' | 'REVISAR' | 'SIN_HOMOLOGACION';

export interface HomologadorExterno {
  id_homologacion?: number;
  concepto: number;
  concepto_codigo?: string;
  concepto_descripcion?: string;
  concepto_naturaleza?: string;
  entidad_externa: number;
  entidad_nombre?: string;
  entidad_nit?: string;
  codigo_externo: string;
  concepto_externo: string;
  clasificacion_externa?: string | null;
  tabla_operativa_destino?: string | null;
  campo_operativo_destino?: string | null;
  estado_homologacion: EstadoHomologacion;
  estado_display?: string;
  observacion?: string | null;
  activo: boolean;
  creado_at?: string;
  actualizado_at?: string;
}

export interface Client {
  id_entidad: number;
  id_org?: number; // Alias para compatibilidad
  nombre_legal: string;
  nit: string;
}

export interface CostCenter {
  id_ceco: number;
  nombre: string;
  codigo_interno: string;
}

/** Estados permitidos para el campo estado_pago de una liquidación. */
export type EstadoPagoNomina = 'PENDIENTE' | 'APROBADA' | 'PAGADA';
export const ESTADOS_PAGO_NOMINA: EstadoPagoNomina[] = ['PENDIENTE', 'APROBADA', 'PAGADA'];

/**
 * Resumen "de módulo" del histórico: total de nóminas y desglose por estado
 * de TODO el filtro actual (empresa + periodo + centros + búsqueda). Lo
 * cuenta el backend, no solo lo cargado en pantalla. Lo devuelve
 * `GET /payroll/historico/resumen`. Solo lectura.
 */
export interface HistoricoResumen {
  total_nominas: number;
  pendientes: number;
  aprobadas: number;
  pagadas: number;
}

/**
 * Resumen del mini-dashboard del histórico: total de nóminas de un
 * contrato y su desglose por estado_pago. Lo devuelve
 * `GET /payroll/contrato/{id_contrato}/dashboard-nominas`. Solo lectura.
 */
export interface EmpleadoNominaDashboard {
  id_persona: number | null;
  id_contrato: number | null;
  tipo_documento: string | null;
  numero_documento: string | null;
  nombre_completo: string | null;
  total_nominas: number;
  pendientes: number;
  aprobadas: number;
  pagadas: number;
}

// ── Reportes y Analítica (Fase 1: novedades) ──────────────────────────────
/** Granularidad temporal soportada por la serie de la analítica. */
export type GranularidadTemporal = 'quincena' | 'mes' | 'trimestre' | 'semestre' | 'anio';

/** Periodo de nómina tal como lo expone `/api/nomina/periodos/`. OJO: este
 *  endpoint serializa en snake_case (PeriodoDto usa @JsonNaming SnakeCase),
 *  a diferencia de los DTOs de reportes que van camelCase. Fechas ISO
 *  yyyy-MM-dd. Se usa para poblar el sub-selector de periodo de la analítica
 *  (elegir una quincena/mes/trimestre/semestre concreto). */
export interface PeriodoNominaDto {
  id_periodo: number;
  descripcion: string;
  fecha_inicio: string;   // yyyy-MM-dd
  fecha_fin: string;      // yyyy-MM-dd
  dias_teoricos?: number;
  estado?: string;
}

/** KPIs del tablero de novedades para el rango/filtro actual. */
export interface ReporteResumenNovedades {
  totalNovedades: number;
  valorTotal: number;
  valorDevengos: number;
  valorDeducciones: number;
  empleadosConNovedad: number;
  periodos: number;
}

/** Punto de la serie temporal ya agrupado en la granularidad pedida. */
export interface SerieTemporalPunto {
  clave: string;
  etiqueta: string;
  conteo: number;
  valor: number;
}

/** Ítem de una distribución (por tipo, naturaleza, empresa, ceco…). */
export interface DistribucionItem {
  id: number | null;
  etiqueta: string;
  conteo: number;
  valor: number;
}

/** Un tipo de novedad disponible para el filtro (código = valor a enviar). */
export interface TipoNovedad {
  codigo: string;
  descripcion: string;
  /** Super-categoría de reporte (agrupador, V29) para cascadear el selector;
   *  null si el código no está en el catálogo o no tiene agrupador. */
  agrupador?: string | null;
  conteo: number;
  valor: number;
}

/** Payload completo del tablero de novedades (`/reportes/novedades/dashboard`). */
export interface ReporteNovedadesDashboard {
  resumen: ReporteResumenNovedades;
  serieTemporal: SerieTemporalPunto[];
  porTipo: DistribucionItem[];
  porNaturaleza: DistribucionItem[];
  porClasificacion: DistribucionItem[];
  porEmpresa: DistribucionItem[];
  porCeco: DistribucionItem[];
}

// ── Reportes y Analítica (Fase 2: nómina pagada) ──────────────────────────
/** KPIs de la nómina liquidada para el rango/filtro actual. */
export interface ReporteResumenNomina {
  totalNominas: number;
  empleados: number;
  totalDevengado: number;
  totalDeducido: number;
  totalNeto: number;
  totalIbc: number;
  pendientes: number;
  aprobadas: number;
  pagadas: number;
}

/** Punto de la serie temporal de nómina (montos por bucket). */
export interface SerieNominaPunto {
  clave: string;
  etiqueta: string;
  nominas: number;
  devengado: number;
  deducido: number;
  neto: number;
}

/** Payload completo del tablero de nómina pagada (`/reportes/nomina/dashboard`). */
export interface ReporteNominaDashboard {
  resumen: ReporteResumenNomina;
  serieTemporal: SerieNominaPunto[];
  porEmpresa: DistribucionItem[];   // valor = neto pagado
  porCeco: DistribucionItem[];      // valor = neto pagado
  porEstado: DistribucionItem[];    // conteo + neto por estado_pago
}

// ── Desprendible de nómina ────────────────────────────────────────────────
/**
 * Shape exacto que devuelve `GET /payroll/desprendible/{id_nomina_emp}` en
 * ms-payroll (DesprendibleDtos.java). Tipado en snake_case para reflejar lo
 * que viaja por HTTP — la conversión a camelCase la haría el interceptor
 * si la necesitamos, pero la UI puede consumir snake_case directamente.
 */
export interface DesprendibleEmpresa {
  razon_social: string | null;
  nombre_comercial: string | null;
  nit: string | null;
  logo_url: string | null;
  area_emisora: string | null;
  texto_pie: string | null;
  color_primario: string | null;
  color_secundario: string | null;
}
export interface DesprendibleEmpleado {
  tipo_documento: string | null;
  numero_documento: string | null;
  nombre_completo: string | null;
  primer_nombre: string | null;
  primer_apellido: string | null;
  cargo: string | null;
  ceco_nombre: string | null;
  empresa_usuaria: string | null;
}
export interface DesprendibleContrato {
  codigo_contrato: string | null;
  fecha_ingreso: string | null;
  fecha_retiro: string | null;
  salario_base: number | null;
  tipo_contrato: string | null;
  estado_contrato: string | null;
  banco: string | null;
  numero_cuenta_enmascarado: string | null;
  forma_pago: string | null;
}
export interface DesprendibleNominaPeriodo {
  periodo_inicio: string | null;
  periodo_fin: string | null;
  periodo_texto: string | null;
  fecha_pago: string | null;
  fecha_emision: string | null;
  estado_pago: string | null;
}
export interface DesprendibleConcepto {
  codigo_concepto: string;
  nombre_concepto: string;
  cantidad: number | null;
  valor: number | null;
  unidad: string | null;
  tipo_concepto: 'DEVENGO' | 'DEDUCCION';
}
/**
 * Novedad informativa / no monetaria del período (naturaleza OTRO /
 * INFORMATIVO / INFORMATIVA): incapacidades, ausencias, suspensiones,
 * sanciones, permisos, luto… No entra en devengos ni deducciones — su valor
 * suele ser 0 — pero explica el resultado del período (p. ej. por qué el neto
 * quedó en cero).
 */
export interface DesprendibleNovedad {
  codigo_concepto: string;
  nombre_concepto: string;
  cantidad: number | null;
  valor: number | null;
  unidad: string | null;
  naturaleza: string | null;
  clasificacion: string | null;
  observacion: string | null;
}
export interface DesprendibleTotales {
  total_devengos: number | null;
  total_deducciones: number | null;
  neto_pagar: number | null;
}
export interface DesprendiblePrestamoEfectivo {
  saldo_anterior: number | null;
  nuevo_desembolso: number | null;
  abono_periodo: number | null;
  nuevo_saldo: number | null;
  numero_cuotas: number | null;
  valor_cuota_fija: number | null;
}
export interface DesprendibleBonoMercado {
  saldo_anterior: number | null;
  nuevo_bono: number | null;
  abono_periodo: number | null;
  nuevo_saldo: number | null;
}
export interface DesprendiblePrestamos {
  efectivo: DesprendiblePrestamoEfectivo;
  mercado: DesprendibleBonoMercado;
  seguro_funerario: number | null;
  total_deuda_actual: number | null;
}
export interface DesprendibleFirma {
  nombre_empleado: string | null;
  responsable_nomina: string | null;
  area_responsable: string | null;
}
export interface DesprendibleData {
  empresa: DesprendibleEmpresa;
  empleado: DesprendibleEmpleado;
  contrato: DesprendibleContrato;
  nomina: DesprendibleNominaPeriodo;
  devengos: DesprendibleConcepto[];
  deducciones: DesprendibleConcepto[];
  novedades_informativas: DesprendibleNovedad[];
  totales: DesprendibleTotales;
  prestamos: DesprendiblePrestamos;
  observaciones: string | null;
  firma: DesprendibleFirma;
}

// ── Empleados (editor individual) ─────────────────────────────────────────
export interface EmpleadoContrato {
  id_contrato?: number;
  codigo_contrato_client?: string | null;
  id_ceco?: number | null;
  centro_de_costo?: string;
  id_cliente?: number | null;
  cliente_nombre?: string;
  id_banco?: number | null;
  banco_nombre?: string;
  id_eps?: number | null;
  eps_nombre?: string;
  id_afp?: number | null;
  afp_nombre?: string;
  id_ccf?: number | null;
  ccf_nombre?: string;
  fecha_ingreso?: string | null;
  fecha_retiro?: string | null;
  salario_basico?: number | string | null;
  auxilio_transporte_ley?: boolean;
  numero_cuenta_bancaria?: string | null;
  forma_pago?: string | null;
  fecha_inicio_prima?: string | null;
  fecha_inicio_cesantias?: string | null;
  fecha_inicio_vacaciones?: string | null;
  estado?: 'ACTIVO' | 'INACTIVO' | 'FINALIZADO' | 'RETIRADO';
}

export interface Empleado {
  id_persona?: number;
  tipo_documento?: string;
  numero_documento?: string;
  primer_nombre?: string;
  segundo_nombre?: string | null;
  primer_apellido?: string;
  segundo_apellido?: string | null;
  nombre_completo?: string;
  fecha_nacimiento?: string | null;
  genero?: string | null;
  email?: string | null;
  es_pensionado?: boolean;
  cantidad_hijos?: number | null;
  contrato_activo?: EmpleadoContrato | null;
  contratos?: EmpleadoContrato[];
}

export interface EmpleadosQuery {
  q?: string;
  cliente_id?: number | null;
  ceco_id?: number | null;
  estado?: string;
  solo_con_contrato?: 0 | 1;
  page?: number;
  page_size?: number;
}

export interface Paged<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Cálculo con plantilla de novedades (Excel LONG, no persiste) ─────────
export interface ConceptoSinHomologar {
  codigo: string;
  concepto: string;
  filas: number;
}

export interface CalculoConNovedadesResponse {
  hoja_usada: string;
  hojas_disponibles: string[];
  total_filas_excel: number;
  filas_omitidas_sin_cedula: number;
  cedulas_excel: number;
  cedulas_en_sistema: number;
  cedulas_sin_contrato_cliente: number;
  cedulas_resueltas: number;
  cedulas_no_encontradas: string[];
  cedulas_fuera_de_alcance: string[];
  conceptos_sin_homologar: ConceptoSinHomologar[];
  errores_cache: Array<{ contrato_id: number; tabla: string; campo: string; error: string }>;
  contratos_calculados: number;
  contratos_con_novedad: number;
  contratos_sin_novedad: number;
  contratos_data: any[];
  empleados: any[];
  totales: { total_devengado: string; total_deducido: string; neto: string };
  warnings: string[];
  periodo: {
    id: number;
    descripcion: string;
    fecha_inicio: string;
    fecha_fin: string;
    es_invalido: boolean;
  };
  // Incremento 2.5/2.6 — snapshot server-side + diagnóstico/conciliación.
  calculation_id?: string;
  puede_cerrar?: boolean;
  conciliacion?: ConciliacionNovedades;
  diagnostico_novedades?: DiagnosticoNovedad[];
  bloqueantes?: DiagnosticoNovedad[];
  comparacion_recargos?: any;
  fecha_expiracion?: string;
}

export interface ConciliacionNovedades {
  total_recibidas: number;
  procesadas: number;
  informativas: number;
  sin_homologacion: number;
  no_soportadas: number;
  sin_contrato?: number;
  rechazadas: number;
  conciliacion_correcta: boolean;
  modos_motor?: string;
  puede_cerrar?: boolean;
  total_bloqueantes?: number;
  // Inc.7.1/7.2: desglose por causa + cálculo parcial.
  resumen_bloqueantes?: { [estado: string]: number };
  codigo_bloqueo?: string;
  modo_recargos?: string;
  resultado_oficial?: string;
  calculo_parcial_disponible?: boolean;
  puede_descargar_preview?: boolean;
  empleados_calculo_completo?: number;
  empleados_calculo_parcial?: number;
  empleados_excluidos_sin_contrato?: number;
  filas_excluidas_sin_contrato?: number;
  mensaje_parcial?: string;
}

export interface DiagnosticoNovedad {
  documento: string;
  codigo_externo: string;
  concepto: string;
  valor_entrada?: string | null;
  unidad?: string;
  tabla_destino?: string | null;
  campo_destino?: string | null;
  modo_motor?: string;
  estado: string;     // PROCESADA | INFORMATIVO | SIN_HOMOLOGACION | NO_SOPORTADO_POR_MODO | SIN_CONSUMIDOR | CONFIGURACION_INCONSISTENTE | FECHA_CAUSACION_REQUERIDA | DUPLICACION_SUM | SIN_CONTRATO
  severidad: string;  // OK | INFO | WARNING | ERROR
  bloqueante: boolean;
  consumidor?: string;
  mensaje?: string;
}

// Estado de la resolución nombre→id contra catálogos:
// OK | NO_ENCONTRADO | INACTIVO | VACIO
export type FkEstado = 'OK' | 'NO_ENCONTRADO' | 'INACTIVO' | 'VACIO';

export interface FkResolucion {
  excel: string | null;
  detectada: string | null;
  id_detectado: number | null;
  estado: FkEstado;
}

export interface PreviewResolucion {
  empresa: FkResolucion;
  eps: FkResolucion;
  afp: FkResolucion;
  banco: FkResolucion;
  ccf: FkResolucion;
  ceco: FkResolucion;
}

export interface PreviewRegistro {
  fila_excel?: number;
  tipo_documento?: string;
  numero_documento?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  primer_nombre?: string;
  segundo_nombre?: string;
  nombre_completo?: string;
  codigo_contrato?: string;
  empresa_usuaria?: string;
  centro_costo?: string;
  cliente?: string;
  // Valor CRUDO de la celda de empresa usuaria antes de la extracción. Cuando la
  // columna es compuesta ("Empresa Usuaria y Centro de Costo") es el texto completo
  // y `cliente` es el nombre ya extraído (recortado antes del marcador de centro de
  // costo). Cuando es una columna simple ("Cliente") ambos coinciden.
  cliente_original?: string;
  ceco?: string;
  fecha_ingreso?: string;
  fecha_retiro?: string;
  salario?: number;
  // Valor de la columna "Estado" del Excel (INGRESO / SIN CONFIRMAR / NO INGRESO).
  // undefined si el archivo no trae esa columna.
  estado_registro?: string;
  // ¿La fila es candidata a importación? Solo INGRESO (o sin columna Estado) → true.
  importar?: boolean | null;
  // Salario informativo leído del Excel ("Salario S.M.M.L.V."). NO se persiste.
  salario_excel?: number;
  // Advertencias por fila calculadas por el backend (estado, tipo doc raro, email
  // inválido, fecha de retiro de experiencia laboral, marcador de centro de costo…).
  warnings?: string[];
  numero_cuenta?: string;
  forma_pago?: string;
  banco?: string;
  eps?: string;
  afp?: string;
  ccf?: string;
  email?: string;
  telefono?: string;
  direccion?: string;
  municipio?: string;
  departamento?: string;
  genero?: string;
  fecha_nacimiento?: string;
  es_pensionado?: boolean;
  cantidad_hijos?: number | null;
  estado?: string;
  // Resolución de FKs calculada por el backend en el preview.
  // Si el backend es viejo viene undefined y el import no validará FKs.
  resolucion?: PreviewResolucion;
}

export interface PreviewResponse {
  registros: PreviewRegistro[];
  import_token?: string;
  resumen?: any;
  total_filas_excel?: number;
  registros_validos?: number;
  filas_con_warnings?: number;
  filas_con_fk_no_resuelta?: number;
  resumen_warnings?: Record<string, number>;
  resumen_fk?: Record<string, number>;
  columnas_excel?: string[];
  columnas_mapeadas?: Record<string, string | null>;
  // Código de la plantilla/parser que usó el backend ("DEFAULT", "TU_ALIANZA_IPANEMA").
  plantilla?: string;
}

export interface ImportarRegistrosPayload {
  registros?: PreviewRegistro[];
  import_token?: string;
  edits?: Record<string, Partial<PreviewRegistro>>;
  optimizar_indices?: boolean;
  // Empresa usuaria / plantilla seleccionada (paridad con el preview).
  empresa_usuaria_id?: number;
  template_code?: string;
}

export interface ImportNoAplicable {
  fila_excel: number;
  cedula?: string;
  motivo: string;
}

// ── Guardado de nómina ────────────────────────────────────────────────────
// Mirror de PayrollDtos.ConceptoLiquidadoDto en ms-payroll.
export interface ConceptoLiquidadoPayload {
  codigo: string;
  descripcion?: string;
  naturaleza?: string;          // DEVENGO | DEDUCCION | OTRO
  unidad?: string;              // DIA | HORA | VALOR
  cantidad?: number;
  valor_unitario?: number;
  valor_total?: number;
  clasificacion?: string;
  hace_base_ibc?: boolean;
  disminuye_ibc?: boolean;
  origen_tabla?: string;
  origen_id?: number | null;
  observacion?: string;
}

export interface DetalleLiquidacionPayload {
  id_contrato: number;
  id_empleado: number;
  dias?: number | null;
  sueldo_q?: number;
  aux_trans?: number;
  salud?: number;
  pension?: number;
  neto?: number;
  total_devengado?: number;
  total_deducido?: number;
  dias_efectivos?: number | null;
  dias_no_remunerados?: number | null;
  dias_incapacidad?: number | null;
  dias_laborados?: number | null;
  dias_con_derecho_auxilio?: number | null;
  dias_pagados?: number | null;
  ibc?: number;
  devengos_salariales?: number;
  devengos_no_salariales?: number;
  deducciones_salariales_que_disminuyen_ibc?: number;
  conceptos?: ConceptoLiquidadoPayload[];
}

export interface GuardarLiquidacionPayload {
  periodo_id: number;
  cliente_id?: number | null;
  // Incremento 2.7: el cierre envía ÚNICAMENTE el calculationId (+ datos
  // administrativos). El backend recupera el resultado verificado desde el
  // snapshot. El flujo legacy basado en `detalles` fue ELIMINADO.
  calculation_id: string;
  usuario?: string;
  // Guardado PARCIAL: true → cierra solo los empleados sin novedades bloqueantes
  // y devuelve los excluidos. Omitido/false = cierre total (bloqueado por el gate).
  parcial?: boolean;
}

/** Concepto bloqueante que motivó la exclusión de un empleado (guardado parcial). */
export interface ConceptoBloqueante {
  codigo: string;
  descripcion: string;
  naturaleza: string;
  clasificacion: string;
  valor_total: number;
  observacion: string;
}

/** Empleado excluido del guardado parcial por tener novedades bloqueantes. */
export interface EmpleadoExcluido {
  id_contrato: number;
  id_empleado: number;
  conceptos_bloqueantes: ConceptoBloqueante[];
}

// Incremento 2.7: respuesta del cálculo PLANO (/payroll/calcular) con snapshot.
export interface CalcularLiquidacionResponse {
  empleados: any[];
  totales: any;
  calculation_id?: string;
  puede_cerrar?: boolean;
  conciliacion?: ConciliacionNovedades | any;
  fecha_expiracion?: string;
}

export interface GuardarLiquidacionResponse {
  ok: boolean;
  creados_nomina: number;
  creados_facturacion: number;
  creados_conceptos: number;
  creados_historico_novedades: number;
  estado_periodo: string;
  recalculado: boolean;
  idempotent_replay?: boolean;
  // Guardado PARCIAL: true si fue cierre parcial; conteo y detalle de los
  // empleados que NO se persistieron por tener novedades bloqueantes.
  parcial?: boolean;
  empleados_excluidos?: number;
  excluidos?: EmpleadoExcluido[];
  // Presentes solo en error controlado (409/422):
  codigo?: string;
  cambiosDetectados?: string[];
  total_bloqueados?: number;
  mensaje?: string;
}

// ── TNL ─────────────────────────────────────────────────────────────────────
// Espejo de TnlDtos en ms-payroll. El TNL es una FUENTE de novedades, no un
// motor: guarda el evento completo (con fechas) y cada periodo consume el tramo
// que le toca.

export type TnlEstado =
  | 'PENDIENTE' | 'PARCIALMENTE_APLICADO' | 'APLICADO' | 'BLOQUEADO' | 'ANULADO';

export type TnlResultadoFila = 'INSERTADA' | 'DUPLICADA' | 'RECHAZADA' | 'BLOQUEADA';

export interface TnlFilaImportada {
  numero_fila: number;
  documento: string;
  codigo_concepto: string;
  descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias?: number;
  horas?: number;
  fingerprint: string;
  resultado: TnlResultadoFila;
  diagnostico: string;
  bloqueante: boolean;
  mensaje: string;
  id_tnl?: number;
}

export interface TnlConceptoSinHomologacion {
  codigo: string;
  descripcion: string;
  filas: number;
}

export interface TnlImportacionResponse {
  status: string;
  archivo: string;
  archivo_sha256: string;
  hoja_usada: string;
  hojas_disponibles: string[];
  columnas_faltantes: string[];
  filas_recibidas: number;
  filas_insertadas: number;
  filas_duplicadas: number;
  filas_rechazadas: number;
  filas_bloqueadas: number;
  filas_vacias_ignoradas: number;
  conciliacion_correcta: boolean;
  filas_desbloqueadas: number;
  conceptos_sin_homologacion: TnlConceptoSinHomologacion[];
  detalle: TnlFilaImportada[];
  warnings: string[];
  /** Cabecera de importación (V36): trazabilidad archivo/fila. */
  importacion_id?: number | null;
  /** Filas persistidas con estado SIN_HOMOLOGACION (V36, §16). */
  filas_sin_homologacion?: number;
  /** Desglose §46: con/sin fechas, con horas/días/valor, hoja BASE. */
  desglose_contenido?: Record<string, number> | null;
}

// ── Histórico COMÚN de novedades (V36): TNL + MANUAL en un solo modelo ─────
export interface NovedadComun {
  id: number;
  origen: 'TNL' | 'MANUAL' | 'API' | 'IMPORTACION' | 'OTRO';
  id_cliente?: number | null;
  documento: string;
  nombre_empleado?: string | null;
  codigo_concepto: string;
  descripcion_concepto?: string | null;
  naturaleza?: string | null;
  unidad?: 'HORA' | 'DIA' | 'VALOR' | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  horas?: number | null;
  dias?: number | null;
  valor?: number | null;
  estado: string;
  motivo?: string | null;
  importacion_id?: number | null;
  archivo_origen?: string | null;
  fila_origen?: number | null;
  periodo_carga_id?: number | null;
  aplicaciones: number;
  creado_por?: string | null;
  creado_at?: string | null;
}

export interface HistoricoNovedadesKpis {
  total: number;
  pendientes: number;
  parcialmente_aplicadas: number;
  aplicadas: number;
  sin_homologacion: number;
  rechazadas: number;
  bloqueadas: number;
  anuladas: number;
  origen_tnl: number;
  origen_manual: number;
}

export interface HistoricoNovedadesResponse {
  items: NovedadComun[];
  kpis: HistoricoNovedadesKpis;
}

export interface NovedadComunDetalle {
  novedad: NovedadComun;
  datos_origen: Record<string, unknown> | null;
  importacion: Record<string, unknown> | null;
  aplicaciones_realizadas: Array<Record<string, unknown>>;
  periodos_afectados: number[];
}

export interface TnlRegistro {
  id: number;
  id_cliente?: number;
  id_empleado?: number;
  id_contrato?: number;
  documento_empleado: string;
  nombre_empleado: string;
  codigo_concepto: string;
  descripcion_concepto: string;
  fecha_inicio: string;
  fecha_fin: string;
  numero_dias?: number;
  numero_horas?: number;
  valor_informado?: number;
  cantidad?: number;
  estado: TnlEstado;
  motivo_bloqueo: string;
  fingerprint: string;
  archivo_origen: string;
  hoja_origen: string;
  numero_fila: number;
  version: number;
  dias_rango: number;
}

export interface TnlAplicacion {
  id: number;
  id_tnl: number;
  id_periodo: number;
  fecha_inicio_aplicada: string;
  fecha_fin_aplicada: string;
  dias_aplicados: number;
  horas_aplicadas: number;
  codigo_concepto: string;
  calculation_id: string;
}

export interface TnlDetalle {
  registro: TnlRegistro;
  historico: TnlAplicacion[];
  periodos_aplicados: number[];
  dias_totales: number;
  dias_aplicados: number;
  dias_pendientes: number;
  horas_totales: number;
  horas_aplicadas: number;
  horas_pendientes: number;
  completamente_aplicado: boolean;
}

export interface TnlRevalidacionResponse {
  status: string;
  registros_reactivados: number;
  mensaje: string;
}

/** Saldo de un TNL en el preview: qué aporta ahora y qué queda para después. */
export interface TnlSaldoPendiente {
  id_tnl: number;
  documento: string;
  codigo_concepto: string;
  descripcion_concepto: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_totales: number;
  dias_ya_liquidados: number;
  dias_en_este_periodo: number;
  dias_pendientes_despues: number;
  estado_proyectado: TnlEstado;
}

// ── Novedades del periodo (registro manual, submódulo "Novedades") ────────
// Fuente MANUAL de novedades: se generan y almacenan desde la UI contra una
// (empresa usuaria, periodo) y el cálculo las consumirá después — reemplaza
// la carga por Excel del botón de novedades para este flujo. Contrato REST:
// /api/nomina/novedades-periodo (backend en ms-payroll).

export type EstadoNovedadPeriodo = 'PENDIENTE' | 'APLICADA' | 'ANULADA';

export interface NovedadPeriodo {
  id?: number;
  id_cliente: number;
  cliente_nombre?: string | null;
  id_periodo: number;
  periodo_descripcion?: string | null;
  id_persona?: number | null;
  id_contrato?: number | null;
  documento: string;
  nombre_empleado?: string | null;
  ceco_nombre?: string | null;
  codigo_concepto: string;
  descripcion_concepto?: string | null;
  naturaleza?: string | null;               // DEVENGO | DEDUCCION | OTRO…
  unidad?: 'HORA' | 'DIA' | 'VALOR' | null;
  /** Horas o días según la unidad del concepto. */
  cantidad?: number | null;
  /** Rango de fechas para novedades de unidad DIA (yyyy-MM-dd). */
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  /** Monto para novedades de unidad VALOR. */
  valor?: number | null;
  observacion?: string | null;
  estado?: EstadoNovedadPeriodo;
  creado_por?: string | null;
  creado_at?: string | null;
  actualizado_at?: string | null;
}

/**
 * Fila del histórico de novedades: una novedad aplicada a un empleado en
 * un cierre de nómina. Espejo de HistoricoNovedadDto en ms-payroll.
 */
export interface HistoricoNovedadRow {
  id_historico: number;
  id_periodo: number;
  id_cliente: number | null;
  cliente_nombre: string | null;
  id_ceco: number | null;
  ceco_nombre: string | null;
  ceco_codigo: string | null;
  id_contrato: number;
  codigo_contrato: string | null;
  id_persona: number;
  identificacion: string;
  tipo_documento: string;
  nombre_completo: string;
  codigo: string;
  descripcion: string;
  naturaleza: string;
  clasificacion: string;
  unidad: string;
  cantidad: number;
  valor_unitario: number;
  valor_total: number;
  hace_base_ibc: boolean;
  disminuye_ibc: boolean;
  origen_tabla: string;
  origen_id: number | null;
  observacion: string;
  liquidado_at: string | null;
}

export interface ImportResult {
  success?: boolean;
  status?: string;
  message?: string;
  count?: number;
  mensaje?: string;
  filas?: number;
  total_procesados?: number;
  personas_creadas?: number;
  personas_actualizadas?: number;
  contratos_creados?: number;
  contratos_actualizados?: number;
  no_aplicables?: ImportNoAplicable[];
  advertencias?: Record<string, number>;
  log?: string[];
}

// ── Actualización por empresa usuaria (Empleados) ───────────────────────────
export interface ActualizacionEmpresaRow {
  row_number: number;
  cedula: string | null;
  nombre_excel: string | null;
  empleado_encontrado: boolean;
  persona_id: number | null;
  contrato_id: number | null;
  empresa_usuaria_id: number | null;
  empresa_usuaria_nombre: string | null;
  ccosto_excel: string | null;
  codigo_c_costo_normalizado: string | null;
  ingreso_excel: string | null;
  fecha_ingreso_parseada: string | null;
  sub_legal_excel: string | null;
  auxilio_transporte_ley_parseado: boolean | null;
  distribucion_excel: string | null;
  ceco_id: number | null;
  ceco_codigo: string | null;
  ceco_nombre: string | null;
  estado_fila: 'valido' | 'advertencia' | 'error';
  errores: string[];
  advertencias: string[];
}

export interface ActualizacionEmpresaPreview {
  empresa_usuaria_id: number | null;
  empresa_usuaria_nombre: string | null;
  plantilla_codigo: string | null;
  total_filas: number;
  total_validas: number;
  total_con_error: number;
  total_con_advertencia: number;
  errores_generales: string[];
  advertencias_generales: string[];
  columnas_detectadas: Record<string, string | null>;
  results: ActualizacionEmpresaRow[];
  import_token: string | null;
}

export interface ActualizacionEmpresaImportResult {
  status: string;
  mensaje: string;
  total_actualizados: number;
  total_omitidos: number;
  errores: string[];
  advertencias: string[];
  results: ActualizacionEmpresaRow[];
}

/** Tipos de entidad externa administrables por el submódulo (valores internos). */
export type TipoEntidadExterna = 'EMPRESA_USUARIA' | 'EMPRESA_PROPIA' | 'EPS' | 'AFP' | 'BANCO' | 'CCF';

/** Entidad externa (fila de la tabla polimórfica nomina_entidades_externas).
 *  El submódulo "Entidades Externas" la administra con borrado lógico, solo para
 *  los tipos permitidos. "codigo" es codigo_ministerio. Los conteos de CECOs y
 *  contratos solo vienen para EMPRESA_USUARIA (null para el resto). */
export interface EntidadExterna {
  id: number;
  nombre: string;
  nombre_comercial?: string | null;
  nit?: string | null;
  codigo?: string | null;
  tipo: TipoEntidadExterna;
  activo: boolean;
  centros_costo_count: number | null;
  contratos_count: number | null;
}

/** Payload de creación/edición. tipo es obligatorio y controlado (selector);
 *  el frontend nunca envía id ni activo (el estado se cambia por desactivar/reactivar). */
export interface EntidadExternaUpsert {
  nombre: string;
  nombre_comercial?: string | null;
  nit?: string | null;
  codigo?: string | null;
  tipo: TipoEntidadExterna;
}

/**
 * Fila del mantenimiento administrativo de Centros de Costo (submódulo Nómina →
 * Centros de Costo). Espejo de CentroCostoAdminDto en ms-payroll
 * (/api/nomina/centros-costo). Incluye la empresa usuaria asociada y el conteo
 * de contratos. NO se borra físicamente: solo active=false. */
export interface CentroCostoAdmin {
  id_ceco: number;
  codigo_interno: string | null;
  nombre: string;
  sede_fisica: string | null;
  direccion: string | null;
  id_cliente: number | null;
  empresa_usuaria_nombre: string | null;
  active: boolean;
  contratos_count: number;
}

/** Payload de creación/edición de centro de costo. El estado se cambia por
 *  desactivar/reactivar (no por este payload); el id nunca se envía. */
export interface CentroCostoUpsert {
  id_cliente: number | null;
  codigo_interno?: string | null;
  nombre: string;
  sede_fisica?: string | null;
  direccion?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class NominaService {
  private baseReg = `${environment.apiUrl}/api/nomina/registro-empleado`;
  private baseNom = `${environment.apiUrl}/api/nomina`;

  private _clientesActivos$: Observable<Client[]> | null = null;
  private _conceptosActivos$: Observable<ConceptoNomina[]> | null = null;

  constructor(private http: HttpClient) { }

  // Alias para compatibilidad con import-excel.component.ts.
  // `empresaUsuariaId` selecciona el parser/plantilla en el backend (el formato
  // del Excel puede variar por empresa). Es obligatorio en la UI.
  previewExcel(
    file: File,
    sheetName?: string,
    headerRow?: number,
    empresaUsuariaId?: number | null,
    templateCode?: string,
  ): Observable<PreviewResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (sheetName) formData.append('sheet_name', sheetName);
    if (headerRow) formData.append('header_row', String(headerRow));
    if (empresaUsuariaId != null) formData.append('empresa_usuaria_id', String(empresaUsuariaId));
    if (templateCode) formData.append('template_code', templateCode);
    return this.http.post<PreviewResponse>(`${this.baseReg}/preview-excel/`, formData);
  }

  getPreviewExcel(file: File): Observable<PreviewRegistro[]> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<PreviewRegistro[]>(`${this.baseReg}/preview-excel/`, formData);
  }

  importarExcel(file: File): Observable<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ImportResult>(`${this.baseReg}/importar-excel/`, formData);
  }

  getClientes(params: any = {}): Observable<Client[]> {
    return this.http.get<Client[]>(`${this.baseNom}/organizaciones/`, { params });
  }

  getCentrosCostos(idOrParams: any = {}): Observable<CostCenter[]> {
    let params = idOrParams;
    if (typeof idOrParams === 'number' || typeof idOrParams === 'string') {
      params = { id_cliente: idOrParams };
    }
    return this.http.get<CostCenter[]>(`${this.baseNom}/centros-costos/`, { params });
  }

  getContratosFiltrados(params: any = {}): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseNom}/contratos/`, { params });
  }

  importarRegistros(
    registrosOrPayload: PreviewRegistro[] | ImportarRegistrosPayload,
  ): Observable<ImportResult> {
    const payload: ImportarRegistrosPayload = Array.isArray(registrosOrPayload)
      ? { registros: registrosOrPayload }
      : registrosOrPayload;
    return this.http.post<ImportResult>(`${this.baseReg}/importar-registros/`, payload);
  }

  getPeriodos(): Observable<any> {
    return this.http.get(`${this.baseNom}/periodos/`);
  }

  /** Igual que getPeriodos() pero tipado, para el sub-selector de periodo de la
   *  analítica. Ordenados por fecha de inicio en el frontend. */
  getPeriodosNomina(): Observable<PeriodoNominaDto[]> {
    return this.http.get<PeriodoNominaDto[]>(`${this.baseNom}/periodos/`);
  }

  guardarLiquidacion(payload: GuardarLiquidacionPayload): Observable<GuardarLiquidacionResponse> {
    return this.http.post<GuardarLiquidacionResponse>(
      `${this.baseNom}/payroll/guardar_liquidacion/`, payload,
    );
  }

  calcularLiquidacion(payload: {
    periodo_id: number,
    cliente_id?: number | null,
    cecos?: number[],
    contrato_ids?: number[],
    forzar_dias_completos?: boolean,
  }): Observable<CalcularLiquidacionResponse> {
    return this.http.post<CalcularLiquidacionResponse>(
      `${this.baseNom}/payroll/calcular/`, payload,
    );
  }

  /**
   * Incremento 5: soporte por SNAPSHOT (preview). NO envía empleados ni valores
   * económicos — el backend lo genera server-side desde el calculationId. Descargable
   * aunque el cálculo esté bloqueado.
   */
  descargarSoportePreview(calculationId: string, clienteId?: number | null,
                          periodoId?: number | null): Observable<HttpResponse<Blob>> {
    let url = `${this.baseNom}/payroll/soporte/preview/${encodeURIComponent(calculationId)}`;
    const qs: string[] = [];
    if (clienteId != null) qs.push(`cliente_id=${clienteId}`);
    if (periodoId != null) qs.push(`periodo_id=${periodoId}`);
    if (qs.length) url += `?${qs.join('&')}`;
    return this.http.get(url, { responseType: 'blob', observe: 'response' });
  }

  /** Incremento 5: soporte DEFINITIVO por calculationId consumido (snapshot inmutable). */
  descargarSoporteDefinitivo(calculationId: string, clienteId?: number | null,
                             periodoId?: number | null): Observable<HttpResponse<Blob>> {
    let url = `${this.baseNom}/payroll/soporte/definitivo/${encodeURIComponent(calculationId)}`;
    const qs: string[] = [];
    if (clienteId != null) qs.push(`cliente_id=${clienteId}`);
    if (periodoId != null) qs.push(`periodo_id=${periodoId}`);
    if (qs.length) url += `?${qs.join('&')}`;
    return this.http.get(url, { responseType: 'blob', observe: 'response' });
  }

  crearPeriodo(data: any): Observable<any> {
    return this.http.post(`${this.baseNom}/periodos/`, data);
  }

  actualizarPeriodo(id: number, data: any): Observable<any> {
    return this.http.patch(`${this.baseNom}/periodos/${id}/`, data);
  }

  getHistorico(params: any): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseNom}/payroll/get_historico/`, { params });
  }

  /**
   * Resumen "de módulo" del histórico (total / pendientes / aprobadas /
   * pagadas) para el MISMO filtro que `getHistorico`. El conteo lo hace el
   * backend sobre todas las coincidencias, no solo la página cargada.
   */
  getResumenHistorico(params: any): Observable<HistoricoResumen> {
    return this.http.get<HistoricoResumen>(
      `${this.baseNom}/payroll/historico/resumen/`, { params },
    );
  }

  /**
   * Detalle del desprendible de una liquidación concreta. El backend
   * agrega empresa emisora, empleado, contrato, periodo, devengos,
   * deducciones, totales, préstamos y observaciones.
   */
  getDesprendible(idNominaEmp: number): Observable<DesprendibleData> {
    return this.http.get<DesprendibleData>(
      `${this.baseNom}/payroll/desprendible/${idNominaEmp}/`,
    );
  }

  /**
   * Mini-dashboard del histórico para un contrato: total de nóminas y
   * desglose por estado (pendientes / aprobadas / pagadas). El conteo lo
   * hace el backend sobre todo el histórico, no solo lo cargado en tabla.
   * Siempre responde (ceros si el contrato no tiene nóminas).
   */
  getDashboardNominasContrato(idContrato: number): Observable<EmpleadoNominaDashboard> {
    return this.http.get<EmpleadoNominaDashboard>(
      `${this.baseNom}/payroll/contrato/${idContrato}/dashboard-nominas/`,
    );
  }

  /**
   * Cambia el estado_pago de una o varias liquidaciones del histórico.
   * Estados permitidos en el backend: PENDIENTE | APROBADA | PAGADA.
   */
  cambiarEstadoNomina(
    ids: number[],
    estado: EstadoPagoNomina,
  ): Observable<{ ok: boolean; actualizados: number; solicitados: number; estado: string }> {
    return this.http.patch<{ ok: boolean; actualizados: number; solicitados: number; estado: string }>(
      `${this.baseNom}/payroll/cambiar-estado/`,
      { ids, estado },
    );
  }

  /**
   * Histórico de novedades aplicadas en cierres anteriores. Filtros
   * opcionales por periodo, empresa usuaria, cecos y query libre.
   */
  getHistoricoNovedades(params: any = {}): Observable<HistoricoNovedadRow[]> {
    return this.http.get<HistoricoNovedadRow[]>(
      `${this.baseNom}/payroll/historico-novedades/`, { params },
    );
  }

  // --- Reportes y Analítica (Fase 1: novedades) ---
  /**
   * Tablero agregado de novedades: KPIs + serie temporal + distribuciones
   * (por tipo, naturaleza, clasificación, empresa usuaria y centro de costo).
   * Params opcionales: desde, hasta (yyyy-MM-dd), cliente_id, cecos,
   * granularidad (quincena|mes|trimestre|semestre|anio). Solo lectura.
   */
  getReporteNovedades(params: any = {}): Observable<ReporteNovedadesDashboard> {
    return this.http.get<ReporteNovedadesDashboard>(
      `${this.baseNom}/reportes/novedades/dashboard/`, { params },
    );
  }

  /** Catálogo de tipos de novedad presentes en el rango/filtro, para poblar el
   *  selector "Tipo de novedad". Params: desde, hasta, cliente_id, cecos. */
  getTiposNovedad(params: any = {}): Observable<TipoNovedad[]> {
    return this.http.get<TipoNovedad[]>(
      `${this.baseNom}/reportes/novedades/tipos/`, { params },
    );
  }

  /**
   * Tablero agregado de nómina pagada: KPIs de montos + serie temporal
   * (devengado/deducido/neto por bucket) + distribuciones por empresa, centro
   * de costo y estado de pago. Params: desde, hasta, cliente_id, cecos,
   * granularidad y estado (PENDIENTE|APROBADA|PAGADA, opcional). Solo lectura.
   */
  getReporteNomina(params: any = {}): Observable<ReporteNominaDashboard> {
    return this.http.get<ReporteNominaDashboard>(
      `${this.baseNom}/reportes/nomina/dashboard/`, { params },
    );
  }

  // --- Conceptos / Parametrización de Novedades ---
  getConceptos(params: any = {}): Observable<ConceptoNomina[]> {
    return this.http.get<ConceptoNomina[]>(`${this.baseNom}/conceptos/`, { params });
  }

  crearConcepto(data: ConceptoNomina): Observable<ConceptoNomina> {
    return this.http.post<ConceptoNomina>(`${this.baseNom}/conceptos/`, data);
  }

  actualizarConcepto(id: number, data: Partial<ConceptoNomina>): Observable<ConceptoNomina> {
    return this.http.patch<ConceptoNomina>(`${this.baseNom}/conceptos/${id}/`, data);
  }

  eliminarConcepto(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseNom}/conceptos/${id}/`);
  }

  // --- Homologador de Conceptos Externos ---
  getHomologaciones(params: any = {}): Observable<HomologadorExterno[]> {
    return this.http.get<HomologadorExterno[]>(`${this.baseNom}/homologador/`, { params });
  }

  crearHomologacion(data: Partial<HomologadorExterno>): Observable<HomologadorExterno> {
    return this.http.post<HomologadorExterno>(`${this.baseNom}/homologador/`, data);
  }

  actualizarHomologacion(id: number, data: Partial<HomologadorExterno>): Observable<HomologadorExterno> {
    return this.http.patch<HomologadorExterno>(`${this.baseNom}/homologador/${id}/`, data);
  }

  getClientesActivos(): Observable<Client[]> {
    if (!this._clientesActivos$) {
      this._clientesActivos$ = this.http.get<Client[]>(
        `${this.baseNom}/organizaciones/`, { params: { tipo: 'EMPRESA_USUARIA', activo: 'true' } },
      ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    }
    return this._clientesActivos$;
  }

  // ── Actualización por empresa usuaria (Empleados) ──────────────────────
  /** Paso 1: previsualizar (no persiste). La EMPRESA seleccionada manda el parser/plantilla. */
  previewActualizacionEmpresa(empresaUsuariaId: number, file: File): Observable<ActualizacionEmpresaPreview> {
    const fd = new FormData();
    fd.append('archivo', file);
    fd.append('empresa_usuaria_id', String(empresaUsuariaId));
    return this.http.post<ActualizacionEmpresaPreview>(
      `${this.baseNom}/empleados/actualizacion-empresa/preview/`, fd,
    );
  }

  /** Paso 2: confirmar usando el import_token devuelto por el preview. */
  importarActualizacionEmpresa(
    empresaUsuariaId: number, importToken: string,
    periodoId?: number | null,
  ): Observable<ActualizacionEmpresaImportResult> {
    return this.http.post<ActualizacionEmpresaImportResult>(
      `${this.baseNom}/empleados/actualizacion-empresa/importar/`,
      { empresa_usuaria_id: empresaUsuariaId, import_token: importToken,
      periodo_id: periodoId ?? null },
    );
  }

  getConceptosActivos(): Observable<ConceptoNomina[]> {
    if (!this._conceptosActivos$) {
      this._conceptosActivos$ = this.http.get<ConceptoNomina[]>(
        `${this.baseNom}/conceptos/`, { params: { activo: 'true' } },
      ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    }
    return this._conceptosActivos$;
  }

  invalidateCache(): void {
    this._clientesActivos$ = null;
    this._conceptosActivos$ = null;
  }

  // ── Empleados (editor individual) ───────────────────────────────────────
  getEmpleados(query: EmpleadosQuery = {}): Observable<Paged<Empleado>> {
    const params: Record<string, string> = {};
    Object.entries(query).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params[k] = String(v);
    });
    return this.http.get<Paged<Empleado>>(`${this.baseNom}/empleados/`, { params });
  }

  getEmpleado(id: number): Observable<Empleado> {
    return this.http.get<Empleado>(`${this.baseNom}/empleados/${id}/`);
  }

  crearEmpleado(data: Partial<Empleado> & { contrato_inicial?: Partial<EmpleadoContrato> }): Observable<Empleado> {
    return this.http.post<Empleado>(`${this.baseNom}/empleados/`, data);
  }

  actualizarEmpleado(id: number, data: Partial<Empleado>): Observable<Empleado> {
    return this.http.patch<Empleado>(`${this.baseNom}/empleados/${id}/`, data);
  }

  eliminarEmpleado(id: number): Observable<{ ok: boolean; contratos_retirados: number; fecha_retiro: string }> {
    return this.http.delete<{ ok: boolean; contratos_retirados: number; fecha_retiro: string }>(
      `${this.baseNom}/empleados/${id}/`,
    );
  }

  listarContratosEmpleado(id: number): Observable<EmpleadoContrato[]> {
    return this.http.get<EmpleadoContrato[]>(`${this.baseNom}/empleados/${id}/contratos/`);
  }

  crearContratoEmpleado(id: number, data: Partial<EmpleadoContrato>): Observable<EmpleadoContrato> {
    return this.http.post<EmpleadoContrato>(`${this.baseNom}/empleados/${id}/contratos/`, data);
  }

  actualizarContratoEmpleado(
    idEmpleado: number, idContrato: number, data: Partial<EmpleadoContrato>,
  ): Observable<EmpleadoContrato> {
    return this.http.patch<EmpleadoContrato>(
      `${this.baseNom}/empleados/${idEmpleado}/contratos/${idContrato}/`, data,
    );
  }

  terminarContratoEmpleado(
    idEmpleado: number, idContrato: number, fechaRetiro?: string,
  ): Observable<EmpleadoContrato> {
    return this.http.post<EmpleadoContrato>(
      `${this.baseNom}/empleados/${idEmpleado}/contratos/${idContrato}/terminar/`,
      fechaRetiro ? { fecha_retiro: fechaRetiro } : {},
    );
  }

  eliminarContratoEmpleado(idEmpleado: number, idContrato: number): Observable<EmpleadoContrato> {
    return this.http.delete<EmpleadoContrato>(
      `${this.baseNom}/empleados/${idEmpleado}/contratos/${idContrato}/`,
    );
  }

  getEntidadesPorTipo(tipo: 'EMPRESA_USUARIA' | 'EPS' | 'AFP' | 'CCF' | 'BANCO'): Observable<Client[]> {
    return this.http.get<Client[]>(`${this.baseNom}/organizaciones/`, {
      params: { tipo, activo: 'true' },
    });
  }

  calcularConNovedadesExcel(
    file: File | null,
    periodoId: number,
    clienteId: number,
    opts?: {
      contratoIds?: number[];
      cecos?: number[];
      forzarDiasCompletos?: boolean;
      sheetName?: string;
    },
  ): Observable<CalculoConNovedadesResponse> {
    const fd = new FormData();
    // Archivo OPCIONAL: sin hoja adjunta el backend liquida el periodo únicamente
    // con los movimientos pendientes del TNL ya importado.
    if (file) fd.append('file', file);
    fd.append('periodo_id', String(periodoId));
    fd.append('cliente_id', String(clienteId));
    if (opts?.contratoIds?.length) fd.append('contrato_ids', JSON.stringify(opts.contratoIds));
    if (opts?.cecos?.length) fd.append('cecos', JSON.stringify(opts.cecos));
    if (opts?.forzarDiasCompletos) fd.append('forzar_dias_completos', 'true');
    if (opts?.sheetName) fd.append('sheet_name', opts.sheetName);
    return this.http.post<CalculoConNovedadesResponse>(
      `${this.baseNom}/calculo-con-novedades/`, fd,
    );
  }

  // ── TNL: fuente persistente de novedades ──────────────────────────────────
  // El archivo se carga UNA vez y queda como evento histórico con su rango de
  // fechas. Cada cálculo toma automáticamente el tramo que le corresponde al
  // periodo y deja el resto pendiente para los siguientes. No se recarga nada.
  private baseTnl = `${environment.apiUrl}/api/nomina/tnl`;

  /** Importa la hoja TNL. NO calcula ni consume nada: sólo persiste. */
  importarTnl(
    file: File,
    clienteId: number,
    opts?: { periodoId?: number | null; sheetName?: string; usuario?: string },
  ): Observable<TnlImportacionResponse> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('cliente_id', String(clienteId));
    if (opts?.periodoId) fd.append('periodo_id', String(opts.periodoId));
    if (opts?.sheetName) fd.append('sheet_name', opts.sheetName);
    if (opts?.usuario) fd.append('usuario', opts.usuario);
    return this.http.post<TnlImportacionResponse>(`${this.baseTnl}/importar/`, fd);
  }

  /** Registros TNL, con filtros. `periodoId` filtra por INTERSECCIÓN de fechas. */
  listarTnl(filtros: {
    clienteId?: number | null; documento?: string | null; contratoId?: number | null;
    codigo?: string | null; estado?: TnlEstado | null; periodoId?: number | null;
    fechaInicial?: string | null; fechaFinal?: string | null;
  } = {}): Observable<TnlRegistro[]> {
    const params: Record<string, string> = {};
    if (filtros.clienteId) params['cliente_id'] = String(filtros.clienteId);
    if (filtros.documento) params['documento'] = filtros.documento;
    if (filtros.contratoId) params['contrato_id'] = String(filtros.contratoId);
    if (filtros.codigo) params['codigo'] = filtros.codigo;
    if (filtros.estado) params['estado'] = filtros.estado;
    if (filtros.periodoId) params['periodo_id'] = String(filtros.periodoId);
    if (filtros.fechaInicial) params['fecha_inicial'] = filtros.fechaInicial;
    if (filtros.fechaFinal) params['fecha_final'] = filtros.fechaFinal;
    return this.http.get<TnlRegistro[]>(`${this.baseTnl}/`, { params });
  }

  /** Detalle de un TNL: registro + histórico de aplicación + saldo pendiente. */
  detalleTnl(id: number): Observable<TnlDetalle> {
    return this.http.get<TnlDetalle>(`${this.baseTnl}/${id}/`);
  }

  /** Reintenta los BLOQUEADOS cuyo empleado/contrato ya existe → vuelven a PENDIENTE. */
  revalidarTnl(clienteId: number, periodoId?: number | null): Observable<TnlRevalidacionResponse> {
    const params: Record<string, string> = { cliente_id: String(clienteId) };
    if (periodoId) params['periodo_id'] = String(periodoId);
    return this.http.post<TnlRevalidacionResponse>(`${this.baseTnl}/revalidar/`, null, { params });
  }

  // ── NOVEDADES DEL PERIODO (registro manual desde el submódulo Novedades) ──
  // Las novedades se generan y almacenan aquí contra (empresa usuaria, periodo);
  // el cálculo las consume después. El borrado es lógico (estado ANULADA).
  private baseNovedadesPeriodo = `${environment.apiUrl}/api/nomina/novedades-periodo`;

  /** Novedades registradas para la empresa+periodo (filtro q opcional). */
  getNovedadesPeriodo(opts: {
    clienteId: number; periodoId: number; q?: string | null;
    estado?: EstadoNovedadPeriodo | null;
  }): Observable<NovedadPeriodo[]> {
    const params: Record<string, string> = {
      cliente_id: String(opts.clienteId),
      periodo_id: String(opts.periodoId),
    };
    if (opts.q && opts.q.trim()) params['q'] = opts.q.trim();
    if (opts.estado) params['estado'] = opts.estado;
    return this.http.get<NovedadPeriodo[]>(`${this.baseNovedadesPeriodo}/`, { params });
  }

  crearNovedadPeriodo(data: NovedadPeriodo): Observable<NovedadPeriodo> {
    return this.http.post<NovedadPeriodo>(`${this.baseNovedadesPeriodo}/`, data);
  }

  /** PATCH con scoping por tenant: el backend exige cliente_id y no permite
   *  tocar novedades de otra empresa usuaria (responde 404). */
  actualizarNovedadPeriodo(id: number, clienteId: number,
                           data: Partial<NovedadPeriodo>): Observable<NovedadPeriodo> {
    return this.http.patch<NovedadPeriodo>(`${this.baseNovedadesPeriodo}/${id}/`, data,
      { params: { cliente_id: String(clienteId) } });
  }

  /** Anulación lógica: la novedad deja de ser candidata al cálculo. */
  anularNovedadPeriodo(id: number, clienteId: number): Observable<NovedadPeriodo> {
    return this.http.delete<NovedadPeriodo>(`${this.baseNovedadesPeriodo}/${id}/`,
      { params: { cliente_id: String(clienteId) } });
  }

  // ── HISTÓRICO COMÚN de novedades (TNL + MANUAL en un solo modelo, V36) ────
  private baseNovedadesComun = `${environment.apiUrl}/api/nomina/novedades`;

  /** Vista unificada del periodo con KPIs por estado y origen. */
  getHistoricoNovedadesComun(opts: {
    clienteId: number; periodoId: number; origen?: 'TNL' | 'MANUAL' | null; q?: string | null;
  }): Observable<HistoricoNovedadesResponse> {
    const params: Record<string, string> = {
      cliente_id: String(opts.clienteId),
      periodo_id: String(opts.periodoId),
    };
    if (opts.origen) params['origen'] = opts.origen;
    if (opts.q && opts.q.trim()) params['q'] = opts.q.trim();
    return this.http.get<HistoricoNovedadesResponse>(
      `${this.baseNovedadesComun}/historico`, { params });
  }

  /** Detalle §47: normalizado + fila original completa + aplicaciones. */
  getDetalleNovedadComun(origen: 'TNL' | 'MANUAL', id: number,
                          clienteId: number): Observable<NovedadComunDetalle> {
    return this.http.get<NovedadComunDetalle>(
      `${this.baseNovedadesComun}/historico/${origen}/${id}`,
      { params: { cliente_id: String(clienteId) } });
  }

  /** Excel operacional IPANEMA generado DESDE BD (el motor nunca lo lee). */
  exportIpanemaXlsx(clienteId: number, periodoId: number): Observable<Blob> {
    return this.http.get(`${this.baseNovedadesComun}/export-ipanema`, {
      params: { cliente_id: String(clienteId), periodo_id: String(periodoId) },
      responseType: 'blob',
    });
  }

  // ── ENTIDADES EXTERNAS (mantenimiento general con borrado lógico) ─────────
  private baseEntExternas = `${environment.apiUrl}/api/nomina/entidades-externas`;

  /** @param tipo filtra por tipo permitido; omitir = todos.
   *  @param activo true=activas, false=inactivas, undefined/null=todas. */
  getEntidadesExternas(opts: { q?: string; tipo?: TipoEntidadExterna | null; activo?: boolean | null } = {}): Observable<EntidadExterna[]> {
    const params: Record<string, string> = {};
    if (opts.q && opts.q.trim()) params['q'] = opts.q.trim();
    if (opts.tipo) params['tipo'] = opts.tipo;
    if (opts.activo !== undefined && opts.activo !== null) params['activo'] = String(opts.activo);
    return this.http.get<EntidadExterna[]>(this.baseEntExternas, { params });
  }

  getEntidadExterna(id: number): Observable<EntidadExterna> {
    return this.http.get<EntidadExterna>(`${this.baseEntExternas}/${id}`);
  }

  crearEntidadExterna(data: EntidadExternaUpsert): Observable<EntidadExterna> {
    return this.http.post<EntidadExterna>(this.baseEntExternas, data);
  }

  actualizarEntidadExterna(id: number, data: EntidadExternaUpsert): Observable<EntidadExterna> {
    return this.http.put<EntidadExterna>(`${this.baseEntExternas}/${id}`, data);
  }

  desactivarEntidadExterna(id: number): Observable<EntidadExterna> {
    return this.http.patch<EntidadExterna>(`${this.baseEntExternas}/${id}/desactivar`, {});
  }

  reactivarEntidadExterna(id: number): Observable<EntidadExterna> {
    return this.http.patch<EntidadExterna>(`${this.baseEntExternas}/${id}/reactivar`, {});
  }

  // ── CENTROS DE COSTO (mantenimiento con borrado lógico) ───────────────────
  // Ruta SINGULAR: el catálogo operativo solo-activos sigue en getCentrosCostos()
  // (`/centros-costos`, plural). Este es el mantenimiento administrativo.
  private baseCentrosCosto = `${environment.apiUrl}/api/nomina/centros-costo`;

  /** @param activo true=activos, false=inactivos, undefined/null=todos. */
  getCentrosCostoAdmin(
    opts: { q?: string; empresaUsuariaId?: number | null; activo?: boolean | null } = {},
  ): Observable<CentroCostoAdmin[]> {
    const params: Record<string, string> = {};
    if (opts.q && opts.q.trim()) params['q'] = opts.q.trim();
    if (opts.empresaUsuariaId !== undefined && opts.empresaUsuariaId !== null) {
      params['empresa_usuaria_id'] = String(opts.empresaUsuariaId);
    }
    if (opts.activo !== undefined && opts.activo !== null) params['activo'] = String(opts.activo);
    return this.http.get<CentroCostoAdmin[]>(this.baseCentrosCosto, { params });
  }

  getCentroCostoAdmin(id: number): Observable<CentroCostoAdmin> {
    return this.http.get<CentroCostoAdmin>(`${this.baseCentrosCosto}/${id}`);
  }

  crearCentroCosto(data: CentroCostoUpsert): Observable<CentroCostoAdmin> {
    return this.http.post<CentroCostoAdmin>(this.baseCentrosCosto, data);
  }

  actualizarCentroCosto(id: number, data: CentroCostoUpsert): Observable<CentroCostoAdmin> {
    return this.http.put<CentroCostoAdmin>(`${this.baseCentrosCosto}/${id}`, data);
  }

  desactivarCentroCosto(id: number): Observable<CentroCostoAdmin> {
    return this.http.patch<CentroCostoAdmin>(`${this.baseCentrosCosto}/${id}/desactivar`, {});
  }

  reactivarCentroCosto(id: number): Observable<CentroCostoAdmin> {
    return this.http.patch<CentroCostoAdmin>(`${this.baseCentrosCosto}/${id}/reactivar`, {});
  }
}

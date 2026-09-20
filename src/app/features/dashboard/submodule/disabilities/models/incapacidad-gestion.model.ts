/**
 * Contratos de los submodulos NUEVOS de incapacidades (reunion funcional 2026-09-07):
 * correos a empresas usuarias (lote diario, directorio, trazabilidad), informes, alertas y
 * seguridad y salud en el trabajo. Espejo del backend ms-hr (`/Incapacidades/v2/**`), que
 * pinea cada campo en camelCase con @JsonProperty (ms-hr corre Jackson en SNAKE_CASE global).
 */

import type { TipoIncapacidad } from './incapacidad-v2.model';

export type GrupoEmpresa = 'APOYO' | 'ALIANZA';
export type ModoEnvioCorreo = 'INMEDIATO' | 'DIARIO';
export type EstadoEnvioCorreo = 'ENVIADO' | 'FALLIDO' | 'SIN_DESTINATARIO';

// ─────────────────────────────────────────────────────────────────────────
// Correos a empresas usuarias
// ─────────────────────────────────────────────────────────────────────────

export interface CorreoConfig {
  envioModo: ModoEnvioCorreo;
  envioHora: string;
  ventanaDias: number;
  ultimaCorrida: string;
  /** off | prueba | activo — en prueba TODO sale a `destinoPrueba`. */
  modoPlataforma: 'off' | 'prueba' | 'activo';
  destinoPrueba: string | null;
}

export interface CorreoConfigRequest {
  envioModo?: ModoEnvioCorreo;
  envioHora?: string;
  ventanaDias?: number;
  actor?: string;
}

export interface CorreoEmpresa {
  id: number;
  grupo: GrupoEmpresa;
  empresa: string;
  correo: string;
  rol: string | null;
  esPrincipal: boolean;
  orden: number;
  contactoNombre: string | null;
  oficinaResponsable: string | null;
  telefono: string | null;
  extension: string | null;
  activo: boolean;
  actualizadoPor: string | null;
  creadoEn: string | null;
}

export interface CorreoEmpresaRequest {
  grupo?: GrupoEmpresa;
  empresa?: string;
  correo?: string;
  rol?: string;
  esPrincipal?: boolean;
  orden?: number;
  contactoNombre?: string;
  oficinaResponsable?: string;
  telefono?: string;
  extension?: string;
  activo?: boolean;
  actor?: string;
}

/** Una incapacidad tal como viaja en el correo (el backend ya la resume). */
export interface FilaIncapacidadCorreo {
  incapacidadId: number;
  codigoConsecutivo: string | null;
  cedula: string;
  nombreCompleto: string;
  empresa: string | null;
  centroCosto: string | null;
  tipoIncapacidad: TipoIncapacidad | null;
  tipoIncapacidadEtiqueta: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  dias: number | null;
  creadoEn: string | null;
}

export interface GrupoLotePreview {
  clave: string;
  grupo: GrupoEmpresa | null;
  empresaMatch: string | null;
  destinatario: string | null;
  copias: string[];
  sinDestinatario: boolean;
  detalle: string | null;
  asunto: string;
  cuerpoHtml: string;
  incapacidades: FilaIncapacidadCorreo[];
}

export interface LotePreview {
  fecha: string;
  modoEnvio: ModoEnvioCorreo;
  prueba: boolean;
  destinoPrueba: string | null;
  totalIncapacidades: number;
  totalCorreos: number;
  grupos: GrupoLotePreview[];
}

export interface NotificacionCorreo {
  id: number;
  incapacidadId: number;
  loteId: number | null;
  estado: EstadoEnvioCorreo;
  modo: 'PRUEBA' | 'ACTIVO';
  destinatarios: string | null;
  cc: string | null;
  asunto: string | null;
  tieneCuerpo: boolean;
  empresaMatch: string | null;
  documentId: number | null;
  mensajeError: string | null;
  creadoEn: string | null;
}

export interface LoteCorreo {
  id: number;
  fechaLote: string;
  grupo: GrupoEmpresa | null;
  empresaMatch: string | null;
  destinatario: string | null;
  cc: string | null;
  asunto: string | null;
  cuerpoHtml: string | null;
  estado: EstadoEnvioCorreo;
  modo: 'PRUEBA' | 'ACTIVO';
  disparo: 'AUTOMATICO' | 'MANUAL';
  totalIncapacidades: number;
  remitente: string | null;
  mensajeError: string | null;
  creadoPor: string | null;
  creadoEn: string | null;
  incapacidades: NotificacionCorreo[];
}

export interface ResultadoEnvioLote {
  fecha: string;
  grupos: number;
  enviados: number;
  fallidos: number;
  sinDestinatario: number;
  incapacidades: number;
  lotes: LoteCorreo[];
}

export interface EnvioHistorial {
  notificacion: NotificacionCorreo;
  incapacidad: FilaIncapacidadCorreo;
}

// ─────────────────────────────────────────────────────────────────────────
// Informes
// ─────────────────────────────────────────────────────────────────────────

export interface SerieInforme {
  clave: string;
  etiqueta: string;
  cantidad: number;
  dias: number;
}

export interface MesInforme {
  anio: number;
  mes: number;
  etiqueta: string;
  total: number;
  dias: number;
  porTipo: SerieInforme[];
}

export interface ArlInforme {
  total: number;
  conInvestigacion: number;
  noAplica: number;
  sinInvestigacion: number;
  vencidas: number;
  plazoDias: number;
}

export interface InformeGlobal {
  desde: string;
  hasta: string;
  grupo: GrupoEmpresa | null;
  total: number;
  totalDias: number;
  personas: number;
  porTipo: SerieInforme[];
  porMes: MesInforme[];
  porOficina: SerieInforme[];
  porEmpresa: SerieInforme[];
  porCentroCosto: SerieInforme[];
  porEps: SerieInforme[];
  porResponsablePago: SerieInforme[];
  licenciasMaternidad: number;
  licenciasPaternidad: number;
  arl: ArlInforme;
  umbral180: number;
  proximas180: number;
  umbral540: number;
}

export interface FilaRecurrencia {
  cedula: string;
  nombreCompleto: string;
  empresa: string | null;
  centroCosto: string | null;
  oficina: string | null;
  eps: string | null;
  anio: number;
  mes: number;
  mesEtiqueta: string;
  eventos: number;
  dias: number;
  diagnosticos: string[];
  ips: string[];
  fechas: string[];
  incapacidadIds: number[];
}

export interface InformeRecurrencia {
  desde: string;
  hasta: string;
  maxDias: number;
  minEventos: number;
  total: number;
  filas: FilaRecurrencia[];
}

export interface FilaTopPersona {
  cedula: string;
  nombreCompleto: string;
  empresa: string | null;
  oficina: string | null;
  eventos: number;
  dias: number;
}

export interface InformeTop {
  desde: string;
  hasta: string;
  limite: number;
  filas: FilaTopPersona[];
}

export interface FiltrosInforme {
  desde?: string;
  hasta?: string;
  grupo?: GrupoEmpresa | '';
}

// ─────────────────────────────────────────────────────────────────────────
// Alertas
// ─────────────────────────────────────────────────────────────────────────

export type TipoAlertaIncapacidad =
  | 'INCAPACIDAD_FALSA'
  | 'MAS_DE_180_DIAS'
  | 'MAS_DE_540_DIAS'
  | 'PROXIMO_A_180'
  | 'TRASLAPE'
  | 'PRESCRITA';
export type DestinoAlertaIncapacidad = 'CONTRATACION' | 'GESTION_HUMANA' | 'CARTERA' | 'SST';
export type EstadoAlertaIncapacidad = 'PENDIENTE' | 'NOTIFICADA' | 'DESCARTADA' | 'ATENDIDA';

export interface AlertaBandeja {
  id: number;
  tipo: TipoAlertaIncapacidad;
  tipoEtiqueta: string;
  destino: DestinoAlertaIncapacidad;
  destinoEtiqueta: string;
  estado: EstadoAlertaIncapacidad;
  estadoEtiqueta: string;
  mensaje: string | null;
  creadaEn: string | null;
  atendidaPor: string | null;
  atendidaEn: string | null;
  nota: string | null;
  /** Falsedad dirigida a contratacion: el bloqueo se coordina aparte (no se toca contratacion). */
  paraContratacion: boolean;
  incapacidadId: number;
  codigoConsecutivo: string | null;
  cedula: string;
  nombreCompleto: string;
  empresa: string | null;
  centroCosto: string | null;
  oficina: string | null;
  tipoIncapacidad: TipoIncapacidad | null;
  tipoIncapacidadEtiqueta: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  dias: number | null;
  diasAcumulados: number | null;
  estadoDocumento: string | null;
  estadoIncapacidad: string | null;
}

export interface ConteoAlerta {
  tipo: TipoAlertaIncapacidad;
  tipoEtiqueta: string;
  destino: DestinoAlertaIncapacidad;
  estado: EstadoAlertaIncapacidad;
  cantidad: number;
}

export interface AlertasResumen {
  pendientes: number;
  pendientesFalsedad: number;
  pendientes180: number;
  pendientesTraslape: number;
  pendientesPrescritas: number;
  conteos: ConteoAlerta[];
}

export interface FiltrosAlertas {
  estado?: EstadoAlertaIncapacidad | '';
  destino?: DestinoAlertaIncapacidad | '';
  tipo?: TipoAlertaIncapacidad | '';
  cedula?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Seguridad y salud en el trabajo
// ─────────────────────────────────────────────────────────────────────────

export type EstadoInvestigacionSst = 'PENDIENTE' | 'EN_PROCESO' | 'COMPLETA' | 'NO_APLICA';

export interface InvestigacionSst {
  id: number | null;
  estado: EstadoInvestigacionSst;
  estadoEtiqueta: string;
  fechaInvestigacion: string | null;
  responsable: string | null;
  observaciones: string | null;
  documentId: number | null;
  nombreArchivo: string | null;
  subidoPor: string | null;
  subidoEn: string | null;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

export interface FilaSst {
  incapacidadId: number;
  codigoConsecutivo: string | null;
  codigoUnico: string | null;
  cedula: string;
  nombreCompleto: string;
  empresa: string | null;
  centroCosto: string | null;
  oficina: string | null;
  arl: string | null;
  tipoIncapacidad: TipoIncapacidad | null;
  tipoIncapacidadEtiqueta: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  dias: number | null;
  codigoDiagnostico: string | null;
  descripcionDiagnostico: string | null;
  estadoIncapacidad: string | null;
  fechaLimite: string | null;
  diasRestantes: number;
  vencida: boolean;
  tieneFurat: boolean;
  investigacion: InvestigacionSst;
}

export interface ResumenSst {
  desde: string | null;
  hasta: string | null;
  total: number;
  conInvestigacion: number;
  noAplica: number;
  sinInvestigacion: number;
  vencidas: number;
  plazoDias: number;
}

export interface InvestigacionSstRequest {
  estado?: EstadoInvestigacionSst;
  fechaInvestigacion?: string | null;
  responsable?: string;
  observaciones?: string;
  actor?: string;
}

export interface FiltrosSst {
  desde?: string;
  hasta?: string;
  q?: string;
  estado?: EstadoInvestigacionSst | '';
}

/** Etiquetas fijas de apoyo (el backend manda las suyas; estas cubren selects/filtros). */
export const ETIQUETA_ESTADO_INVESTIGACION: Readonly<Record<EstadoInvestigacionSst, string>> = {
  PENDIENTE: 'Pendiente',
  EN_PROCESO: 'En proceso',
  COMPLETA: 'Completa',
  NO_APLICA: 'No aplica',
};

export const ETIQUETA_TIPO_ALERTA: Readonly<Record<TipoAlertaIncapacidad, string>> = {
  INCAPACIDAD_FALSA: 'Incapacidad falsa',
  MAS_DE_180_DIAS: 'Mas de 180 dias',
  MAS_DE_540_DIAS: 'Mas de 540 dias',
  PROXIMO_A_180: 'Proximo a 180 dias',
  TRASLAPE: 'Traslape',
  PRESCRITA: 'Prescrita',
};

export const ETIQUETA_DESTINO_ALERTA: Readonly<Record<DestinoAlertaIncapacidad, string>> = {
  CONTRATACION: 'Contratacion',
  GESTION_HUMANA: 'Gestion humana',
  CARTERA: 'Cartera',
  SST: 'SST',
};

export const ETIQUETA_ESTADO_ALERTA: Readonly<Record<EstadoAlertaIncapacidad, string>> = {
  PENDIENTE: 'Pendiente',
  NOTIFICADA: 'Notificada',
  DESCARTADA: 'Descartada',
  ATENDIDA: 'Atendida',
};

/**
 * Contrato del carnet digital — espejo de `CarnetDtos` en ms-hr.
 *
 * Los campos de texto llegan SIEMPRE (cadena vacía cuando no hay dato), así que las
 * plantillas pintan directo y sólo comprueban lo que de verdad cambia el diseño.
 */

/** Estado del vínculo laboral. Es el sello que se pinta sobre la cara frontal. */
export type EstadoVinculo = 'ACTIVO' | 'RETIRADO' | 'SIN_CONTRATO';

/** Por qué una verificación salió como salió. */
export type ResultadoVerificacion =
  | 'VALIDO'
  | 'FIRMA_INVALIDA'
  | 'VENCIDO'
  | 'FORMATO_INVALIDO'
  | 'NO_ENCONTRADO'
  | 'MANUAL';

export interface Carnet {
  cedula: string;
  tipoDocumento: string;
  nombreCompleto: string;
  cargo: string;

  // Cara frontal
  empresa: string;
  oficina: string;
  centroCosto: string;
  temporal: string;

  // Cara trasera
  eps: string;
  afp: string;
  arl: string;
  rh: string;
  numeroContrato: string;
  codigoCarnet: string;
  fechaIngreso: string;
  fechaRetiro: string;

  estado: EstadoVinculo;
  /** false = no tiene ficha en contratación; el carnet salió de los datos de plataforma. */
  esEmpleado: boolean;
  /** Ruta relativa de la foto biométrica, o '' si no hay. Se descarga CON el JWT puesto. */
  fotoUrl: string;

  qrToken: string;
  emitidoEn: string;
  expiraEn: string;
}

export interface VerificacionCarnet {
  valido: boolean;
  resultado: ResultadoVerificacion;
  mensaje: string;
  emitidoEn: string;
  /** Llega incluso cuando `valido` es false por vencimiento: el vigilante necesita ver la cara. */
  carnet: Carnet | null;
}

export interface EscaneoCarnet {
  resultado: string;
  origen: string;
  docEscaneador: string;
  escaneadoEn: string;
}

/**
 * Acceso directo desde la ficha de una persona identificada hacia el módulo donde se
 * continúa el trámite. La cédula viaja como query param: los módulos que aún no la leen
 * simplemente la ignoran, y quien la lea se ahorra que la vuelvan a teclear.
 */
export interface AccesoRelacionado {
  etiqueta: string;
  descripcion: string;
  icono: string;
  ruta: string;
  /** Color del icono; agrupa visualmente por área. */
  color: string;
}

/**
 * Datos de prueba de Liquidacion compartidos por los specs (solo los importan los .spec.ts).
 * Cada constructor devuelve un objeto COMPLETO del contrato con overrides puntuales.
 */
import type {
  CargaLiquidacion,
  CausalNegacion,
  EquivalenciaCausal,
  FilaLiquidacion,
  IncapacidadRef,
  NegacionItem,
  PagoItem,
} from '../../models/incapacidad-salud.model';

export function incapacidadRef(p: Partial<IncapacidadRef> = {}): IncapacidadRef {
  return {
    id: 100,
    codigoUnico: '100585150520260801',
    codigoOficina: 'TASB018',
    cedula: '1005851505',
    tipoDocumento: 'CC',
    nombreCompleto: 'PEREZ GOMEZ ANA',
    eps: 'SALUD TOTAL',
    entidadRadicacion: 'SALUD TOTAL',
    tipoIncapacidad: 'ENFERMEDAD_GENERAL',
    tipoIncapacidadEtiqueta: 'Enfermedad general',
    fechaInicio: '2026-08-01',
    fechaFin: '2026-08-05',
    dias: 5,
    estado: 'RADICADA',
    estadoEtiqueta: 'Radicada',
    oficina: 'SOACHA',
    empresa: 'FINCA LA ESPERANZA',
    temporal: 'APOYO LABORAL',
    entidadGrupo: 'APOYO',
    numeroRadicado: 'RAD-1',
    fechaRadicado: '2026-08-06',
    dondeRadicado: 'PAGINA',
    dondeRadicadoEtiqueta: 'Portal web',
    radicadoPor: 'ligia',
    origen: null,
    ...p,
  };
}

export function filaLiquidacion(p: Partial<FilaLiquidacion> = {}): FilaLiquidacion {
  return {
    id: 1,
    hoja: 'PAGOS',
    fila: 2,
    eps: 'SALUD TOTAL',
    cedula: '1005851505',
    fechaInicio: '2026-08-01',
    codigoLeido: '100585150520260801',
    valorPagado: 350184,
    diasLiquidados: 3,
    diasAutorizados: 3,
    fechaPago: '2026-09-03',
    numeroIncapacidadEps: '9988',
    soporteContable: 'DOC-072',
    fechaRespuesta: null,
    causalTexto: null,
    causalId: null,
    causalCodigo: null,
    causalNombre: null,
    accion: null,
    accionEtiqueta: null,
    sinHomologar: false,
    observaciones: null,
    resultado: 'CRUZA',
    resultadoEtiqueta: null,
    mensaje: null,
    asignadaManual: false,
    aplicada: false,
    incapacidad: incapacidadRef(),
    sugerencias: [],
    ...p,
  };
}

export function cargaLiquidacion(p: Partial<CargaLiquidacion> = {}): CargaLiquidacion {
  return {
    id: 7,
    nombreArchivo: 'liquidacion_septiembre.xlsx',
    estado: 'SIMULADA',
    estadoEtiqueta: 'Simulada',
    filasPagos: 0,
    filasNegaciones: 0,
    cruzadas: 0,
    noCruzadas: 0,
    aplicadas: 0,
    creadoPor: 'ligia@tuapo.co',
    creadoEn: '2026-10-06T09:15:00',
    aplicadoPor: null,
    aplicadoEn: null,
    anuladoPor: null,
    anuladoEn: null,
    ...p,
  };
}

export function causalNegacion(p: Partial<CausalNegacion> = {}): CausalNegacion {
  return {
    id: 1,
    codigo: 'DIAS_1_2_NO_RECONOCIDOS',
    nombre: '1 y 2 dias no reconocidos por la EPS',
    accion: 'FINALIZA',
    accionEtiqueta: 'Finaliza',
    terminacion: 'FINALIZADO NEGADO 1 Y 2 DIAS',
    activo: true,
    orden: 1,
    equivalencias: 0,
    ...p,
  };
}

export function equivalenciaCausal(p: Partial<EquivalenciaCausal> = {}): EquivalenciaCausal {
  return {
    id: 30,
    causalId: 3,
    causalCodigo: 'SIN_AFILIACION',
    causalNombre: 'Cotizante no registrado',
    accion: 'RECOBRO',
    eps: 'NUEVA EPS',
    textoExterno: 'Causal 51',
    textoNormalizado: 'CAUSAL 51',
    activo: true,
    creadoPor: 'ligia',
    creadoEn: '2026-10-06T10:00:00',
    ...p,
  };
}

export function pagoItem(p: Partial<PagoItem> = {}): PagoItem {
  return {
    id: 5,
    incapacidad: incapacidadRef({ estado: 'PAGADA', estadoEtiqueta: 'Pagada' }),
    eps: 'SALUD TOTAL',
    valorPagado: 350184,
    diasLiquidados: 3,
    diasAutorizados: 3,
    fechaPago: '2026-07-03',
    numeroIncapacidadEps: '9988',
    soporteContable: 'DOC-072',
    observaciones: null,
    cargaId: 7,
    creadoPor: 'ligia',
    creadoEn: '2026-10-06T10:00:00',
    anulado: false,
    ...p,
  };
}

export function negacionItem(p: Partial<NegacionItem> = {}): NegacionItem {
  return {
    id: 8,
    incapacidad: incapacidadRef({ estado: 'RECOBRO', estadoEtiqueta: 'En recobro' }),
    eps: 'NUEVA EPS',
    diasLiquidados: 2,
    fechaRespuesta: '2026-09-10',
    causalTexto: 'Causal 51',
    causalId: null,
    causalCodigo: null,
    causalNombre: null,
    accion: 'RECOBRO',
    accionEtiqueta: 'Pasa a recobro',
    terminacion: null,
    sinHomologar: true,
    observaciones: null,
    cargaId: 7,
    creadoPor: 'ligia',
    creadoEn: '2026-10-06T10:00:00',
    anulado: false,
    ...p,
  };
}

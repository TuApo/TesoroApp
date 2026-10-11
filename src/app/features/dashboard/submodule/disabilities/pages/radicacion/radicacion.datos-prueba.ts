/**
 * Datos de prueba de Radicacion y Recobro, compartidos por sus specs (no lo importa codigo de
 * produccion). Cada fabrica arma un objeto COMPLETO del contrato con overrides puntuales.
 */
import Swal from 'sweetalert2';

import type { Page } from '../../models/incapacidad-v2.model';
import type {
  CodigoEncontrado,
  IncapacidadRef,
  RadicadoItem,
  RecobroItem,
  ResultadoAsignacionRadicado,
} from '../../models/incapacidad-salud.model';

/** `Swal.fire` tiene varias sobrecargas y jasmine no sabe espiarlas: firma simple. */
export function swalEspiable(): { fire: (...args: unknown[]) => Promise<unknown> } {
  return Swal as unknown as { fire: (...args: unknown[]) => Promise<unknown> };
}

export function refPrueba(parcial: Partial<IncapacidadRef> = {}): IncapacidadRef {
  return {
    id: 1,
    codigoUnico: '100585150520260131',
    codigoOficina: 'TASB018',
    cedula: '1005851505',
    tipoDocumento: 'CC',
    nombreCompleto: 'PEREZ GOMEZ ANA',
    eps: 'NUEVA EPS',
    entidadRadicacion: 'NUEVA EPS',
    tipoIncapacidad: 'ENFERMEDAD_GENERAL',
    tipoIncapacidadEtiqueta: 'Enfermedad general',
    fechaInicio: '2026-01-31',
    fechaFin: '2026-02-04',
    dias: 5,
    estado: 'VALIDADA',
    estadoEtiqueta: 'Validada',
    oficina: 'SOACHA',
    empresa: 'FINCA X',
    temporal: 'Tu Alianza',
    entidadGrupo: 'ALIANZA',
    numeroRadicado: null,
    fechaRadicado: null,
    dondeRadicado: null,
    dondeRadicadoEtiqueta: null,
    radicadoPor: null,
    origen: null,
    ...parcial,
  };
}

export function encontradoPrueba(
  parcial: Partial<CodigoEncontrado> = {},
  ref: Partial<IncapacidadRef> = {},
): CodigoEncontrado {
  const incapacidad = refPrueba(ref);
  return {
    codigo: incapacidad.codigoUnico,
    ambiguo: false,
    puedeRadicar: true,
    yaRadicada: false,
    motivo: null,
    incapacidad,
    ...parcial,
  };
}

export function radicadoPrueba(parcial: Partial<RadicadoItem> = {}): RadicadoItem {
  return {
    id: 10,
    incapacidadId: 1,
    codigoUnico: '100585150520260131',
    codigoOficina: 'TASB018',
    cedula: '1005851505',
    nombreCompleto: 'PEREZ GOMEZ ANA',
    eps: 'NUEVA EPS',
    tipo: 'RADICACION',
    tipoEtiqueta: 'Radicacion',
    numeroRadicado: 'RAD-1',
    fechaRadicado: '2026-02-10',
    dondeRadicado: 'PAGINA',
    dondeRadicadoEtiqueta: 'Portal web',
    entidad: 'NUEVA EPS',
    lote: null,
    numeroAnterior: null,
    negacionId: null,
    observaciones: null,
    radicadoPor: 'luis.carlos@tuapo.co',
    creadoEn: '2026-02-10T15:00:00Z',
    anulado: false,
    ...parcial,
  };
}

export function recobroPrueba(parcial: Partial<RecobroItem> = {}, ref: Partial<IncapacidadRef> = {}): RecobroItem {
  return {
    incapacidad: refPrueba({ estado: 'RECOBRO', estadoEtiqueta: 'Recobro', numeroRadicado: 'RAD-1', ...ref }),
    negacion: {
      id: 5,
      fechaRespuesta: '2026-03-01',
      causalTexto: 'NO SE EVIDENCIA PAGO DE SEGURIDAD SOCIAL',
      causalCodigo: 'SIN_PAGO_SS',
      causalNombre: 'Sin pago de seguridad social',
      eps: 'NUEVA EPS',
      creadoEn: '2026-03-02T10:00:00Z',
    },
    recobros: [],
    totalRadicados: 1,
    ...parcial,
  };
}

export function paginaPrueba<T>(content: T[], totalElements = content.length, number = 0, size = 25): Page<T> {
  return {
    content,
    number,
    size,
    totalElements,
    totalPages: Math.max(1, Math.ceil(totalElements / size)),
    first: number === 0,
    last: true,
    empty: content.length === 0,
  };
}

/** Resultado de un guardado: `ok` por id. */
export function resultadoPrueba(filas: Array<{ id: number; ok: boolean; mensaje?: string }>): ResultadoAsignacionRadicado {
  const exitosos = filas.filter((f) => f.ok).length;
  return {
    lote: filas.length > 1 ? 'lote-1' : null,
    total: filas.length,
    exitosos,
    fallidos: filas.length - exitosos,
    resultados: filas.map((f) => ({
      incapacidadId: f.id,
      codigo: `COD${f.id}`,
      ok: f.ok,
      mensaje: f.mensaje ?? (f.ok ? 'Radicada' : 'Error'),
      incapacidad: f.ok ? refPrueba({ id: f.id, estado: 'RADICADA' }) : null,
    })),
  };
}

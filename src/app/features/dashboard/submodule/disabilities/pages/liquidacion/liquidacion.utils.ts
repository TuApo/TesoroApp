/**
 * Utilidades compartidas por las pantallas de Liquidacion (carga de la plantilla, Pagos y
 * Negaciones) nacidas en la reunion funcional 2026-10-05.
 *
 * Son funciones puras (sin Angular) para poder probarlas solas: formato de dinero y fechas,
 * colores de chips, el resumen de una carga y los libros de Excel que se generan en el navegador.
 */
import { EMPTY, Observable, expand, reduce } from 'rxjs';
import * as XLSX from 'xlsx';

import { isOfflineQueued } from '../../../../../../core/utils/offline-response';
import type { TonoBadge } from '../../../../../../shared/components/tabla-estandar';
import type { Page } from '../../models/incapacidad-v2.model';
import {
  ACCION_CAUSAL_ETIQUETA,
  AccionCausal,
  CargaLiquidacionDetalle,
  EstadoCargaLiquidacion,
  FilaLiquidacion,
  IncapacidadRef,
  ResultadoFilaLiquidacion,
  ResumenCarga,
  ResumenHoja,
  ResumenHojaNegaciones,
} from '../../models/incapacidad-salud.model';
import { parsearFechaFlexible } from '../../utils/fechas';
import { codigoSinGuion } from '../../utils/codigos';

// ─────────────────────────────────────────────────────────────────────────
// Rutas y constantes
// ─────────────────────────────────────────────────────────────────────────

export const RUTA_LIQUIDACION = '/dashboard/disabilities/liquidacion';
export const RUTA_PAGOS = '/dashboard/disabilities/liquidacion/pagos';
export const RUTA_NEGACIONES = '/dashboard/disabilities/liquidacion/negaciones';

/** Nombre con el que se guarda la plantilla (el mismo que sirve ms-hr). */
export const NOMBRE_PLANTILLA = 'plantilla_liquidacion_incapacidades.xlsx';

/** Tope del archivo: el backend rechaza mas de 10 MB. */
export const TAMANO_MAXIMO_PLANTILLA = 10 * 1024 * 1024;

/** `eps` de una equivalencia que aplica a cualquier entidad. */
export const EPS_TODAS = '*';

/**
 * Codigos internos de las DOS causales que, segun la reunion 2026-10-05, finalizan la
 * incapacidad. Cualquier otra deberia ir a recobro: la pantalla de causales avisa si alguien
 * marca otra como FINALIZA (no lo impide: la lista definitiva la estandariza la funcional).
 */
export const CAUSALES_QUE_FINALIZAN: readonly string[] = ['DIAS_1_2_NO_RECONOCIDOS', 'SIN_APORTES_4_SEMANAS'];

/** Exportaciones: paginas de 200 (maximo del backend) hasta 10.000 registros. */
export const TAMANO_PAGINA_EXPORT = 200;
export const MAX_PAGINAS_EXPORT = 50;

// ─────────────────────────────────────────────────────────────────────────
// Formatos
// ─────────────────────────────────────────────────────────────────────────

const FORMATO_PESOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const FORMATO_ENTERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** `$ 350.184` (pesos colombianos sin decimales); '—' si no hay valor. */
export function pesos(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return '—';
  return FORMATO_PESOS.format(Number(valor));
}

/** `1.234` con separador de miles colombiano. */
export function entero(valor: number | null | undefined): string {
  return FORMATO_ENTERO.format(Number(valor ?? 0));
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * `dd/MM/yyyy` de una fecha del backend (`yyyy-MM-dd`). Pasa por `parsearFechaFlexible` para
 * no caer en el desfase UTC de `new Date('yyyy-MM-dd')`; si no se puede leer se devuelve el
 * texto tal cual (mejor ver el dato raro que esconderlo).
 */
export function fechaCorta(valor: string | null | undefined): string {
  if (!valor) return '';
  const fecha = parsearFechaFlexible(valor);
  if (!fecha) return valor;
  return `${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}

/** La fecha como `Date` local (para que la tabla estandar ordene por fecha). */
export function fechaComoDate(valor: string | null | undefined): Date | null {
  return valor ? parsearFechaFlexible(valor) : null;
}

/**
 * `dd/MM/yyyy HH:mm` de un instante ISO (creadoEn, aplicadoEn). Aqui SI se usa `new Date`:
 * un instante con zona es absoluto y se pinta en la hora local del equipo.
 */
export function fechaHora(valor: string | null | undefined): string {
  if (!valor) return '';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return valor;
  return (
    `${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)}/${fecha.getFullYear()} ` +
    `${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`
  );
}

/** `20261006-1435` para nombrar archivos sin pisarse entre descargas. */
export function marcaDeTiempo(ahora = new Date()): string {
  return (
    `${ahora.getFullYear()}${dosDigitos(ahora.getMonth() + 1)}${dosDigitos(ahora.getDate())}` +
    `-${dosDigitos(ahora.getHours())}${dosDigitos(ahora.getMinutes())}`
  );
}

/** "1 pago" / "3 pagos". */
export function plural(n: number, singular: string, varios: string): string {
  return `${entero(n)} ${n === 1 ? singular : varios}`;
}

/** Codigo que reconoce cartera: el de oficina (TASB018) si existe, si no el general. */
export function codigoVisible(ref: IncapacidadRef | null | undefined): string {
  if (!ref) return '';
  return ref.codigoOficina || codigoSinGuion(ref.codigoUnico);
}

/** "Todas las EPS" para el comodin '*'. */
export function etiquetaEps(eps: string | null | undefined): string {
  if (!eps) return '—';
  return eps === EPS_TODAS ? 'Todas las EPS' : eps;
}

export function etiquetaAccion(accion: AccionCausal | null | undefined): string {
  return accion ? ACCION_CAUSAL_ETIQUETA[accion] : '';
}

/** Mensaje legible de un error HTTP (`{error}` de ms-hr) o el texto por defecto. */
export function mensajeDeError(e: unknown, porDefecto: string): string {
  const err = e as { status?: number; error?: { error?: string; message?: string } | string } | null;
  if (err?.status === 0) return 'No hay conexión con el servidor. Revisa la red e inténtalo de nuevo.';
  if (typeof err?.error === 'string' && err.error.trim()) return err.error.trim();
  const cuerpo = err?.error as { error?: string; message?: string } | undefined;
  return cuerpo?.error || cuerpo?.message || porDefecto;
}

/**
 * El gateway corta a los 30 s (503 de su fallback, o 504) aunque ms-hr siga y TERMINE la operacion
 * (aplicar o anular una carga grande recalcula cada incapacidad). En esos casos no se puede decir
 * "no se pudo": hay que mirar el estado real antes de repetir.
 */
export function esTiempoAgotado(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return status === 503 || status === 504;
}

export const MENSAJE_TIEMPO_AGOTADO =
  'El servidor tardó demasiado en responder y puede que la operación sí se haya completado. ' +
  'Revisa el estado de la carga en el historial antes de repetirla.';

/**
 * Sin red, el interceptor offline ENCOLA los POST y responde un 200 falso (`_isOfflineMock`): la
 * operacion no llego a ms-hr. Las pantallas de Liquidacion no deben pintarlo como hecho (p. ej.
 * "Liquidacion aplicada" con todo en cero).
 */
export function quedoEnCola(respuesta: unknown): boolean {
  return isOfflineQueued(respuesta);
}

export const AVISO_EN_COLA = {
  icon: 'warning' as const,
  title: 'Sin conexión con el servidor',
  text:
    'La operación todavía no se hizo: quedó en la cola de envíos pendientes y se enviará cuando vuelva ' +
    'la conexión. Revisa el estado antes de repetirla.',
};

/** Para interpolar texto del usuario o del backend dentro del `html` de SweetAlert2. */
export function escaparHtml(v: string | null | undefined): string {
  return (v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Espejo de `NormalizadorCausal.normalizar` de ms-hr: mayusculas, sin tildes, todo lo que no sea
 * letra o digito pasa a espacio, espacios colapsados. Sirve para reconocer en la misma carga las
 * filas con el mismo texto de causal que otra que se acaba de homologar.
 */
export function normalizarCausal(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .slice(0, 255);
}

/** Comparacion tolerante de EPS (mayusculas, sin tildes ni espacios sobrantes). */
export function mismaEps(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizarCausal(a) === normalizarCausal(b);
}

// ─────────────────────────────────────────────────────────────────────────
// Chips
// ─────────────────────────────────────────────────────────────────────────

export function claseResultadoFila(resultado: ResultadoFilaLiquidacion): string {
  switch (resultado) {
    case 'CRUZA': return 'ges-chip-ok';
    case 'AMBIGUA': return 'ges-chip-aviso';
    case 'DUPLICADA': return 'ges-chip-neutro';
    default: return 'ges-chip-peligro';
  }
}

/** Tono del chip de la tabla estandar equivalente a cada clase `ges-chip-*` del modulo. */
export function tonoDeChip(clase: string): TonoBadge {
  switch (clase) {
    case 'ges-chip-ok': return 'ok';
    case 'ges-chip-aviso': return 'warn';
    case 'ges-chip-peligro': return 'danger';
    case 'ges-chip-info': return 'info';
    case 'ges-chip-morado': return 'violet';
    default: return 'neutro';
  }
}

/** FINALIZA cierra la incapacidad (morado, como los estados terminales); RECOBRO sigue viva. */
export function claseAccion(accion: AccionCausal | null | undefined): string {
  if (accion === 'FINALIZA') return 'ges-chip-morado';
  if (accion === 'RECOBRO') return 'ges-chip-aviso';
  return 'ges-chip-neutro';
}

export const ETIQUETA_ESTADO_CARGA: Record<EstadoCargaLiquidacion, string> = {
  SIMULADA: 'En revisión',
  APLICADA: 'Aplicada',
  DESCARTADA: 'Descartada',
  ANULADA: 'Anulada',
};

export function claseEstadoCarga(estado: EstadoCargaLiquidacion): string {
  switch (estado) {
    case 'APLICADA': return 'ges-chip-ok';
    case 'SIMULADA': return 'ges-chip-info';
    case 'ANULADA': return 'ges-chip-peligro';
    default: return 'ges-chip-neutro';
  }
}

/** Estado de la incapacidad: liquidada / negada / recobro con su color. */
export function claseEstadoIncapacidad(estado: string | null | undefined): string {
  switch (estado) {
    case 'PAGADA':
    case 'CONCILIADA': return 'ges-chip-ok';
    case 'FINALIZADA': return 'ges-chip-morado';
    case 'NEGADA':
    case 'RECOBRO': return 'ges-chip-aviso';
    case 'CANCELADA': return 'ges-chip-peligro';
    case 'RADICADA':
    case 'EN_REVISION_EPS': return 'ges-chip-info';
    default: return 'ges-chip-neutro';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Resumen de una carga
// ─────────────────────────────────────────────────────────────────────────

function resumenDeHoja(filas: FilaLiquidacion[]): ResumenHoja {
  const r: ResumenHoja = { total: filas.length, cruzan: 0, noCruzan: 0, ambiguas: 0, duplicadas: 0, errores: 0 };
  for (const f of filas) {
    if (f.resultado === 'CRUZA') r.cruzan++;
    else if (f.resultado === 'NO_CRUZA') r.noCruzan++;
    else if (f.resultado === 'AMBIGUA') r.ambiguas++;
    else if (f.resultado === 'DUPLICADA') r.duplicadas++;
    else r.errores++;
  }
  return r;
}

/**
 * Resumen VIGENTE de la carga calculado desde sus filas. Al asignar una fila a mano o homologar
 * su causal el backend solo devuelve esa fila, asi que la alerta y las tarjetas se recalculan aqui
 * para que siempre cuadren con la tabla. Criterio:
 *  - finalizan / recobro: negaciones que CRUZAN (las que se aplicarian) segun su accion;
 *  - sinHomologar: todas las negaciones sin causal interna (cruce aparte);
 *  - valorTotalPagos: la suma de TODAS las filas de Pagos (lo que trae la plantilla, para cuadrarlo
 *    con el extracto). El de ms-hr solo suma las que cruzan y se queda viejo al asignar a mano; lo
 *    que cruza ya se muestra aparte como "valor que se aplicara";
 *  - incapacidadesDistintas: incapacidades distintas entre las filas que cruzan.
 * Si el backend no mando filas (respuesta recortada) se respeta su resumen.
 */
export function resumenVigente(detalle: CargaLiquidacionDetalle | null): ResumenCarga | null {
  if (!detalle) return null;
  const filas = detalle.filas ?? [];
  if (filas.length === 0) return detalle.resumen ?? null;

  const pagos = filas.filter((f) => f.hoja === 'PAGOS');
  const negaciones = filas.filter((f) => f.hoja === 'NEGACIONES');
  const resumenNegaciones: ResumenHojaNegaciones = {
    ...resumenDeHoja(negaciones),
    finalizan: negaciones.filter((f) => f.resultado === 'CRUZA' && f.accion === 'FINALIZA').length,
    recobro: negaciones.filter((f) => f.resultado === 'CRUZA' && f.accion !== 'FINALIZA').length,
    sinHomologar: negaciones.filter((f) => f.sinHomologar).length,
  };
  const distintas = new Set(
    filas.filter((f) => f.resultado === 'CRUZA' && f.incapacidad).map((f) => f.incapacidad!.id),
  );
  return {
    pagos: resumenDeHoja(pagos),
    negaciones: resumenNegaciones,
    valorTotalPagos: pagos.reduce((s, f) => s + (Number(f.valorPagado) || 0), 0),
    incapacidadesDistintas: distintas.size,
  };
}

export type TonoAlerta = 'ok' | 'aviso' | 'peligro';

export interface AlertaCarga {
  tono: TonoAlerta;
  titulo: string;
  detalle: string[];
}

/**
 * La ALERTA que pidio la funcional al subir la plantilla:
 * "Subiste N pagos y M negaciones: X cruzan con una incapacidad, Y no cruzan".
 */
export function alertaDeCarga(r: ResumenCarga | null): AlertaCarga | null {
  if (!r) return null;
  const cruzan = r.pagos.cruzan + r.negaciones.cruzan;
  const noCruzan = r.pagos.noCruzan + r.negaciones.noCruzan;
  const ambiguas = r.pagos.ambiguas + r.negaciones.ambiguas;
  const duplicadas = r.pagos.duplicadas + r.negaciones.duplicadas;
  const errores = r.pagos.errores + r.negaciones.errores;
  const total = r.pagos.total + r.negaciones.total;

  const titulo =
    `Subiste ${plural(r.pagos.total, 'pago', 'pagos')} y ${plural(r.negaciones.total, 'negación', 'negaciones')}: ` +
    `${entero(cruzan)} ${cruzan === 1 ? 'cruza' : 'cruzan'} con una incapacidad, ` +
    `${entero(noCruzan)} no ${noCruzan === 1 ? 'cruza' : 'cruzan'}.`;

  const detalle: string[] = [];
  const otras: string[] = [];
  if (ambiguas) otras.push(`${entero(ambiguas)} con varias incapacidades posibles`);
  if (duplicadas) otras.push(`${plural(duplicadas, 'ya registrada', 'ya registradas')} (no se vuelven a aplicar)`);
  if (errores) otras.push(`${entero(errores)} con error en los datos`);
  if (otras.length) detalle.push(`Además: ${unirConY(otras)}.`);
  if (noCruzan + ambiguas > 0) {
    detalle.push(
      'Casi siempre no cruzan porque la EPS reportó otra fecha de inicio: revisa las sugerencias ' +
        '(misma cédula) y asígnalas con un clic, o exporta las filas para gestionarlas.',
    );
  }
  if (r.negaciones.sinHomologar > 0) {
    detalle.push(
      `${plural(r.negaciones.sinHomologar, 'negación no tiene', 'negaciones no tienen')} la causal homologada: ` +
        'si no se homologan pasan a recobro.',
    );
  }

  let tono: TonoAlerta = 'ok';
  if (total > 0 && cruzan === 0) tono = 'peligro';
  else if (noCruzan + ambiguas + errores > 0) tono = 'aviso';
  return { tono, titulo, detalle };
}

function unirConY(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** Filas que quedan por gestionar fuera de la plataforma: no cruzan, varias posibles o error. */
export function filasSinCruce(filas: FilaLiquidacion[]): FilaLiquidacion[] {
  return filas.filter((f) => f.resultado === 'NO_CRUZA' || f.resultado === 'AMBIGUA' || f.resultado === 'ERROR');
}

// ─────────────────────────────────────────────────────────────────────────
// Excel en el navegador
// ─────────────────────────────────────────────────────────────────────────

function sugerenciasTexto(f: FilaLiquidacion): string {
  return (f.sugerencias ?? [])
    .map((s) => `${codigoVisible(s)} (${fechaCorta(s.fechaInicio)} a ${fechaCorta(s.fechaFin)}, ${s.estadoEtiqueta ?? s.estado})`)
    .join(' | ');
}

/**
 * Libro con las filas que no cruzaron, en el MISMO orden de columnas de la plantilla (para
 * corregirlas y volver a subirlas) mas la fila original, el resultado, el motivo y las
 * sugerencias de la plataforma. Una hoja por cada hoja de la plantilla que tenga filas.
 */
export function libroFilasSinCruce(filas: FilaLiquidacion[]): XLSX.WorkBook {
  const libro = XLSX.utils.book_new();
  const pagos = filas.filter((f) => f.hoja === 'PAGOS');
  const negaciones = filas.filter((f) => f.hoja === 'NEGACIONES');

  if (pagos.length) {
    const hoja = XLSX.utils.json_to_sheet(
      pagos.map((f) => ({
        EPS: f.eps ?? '',
        Cedula: f.cedula ?? '',
        'Fecha inicio': fechaCorta(f.fechaInicio),
        'Codigo unico': f.codigoLeido ?? '',
        'Valor pagado': f.valorPagado ?? '',
        'Dias liquidados': f.diasLiquidados ?? '',
        'Dias autorizados': f.diasAutorizados ?? '',
        'Fecha de pago': fechaCorta(f.fechaPago),
        'Numero incapacidad EPS': f.numeroIncapacidadEps ?? '',
        'Soporte contable': f.soporteContable ?? '',
        Observaciones: f.observaciones ?? '',
        'Fila original': f.fila,
        Resultado: f.resultadoEtiqueta ?? f.resultado,
        Motivo: f.mensaje ?? '',
        Sugerencias: sugerenciasTexto(f),
      })),
    );
    hoja['!cols'] = [18, 14, 12, 20, 14, 10, 10, 12, 18, 18, 24, 8, 14, 50, 60].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(libro, hoja, 'Pagos');
  }

  if (negaciones.length) {
    const hoja = XLSX.utils.json_to_sheet(
      negaciones.map((f) => ({
        EPS: f.eps ?? '',
        Cedula: f.cedula ?? '',
        'Fecha inicio': fechaCorta(f.fechaInicio),
        'Codigo unico': f.codigoLeido ?? '',
        'Dias liquidados': f.diasLiquidados ?? '',
        'Fecha de respuesta': fechaCorta(f.fechaRespuesta),
        'Causal de negacion (EPS)': f.causalTexto ?? '',
        'Causal homologada': f.causalCodigo ?? '',
        Observaciones: f.observaciones ?? '',
        'Fila original': f.fila,
        Resultado: f.resultadoEtiqueta ?? f.resultado,
        Motivo: f.mensaje ?? '',
        Sugerencias: sugerenciasTexto(f),
      })),
    );
    hoja['!cols'] = [18, 14, 12, 20, 10, 12, 40, 22, 24, 8, 14, 50, 60].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(libro, hoja, 'Negaciones');
  }
  return libro;
}

/** Libro de una sola hoja a partir de objetos planos (exportaciones de Pagos y Negaciones). */
export function libroDeFilas(nombreHoja: string, filas: Record<string, unknown>[], anchos: number[] = []): XLSX.WorkBook {
  const libro = XLSX.utils.book_new();
  const hoja = XLSX.utils.json_to_sheet(filas);
  if (anchos.length) hoja['!cols'] = anchos.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
  return libro;
}

/** Escribe el libro como descarga (separado para poder espiarlo en las pruebas). */
export function escribirLibro(libro: XLSX.WorkBook, nombre: string): void {
  XLSX.writeFile(libro, nombre);
}

/**
 * Trae TODAS las paginas de un listado paginado (para exportar lo filtrado y no solo la pagina
 * visible). Secuencial para no castigar a ms-hr; corta en `maxPaginas`.
 */
export function traerTodasLasPaginas<T>(
  pedir: (pagina: number) => Observable<Page<T>>,
  maxPaginas = MAX_PAGINAS_EXPORT,
): Observable<T[]> {
  return pedir(0).pipe(
    expand((p) => (p.number + 1 < Math.min(p.totalPages ?? 0, maxPaginas) ? pedir(p.number + 1) : EMPTY)),
    reduce((todas, p) => todas.concat(p.content ?? []), [] as T[]),
  );
}

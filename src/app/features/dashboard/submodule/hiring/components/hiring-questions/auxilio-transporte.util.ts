/**
 * Valor INFORMATIVO del auxilio de transporte mensual en "Pago y Transporte".
 *
 * Pedido del usuario (2026-10-14): con "Auxilio de transporte = SI" se muestra al lado
 * el valor mensual del auxilio, y con "¿Usa ruta? = SI" el valor de la ruta, que es el
 * MISMO importe. Ninguno de los dos se edita ni se guarda: es solo para leer.
 *
 * La fuente es la misma que usan los documentos de contratación
 * (`db_admin.salario_minimo_vigencia`, Parametrización de vacantes › Salario mínimo),
 * con la misma regla de año: el configurado para ese año o, si falta, el del último año
 * anterior que lo tenga (ver `salarioMinimoDelAnio`).
 */
import {
  anioCreacionContrato, formatoPesosCO, parseMontoCOP, SalarioMinimoVigencia,
} from '../generate-contracting-documents/salario.util';

/** Texto cuando no hay ningún año configurado (o la configuración no cargó). */
export const AUXILIO_SIN_CONFIGURAR = 'Sin configurar';

/** Auxilio del año, o `null` si no hay nada configurado hasta ese año. */
export function auxilioTransporteDelAnio(
  vigencias: readonly SalarioMinimoVigencia[] | null | undefined, anio: number,
): number | null {
  let elegida: SalarioMinimoVigencia | null = null;
  for (const v of vigencias ?? []) {
    if (v.anio <= anio && (!elegida || v.anio > elegida.anio)) elegida = v;
  }
  const n = elegida ? parseMontoCOP(elegida.auxilio_transporte) : null;
  return n != null && n > 0 ? n : null;
}

/** Fecha del formulario (Date del datepicker o cadena ISO) como `AAAA-MM-DD`, o ''. */
function fechaIso(v: unknown): string {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v ?? '').trim();
}

/**
 * Año que decide el valor: el de la fecha de contrato o, si falta, el de la de ingreso;
 * sin ninguna, el año en curso. Mismo orden que `anioCreacionContrato`.
 */
export function anioAuxilio(fechaContrato: unknown, fechaIngreso: unknown, hoy: Date = new Date()): number {
  return anioCreacionContrato(
    { fecha_contrato: fechaIso(fechaContrato), fecha_ingreso: fechaIso(fechaIngreso) }, hoy);
}

/** `$ 249.095` o "Sin configurar". */
export function textoAuxilio(valor: number | null): string {
  return valor == null ? AUXILIO_SIN_CONFIGURAR : formatoPesosCO(valor);
}

/** El SI/NO del auxilio llega como 'Sí'/'No' (ver `toSiNo`); acepta también booleano. */
export function esSi(v: unknown): boolean {
  if (v === true) return true;
  const s = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return s === 'si';
}

/**
 * Presentacion del codigo tecnico de una incapacidad (reunion funcional 2026-08-26).
 *
 * El codigo tecnico historico era `cedula_yyyyMMdd`; cartera cruza ese codigo contra los
 * pagos de las EPS y el guion bajo le rompia las busquedas en Excel, asi que se pidio que
 * quede "solo el numero". El backend ya genera los codigos nuevos sin guion; los guardados
 * antes del cambio NO se reescriben (son el owner de los soportes en gestion documental),
 * por eso toda VISTA del codigo pasa por aqui. La busqueda del servidor casa con o sin
 * guion, asi que copiar el valor mostrado siempre encuentra el registro.
 */
export function codigoSinGuion(valor: string | null | undefined): string {
  return (valor ?? '').replace(/_/g, '');
}

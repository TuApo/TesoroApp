/**
 * A quien se le COBRA una incapacidad (reunion funcional 2026-10-20): un accidente de trabajo o
 * una enfermedad laboral se cobran SIEMPRE a la ARL (ARL SURA para todos los clientes), aunque el
 * trabajador tenga EPS; el resto, a su EPS. Espejo de `RadicacionNombresService.esParaArl` y de
 * `ExportJobService.entidadDeCobro` en ms-hr (consolidado del servidor y plantilla antigua).
 */

export const ARL_POR_DEFECTO_COBRO = 'ARL SURA';

/** true si el tipo se cobra a la ARL. */
export function esTipoArl(tipo: string | null | undefined): boolean {
  return tipo === 'ACCIDENTE_TRABAJO' || tipo === 'ENFERMEDAD_LABORAL';
}

/** La entidad de cobro: la ARL para AT/EL, la EPS para lo demas. */
export function entidadDeCobro(
  tipo: string | null | undefined,
  eps: string | null | undefined,
  arl?: string | null,
): string {
  if (esTipoArl(tipo)) return (arl ?? '').trim() || ARL_POR_DEFECTO_COBRO;
  return (eps ?? '').trim();
}

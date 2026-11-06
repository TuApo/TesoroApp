import { InjectionToken, Signal, computed, inject } from '@angular/core';

import { SalonContextoService } from './salon-contexto.service';

/**
 * Contexto de sede que consumen TODAS las páginas del salón. Es una interfaz, no el
 * servicio: en TesoroApp lo cumple `SalonContextoService` (selector propio + `salon:tienda`
 * en localStorage + `?tienda=`), y en EconomiaNegocio lo provee su `SedeService`, con lo
 * que el selector de sede desaparece solo (ver `components/selector-sede.ts`).
 */
export interface SalonContexto {
  /** Sede (`store_tienda.id`) actual, o null si aún no hay. */
  tiendaId: Signal<string | null>;
  /** Tenant/negocio, si la app lo conoce (en TesoroApp hoy es null: no hay claim). */
  tenantId: Signal<string | null>;
}

export const SALON_CONTEXTO = new InjectionToken<SalonContexto>('SALON_CONTEXTO', {
  providedIn: 'root',
  factory: () => inject(SalonContextoService),
});

/**
 * Permisos de pantalla (qué botones y pestañas se pintan). Si el contexto es el servicio
 * propio salen de `rol_en_la_tienda`; con un contexto ajeno se pinta todo y manda el
 * servidor (403). Nunca es seguridad: el backend valida cada petición.
 */
export function permisosDeContexto(ctx: SalonContexto): { puedeOperar: Signal<boolean>; puedeAdministrar: Signal<boolean> } {
  if (ctx instanceof SalonContextoService) return { puedeOperar: ctx.puedeOperar, puedeAdministrar: ctx.puedeAdministrar };
  const si = computed(() => true);
  return { puedeOperar: si, puedeAdministrar: si };
}

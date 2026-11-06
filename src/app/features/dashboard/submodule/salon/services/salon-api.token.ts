import { InjectionToken } from '@angular/core';

import { environment } from '@/environments/environment';

/**
 * Puntos de enchufe del submódulo. Existen para que el panel se pueda mudar a otra app
 * (EconomiaNegocio) sin tocar las pantallas: la app que lo monta provee estos tokens en
 * las rutas (`providers`) y listo. Todos traen un valor por defecto que sirve en TesoroApp.
 */

/** Base del API del salón (§4 del contrato): `…/api/v1/store/salon`. */
export const SALON_API_BASE = new InjectionToken<string>('SALON_API_BASE', {
  providedIn: 'root',
  factory: () => `${environment.apiUrl}/api/v1/store/salon`,
});

/**
 * URL del alcance de tiendas del usuario (misma forma que `Alcance` de `tienda.service.ts`).
 * En ms-store es `GET /api/v1/store/tiendas/mi-alcance` (org/web/TiendaController); si la app
 * que monta el submódulo tiene otro, lo provee aquí.
 */
export const SALON_ALCANCE_URL = new InjectionToken<string>('SALON_ALCANCE_URL', {
  providedIn: 'root',
  factory: () => `${environment.apiUrl}/api/v1/store/tiendas/mi-alcance`,
});

/** Prefijo de ruta donde está montado el submódulo (pestañas y navegación interna). */
export const SALON_RUTA_BASE = new InjectionToken<string>('SALON_RUTA_BASE', {
  providedIn: 'root',
  factory: () => '/dashboard/salon',
});

/**
 * Cómo obtener el JWT vigente para el canal SSE (va en `Authorization`, nunca en la URL).
 * Por defecto lo lee del `localStorage` como hace el login de TesoroApp; la app que lo
 * monte puede proveer una función que además lo renueve (en TesoroApp: `tokenParaUsar` de
 * `core/security/renovacion-token`, provisto desde `features/dashboard/routes.ts`, nunca desde
 * dentro del submódulo).
 */
export type ProveedorToken = () => Promise<string | null>;
export const SALON_TOKEN_JWT = new InjectionToken<ProveedorToken>('SALON_TOKEN_JWT', {
  providedIn: 'root',
  factory: () => tokenDeLocalStorage,
});

export async function tokenDeLocalStorage(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    let raw = localStorage.getItem('token') || localStorage.getItem('Authorization');
    if (!raw) {
      const u = localStorage.getItem('user');
      if (u) {
        const user = JSON.parse(u);
        raw = user?.token || user?.jwt || user?.access_token || user?.accessToken || null;
      }
    }
    return raw ? raw.replace(/^Bearer\s+/i, '') : null;
  } catch {
    return null;
  }
}

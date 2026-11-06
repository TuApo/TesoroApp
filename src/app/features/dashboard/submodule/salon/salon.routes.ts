import { Routes } from '@angular/router';

/**
 * Salón inteligente (ms-store `salon`, `/api/v1/store/salon`): plano en vivo con el estado de
 * cada mesa que decide el worker `salon-vision`, calibración de cámaras, anfitrión (lista de
 * espera), alertas, analítica y configuración. Contrato:
 * `microservices/workers/salon-vision/CONTRATO-API.md` (§1 y §4).
 *
 * <p>Nodos de `db_admin.modulo` esperados (`permisosLecturaGuard` toma el nodo más largo que
 * coincida):
 * <ul>
 *   <li>`/dashboard/salon` — «Salón» (padre, Plano en vivo)</li>
 *   <li>`/dashboard/salon/anfitrion` — Anfitrión (lista de espera y predicción)</li>
 *   <li>`/dashboard/salon/alertas` — Alertas</li>
 *   <li>`/dashboard/salon/analitica` — Analítica</li>
 *   <li>`/dashboard/salon/calibracion` — Calibración de cámaras (admin de la sede)</li>
 *   <li>`/dashboard/salon/configuracion` — Configuración (admin de la sede)</li>
 * </ul>
 *
 * <p>PORTABILIDAD: la carpeta `salon/` se copia tal cual a otra app (EconomiaNegocio). Nada de
 * aquí importa `core/`, `tienda/` ni el shell; la app que lo monta provee en su propia ruta
 * `SALON_API_BASE`, `SALON_CONTEXTO`, `SALON_RUTA_BASE`, `SALON_ALCANCE_URL` y
 * `SALON_TOKEN_JWT` si quiere cambiar los valores por defecto (ver README.md). La sede se
 * puede fijar por `?tienda=<id>`.
 */
export const SALON_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./pages/plano/plano').then(m => m.SalonPlanoPage) },
  { path: 'plano', redirectTo: '', pathMatch: 'full' },
  { path: 'calibracion', loadComponent: () => import('./pages/calibracion/calibracion').then(m => m.SalonCalibracionPage) },
  { path: 'anfitrion', loadComponent: () => import('./pages/anfitrion/anfitrion').then(m => m.SalonAnfitrionPage) },
  { path: 'alertas', loadComponent: () => import('./pages/alertas/alertas').then(m => m.SalonAlertasPage) },
  { path: 'analitica', loadComponent: () => import('./pages/analitica/analitica').then(m => m.SalonAnaliticaPage) },
  { path: 'configuracion', loadComponent: () => import('./pages/configuracion/configuracion').then(m => m.SalonConfiguracionPage) },
];

/** Compatibilidad con el patrón del dashboard (`loadChildren: … .then(m => m.routes)`). */
export const routes = SALON_ROUTES;

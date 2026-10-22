import { Routes } from '@angular/router';

/**
 * Monitoreo de equipos corporativos (ms-assets, dominio endpoint). La ruta
 * `/dashboard/monitoreo-equipos` debe coincidir con el nodo de `db_admin.modulo`
 * (módulo "Monitoreo de equipos") que crea la Flyway de ms-auth-admin del despliegue.
 */
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/monitoreo-equipos/monitoreo-equipos').then(m => m.MonitoreoEquipos) },
  // Generación de stickers/etiquetas (QR + código de barras) por sede. Cuelga del nodo 'monitoreo-equipos'.
  { path: 'etiquetas', loadComponent: () => import('./etiquetas/etiquetas').then(m => m.EtiquetasActivos) },
  // Analítica de actividad y mapa de proceso (gráficas + perfil IA).
  { path: 'actividad', loadComponent: () => import('./pages/actividad/actividad').then(m => m.Actividad) },
];

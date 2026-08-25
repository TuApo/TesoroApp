import { Routes } from '@angular/router';

/**
 * Novedades: la bandeja unificada de la plataforma.
 *
 * Vive como submódulo propio de primer nivel y NO bajo Matder, que es donde
 * estaba antes (`/dashboard/matder/notifications`). Esa ubicación era el
 * síntoma de que la única fuente de notificaciones era Matder; ahora aquí
 * aterrizan las de cualquier módulo y los comunicados generales, así que
 * colgarla de un módulo concreto no tendría sentido.
 *
 * Sin guard de permisos a propósito: todo usuario autenticado tiene bandeja.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/novedades/novedades.component').then(m => m.NovedadesComponent),
  },
];

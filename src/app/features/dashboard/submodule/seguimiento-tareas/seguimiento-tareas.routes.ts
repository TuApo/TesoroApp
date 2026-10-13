import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { PermissionsService } from '@/app/core/services/permissions.service';
import { RUTA_TICKETS } from './utils/tareas-ui';

/** La mesa de soporte trabaja los tickets: la ve quien puede leer el módulo de tickets. */
const puedeVerSoporte = () =>
  inject(PermissionsService).canReadRoute(RUTA_TICKETS) || inject(Router).parseUrl('/dashboard/tareas/mis-tareas');

/**
 * Seguimiento Tareas (antes "Workspace - MatDer").
 *
 * Además de las rutas nuevas en español se conservan como redirección las formas que
 * usan los avisos ya enviados y los enlaces guardados: `cards/:id`, `boards/:id`,
 * `workspaces/:id`... (ms-tools mandaba esos links antes de este cambio).
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/tareas-shell/tareas-shell.component').then(m => m.TareasShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'mis-tareas' },
      { path: 'mis-tareas', loadComponent: () => import('./pages/mis-tareas/mis-tareas.component').then(m => m.MisTareasComponent) },
      { path: 'tableros', loadComponent: () => import('./pages/tableros/tableros.component').then(m => m.TablerosComponent) },
      { path: 'tableros/:id', loadComponent: () => import('./pages/tablero/tablero.component').then(m => m.TableroComponent) },
      { path: 'espacios', loadComponent: () => import('./pages/espacios/espacios.component').then(m => m.EspaciosComponent) },
      { path: 'espacios/:id', loadComponent: () => import('./pages/espacios/espacios.component').then(m => m.EspaciosComponent) },
      { path: 'cronograma', loadComponent: () => import('./pages/cronograma/cronograma.component').then(m => m.CronogramaComponent) },
      { path: 'solicitudes', loadComponent: () => import('./pages/solicitudes/solicitudes.component').then(m => m.SolicitudesComponent) },
      { path: 'calendario', loadComponent: () => import('./pages/calendario/calendario.component').then(m => m.CalendarioComponent) },
      { path: 'indicadores', loadComponent: () => import('./pages/indicadores/indicadores.component').then(m => m.IndicadoresComponent) },
      { path: 'soporte', canActivate: [puedeVerSoporte], loadComponent: () => import('./pages/soporte/soporte.component').then(m => m.SoporteComponent) },
      { path: 'configuracion', loadComponent: () => import('./pages/configuracion/configuracion.component').then(m => m.ConfiguracionComponent) },
      { path: 'tarea/:id', loadComponent: () => import('./pages/tarea/tarea-page.component').then(m => m.TareaPageComponent) },

      // Formas viejas (links de avisos ya enviados y del menú en caché).
      { path: 'cards/:id', redirectTo: 'tarea/:id' },
      { path: 'boards/:id', redirectTo: 'tableros/:id' },
      { path: 'boards', redirectTo: 'tableros' },
      { path: 'workspaces/:id', redirectTo: 'espacios/:id' },
      { path: 'workspaces', redirectTo: 'espacios' },
      { path: 'dashboard', redirectTo: 'mis-tareas' },
      { path: 'calendar', redirectTo: 'calendario' },
      { path: 'analytics', redirectTo: 'indicadores' },
      { path: 'favorites', redirectTo: 'tableros' },
      { path: 'groups', redirectTo: 'espacios' },
      { path: 'import', redirectTo: 'configuracion' },
      { path: 'audit', redirectTo: 'configuracion' },
      { path: 'notifications', redirectTo: '/dashboard/novedades' },
      { path: '**', redirectTo: 'mis-tareas' },
    ],
  },
];

/**
 * /dashboard/matder/** → /dashboard/tareas/**. El módulo se llamaba MatDer: los avisos
 * viejos de la bandeja, marcadores y el menú cacheado en el navegador siguen apuntando ahí.
 */
export const rutasMatderLegado: Routes = [
  { path: 'cards/:id', redirectTo: '/dashboard/tareas/tarea/:id' },
  { path: 'tarea/:id', redirectTo: '/dashboard/tareas/tarea/:id' },
  { path: 'boards/:id', redirectTo: '/dashboard/tareas/tableros/:id' },
  { path: 'workspaces/:id', redirectTo: '/dashboard/tareas/espacios/:id' },
  { path: 'boards', redirectTo: '/dashboard/tareas/tableros' },
  { path: 'workspaces', redirectTo: '/dashboard/tareas/espacios' },
  { path: 'calendar', redirectTo: '/dashboard/tareas/calendario' },
  { path: 'analytics', redirectTo: '/dashboard/tareas/indicadores' },
  { path: 'favorites', redirectTo: '/dashboard/tareas/tableros' },
  { path: 'groups', redirectTo: '/dashboard/tareas/espacios' },
  { path: 'import', redirectTo: '/dashboard/tareas/configuracion' },
  { path: 'audit', redirectTo: '/dashboard/tareas/configuracion' },
  { path: 'notifications', redirectTo: '/dashboard/novedades' },
  { path: '**', redirectTo: '/dashboard/tareas/mis-tareas' },
];

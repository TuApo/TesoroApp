import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'resumen', pathMatch: 'full' },
  {
    path: 'resumen',
    loadComponent: () => import('./pages/resumen/resumen.component').then(m => m.ResumenComponent)
  },
  {
    path: 'actividad',
    loadComponent: () => import('./pages/actividad/actividad.component').then(m => m.ActividadComponent)
  },
  {
    path: 'cambios',
    loadComponent: () => import('./pages/cambios/cambios.component').then(m => m.CambiosComponent)
  },
  {
    path: 'seguridad',
    loadComponent: () => import('./pages/seguridad/seguridad.component').then(m => m.SeguridadComponent)
  },
];

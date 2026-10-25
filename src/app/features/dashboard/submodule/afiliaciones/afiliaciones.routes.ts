import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboardAfiliaciones', pathMatch: 'full' },
  {
    path: 'dashboardAfiliaciones',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.AfiliacionesDashboard)
  },
  {
    path: 'confirmacion-ingresos',
    loadComponent: () => import('./pages/confirmacion-ingresos/confirmacion-ingresos').then(m => m.ConfirmacionIngresos)
  },
  {
    path: 'plantillas-eps',
    loadComponent: () => import('./pages/plantillas-eps/plantillas-eps.component').then(m => m.PlantillasEpsComponent)
  },
  {
    path: 'envios-eps',
    loadComponent: () => import('./pages/envios-eps/envios-eps.component').then(m => m.EnviosEpsComponent)
  },
  {
    path: 'config-temporales',
    loadComponent: () => import('./pages/config-temporales/config-temporales.component').then(m => m.ConfigTemporales)
  }
];

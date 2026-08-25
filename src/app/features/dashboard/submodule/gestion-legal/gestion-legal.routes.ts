import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'bandeja', pathMatch: 'full' },
  {
    path: 'bandeja',
    loadComponent: () => import('./pages/bandeja/bandeja.component').then(m => m.BandejaComponent)
  },
  {
    path: 'expediente/:id',
    loadComponent: () => import('./pages/expediente/expediente.component').then(m => m.ExpedienteComponent)
  },
  {
    path: 'nuevo-proceso',
    loadComponent: () => import('./pages/nuevo-proceso/nuevo-proceso.component').then(m => m.NuevoProceso)
  },
];

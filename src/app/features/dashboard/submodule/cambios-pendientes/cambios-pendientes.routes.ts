import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/bandeja/bandeja.component').then(m => m.BandejaComponent),
    data: { title: 'Cambios por aprobar' },
  },
];

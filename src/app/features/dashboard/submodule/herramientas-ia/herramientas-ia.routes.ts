import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'asistente',
    pathMatch: 'full',
  },
  {
    path: 'asistente',
    loadComponent: () =>
      import('./pages/asistente-ia/asistente-ia.component').then(
        (m) => m.AsistenteIaComponent,
      ),
  },
  {
    path: 'conocimiento',
    loadComponent: () =>
      import('./pages/conocimiento/conocimiento.component').then(
        (m) => m.ConocimientoComponent,
      ),
  },
];

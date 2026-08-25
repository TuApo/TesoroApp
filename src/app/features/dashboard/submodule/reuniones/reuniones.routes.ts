import { Routes } from '@angular/router';

/**
 * Reuniones Funcionales y Gestión de Requisitos.
 *
 * Fase 1: reuniones, participantes, subida/grabación y transcripción sincronizada.
 * Las pantallas de hallazgos, requisitos y revisión llegan en las fases siguientes y
 * colgarán de la ficha de la reunión, no de rutas nuevas de primer nivel.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/reuniones-list/reuniones-list.component').then(m => m.ReunionesListComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/reunion-detail/reunion-detail.component').then(m => m.ReunionDetailComponent),
  },
  { path: '**', redirectTo: '' },
];

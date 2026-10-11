import { Routes } from '@angular/router';

/**
 * Reuniones: todo lo que se dijo, transcrito y relacionado por personas.
 *
 * - `''`             inicio: búsqueda en todo lo transcrito + reuniones y personas.
 * - `personas/:key`  ficha de una persona a través de todas las reuniones.
 * - `:id`            ficha de la reunión (conversación, quién habló, lo que se habló).
 *
 * `personas/:key` va ANTES de `:id`: si no, "personas" se tomaría como id de reunión.
 * Los parámetros (`:id`, `:key`, `?t=`, `?vista=`, `?q=`) llegan como inputs de los
 * componentes gracias a `withComponentInputBinding()` en app.config.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/reuniones-list/reuniones-list.component').then(m => m.ReunionesListComponent),
  },
  {
    path: 'personas/:key',
    loadComponent: () =>
      import('./pages/persona-detail/persona-detail.component').then(m => m.PersonaDetailComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/reunion-detail/reunion-detail.component').then(m => m.ReunionDetailComponent),
  },
  { path: '**', redirectTo: '' },
];

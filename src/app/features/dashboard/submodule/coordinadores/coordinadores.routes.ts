import { Routes } from '@angular/router';

/**
 * Coordinadores ("Asistentes al Trabajador en Misión").
 *
 * Solo la RAÍZ tiene pantalla propia: el inicio de campo del coordinador (marcar llegada
 * con QR, agenda, tareas, radio; ver `submodule/campo`). Sus otras pantallas viven en
 * `/dashboard/campo/...`. Los indicadores de formularios que antes eran este inicio están
 * en `/dashboard/campo/indicadores`. Los formularios del módulo viven en
 * `/dashboard/coordinadores/<grupo>/<slug>` y son formularios dinámicos de ms-forms: esas
 * URLs NO llegan aquí — en `features/dashboard/routes.ts` esta rama se registra con
 * `pathMatch: 'full'`, así que cualquier subruta sigue de largo hasta el comodín `**` con
 * `dynamicFormRouteMatch`, que las resuelve como siempre. No añadas hijos aquí sin
 * revisar eso: un hijo `visitas` taparía los formularios de ese grupo.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../campo/pages/inicio/inicio-campo.component')
        .then(m => m.InicioCampoComponent),
  },
];

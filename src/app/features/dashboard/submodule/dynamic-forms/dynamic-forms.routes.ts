import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';

/**
 * Formularios Dinámicos (Administración → Formularios dinamicos).
 * Ruta base real: /dashboard/gestion-del-programa/formularios-dinamicos
 *
 * Al seleccionar un formulario se abre UNA pantalla con las cinco vistas en pestañas
 * (formulario · respuestas · control del proceso · soportes · analítica), igual que cuando
 * se entra por el menú. Antes cada vista era una ruta suelta y para pasar de las respuestas
 * a la analítica había que volver al listado.
 *
 * OJO con el orden: 'builder', 'origenes' y 'llenar/:formId' van ANTES de los patrones
 * ':formId/...' porque el router resuelve en orden de declaración.
 */

/** Sufijos de URL que son una vista del formulario (deben coincidir con el host). */
const SUFIJOS_DE_VISTA = new Set(['formulario', 'respuestas', 'proceso', 'soportes', 'analitica']);

/**
 * Empareja `{id}` y `{id}/{vista}` con el host de pestañas, en UNA sola entrada de rutas.
 *
 * Se usa un matcher en vez de cinco rutas hermanas para que el host NO se destruya al
 * saltar de pestaña: con rutas distintas Angular recrea el componente y la barra parpadea
 * en cada clic. Con una sola, el host se reutiliza y solo cambia la vista montada.
 *
 * Devuelve null (y la ruta se descarta, pasando a la siguiente) para todo lo que no sea un
 * id numérico con un sufijo conocido — así `:formId/editar` sigue llegando al constructor
 * y `:formId/respuestas/:submissionId` al detalle de una respuesta.
 */
export function formViewMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length === 0 || segments.length > 2) return null;
  if (!/^\d+$/.test(segments[0].path)) return null;
  if (segments.length === 2 && !SUFIJOS_DE_VISTA.has(segments[1].path)) return null;
  return { consumed: segments, posParams: { formId: segments[0] } };
}

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/forms-list/forms-list.component').then(m => m.FormsListComponent),
  },
  {
    // Submódulo: tablas parametrizadas + orígenes que alimentan los campos de selección.
    path: 'origenes',
    loadComponent: () => import('./pages/option-sources/option-sources.component').then(m => m.OptionSourcesComponent),
  },
  {
    path: 'builder',
    loadComponent: () => import('./pages/form-builder/form-builder.component').then(m => m.FormBuilderComponent),
  },
  {
    // Enlace antiguo: llenar/{id} era una pantalla propia; ahora es la primera pestaña.
    path: 'llenar/:formId',
    redirectTo: ':formId',
    pathMatch: 'full',
  },
  {
    // Edición de estructura = el MISMO builder en modo edición (crea versión nueva).
    path: ':formId/editar',
    loadComponent: () => import('./pages/form-builder/form-builder.component').then(m => m.FormBuilderComponent),
  },
  {
    // Detalle de UNA respuesta: pantalla propia, no una pestaña (tiene su propia navegación).
    path: ':formId/respuestas/:submissionId',
    loadComponent: () => import('./pages/form-response-detail/form-response-detail.component').then(m => m.FormResponseDetailComponent),
  },
  {
    // Las cinco vistas del formulario, en una pantalla con pestañas.
    matcher: formViewMatcher,
    loadComponent: () => import('./pages/form-view-host/form-view-host.component').then(m => m.FormViewHostComponent),
  },
];

import { Routes } from '@angular/router';

/** Componente del Listado. Una sola referencia = un solo chunk perezoso para
 *  las dos rutas que lo sirven (`''` y `'list'`). */
const listado = () =>
  import('./pages/vacancy-list/vacancy-list.component').then((m) => m.VacancyListComponent);

/**
 * Submódulo Vacantes (Contratación → Vacantes).
 *
 * Dos SUBMÓDULOS del menú, no dos pestañas. La Flyway V89 de ms-auth-admin los
 * cuelga de "Vacantes" en `db_admin.modulo`, con sus permisos copiados uno a
 * uno de los que ya tenía el módulo padre:
 *
 *   /dashboard/vacancies/list       → Listado de Vacantes (operativa)
 *   /dashboard/vacancies/indicators → Indicadores de Vacantes (analítica)
 *   /dashboard/vacancies            → sirve el listado (ver abajo)
 *
 * OJO con la ruta vacía: sirve el listado DIRECTAMENTE en vez de redirigir a
 * `/list`. El navbar poda del menú los hijos que el usuario no puede leer, así
 * que quien no reciba permiso sobre los submódulos sigue viendo "Vacantes" como
 * hoja apuntando aquí; con un redirect, además, ese usuario perdería el
 * resaltado del menú, que compara la URL con `===` (y hay 78 módulos cuya ruta
 * es prefijo de otra, así que pasarlo a prefijo no es opción).
 *
 * El shell no pinta nada: existe para compartir filtros y datos entre las dos
 * vistas y limpiarlos al salir del módulo.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/vacancy-shell/vacancy-shell.component').then((m) => m.VacancyShellComponent),
    children: [
      { path: '', loadComponent: listado, data: { title: 'Listado de Vacantes' } },
      { path: 'list', loadComponent: listado, data: { title: 'Listado de Vacantes' } },
      {
        path: 'indicators',
        loadComponent: () =>
          import('./pages/vacancy-indicators/vacancy-indicators.component').then(
            (m) => m.VacancyIndicatorsComponent,
          ),
        data: { title: 'Indicadores de Vacantes' },
      },
      // Cualquier otra cosa bajo /vacancies cae en el listado en vez de dar 404.
      { path: '**', redirectTo: '' },
    ],
  },
];

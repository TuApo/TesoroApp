import { Routes } from '@angular/router';

/**
 * Submódulo Administración → Plantillas de correo
 * (`/dashboard/gestion-del-programa/plantillas-correo`).
 *
 * Cuelga del grupo "Administración" porque su vecino natural es Correos
 * electrónicos: allí se configuran las cuentas REMITENTES y aquí lo que se
 * manda con ellas. Separarlos en dos grupos de menú obligaría a saltar entre
 * secciones para una sola tarea.
 *
 * Las rutas hijas van antes que `:id` a propósito: si `medios` estuviera
 * después, el router lo tomaría como un identificador de plantilla.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/plantillas-lista/plantillas-lista.component')
        .then((m) => m.PlantillasListaComponent),
  },
  {
    path: 'medios',
    loadComponent: () =>
      import('./pages/biblioteca-medios/biblioteca-medios.component')
        .then((m) => m.BibliotecaMediosComponent),
  },
  {
    path: 'variables',
    loadComponent: () =>
      import('./pages/variables-catalogo/variables-catalogo.component')
        .then((m) => m.VariablesCatalogoComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/plantilla-editor/plantilla-editor.component')
        .then((m) => m.PlantillaEditorComponent),
  },
];

import { Routes } from '@angular/router';

/**
 * Carné digital.
 *
 * Dos pantallas con públicos distintos:
 *   · `mi-carnet`   — cualquiera con sesión. Es su propia identificación.
 *   · `identificar` — administración, portería o el área a la que se le asigne el módulo desde
 *                     el árbol de permisos de db_admin. Escanea o busca a OTROS.
 *
 * La separación es de ruta, no de componente, justamente para que el permiso se pueda dar por
 * separado: quien tiene carné no tiene por qué poder consultar el de los demás.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'mi-carnet', pathMatch: 'full' },
  {
    path: 'mi-carnet',
    loadComponent: () =>
      import('./pages/mi-carnet/mi-carnet.component').then(m => m.MiCarnetComponent),
  },
  {
    path: 'identificar',
    loadComponent: () =>
      import('./pages/identificar/identificar.component').then(m => m.IdentificarComponent),
  },
  // `verificar` es como se nombra la acción en la conversación del negocio; que un enlace
  // sembrado a mano con ese nombre lleve al panel y no al home cuesta una línea.
  { path: 'verificar', redirectTo: 'identificar', pathMatch: 'full' },
  { path: '**', redirectTo: 'mi-carnet' },
];

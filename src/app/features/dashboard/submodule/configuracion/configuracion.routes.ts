import { Routes } from '@angular/router';

/**
 * Sección de Configuración de la app. Antes vivía como un menú de engranaje
 * escondido en el header; ahora es un sub-módulo propio (accesible desde el
 * botón "Config" junto a "Salir" en la barra de navegación) con varias páginas.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/configuracion-shell/configuracion-shell.component').then(
        (m) => m.ConfiguracionShellComponent,
      ),
    children: [
      { path: '', redirectTo: 'cuenta', pathMatch: 'full' },
      {
        path: 'cuenta',
        loadComponent: () =>
          import('./pages/cuenta/cuenta.component').then((m) => m.CuentaConfigComponent),
      },
      {
        path: 'sede',
        loadComponent: () =>
          import('./pages/sede/sede.component').then((m) => m.SedeConfigComponent),
      },
      {
        path: 'preferencias',
        loadComponent: () =>
          import('./pages/preferencias/preferencias.component').then(
            (m) => m.PreferenciasConfigComponent,
          ),
      },
      {
        // Solo administradores. El shell esconde la entrada y el backend rechaza los
        // endpoints de gestion a quien no sea ADMIN: la puerta de verdad esta alla.
        path: 'conectores',
        loadComponent: () =>
          import('./pages/conectores/conectores.component').then((m) => m.ConectoresComponent),
      },
      {
        // A donde vuelve el navegador desde la pagina del proveedor. Va antes del
        // comodin y fuera de 'conectores' para que no lo capture su propia ruta.
        path: 'conectores/callback',
        loadComponent: () =>
          import('./pages/conectores-callback/conectores-callback.component').then(
            (m) => m.ConectoresCallbackComponent,
          ),
      },
      {
        path: 'acerca',
        loadComponent: () =>
          import('./pages/acerca/acerca.component').then((m) => m.AcercaConfigComponent),
      },
      { path: '**', redirectTo: 'cuenta' },
    ],
  },
];

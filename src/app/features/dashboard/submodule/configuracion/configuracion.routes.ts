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
        path: 'acerca',
        loadComponent: () =>
          import('./pages/acerca/acerca.component').then((m) => m.AcercaConfigComponent),
      },
      { path: '**', redirectTo: 'cuenta' },
    ],
  },
];

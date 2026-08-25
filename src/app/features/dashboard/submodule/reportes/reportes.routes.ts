import { Routes } from '@angular/router';

/**
 * Rutas del módulo Reportes y Analítica.
 *
 * Todo es lazy: el constructor arrastra ECharts y el editor de expresiones, y no
 * tiene por qué pesar en el arranque de la app para quien solo abre un reporte.
 *
 * Las rutas coinciden con las registradas en db_admin.modulo (migración V46 de
 * ms-auth-admin): el guard de permisos del dashboard resuelve el nodo del árbol
 * por la ruta más específica, así que un cambio aquí exige el cambio allá.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/reportes-home/reportes-home.component').then(m => m.ReportesHomeComponent),
  },
  {
    // Alias del listado: el módulo "Mis reportes" del menú apunta aquí.
    path: 'lista',
    loadComponent: () =>
      import('./pages/reportes-home/reportes-home.component').then(m => m.ReportesHomeComponent),
  },
  {
    path: 'constructor',
    loadComponent: () =>
      import('./pages/constructor/constructor.component').then(m => m.ConstructorComponent),
  },
  {
    path: 'constructor/:id',
    loadComponent: () =>
      import('./pages/constructor/constructor.component').then(m => m.ConstructorComponent),
  },
  {
    path: 'tableros',
    loadComponent: () =>
      import('./pages/reportes-home/reportes-home.component').then(m => m.ReportesHomeComponent),
  },
  {
    path: 'tableros/:id',
    loadComponent: () =>
      import('./pages/tablero-editor/tablero.component').then(m => m.TableroComponent),
  },
  {
    path: 'catalogo',
    loadComponent: () =>
      import('./pages/catalogo-admin/catalogo-admin.component').then(m => m.CatalogoAdminComponent),
  },
  {
    path: 'auditoria',
    loadComponent: () =>
      import('./pages/auditoria/auditoria.component').then(m => m.AuditoriaComponent),
  },
  { path: '**', redirectTo: '' },
];

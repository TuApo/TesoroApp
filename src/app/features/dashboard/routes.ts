import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { dynamicFormRouteMatch } from './submodule/dynamic-forms/dynamic-form-route.guard';
import { permisosLecturaGuard } from '../../core/guards/permisos-lectura.guard';

export const routes: Routes = [
  {
    path: '',
    component: DashboardComponent,
    canActivateChild: [permisosLecturaGuard],
    children: [
      { path: '', loadComponent: () => import('./submodule/home/home/home.component').then(m => m.HomeComponent) },
      { path: 'authorizations', loadChildren: () => import('./submodule/authorizations/authorizations.routes').then(m => m.routes) },
      { path: 'document-management', loadChildren: () => import('./submodule/document-management/document-management.routes').then(m => m.routes) },
      { path: 'eps-transfers', loadChildren: () => import('./submodule/eps-transfers/eps-transfers.routes').then(m => m.routes) },
      { path: 'hiring', loadChildren: () => import('./submodule/hiring/hiring.routes').then(m => m.routes) },
      { path: 'history', loadChildren: () => import('./submodule/history/history.routes').then(m => m.routes) },
      { path: 'users', loadChildren: () => import('./submodule/users/users.routes').then(m => m.routes) },
      { path: 'treasury', loadChildren: () => import('./submodule/treasury/treasury.routes').then(m => m.routes) },
      { path: 'payments', loadChildren: () => import('./submodule/payments/payments.routes').then(m => m.routes) },
      { path: 'vacancies', loadChildren: () => import('./submodule/vacancies/vacancies.routes').then(m => m.routes) },
      { path: 'positions', loadChildren: () => import('./submodule/positions/positions.routes').then(m => m.routes) },
      { path: 'farms', loadChildren: () => import('./submodule/farms/farms.routes').then(m => m.routes) },
      { path: 'robots', loadChildren: () => import('./submodule/robots/robots.routes').then(m => m.routes) },
      { path: 'nomina', loadChildren: () => import('./submodule/nomina/nomina.routes').then(m => m.routes) },
      { path: 'metricas', loadChildren: () => import('./submodule/metricas/metricas.routes').then(m => m.routes) },
      { path: 'contabilidad', loadChildren: () => import('./submodule/contabilidad/contabilidad.routes').then(m => m.routes) },
      { path: 'afiliaciones', loadChildren: () => import('./submodule/afiliaciones/afiliaciones.routes').then(m => m.routes) },
      { path: 'financiera', loadChildren: () => import('./submodule/financiera/financiera.routes').then(m => m.routes) },
      { path: 'bug-tickets', loadChildren: () => import('./submodule/bug-tickets/bug-tickets.routes').then(m => m.routes) },
      { path: 'matder', loadChildren: () => import('./submodule/matder/matder.routes').then(m => m.routes) },
      { path: 'disabilities', loadChildren: () => import('./submodule/disabilities/disabilities.routes').then(m => m.routes) },
      { path: 'merchandise', loadChildren: () => import('./submodule/merchandise/merchandise.routes').then(m => m.routes) },
      { path: 'market', loadChildren: () => import('./submodule/market/market.routes').then(m => m.routes) },
      { path: 'money-loan', loadChildren: () => import('./submodule/money-loan/money-loan.routes').then(m => m.routes) },
      { path: 'office-management', loadChildren: () => import('./submodule/office-management/office-management.routes').then(m => m.routes) },
      { path: 'reuniones', loadChildren: () => import('./submodule/reuniones/reuniones.routes').then(m => m.routes) },
      // Capacitaciones del colaborador (learning-ms). Vive aquí y no solo en Tu-Apo-Web:
      // el menú lo pinta esta app, y mandar a la persona a otro dominio la sacaba de su sesión.
      { path: 'capacitaciones', loadChildren: () => import('./submodule/training/training.routes').then(m => m.routes) },
      // Carné digital: 'mi-carnet' es para cualquiera con sesión; 'identificar' es el panel
      // que se asigna por permisos (administrativos, portería, otras áreas).
      { path: 'carnet', loadChildren: () => import('./submodule/carnet/carnet.routes').then(m => m.routes) },
      // Administración: el grupo ya no es solo un redirect, tiene pantallas propias
      // (Correos electrónicos). Su ruta '' conserva el redirect al primer hijo del grupo.
      { path: 'gestion-del-programa', loadChildren: () => import('./submodule/gestion-del-programa/gestion-del-programa.routes').then(m => m.routes) },
      { path: 'herramientas-ia', loadChildren: () => import('./submodule/herramientas-ia/herramientas-ia.routes').then(m => m.routes) },
      { path: 'gestion-legal', loadChildren: () => import('./submodule/gestion-legal/gestion-legal.routes').then(m => m.routes) },
      { path: 'audit-logs', loadChildren: () => import('./submodule/audit-logs/audit-logs.routes').then(m => m.routes) },
      // Reportes y Analítica: constructor de reportes, tableros y catálogo de datos.
      // Las rutas hijas están declaradas en db_admin.modulo (ms-auth-admin V46).
      { path: 'reportes', loadChildren: () => import('./submodule/reportes/reportes.routes').then(m => m.routes) },
      // Configuración de la app (antes escondida en el engranaje del header).
      { path: 'novedades', loadChildren: () => import('./submodule/novedades/novedades.routes').then(m => m.routes) },
      { path: 'configuracion', loadChildren: () => import('./submodule/configuracion/configuracion.routes').then(m => m.routes) },

      // Redirects para módulos PADRE del menú (db_admin.modulo) cuyas rutas apuntan
      // a paths sin pantalla propia. Antes hacían redirect silencioso al home;
      // ahora navegan al primer hijo del grupo.
      { path: 'juridico',                    redirectTo: 'gestion-legal/bandeja',             pathMatch: 'full' },
      { path: 'tesoreria',                   redirectTo: 'treasury/manage-workers',           pathMatch: 'full' },
      { path: 'autorizaciones',              redirectTo: 'authorizations/market-bonus',       pathMatch: 'full' },
      { path: 'operaciones-de-tesoreria',    redirectTo: 'treasury/manage-workers',           pathMatch: 'full' },
      { path: 'prestamo-de-dinero',          redirectTo: 'money-loan/emergency-loan',         pathMatch: 'full' },
      { path: 'mercado',                     redirectTo: 'market/load-market',                pathMatch: 'full' },
      { path: 'comercializadora',            redirectTo: 'merchandise/edit-merchandise',      pathMatch: 'full' },
      { path: 'mercancia',                   redirectTo: 'merchandise/edit-merchandise',      pathMatch: 'full' },
      { path: 'salud',                       redirectTo: 'disabilities/formulario',           pathMatch: 'full' },
      { path: 'seleccion-y-contratacion',    redirectTo: 'hiring/recruitment-pipeline',       pathMatch: 'full' },
      { path: 'contratacion/reportes',       redirectTo: 'hiring/hiring-report',              pathMatch: 'full' },
      { path: 'gestion-documental',          redirectTo: 'document-management/company-docs-access', pathMatch: 'full' },
      { path: 'traslados',                   redirectTo: 'eps-transfers/process-transfers',   pathMatch: 'full' },

      // Formularios dinámicos como VISTA de cualquier módulo: se registra JUSTO ANTES del
      // catch-all. El guard pregunta al backend si la URL (que no matcheó ninguna ruta
      // real) es un formulario; si no, devuelve false y cae al `**` → home. Así un
      // formulario colgado de p. ej. Nómina › Novedades vive en su URL canónica.
      // Carga el DISPATCHER (form-view-host), que resuelve la vista (Formulario /
      // Respuestas / Soportes / Analítica) y monta el hijo correspondiente.
      {
        path: '**',
        canMatch: [dynamicFormRouteMatch],
        loadComponent: () =>
          import('./submodule/dynamic-forms/pages/form-view-host/form-view-host.component').then(m => m.FormViewHostComponent),
      },

      { path: '**', redirectTo: '' },
    ],
  },
];

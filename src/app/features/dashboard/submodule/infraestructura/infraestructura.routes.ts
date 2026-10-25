import { Routes } from '@angular/router';

/**
 * Módulo Infraestructura. Las rutas coinciden con db_admin.modulo (ms-auth-admin V138):
 * /dashboard/infraestructura y sus hijos. Un solo marco (shell) mantiene la conexión en
 * vivo mientras se cambia de pestaña.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/shell/shell').then((m) => m.InfraShell),
    children: [
      { path: '', redirectTo: 'resumen', pathMatch: 'full' },
      { path: 'resumen', loadComponent: () => import('./pages/resumen/resumen').then((m) => m.InfraResumen), data: { title: 'Infraestructura' } },
      { path: '3d', loadComponent: () => import('./pages/vista-3d/vista-3d').then((m) => m.InfraVista3d), data: { title: 'Vista 3D' } },
      { path: 'servicios', loadComponent: () => import('./pages/servicios/servicios').then((m) => m.InfraServicios), data: { title: 'Servicios' } },
      { path: 'sitios', loadComponent: () => import('./pages/sitios/sitios').then((m) => m.InfraSitios), data: { title: 'Sitios' } },
      { path: 'red', loadComponent: () => import('./pages/red/red').then((m) => m.InfraRed), data: { title: 'Red' } },
      { path: 'datos', loadComponent: () => import('./pages/datos/datos').then((m) => m.InfraDatos), data: { title: 'Datos' } },
      { path: 'ubicaciones', loadComponent: () => import('./pages/ubicaciones/ubicaciones').then((m) => m.InfraUbicaciones), data: { title: 'Ubicaciones' } },
      { path: 'cluster', loadComponent: () => import('./pages/cluster/cluster').then((m) => m.InfraCluster), data: { title: 'Clúster' } },
      { path: 'alertas', loadComponent: () => import('./pages/alertas/alertas').then((m) => m.InfraAlertas), data: { title: 'Alertas y logs' } },
      { path: 'devops', redirectTo: 'devops/resumen', pathMatch: 'full' },
      { path: 'devops/:seccion', loadComponent: () => import('./pages/devops/devops').then((m) => m.InfraDevops), data: { title: 'DevOps' } },
      { path: 'informes', loadComponent: () => import('./pages/informes/informes').then((m) => m.InfraInformes), data: { title: 'Informes' } },
      { path: 'informes/:id', loadComponent: () => import('./pages/informes/informes').then((m) => m.InfraInformes), data: { title: 'Informe' } },
      { path: '**', redirectTo: 'resumen' },
    ],
  },
];

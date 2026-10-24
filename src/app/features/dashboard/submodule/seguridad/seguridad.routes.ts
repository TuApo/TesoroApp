import { Routes } from '@angular/router';

/**
 * Módulo Seguridad: centro de monitoreo, grabaciones, IA visual, rostros, domótica, audio,
 * alertas y configuración. Las rutas coinciden con db_admin.modulo (ms-auth-admin V140):
 * /dashboard/seguridad y sus hijos. Un solo marco (shell) mantiene la conexión en vivo
 * (SSE) mientras se cambia de pestaña.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/shell/shell').then((m) => m.SeguridadShell),
    children: [
      { path: '', redirectTo: 'resumen', pathMatch: 'full' },
      { path: 'resumen', loadComponent: () => import('./pages/resumen/resumen').then((m) => m.SeguridadResumen), data: { title: 'Seguridad' } },
      { path: 'monitoreo', loadComponent: () => import('./pages/monitoreo/monitoreo').then((m) => m.SeguridadMonitoreo), data: { title: 'Centro de monitoreo' } },
      { path: 'grabaciones', loadComponent: () => import('./pages/grabaciones/grabaciones').then((m) => m.SeguridadGrabaciones), data: { title: 'Grabaciones' } },
      { path: 'analitica', loadComponent: () => import('./pages/analitica/analitica').then((m) => m.SeguridadAnalitica), data: { title: 'Analítica IA' } },
      { path: 'rostros', loadComponent: () => import('./pages/rostros/rostros').then((m) => m.SeguridadRostros), data: { title: 'Rostros' } },
      { path: 'domotica', loadComponent: () => import('./pages/domotica/domotica').then((m) => m.SeguridadDomotica), data: { title: 'Domótica y accesos' } },
      { path: 'audio', loadComponent: () => import('./pages/audio/audio').then((m) => m.SeguridadAudio), data: { title: 'Audio y parlantes' } },
      { path: 'alertas', loadComponent: () => import('./pages/alertas/alertas').then((m) => m.SeguridadAlertas), data: { title: 'Alertas y protocolos' } },
      { path: 'configuracion', loadComponent: () => import('./pages/configuracion/configuracion').then((m) => m.SeguridadConfiguracion), data: { title: 'Configuración de seguridad' } },
      { path: '**', redirectTo: 'resumen' },
    ],
  },
];

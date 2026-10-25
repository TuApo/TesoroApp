import { Routes } from '@angular/router';

/**
 * Superficie PÚBLICA del módulo Seguridad: sin sesión, fuera del dashboard (como el televisor
 * de turnos). La credencial es el token propio de cada enlace.
 *
 *   /parlante/:codigo?token=…   el parlante de la sede en modo quiosco (PC, TV o tableta)
 *   /seguridad/r/:token         el enlace de acuse que llega en el mensaje de una alarma
 */
export const routesParlante: Routes = [
  { path: ':codigo', loadComponent: () => import('./parlante/parlante').then((m) => m.ParlanteQuiosco), title: 'Parlante · Seguridad' },
];

export const routesSeguridadPublica: Routes = [
  { path: 'r/:token', loadComponent: () => import('./acuse/acuse').then((m) => m.AcuseAlarma), title: 'Alarma · Seguridad' },
];

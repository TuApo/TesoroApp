import { Routes } from '@angular/router';

/**
 * Superficie PÚBLICA del módulo de turnos: sin sesión, fuera del dashboard.
 *
 *   /pantalla/:codigo        el televisor de la sala (navegador en modo quiosco)
 *   /t/:codigo               tomar turno desde el QR pegado en la pared
 *   /t/seguimiento/:turnoId  seguir el turno desde el celular
 *
 * `seguimiento` va antes de `:codigo` a propósito, o la ruta paramétrica se lo traga.
 */
export const routesPantalla: Routes = [
  { path: ':codigo', loadComponent: () => import('./pantalla-sala/pantalla-sala').then(m => m.PantallaSala) },
];

export const routesTurno: Routes = [
  { path: 'seguimiento/:turnoId', loadComponent: () => import('./seguimiento/seguimiento').then(m => m.SeguimientoTurno) },
  { path: ':codigo', loadComponent: () => import('./tomar-turno/tomar-turno').then(m => m.TomarTurno) },
  { path: '', loadComponent: () => import('./tomar-turno/tomar-turno').then(m => m.TomarTurno) },
];

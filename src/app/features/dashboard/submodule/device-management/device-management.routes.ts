import { Routes } from '@angular/router';

/**
 * Gestión de Equipos (ms-devicemgmt, capa móvil/MDM/anti-robo). La ruta
 * `/dashboard/dispositivos` debe coincidir con el nodo de `db_admin.modulo`
 * (módulo "Gestión de Equipos", ver deploy/menu-devicemgmt.sql). `permisosLecturaGuard`
 * toma el nodo de ruta más largo que coincida.
 *
 * Es la CONSOLA DE ADMINISTRACIÓN transparente: ver flota, estado, ubicación, apps,
 * políticas, geocercas, alertas y emitir comandos VISIBLES (localizar/alarma/bloqueo/
 * mensaje/respaldo/borrado corporativo). No hay vista de captura ambiental ni de
 * contenido privado: el backend no lo expone.
 */
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/consola/consola.component').then(m => m.ConsolaComponent) },
  { path: 'flota', loadComponent: () => import('./pages/consola/consola.component').then(m => m.ConsolaComponent) },
  { path: 'politicas', loadComponent: () => import('./pages/consola/consola.component').then(m => m.ConsolaComponent) },
  { path: 'geocercas', loadComponent: () => import('./pages/consola/consola.component').then(m => m.ConsolaComponent) },
  { path: 'alertas', loadComponent: () => import('./pages/consola/consola.component').then(m => m.ConsolaComponent) },
];

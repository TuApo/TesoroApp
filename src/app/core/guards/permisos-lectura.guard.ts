import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { PermissionsService } from '../services/permissions.service';

/**
 * Bloquea la navegación directa a pantallas del dashboard cuyo módulo existe
 * en el árbol de permisos pero el usuario no tiene lectura (el menú ya no las
 * pinta, pero la URL escrita a mano seguía entrando). Las rutas que no están
 * modeladas en el árbol pasan siempre: el árbol es la fuente de autorización
 * de módulos, no un catálogo de todas las URLs de la app.
 */
export const permisosLecturaGuard: CanActivateChildFn = (_route, state) => {
  const permisos = inject(PermissionsService);
  if (permisos.canReadRoute(state.url)) return true;
  return inject(Router).parseUrl('/dashboard');
};

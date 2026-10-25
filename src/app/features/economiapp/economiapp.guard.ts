import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { PermissionsService } from '../../core/services/permissions.service';
import { CLAVE_CAMBIO_PENDIENTE, RUTA_CAMBIO_PASSWORD } from '../../core/guards/cambio-password.guard';

/** El nodo de menú que da acceso a la tienda del comprador (ms-auth-admin V99). */
export const RUTA_PERMISO_TIENDA = '/dashboard/tienda/marketplace';

/**
 * EconomiAPP vive fuera de `/dashboard`, así que no hereda sus guards. Este repite lo que
 * importa de ellos:
 *  - sin sesión, al login;
 *  - con la clave inicial, a cambiarla (si no, bastaba con escribir /economiapp para saltársela);
 *  - sin lectura del módulo Marketplace, de vuelta al dashboard.
 */
export const economiaGuard: CanActivateFn = () => {
  const router = inject(Router);
  let token: string | null = null;
  let pendiente = false;
  try {
    token = localStorage.getItem('token') || localStorage.getItem('Authorization');
    if (!token) {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      token = u?.token || u?.jwt || u?.access_token || u?.accessToken || null;
    }
    pendiente = localStorage.getItem(CLAVE_CAMBIO_PENDIENTE) === '1';
  } catch { /* sin storage: se trata como sin sesión */ }

  if (!token) return router.parseUrl('/');
  if (pendiente) return router.parseUrl(RUTA_CAMBIO_PASSWORD);
  if (!inject(PermissionsService).canReadRoute(RUTA_PERMISO_TIENDA)) return router.parseUrl('/dashboard');
  return true;
};

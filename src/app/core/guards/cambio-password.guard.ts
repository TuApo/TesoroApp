import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';

/** Ruta donde la persona personaliza su contraseña. */
export const RUTA_CAMBIO_PASSWORD = '/dashboard/users/change-password';
/** Marca que deja el login cuando la cuenta sigue con la clave inicial (V86). */
export const CLAVE_CAMBIO_PENDIENTE = 'debe_cambiar_password';

/**
 * Retiene al usuario en la pantalla de cambio de contraseña mientras siga usando la clave
 * INICIAL con la que se creó su cuenta desde el formulario público.
 *
 * Esa clave es su número de documento y se le muestra en pantalla al registrarse, así que
 * no es un secreto: cualquiera que sepa su cédula podría entrar. El backend marca la cuenta
 * (`debe_cambiar_password`) y la desmarca en cuanto pone una suya.
 *
 * Va como guard y no solo como redirección en el login porque, si no, bastaba con escribir
 * cualquier URL del dashboard a mano para saltárselo.
 */
export const cambioPasswordGuard: CanActivateChildFn = (_route, state) => {
  let pendiente = false;
  try { pendiente = localStorage.getItem(CLAVE_CAMBIO_PENDIENTE) === '1'; } catch { /* sin storage: se deja pasar */ }
  if (!pendiente) return true;
  if (state.url.startsWith(RUTA_CAMBIO_PASSWORD)) return true;
  return inject(Router).parseUrl(RUTA_CAMBIO_PASSWORD);
};

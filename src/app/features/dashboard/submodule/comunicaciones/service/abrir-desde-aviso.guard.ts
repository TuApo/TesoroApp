import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ChatStoreService } from './chat-store.service';
import { DockService } from './dock.service';

/**
 * Los avisos de chat de la campana (y las llamadas perdidas) apuntan a
 * `/dashboard/comunicaciones?c=<id>`. En escritorio eso NO saca a la persona de lo que
 * está haciendo: el chat se abre en el dock y la navegación se cancela. Entrar al módulo
 * queda para el botón de maximizar (navega con `state: { maximizar: true }`). En el
 * celular, o si es la primera carga de la app, se sigue a la pantalla de chats.
 *
 * Corre solo al ENTRAR al módulo desde afuera (dentro, la ruta padre ya está activa), y
 * después de la redirección de la raíz a `chats`, por eso acepta las dos rutas.
 */
export const abrirChatDesdeAviso: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const url = router.parseUrl(state.url);
  const c = url.queryParams['c'];
  const ruta = state.url.split('?')[0].replace(/\/+$/, '');
  if (!c || (ruta !== '/dashboard/comunicaciones' && ruta !== '/dashboard/comunicaciones/chats')) return true;
  const r = router as unknown as { currentNavigation?: () => { extras?: { state?: Record<string, unknown> } } | null };
  const nav = typeof r.currentNavigation === 'function' ? r.currentNavigation() : router.getCurrentNavigation();
  if (nav?.extras?.state?.['maximizar']) return true;
  const dock = inject(DockService);
  if (!router.navigated || dock.compacto()) return true;
  const store = inject(ChatStoreService);
  if (!store.conversacion(c)) store.refrescar(c);
  dock.abrir(c);
  return false;
};

import { Routes } from '@angular/router';
import { abrirChatDesdeAviso } from './service/abrir-desde-aviso.guard';

export const routes: Routes = [
  {
    path: '',
    // Un aviso de chat de la campana abre la conversación en el dock en vez de entrar al módulo.
    canActivate: [abrirChatDesdeAviso],
    loadComponent: () => import('./pages/shell/comunicaciones-shell').then(m => m.ComunicacionesShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'chats' },
      { path: 'chats', loadComponent: () => import('./pages/chats/chats-page').then(m => m.ChatsPage) },
      { path: 'llamadas', loadComponent: () => import('./pages/llamadas/llamadas-page').then(m => m.LlamadasPage) },
      { path: 'personas', loadComponent: () => import('./pages/personas/personas-page').then(m => m.PersonasPage) },
      { path: 'contactos', loadComponent: () => import('./pages/contactos/contactos-page').then(m => m.ContactosPage) },
      { path: 'compromisos', loadComponent: () => import('./pages/compromisos/compromisos-page').then(m => m.CompromisosPage) },
      { path: 'buscar', loadComponent: () => import('./pages/buscar/buscar-page').then(m => m.BuscarPage) },
    ],
  },
];

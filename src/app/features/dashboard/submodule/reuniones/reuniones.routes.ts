import { Routes } from '@angular/router';

/**
 * Reuniones: todo lo que se dijo, transcrito y relacionado por personas.
 *
 * - `''`             inicio: búsqueda en todo lo transcrito + reuniones y personas.
 * - `bot`            asistente de reuniones: mandar el bot, sesiones en vivo e historial.
 * - `bot/configuracion` configuración del asistente de cada usuario.
 * - `bot/:sessionId` sala en vivo (transcripción, notas, compromisos, capturas, chat con la IA).
 * - `personas/:key`  ficha de una persona a través de todas las reuniones.
 * - `:id`            ficha de la reunión (conversación, quién habló, lo que se habló).
 *
 * `bot/**` y `personas/:key` van ANTES de `:id`: si no, "personas" se tomaría como id de reunión.
 * Los parámetros (`:id`, `:key`, `?t=`, `?vista=`, `?q=`) llegan como inputs de los
 * componentes gracias a `withComponentInputBinding()` en app.config.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/reuniones-list/reuniones-list.component').then(m => m.ReunionesListComponent),
  },
  {
    path: 'bot',
    loadComponent: () =>
      import('./bot/pages/bot-inicio/bot-inicio.component').then(m => m.BotInicioComponent),
  },
  {
    path: 'bot/configuracion',
    loadComponent: () =>
      import('./bot/pages/bot-config/bot-config.component').then(m => m.BotConfigComponent),
  },
  {
    path: 'bot/:sessionId',
    loadComponent: () =>
      import('./bot/pages/bot-sala/bot-sala.component').then(m => m.BotSalaComponent),
  },
  {
    path: 'personas/:key',
    loadComponent: () =>
      import('./pages/persona-detail/persona-detail.component').then(m => m.PersonaDetailComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/reunion-detail/reunion-detail.component').then(m => m.ReunionDetailComponent),
  },
  { path: '**', redirectTo: '' },
];

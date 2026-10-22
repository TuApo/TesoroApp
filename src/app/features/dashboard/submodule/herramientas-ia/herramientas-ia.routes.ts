import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'asistente',
    pathMatch: 'full',
  },
  {
    // Bandeja central del chat de IA estándar (todas las conversaciones de todos los módulos).
    path: 'conversaciones',
    loadComponent: () =>
      import('./pages/conversaciones/conversaciones').then((m) => m.ConversacionesIa),
  },
  {
    // Asistente IA sobre el chat estándar (ms-ai /api/v1/ai/chat, módulo herramientas-ia.asistente).
    // El componente anterior (pages/asistente-ia) queda solo para el chat del proceso de contratación.
    path: 'asistente',
    loadComponent: () =>
      import('./pages/asistente-chat/asistente-chat').then(
        (m) => m.AsistenteChat,
      ),
  },
  {
    path: 'desarrollo',
    loadComponent: () =>
      import('./pages/agentes-desarrollo/agentes-desarrollo.component').then(
        (m) => m.AgentesDesarrolloComponent,
      ),
  },
  {
    path: 'estudio',
    loadComponent: () =>
      import('./pages/estudio-agentes/estudio-agentes.component').then(
        (m) => m.EstudioAgentesComponent,
      ),
  },
  {
    path: 'conocimiento',
    loadComponent: () =>
      import('./pages/conocimiento/conocimiento.component').then(
        (m) => m.ConocimientoComponent,
      ),
  },
];

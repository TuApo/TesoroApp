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
    // Automatizaciones personales del Asistente IA (operador): horarios, ganchos y plantillas.
    path: 'automatizaciones',
    loadComponent: () =>
      import('./pages/automatizaciones-ia/automatizaciones-ia').then((m) => m.AutomatizacionesIa),
  },
  {
    // Personalidades del Asistente IA: estilos predefinidos y propios (tono, longitud, indicaciones, voz).
    path: 'personalidades',
    loadComponent: () =>
      import('./pages/personalidades-ia/personalidades-ia').then((m) => m.PersonalidadesIa),
  },
  {
    // Avatar Agent: el elenco de personajes del chat (presidente y directores por módulo) y sus avatares. Solo administración.
    path: 'avatar-agent',
    loadComponent: () =>
      import('./pages/avatar-agent/avatar-agent').then((m) => m.AvatarAgent),
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

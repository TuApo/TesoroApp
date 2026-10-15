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
    path: 'asistente',
    loadComponent: () =>
      import('./pages/asistente-ia/asistente-ia.component').then(
        (m) => m.AsistenteIaComponent,
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

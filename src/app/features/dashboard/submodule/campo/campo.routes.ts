import { Routes } from '@angular/router';

/**
 * Trabajo de campo de los coordinadores (`/dashboard/campo/...`).
 *
 * El inicio vive en `/dashboard/coordinadores` (la raíz del módulo); estas son sus
 * pantallas. Van en su propia rama y no como hijos de `coordinadores` porque esa rama es
 * `pathMatch: 'full'`: sus subrutas son los formularios dinámicos de ms-forms.
 *
 * Coordinador: marcar, agenda, tareas, radio, mapa (sus fincas).
 * Supervisor / administración: además mapa en vivo, equipo, fincas y zonas, revisión.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: '/dashboard/coordinadores' },
  { path: 'marcar', loadComponent: () => import('./pages/marcar/marcar.component').then(m => m.MarcarComponent) },
  { path: 'personal', loadComponent: () => import('./pages/personal/personal.component').then(m => m.PersonalComponent) },
  { path: 'radio', loadComponent: () => import('./pages/radio/radio.component').then(m => m.RadioComponent) },
  { path: 'mapa', loadComponent: () => import('./pages/mapa-vivo/mapa-vivo.component').then(m => m.MapaVivoComponent) },
  { path: 'agenda', loadComponent: () => import('./pages/agenda/agenda.component').then(m => m.AgendaComponent) },
  { path: 'tareas', loadComponent: () => import('./pages/tareas/tareas.component').then(m => m.TareasComponent) },
  { path: 'equipo', loadComponent: () => import('./pages/equipo/equipo.component').then(m => m.EquipoComponent) },
  { path: 'fincas', loadComponent: () => import('./pages/fincas/fincas.component').then(m => m.FincasComponent) },
  { path: 'revision', loadComponent: () => import('./pages/revision/revision.component').then(m => m.RevisionComponent) },
  // Los indicadores de formularios que antes eran el inicio de Coordinadores.
  {
    path: 'indicadores',
    loadComponent: () => import('../coordinadores/pages/inicio-coordinadores/inicio-coordinadores.component')
      .then(m => m.InicioCoordinadoresComponent),
  },
];

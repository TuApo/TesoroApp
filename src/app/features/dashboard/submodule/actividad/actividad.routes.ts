import { Routes } from '@angular/router';

/** Actividad del personal: quién hizo qué en la plataforma, e informes con IA. */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'personas' },
  { path: 'personas', loadComponent: () => import('./pages/personas/personas.component').then(m => m.PersonasComponent) },
  { path: 'personas/:id', loadComponent: () => import('./pages/persona/persona.component').then(m => m.PersonaComponent) },
  { path: 'informes', loadComponent: () => import('./pages/informes/informes.component').then(m => m.InformesComponent) },
  { path: '**', redirectTo: 'personas' },
];

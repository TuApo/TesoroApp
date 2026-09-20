import { Routes } from '@angular/router';

/**
 * Modulo de Marketing. La galeria es la puerta de entrada: es lo que alguien abre cuando
 * quiere el material de una vacante, que es el 90% de las visitas.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'piezas', pathMatch: 'full' },
  {
    path: 'piezas',
    loadComponent: () => import('./pages/piezas/piezas.component').then((m) => m.PiezasComponent),
    data: { title: 'Piezas' },
  },
  {
    path: 'manual',
    loadComponent: () => import('./pages/manual/manual.component').then((m) => m.ManualComponent),
    data: { title: 'Manual de marca' },
  },
  {
    path: 'mis-enlaces',
    loadComponent: () =>
      import('./pages/mis-enlaces/mis-enlaces.component').then((m) => m.MisEnlacesComponent),
    data: { title: 'Mis enlaces' },
  },
  {
    path: 'tablero',
    loadComponent: () =>
      import('./pages/tablero/tablero.component').then((m) => m.TableroComponent),
    data: { title: 'Tablero' },
  },
  {
    path: 'programacion',
    loadComponent: () =>
      import('./pages/programacion/programacion.component').then((m) => m.ProgramacionComponent),
    data: { title: 'Programación' },
  },
  {
    path: 'banco',
    loadComponent: () => import('./pages/banco/banco.component').then((m) => m.BancoComponent),
    data: { title: 'Banco de imágenes' },
  },
  {
    path: 'campanas',
    loadComponent: () => import('./pages/campanas/campanas.component').then((m) => m.CampanasComponent),
    data: { title: 'Campañas' },
  },
  {
    path: 'plantillas',
    loadComponent: () => import('./pages/plantillas/plantillas.component').then((m) => m.PlantillasComponent),
    data: { title: 'Plantillas' },
  },
  {
    path: 'seguimiento',
    loadComponent: () =>
      import('./pages/seguimiento/seguimiento.component').then((m) => m.SeguimientoComponent),
    data: { title: 'Seguimiento de vacantes' },
  },
  {
    path: 'config-marcas',
    loadComponent: () =>
      import('./pages/config-marcas/config-marcas.component').then((m) => m.ConfigMarcasComponent),
    data: { title: 'Configuración IA de marcas' },
  },
  { path: '**', redirectTo: 'piezas' },
];

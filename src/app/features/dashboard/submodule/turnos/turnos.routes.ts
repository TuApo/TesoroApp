import { Routes } from '@angular/router';

/**
 * Rutas del módulo Turnos y Control de Turnos.
 *
 * <p>Los caminos coinciden EXACTAMENTE con lo declarado en `db_admin.modulo` (ms-auth-admin
 * V119). `permisosLecturaGuard` toma el nodo de ruta más largo que coincida, así que una
 * ruta aquí que no exista allí dejaría al usuario fuera de su propia pantalla.
 *
 * <p>Las rutas con parámetro (`oficinas/:id/croquis`) cuelgan de un nodo declarado
 * (`/dashboard/turnos/oficinas`), que es el que el guard resuelve.
 */
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then(m => m.TurnosHome) },
  { path: 'atencion', loadComponent: () => import('./pages/atencion/atencion').then(m => m.Atencion) },
  { path: 'cola', loadComponent: () => import('./pages/cola/cola').then(m => m.ColaRecepcion) },
  { path: 'remoto', loadComponent: () => import('./pages/remoto/remoto').then(m => m.AtencionRemota) },
  { path: 'oficinas', loadComponent: () => import('./pages/oficinas/oficinas').then(m => m.Oficinas) },
  { path: 'oficinas/:id/croquis', loadComponent: () => import('./pages/croquis-editor/croquis-editor').then(m => m.CroquisEditor) },
  { path: 'servicios', loadComponent: () => import('./pages/servicios/servicios').then(m => m.Servicios) },
  { path: 'equipos', loadComponent: () => import('./pages/equipos/equipos').then(m => m.Equipos) },
  { path: 'cartel', loadComponent: () => import('./pages/cartel/cartel').then(m => m.CartelImprimiblePage) },
  { path: 'pantallas', loadComponent: () => import('./pages/pantallas/pantallas').then(m => m.Pantallas) },
  // Diseño de pantallas: vistas (bloques) y guiones (secuencia con transiciones) de los televisores.
  { path: 'disenos', loadComponent: () => import('./pages/disenos/disenos').then(m => m.Disenos) },
  // Voz y locución: voz de marca (ElevenLabs), frases de llamado, probador, biblioteca y camas musicales.
  { path: 'voz', loadComponent: () => import('./pages/voz/voz').then(m => m.VozLocucion) },
  { path: 'publicidad', loadComponent: () => import('./pages/publicidad/publicidad').then(m => m.Publicidad) },
  { path: 'tablero', loadComponent: () => import('./pages/tablero/tablero').then(m => m.TableroTurnos) },
  { path: 'casos', loadComponent: () => import('./pages/casos/casos').then(m => m.MisCasos) },
  // Abrir un caso por enlace (otra pestaña del navegador, otro equipo): activa el caso y
  // restaura la pantalla donde se iba. Cuelga del nodo 'casos' del árbol de permisos.
  { path: 'caso/:id', loadComponent: () => import('./pages/abrir-caso/abrir-caso').then(m => m.AbrirCaso) },
];

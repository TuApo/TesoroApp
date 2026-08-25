import { Routes } from '@angular/router';
import { CorreosElectronicosComponent } from './pages/correos-electronicos/correos-electronicos.component';

/**
 * Rutas del grupo de menú "Administración" (`/dashboard/gestion-del-programa`).
 *
 * Históricamente este path era solo un redirect al primer hijo del grupo
 * (`users/manage-users`), porque el módulo padre del menú (db_admin.modulo) no
 * tenía pantalla propia. Ese comportamiento se conserva tal cual en la ruta ''
 * de aquí; lo que cambia es que ahora el grupo SÍ puede tener hijos propios.
 *
 * El resto de submódulos de Administración (usuarios, roles, módulos,
 * parametrización, auditoría, cargos, centros de costo) siguen viviendo en sus
 * propios paths (`users/**`, `history/**`, …) y no se tocan.
 */
export const routes: Routes = [
  { path: '', redirectTo: '/dashboard/users/manage-users', pathMatch: 'full' },
  { path: 'correos-electronicos', component: CorreosElectronicosComponent },
  // Parametrizacion del hub de notificaciones: tipos del catalogo y reglas.
  // Carga diferida porque arrastra tres dialogos y solo la abre administracion.
  {
    path: 'notificaciones',
    loadComponent: () =>
      import('./pages/notificaciones/notificaciones.component').then((m) => m.NotificacionesComponent),
  },
  // Formularios Dinámicos (constructor + llenado + respuestas + analítica).
  // El módulo de menú ya existe en db_admin (Administracion → Formularios dinamicos).
  {
    path: 'formularios-dinamicos',
    loadChildren: () => import('../dynamic-forms/dynamic-forms.routes').then(m => m.routes),
  },
  // Plantillas de correo: el cuerpo y las variables de lo que se envía.
  // Va junto a `correos-electronicos` (las cuentas remitentes) porque son las
  // dos mitades de la misma tarea: con qué cuenta se manda y qué se manda.
  {
    path: 'plantillas-correo',
    loadChildren: () => import('../plantillas-correo/plantillas-correo.routes').then(m => m.routes),
  },
];

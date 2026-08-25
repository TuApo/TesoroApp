import { Routes } from '@angular/router';

/**
 * Rutas del módulo de Capacitaciones para el colaborador.
 *
 * `mis-certificados` va ANTES que `:enrollmentId` a propósito: si estuviera después, la ruta
 * paramétrica se lo tragaría y la pantalla de certificados nunca se abriría.
 *
 * Se llama `mis-certificados` y no `certificados` (como en Tu-Apo-Web) porque en ESTA app
 * `/dashboard/capacitaciones/certificados` ya está declarada en `db_admin.modulo` como el nodo
 * de la consola de administración (V53, `...ca07`), y V54 le revocó los permisos a todos los
 * roles: `permisosLecturaGuard` toma el nodo de ruta más larga que coincida, habría encontrado
 * ese y habría devuelto al usuario al home. La ruta vieja queda como redirect por si alguien
 * llega con el enlace de la otra aplicación.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/my-courses/my-courses').then(m => m.MyCourses)
  },
  {
    path: 'mis-certificados',
    loadComponent: () =>
      import('./pages/my-certificates/my-certificates').then(m => m.MyCertificates)
  },
  { path: 'certificados', redirectTo: 'mis-certificados', pathMatch: 'full' },
  {
    // Consola de administracion. Va ANTES de ':enrollmentId' o la ruta parametrica se la
    // tragaria y 'catalogo' se interpretaria como el id de una matricula.
    path: 'catalogo',
    loadComponent: () => import('./pages/admin-courses/admin-courses').then(m => m.AdminCourses)
  },
  {
    path: 'evaluaciones',
    loadComponent: () =>
      import('./pages/admin-question-banks/admin-question-banks').then(m => m.AdminQuestionBanks)
  },
  {
    path: 'grupos',
    loadComponent: () => import('./pages/admin-groups/admin-groups').then(m => m.AdminGroups)
  },
  {
    path: 'catalogo/:courseId',
    loadComponent: () =>
      import('./pages/admin-course-detail/admin-course-detail').then(m => m.AdminCourseDetail)
  },
  {
    path: ':enrollmentId',
    loadComponent: () => import('./pages/course-player/course-player').then(m => m.CoursePlayer)
  }
];

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
    // Tablero de quien administra la formacion. Antes de ':enrollmentId', por lo mismo que
    // 'catalogo': si no, la ruta parametrica se lo traga.
    path: 'tablero',
    loadComponent: () => import('./pages/admin-home/admin-home').then(m => m.AdminHome)
  },
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
    // Tambien antes de ':enrollmentId', por lo mismo que 'catalogo'.
    path: 'planes',
    loadComponent: () =>
      import('./pages/admin-assignment-plans/admin-assignment-plans').then(m => m.AdminAssignmentPlans)
  },
  {
    path: 'cumplimiento',
    loadComponent: () =>
      import('./pages/admin-compliance/admin-compliance').then(m => m.AdminCompliance)
  },
  {
    // Quien dicta un grupo: planilla, entregas y lista. No tiene nodo propio en el menú
    // porque ser instructor no es un rol; se llega desde el aviso de "Mis cursos" y desde
    // el tablero. Antes de ':enrollmentId' por lo mismo que las demás.
    path: 'profesor',
    loadComponent: () =>
      import('./pages/instructor-home/instructor-home').then(m => m.InstructorHome)
  },
  {
    path: 'profesor/:groupId',
    loadComponent: () =>
      import('./pages/instructor-home/instructor-home').then(m => m.InstructorHome)
  },
  {
    // Capacitaciones en vivo: agenda de aulas, entrar con código, crear, y cursos libres.
    // Antes de ':enrollmentId', como todas.
    path: 'en-vivo',
    loadComponent: () => import('./pages/aulas-agenda/aulas-agenda').then(m => m.AulasAgenda)
  },
  {
    path: 'aula/:id',
    loadComponent: () => import('./pages/aula/aula').then(m => m.AulaPage)
  },
  {
    // Diseñador de cursos con IA: el profesor sube su material, la IA lo entrevista y arma el
    // curso. Sin nodo en el menú, como 'profesor': lo usa quien dicta o administra formación y
    // se llega desde el tablero, el catálogo y la pantalla del profesor. Antes de ':enrollmentId'.
    path: 'disenar',
    loadComponent: () => import('./pages/disenador-lista/disenador-lista').then(m => m.DisenadorLista)
  },
  {
    path: 'disenar/:id',
    loadComponent: () => import('./pages/disenador/disenador').then(m => m.Disenador)
  },
  {
    // Diseño del certificado por curso. Es el nodo "Certificados" (ca07) del menú, que
    // apunta aquí desde V122 de ms-auth-admin.
    path: 'plantillas-certificados',
    loadComponent: () =>
      import('./pages/admin-certificate-templates/admin-certificate-templates')
        .then(m => m.AdminCertificateTemplates)
  },
  {
    // El curso tal como lo vera quien lo curse, sin matricula: el reproductor en modo vista
    // previa. Antes de 'catalogo/:courseId' para que no se lo trague.
    path: 'catalogo/:courseId/vista-previa/:versionId',
    loadComponent: () => import('./pages/course-player/course-player').then(m => m.CoursePlayer)
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

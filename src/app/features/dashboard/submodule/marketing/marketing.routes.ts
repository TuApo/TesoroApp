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
    // Carrusel del home: banners de eventos, comunicados y publicidad que se ven de primero
    // al entrar a la plataforma, con audiencia por rol, sede, grupo, persona o evento.
    path: 'banners',
    loadComponent: () => import('./pages/banners/banners.component').then((m) => m.BannersComponent),
    data: { title: 'Carrusel del home' },
  },
  {
    // Cumpleaños: la celebración que sale al primer ingreso del día. Antes era una pestaña del
    // carrusel; ahora es módulo propio con sus secciones (calendario, IA, etiquetas, plantillas).
    path: 'cumpleanos',
    loadComponent: () =>
      import('./pages/cumpleanos/cumpleanos-layout.component').then((m) => m.CumpleanosLayoutComponent),
    data: { title: 'Cumpleaños' },
    children: [
      { path: '', redirectTo: 'tablero', pathMatch: 'full' },
      {
        path: 'tablero',
        loadComponent: () =>
          import('./pages/cumpleanos/cumpleanos-tablero.component').then((m) => m.CumpleanosTableroComponent),
        data: { title: 'Cumpleaños · Tablero' },
      },
      {
        path: 'calendario',
        loadComponent: () =>
          import('./pages/cumpleanos/cumpleanos-admin.component').then((m) => m.CumpleanosAdminComponent),
        data: { title: 'Cumpleaños · Calendario', vista: 'calendario' },
      },
      {
        path: 'ia',
        loadComponent: () => import('./pages/cumpleanos/cumpleanos-ia.component').then((m) => m.CumpleanosIaComponent),
        data: { title: 'Cumpleaños · Personalización con IA' },
      },
      {
        path: 'etiquetas',
        loadComponent: () =>
          import('./pages/cumpleanos/cumpleanos-etiquetas.component').then((m) => m.CumpleanosEtiquetasComponent),
        data: { title: 'Cumpleaños · Etiquetas del equipo' },
      },
      {
        path: 'plantillas',
        loadComponent: () =>
          import('./pages/cumpleanos/cumpleanos-admin.component').then((m) => m.CumpleanosAdminComponent),
        data: { title: 'Cumpleaños · Plantillas de animación', vista: 'plantillas' },
      },
      {
        // El correo de felicitación (ms-payroll): la misma pantalla de Nómina, aquí sin su
        // cabecera y cruzada con la celebración de cada día.
        path: 'correos',
        loadComponent: () =>
          import('../nomina/pages/envio-correos-cumpleanos/envio-correos-cumpleanos.component')
            .then((m) => m.EnvioCorreosCumpleanosComponent),
        data: { title: 'Cumpleaños · Correos', incrustado: true },
      },
      { path: '**', redirectTo: 'tablero' },
    ],
  },
  {
    // Ordenes de servicio: pedidos a marketing (videos, PDF, cursos, piezas, textos) con sus
    // versiones —hechas con IA o subidas a mano—, revisiones y evidencia de entrega.
    path: 'ordenes',
    loadComponent: () => import('./pages/ordenes/ordenes.component').then((m) => m.OrdenesComponent),
    data: { title: 'Órdenes de servicio' },
  },
  {
    path: 'ordenes/:id',
    loadComponent: () =>
      import('./pages/orden-detalle/orden-detalle.component').then((m) => m.OrdenDetalleComponent),
    data: { title: 'Orden de servicio' },
  },
  {
    path: 'flujos',
    loadComponent: () => import('./pages/flujos/flujos.component').then((m) => m.FlujosComponent),
    data: { title: 'Flujos de IA' },
  },
  {
    path: 'config-marcas',
    loadComponent: () =>
      import('./pages/config-marcas/config-marcas.component').then((m) => m.ConfigMarcasComponent),
    data: { title: 'Configuración IA de marcas' },
  },
  { path: '**', redirectTo: 'piezas' },
];

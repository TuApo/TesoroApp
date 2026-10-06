import { Routes } from '@angular/router';

import { FormularioIncapacidadComponent } from './pages/formulario-incapacidad/formulario-incapacidad.component';
import { BuscarIncapacidadComponent } from './pages/buscar-incapacidad/buscar-incapacidad.component';
import { VistaTotalIncapacidadesComponent } from './pages/vista-total-incapacidades/vista-total-incapacidades.component';
import { SubidaArchivosIncapacidadesComponent } from './pages/subida-archivos-incapacidades/subida-archivos-incapacidades.component';

export const routes: Routes = [
  { path: '', redirectTo: 'formulario', pathMatch: 'full' },
    { path: 'formulario', component: FormularioIncapacidadComponent },
    { path: 'buscar', component: BuscarIncapacidadComponent },
    { path: 'total', component: VistaTotalIncapacidadesComponent },
    { path: 'subir', component: SubidaArchivosIncapacidadesComponent },

    // ── Incapacidades v2 ────────────────────────────────────────────────
    // Rutas HERMANAS de las viejas: los 4 componentes de arriba siguen
    // vivos hasta que la funcional valide los nuevos. Se cargan con
    // `loadComponent` (lazy) para no engordar el bundle del modulo.
    {
      path: 'registro',
      loadComponent: () =>
        import('./pages/registro-incapacidad/registro-incapacidad.component').then(
          (m) => m.RegistroIncapacidadComponent,
        ),
    },
    // Edicion: misma pantalla de registro con el id en la ruta. La consulta
    // navega aqui desde su boton "Editar" (ver RUTA_REGISTRO).
    {
      path: 'registro/:id',
      loadComponent: () =>
        import('./pages/registro-incapacidad/registro-incapacidad.component').then(
          (m) => m.RegistroIncapacidadComponent,
        ),
    },
    // Consulta / CRUD: listado paginado en servidor, filtros avanzados,
    // detalle, validacion, borrado logico y exportacion con seleccion de
    // columnas.
    {
      path: 'consulta',
      loadComponent: () =>
        import('./pages/consulta-incapacidades/consulta-incapacidades.component').then(
          (m) => m.ConsultaIncapacidadesComponent,
        ),
    },

    // ── Submodulos de la reunion funcional 2026-09-07 ───────────────────
    // Informes (estadisticas globales, 180/540, recurrencia, top), bandeja de
    // alertas, seguridad y salud en el trabajo (investigaciones ARL) y correos
    // a empresas usuarias (lote diario, directorio, trazabilidad). Cada uno
    // tiene su entrada de menu en db_admin (V107) bajo Salud > Incapacidades.
    {
      path: 'informes',
      loadComponent: () =>
        import('./pages/informes-incapacidades/informes-incapacidades.component').then(
          (m) => m.InformesIncapacidadesComponent,
        ),
    },
    {
      path: 'alertas',
      loadComponent: () =>
        import('./pages/alertas-incapacidades/alertas-incapacidades.component').then(
          (m) => m.AlertasIncapacidadesComponent,
        ),
    },
    {
      path: 'sst',
      loadComponent: () =>
        import('./pages/sst-incapacidades/sst-incapacidades.component').then(
          (m) => m.SstIncapacidadesComponent,
        ),
    },
    {
      path: 'correos',
      loadComponent: () =>
        import('./pages/correos-empresas/correos-empresas.component').then(
          (m) => m.CorreosEmpresasComponent,
        ),
    },

    // ── Modulos de Salud de la reunion funcional 2026-10-05 ─────────────
    // Salud = Incapacidades + Radicacion (con Recobro) + SEVENET + Liquidacion
    // (con Pagos y Negaciones). Cada uno con su entrada de menu en db_admin
    // (ms-auth-admin V133) bajo Salud. Rutas hermanas, todas perezosas.
    {
      path: 'radicacion',
      loadComponent: () =>
        import('./pages/radicacion/radicacion.component').then((m) => m.RadicacionComponent),
    },
    {
      path: 'radicacion/recobro',
      loadComponent: () =>
        import('./pages/recobro/recobro.component').then((m) => m.RecobroComponent),
    },
    {
      path: 'sevenet',
      loadComponent: () =>
        import('./pages/sevenet/sevenet.component').then((m) => m.SevenetComponent),
    },
    {
      path: 'liquidacion',
      loadComponent: () =>
        import('./pages/liquidacion/liquidacion.component').then((m) => m.LiquidacionComponent),
    },
    {
      path: 'liquidacion/pagos',
      loadComponent: () =>
        import('./pages/liquidacion-pagos/liquidacion-pagos.component').then(
          (m) => m.LiquidacionPagosComponent,
        ),
    },
    {
      path: 'liquidacion/negaciones',
      loadComponent: () =>
        import('./pages/liquidacion-negaciones/liquidacion-negaciones.component').then(
          (m) => m.LiquidacionNegacionesComponent,
        ),
    },
];

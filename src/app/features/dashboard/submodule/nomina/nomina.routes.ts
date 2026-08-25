import { Routes } from '@angular/router';
import { NominaComponent } from './pages/nomina/nomina.component';
import { CalculoNominaComponent } from './pages/calculo-nomina/calculo-nomina.component';

export const routes: Routes = [
  { path: '', redirectTo: 'empleados', pathMatch: 'full' },
  { path: 'empleados', component: NominaComponent },
  { path: 'calculo-nomina', component: CalculoNominaComponent },
  // Path principal: 'historial-de-nomina' (coincide con db_admin.modulo).
  // Mantenemos 'historico-nomina' como alias por compatibilidad con bookmarks antiguos.
  { path: 'historial-de-nomina', loadComponent: () => import('./pages/historico-nomina/historico-nomina.component').then(m => m.HistoricoNominaComponent) },
  { path: 'historico-nomina', redirectTo: 'historial-de-nomina', pathMatch: 'full' },
  // Path principal: 'historial-de-novedades' (coincide con db_admin.modulo).
  // Mantenemos 'historico-novedades' como alias por si alguien tiene bookmarks.
  { path: 'historial-de-novedades', loadComponent: () => import('./pages/historico-novedades/historico-novedades.component').then(m => m.HistoricoNovedadesComponent) },
  { path: 'historico-novedades', redirectTo: 'historial-de-novedades', pathMatch: 'full' },
  { path: 'parametrizacion-novedades', loadComponent: () => import('./pages/parametrizacion-novedades/parametrizacion-novedades.component').then(m => m.ParametrizacionNovedadesComponent) },
  // Submódulo "Novedades": registro MANUAL de novedades contra (empresa
  // usuaria, periodo). Las novedades se generan y ALMACENAN aquí y el cálculo
  // las consume después — reemplaza la carga por Excel del botón de novedades
  // para este flujo. Ruta canónica: 'novedades' (coincide con el ítem ya
  // sembrado en db_admin.modulo → /dashboard/nomina/novedades).
  { path: 'novedades', loadComponent: () => import('./pages/novedades/novedades.component').then(m => m.NovedadesComponent) },
  { path: 'registro-de-novedades', redirectTo: 'novedades', pathMatch: 'full' },
  // Submódulo "Entidades Externas" (mantenimiento general con borrado lógico,
  // tipo controlado). Ruta canónica: 'entidades-externas'. Se mantienen los
  // paths 'empresas-usuarias' y 'emepresa-usuaria' (este último es el del menú
  // pre-sembrado en db_admin.modulo, con typo) como alias al mismo componente
  // general, para que el menú actual siga funcionando sin tocar datos productivos.
  { path: 'entidades-externas', loadComponent: () => import('./pages/entidades-externas/entidades-externas.component').then(m => m.EntidadesExternasComponent) },
  { path: 'empresas-usuarias', loadComponent: () => import('./pages/entidades-externas/entidades-externas.component').then(m => m.EntidadesExternasComponent) },
  { path: 'emepresa-usuaria', loadComponent: () => import('./pages/entidades-externas/entidades-externas.component').then(m => m.EntidadesExternasComponent) },
  // Submódulo "Centros de Costo" (mantenimiento con borrado lógico).
  // Ruta canónica: 'centros-costo'. El item de menú debe registrarse en
  // db_admin.modulo con ruta 'nomina/centros-costo' (igual que los demás
  // submódulos de nómina); no se tocan datos productivos desde aquí.
  { path: 'centros-costo', loadComponent: () => import('./pages/centros-costo/centros-costo.component').then(m => m.CentrosCostoComponent) },
  // Path principal: 'homologador-de-novedades' (coincide con db_admin.modulo).
  // Mantenemos 'homologador' como alias por compatibilidad con bookmarks/menus antiguos.
  { path: 'homologador-de-novedades', loadComponent: () => import('./pages/homologador/homologador.component').then(m => m.HomologadorComponent) },
  { path: 'homologador', redirectTo: 'homologador-de-novedades', pathMatch: 'full' },
  // Submódulo "Analítica de nómina" (solo lectura). Se llamaba "Reportes y Analítica"
  // hasta la V46 de ms-auth-admin: se renombró para no chocar con el módulo nuevo
  // de Reportes y Analítica (/dashboard/reportes). Ruta canónica: 'reportes'
  // porque el ítem de menú en db_admin.modulo (creado desde la UI de admin,
  // id ba6d847d-…) apunta a '/dashboard/nomina/reportes'. Se dejan alias
  // descriptivos por compatibilidad con bookmarks.
  { path: 'reportes', loadComponent: () => import('./pages/reportes-analitica/reportes-analitica.component').then(m => m.ReportesAnaliticaComponent) },
  { path: 'reportes-analitica', redirectTo: 'reportes', pathMatch: 'full' },
  { path: 'reportes-y-analitica', redirectTo: 'reportes', pathMatch: 'full' },
  { path: 'analitica', redirectTo: 'reportes', pathMatch: 'full' },
  // Submódulo "Analítica Nómina IA" (informe con anomalías + chat asistente).
  // Ruta canónica: 'analitica-nomina-ia' → registrar el ítem de menú en
  // db_admin.modulo con ruta 'nomina/analitica-nomina-ia'. Alias descriptivos
  // por compatibilidad. Habla con ms-payroll (/api/nomina/analitica-ia) y con
  // ms-ai (/ia/nomina/*) a través del gateway.
  { path: 'analitica-nomina-ia', loadComponent: () => import('./pages/analitica-nomina-ia/analitica-nomina-ia.component').then(m => m.AnaliticaNominaIaComponent) },
  { path: 'analitica-ia', redirectTo: 'analitica-nomina-ia', pathMatch: 'full' },
  { path: 'nomina-ia', redirectTo: 'analitica-nomina-ia', pathMatch: 'full' },
  // Submódulo "Envío de correos (modelo antiguo)": trae a la plataforma el flujo
  // que hoy vive en Google Sheets + Drive (Nomina Express / LQ Envío Express).
  // Fase 1 = carga por carpeta + previsualizador + cruce; el envío de correos
  // con el PDF adjunto llega en la fase 2.
  // Rutas canónicas: 'envio-correos/carga' y 'envio-correos/cruce' → registrar
  // el ítem de menú en db_admin.modulo con ruta 'nomina/envio-correos/carga'.
  { path: 'envio-correos', redirectTo: 'envio-correos/carga', pathMatch: 'full' },
  { path: 'envio-correos/carga', loadComponent: () => import('./pages/envio-correos-carga/envio-correos-carga.component').then(m => m.EnvioCorreosCargaComponent) },
  { path: 'envio-correos/cruce', loadComponent: () => import('./pages/envio-correos-cruce/envio-correos-cruce.component').then(m => m.EnvioCorreosCruceComponent) },
  // Fase 2: el envío en sí y su histórico.
  { path: 'envio-correos/enviar', loadComponent: () => import('./pages/envio-correos-envio/envio-correos-envio.component').then(m => m.EnvioCorreosEnvioComponent) },
  { path: 'envio-correos/plantillas', loadComponent: () => import('./pages/envio-correos-plantillas/envio-correos-plantillas.component').then(m => m.EnvioCorreosPlantillasComponent) },
  { path: 'envio-correos/historico', loadComponent: () => import('./pages/envio-correos-historico/envio-correos-historico.component').then(m => m.EnvioCorreosHistoricoComponent) },
  // Submódulo "Cumpleaños": padrón por Excel + saludo automático el día del
  // cumpleaños. Comparte las plantillas de correo del submódulo padre (tipo
  // CUMPLEANOS), no tiene un gestor de plantillas propio.
  // Registrar el ítem de menú en db_admin.modulo con ruta
  // 'nomina/envio-correos/cumpleanos'.
  { path: 'envio-correos/cumpleanos', loadComponent: () => import('./pages/envio-correos-cumpleanos/envio-correos-cumpleanos.component').then(m => m.EnvioCorreosCumpleanosComponent) },
  { path: 'cumpleanos', redirectTo: 'envio-correos/cumpleanos', pathMatch: 'full' },
  // Alias descriptivos por si alguien guarda el bookmark con otro nombre.
  { path: 'carga-modelo-viejo', redirectTo: 'envio-correos/carga', pathMatch: 'full' },
  { path: 'modelo-antiguo', redirectTo: 'envio-correos/carga', pathMatch: 'full' },
];

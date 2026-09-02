import { Routes } from '@angular/router';
import { ManageWorkersComponent } from './pages/manage-workers/manage-workers.component';
import { UploadTreasuryComponent } from './pages/upload-treasury/upload-treasury.component';

/**
 * Rutas de Tesorería.
 *
 * <p>Los caminos coinciden EXACTAMENTE con lo declarado en `db_admin.modulo` (V96 para las
 * tres pantallas nuevas). El `permisosLecturaGuard` toma el nodo de ruta más largo que
 * coincida, así que una ruta aquí que no exista allí deja al usuario fuera de su propia
 * pantalla, rebotado al home sin explicación.
 *
 * <p>Las tres nuevas se cargan de forma diferida. Las dos antiguas se dejan como estaban:
 * son componentes no-standalone importados arriba, y convertirlos es un cambio aparte que
 * no tiene por qué viajar con esto.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'consulta', pathMatch: 'full' },

  // Consulta 360: el buscador y la ficha. Es la primera parada del mostrador, y por eso
  // pasa a ser el destino por defecto del módulo.
  {
    path: 'consulta',
    loadComponent: () => import('./pages/consulta/consulta').then(m => m.ConsultaPersona),
  },

  // Padrón de activos: la carga de la que sale el tope real y el paz y salvo.
  {
    path: 'padron',
    loadComponent: () => import('./pages/padron/padron').then(m => m.PadronActivos),
  },

  // Parametrización de las condiciones de crédito.
  {
    path: 'reglas',
    loadComponent: () => import('./pages/reglas/reglas').then(m => m.ReglasTesoreria),
  },

  { path: 'manage-workers', component: ManageWorkersComponent },
  { path: 'upload-treasury', component: UploadTreasuryComponent },
];

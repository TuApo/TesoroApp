import { Routes } from '@angular/router';

/**
 * Agente de Supervisión del dispositivo. Pantalla completa, fuera del dashboard. Es la
 * cara del agente en el APK: indicador visible, consentimiento y reporte transparente.
 */
export const routes: Routes = [
  { path: '', loadComponent: () => import('./agente-supervision.component').then(m => m.AgenteSupervisionComponent) },
];

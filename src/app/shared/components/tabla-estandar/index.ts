export { TablaEstandarComponent } from './tabla-estandar.component';
export { FiltroColumnaComponent } from './filtro-columna.component';
export {
  TablaAccionesDirective,
  TablaCeldaDirective,
  TablaEncabezadoDirective,
  TablaTarjetaDirective,
  TablaVacioDirective,
} from './tabla-plantillas.directive';
export {
  aCSV,
  aHTML,
  aTSV,
  configurarRegistroCopia,
  copiarBloque,
  descargarCSV,
  descargarExcel,
  registrarCopia,
} from './tabla.copiar';
export type { EventoCopia } from './tabla.copiar';
export { textoDeValor } from './tabla.tipos';
export type {
  AlineacionColumna,
  BadgeCelda,
  BloqueCopiado,
  ColumnaTabla,
  ContextoFila,
  DireccionOrden,
  FiltroColumna,
  OrdenTabla,
  PieTabla,
  RangoSeleccion,
  RolTarjeta,
  TonoBadge,
  ValorCelda,
  Vista,
} from './tabla.tipos';

import { TablaEstandarComponent } from './tabla-estandar.component';
import {
  TablaAccionesDirective,
  TablaCeldaDirective,
  TablaEncabezadoDirective,
  TablaTarjetaDirective,
  TablaVacioDirective,
} from './tabla-plantillas.directive';

/** Todo lo que una pantalla importa para usar la tabla: `imports: [...TABLA_ESTANDAR]`. */
export const TABLA_ESTANDAR = [
  TablaEstandarComponent,
  TablaCeldaDirective,
  TablaAccionesDirective,
  TablaTarjetaDirective,
  TablaEncabezadoDirective,
  TablaVacioDirective,
] as const;

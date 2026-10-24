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
export { casarPegado, normalizarClave, partirBloque } from './tabla.pegado';
export { etiquetaDeClave, fichaDeRegistro } from './tabla.revision';
export type { CampoFicha, FichaRegistro, MedioFicha, TipoCampo } from './tabla.revision';
export type { DatosRevisarSeleccion, ResultadoRevision } from './revisar-seleccion-dialog.component';
export type { CierreAccionMasiva, DatosAccionMasiva, ResumenFila } from './accion-masiva-dialog.component';
export type { LineaPegada, ResultadoPegado } from './tabla.pegado';
export type {
  AccionMasiva,
  AlineacionColumna,
  BadgeCelda,
  BloqueCopiado,
  ColumnaTabla,
  ConfirmacionMasiva,
  ContextoFila,
  ContextoLote,
  DireccionOrden,
  FiltroColumna,
  OrdenTabla,
  PieTabla,
  RangoSeleccion,
  ResultadoAccionMasiva,
  RolTarjeta,
  SugerenciaBusqueda,
  TextoMasivo,
  TonoAccion,
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

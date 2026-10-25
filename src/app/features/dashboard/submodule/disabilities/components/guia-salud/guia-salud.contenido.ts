import { NivelSalud } from '../../utils/nivel-salud';
import { ClavePantalla, GuiaPantalla } from './guia-salud.modelo';
import { GUIA_CONSULTA, GUIA_REGISTRO } from './guia-salud.registro-consulta';
import {
  GUIA_ALERTAS,
  GUIA_CORREOS,
  GUIA_INFORMES,
  GUIA_LIQUIDACION,
  GUIA_NEGACIONES,
  GUIA_PAGOS,
  GUIA_RADICACION,
  GUIA_RECOBRO,
  GUIA_SEVENET,
  GUIA_SST,
} from './guia-salud.otras';

/** Todas las guias de Salud, por pantalla. */
export const GUIAS_SALUD: Readonly<Record<ClavePantalla, GuiaPantalla>> = {
  registro: GUIA_REGISTRO,
  consulta: GUIA_CONSULTA,
  radicacion: GUIA_RADICACION,
  recobro: GUIA_RECOBRO,
  sevenet: GUIA_SEVENET,
  informes: GUIA_INFORMES,
  alertas: GUIA_ALERTAS,
  sst: GUIA_SST,
  correos: GUIA_CORREOS,
  liquidacion: GUIA_LIQUIDACION,
  pagos: GUIA_PAGOS,
  negaciones: GUIA_NEGACIONES,
};

/** Orden en el que se ofrecen las guias (el del menu). */
const ORDEN: readonly ClavePantalla[] = [
  'registro', 'consulta', 'radicacion', 'recobro', 'sevenet', 'informes', 'alertas', 'sst', 'correos',
  'liquidacion', 'pagos', 'negaciones',
];

/** Las guias de las pantallas que tiene el nivel (sin nivel de Salud: todas, como hoy el menu). */
export function guiasDelNivel(nivel: NivelSalud | null): GuiaPantalla[] {
  return ORDEN.map((c) => GUIAS_SALUD[c]).filter((g) => nivel === null || g.niveles.includes(nivel));
}

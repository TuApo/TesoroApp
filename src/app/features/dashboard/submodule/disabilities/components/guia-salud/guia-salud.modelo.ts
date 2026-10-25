import { NivelSalud } from '../../utils/nivel-salud';
import { AccionSimulada, CondicionLista } from './simulacion';

/** Pantallas de Salud que tienen guia. */
export type ClavePantalla =
  | 'registro'
  | 'consulta'
  | 'informes'
  | 'alertas'
  | 'sst'
  | 'correos'
  | 'radicacion'
  | 'recobro'
  | 'sevenet'
  | 'liquidacion'
  | 'pagos'
  | 'negaciones';

export interface PasoGuia {
  icono: string;
  titulo: string;
  texto: string;
  /** `data-guia` del elemento que se resalta en el recorrido (sin ancla, solo va en la lista). */
  ancla?: string;
  /** Solo en el formulario completo (niveles 2, 3 y todos). */
  soloCompleto?: boolean;
  /** Solo en el formulario simplificado (nivel 1). */
  soloSimplificado?: boolean;
  /** Lo que la simulacion hace en este paso sobre la pantalla real (modo "mira como se hace"). */
  acciones?: readonly AccionSimulada[];
  /** Como saber, en modo practica, que la persona ya lo hizo. */
  listo?: CondicionLista;
  /** Instruccion corta para el modo practica (sigue a "Ahora tú:"). */
  practica?: string;
}

export interface GuiaPantalla {
  clave: ClavePantalla;
  titulo: string;
  icono: string;
  /** Ruta absoluta de la pantalla (para "ir a la pantalla" desde otra guia). */
  ruta: string;
  /** Para que sirve, en una frase. */
  resumen: string;
  /** Niveles que tienen esta pantalla en el menu. */
  niveles: readonly NivelSalud[];
  pasos: readonly PasoGuia[];
  consejos: readonly string[];
}

/** De la URL a la pantalla (el orden importa: las rutas hijas van antes que la padre). */
export function pantallaDeRuta(url: string | null | undefined): ClavePantalla | null {
  const u = (url ?? '').split('?')[0].split('#')[0];
  const base = '/dashboard/disabilities/';
  if (!u.startsWith(base)) return null;
  const resto = u.substring(base.length);
  if (resto.startsWith('radicacion/recobro')) return 'recobro';
  if (resto.startsWith('radicacion')) return 'radicacion';
  if (resto.startsWith('liquidacion/pagos')) return 'pagos';
  if (resto.startsWith('liquidacion/negaciones')) return 'negaciones';
  if (resto.startsWith('liquidacion')) return 'liquidacion';
  for (const clave of ['registro', 'consulta', 'informes', 'alertas', 'sst', 'correos', 'sevenet'] as const) {
    if (resto === clave || resto.startsWith(`${clave}/`)) return clave;
  }
  return null;
}

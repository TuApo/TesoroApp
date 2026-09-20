/**
 * Contrato de la tabla estándar de la plataforma (`<app-tabla-estandar>`).
 *
 * La pantalla no pinta su tabla: la DESCRIBE con un arreglo de columnas. La
 * clave es `valor`, que devuelve un dato plano: de ahí salen la búsqueda, los
 * filtros, el orden y el copiado. Lo visual (formato, chip de estado o una
 * plantilla `tablaCelda`) va aparte y es opcional.
 */

/** Valores planos que viajan a los filtros, al orden y al portapapeles. */
export type ValorCelda = string | number | boolean | Date | null | undefined;

export type AlineacionColumna = 'left' | 'center' | 'right';

/**
 * Rol de la columna cuando la tabla se pinta como tarjetas (móvil o vista
 * «Tarjetas»). Si no se declara, la 1.ª columna es el título, la 2.ª el
 * subtítulo y el resto cae en `meta`.
 */
export type RolTarjeta = 'titulo' | 'subtitulo' | 'badge' | 'meta' | 'cuerpo' | 'oculto';

/** Tonos de chip ya preparados para claro y oscuro. */
export type TonoBadge = 'ok' | 'warn' | 'danger' | 'info' | 'violet' | 'neutro';

/** Chip de estado. `color`/`fondo` fijos solo si el tono no alcanza (colores de negocio). */
export interface BadgeCelda {
  texto: string;
  tono?: TonoBadge;
  color?: string;
  fondo?: string;
  icono?: string;
}

export interface ColumnaTabla<T = any> {
  /** Identificador estable: filtros, orden y totales se indexan por él. */
  id: string;
  /** Título de la columna (también encabezado en el Excel). */
  header: string;
  /** Valor plano de la celda: filtro, búsqueda, orden y copiado salen de aquí. */
  valor: (fila: T) => ValorCelda;
  /** Texto visible cuando difiere del valor (moneda, fecha con formato…). */
  formato?: (fila: T) => string;
  /** Pinta la celda como chip de estado. */
  badge?: (fila: T) => BadgeCelda | null | undefined;
  /** Texto exacto que va a Excel cuando difiere de lo visible (precio sin $). */
  copiaTexto?: (fila: T) => string;
  align?: AlineacionColumna;
  /** 1 = siempre · 2 = se oculta bajo 640 px · 3 = solo desde 1024 px. */
  prioridad?: 1 | 2 | 3;
  /** Por defecto true. */
  ordenable?: boolean;
  /** Por defecto true. */
  filtrable?: boolean;
  /** Por defecto true. Iconos o acciones: false. */
  copiable?: boolean;
  /**
   * La celda trae controles (input, checkbox, botón): queda fuera de la
   * selección de rango para no robarle el clic, y su texto sí se selecciona.
   */
  interactiva?: boolean;
  /** Ubicación dentro de la tarjeta. */
  tarjeta?: RolTarjeta;
  /** Clase extra de la celda (fija o por fila). */
  clase?: string | ((fila: T) => string);
  claseEncabezado?: string;
  /** Ancho CSS de la columna: '120px', '12rem'. */
  ancho?: string;
  /** Ancho mínimo CSS: evita que un texto se parta letra a letra. */
  minAncho?: string;
}

export type Vista = 'tabla' | 'tarjetas';

export type DireccionOrden = 'asc' | 'desc';

export interface OrdenTabla {
  columna: string;
  direccion: DireccionOrden;
}

/** Filtro interno de una columna: texto «contiene» + valores marcados (null = todos). */
export interface FiltroColumna {
  texto: string;
  valores: string[] | null;
  /** Columnas de fecha: rango en ISO local ('2026-09-01' o '2026-09-01T08:30'). */
  desde?: string | null;
  hasta?: string | null;
}

/** Cómo se escriben las fechas de la tabla. Se elige desde el filtro de la columna. */
export type FormatoFecha = 'dd/mm/aaaa' | 'mm/dd/aaaa' | 'aaaa-mm-dd';

/** Una columna de fechas, con o sin hora. */
export type TipoFecha = 'fecha' | 'fecha-hora';

/** Selección rectangular estilo hoja de cálculo (índices sobre lo visible). */
export interface RangoSeleccion {
  filaInicio: number;
  colInicio: number;
  filaFin: number;
  colFin: number;
}

export interface BloqueCopiado {
  encabezados: string[];
  filas: string[][];
}

/** Contexto de las plantillas `tablaCelda`, `tablaAcciones` y `tablaTarjeta`. */
export interface ContextoFila<T = any> {
  $implicit: T;
  fila: T;
  indice: number;
}

/** Totales al pie: por id de columna, lo que se pinta. Recibe las filas ya filtradas. */
export type PieTabla<T = any> = (filas: T[]) => Partial<Record<string, string | number | null | undefined>>;

export function textoDeValor(valor: ValorCelda): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  if (valor instanceof Date) {
    return isNaN(valor.getTime()) ? '' : valor.toLocaleDateString('es-CO');
  }
  return String(valor);
}

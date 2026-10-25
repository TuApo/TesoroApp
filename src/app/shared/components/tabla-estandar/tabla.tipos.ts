import type { Observable } from 'rxjs';

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
  /**
   * Foto de la fila (id de ms-documents o URL): se pinta una miniatura reconocible al lado
   * del texto y al tocarla se ve grande. `imagenes` añade más fotos a la galería.
   */
  imagen?: (fila: T) => string | null | undefined;
  imagenes?: (fila: T) => Array<string | null | undefined> | null | undefined;
  /** Lado de la miniatura en px (por defecto 52). */
  tamanoImagen?: number;
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

/**
 * Sugerencia bajo el buscador (ver input `sugerencias`): la pantalla la trae del
 * backend según lo escrito y la tabla la muestra para elegirla con clic o Enter.
 */
export interface SugerenciaBusqueda {
  id: string;
  texto: string;
  detalle?: string;
}

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

// ── Acciones masivas ─────────────────────────────────────────────────────────

/** Color del botón de una acción masiva. `aviso` = ámbar, `peligro` = rojo. */
export type TonoAccion = 'primario' | 'aviso' | 'peligro' | 'neutro';

/** Un texto fijo o uno que depende de las filas sobre las que se va a actuar. */
export type TextoMasivo<T = any> = string | ((filas: T[]) => string);

/**
 * Paso de confirmación de una acción masiva. La tabla lo pinta igual en todas
 * las pantallas: título, explicación, el carrusel de lo que se va a tocar
 * (nombre e id de cada registro, con la opción de sacar alguno) y, si se
 * piden, una lista de opciones y un campo de texto.
 */
export interface ConfirmacionMasiva<T = any> {
  /** Por defecto «<etiqueta> <n> registro(s)». */
  titulo?: TextoMasivo<T>;
  /** Qué va a pasar y qué no (no se borra, se puede deshacer…). */
  texto?: TextoMasivo<T>;
  icono?: 'warning' | 'question' | 'info';
  /** Etiqueta del campo de texto (motivo, comentario). Sin ella no se pide. */
  nota?: string;
  notaObligatoria?: boolean;
  /** Una lista para elegir (el estado al que pasar…). Llega en `contexto.opcion`. */
  opciones?: {
    etiqueta: string;
    valores: (filas: T[]) => { valor: string; texto: string }[];
  };
  /** Texto del botón que confirma. Por defecto «<etiqueta> <n>». */
  boton?: string;
}

/** Lo que recibe `ejecutar` además de la fila. */
export interface ContextoLote<C = unknown> {
  /** Lo que escribió el operador en la nota ('' si no se pidió). */
  nota: string;
  /** El valor elegido en `opciones` (null si no se pidieron). */
  opcion: string | null;
  /** Lo que devolvió `preparar`, si la acción lo declaró. */
  datos: C | undefined;
}

export interface ResultadoAccionMasiva<T = any> {
  hechos: T[];
  fallidos: T[];
  /** El operador paró antes de terminar. */
  cancelado: boolean;
}

/**
 * ACCIÓN SOBRE LO MARCADO — el estándar de la plataforma.
 *
 * La pantalla no monta botones, confirmaciones ni bucles: declara qué se
 * puede hacer con las filas marcadas y la tabla se encarga del resto igual en
 * todas partes — el botón con el conteo, el paso de confirmación con el
 * carrusel de registros, la ejecución uno a uno con avance y parada, y el
 * cierre con lo que salió y lo que no.
 *
 * Se ejecuta registro a registro a propósito: casi ningún endpoint acepta una
 * lista, un fallo no arrastra a los demás, y al final se dice exactamente
 * con cuáles no se pudo.
 */
export interface AccionMasiva<T = any, C = unknown> {
  /** Estable dentro de la tabla. */
  id: string;
  /** Verbo del botón: «Desactivar», «Reactivar», «Cerrado». */
  etiqueta: string;
  /** Material Symbols. */
  icono?: string;
  tono?: TonoAccion;
  /** Rótulo pintado antes de la primera acción del grupo («Pasar a:»). */
  grupo?: string;
  /** Sobre cuáles de las marcadas actúa. El botón solo sale si hay alguna. */
  aplicaA?: (fila: T) => boolean;
  /**
   * Recoge o valida antes de confirmar (comprobar que todo sea del mismo
   * tipo, abrir un selector propio…). Devolver `undefined` cancela.
   */
  preparar?: (filas: T[]) => Promise<C | undefined> | C | undefined;
  /** `false` salta la confirmación (solo si `preparar` ya la hizo). */
  confirmar?: ConfirmacionMasiva<T> | false;
  /** La acción sobre UNA fila. */
  ejecutar: (fila: T, contexto: ContextoLote<C>) => Promise<unknown> | Observable<unknown>;
  /** Cómo se nombra una fila al informar fallos. Por defecto, nombre e id de su ficha. */
  etiquetaFila?: (fila: T) => string;
  /** Participio para el cierre: «desactivada(s)». Por defecto «procesada(s)». */
  verbo?: string;
  /** Al terminar (recargar la pantalla, por ejemplo). */
  alTerminar?: (resultado: ResultadoAccionMasiva<T>) => void;
}

/** Modelos del módulo de parametrización de documentos generados (ms-templates). */

export type ModoPlantilla = 'PDF_FORM' | 'OVERLAY' | 'HTML' | 'RICH';
export type MotorPlantilla = 'LEGACY' | 'TEMPLATES';
export type EstadoVersion = 'BORRADOR' | 'PUBLICADA' | 'ARCHIVADA';

/** Qué significa cada modo, para explicárselo a quien no conoce el módulo. */
export const MODOS: { value: ModoPlantilla; label: string; ayuda: string }[] = [
  { value: 'PDF_FORM', label: 'PDF con formulario',
    ayuda: 'El PDF ya trae campos rellenables. Se sube y se dice qué dato va en cada campo.' },
  { value: 'OVERLAY', label: 'Colocar sobre un fondo',
    ayuda: 'Para formatos planos o escaneados: los datos se sitúan encima de la imagen.' },
  { value: 'HTML', label: 'HTML importado',
    ayuda: 'Se pega HTML y se usan etiquetas {{variable}} de las habilitadas.' },
  { value: 'RICH', label: 'Editor de texto',
    ayuda: 'Se redacta el documento aquí mismo, como en un procesador de textos.' },
];

export interface Plantilla {
  id: number;
  clave: string;
  nombre: string;
  document_type_id: number | null;
  modo: ModoPlantilla;
  /** LEGACY = lo sigue generando el sistema anterior. Cambiarlo es el corte. */
  motor: MotorPlantilla;
  aplanar_salida: boolean;
  notas: string | null;
  activa: boolean;
  creado_por: string | null;
  creado_at: string;
}

export interface PlantillaVersion {
  id: number;
  plantilla_id: number;
  numero: number;
  estado: EstadoVersion;
  html_contenido: string | null;
  css_contenido: string | null;
  activo_base_id: number | null;
  notas_cambio: string | null;
  creado_por: string | null;
  creado_at: string;
  publicada_por: string | null;
  publicada_at: string | null;
}

/** Variable que una plantilla PUEDE usar. Si no está aquí, no se puede usar. */
export interface CampoDiccionario {
  id: number;
  clave: string;
  etiqueta: string;
  origen: 'CANDIDATO' | 'VACANTE' | 'EMPRESA' | 'PROCESO' | 'CONTRATO' | 'CONFIG' | 'CALCULADO';
  tipo: 'TEXTO' | 'FECHA' | 'NUMERO' | 'BOOL' | 'IMAGEN' | 'FIRMA';
  /** Es una colección: se usa con índice (beneficiario 1, 2, 3...). */
  es_lista: boolean;
  max_elementos: number | null;
  ejemplo: string | null;
  descripcion: string | null;
  sensible: boolean;
  activo: boolean;
}

/** Campo tal y como viene dentro del PDF subido. */
export interface CampoPdf {
  nombre: string;
  tipo: 'TEXTO' | 'CHECK' | 'RADIO' | 'LISTA' | 'COMBO' | 'BOTON' | 'FIRMA' | 'DESCONOCIDO';
  pagina: number;
  valor_por_defecto: string;
  opciones: string[];
  solo_lectura: boolean;
  /** Los campos *_af_image esperan imagen, no texto. */
  espera_imagen: boolean;
  /** Rectángulo en puntos PDF, origen arriba-izquierda (para dibujarlo sobre la página). */
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/** El mapeo guardado: qué variable va en qué campo. */
export interface PlantillaCampo {
  id?: number;
  version_id?: number;
  campo_clave: string | null;
  /** Fila de la lista (0-based) cuando la variable es una colección. */
  indice: number | null;
  valor_literal: string | null;
  campo_pdf: string | null;
  placeholder: string | null;
  pagina: number;
  tipo_render: string;
  formato: string | null;
  obligatorio: boolean;
  orden: number;
  activo: boolean;
  /** Marca una casilla dibujada a mano o una del formulario recolocada. */
  valor_condicion?: string | null;
  pos_x?: number | null;
  pos_y?: number | null;
  ancho?: number | null;
  alto?: number | null;
  font_size?: number | null;
  text_align?: string | null;
}

/**
 * Un dato que la persona TIENE, sacado del esquema real de db_hr.
 *
 * Es la lista de "de dónde puede venir la información". Al crear un concepto
 * nuevo hay que elegir de aquí: una ruta escrita a mano no da error, resuelve a
 * vacío y el documento sale con el hueco en blanco sin que se entere nadie.
 */
export interface OrigenDato {
  bloque: string;
  tabla_origen: string;
  columna: string;
  ruta: string;
  etiqueta: string;
  tipo: string;
  es_lista: boolean;
  /** Ya hay una variable del diccionario usando esta ruta. */
  ya_tiene_variable: boolean;
}

/**
 * Lo que se manda al guardar el mapeo. NO es un `PlantillaCampo`: no lleva id
 * ni versión, y deja campos a null a propósito —`tipo_render: null` significa
 * "usa el tipo del diccionario", que es lo que hace que las fechas salgan en
 * dd/mm/aaaa—.
 */
export interface FilaMapeoGuardar {
  campo_pdf: string | null;
  placeholder: string | null;
  campo_clave: string | null;
  indice: number | null;
  obligatorio: boolean;
  tipo_render: string | null;
  formato?: string | null;
  text_align?: string | null;
  pagina: number;
  orden: number;
  valor_condicion?: string | null;
  pos_x?: number;
  pos_y?: number;
  ancho?: number;
  alto?: number;
  font_size?: number;
}

export interface Sugerencia {
  campo_pdf: string;
  campo_clave: string | null;
  etiqueta: string | null;
  /** 0..1. >=0,8 es coincidencia alta; por debajo conviene revisar. */
  confianza: number;
  motivo: string;
}

export interface RespuestaSugerencias {
  version_id: number;
  total_campos: number;
  con_sugerencia: number;
  sugerencias: Sugerencia[];
}

export interface Auditoria {
  id: number;
  plantilla_id: number | null;
  version_id: number | null;
  entidad: string;
  entidad_id: number | null;
  accion: string;
  usuario: string | null;
  /** {campo: [antes, después]} */
  diff: Record<string, [unknown, unknown]> | null;
  ocurrido_at: string;
}

export interface DocumentoGenerado {
  id: number;
  plantilla_id: number;
  version_id: number;
  document_id: number | null;
  cedula: string | null;
  motor_usado: string;
  generado_por: string | null;
  generado_at: string;
}

export interface ResultadoSembrado {
  clave: string;
  estado: 'CARGADO' | 'SIN_PLANTILLA' | 'SIN_ARCHIVO' | 'ERROR';
  campos: number;
  detalle: string;
}

/** Modelos para el módulo de parametrización de plantillas EPS (V36/V39). */

// ── Temporal config ─────────────────────────────────────────────────────────

export interface TemporalConfig {
  id: number;
  temporalKey: string;
  nombreDisplay: string;
  nit?: string;
  direccion?: string;
  email?: string;
  tieneFirma: boolean;
  tieneSello: boolean;
  activa: boolean;
}

export interface TemporalConfigRequest {
  temporalKey: string;
  nombreDisplay: string;
  nit?: string;
  direccion?: string;
  email?: string;
  /** Data URI "data:image/png;base64,…" — null = no cambiar */
  firmaImagen?: string | null;
  selloImagen?: string | null;
  activa?: boolean;
}

// ── Página del editor visual (V39) ───────────────────────────────────────────

export interface PaginaPlantilla {
  id?: number;
  numero: number;
  /** CARTA (215.9×279.4mm) o OFICIO (215.9×330.2mm). */
  tamano: 'CARTA' | 'OFICIO';
  /** true si tiene imagen de fondo almacenada. Solo en listado (sin el base64). */
  tieneImagen?: boolean;
  /** Data URI base64 — solo presente cuando se carga para editar. */
  imagenFondo?: string | null;
}

export interface PaginaRequest {
  numero: number;
  tamano: 'CARTA' | 'OFICIO';
  /** Data URI base64 de la imagen de fondo; null = sin fondo. */
  imagenFondo?: string | null;
}

// ── Fuente tipográfica personalizada (V39) ───────────────────────────────────

export interface FuentePersonalizada {
  id: number;
  nombre: string;
  cssFamilia: string;
  tieneArchivo: boolean;
  activa: boolean;
}

export interface FuenteRequest {
  nombre: string;
  cssFamilia: string;
  /** Data URI "data:font/ttf;base64,…" o "data:font/otf;base64,…" */
  archivoB64?: string | null;
}

// ── Plantilla EPS ────────────────────────────────────────────────────────────

export interface PlantillaResumen {
  id: number;
  temporalKey: string | null;
  epsKey: string;
  epsNombre: string;
  sexo: 'M' | 'F' | null;
  nombrePlantilla: string;
  googleDocId: string | null;
  tieneHtml: boolean;
  version: number;
  activa: boolean;
  notas: string | null;
  totalCampos: number;
  /** Número de páginas del editor visual configuradas (V39). */
  totalPaginas: number;
}

export interface PlantillaDetalle extends Omit<PlantillaResumen, 'totalCampos' | 'totalPaginas'> {
  htmlContenido: string | null;
  campos: CampoDto[];
  paginas: PaginaPlantilla[];
}

export interface PlantillaRequest {
  temporalKey?: string | null;
  epsKey: string;
  epsNombre: string;
  sexo?: 'M' | 'F' | null;
  nombrePlantilla: string;
  googleDocId?: string | null;
  htmlContenido?: string | null;
  activa?: boolean;
  notas?: string | null;
  campos?: CampoRequest[];
}

// ── Campos (placeholders + posición visual V39) ──────────────────────────────

export type FuenteCampo = 'CONTRATACION' | 'TEMPORAL_CONFIG' | 'LITERAL' | 'CALCULADO';
export type TipoRender  = 'TEXTO' | 'FIRMA' | 'FECHA' | 'NUMERO' | 'IMAGEN' | 'BOOL';
export type TextAlign   = 'LEFT' | 'CENTER' | 'RIGHT';

export interface CampoDto {
  id: number;
  /** Identificador único de instancia (solo frontend, no se envía al backend). */
  _uid?: number;
  placeholder: string;
  fuente: FuenteCampo;
  campoFuente: string | null;
  fuenteConfigCampo: string | null;
  valorLiteral: string | null;
  formula: string | null;
  tipoRender: TipoRender;
  formato: string | null;
  activo: boolean;
  orden: number;
  // Posición visual (V39)
  pagina: number;
  posX: number;
  posY: number;
  ancho: number;
  alto: number;
  fontSize: number;
  fontFamily: string | null;
  fontColor: string;
  fontBold: boolean;
  fontItalic: boolean;
  textAlign: TextAlign;
}

export interface CampoRequest {
  id?: number | null;
  placeholder: string;
  fuente: FuenteCampo;
  campoFuente?: string | null;
  fuenteConfigCampo?: string | null;
  valorLiteral?: string | null;
  formula?: string | null;
  tipoRender: TipoRender;
  formato?: string | null;
  activo?: boolean;
  orden?: number;
  // Posición visual (V39)
  pagina?: number;
  posX?: number;
  posY?: number;
  ancho?: number;
  alto?: number;
  fontSize?: number;
  fontFamily?: string | null;
  fontColor?: string;
  fontBold?: boolean;
  fontItalic?: boolean;
  textAlign?: TextAlign;
}

/** Campo disponible como fuente (para el selector de campo_fuente). */
export interface CampoDisponible {
  campo: string;
  etiqueta: string;
  fuente: 'CONTRATACION' | 'TEMPORAL_CONFIG';
  ejemplo: string;
}

// ── Constantes de UI ─────────────────────────────────────────────────────────

export const FUENTES_CAMPO: { value: FuenteCampo; label: string }[] = [
  { value: 'CONTRATACION',    label: 'Contratación (vista)' },
  { value: 'TEMPORAL_CONFIG', label: 'Config de la temporal' },
  { value: 'LITERAL',         label: 'Valor fijo' },
  { value: 'CALCULADO',       label: 'Fórmula calculada' },
];

export const TIPOS_RENDER: { value: TipoRender; label: string; desc: string }[] = [
  { value: 'TEXTO',  label: 'Texto',         desc: 'Reemplaza el placeholder por texto plano' },
  { value: 'FIRMA',  label: 'Firma',         desc: 'Renderiza en cursiva (simula firma)' },
  { value: 'IMAGEN', label: 'Imagen',        desc: 'El valor es un data URI → inserta imagen' },
  { value: 'FECHA',  label: 'Fecha',         desc: 'Formatea una fecha con el patrón indicado' },
  { value: 'NUMERO', label: 'Número',        desc: 'Formato con separadores de miles' },
  { value: 'BOOL',   label: 'Sí / No',       desc: 'Convierte true/false en "Sí" / "No"' },
];

export const TAMANOS_PAGINA: { value: 'CARTA' | 'OFICIO'; label: string; mmW: number; mmH: number }[] = [
  { value: 'CARTA',  label: 'Carta  (215.9 × 279.4 mm)',  mmW: 215.9, mmH: 279.4 },
  { value: 'OFICIO', label: 'Oficio (215.9 × 330.2 mm)',  mmW: 215.9, mmH: 330.2 },
];

export const FUENTES_ESTANDAR: string[] = [
  'Helvetica',
  'Times New Roman',
  'Courier New',
];

/** Escala por defecto: píxeles por mm en el canvas del editor visual. */
export const CANVAS_SCALE_PX_PER_MM = 2.5;

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
  tamano: TamanoPagina;
  /** true si tiene imagen de fondo almacenada. Solo en listado (sin el base64). */
  tieneImagen?: boolean;
  /** Data URI base64 — solo presente cuando se carga para editar. */
  imagenFondo?: string | null;
}

export interface PaginaRequest {
  numero: number;
  tamano: TamanoPagina;
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

export type FuenteCampo = 'CONTRATACION' | 'TEMPORAL_CONFIG' | 'LITERAL' | 'CALCULADO' | 'BIOMETRIA';
export type TipoRender  = 'TEXTO' | 'FIRMA' | 'HUELLA' | 'MARCA' | 'FECHA' | 'NUMERO' | 'IMAGEN' | 'BOOL';
export type TamanoPagina = 'CARTA' | 'OFICIO' | 'A4';
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
  /** V69: mm entre casillas (un carácter por cuadro). null = texto corrido. */
  pasoCasilla?: number | null;
  /** V69: MARCA — valor que debe tener el dato para pintar la X (ej: F). */
  condicion?: string | null;
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
  pasoCasilla?: number | null;
  condicion?: string | null;
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
  { value: 'BIOMETRIA',       label: 'Firma / huella del trabajador' },
];

export const TIPOS_RENDER: { value: TipoRender; label: string; desc: string }[] = [
  { value: 'TEXTO',  label: 'Texto',         desc: 'Reemplaza el placeholder por texto plano' },
  { value: 'FIRMA',  label: 'Firma',         desc: 'Con fuente Firma/huella: la firma registrada en contratación (imagen)' },
  { value: 'HUELLA', label: 'Huella',        desc: 'Con fuente Firma/huella: la huella capturada en contratación' },
  { value: 'MARCA',  label: 'Casilla (X)',   desc: 'Pinta una X si el dato es igual a la condición (ej: Sexo = F)' },
  { value: 'IMAGEN', label: 'Imagen',        desc: 'El valor es un data URI → inserta imagen' },
  { value: 'FECHA',  label: 'Fecha',         desc: 'Formatea una fecha con el patrón indicado' },
  { value: 'NUMERO', label: 'Número',        desc: 'Formato con separadores de miles' },
  { value: 'BOOL',   label: 'Sí / No',       desc: 'Convierte true/false en "Sí" / "No"' },
];

export const TAMANOS_PAGINA: { value: TamanoPagina; label: string; mmW: number; mmH: number }[] = [
  { value: 'CARTA',  label: 'Carta  (215.9 × 279.4 mm)',  mmW: 215.9, mmH: 279.4 },
  { value: 'OFICIO', label: 'Oficio (215.9 × 330.2 mm)',  mmW: 215.9, mmH: 330.2 },
  { value: 'A4',     label: 'A4     (210 × 297 mm)',      mmW: 210,   mmH: 297   },
];

export const FUENTES_ESTANDAR: string[] = [
  'Helvetica',
  'Times New Roman',
  'Courier New',
];

/** Escala por defecto: píxeles por mm en el canvas del editor visual. */
export const CANVAS_SCALE_PX_PER_MM = 2.5;

// ── Diagnóstico de generación del documento EPS ─────────────────────────────

/** Por qué se puede (o no) generar el documento EPS de un proceso. */
export interface DiagnosticoGeneracion {
  procesoId: number;
  cedula: string | null;
  nombre: string | null;
  eps: string | null;
  epsKey: string | null;
  temporal: string | null;
  sexo: string | null;
  puedeGenerar: boolean;
  /** SIN_EPS | EPS_SIN_PLANTILLA | PLANTILLA_INACTIVA | TEMPORAL_SIN_PLANTILLA | DATOS_INCOMPLETOS… */
  motivoCodigo: string | null;
  /** Motivo en palabras, listo para mostrar. */
  motivo: string | null;
  plantillaId: number | null;
  plantillaNombre: string | null;
  /** No impiden generar, pero el documento sale con huecos (firma, huella…). */
  avisos: string[];
}

// ── Previsualización del editor ─────────────────────────────────────────────

/** Contrato con el que probar una plantilla en el editor. */
export interface MuestraProceso {
  procesoId: number;
  cedula: string;
  nombre: string;
  eps: string;
  temporal: string | null;
  fechaIngreso: string | null;
  tieneFirma: boolean;
  tieneHuella: boolean;
}

/** Lo que pintaría el PDF en un campo (mismo orden que los campos enviados). */
export interface ValorCampo {
  indice: number;
  texto: string | null;
  /** data URI de la firma o la huella. */
  imagen: string | null;
  /** Por qué queda vacío ("Sin dato", "Firma: no registró firma…"). */
  nota: string | null;
}

export interface ValoresPrevisualizacion {
  persona: string;
  valores: ValorCampo[];
  avisos: string[];
}

/** Estado del documento EPS de un proceso (color del botón en Confirmación de Ingresos). */
export interface EstadoDocumentoEps {
  procesoId: number;
  /** NO_PUEDE (rojo) · PUEDE (amarillo) · GENERADO (verde) */
  estado: 'NO_PUEDE' | 'PUEDE' | 'GENERADO';
  puedeGenerar: boolean;
  motivo: string | null;
  plantillaNombre: string | null;
  generadoAt: string | null;
  veces: number;
  generadoPor: string | null;
  /** Trámite EPS (V70/V73) más reciente del contrato; null = sin trámite. */
  tramiteId: number | null;
  tramiteEstado: 'POR_ENVIAR' | 'RADICADA' | 'CON_RESPUESTA' | 'CONFIRMADA' | 'RECHAZADA' | null;
}

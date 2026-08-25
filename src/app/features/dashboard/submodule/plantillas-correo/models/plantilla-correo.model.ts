/**
 * Contrato del submódulo Plantillas de correo (ms-auth-admin,
 * `/api/v1/admin/correos/plantillas/**`).
 *
 * ⚠️ El backend responde en **snake_case** (cada DTO lleva
 * `@JsonNaming(SnakeCaseStrategy)`; el ObjectMapper global fuerza camelCase y
 * ganaría sin esa anotación). Las interfaces de abajo reflejan el JSON REAL:
 * cambiarlas a camelCase hace que la pantalla pinte guiones.
 */

export type EstadoPlantilla = 'BORRADOR' | 'PUBLICADA' | 'ARCHIVADA';
export type ModoEdicion = 'BLOQUES' | 'HTML';
export type ModoImagenes = 'CID' | 'URL';
export type TipoActivo = 'IMAGEN' | 'VIDEO';

export type TipoVariable =
  | 'TEXTO' | 'NUMERO' | 'FECHA' | 'FECHA_HORA' | 'MONEDA' | 'BOOLEANO'
  | 'CORREO' | 'TELEFONO' | 'ENLACE' | 'IMAGEN' | 'HTML';

// ── Catálogo de variables ────────────────────────────────────────────────────

export interface Variable {
  id: string;
  origen_id: string;
  clave: string;
  ruta: string;
  etiqueta: string;
  descripcion: string | null;
  grupo: string;
  tipo: TipoVariable;
  formato: string | null;
  ejemplo: string | null;
  activo: boolean;
  orden: number;
}

export interface GrupoVariables {
  grupo: string;
  variables: Variable[];
}

export interface Catalogo {
  origen_codigo: string | null;
  origen_nombre: string | null;
  permite_busqueda: boolean;
  grupos: GrupoVariables[];
}

export interface OrigenDatos {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  servicio: string;
  ruta_detalle: string;
  ruta_busqueda: string | null;
  campo_correo: string | null;
  campo_nombre: string | null;
  icono: string;
  activo: boolean;
  orden: number;
  /** false = el microservicio dueño no tiene URL configurada en este entorno. */
  alcanzable: boolean;
  permite_busqueda: boolean;
  total_variables: number;
  plantillas_que_lo_usan: number;
}

/** Un candidato / proceso concreto, para previsualizar con datos reales. */
export interface Sujeto {
  clave: string;
  etiqueta: string;
  detalle: string | null;
  correo: string | null;
}

// ── Biblioteca de medios ─────────────────────────────────────────────────────

export interface Activo {
  id: string;
  tipo: TipoActivo;
  nombre: string;
  descripcion: string | null;
  mime_type: string | null;
  tamano_bytes: number | null;
  ancho: number | null;
  alto: number | null;
  url_externa: string | null;
  miniatura_id: string | null;
  etiquetas: string | null;
  /** Ruta autenticada del propio backend; el editor la usa tal cual. */
  url: string;
  creado_en: string;
  creado_por: string | null;
}

// ── Plantillas ───────────────────────────────────────────────────────────────

export interface PlantillaResumen {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  categoria: string;
  origen_codigo: string | null;
  cuenta_id: string | null;
  estado: EstadoPlantilla;
  tiene_borrador: boolean;
  destacada: boolean;
  orden: number;
  version_publicada: number | null;
  asunto_actual: string | null;
  actualizado_en: string | null;
  actualizado_por: string | null;
}

export interface Version {
  id: string;
  numero: number;
  estado: EstadoPlantilla;
  modo_edicion: ModoEdicion;
  asunto: string;
  preencabezado: string | null;
  documento_json: string | null;
  tema_json: string | null;
  cuerpo_html: string;
  cuerpo_texto: string | null;
  modo_imagenes: ModoImagenes;
  notas: string | null;
  creado_en: string | null;
  creado_por: string | null;
  publicado_en: string | null;
}

export interface VersionResumen {
  id: string;
  numero: number;
  estado: EstadoPlantilla;
  asunto: string;
  notas: string | null;
  creado_en: string | null;
  creado_por: string | null;
  publicado_en: string | null;
  publicado_por: string | null;
}

export interface PlantillaDetalle {
  plantilla: PlantillaResumen;
  version: Version | null;
  versiones: VersionResumen[];
  catalogo: Catalogo;
  /** Variables citadas que el catálogo no conoce: la UI las marca en rojo. */
  variables_desconocidas: string[];
}

export interface Preview {
  asunto: string;
  preencabezado: string | null;
  cuerpo_html: string;
  cuerpo_texto: string | null;
  datos_reales: boolean;
  destinatario_sugerido: string | null;
  nombre_sujeto: string | null;
  variables_sin_resolver: string[];
  valores_usados: Record<string, string>;
}

export interface ResultadoEnvio {
  enviado: boolean;
  cuenta_id: string;
  remitente: string;
  destinatario: string;
  enviados_hoy: number;
  disponible_hoy: number;
  mensaje: string | null;
}

// ── Documento del editor de bloques ──────────────────────────────────────────

export type TipoBloque =
  | 'TITULO' | 'TEXTO' | 'IMAGEN' | 'VIDEO' | 'BOTON'
  | 'SEPARADOR' | 'ESPACIO' | 'LISTA_DATOS' | 'COLUMNAS' | 'HTML';

/**
 * Un bloque del lienzo. `props` es deliberadamente laxo: el compilador de Java
 * lee cada propiedad con un valor por defecto, así que un bloque al que le falte
 * una propiedad se pinta igual en vez de romper la compilación del cuerpo.
 */
export interface Bloque {
  id: string;
  tipo: TipoBloque;
  props: Record<string, any>;
}

export interface TemaCorreo {
  anchoPx: number;
  colorFondo: string;
  colorLienzo: string;
  colorTexto: string;
  colorEnlace: string;
  colorPrimario: string;
  fuente: string;
  tamanoBase: number;
  radioPx: number;
}

export interface DocumentoCorreo {
  tema: TemaCorreo;
  bloques: Bloque[];
}

export const TEMA_POR_DEFECTO: TemaCorreo = {
  anchoPx: 600,
  colorFondo: '#f1f5f9',
  colorLienzo: '#ffffff',
  colorTexto: '#1f2937',
  colorEnlace: '#1d4ed8',
  colorPrimario: '#0f766e',
  fuente: 'Arial, Helvetica, sans-serif',
  tamanoBase: 15,
  radioPx: 8,
};

/**
 * Pilas de fuentes admitidas. La lista es corta a propósito: una fuente web no
 * carga en Outlook ni en Gmail móvil, y lo que llega es la sustituta del
 * sistema, que descuadra la maqueta. El backend valida lo mismo.
 */
export const FUENTES_CORREO = [
  { valor: 'Arial, Helvetica, sans-serif', etiqueta: 'Arial' },
  { valor: 'Verdana, Geneva, sans-serif', etiqueta: 'Verdana' },
  { valor: 'Tahoma, Geneva, sans-serif', etiqueta: 'Tahoma' },
  { valor: 'Georgia, serif', etiqueta: 'Georgia' },
  { valor: 'Times New Roman, Times, serif', etiqueta: 'Times New Roman' },
  { valor: 'Trebuchet MS, Helvetica, sans-serif', etiqueta: 'Trebuchet MS' },
  { valor: 'Courier New, Courier, monospace', etiqueta: 'Courier New' },
];

// ── Importación de HTML externo ──────────────────────────────────────────────

/**
 * Un marcador `{{…}}` encontrado en la plantilla ajena.
 *
 * `clave_sugerida` en null significa que no hay equivalente conocido en el
 * origen elegido — no es un error: `quincena` o `archivo1` son de Nómina y no
 * existen en Contratación. Lo correcto es dejarlos literales y avisar, no
 * emparejarlos con lo que más se parezca.
 */
export interface PlaceholderDetectado {
  nombre: string;
  apariciones: number;
  clave_sugerida: string | null;
  etiqueta_sugerida: string | null;
  procedencia: 'CATALOGO' | 'NOMINA_LEGACY' | 'GENERICO' | 'COINCIDENCIA_NOMBRE'
             | 'COINCIDENCIA_ETIQUETA' | 'SIN_EQUIVALENTE';
  nota: string | null;
  ya_es_del_catalogo: boolean;
}

export interface ImagenDetectada {
  url: string;
  apariciones: number;
  nombre_sugerido: string;
  /** false = no se puede traer a la biblioteca; `motivo_rechazo` dice por qué. */
  descargable: boolean;
  motivo_rechazo: string | null;
}

export interface AnalisisImportacion {
  asunto_sugerido: string | null;
  preencabezado_sugerido: string | null;
  tamano_bytes: number;
  supera_limite_gmail: boolean;
  se_limpio_marcado_ejecutable: boolean;
  placeholders: PlaceholderDetectado[];
  imagenes: ImagenDetectada[];
  avisos: string[];
  /** El HTML ya saneado; el paso de aplicar lo devuelve tal cual. */
  html: string;
}

export interface ResultadoImportacion {
  plantilla: PlantillaDetalle;
  placeholders_reemplazados: number;
  imagenes_importadas: number;
  imagenes_fallidas: number;
  avisos: string[];
}

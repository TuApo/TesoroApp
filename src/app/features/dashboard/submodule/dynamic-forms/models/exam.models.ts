/**
 * EXÁMENES — la hoja de respuestas de un formulario dinámico.
 *
 * Espejo de `CalificacionDtos` en ms-forms. Los nombres van en snake_case porque el servidor
 * los declara con @JsonProperty explícito: la estrategia de Jackson de ms-forms es camelCase,
 * pero un nombre declarado a mano no se reescribe. No "arreglar" el casing aquí sin cambiar
 * también el DTO del servidor.
 */

/** Cómo se califica un campo. El nombre es el del enum del servidor. */
export type ModoCalificacion =
  | 'OPCION'
  | 'TEXTO_CONTIENE'
  | 'TEXTO_SIMILITUD'
  | 'NUMERO_RANGO'
  | 'PRESENCIA'
  | 'IA_RUBRICA'
  | 'IA_VISION'
  | 'IA_DESCRIPCION'
  | 'IA_INTERPRETACION'
  | 'MANUAL';

export type TipoExamen = 'CONOCIMIENTO' | 'DESEMPENO' | 'PROYECTIVO';

/** A dónde mandar a repasar a quien falle: la lección y el minuto exacto. */
export interface ReferenciaMaterial {
  leccion_id?: string | null;
  bloque_id?: string | null;
  segundo?: number | null;
  url?: string | null;
  texto?: string | null;
}

export interface ConfigExamen {
  es_examen: boolean;
  tipo: TipoExamen;
  nota_minima: number | null;
  mostrar_resultado: 'AL_TERMINAR' | 'TRAS_REVISION' | 'NUNCA';
  mostrar_correctas: boolean;
}

export interface ConfigCampo {
  puntos: number | null;
  modo: ModoCalificacion | null;
  opciones_correctas?: string[] | null;
  parcial?: boolean | null;
  contiene?: string[] | null;
  no_contiene?: string[] | null;
  minimo_aciertos?: number | null;
  respuesta_modelo?: string | null;
  umbral_similitud?: number | null;
  min?: number | null;
  max?: number | null;
  rubrica?: string | null;
  pauta?: string | null;
  manual_document_ids?: number[] | null;
  referencia?: ReferenciaMaterial | null;
  explicacion?: string | null;
}

export interface CampoExamen {
  clave: string;
  etiqueta: string;
  tipo: string;
  calificacion: ConfigCampo | null;
}

export interface Examen {
  version_id: number;
  version: number;
  examen: ConfigExamen;
  campos: CampoExamen[];
}

export interface GuardarExamen {
  examen: ConfigExamen;
  campos: Record<string, ConfigCampo>;
}

/** Si esta respuesta se califica y si ya se calificó. No trae nada de la hoja de respuestas. */
export interface EstadoCalificacion {
  es_examen: boolean;
  tipo: TipoExamen | null;
  calificado: boolean;
  estado: string | null;
  requiere_firma: boolean;
}

/** Cómo quedó UN campo, y por qué. */
export interface ResultadoCampo {
  campo: string;
  etiqueta: string;
  modo: ModoCalificacion;
  puntos: number;
  puntos_max: number;
  /** CORRECTO | PARCIAL | INCORRECTO | VACIO | PENDIENTE_REVISION | PENDIENTE_IA | REVISADO */
  estado: string;
  motivo: string | null;
  explicacion: string | null;
  referencia: ReferenciaMaterial | null;
  /** Lo que el modelo OBSERVA. No es un veredicto. */
  descripcion_ia: string | null;
  /** El borrador de lectura que el modelo le propone a quien firma. */
  interpretacion_apoyo: string | null;
  revisado_por: string | null;
}

export interface ResultadoExamen {
  puntaje: number | null;
  puntaje_max: number | null;
  nota: number | null;
  nota_minima: number | null;
  aprobado: boolean;
  /** CALIFICADO | PENDIENTE_REVISION | PENDIENTE_IA | SIN_CALIFICAR | FIRMADO */
  estado: string;
  parcial: boolean;
  detalle: ResultadoCampo[];
}

/** Lo que la profesional escribe sobre un campo, y que alimenta las lecturas siguientes. */
export interface AnotacionProfesional {
  campo: string;
  propuesta_ia: string | null;
  interpretacion: string | null;
  observaciones: string | null;
  veredicto: string | null;
  utilidad_ia: 'UTIL' | 'CORREGIDA' | 'ERRADA' | null;
  usar_para_entrenar: boolean;
  profesional_id: string | null;
  actualizado_at: string | null;
}

/** Catálogo de modos con el texto que se muestra en pantalla. */
export interface ModoInfo {
  modo: ModoCalificacion;
  nombre: string;
  ayuda: string;
  /** true = la nota la pone el modelo. Prohibido en exámenes proyectivos. */
  puntuaConIa: boolean;
  /**
   * Códigos EXACTOS de tipo de campo para los que se ofrece (vacío = todos). Son los del
   * catálogo de ms-forms (/field-types): TEXT_SHORT, SINGLE_CHOICE, PHOTO… No inventar
   * variantes ni comparar por subcadena: 'TEXT' no es un tipo, y 'SELECT' no existe.
   */
  tiposCampo: string[];
}

export const MODOS: ModoInfo[] = [
  {
    modo: 'OPCION',
    nombre: 'Opción correcta',
    ayuda: 'Marcas cuáles opciones son correctas. Puede puntuar parcial si acierta algunas.',
    puntuaConIa: false,
    tiposCampo: ['SINGLE_CHOICE', 'DROPDOWN', 'MULTIPLE_CHOICE', 'RATING'],
  },
  {
    modo: 'TEXTO_CONTIENE',
    nombre: 'Debe mencionar',
    ayuda: 'La respuesta acierta si menciona los términos que exiges. Sirve para "diga los tres puntos de anclaje".',
    puntuaConIa: false,
    tiposCampo: ['TEXT_SHORT', 'TEXT_LONG'],
  },
  {
    modo: 'TEXTO_SIMILITUD',
    nombre: 'Se parece a la respuesta modelo',
    ayuda: 'Compara con una respuesta modelo y exige un parecido mínimo. Tolera que lo diga con otras palabras.',
    puntuaConIa: false,
    tiposCampo: ['TEXT_SHORT', 'TEXT_LONG'],
  },
  {
    modo: 'NUMERO_RANGO',
    nombre: 'Dentro de un rango',
    ayuda: 'Acierta si el número cae entre el mínimo y el máximo.',
    puntuaConIa: false,
    tiposCampo: ['NUMBER', 'CURRENCY', 'RATING'],
  },
  {
    modo: 'PRESENCIA',
    nombre: 'Basta con responder',
    ayuda: 'Suma por haber respondido algo. Para evidencias que solo hay que aportar.',
    puntuaConIa: false,
    tiposCampo: [],
  },
  {
    modo: 'IA_RUBRICA',
    nombre: 'La IA califica el texto con una rúbrica',
    ayuda: 'El modelo puntúa la respuesta escrita contra el criterio que redactes. Devuelve la nota y por qué.',
    puntuaConIa: true,
    tiposCampo: ['TEXT_SHORT', 'TEXT_LONG'],
  },
  {
    modo: 'IA_VISION',
    nombre: 'La IA califica la imagen con una rúbrica',
    ayuda: 'El modelo mira la foto y puntúa contra tu criterio. Para evidencias: el EPP puesto, el formato lleno.',
    puntuaConIa: true,
    tiposCampo: ['PHOTO', 'FILE', 'SCAN_DOC', 'SIGNATURE'],
  },
  {
    modo: 'IA_DESCRIPCION',
    nombre: 'La IA describe lo que ve',
    ayuda: 'Enumera lo observable, sin interpretar ni puntuar. Queda pendiente de revisión.',
    puntuaConIa: false,
    tiposCampo: ['PHOTO', 'FILE', 'SCAN_DOC', 'SIGNATURE'],
  },
  {
    modo: 'IA_INTERPRETACION',
    nombre: 'La IA prepara un borrador de lectura',
    ayuda: 'Interpreta siguiendo tu pauta y las lecturas que el equipo ya firmó. Cero puntos: lo revisa y lo firma la profesional.',
    puntuaConIa: false,
    tiposCampo: ['PHOTO', 'FILE', 'SCAN_DOC'],
  },
  {
    modo: 'MANUAL',
    nombre: 'Lo califica una persona',
    ayuda: 'Queda pendiente de revisión desde el principio.',
    puntuaConIa: false,
    tiposCampo: [],
  },
];

export const TIPOS_EXAMEN: { tipo: TipoExamen; nombre: string; ayuda: string; icono: string }[] = [
  {
    tipo: 'CONOCIMIENTO',
    nombre: 'De conocimiento',
    ayuda: 'Comprueba que se sabe algo. Es el único que se puede calificar entero de forma automática.',
    icono: 'quiz',
  },
  {
    tipo: 'DESEMPENO',
    nombre: 'De desempeño',
    ayuda: 'Comprueba que se sabe hacer algo: la foto del EPP puesto, el formato lleno. Mezcla automático con revisión.',
    icono: 'engineering',
  },
  {
    tipo: 'PROYECTIVO',
    nombre: 'Proyectivo (salud ocupacional)',
    ayuda: 'Persona bajo la lluvia, árbol, Wartegg. La IA describe e interpreta como apoyo; la nota y el concepto los firma la profesional.',
    icono: 'psychology',
  },
];

/**
 * Tipos que no son preguntas y por tanto no se califican: una sección es un contenedor y un
 * comentario es texto informativo. Aparecen en la estructura, pero no en la hoja de respuestas.
 */
export const TIPOS_NO_CALIFICABLES = ['SECTION', 'COMMENT'];

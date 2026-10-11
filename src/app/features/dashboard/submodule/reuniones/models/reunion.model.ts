/**
 * Contrato con ms-meetings. El backend responde en snake_case (los DTO lo fijan con
 * @JsonNaming), así que estos modelos lo reflejan tal cual: no hay mapeo intermedio.
 */

export type EstadoReunion =
  | 'BORRADOR' | 'PROGRAMADA' | 'GRABADA' | 'PROCESANDO' | 'EN_REVISION' | 'CERRADA' | 'ERROR';

export type Confidencialidad = 'INTERNA' | 'RESTRINGIDA';

/** Etapas del pipeline de una grabación (§56 del plan). */
export type EstadoGrabacion =
  | 'UPLOADED' | 'VALIDATING' | 'PREPARING_AUDIO' | 'SEGMENTING' | 'TRANSCRIBING'
  | 'MERGING_TRANSCRIPTION' | 'IDENTIFYING_SPEAKERS' | 'EXTRACTING_REQUIREMENTS'
  | 'CLASSIFYING' | 'GENERATING_SUMMARY' | 'GENERATING_QUESTIONS' | 'PENDING_REVIEW'
  | 'COMPLETED' | 'FAILED';

export type TipoParticipante =
  | 'SOLICITANTE' | 'USUARIO_FUNCIONAL' | 'ANALISTA_FUNCIONAL' | 'DESARROLLADOR'
  | 'LIDER_TECNICO' | 'PRODUCT_OWNER' | 'ADMINISTRADOR' | 'INVITADO' | 'PROVEEDOR'
  | 'CLIENTE' | 'OTRO';

export interface ReunionResumen {
  id: string;
  code: string;
  name: string;
  project_id: string | null;
  meeting_type: string;
  system_name: string | null;
  module_name: string | null;
  held_on: string | null;
  started_at_time: string | null;
  duration_min: number | null;
  modality: string;
  status: EstadoReunion;
  confidentiality: Confidencialidad;
  owner_user_id: string | null;
  analyst_user_id: string | null;
  participants_count: number;
  recordings_count: number;
  created_at: string;
  updated_at: string;
  // ── v2: lo que se habló, en el listado (opcionales: un backend viejo no los manda) ──
  /** Suma de la duración de las grabaciones. */
  total_duration_ms?: number | null;
  transcript_status?: EstadoTranscripcion | null;
  analysis_status?: EstadoAnalisis | null;
  /** Estado de la última grabación. */
  pipeline_status?: EstadoGrabacion | null;
  /** ≤ 220 caracteres del resumen. */
  summary_snippet?: string | null;
  /** ≤ 4 títulos de temas. */
  topics?: string[] | null;
  /** ≤ 6 hablantes, ya con su nombre y su color. */
  speakers?: HablanteResumen[] | null;
}

export type EstadoTranscripcion = 'PENDIENTE' | 'EN_PROCESO' | 'LISTA' | 'ERROR';
export type EstadoAnalisis = 'PENDIENTE' | 'EN_PROCESO' | 'LISTA' | 'ERROR';

export interface HablanteResumen {
  display_name: string;
  color_idx: number | null;
  /** Porcentaje de la DURACIÓN de la reunión (los silencios no suman). */
  talk_pct: number | null;
}

export interface ReunionDetalle {
  resumen: ReunionResumen;
  location: string | null;
  meeting_url: string | null;
  tech_lead_user_id: string | null;
  requesting_area: string | null;
  related_areas: string[];
  objective: string | null;
  context: string | null;
  notes: string | null;
  parent_meeting_id: string | null;
  relation_type: string | null;
  participants: Participante[];
  recordings: Grabacion[];
}

export interface CrearReunion {
  name: string;
  project_id?: string | null;
  meeting_type?: string;
  system_name?: string | null;
  module_name?: string | null;
  held_on?: string | null;
  started_at_time?: string | null;
  duration_min?: number | null;
  modality?: string;
  location?: string | null;
  meeting_url?: string | null;
  owner_user_id?: string | null;
  analyst_user_id?: string | null;
  tech_lead_user_id?: string | null;
  requesting_area?: string | null;
  related_areas?: string[];
  objective?: string | null;
  context?: string | null;
  notes?: string | null;
  confidentiality?: Confidencialidad;
  parent_meeting_id?: string | null;
  relation_type?: string | null;
}

export interface Participante {
  id: string;
  usuario_id: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  position: string | null;
  area: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  meeting_role: string | null;
  participant_type: TipoParticipante;
  is_external: boolean;
  /**
   * Clave de la persona en el directorio (`u:…` · `e:…` · `n:…` · `p:…`). La calcula el
   * BACKEND (quita tratamientos, puntuación…): el front la usa tal cual para enlazar a la
   * ficha y nunca la recalcula. Opcional: un backend viejo no la manda.
   */
  person_key?: string | null;
}

export interface Grabacion {
  id: string;
  kind: 'AUDIO' | 'VIDEO';
  source: 'UPLOAD' | 'RECORDED';
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number;
  duration_ms: number | null;
  status: EstadoGrabacion;
  stage_error: string | null;
  segments_count: number | null;
  audio_ready: boolean;
  original_purged: boolean;
  created_at: string;
  updated_at: string;
}

export interface Transcripcion {
  id: string;
  meeting_id: string;
  recording_id: string;
  provider: string | null;
  model: string | null;
  language: string;
  status: EstadoTranscripcion;
  segments_count: number;
  words_count: number;
  version: number;
  /** true mientras la separación de hablantes siga siendo heurística. */
  speakers_approximate: boolean;
  generated_at: string | null;
  speakers: Hablante[];
}

export interface Hablante {
  id: string;
  label: string;
  participant_id: string | null;
  participant_name: string | null;
  approximate: boolean;
  segments_count: number;
  /** v2: vienen también en la respuesta de PUT /speakers/{id}. */
  participant_source?: OrigenAsignacion | null;
  color_idx?: number | null;
}

export interface SegmentoTranscripcion {
  id: number;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_id: string | null;
  speaker_label: string | null;
  speaker_name: string | null;
  text: string;
  /** Sólo viene si el texto fue corregido: es la trazabilidad de la edición. */
  text_original: string | null;
  confidence: number | null;
  edited: boolean;
}

// ── v2: análisis, temas, acuerdos y personas ───────────────────────────────

/** Cómo se separaron los hablantes: por el modelo, por bloques del modelo, por pausas o nada. */
export type Diarizacion = 'model' | 'model-blocks' | 'pauses' | 'none';

export type OrigenAsignacion = 'IA' | 'MANUAL';

/** Hablante con sus estadísticas y la sugerencia de identidad de la IA. */
export interface HablanteInsight {
  id: string;
  label: string;
  participant_id: string | null;
  participant_name: string | null;
  participant_source: OrigenAsignacion | null;
  /** Nombre del participante si está asignado; si no, "Persona N". */
  display_name: string;
  /** Clave de persona del participante asignado (la del directorio); null sin participante. */
  person_key?: string | null;
  color_idx: number | null;
  talk_ms: number;
  talk_pct: number;
  segments_count: number;
  words_count: number;
  first_at_ms: number | null;
  /** Qué dijo o aportó esta persona (IA). */
  summary: string | null;
  suggested_name: string | null;
  suggested_role: string | null;
  /** Cita en la que se presentó: "Soy Marcela, de nómina". */
  suggestion_reason: string | null;
  suggestion_at_ms: number | null;
}

export interface Analisis {
  id: string;
  status: EstadoAnalisis;
  summary: string | null;
  model: string | null;
  error: string | null;
  generated_at: string | null;
  version: number;
}

export interface Tema {
  id: string;
  idx: number;
  title: string;
  summary: string | null;
  keywords: string[];
  start_ms: number;
  end_ms: number;
  /** Quién habló dentro del rango del tema (calculado de los segmentos). */
  speakers: { speaker_id: string; talk_ms: number }[];
}

export type TipoAcuerdo = 'DECISION' | 'COMPROMISO' | 'PENDIENTE' | 'RIESGO';
export type EstadoAcuerdo = 'ABIERTO' | 'HECHO' | 'DESCARTADO';

export interface Acuerdo {
  id: string;
  kind: TipoAcuerdo;
  text: string;
  quote: string | null;
  /** Quién lo dijo. */
  speaker_id: string | null;
  /** Responsable que habló en la reunión. */
  owner_speaker_id: string | null;
  /** Responsable que es participante pero no habló. */
  owner_participant_id: string | null;
  /** Nombre del responsable ya resuelto por el backend. */
  owner_name: string | null;
  /** Responsable nombrado que no es hablante ni participante. */
  owner_text?: string | null;
  /** "el viernes 15", tal como se dijo. */
  due_text: string | null;
  topic_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  status: EstadoAcuerdo;
  source: OrigenAsignacion;
}

/** Alta o edición manual de un acuerdo. */
export interface GuardarAcuerdo {
  kind: TipoAcuerdo;
  text: string;
  owner_speaker_id?: string | null;
  owner_participant_id?: string | null;
  owner_text?: string | null;
  due_text?: string | null;
  start_ms?: number | null;
  status?: EstadoAcuerdo;
}

/** GET /{id}/insights: todo lo que la ficha necesita para pintar la conversación. */
export interface InsightsReunion {
  recording_id: string | null;
  transcript_id: string | null;
  duration_ms: number | null;
  transcript_status: EstadoTranscripcion | null;
  diarization: Diarizacion | string | null;
  pipeline: { status: EstadoGrabacion | null; stage_error: string | null } | null;
  analysis: Analisis | null;
  speakers: HablanteInsight[];
  topics: Tema[];
  items: Acuerdo[];
}

/** Filtros opcionales del listado de segmentos. */
export interface FiltroSegmentos {
  speaker_id?: string | null;
  from_ms?: number | null;
  to_ms?: number | null;
}

/** Una coincidencia de la búsqueda GLOBAL (en todas las reuniones visibles). */
export interface CoincidenciaGlobal {
  meeting_id: string;
  meeting_code: string;
  meeting_name: string;
  held_on: string | null;
  recording_id: string;
  segment_id: number;
  start_ms: number;
  end_ms: number;
  speaker_id: string | null;
  speaker_name: string | null;
  color_idx: number | null;
  text: string;
}

export interface ResultadoBusquedaGlobal {
  query: string;
  total: number;
  matches: CoincidenciaGlobal[];
}

/**
 * Una persona a través de todas las reuniones.
 * `person_key` = `u:<usuario_id>` | `e:<email>` | `n:<nombre normalizado>`.
 */
export interface Persona {
  person_key: string;
  display_name: string;
  usuario_id: string | null;
  area: string | null;
  position: string | null;
  company: string | null;
  is_external: boolean;
  meetings_count: number;
  spoke_in_count: number;
  talk_ms: number;
  open_commitments: number;
  last_meeting_on: string | null;
}

export interface ReunionDePersona {
  meeting_id: string;
  code: string;
  name: string;
  held_on: string | null;
  status: EstadoReunion;
  talk_ms: number;
  talk_pct: number | null;
  speaker_summary: string | null;
  role: string | null;
}

export interface AcuerdoDePersona extends Acuerdo {
  meeting_id: string;
  meeting_name: string;
}

export interface CitaDePersona {
  meeting_id: string;
  meeting_name: string;
  recording_id: string;
  start_ms: number;
  text: string;
}

export interface FichaPersona {
  person: Persona;
  meetings: ReunionDePersona[];
  commitments: AcuerdoDePersona[];
  decisions: AcuerdoDePersona[];
  quotes: CitaDePersona[];
}

export interface Coincidencia {
  start_ms: number;
  end_ms: number;
  speaker_name: string | null;
  text: string;
}

export interface ResultadoBusqueda {
  query: string;
  total: number;
  matches: Coincidencia[];
}

export interface Nota {
  id: string;
  at_ms: number | null;
  body: string;
  author_id: string | null;
  created_at: string;
}

export interface PaginaSpring<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  /** Forma VIA_DTO de Spring Data 3.3+ (por si el backend la activa). */
  page?: { size: number; number: number; totalElements: number; totalPages: number };
}

/** Etiquetas en español de las etapas del pipeline, para pintar el estado. */
export const ETAPA_LABEL: Record<EstadoGrabacion, string> = {
  UPLOADED: 'Subida',
  VALIDATING: 'Validando',
  PREPARING_AUDIO: 'Preparando audio',
  SEGMENTING: 'Segmentando',
  TRANSCRIBING: 'Transcribiendo',
  MERGING_TRANSCRIPTION: 'Uniendo transcripción',
  IDENTIFYING_SPEAKERS: 'Identificando hablantes',
  EXTRACTING_REQUIREMENTS: 'Extrayendo requisitos',
  CLASSIFYING: 'Clasificando',
  GENERATING_SUMMARY: 'Generando resumen',
  GENERATING_QUESTIONS: 'Generando preguntas',
  PENDING_REVIEW: 'Requiere revisión',
  COMPLETED: 'Completada',
  FAILED: 'Error',
};

/** Etapas en las que el pipeline sigue trabajando (el front debe seguir sondeando). */
export const ETAPAS_EN_CURSO: EstadoGrabacion[] = [
  'UPLOADED', 'VALIDATING', 'PREPARING_AUDIO', 'SEGMENTING', 'TRANSCRIBING',
  'MERGING_TRANSCRIPTION', 'IDENTIFYING_SPEAKERS', 'EXTRACTING_REQUIREMENTS', 'CLASSIFYING',
  'GENERATING_SUMMARY', 'GENERATING_QUESTIONS',
];

/**
 * La misma etapa contada a quien espera: qué está pasando con SU reunión, no el nombre
 * interno del paso. Varias etapas internas se funden en una sola frase porque para la
 * persona son lo mismo ("resumiendo").
 */
export const ETAPA_HUMANA: Record<EstadoGrabacion, string> = {
  UPLOADED: 'Recibimos la grabación',
  VALIDATING: 'Revisando el archivo',
  PREPARING_AUDIO: 'Preparando el audio',
  SEGMENTING: 'Preparando el audio',
  TRANSCRIBING: 'Transcribiendo lo que se dijo',
  MERGING_TRANSCRIPTION: 'Uniendo la transcripción',
  IDENTIFYING_SPEAKERS: 'Separando quién habló',
  EXTRACTING_REQUIREMENTS: 'Sacando temas y acuerdos',
  CLASSIFYING: 'Sacando temas y acuerdos',
  GENERATING_SUMMARY: 'Resumiendo la conversación',
  GENERATING_QUESTIONS: 'Resumiendo la conversación',
  PENDING_REVIEW: 'Lista para revisar',
  COMPLETED: 'Lista',
  FAILED: 'No se pudo procesar',
};

/** Pasos visibles del avance, en orden. Cada etapa interna cae en uno de ellos. */
export const PASOS_PIPELINE: { etiqueta: string; etapas: EstadoGrabacion[] }[] = [
  { etiqueta: 'Recibir', etapas: ['UPLOADED', 'VALIDATING'] },
  { etiqueta: 'Preparar audio', etapas: ['PREPARING_AUDIO', 'SEGMENTING'] },
  { etiqueta: 'Transcribir', etapas: ['TRANSCRIBING', 'MERGING_TRANSCRIPTION'] },
  { etiqueta: 'Separar voces', etapas: ['IDENTIFYING_SPEAKERS'] },
  { etiqueta: 'Resumir', etapas: ['EXTRACTING_REQUIREMENTS', 'CLASSIFYING', 'GENERATING_SUMMARY', 'GENERATING_QUESTIONS'] },
];

export const TIPO_ACUERDO_LABEL: Record<TipoAcuerdo, { uno: string; varios: string }> = {
  DECISION: { uno: 'Decisión', varios: 'Decisiones' },
  COMPROMISO: { uno: 'Compromiso', varios: 'Compromisos' },
  PENDIENTE: { uno: 'Pendiente', varios: 'Pendientes' },
  RIESGO: { uno: 'Riesgo', varios: 'Riesgos' },
};

export const TIPOS_ACUERDO: TipoAcuerdo[] = ['DECISION', 'COMPROMISO', 'PENDIENTE', 'RIESGO'];

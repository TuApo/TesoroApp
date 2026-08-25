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
  status: 'PENDIENTE' | 'EN_PROCESO' | 'LISTA' | 'ERROR';
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
  'MERGING_TRANSCRIPTION', 'EXTRACTING_REQUIREMENTS', 'CLASSIFYING',
  'GENERATING_SUMMARY', 'GENERATING_QUESTIONS',
];

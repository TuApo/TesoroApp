/**
 * Asistente de reuniones (bot) — tipos del contrato de ms-meetings
 * (`wt-reuniones/PLAN-REUNIONES-BOT.md`). JSON en snake_case, como el resto del módulo.
 */

export type Plataforma = 'MEET' | 'ZOOM' | 'TEAMS' | 'WEBEX' | 'JITSI' | 'WHATSAPP' | 'OTRA';
export type ModoBot = 'NAVEGADOR' | 'CAPTURA';
export type OrigenSesion = 'MANUAL' | 'INVITACION';

export type EstadoSesion =
  | 'PENDIENTE_APROBACION' | 'PROGRAMADA' | 'EN_COLA' | 'UNIENDO' | 'SALA_ESPERA'
  | 'EN_CURSO' | 'FINALIZANDO' | 'FINALIZADA' | 'CANCELADA' | 'RECHAZADA' | 'ERROR';

export type PoliticaInvitaciones = 'AUTOMATICA' | 'APROBAR';
export type Confidencialidad = 'INTERNA' | 'RESTRINGIDA';

export interface BotConfig {
  activo: boolean;
  nombre_bot: string;
  mensaje_presentacion: string;
  unirse_invitaciones: boolean;
  politica_invitaciones: PoliticaInvitaciones;
  buzones: string[];
  plataformas: Plataforma[];
  idioma: string;
  grabar_video: boolean;
  capturas_cada_seg: number;
  capturas_inteligentes: boolean;
  clips_automaticos: boolean;
  clip_segundos: number;
  notas_cada_seg: number;
  salir_si_solo_min: number;
  duracion_max_min: number;
  sala_espera_max_min: number;
  confidencialidad: Confidencialidad;
  instrucciones_ia: string | null;
  transcripcion_vivo: boolean;
  subtitulos_plataforma: boolean;
  actualizado_en?: string | null;
}

export interface Buzon {
  id: string;
  direccion: string;
  etiqueta: string | null;
  proveedor: string | null;
  estado: string | null;
}

export interface ParticipanteBot { nombre: string; }

export interface InvitacionRef { remitente: string | null; asunto: string | null; buzon: string | null; }

export interface SesionResumen {
  id: string;
  meeting_id: string;
  meeting_code: string | null;
  titulo: string | null;
  plataforma: Plataforma;
  modo: ModoBot;
  join_url: string | null;
  origen: OrigenSesion;
  estado: EstadoSesion;
  estado_detalle: string | null;
  programada_para: string | null;
  unido_en: string | null;
  finalizada_en: string | null;
  duracion_ms: number | null;
  bot_nombre: string | null;
  participantes: ParticipanteBot[] | null;
  invitacion: InvitacionRef | null;
  recording_id: string | null;
  creado_en: string;
  owner_user_id: string | null;
}

export interface ConteoSesion { transcripcion: number; capturas: number; clips: number; compromisos: number; }

export interface Sesion extends SesionResumen {
  worker_id: string | null;
  ultimo_latido_en: string | null;
  conteo: ConteoSesion | null;
}

export type TipoEvento =
  | 'TRANSCRIPCION' | 'SUBTITULO' | 'CAPTURA' | 'CLIP' | 'NOTA' | 'COMPROMISO' | 'ESTADO'
  | 'PARTICIPANTE' | 'CHAT_REUNION' | 'CHAT_IA' | 'MARCA';

export interface SugerenciaIa { tipo: 'ENVIAR_CHAT'; texto: string; }

export interface Evento {
  id: number;
  tipo: TipoEvento;
  t_ms: number | null;
  hablante: string | null;
  texto: string | null;
  payload: Record<string, unknown> | null;
  archivo: boolean;
  mime: string | null;
  importante: boolean;
  autor: 'IA' | 'USUARIO' | 'BOT' | null;
  creado_en: string;
}

export interface Tema { titulo: string; desde_ms: number | null; }
export interface Decision { texto: string; t_ms: number | null; }
export interface MomentoClave { t_ms: number | null; titulo: string; motivo: string | null; }

export interface Notas {
  version: number;
  resumen: string | null;
  temas: Tema[];
  decisiones: Decision[];
  preguntas_abiertas: string[];
  riesgos: string[];
  momentos_clave: MomentoClave[];
  actualizado_en: string | null;
  modelo: string | null;
  /** La última pasada de la IA falló (ms-ai caído, respuesta ilegible…); las notas son las previas. */
  error?: string | null;
}

export type EstadoCompromiso = 'PROPUESTO' | 'CONFIRMADO' | 'DESCARTADO' | 'HECHO';

export interface Compromiso {
  id: string;
  texto: string;
  responsable: string | null;
  fecha_limite: string | null;
  estado: EstadoCompromiso;
  t_ms: number | null;
  origen: 'IA' | 'USUARIO';
  creado_en: string;
}

export type TipoComando = 'SALIR' | 'CAPTURA' | 'CLIP' | 'ENVIAR_CHAT' | 'PAUSAR' | 'REANUDAR';

export interface Comando {
  id: string;
  tipo: TipoComando;
  texto: string | null;
  segundos: number | null;
  estado: 'PENDIENTE' | 'TOMADO' | 'HECHO' | 'ERROR';
  error: string | null;
  creado_en: string;
}

export interface Live {
  sesion: Sesion;
  eventos: Evento[];
  notas: Notas | null;
  compromisos: Compromiso[];
  ultimo_id: number;
}

export interface CrearSesion {
  join_url?: string | null;
  titulo?: string | null;
  programada_para?: string | null;
  modo?: ModoBot;
}

/**
 * El chat responde 202 con la pregunta y `respuesta: null`: la respuesta de la IA llega
 * después por /live como otro CHAT_IA con `payload.en_respuesta_a = pregunta.id`
 * (o `payload.error` si falló). El gateway corta a 30 s y el modelo puede tardar más.
 */
export interface RespuestaChat { pregunta: Evento; respuesta: Evento | null; }

/**
 * Page de Spring tal como sale de ms-meetings: el PageImpl se serializa "as-is" y en
 * camelCase (el ObjectMapper del HTTP es el de commons, sin estrategia de nombres; solo
 * los DTO anotados van en snake_case). Igual que PaginaReuniones del módulo.
 */
export interface PaginaSpring<T> {
  content: T[];
  totalElements?: number;
  totalPages?: number;
  number?: number;
  size?: number;
}

/** Grupos que acepta el filtro `estado` del listado. */
export type GrupoSesiones = 'VIVAS' | 'PROGRAMADAS' | 'POR_APROBAR' | 'HISTORIAL';

/** URL firmada de una captura/clip: relativa a la raíz del API, vence a los 10 min. */
export interface UrlArchivo { url: string; expira_en: string | null; }

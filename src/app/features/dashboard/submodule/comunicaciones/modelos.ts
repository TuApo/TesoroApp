/**
 * Contratos de ms-comunicaciones (JSON en snake_case, tal cual lo sirve el backend).
 */

export type TipoConversacion = 'DIRECTA' | 'GRUPO' | 'SOPORTE';
/** Grupos automáticos por rango: todo el personal de una finca, una sede o una empresa temporal. */
export type AlcanceGrupo = 'FINCA' | 'SEDE' | 'EMPRESA';
export type TipoMensaje = 'TEXTO' | 'ARCHIVO' | 'SISTEMA' | 'LLAMADA';
export type ClaseAdjunto = 'IMAGEN' | 'DOCUMENTO' | 'ESCANEO' | 'AUDIO' | 'VIDEO' | 'OTRO';
export type EstadoLlamada = 'SONANDO' | 'EN_CURSO' | 'FINALIZADA' | 'PERDIDA' | 'RECHAZADA' | 'CANCELADA';
export type EstadoTranscripcion = 'NINGUNA' | 'PENDIENTE' | 'PROCESANDO' | 'LISTA' | 'ERROR' | 'SIN_AUDIO';
export type EstadoCompromiso = 'PENDIENTE' | 'EN_CURSO' | 'CUMPLIDO' | 'CANCELADO';

export interface UsuarioDir {
  id: string;
  nombre: string;
  correo: string | null;
  rol: string | null;
  sede: string | null;
  tiene_foto: boolean;
  en_linea: boolean;
  /** Cargo del contrato vigente (o el nombre del rol si no tiene contrato). */
  cargo: string | null;
  /** Finca o sede donde trabaja, para mostrar junto al cargo. */
  lugar: string | null;
  /** Coordina alguna finca o tiene el rol de coordinador. */
  coordinador: boolean;
  /** Última actividad en la plataforma (epoch ms); null = nunca ha entrado. */
  ultima_vez_ms: number | null;
  /** Temporal o empresa a la que pertenece ("Tu Alianza", "Apoyo Laboral"…). */
  empresa?: string | null;
  /** Grupo de personal que se resalta ("Administrativo de apoyo"), o null. */
  grupo?: string | null;
}

/** Un favorito: asignado por la administración (novedades), su coordinador o marcado con estrella. */
export interface Favorito {
  usuario: UsuarioDir;
  motivo: string | null;
  origen: 'ASIGNADO' | 'COORDINADOR' | 'PERSONAL';
  /** Quien consulta lo marcó con la estrella. */
  estrella: boolean;
}

export interface PersonaItem { usuario: UsuarioDir; favorito: boolean }
export interface PaginaPersonas { total: number; pagina: number; tamano: number; items: PersonaItem[] }
export interface OpcionFiltro { clave: string; nombre: string; total: number }
export interface OpcionesDirectorio {
  roles: OpcionFiltro[]; fincas: OpcionFiltro[]; sedes: OpcionFiltro[]; empresas: OpcionFiltro[];
  /** Grupos de personal: ADMINISTRATIVOS, COORDINADORES, VIRTUAL, MISION. */
  grupos?: OpcionFiltro[];
}
/** Atajo de búsqueda: un grupo de personal o una empresa temporal. */
export interface AtajoDirectorio { tipo: 'grupo' | 'empresa'; clave: string; nombre: string; total: number; icono: string }
/** Grupos de personal y empresas como atajos, en el orden en que se muestran. */
export function atajosDirectorio(o: OpcionesDirectorio | null): AtajoDirectorio[] {
  if (!o) return [];
  const iconos: Record<string, string> = { ADMINISTRATIVOS: 'badge', COORDINADORES: 'supervisor_account', VIRTUAL: 'headset_mic', MISION: 'agriculture' };
  return [
    ...(o.grupos ?? []).map(g => ({ tipo: 'grupo' as const, clave: g.clave, nombre: g.nombre, total: g.total, icono: iconos[g.clave] ?? 'group' })),
    ...(o.empresas ?? []).map(e => ({ tipo: 'empresa' as const, clave: e.clave, nombre: e.nombre, total: e.total, icono: 'apartment' })),
  ];
}
export type FiltroActividad = 'TODOS' | 'EN_LINEA' | 'RECIENTE' | 'NUNCA';
export interface FiltroDirectorio {
  q?: string; rol?: string | null; finca?: string | null; sede?: string | null; empresa?: string | null;
  grupo?: string | null; actividad?: FiltroActividad; pagina?: number; tamano?: number;
}

export type AlcanceContacto = 'TODOS' | 'EMPRESA' | 'SEDE' | 'FINCA';
/** "A las personas de este rol en este rango las atiende esta persona, para esto." */
export interface ReglaContacto {
  id: number;
  contacto: UsuarioDir;
  motivo: string;
  rol: string | null;
  alcance_tipo: AlcanceContacto;
  alcance_clave: string | null;
  alcance_nombre: string | null;
  orden: number;
  activo: boolean;
  /** Cuántas personas lo ven como favorito. */
  audiencia: number;
  actualizado_en: string;
}
export interface ReglaContactoReq {
  contacto_id?: string; motivo?: string; rol?: string | null; alcance_tipo?: AlcanceContacto;
  alcance_clave?: string | null; alcance_nombre?: string | null; orden?: number; activo?: boolean;
}

/** Un coordinador de quien consulta y por qué lo es ("Coordina la finca El Hato"). */
export interface MiCoordinador {
  usuario: UsuarioDir;
  motivo: string;
}

export interface ParticipanteOut {
  usuario_id: string;
  nombre: string;
  rol: 'ADMIN' | 'MIEMBRO';
  activo: boolean;
  en_linea: boolean;
  ultimo_leido_id: number;
  cargo: string | null;
  /** Finca o sede. */
  sede: string | null;
  tiene_foto: boolean;
  coordinador: boolean;
  /** Última actividad en la plataforma (epoch ms); null = nunca ha entrado. */
  ultima_vez_ms: number | null;
}

export interface LlamadaActiva {
  id: string;
  tipo: 'AUDIO' | 'VIDEO';
  estado: EstadoLlamada;
  iniciada_por: string;
  iniciada_por_nombre: string;
  conectados: string[];
  creada_en: string;
}

export interface Conversacion {
  id: string;
  tipo: TipoConversacion;
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  color: string | null;
  otro_usuario_id: string | null;
  participantes: ParticipanteOut[];
  ultimo_mensaje_id: number | null;
  ultimo_mensaje_en: string | null;
  ultimo_mensaje_texto: string | null;
  ultimo_mensaje_autor: string | null;
  no_leidos: number;
  mi_ultimo_leido_id: number;
  silenciada: boolean;
  fijada: boolean;
  archivada: boolean;
  mi_rol: 'ADMIN' | 'MIEMBRO' | null;
  llamada_activa: LlamadaActiva | null;
  creado_en: string;
  /** Solo en los grupos automáticos por rango. */
  alcance_tipo: AlcanceGrupo | null;
  /** Canal de anuncios: solo publican los administradores del grupo. */
  solo_admins_escriben: boolean;
  puede_escribir: boolean;
  /** Personas activas; en grupos grandes `participantes` trae solo una muestra. */
  total_participantes: number;
  /** Línea de soporte: la atiende el asistente (IA) o una persona (HUMANO). */
  soporte_estado: 'IA' | 'HUMANO' | null;
}

/** Lo que el asistente de soporte añade a su mensaje. */
export interface MetaAsistente {
  asistente: true;
  sugerencias?: string[];
  ir_a?: { etiqueta: string; ruta: string }[];
  documentos?: { id: string; nombre: string; tipo: string; mime: string; url?: string; descarga_url?: string }[];
  enlaces?: { etiqueta: string; url: string }[];
  escalar?: boolean;
}

export interface Adjunto {
  id: string;
  nombre: string;
  mime: string;
  clase: ClaseAdjunto;
  tamano: number;
  ancho: number | null;
  alto: number | null;
  duracion_ms: number | null;
  url: string;
  miniatura_url: string | null;
  descarga_url: string;
  mensaje_id: number | null;
  creado_en: string;
}

export interface Cita {
  id: number;
  autor_id: string | null;
  autor_nombre: string | null;
  tipo: TipoMensaje;
  texto: string | null;
  eliminado: boolean;
}

export interface Mensaje {
  id: number;
  conversacion_id: string;
  autor_id: string | null;
  autor_nombre: string | null;
  tipo: TipoMensaje;
  texto: string | null;
  responde_a_id: number | null;
  responde_a: Cita | null;
  llamada_id: string | null;
  meta: Record<string, any> | null;
  adjuntos: Adjunto[];
  creado_en: string;
  editado_en: string | null;
  eliminado: boolean;
  cliente_id: string | null;
  /** Solo en el cliente: enviándose o falló. */
  _estado?: 'enviando' | 'error';
}

export interface ParticipanteLlamada {
  usuario_id: string;
  nombre: string;
  estado: 'INVITADO' | 'CONECTADO' | 'SALIO' | 'RECHAZO' | 'PERDIDA';
  sesion: string | null;
  unido_en: string | null;
  salio_en: string | null;
  /** Cuándo le empezó a sonar si la sumaron con la llamada ya empezada. */
  invitado_en?: string | null;
  invitado_por?: string | null;
  invitado_por_nombre?: string | null;
}

/** Lo escrito en el chat durante una llamada; {@code momento_ms} = su lugar en la línea de tiempo del acta. */
export interface MensajeLlamada {
  id: number;
  autor_id: string | null;
  autor_nombre: string | null;
  tipo: TipoMensaje;
  texto: string | null;
  adjuntos: Adjunto[];
  momento_ms: number;
  creado_en: string;
  cliente_id: string | null;
  /** Solo en el cliente: enviándose o falló. */
  _estado?: 'enviando' | 'error';
}

export interface Llamada {
  id: string;
  conversacion_id: string;
  conversacion_nombre: string | null;
  grupo: boolean;
  tipo: 'AUDIO' | 'VIDEO';
  estado: EstadoLlamada;
  iniciada_por: string;
  iniciada_por_nombre: string;
  transcribir: boolean;
  inicio_epoch_ms: number;
  creada_en: string;
  contestada_en: string | null;
  finalizada_en: string | null;
  duracion_seg: number | null;
  transcripcion_estado: EstadoTranscripcion;
  titulo: string | null;
  participantes: ParticipanteLlamada[];
}

export interface UnirseOut {
  llamada: Llamada;
  servidor_ahora_ms: number;
  ice_servers: RTCIceServer[];
  max_participantes: number;
}

export interface Segmento {
  id: number;
  usuario_id: string;
  nombre: string;
  inicio_ms: number;
  fin_ms: number;
  texto: string;
  /** GRABACION (transcrita después de colgar) o EN_VIVO (mientras se hablaba). */
  fuente?: 'GRABACION' | 'EN_VIVO';
}

export interface Pista {
  id: string;
  usuario_id: string;
  nombre: string;
  desfase_ms: number;
  segmentos: number;
  audio_url: string | null;
}

export interface Resumen {
  id: string;
  conversacion_id: string;
  llamada_id: string | null;
  origen: 'LLAMADA' | 'CHAT';
  titulo: string | null;
  resumen: string;
  temas: string[];
  decisiones: string[];
  pendientes: string[];
  desde_mensaje_id: number | null;
  hasta_mensaje_id: number | null;
  automatico: boolean;
  creado_en: string;
}

export interface Compromiso {
  id: string;
  conversacion_id: string;
  conversacion_nombre: string | null;
  origen: 'LLAMADA' | 'CHAT' | 'MANUAL';
  llamada_id: string | null;
  mensaje_id: number | null;
  momento_ms: number | null;
  descripcion: string;
  responsable_id: string | null;
  responsable_nombre: string | null;
  fecha_limite: string | null;
  estado: EstadoCompromiso;
  generado_ia: boolean;
  evidencia: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  cumplido_en: string | null;
  vencido: boolean;
}

export interface Transcripcion {
  llamada: Llamada;
  segmentos: Segmento[];
  resumen: Resumen | null;
  compromisos: Compromiso[];
  pistas: Pista[];
  /** Lo que se escribieron en el chat mientras duró la llamada. */
  chat?: MensajeLlamada[];
  /** Los momentos importantes (clips) guardados por alguien o detectados por la IA. */
  momentos?: Momento[];
}

/** Una frase transcrita en vivo desde el micrófono de quien la dijo. */
export interface LineaVivo {
  id: number | null;
  llamada_id: string;
  usuario_id: string;
  nombre: string;
  cliente_id: string;
  inicio_ms: number;
  fin_ms: number | null;
  texto: string;
}

export type TipoMomento = 'ACUERDO' | 'COMPROMISO' | 'DATO' | 'ALERTA' | 'PREGUNTA' | 'MOSTRADO';

/** Algo importante de la llamada guardado como clip: audio de todos, captura de lo mostrado y video de la pantalla. */
export interface Momento {
  id: string;
  llamada_id: string;
  conversacion_id: string;
  origen: 'PERSONA' | 'IA';
  tipo: TipoMomento | null;
  creado_por: string | null;
  creado_por_nombre: string | null;
  momento_ms: number;
  desde_ms: number;
  hasta_ms: number;
  titulo: string | null;
  nota: string | null;
  extracto: string | null;
  audio_estado: 'PENDIENTE' | 'LISTO' | 'SIN_AUDIO' | 'ERROR';
  audio_url: string | null;
  video_url: string | null;
  imagen_url: string | null;
  creado_en: string;
}

export interface EnVivo { llamada_id: string; disponible: boolean; lineas: LineaVivo[]; momentos: Momento[] }

export interface MetaAsistenteIa {
  borrador?: string;
  momentos?: string[];
  ir_a?: { etiqueta: string; ruta: string }[];
  documentos?: { id: string; nombre: string; tipo: string; mime: string; url?: string; descarga_url?: string }[];
  enlaces?: { etiqueta: string; url: string }[];
}

/** Un turno del hilo privado de cada persona con el asistente de una llamada o conversación. */
export interface MsgAsistente {
  id: number;
  ambito: 'LLAMADA' | 'CONVERSACION';
  ambito_id: string;
  rol: 'PERSONA' | 'IA';
  texto: string;
  meta: MetaAsistenteIa | null;
  creado_en: string;
}

export type AccionRedactar = 'MEJORAR' | 'CORREGIR' | 'FORMAL' | 'CORDIAL' | 'BREVE' | 'RESPONDER' | 'PERSONALIZADA';

export interface Busqueda {
  q: string;
  conversaciones: { id: string; nombre: string; tipo: TipoConversacion }[];
  mensajes: Mensaje[];
  transcripciones: {
    id: number; llamada_id: string; conversacion_id: string | null; nombre: string;
    inicio_ms: number; texto: string; llamada_en: string | null; llamada_titulo: string | null;
  }[];
  archivos: Adjunto[];
  compromisos: Compromiso[];
  resumenes: Resumen[];
}

export interface CompromisoReq {
  conversacion_id?: string;
  descripcion?: string;
  responsable_id?: string | null;
  fecha_limite?: string | null;
  estado?: EstadoCompromiso;
  quitar_responsable?: boolean;
  quitar_fecha?: boolean;
}

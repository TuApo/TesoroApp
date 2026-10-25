/** Contrato de ms-seguimiento (/api/v1/seguimiento/bandeja), en snake_case como lo sirve el backend. */

export type Canal = 'CORREO' | 'WHATSAPP';
export type EstadoHilo = 'POR_RESPONDER' | 'ESPERANDO' | 'AL_DIA' | 'RESUELTO' | 'ARCHIVADO';
export type TipoCompromiso = 'SOLICITUD' | 'MIO' | 'DEL_CONTACTO';
export type EstadoCompromiso = 'PENDIENTE' | 'EN_CURSO' | 'CUMPLIDO' | 'DESCARTADO';

export interface Cuenta {
  id: string;
  usuario_id: string;
  canal: Canal;
  proveedor: string;
  etiqueta: string | null;
  direccion: string | null;
  nombre_mostrado: string | null;
  estado: string;
  ultimo_error: string | null;
  ultimo_sync_en: string | null;
  ultimo_ok_en: string | null;
  mensajes_importados: number;
  incluir_grupos: boolean;
  analisis_ia: boolean;
  transcribir_audios: boolean;
  sincronizar_desde: string | null;
  aviso_aceptado_en: string | null;
  creado_en: string;
  servidores?: { imap: string; enviados: string };
  vinculacion?: Vinculacion;
}

export interface Vinculacion {
  estado: string | null;
  qr: string | null;
  codigo: string | null;
  numero: string | null;
  nombre: string | null;
  error: string | null;
}

export interface Aviso { version: string; texto: string; supervision_roles: string[] }

export interface HiloResumen {
  id: string;
  cuenta_id: string;
  usuario_id: string;
  canal: Canal;
  titulo: string | null;
  asunto: string | null;
  contacto_id: string | null;
  es_grupo: boolean;
  es_masivo: boolean;
  estado: EstadoHilo;
  estado_manual: string | null;
  pendiente_desde: string | null;
  prioridad: 'ALTA' | 'MEDIA' | 'BAJA' | null;
  categoria: string | null;
  sentimiento: string | null;
  resumen: string | null;
  requiere_respuesta: boolean | null;
  motivo_respuesta: string | null;
  ignorado: boolean;
  fijado: boolean;
  no_leidos: number;
  total_mensajes: number;
  ultimo_mensaje_en: string | null;
  ultimo_entrante_en: string | null;
  ultimo_saliente_en: string | null;
  ultima_direccion: 'ENTRANTE' | 'SALIENTE' | null;
  vista_previa: string | null;
  analizado_en: string | null;
  analisis_pendiente: boolean;
  contacto_nombre: string | null;
  contacto_organizacion: string | null;
  cuenta_etiqueta: string | null;
  cuenta_direccion: string | null;
  compromisos_abiertos: number;
  tareas: number;
  tareas_abiertas: number;
  respuesta_sugerida?: string | null;
  clave_externa?: string;
}

export interface Pagina<T> { items: T[]; total: number; pagina?: number; tamano?: number }

export interface AdjuntoVista { id: string; nombre: string | null; mime: string | null; tamano: number | null; disponible: boolean }

export interface MensajeVista {
  id: number;
  hilo_id: string;
  direccion: 'ENTRANTE' | 'SALIENTE';
  remitente_nombre: string | null;
  remitente: string | null;
  destinatarios_json: string | null;
  asunto: string | null;
  texto: string | null;
  tipo: string;
  transcripcion: string | null;
  enviado_en: string;
  leido: boolean;
  estado_envio: string | null;
  tiene_html: boolean;
  adjuntos: AdjuntoVista[];
}

export interface Compromiso {
  id: string;
  usuario_id: string;
  hilo_id: string | null;
  contacto_id: string | null;
  mensaje_id: number | null;
  tipo: TipoCompromiso;
  descripcion: string;
  detalle: string | null;
  quien: string | null;
  evidencia: string | null;
  vence_en: string | null;
  estado: EstadoCompromiso;
  origen: 'IA' | 'MANUAL';
  confianza: number | null;
  cumplido_en: string | null;
  cumplido_por: string | null;
  creado_en: string;
  // En el listado
  hilo_titulo?: string | null;
  hilo_asunto?: string | null;
  canal?: Canal | null;
  hilo_estado?: string | null;
  contacto_nombre?: string | null;
  tareas?: number;
  tarea_estado?: string | null;
  tarea_id?: number | null;
  falta_avisar?: boolean | number;
}

export interface TareaLigada {
  tarea_id: number;
  tarea_uuid: string | null;
  hilo_id: string | null;
  compromiso_id: string | null;
  titulo: string | null;
  estado: string | null;
  responsable_id: string | null;
  vence_en: string | null;
  completada_en: string | null;
  creada_en: string | null;
}

export interface EventoBandeja {
  id: number;
  tipo: string;
  descripcion: string | null;
  actor_nombre: string | null;
  creado_en: string;
  hilo_id: string | null;
  compromiso_id: string | null;
}

export interface Contacto {
  id: string;
  usuario_id: string;
  nombre: string | null;
  organizacion: string | null;
  cargo: string | null;
  etapa: 'NUEVO' | 'ACTIVO' | 'SEGUIMIENTO' | 'CERRADO';
  etiquetas_json: string | null;
  notas: string | null;
  usuario_plataforma_id: string | null;
  primer_contacto_en: string | null;
  ultimo_contacto_en: string | null;
  mensajes_entrantes: number;
  mensajes_salientes: number;
  // listado
  canales?: string | null;
  identidades?: string | null;
  por_responder?: number;
  compromisos_abiertos?: number;
  conversaciones?: number;
}

export interface HiloDetalle {
  hilo: HiloResumen;
  contacto: Contacto | null;
  cuenta: Cuenta | null;
  compromisos: Compromiso[];
  tareas: TareaLigada[];
  eventos: EventoBandeja[];
  mensajes: MensajeVista[];
  hay_mas: boolean;
  es_dueno: boolean;
}

export interface ContactoDetalle {
  contacto: Contacto;
  identidades: { tipo: string; valor: string }[];
  conversaciones: Partial<HiloResumen>[];
  compromisos: Compromiso[];
  tareas: TareaLigada[];
  linea_tiempo: { tipo: string; fecha: string; canal: string | null; hilo_id: string | null; descripcion: string | null; titulo: string | null }[];
  es_dueno: boolean;
}

export interface ResumenBandeja {
  por_responder: number;
  vencidos: number;
  esperando: number;
  no_leidos: number;
  urgentes: number;
  compromisos_abiertos: number;
  compromisos_vencidos: number;
  compromisos_hoy: number;
  yo_debo: number;
  me_deben: number;
  cumplidos_30d: number;
  tareas_abiertas: number;
  cuentas_con_error: number;
  cuentas: number;
  mensajes_recibidos: number;
  mensajes_enviados: number;
  respuestas: number;
  sin_respuesta: number;
  respuesta_media_min: number | null;
  respuesta_mediana_min: number | null;
  sla_horas: number;
  es_supervisor: boolean;
  ia_disponible: boolean;
  por_dia: { dia: string; recibidos: number; enviados: number }[];
}

export interface MiembroEquipo extends Omit<Partial<ResumenBandeja>, 'cuentas'> {
  usuario_id: string;
  nombre: string;
  rol: string | null;
  sede: string | null;
  cuentas: { canal: Canal; direccion: string | null; estado: string; ultimo_ok_en: string | null; ultimo_error: string | null }[];
}

export interface AccesoSupervision {
  supervisor_id: string;
  supervisor_nombre: string | null;
  supervisor_rol: string | null;
  recurso: string;
  recurso_id: string | null;
  detalle: string | null;
  ip: string | null;
  creado_en: string;
}

export interface ParametroSeguimiento { clave: string; valor: string | null; descripcion: string | null; actualizado_en: string | null; actualizado_por_nombre?: string }

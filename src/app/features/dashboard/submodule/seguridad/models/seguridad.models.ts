/**
 * Tipos del contrato de ms-seguridad (microservices/ms-seguridad/CONTRATO-API.md).
 * JSON en snake_case, fechas ISO sin zona (hora de Bogotá), ids UUID en texto.
 * Si el contrato cambia, se cambia aquí primero: el resto del módulo lee de estos tipos.
 */

// ── Comunes ────────────────────────────────────────────────────────────────
export interface Pagina<T> { count: number; results: T[]; }

export type Severidad = 'INFO' | 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export type EstadoConexion = 'EN_LINEA' | 'FUERA_DE_LINEA' | 'DESCONOCIDO';
export type Calidad = 'sub' | 'main';
export type Disposicion = '1x1' | '2x2' | '3x3' | '4x4' | '1+5' | '1+7';

// ── Tablero ────────────────────────────────────────────────────────────────
export interface SedeTablero {
  sede_id: string; nombre: string; camaras: number; en_linea: number;
  incidentes_abiertos: number; ocupacion: number; armada: boolean;
}
export interface Tablero {
  camaras: { total: number; en_linea: number };
  grabadores: { total: number; en_linea: number };
  incidentes: { abiertos: number; criticos: number; sin_reconocer: number };
  dispositivos: { total: number; en_alarma: number; abiertos: number };
  aforo_total: number;
  workers_en_linea: number;
  sedes: SedeTablero[];
  ultimos_eventos: Evento[];
}

// ── Sedes y agentes ────────────────────────────────────────────────────────
export interface Sede {
  id: string; nombre: string; oficina_ref: string | null; direccion: string | null; ciudad: string | null;
  lat: number | null; lng: number | null; policia_nombre: string | null; policia_telefono: string | null;
  activo: boolean;
  /** Solo salida. */
  camaras?: number; camaras_en_linea?: number; incidentes_abiertos?: number;
}

export type EstadoAgente = 'EN_LINEA' | 'FUERA_DE_LINEA' | 'NUNCA';
export interface EquipoDescubierto { ip: string; mac: string | null; marca: string | null; puertos: number[]; }
export interface Agente {
  id: string; sede_id: string; sede_nombre: string; nombre: string; estado: EstadoAgente;
  ultima_conexion: string | null; version: string | null; ip_publica: string | null; ip_lan: string | null;
  info: Record<string, unknown> | null; descubiertos: EquipoDescubierto[];
}
export interface TokenAgente { token: string; compose_yaml: string; env_file: string; instrucciones: string[]; }

// ── Grabadores ─────────────────────────────────────────────────────────────
export type TipoGrabador = 'DVR' | 'NVR' | 'CAMARA_IP';
export type MarcaGrabador = 'DAHUA' | 'HIKVISION' | 'UNIVIEW' | 'ZKTECO' | 'EZVIZ_IMOU' | 'ONVIF' | 'RTSP';
export type ConexionGrabador = 'DIRECTA' | 'AGENTE';
export interface Grabador {
  id: string; sede_id: string; sede_nombre: string; nombre: string; tipo: TipoGrabador; marca: MarcaGrabador;
  modelo: string | null; conexion: ConexionGrabador; agente_id: string | null; host: string | null;
  puerto_rtsp: number | null; puerto_http: number | null; usuario: string | null; tiene_clave: boolean;
  serial: string | null; canales: number | null; estado: EstadoConexion; ultimo_contacto: string | null;
  notas: string | null; activo: boolean; camaras: number;
}
/** Entrada: igual + `clave` (solo escritura; vacío = no cambia). */
export type GrabadorEntrada = Partial<Omit<Grabador, 'id' | 'sede_nombre' | 'tiene_clave' | 'estado' | 'ultimo_contacto' | 'camaras'>> & { clave?: string };
export interface ResultadoPrueba { ok: boolean; mensaje: string; latencia_ms: number | null; detalle: unknown; }
export interface ResultadoDescubrir { creadas: number; existentes: number; camaras: Camara[]; }

// ── Grupos y cámaras ───────────────────────────────────────────────────────
export interface Grupo { id: string; nombre: string; descripcion: string | null; color: string | null; orden: number; camaras: number; }

export type ModoGrabacion = 'NINGUNA' | 'EVENTOS' | 'CONTINUA';
export interface Camara {
  id: string; grabador_id: string | null; grabador_nombre: string | null; sede_id: string; sede_nombre: string;
  grupo_id: string | null; grupo_nombre: string | null; nombre: string; canal: number | null;
  url_principal: string | null; url_secundaria: string | null; ubicacion: string | null;
  croquis_oficina_ref: string | null; croquis_elemento_ref: string | null; ptz: boolean; audio_bidireccional: boolean;
  grabacion: ModoGrabacion; retencion_dias: number | null; analitica_activa: boolean; fps_analisis: number | null;
  estado: EstadoConexion; ultima_senal: string | null; orden: number; activo: boolean;
  ruta_sub: string | null; ruta_main: string | null;
}
export interface StreamCamara {
  camara_id: string; calidad: Calidad; ruta: string; whep_url: string | null; hls_url: string | null;
  token: string; expira_en: string | null; captura_url: string | null;
}
export type AccionPtz = 'ARRIBA' | 'ABAJO' | 'IZQUIERDA' | 'DERECHA' | 'ZOOM_MAS' | 'ZOOM_MENOS' | 'DETENER' | 'PRESET';
export interface OkMensaje { ok: boolean; mensaje: string; }

// ── Mosaicos, zonas y reglas ───────────────────────────────────────────────
export interface CeldaMosaico { pos: number; camara_id: string | null; }
export interface Mosaico {
  id: string; nombre: string; compartido: boolean; disposicion: Disposicion; celdas: CeldaMosaico[];
  rotacion_seg: number; orden: number;
}

export type TipoZona = 'ZONA' | 'LINEA';
export type SentidoLinea = 'AMBOS' | 'A_B' | 'B_A';
export type Punto = [number, number];
export interface Zona {
  id: string; camara_id: string; nombre: string; tipo: TipoZona; puntos: Punto[]; sentido: SentidoLinea;
  capacidad: number | null; color: string | null;
}

export type TipoRegla = 'INTRUSION' | 'CRUCE_LINEA' | 'AFORO' | 'MERODEO' | 'AGLOMERACION' | 'ROSTRO_ALERTA'
  | 'ROSTRO_DESCONOCIDO' | 'VEHICULO' | 'SIN_SENAL' | 'MANIPULACION' | 'PALABRA_CLAVE' | 'DISPOSITIVO';
/** Día 1 = lunes … 7 = domingo. `desde` > `hasta` = cruza la medianoche. */
export interface TramoHorario { dias: number[]; desde: string; hasta: string; }
export interface Regla {
  id: string; nombre: string; sede_id: string | null; camara_id: string | null; zona_id: string | null;
  tipo: TipoRegla; parametros: Record<string, unknown>; horario: TramoHorario[]; severidad: Severidad;
  protocolo_id: string | null; enfriamiento_seg: number; activo: boolean; armada_ahora?: boolean;
}

// ── Grabaciones ────────────────────────────────────────────────────────────
export interface Grabaciones {
  central: { inicio: string; duracion_seg: number }[];
  dvr: { soportado: boolean; mensaje: string | null };
}
export type FuenteReproduccion = 'CENTRAL' | 'DVR';
export interface Reproduccion {
  whep_url?: string | null; hls_url?: string | null; mp4_url?: string | null; token: string; expira_en: string | null;
}
export interface Clip {
  id: string; camara_id: string; camara_nombre: string; desde: string; hasta: string; url: string | null;
  motivo: string | null; incidente_id: string | null; creado_por_nombre: string | null; creado_en: string;
}

// ── Rostros ────────────────────────────────────────────────────────────────
export type TipoPersona = 'EMPLEADO' | 'VISITANTE' | 'VIP' | 'ALERTA' | 'OTRO';
export interface Persona {
  id: string; nombre: string; documento: string | null; tipo: TipoPersona; consentimiento_en: string | null;
  consentimiento_ref: string | null; soporte_legal: string | null; aprobado_por: string | null; notas: string | null;
  foto_url: string | null; activo: boolean; rostros: number; ultimo_avistamiento: string | null;
}
export interface Rostro { id: string; persona_id: string; calidad: number | null; foto_url: string | null; creado_en: string; }
export interface Avistamiento {
  id: string; persona_id: string | null; persona_nombre: string | null; persona_tipo: TipoPersona | null;
  camara_id: string; camara_nombre: string; sede_nombre: string; similitud: number | null;
  captura_url: string | null; ocurrido_en: string;
}

// ── Analítica ──────────────────────────────────────────────────────────────
export interface AforoZona {
  zona_id: string; nombre: string; camara_id: string; camara_nombre: string;
  ocupacion: number; capacidad: number | null; actualizado_en: string | null;
}
export interface AforoSede { sede_id: string; sede_nombre: string; ocupacion: number; capacidad: number | null; zonas: AforoZona[]; }
export interface Aforo { sedes: AforoSede[]; }
export interface PuntoConteo { t: string; entradas: number; salidas: number; ocupacion_max: number; personas: number; }
export interface Conteos {
  serie: PuntoConteo[];
  totales: { entradas: number; salidas: number; personas: number; pico: number; pico_en: string | null };
}
export interface Demografia {
  habilitada: boolean; total: number;
  rangos: { rango: string; hombres: number; mujeres: number; sin_dato: number }[];
}

// ── Domótica y accesos ─────────────────────────────────────────────────────
export type TipoDispositivo = 'PUERTA' | 'CERRADURA' | 'VENTANA' | 'CAJA_FUERTE' | 'BOTON_PANICO' | 'SIRENA'
  | 'SENSOR_MOVIMIENTO' | 'SENSOR_HUMO' | 'RELE' | 'LECTOR_ACCESO' | 'OTRO';
export type IntegracionId = 'SHELLY' | 'HOME_ASSISTANT' | 'MQTT' | 'ZKTECO_PUSH' | 'DAHUA_ALARMA' | 'HIKVISION_ALARMA'
  | 'TTLOCK' | 'TUYA' | 'WEBHOOK' | 'AGENTE';
export type EstadoDispositivo = 'ABIERTO' | 'CERRADO' | 'BLOQUEADO' | 'DESBLOQUEADO' | 'ACTIVO' | 'INACTIVO' | 'ALARMA' | 'DESCONOCIDO';
export type AccionDispositivo = 'ABRIR' | 'CERRAR' | 'BLOQUEAR' | 'DESBLOQUEAR' | 'ACTIVAR' | 'DESACTIVAR' | 'PULSO';
export interface Dispositivo {
  id: string; sede_id: string; sede_nombre: string; nombre: string; tipo: TipoDispositivo; integracion: IntegracionId;
  config: Record<string, unknown>; tiene_secreto: boolean; agente_id: string | null; camara_id: string | null;
  croquis_elemento_ref: string | null; estado: EstadoDispositivo; estado_en: string | null; bateria: number | null;
  en_linea: boolean; requiere_confirmacion: boolean; webhook_url: string | null; activo: boolean;
  acciones_disponibles: AccionDispositivo[];
}
export type DispositivoEntrada = Partial<Omit<Dispositivo, 'id' | 'sede_nombre' | 'tiene_secreto' | 'estado' | 'estado_en'
  | 'bateria' | 'en_linea' | 'webhook_url' | 'acciones_disponibles'>> & { secreto?: string };
export interface RespuestaAccion { ok: boolean; estado: EstadoDispositivo | null; mensaje: string; }
export interface AccionRegistrada {
  id: string; dispositivo_id: string; accion: AccionDispositivo; usuario_nombre: string | null; motivo: string | null;
  resultado: 'OK' | 'ERROR' | 'PENDIENTE'; detalle: string | null; creado_en: string;
}
export interface Acceso {
  id: string; dispositivo_id: string; dispositivo_nombre: string; documento: string | null; nombre: string | null;
  metodo: string | null; resultado: string | null; ocurrido_en: string;
}
export type TipoCampo = 'texto' | 'numero' | 'clave' | 'seleccion' | 'booleano';
export interface CampoIntegracion {
  clave: string; etiqueta: string; tipo: TipoCampo; requerido: boolean; ayuda: string | null;
  opciones?: (string | { valor: string; texto: string })[] | null;
}
export interface Integracion {
  id: string; nombre: string; categoria: 'VIDEO' | 'ACCESO' | 'DOMOTICA' | 'ALERTAS' | 'AUDIO'; descripcion: string;
  dificultad: 'FACIL' | 'MEDIA' | 'AVANZADA'; pasos: string[]; enlaces: { titulo: string; url: string }[];
  campos: CampoIntegracion[]; tipos_dispositivo: TipoDispositivo[]; acciones: AccionDispositivo[];
}

// ── Alertas ────────────────────────────────────────────────────────────────
export type TipoContacto = 'INTERNO' | 'POLICIA' | 'VIGILANCIA' | 'BOMBEROS' | 'AMBULANCIA' | 'OTRO';
export interface Contacto {
  id: string; nombre: string; tipo: TipoContacto; usuario_ref: string | null; whatsapp: string | null;
  telegram_chat: string | null; email: string | null; telefono: string | null; sede_id: string | null;
  notas: string | null; activo: boolean;
  /** Solo salida: el bot ya guardó el chat de esta persona (o grupo). */
  telegram_vinculado?: boolean;
}
/** POST /contactos/{id}/telegram: código de un solo uso para que la persona abra el bot. */
export interface VinculoTelegram { codigo: string; enlace: string; expira_en: string | null; instrucciones: string[]; }
export type Canal = 'APP' | 'EMAIL' | 'WHATSAPP' | 'TELEGRAM' | 'LLAMADA' | 'WEBHOOK' | 'PARLANTE' | 'SIRENA' | 'DISPOSITIVO';
export type ModoParlante = 'TEXTO' | 'DESCRIPCION_IA' | 'AUDIO';
export interface PasoProtocolo {
  orden: number;
  /** Segundos que se esperan DESPUÉS del paso anterior (el primero suele ser 0). */
  espera_seg: number;
  canales: Canal[]; contactos: string[]; roles: string[]; mensaje: string;
  parlante_modo: ModoParlante | null; parlante_texto: string | null; audio_id: string | null; parlantes: string[];
  dispositivos: { id: string; accion: AccionDispositivo }[];
}
export interface Protocolo {
  id: string; nombre: string; descripcion: string | null; pasos: PasoProtocolo[]; repetir_ultimo: boolean; activo: boolean;
}

export type EstadoIncidente = 'ABIERTO' | 'NOTIFICANDO' | 'RECONOCIDO' | 'EN_ATENCION' | 'CERRADO' | 'FALSA_ALARMA';
export interface Incidente {
  id: string; sede_id: string; sede_nombre: string; titulo: string; severidad: Severidad; estado: EstadoIncidente;
  protocolo_id: string | null; protocolo_nombre: string | null; paso_actual: number | null; pasos_total: number | null;
  proximo_paso_en: string | null; reconocido_por_nombre: string | null; reconocido_en: string | null;
  cerrado_por_nombre: string | null; cerrado_en: string | null; cierre_nota: string | null; eventos_count: number;
  captura_url: string | null; camara_id: string | null; creado_en: string; actualizado_en: string | null;
}
export interface EntradaBitacora {
  id: string; tipo: string; canal: string | null; destino: string | null; estado: string | null; detalle: string | null;
  usuario_nombre: string | null; creado_en: string;
}
export interface IncidenteDetalle extends Incidente { eventos: Evento[]; bitacora: EntradaBitacora[]; }
export interface NuevoIncidente {
  sede_id: string; titulo: string; severidad: Severidad; descripcion: string; camara_id?: string | null; protocolo_id?: string | null;
}

export type OrigenEvento = 'IA' | 'DVR' | 'DISPOSITIVO' | 'ZKTECO' | 'MANUAL' | 'SISTEMA' | 'AUDIO';
export interface Evento {
  id: string; sede_id: string | null; sede_nombre: string | null; camara_id: string | null; camara_nombre: string | null;
  dispositivo_id: string | null; dispositivo_nombre: string | null; regla_id: string | null; origen: OrigenEvento;
  tipo: string; severidad: Severidad; titulo: string; descripcion: string | null; datos: Record<string, unknown> | null;
  captura_url: string | null; clip_url: string | null; incidente_id: string | null; ocurrido_en: string;
}

// ── Audio ──────────────────────────────────────────────────────────────────
export type TipoParlante = 'NAVEGADOR' | 'CAMARA' | 'AGENTE';
export interface Parlante {
  id: string; sede_id: string; sede_nombre: string; nombre: string; tipo: TipoParlante; codigo: string;
  url_publica: string | null; camara_id: string | null; agente_id: string | null; volumen: number; microfono: boolean;
  transcribir: boolean; en_linea: boolean; ultima_conexion: string | null; croquis_elemento_ref: string | null; activo: boolean;
}
export interface TokenParlante { codigo: string; token: string; url: string; }
export type TipoAudio = 'LOCUCION' | 'EFECTO' | 'FONDO' | 'SUBIDO' | 'MEZCLA';
export interface Audio {
  id: string; nombre: string; tipo: TipoAudio; texto: string | null; voz_id: string | null; prompt: string | null;
  url: string | null; duracion_seg: number | null; creado_en: string;
}
export interface PedidoLocucion {
  nombre?: string; texto: string; voz_id?: string | null; modelo?: string | null; efecto_prompt?: string | null;
  fondo_audio_id?: string | null; volumen_fondo?: number; guardar?: boolean;
}
export interface PedidoReproducir { audio_id?: string; texto?: string; voz_id?: string | null; repetir?: number; volumen?: number; }
export interface SesionMedia { whip_url?: string; whep_url?: string; token: string; expira_en: string | null; }
export interface Transcripcion { id: string; parlante_id: string; texto: string; alertas: string[]; inicio: string; fin: string | null; }
export interface Voz { voice_id: string; nombre: string; idioma: string | null; }

// ── Ajustes, sistema, auditoría ────────────────────────────────────────────
export type ProveedorWhatsapp = 'NINGUNO' | 'META_CLOUD' | 'TWILIO' | 'GRANJA' | 'WEBHOOK';
export interface Ajustes {
  retencion_capturas_dias: number; retencion_eventos_dias: number; retencion_grabacion_dias: number;
  aviso_privacidad: string | null; rostros_habilitado: boolean; demografia_habilitada: boolean; umbral_rostro: number;
  palabras_clave: string[]; url_publica: string | null; whep_base: string | null; hls_base: string | null;
  whatsapp: { proveedor: ProveedorWhatsapp; configurado: boolean; origen: string | null };
  telegram: { configurado: boolean; bot_usuario?: string | null; ultimo_contacto?: string | null };
  twilio: { configurado: boolean; origen_voz: string | null };
  webhook: { url: string | null };
  email: { habilitado: boolean; remitente: string | null };
}
/** PUT /ajustes: lo mismo en plano + secretos de solo escritura (vacío = no cambia). */
export interface AjustesEntrada {
  retencion_capturas_dias?: number; retencion_eventos_dias?: number; retencion_grabacion_dias?: number;
  aviso_privacidad?: string | null; rostros_habilitado?: boolean; demografia_habilitada?: boolean; umbral_rostro?: number;
  palabras_clave?: string[]; url_publica?: string | null; whep_base?: string | null; hls_base?: string | null;
  whatsapp?: { proveedor: ProveedorWhatsapp; origen?: string | null };
  twilio?: { origen_voz?: string | null };
  email?: { habilitado: boolean; remitente?: string | null };
  whatsapp_token?: string; whatsapp_phone_id?: string; telegram_bot_token?: string; twilio_sid?: string; twilio_token?: string;
  twilio_whatsapp_from?: string; twilio_voz_from?: string; webhook_url?: string; webhook_secreto?: string;
}
export interface WorkerVision {
  nombre: string; host: string | null; gpu: string | null; proveedor: string | null; version: string | null;
  ultima_conexion: string | null; en_linea: boolean; camaras: number; fps: number | null; inferencia_ms: number | null;
  cpu: number | null; mem: number | null;
}
export interface Sistema {
  video: { en_linea: boolean; version: string | null; rutas: number | null; lectores: number | null; mensaje: string | null };
  workers: WorkerVision[];
  gpu_disponible: boolean;
  almacenamiento: { grabaciones_bytes: number | null; capturas_bytes: number | null; disco_libre_bytes: number | null };
}
export interface RegistroAuditoria {
  id: string; usuario_nombre: string | null; camara_id: string | null; camara_nombre: string | null; accion: string;
  detalle: string | null; ip: string | null; creado_en: string;
}

// ── Tiempo real (SSE /stream) ──────────────────────────────────────────────
export interface CambioDispositivo { id: string; estado: EstadoDispositivo; en_linea: boolean; bateria: number | null; }
export interface CambioCamara { id: string; estado: EstadoConexion; }
export interface CambioAforo { sede_id: string; zona_id: string | null; camara_id: string | null; ocupacion: number; }
export interface CambioParlante { id: string; en_linea: boolean; }

// ── Superficie pública ─────────────────────────────────────────────────────
export interface ConfigParlantePublico {
  id: string; nombre: string; sede_nombre: string; volumen: number; microfono: boolean; transcribir: boolean;
  mic_whip_url: string | null; token_video: string | null;
}
export interface SttToken { token: string; modelo: string | null; idioma: string | null; }
export interface Acuse {
  incidente: { titulo: string; severidad: Severidad; sede_nombre: string; estado: EstadoIncidente; creado_en: string };
  contacto_nombre: string | null; reconocido_por: string | null; captura_url: string | null;
}
export type AccionAcuse = 'RECONOCER' | 'VOY_EN_CAMINO' | 'FALSA_ALARMA';

// ── Catálogos para la interfaz (etiquetas en español) ──────────────────────
export const SEVERIDADES: Severidad[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA', 'INFO'];
export const NOMBRE_SEVERIDAD: Record<Severidad, string> = {
  CRITICA: 'Crítica', ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja', INFO: 'Informativa',
};
export const ICONO_SEVERIDAD: Record<Severidad, string> = {
  CRITICA: 'emergency_home', ALTA: 'warning', MEDIA: 'error', BAJA: 'info', INFO: 'info',
};
export const NOMBRE_ESTADO_INCIDENTE: Record<EstadoIncidente, string> = {
  ABIERTO: 'Abierto', NOTIFICANDO: 'Avisando', RECONOCIDO: 'Reconocido', EN_ATENCION: 'En atención',
  CERRADO: 'Cerrado', FALSA_ALARMA: 'Falsa alarma',
};
export const ESTADOS_ACTIVOS: EstadoIncidente[] = ['ABIERTO', 'NOTIFICANDO', 'RECONOCIDO', 'EN_ATENCION'];
export const NOMBRE_TIPO_REGLA: Record<TipoRegla, string> = {
  INTRUSION: 'Intrusión en zona', CRUCE_LINEA: 'Cruce de línea', AFORO: 'Aforo superado', MERODEO: 'Merodeo',
  AGLOMERACION: 'Aglomeración', ROSTRO_ALERTA: 'Rostro en lista de alerta', ROSTRO_DESCONOCIDO: 'Rostro desconocido',
  VEHICULO: 'Vehículo', SIN_SENAL: 'Cámara sin señal', MANIPULACION: 'Manipulación de cámara',
  PALABRA_CLAVE: 'Palabra clave en micrófono', DISPOSITIVO: 'Cambio de dispositivo',
};
export const NOMBRE_TIPO_DISPOSITIVO: Record<TipoDispositivo, string> = {
  PUERTA: 'Puerta', CERRADURA: 'Cerradura', VENTANA: 'Ventana', CAJA_FUERTE: 'Caja fuerte', BOTON_PANICO: 'Botón de pánico',
  SIRENA: 'Sirena', SENSOR_MOVIMIENTO: 'Sensor de movimiento', SENSOR_HUMO: 'Sensor de humo', RELE: 'Relé',
  LECTOR_ACCESO: 'Lector de acceso', OTRO: 'Otro',
};
export const ICONO_TIPO_DISPOSITIVO: Record<TipoDispositivo, string> = {
  PUERTA: 'door_front', CERRADURA: 'lock', VENTANA: 'window', CAJA_FUERTE: 'inventory_2', BOTON_PANICO: 'e911_emergency',
  SIRENA: 'campaign', SENSOR_MOVIMIENTO: 'sensors', SENSOR_HUMO: 'detector_smoke', RELE: 'toggle_on',
  LECTOR_ACCESO: 'fingerprint', OTRO: 'devices_other',
};
export const NOMBRE_ESTADO_DISPOSITIVO: Record<EstadoDispositivo, string> = {
  ABIERTO: 'Abierto', CERRADO: 'Cerrado', BLOQUEADO: 'Bloqueado', DESBLOQUEADO: 'Desbloqueado', ACTIVO: 'Activo',
  INACTIVO: 'Inactivo', ALARMA: 'En alarma', DESCONOCIDO: 'Sin dato',
};
export const NOMBRE_ACCION: Record<AccionDispositivo, string> = {
  ABRIR: 'Abrir', CERRAR: 'Cerrar', BLOQUEAR: 'Bloquear', DESBLOQUEAR: 'Desbloquear', ACTIVAR: 'Activar',
  DESACTIVAR: 'Desactivar', PULSO: 'Pulso',
};
export const ICONO_ACCION: Record<AccionDispositivo, string> = {
  ABRIR: 'lock_open', CERRAR: 'lock', BLOQUEAR: 'lock', DESBLOQUEAR: 'lock_open', ACTIVAR: 'power_settings_new',
  DESACTIVAR: 'power_off', PULSO: 'bolt',
};
export const NOMBRE_CANAL: Record<Canal, string> = {
  APP: 'App', EMAIL: 'Correo', WHATSAPP: 'WhatsApp', TELEGRAM: 'Telegram', LLAMADA: 'Llamada', WEBHOOK: 'Webhook',
  PARLANTE: 'Parlante', SIRENA: 'Sirena', DISPOSITIVO: 'Dispositivo',
};
export const ICONO_CANAL: Record<Canal, string> = {
  APP: 'notifications', EMAIL: 'mail', WHATSAPP: 'chat', TELEGRAM: 'send', LLAMADA: 'call', WEBHOOK: 'webhook',
  PARLANTE: 'campaign', SIRENA: 'e911_emergency', DISPOSITIVO: 'settings_remote',
};
/** Telegram va primero entre la mensajería: es el canal principal por ahora (decisión del 11-oct). */
export const CANALES: Canal[] = ['APP', 'EMAIL', 'TELEGRAM', 'WHATSAPP', 'LLAMADA', 'WEBHOOK', 'PARLANTE', 'SIRENA', 'DISPOSITIVO'];
export const NOMBRE_TIPO_CONTACTO: Record<TipoContacto, string> = {
  INTERNO: 'Interno', POLICIA: 'Policía', VIGILANCIA: 'Vigilancia', BOMBEROS: 'Bomberos', AMBULANCIA: 'Ambulancia', OTRO: 'Otro',
};
export const NOMBRE_TIPO_PERSONA: Record<TipoPersona, string> = {
  EMPLEADO: 'Empleado', VISITANTE: 'Visitante', VIP: 'VIP', ALERTA: 'Lista de alerta', OTRO: 'Otro',
};
export const NOMBRE_TIPO_AUDIO: Record<TipoAudio, string> = {
  LOCUCION: 'Locución', EFECTO: 'Efecto', FONDO: 'Fondo', SUBIDO: 'Subido', MEZCLA: 'Mezcla',
};
export const NOMBRE_MARCA: Record<MarcaGrabador, string> = {
  DAHUA: 'Dahua', HIKVISION: 'Hikvision', UNIVIEW: 'Uniview', ZKTECO: 'ZKTeco', EZVIZ_IMOU: 'EZVIZ / Imou',
  ONVIF: 'ONVIF genérico', RTSP: 'RTSP manual',
};
export const NOMBRE_ORIGEN: Record<OrigenEvento, string> = {
  IA: 'IA visual', DVR: 'Grabador', DISPOSITIVO: 'Dispositivo', ZKTECO: 'ZKTeco', MANUAL: 'Manual', SISTEMA: 'Sistema', AUDIO: 'Audio',
};
export const DIAS_SEMANA: { n: number; corto: string; largo: string }[] = [
  { n: 1, corto: 'Lun', largo: 'Lunes' }, { n: 2, corto: 'Mar', largo: 'Martes' }, { n: 3, corto: 'Mié', largo: 'Miércoles' },
  { n: 4, corto: 'Jue', largo: 'Jueves' }, { n: 5, corto: 'Vie', largo: 'Viernes' }, { n: 6, corto: 'Sáb', largo: 'Sábado' },
  { n: 7, corto: 'Dom', largo: 'Domingo' },
];

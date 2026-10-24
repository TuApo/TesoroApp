/**
 * Contratos del trabajo de campo (ms-comunicaciones `/api/v1/comunicaciones/campo/**`).
 * El backend sirve snake_case. Las horas del dispositivo viajan en epoch ms.
 */

export type PerfilCampo = 'COORDINADOR' | 'SUPERVISOR' | 'ADMIN';
export type TipoMarcacion = 'ENTRADA' | 'SALIDA';
export type FuenteUbicacion = 'GPS' | 'RED' | 'MAPA' | 'NINGUNA';
export type EstadoRostro = 'PENDIENTE' | 'VALIDADA' | 'NO_COINCIDE' | 'SIN_REFERENCIA' | 'SIN_SELFIE' | 'ERROR' | 'APROBADA_MANUAL';
export type EstadoVisita = 'PROGRAMADA' | 'EN_CURSO' | 'CUMPLIDA' | 'INCUMPLIDA' | 'CANCELADA';
export type Conexion = 'EN_LINEA' | 'RECIENTE' | 'SIN_SENAL' | 'NUNCA';

export interface PersonaMin { id: string; nombre: string; tiene_foto: boolean }

export interface Zona {
  id: number; nombre: string; color: string; descripcion: string | null; sede: string | null;
  activa: boolean; fincas: number; coordinadores: number;
}

export interface Finca {
  id: number; clave: string; nombre: string; zona_id: number | null; zona_nombre: string | null; zona_color: string | null;
  lat: number | null; lon: number | null; radio_m: number; direccion: string | null; notas: string | null; activa: boolean;
  ubicacion_origen: string | null; qr_huella: string; qr_version: number; coordinadores: PersonaMin[];
  propuesta_lat: number | null; propuesta_lon: number | null; propuesta_por_nombre: string | null; mia: boolean;
}

export interface Marcacion {
  id: string; usuario_id: string; usuario_nombre: string; finca_id: number | null; finca_nombre: string | null;
  visita_id: number | null; tipo: TipoMarcacion; metodo: 'QR' | 'MANUAL'; qr_ok: boolean;
  lat: number | null; lon: number | null; precision_m: number | null; fuente_ubicacion: FuenteUbicacion;
  distancia_m: number | null; dentro: boolean | null; capturado_ms: number; recibido_ms: number; sin_conexion: boolean;
  selfie_url: string | null; rostro_estado: EstadoRostro; rostro_confianza: number | null; rostro_motivo: string | null;
  bateria: number | null; nota: string | null; alertas: string[];
}

export interface Visita {
  id: number; coordinador_id: string; coordinador_nombre: string; finca_id: number; finca_nombre: string;
  finca_lat: number | null; finca_lon: number | null; fecha: string; hora_inicio: string | null; hora_fin: string | null;
  objetivo: string | null; notas: string | null; estado: EstadoVisita; entrada_id: string | null; salida_id: string | null;
  entrada_ms: number | null; salida_ms: number | null; creado_por: string; creado_por_nombre: string; tareas_pendientes: number;
}

export interface Tarea {
  id: number; asignado_a: string; asignado_nombre: string; finca_id: number | null; finca_nombre: string | null;
  visita_id: number | null; titulo: string; detalle: string | null; vence: string | null; prioridad: 'BAJA' | 'MEDIA' | 'ALTA';
  estado: 'PENDIENTE' | 'HECHA' | 'CANCELADA'; nota_cierre: string | null; hecha_ms: number | null;
  creado_por: string; creado_por_nombre: string; vencida: boolean;
}

export interface Canal {
  id: number; nombre: string; alcance: 'TODOS' | 'ZONA' | 'MANUAL'; zona_id: number | null;
  conversacion_id: string; miembros: number; en_linea: number;
}

export interface ConfigCampo {
  intervalo_posicion_seg: number; radio_defecto_m: number; tiles_url: string; tiles_atribucion: string;
  tiles_max_descarga: number; sin_senal_min: number; agenda_propia: boolean; rostro_habilitado: boolean;
}

export interface Paquete {
  usuario_id: string; nombre: string; perfil: PerfilCampo; cargo_campo: string; jefe_id: string | null; jefe_nombre: string | null;
  fincas: Finca[]; agenda: Visita[]; tareas: Tarea[]; canales: Canal[]; zonas: Zona[]; marcacion_abierta: Marcacion | null;
  rostro_referencia: 'PROPUESTA' | 'APROBADA' | null; config: ConfigCampo; generado_ms: number;
}

export interface EstadoPersona {
  usuario_id: string; nombre: string; cargo_campo: string; jefe_id: string | null; zona_id: number | null; tiene_foto: boolean;
  lat: number | null; lon: number | null; precision_m: number | null; posicion_ms: number | null; recibido_ms: number | null;
  bateria: number | null; red: string | null; plataforma: string | null; conexion: Conexion;
  finca_actual_id: number | null; finca_actual_nombre: string | null; ultima_marcacion: Marcacion | null;
  visitas_hoy: number; visitas_cumplidas_hoy: number; tareas_pendientes: number; alertas: number;
}

export interface Tablero {
  personas: EstadoPersona[]; visitas_hoy: Visita[]; fincas: Finca[]; zonas: Zona[];
  resumen: {
    personas: number; en_linea: number; sin_senal: number; en_finca: number; visitas_hoy: number;
    visitas_cumplidas: number; visitas_pendientes: number; alertas_rostro: number; fincas_sin_ubicar: number;
  };
}

export interface Miembro {
  usuario_id: string; nombre: string; rol: string | null; cargo: string | null; cargo_campo: string; jefe_id: string | null;
  jefe_nombre: string | null; zona_id: number | null; zona_nombre: string | null; tiene_foto: boolean; subordinados: number;
  fincas: number[]; rostro_referencia: string | null; en_jerarquia: boolean;
}

export interface Rastro { usuario_id: string; puntos: [number, number, number, number][]; marcaciones: Marcacion[] }

/** Lo que el teléfono guarda para mandar cuando vuelva la señal. */
export type ElementoCola =
  | { id: string; tipo: 'marcacion'; creado_ms: number; intentos: number; error?: string; datos: MarcacionPendiente; selfie?: Blob }
  | { id: string; tipo: 'tarea'; creado_ms: number; intentos: number; error?: string; datos: { tarea_id: number; estado: string; nota?: string; hecha_ms: number } }
  | { id: string; tipo: 'radio'; creado_ms: number; intentos: number; error?: string; datos: { canal_id: number; duracion_ms: number; grabado_ms: number }; audio: Blob };

export interface MarcacionPendiente {
  id: string; finca_id: number | null; tipo: TipoMarcacion; qr_contenido: string | null;
  lat: number | null; lon: number | null; precision_m: number | null; fuente_ubicacion: FuenteUbicacion;
  capturado_ms: number; sin_conexion: boolean; dispositivo: string; bateria: number | null; nota: string | null;
  /** Para pintarla mientras espera (no viaja al servidor). */
  finca_nombre?: string | null; distancia_m?: number | null; dentro?: boolean | null; qr_ok_local?: boolean | null;
}

export interface Punto { lat: number; lon: number; precision_m: number | null; capturado_ms: number; sin_conexion?: boolean }

export interface VisitaHistorica {
  id: number; submission_id: number; fecha: string; coordinador_nombre: string; coordinador_id: string | null;
  oficina: string | null; tipo: 'FINCA' | 'OFICINA' | 'CONVOCATORIA'; finca_texto: string; finca_id: number | null;
  finca_nombre: string | null; evidencia_documento_id: number | null; resumen_json: string | null; origen: 'GOOGLE_FORMS' | 'PLATAFORMA';
}

export interface ConteoHistorico { clave: string; nombre: string; visitas: number; ultima: string }

export interface Historico {
  total: number; pagina: number; tamano: number; filas: VisitaHistorica[];
  por_finca: ConteoHistorico[]; por_coordinador: ConteoHistorico[]; por_mes: ConteoHistorico[];
}

export const ETIQUETA_ALERTA: Record<string, string> = {
  QR_INVALIDO: 'QR inválido',
  SIN_QR: 'Sin QR',
  SIN_FINCA: 'Sin finca',
  FUERA_DE_LA_FINCA: 'Fuera de la finca',
  FINCA_SIN_UBICAR: 'Finca sin ubicar',
  SIN_UBICACION: 'Sin ubicación',
  UBICACION_ELEGIDA_EN_MAPA: 'Punto elegido en el mapa',
  ROSTRO_NO_COINCIDE: 'Rostro no coincide',
  SIN_SELFIE: 'Sin selfie',
  HORA_DESFASADA: 'Hora del teléfono corrida',
};

export const ETIQUETA_ROSTRO: Record<EstadoRostro, string> = {
  PENDIENTE: 'Validando rostro',
  VALIDADA: 'Rostro validado',
  NO_COINCIDE: 'Rostro no coincide',
  SIN_REFERENCIA: 'Sin foto de referencia',
  SIN_SELFIE: 'Sin selfie',
  ERROR: 'No se pudo validar',
  APROBADA_MANUAL: 'Aprobada por supervisor',
};

export const ETIQUETA_VISITA: Record<EstadoVisita, string> = {
  PROGRAMADA: 'Programada', EN_CURSO: 'En curso', CUMPLIDA: 'Cumplida', INCUMPLIDA: 'Incumplida', CANCELADA: 'Cancelada',
};

export const ETIQUETA_CONEXION: Record<Conexion, string> = {
  EN_LINEA: 'En línea', RECIENTE: 'Con señal', SIN_SENAL: 'Sin señal', NUNCA: 'Nunca ha reportado',
};

/** Contrato de ms-seguimiento (/api/v1/seguimiento/actividad e /informes), snake_case. */

export interface Alcance { total: boolean; por_sede: boolean; supervisa: boolean; yo: string }

export interface PersonaFila {
  usuario_id: string;
  nombre: string;
  correo: string | null;
  rol: string | null;
  sede: string | null;
  activo: boolean;
  tiene_foto: boolean;
  peticiones?: number;
  cambios?: number;
  errores?: number;
  dias?: number;
  pantallas?: number;
  ingresos?: number;
  ingresos_fallidos?: number;
  ultimo_ingreso?: string | null;
  tareas_creadas?: number;
  tareas_completadas?: number;
  mensajes_recibidos?: number;
  mensajes_enviados?: number;
  por_responder?: number;
  ultima_actividad: string | null;
}

export interface Personas { items: PersonaFila[]; total: number; alcance: 'TOTAL' | 'SEDE' | 'PROPIO'; roles: string[]; sedes: string[] }

export interface Sesion { inicio: string; fin: string; minutos: number; acciones: number; cambios: number; ips: string; dispositivo: string | null; fuera_de_horario: boolean }

export interface Ficha {
  persona: { id: string; nombre: string; correo: string; documento: string; rol: string; sede: string; sedes: string[]; empresa: string; activo: boolean; tiene_foto: boolean };
  desde: string;
  hasta: string;
  kpi: {
    peticiones: number; consultas: number; creaciones: number; ediciones: number; borrados: number; errores: number; denegados: number;
    dias_activos: number; primera: string | null; ultima: string | null; ips: number; ingresos: number; ingresos_fallidos: number;
    ultimo_ingreso: string | null; pantallas: number; sesiones: number; minutos_activos: number; fuera_de_horario: number;
  };
  sesiones: Sesion[];
  por_modulo: { modulo: string; total: number; cambios: number; errores: number; ultima: string }[];
  top_acciones: { modulo: string; accion: string; tipo: string; veces: number; ultima: string }[];
  cambios_recientes: { ocurrido_en: string; modulo: string; accion: string; tipo: string; metodo: string; ruta: string; estado: number }[];
  pantallas_top: { pantalla: string; modulo: string; veces: number; segundos: number }[];
  por_dia: { dia: string; peticiones: number; cambios: number; pantallas: number }[];
  por_hora: { dia_semana: number; hora: number; total: number }[];
  tareas: { creadas: number; completadas: number; abiertas: number; vencidas: number;
    lista: { id: number; titulo: string; estado: string; prioridad: string; vence: string | null; completada: string | null; creada: string; la_creo: boolean | number; asignada: boolean | number; origen_tipo: string | null }[] };
  comunicaciones: {
    cuentas: number;
    bandeja?: Record<string, number | null>;
    periodo?: { mensajes_recibidos: number; mensajes_enviados: number; respuestas: number; sin_respuesta: number; respuesta_media_min: number | null; respuesta_mediana_min: number | null };
    chat_interno?: { mensajes: number; conversaciones: number };
  };
  fuentes: { clave: string; nombre: string }[];
}

export interface ItemLinea {
  fecha: string;
  fuente: string;
  modulo: string | null;
  tipo: string | null;
  accion: string | null;
  detalle: string | null;
  ref: string | null;
  link: string | null;
  estado: number | null;
}

export interface Linea { items: ItemLinea[]; siguiente: string | null }

export interface InformeResumen {
  id: string;
  tipo: 'PERSONA' | 'EQUIPO' | 'PLATAFORMA';
  sujeto_id: string | null;
  sujeto_nombre: string | null;
  desde: string;
  hasta: string;
  titulo: string | null;
  enfoque: string | null;
  estado: 'PENDIENTE' | 'EN_CURSO' | 'LISTO' | 'ERROR';
  anterior_id: string | null;
  programado: boolean | number;
  creado_por: string | null;
  creado_por_nombre: string | null;
  creado_en: string;
  terminado_en: string | null;
  preguntas?: number;
}

export interface Informe extends InformeResumen {
  contenido: string | null;
  error: string | null;
  modelo: string | null;
  mensajes: { id: number; rol: 'USUARIO' | 'ASISTENTE'; contenido: string | null; estado: string; creado_en: string }[];
  versiones: { id: string; titulo: string; desde: string; hasta: string; estado: string; creado_en: string }[];
}

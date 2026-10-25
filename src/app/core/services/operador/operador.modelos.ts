/**
 * Asistente operador: tipos del API de ms-ai `/api/v1/ai/operador/**` (JSON en camelCase).
 * La conversación en sí va por el chat estándar (`/api/v1/ai/chat`) con el módulo 'operador'.
 */

export type AppOperador = 'tesoro' | 'economiapp';

export interface PerfilOperador {
  usuarioId: string;
  admin: boolean;
  modoDesarrollador: boolean;
  modoDesarrolladorHasta: string | null;
  iaDisponible: boolean;
  voz: boolean;
  conversacionId: number | null;
  /** Personalidad que la persona dejó por defecto: 'auto', 'directa'… o 'p:<id>'. */
  personalidad?: string;
}

export type EstiloRespuesta = 'auto' | 'directa' | 'analitica' | 'ejecutiva' | 'didactica' | 'conversacional';
export type TonoRespuesta = 'cercano' | 'formal' | 'neutral' | 'motivador';
export type LongitudRespuesta = 'corta' | 'media' | 'detallada';

/** Personalidad del asistente: predefinida (clave = estilo) o propia (clave = 'p:<id>'). */
export interface PersonalidadOperador {
  clave: string;
  id: number | null;
  nombre: string;
  descripcion: string | null;
  estilo: EstiloRespuesta;
  tono: TonoRespuesta;
  longitud: LongitudRespuesta;
  instrucciones: string | null;
  voz: string | null;
  icono: string | null;
  color: string | null;
  propia: boolean;
}

export interface CatalogoPersonalidades {
  predefinidas: PersonalidadOperador[];
  propias: PersonalidadOperador[];
  activa: string;
  estilos: EstiloRespuesta[];
  tonos: TonoRespuesta[];
  longitudes: LongitudRespuesta[];
  voces: string[];
}

export interface NuevaPersonalidad {
  nombre: string;
  descripcion?: string | null;
  estilo: EstiloRespuesta;
  tono: TonoRespuesta;
  longitud: LongitudRespuesta;
  instrucciones?: string | null;
  voz?: string | null;
  icono?: string | null;
  color?: string | null;
}

export type TipoTarea = 'NAVEGACION' | 'CONSULTA' | 'DOCUMENTO' | 'RECORDATORIO' | 'TAREA' | 'AUTOMATIZACION' | 'DESARROLLO';
export type EstadoTarea = 'PENDIENTE' | 'EN_CURSO' | 'HECHA' | 'ERROR' | 'CANCELADA';

export interface TareaOperador {
  id: number;
  tipo: TipoTarea;
  titulo: string;
  detalle: string | null;
  estado: EstadoTarea;
  resultado: string | null;
  referencia: string | null;
  venceEn: string | null;
  conversacionId: number | null;
  automatizacionId?: number | null;
  creadoEn: string;
  actualizadoEn: string;
  /** Solo al crear desde el panel: el módulo Tareas no respondió y quedó solo en el historial. */
  aviso?: string;
}

export type PrioridadTarea = 'baja' | 'media' | 'alta' | 'urgente';

export interface NuevaTarea {
  titulo: string;
  detalle?: string | null;
  venceEn?: string | null;
  prioridad?: PrioridadTarea | null;
  responsableId?: string | null;
  responsableNombre?: string | null;
}

/** Una persona de la plataforma (para elegir responsable). */
export interface PersonaPlataforma {
  id: string;
  nombre: string;
  correo: string | null;
  documento: string | null;
}

export interface PaginaTareas {
  total: number;
  pagina: number;
  paginas: number;
  tareas: TareaOperador[];
}

export type Disparador = 'HORARIO' | 'AL_INGRESAR' | 'AL_ABRIR_RUTA' | 'MANUAL';
export type DiaSemana = 'LUN' | 'MAR' | 'MIE' | 'JUE' | 'VIE' | 'SAB' | 'DOM';
export const DIAS_SEMANA: DiaSemana[] = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'];

export interface Automatizacion {
  id: number;
  nombre: string;
  instruccion: string;
  disparador: Disparador;
  cron: string | null;
  descripcionHorario: string | null;
  ruta: string | null;
  activa: boolean;
  ultimaEjecucion: string | null;
  proximaEjecucion: string | null;
  ejecuciones: number;
  ultimoEstado: string | null;
  ultimoResultado: string | null;
  conversacionId: number | null;
  creadoEn: string;
}

export interface NuevaAutomatizacion {
  nombre: string;
  instruccion: string;
  disparador: Disparador;
  hora?: string;
  dias?: DiaSemana[];
  ruta?: string;
}

/** Plantilla lista para usar del módulo Automatizaciones IA. */
export interface PlantillaAutomatizacion {
  id: string;
  categoria: string;
  icono: string;
  nombre: string;
  descripcion: string;
  instruccion: string;
  disparador: Disparador;
  hora?: string;
  dias?: DiaSemana[];
  ruta?: string;
  /** Prefijo de ruta que la persona debe poder abrir para que le sirva ('' = cualquiera). */
  requiere: string;
}

export interface EjecucionAutomatizacion {
  omitida: boolean;
  conversacionId?: number;
  mensajeId?: number;
}

/** Tarea del puente de agentes (modo desarrollador). Viene tal cual del puente. */
export interface TareaDesarrollo {
  id: string;
  titulo?: string;
  objetivo?: string;
  estado?: string;
  creada?: number;
  actualizada?: number;
  resumen?: string;
  [k: string]: unknown;
}

/** Lo que el asistente le pide a la pantalla junto con su respuesta. */
export type AccionOperador =
  | { tipo: 'navegar'; ruta: string; etiqueta?: string }
  | { tipo: 'enlace'; ruta: string; etiqueta?: string }
  | { tipo: 'tareas_actualizadas' }
  | { tipo: 'automatizaciones_actualizadas' }
  | { tipo: 'desarrollo'; tareaId: string }
  /** Frase con que la IA anuncia lo que va a hacer: se dice en voz alta mientras actúa. */
  | { tipo: 'decir'; texto: string; ronda?: number }
  /** Archivo generado a mitad del turno: aparece antes de la respuesta final. */
  | { tipo: 'archivo'; archivo: import('../../../shared/components/chat-ia/chat-ia.modelos').ArchivoChat }
  /**
   * La IA pide ejecutar una herramienta de la pantalla (estilo WebMCP). `__listar` = devolver las
   * herramientas de la pantalla abierta. `confirmar`: tiene consecuencias, la persona confirma.
   */
  | { tipo: 'herramienta'; id: string; nombre: string; titulo?: string; args?: Record<string, unknown>; confirmar?: boolean };

/** Respuesta de la pantalla a una herramienta que pidió la IA. */
export interface ResultadoHerramienta {
  ok: boolean;
  resultado?: unknown;
  error?: string;
  cancelada?: boolean;
}

/**
 * Cómo se ve la ventana del asistente: flotante (se mueve y se redimensiona), acoplada (cajón a
 * la derecha, modo chat) o compacta (cápsula de voz que no tapa la pantalla mientras opera).
 * Minimizada = cerrada en la pestaña del dock o el orbe.
 */
export type VistaOperador = 'flotante' | 'acoplado' | 'compacto';

/** Qué hace la voz ahora: lo pinta la pestaña del dock y el orbe. */
export type EstadoVozOperador = 'inactivo' | 'escuchando' | 'pensando' | 'hablando';

/** Una pantalla a la que el asistente puede llevar a la persona. */
export interface DestinoNavegacion {
  nombre: string;
  ruta: string;
  jerarquia: string;
}

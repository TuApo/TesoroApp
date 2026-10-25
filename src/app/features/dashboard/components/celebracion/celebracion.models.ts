/**
 * Contrato de la celebración de cumpleaños (ms-marketing, /api/v1/marketing/celebraciones).
 *
 * Como el carrusel, el backend responde en snake_case escrito a mano y acepta snake_case:
 * aquí todo va en snake_case, sin traducción en medio.
 */

/** Motores de animación. Cada uno es código de `celebracion-escena`; las plantillas son datos. */
export type Animacion = 'CONFETI' | 'GLOBOS' | 'FUEGOS' | 'GALA' | 'POLAROID' | 'PASTEL';
export type Tipografia = 'FESTIVA' | 'ELEGANTE' | 'MANUSCRITA' | 'CONDENSADA' | 'MARCA';

export interface PlantillaCelebracion {
  id: string;
  codigo: string;
  nombre: string;
  animacion: Animacion;
  tipografia: Tipografia;
  color_fondo: string;
  color_fondo_2: string;
  color_texto: string;
  color_acento: string;
  color_acento_2: string;
  /** 5 a 10. */
  duracion_segundos: number;
  /** Fondo animado (video en bucle + póster), horizontal y vertical. Null = sin video. */
  fondo?: FondoCelebracion | null;
}

/** URLs relativas a apiUrl (públicas, sin firma: es decorado igual para todos). */
export interface FondoCelebracion {
  video_h: string;
  video_v: string;
  imagen_h: string;
  imagen_v: string;
}

/** La plantilla tal como la administra Marketing. */
export interface PlantillaCelebracionAdmin extends PlantillaCelebracion {
  descripcion?: string | null;
  titulo: string;
  mensaje?: string | null;
  mensaje_personal?: string | null;
  orden: number;
  sistema: boolean;
  activo: boolean;
  /** Nombre del juego de fondo animado (confeti_marca…). Null = sin video. */
  fondo_nombre?: string | null;
}

export interface PersonaCelebrada {
  id: string;
  nombre: string;
  primer_nombre: string;
  cargo?: string | null;
  dedicatoria?: string | null;
  /** Relativa a apiUrl y firmada: va tal cual a un <img>. Null = iniciales. */
  foto_url?: string | null;
  enfoque_x: number;
  enfoque_y: number;
  es_usted?: boolean;
  /** Las más votadas por el equipo (máx. 4). */
  etiquetas?: { nombre: string; emoji: string }[];
  /** El mensaje de su jefe, firmado. */
  mensaje_jefe?: string | null;
  mensaje_jefe_firma?: string | null;
  /** Su fondo personal hecho con IA y aprobado por Marketing (null = el de la plantilla). */
  fondo?: FondoPersonal | null;
}

/** URLs firmadas, relativas a apiUrl. Los videos son opcionales (si se pidió animar). */
export interface FondoPersonal {
  imagen_h: string;
  imagen_v: string;
  video_h?: string;
  video_v?: string;
}

/** Lo que pinta la escena. */
export interface CelebracionDelDia {
  fecha: string;
  ya_vista?: boolean;
  vista_previa?: boolean;
  superficie?: string;
  plantilla: PlantillaCelebracion | null;
  titulo?: string | null;
  mensaje?: string | null;
  es_cumpleanero?: boolean;
  saludo_personal?: string | null;
  mensaje_personal?: string | null;
  personas: PersonaCelebrada[];
}

// ── administración ─────────────────────────────────────────────────────────

export interface PersonaCelebradaAdmin extends PersonaCelebrada {
  fecha: string;
  documento?: string | null;
  jefe_nombre?: string | null;
  jefe_documento?: string | null;
  enlace_aportes?: string | null;
  /** Lo más avanzado de su pieza con IA: SOLICITADA | GENERANDO | LISTA | APROBADA | null. */
  estado_ia?: EstadoPieza | null;
  foto?: { ancho: number; alto: number; tamano_bytes: number } | null;
  superficies: string[];
  orden: number;
  creado_en?: string;
}

export interface DiaCelebracion {
  fecha: string;
  es_hoy: boolean;
  pasado: boolean;
  /** La elegida; null = rota sola. */
  plantilla_id: string | null;
  plantilla_efectiva: { id: string; nombre: string; animacion: Animacion } | null;
  rotacion: boolean;
  titulo: string | null;
  mensaje: string | null;
  vistas: number;
  cerradas_antes: number;
  personas: PersonaCelebradaAdmin[];
}

export interface CalendarioCelebraciones {
  hoy: string;
  desde: string;
  hasta: string;
  dias: DiaCelebracion[];
}

export interface PeticionPersona {
  fecha: string;
  nombre: string;
  jefe_nombre?: string | null;
  jefe_documento?: string | null;
  mensaje_jefe?: string | null;
  mensaje_jefe_firma?: string | null;
  cargo?: string | null;
  documento?: string | null;
  dedicatoria?: string | null;
  enfoque_x?: number;
  enfoque_y?: number;
  superficies?: string[];
  orden?: number;
}

export interface CatalogoCelebraciones {
  animaciones: Animacion[];
  tipografias: Tipografia[];
  fondos: string[];
  superficies: { valor: string; nombre: string }[];
  limites: {
    min_segundos: number;
    max_segundos: number;
    max_personas_dia: number;
    max_foto_mb: number;
    min_lado_foto: number;
    max_dias_adelante: number;
  };
}

// ── personalización con IA (etiquetas del equipo + mensaje del jefe) ───────

export type EstadoPieza = 'SOLICITADA' | 'GENERANDO' | 'LISTA' | 'APROBADA' | 'DESCARTADA' | 'FALLIDA';

export interface EtiquetaCelebracion {
  id: string;
  nombre: string;
  emoji?: string | null;
  categoria: string;
  /** Solo en administración. */
  prompt_visual?: string;
  orden?: number;
  sistema?: boolean;
  activo?: boolean;
  votos?: number;
}

/** Lo que ve quien abre el enlace de aportes. */
export interface AporteCumpleanos {
  persona: { nombre: string; primer_nombre: string; cargo: string; fecha: string; foto_url: string; enfoque_x: number; enfoque_y: number };
  abierta: boolean;
  max_etiquetas: number;
  etiquetas: EtiquetaCelebracion[];
  /** etiqueta_id → votos. */
  conteo: Record<string, number>;
  personas_votaron: number;
  mis_etiquetas: string[];
  es_jefe: boolean;
  jefe_nombre?: string | null;
  tiene_mensaje_jefe: boolean;
  mensaje_jefe?: string | null;
  mensaje_jefe_firma?: string | null;
}

export interface PiezaCelebracion {
  id: string;
  orientacion: 'H' | 'V';
  tipo: 'IMAGEN' | 'VIDEO';
  estado: EstadoPieza;
  origen?: string | null;
  error?: string | null;
  prompt?: string | null;
  modelo?: string | null;
  url?: string | null;
  ancho?: number | null;
  alto?: number | null;
  creado_en?: string;
}

export interface PersonalizacionCumpleanos {
  enlace: string | null;
  etiquetas: EtiquetaCelebracion[];
  personas_votaron: number;
  jefe_nombre?: string | null;
  jefe_documento?: string | null;
  mensaje_jefe?: string | null;
  mensaje_jefe_firma?: string | null;
  higgsfield_configurado: boolean;
  piezas: PiezaCelebracion[];
}

// ── quién la vio (ms-marketing V20) ────────────────────────────────────────

/** Una persona que vio la celebración un día (la web y la app juntas). */
export interface QuienVio {
  usuario_id: string;
  /** Null en vistas de antes de V20 que no se pudieron completar. */
  nombre: string | null;
  correo: string | null;
  documento: string | null;
  rol: string | null;
  /** La vio la propia persona que cumple (por cédula). */
  es_cumpleanero: boolean;
  superficies: string[];
  veces: number;
  cerrada_antes: boolean;
  primer_en: string | null;
  ultimo_en: string | null;
}

export interface VistasDia {
  fecha: string;
  total: number;
  cerradas_antes: number;
  cumpleaneros_la_vieron: number;
  personas: QuienVio[];
}

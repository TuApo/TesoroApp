/**
 * Avatar Agent: los personajes que le ponen cara a la IA del chat. El presidente (Apo) es la IA
 * general y cada módulo tiene su director; ver ms-ai `avatar/AvatarAgentes`.
 */

export type RangoPersonaje = 'PRESIDENTE' | 'DIRECTOR' | 'ASESOR';
export type TipoAsset = 'ESTATICO' | 'IDLE' | 'HABLANDO';
export type EstadoAvatar = 'reposo' | 'pensando' | 'hablando';

/** Lo que el chat necesita para pintar a un personaje (GET /avatar-agent/personajes). */
export interface Personaje {
  clave: string;
  nombre: string;
  nombreCorto: string;
  cargo: string;
  rango: RangoPersonaje;
  padreClave?: string | null;
  colorPrimario?: string | null;
  colorSecundario?: string | null;
  icono?: string | null;
  saludo?: string | null;
  voz?: string | null;
  /** Claves del catálogo de módulos del chat (admite `tienda.*`). */
  modulos?: string[];
  /** Prefijos de ruta de las pantallas de su área. */
  rutas?: string[];
  /** Id del asset seleccionado de cada tipo (si el administrador generó o subió uno). */
  assets?: Partial<Record<TipoAsset, number>>;
}

/** La ficha completa del administrador. */
export interface PersonajeAdmin extends Personaje {
  id: number;
  modulos: string[];
  rutas: string[];
  colegas: string[];
  descripcion?: string | null;
  personalidad?: string | null;
  tono: string;
  instrucciones?: string | null;
  plantillaRespuesta?: string | null;
  promptVisual?: string | null;
  orden: number;
  activo: boolean;
}

export interface AssetAvatar {
  id: number;
  tipo: TipoAsset;
  proveedor: 'HIGGSFIELD' | 'OPENAI' | 'SUBIDO';
  estado: 'ENVIADO' | 'LISTO' | 'ERROR' | 'PENDIENTE';
  error?: string | null;
  prompt?: string | null;
  origenId?: number | null;
  mime?: string | null;
  tamano?: number | null;
  seleccionado: boolean;
  /** Retrato de Higgsfield aún animable (su original dura ~7 días allá). */
  animable: boolean;
  creadoEn?: string;
}

export interface EstadoAvatarAgent {
  generacion: boolean;
  tonos: string[];
  voces: string[];
  rangos: RangoPersonaje[];
  maxVariantes: number;
}

/** Un tramo de una respuesta y quién lo dice (marcas [[clave]] del servidor). */
export interface Tramo {
  clave: string;
  texto: string;
}

/** Las fuentes que pinta el componente: el archivo del servidor o el empaquetado con la app. */
export interface MediosAvatar {
  retrato: string | null;
  idle: string | null;
  hablando: string | null;
}

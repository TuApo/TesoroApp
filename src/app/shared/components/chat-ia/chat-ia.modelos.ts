/**
 * Chat de IA estándar de TesoroApp: tipos compartidos por el chat embebido en cada módulo,
 * el acceso rápido y la bandeja central (Herramientas IA › Conversaciones).
 * Backend: ms-ai `/api/v1/ai/chat/**` (JSON en camelCase).
 */

/** Lo que un módulo le cuenta al chat: dónde está la persona y qué está viendo. */
export interface ContextoChatIa {
  /** Clave del módulo, con puntos para submódulos: 'tienda.logis', 'tienda.inventario'. */
  modulo: string;
  /** Nombre para mostrar y para la bandeja: 'Tienda › Logis'. */
  moduloNombre: string;
  tiendaId?: string | null;
  tiendaNombre?: string | null;
  /** Pantalla a la que se vuelve desde la bandeja (por defecto, la URL actual). */
  ruta?: string;
  /** Parámetros por defecto de las consultas (tienda, desde, hasta…): la IA los usa si no da otros. */
  parametros?: Record<string, string | number | boolean | null | undefined>;
  /** Lo que se ve en pantalla (resumen pequeño en JSON): filtros, pestaña, cifras visibles. */
  pantalla?: unknown;
  /** Sugerencias propias; si no, las del módulo en el servidor. */
  sugerencias?: string[];
}

export type EstadoMensaje = 'PENDIENTE' | 'LISTO' | 'ERROR';
export type TipoArchivo = 'IMAGEN' | 'AUDIO' | 'PDF' | 'HOJA' | 'DOCUMENTO' | 'PRESENTACION' | 'TEXTO' | 'VIDEO' | 'OTRO';

export interface ArchivoChat {
  id: string;
  nombre: string;
  tipo: TipoArchivo;
  mime: string;
  tamano: number;
  origen?: 'ADJUNTO' | 'GENERADO' | 'VOZ';
  estado: EstadoMensaje;
  error?: string;
}

export interface MensajeChat {
  id: number;
  conversacionId: number;
  rol: 'user' | 'assistant' | 'system';
  contenido: string;
  estado: EstadoMensaje;
  progreso?: string | null;
  error?: string | null;
  viaVoz?: boolean;
  modelo?: string | null;
  createdAt?: string;
  adjuntos: ArchivoChat[];
  archivos: ArchivoChat[];
  voz?: ArchivoChat | null;
}

export interface ConversacionChat {
  id: number;
  titulo: string;
  tipo: string;
  /** Conversaciones del asistente y de la analítica de nómina, anteriores al chat estándar. */
  legado: boolean;
  modulo: string | null;
  moduloNombre: string | null;
  tiendaId: string | null;
  tiendaNombre: string | null;
  ruta: string | null;
  usuarioId: string;
  usuarioNombre: string | null;
  propia: boolean;
  archivada: boolean;
  fijada: boolean;
  ultimoMensaje: string | null;
  totalMensajes: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstadoChatIa {
  disponible: boolean;
  modelo: string;
  voz: boolean;
  vision: boolean;
  transcripcion: boolean;
  maxArchivoMb: number;
  formatos: string[];
}

export interface ModuloChatIa {
  clave: string;
  nombre: string;
  icono: string;
  ruta?: string;
  sugerencias: string[];
  fuentes: { clave: string; nombre: string }[];
}

export interface PaginaBandeja {
  total: number;
  pagina: number;
  paginas: number;
  conversaciones: ConversacionChat[];
}

export interface FacetasBandeja {
  modulos: { clave: string; nombre: string; total: number }[];
  tiendas: { id: string; nombre: string; total: number }[];
}

export interface FiltrosBandeja {
  todas?: boolean;
  modulo?: string | null;
  tienda?: string | null;
  q?: string | null;
  archivadas?: boolean;
  desde?: string | null;
  hasta?: string | null;
  pagina?: number;
  tamano?: number;
}

/** Ruta de la bandeja central (menú: Herramientas IA › Conversaciones). */
export const RUTA_BANDEJA_IA = '/dashboard/herramientas-ia/conversaciones';

export function iconoArchivo(a: Pick<ArchivoChat, 'tipo' | 'nombre'>): string {
  const n = (a.nombre || '').toLowerCase();
  if (n.endsWith('.pptx')) return 'slideshow';
  if (n.endsWith('.xlsx') || n.endsWith('.csv')) return 'table_view';
  if (n.endsWith('.docx')) return 'description';
  if (n.endsWith('.pdf')) return 'picture_as_pdf';
  switch (a.tipo) {
    case 'IMAGEN': return 'image';
    case 'AUDIO': return 'graphic_eq';
    case 'PDF': return 'picture_as_pdf';
    case 'HOJA': return 'table_view';
    case 'PRESENTACION': return 'slideshow';
    case 'DOCUMENTO': return 'description';
    case 'TEXTO': return 'article';
    case 'VIDEO': return 'movie';
    default: return 'draft';
  }
}

export function etiquetaFormato(a: Pick<ArchivoChat, 'tipo' | 'nombre'>): string {
  const ext = (a.nombre || '').split('.').pop()?.toLowerCase() ?? '';
  const nombres: Record<string, string> = { pptx: 'PowerPoint', xlsx: 'Excel', docx: 'Word', pdf: 'PDF', csv: 'CSV', md: 'Markdown', mp3: 'Audio' };
  return nombres[ext] ?? ext.toUpperCase();
}

export function tamanoLegible(b: number): string {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

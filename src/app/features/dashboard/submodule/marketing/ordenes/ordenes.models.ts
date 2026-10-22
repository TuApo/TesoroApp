/** Contrato de /api/v1/marketing/ordenes y /flujos (snake_case, como lo escribe el backend). */

export type EstadoOrden =
  | 'SOLICITADA' | 'EN_PRODUCCION' | 'EN_REVISION' | 'CAMBIOS' | 'APROBADA' | 'ENTREGADA' | 'CANCELADA';
export type EstadoEntregable =
  | 'PENDIENTE' | 'EN_PRODUCCION' | 'EN_REVISION' | 'CAMBIOS' | 'APROBADO' | 'ENTREGADO' | 'CANCELADO';
export type EstadoEjecucion =
  | 'PENDIENTE' | 'EN_CURSO' | 'ESPERANDO_PROVEEDOR' | 'ESPERANDO_REVISION' | 'COMPLETADA' | 'ERROR' | 'CANCELADA';

export interface OrdenResumen {
  id: string; codigo: string; titulo: string; tipo: string; marca_id: string | null;
  estado: EstadoOrden; prioridad: string; fecha_requerida: string | null;
  solicitante_id: string | null; solicitante_nombre: string | null;
  responsable_id: string | null; responsable_nombre: string | null;
  relacion_tipo: string | null; relacion_etiqueta: string | null;
  entregables_total?: number; entregables_listos?: number;
  creado_en: string; actualizado_en: string | null;
}

export interface Orden extends OrdenResumen {
  brief: string | null; objetivo: string | null; publico: string | null;
  canales: string[] | null; relacion_id: string | null;
  cancelada_motivo: string | null; entregada_en: string | null;
}

export interface ListadoOrdenes {
  ordenes: OrdenResumen[]; total: number; por_estado: Record<string, number>; es_admin: boolean;
}

export interface ArchivoOrden {
  id: string; entregable_id: string | null;
  rol: 'INSUMO' | 'VERSION' | 'INTERMEDIO' | 'EVIDENCIA';
  numero: number | null; origen: string; padre_id: string | null;
  ejecucion_id: string | null; paso_id: string | null;
  nombre: string | null; mime: string | null; tamano_bytes: number | null;
  tiene_contenido: boolean; tiene_binario: boolean; url_externa: string | null;
  texto: string | null; tiene_fuente: boolean; descripcion: string | null;
  evidencia_tipo: string | null;
  revision: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null; revision_nota: string | null;
  revisado_por: string | null; revisado_en: string | null;
  metadatos: MetadatosVersion | Record<string, unknown> | null;
  creado_por: string | null; creado_por_nombre: string | null; creado_en: string;
}

export interface MetadatosVersion {
  flujo?: string; flujo_nombre?: string; flujo_version?: number; ejecucion_id?: string;
  instrucciones?: string; proveedor?: string; modelo?: string; paso?: string;
  pasos?: { clave: string; tipo: string; estado: string; proveedor?: string; modelo?: string;
            tokens_entrada?: number; tokens_salida?: number }[];
}

export interface Entregable {
  id: string; tipo: string; titulo: string;
  especificacion: Record<string, unknown> | null;
  flujo_id: string | null; flujo_nombre: string | null;
  estado: EstadoEntregable; version_vigente_id: string | null; entregado_en: string | null;
  versiones: ArchivoOrden[]; evidencias: ArchivoOrden[]; intermedios: ArchivoOrden[];
}

export interface Paso {
  id: string; indice: number; clave: string; tipo: string; titulo: string | null;
  estado: string; archivo_id: string | null; proveedor: string | null; modelo: string | null;
  tokens_entrada: number | null; tokens_salida: number | null; intentos: number;
  error_detalle: string | null; entrada: unknown; salida: Record<string, unknown> | null;
  iniciado_en: string | null; terminado_en: string | null;
}

export interface Ejecucion {
  id: string; flujo_id: string | null; flujo_codigo: string | null; flujo_nombre: string | null;
  entregable_id: string | null; base_archivo_id: string | null; instrucciones: string | null;
  estado: EstadoEjecucion; paso_actual: number; resultado_archivo_id: string | null;
  origen_ejecucion_id: string | null; error_detalle: string | null; solicitado_nombre: string | null;
  iniciado_en: string | null; terminado_en: string | null; creado_en: string;
  pasos: Paso[];
}

export interface EventoOrden {
  id: string; tipo: string; texto: string | null; entregable_id: string | null;
  archivo_id: string | null; ejecucion_id: string | null; autor_nombre: string | null; creado_en: string;
}

export interface DetalleOrden {
  orden: Orden;
  entregables: Entregable[];
  insumos: ArchivoOrden[];
  evidencias_generales: ArchivoOrden[];
  ejecuciones: Ejecucion[];
  eventos: EventoOrden[];
  permisos: { producir: boolean; revisar: boolean; editar: boolean; asignar: boolean; es_admin: boolean };
}

export interface FlujoResumen {
  id: string; codigo: string; nombre: string; descripcion: string | null;
  tipo_entregable: string; entrada: string; version: number;
  sistema: boolean; experimental: boolean; activo: boolean; orden: number;
  faltantes: string[]; listo: boolean; pasos_de_pago: string[];
  resumen_pasos: { clave: string; tipo: string; titulo: string | null; resultado: boolean; opcional: boolean }[];
  pasos?: PasoFlujo[];
  actualizado_en: string | null;
}

export interface PasoFlujo {
  clave: string; tipo: string; titulo?: string; resultado?: boolean; opcional?: boolean;
  config?: Record<string, unknown>;
}

export interface Proveedores {
  texto: { activo: string; claude_configurado: boolean; claude_modelo: string; nota: string };
  higgsfield: { configurado: boolean; falta: string | null };
  elevenlabs: { configurado: boolean; falta: string | null };
  render: { configurado: boolean };
}

export interface ModeloIa {
  modelo_id: string; nombre: string; proveedor: string | null; descripcion: string | null;
  tipo_salida: string; ruta_api: string; costo_relativo: string | null;
  parametros: string | null; aspect_ratios: string | null;
}

export interface NuevaOrden {
  titulo: string; tipo: string; marca_id?: string | null; brief?: string; objetivo?: string;
  publico?: string; canales?: string[]; relacion_tipo?: string | null; relacion_id?: string | null;
  relacion_etiqueta?: string | null; prioridad?: string; fecha_requerida?: string | null;
  entregables: { tipo: string; titulo: string; especificacion?: Record<string, unknown> }[];
}

// ── Catalogos de pantalla ────────────────────────────────────────────────────

export const TIPOS_ENTREGABLE: { clave: string; etiqueta: string; icono: string }[] = [
  { clave: 'VIDEO', etiqueta: 'Video', icono: 'movie' },
  { clave: 'IMAGEN', etiqueta: 'Imagen / pieza', icono: 'image' },
  { clave: 'PDF', etiqueta: 'Documento PDF', icono: 'picture_as_pdf' },
  { clave: 'CURSO', etiqueta: 'Curso', icono: 'school' },
  { clave: 'POST', etiqueta: 'Texto / post', icono: 'chat' },
  { clave: 'AUDIO', etiqueta: 'Audio / locución', icono: 'graphic_eq' },
  { clave: 'PRESENTACION', etiqueta: 'Presentación', icono: 'slideshow' },
  { clave: 'OTRO', etiqueta: 'Otro', icono: 'category' },
];

export const ESTADOS_ORDEN: { clave: EstadoOrden; etiqueta: string }[] = [
  { clave: 'SOLICITADA', etiqueta: 'Solicitada' },
  { clave: 'EN_PRODUCCION', etiqueta: 'En producción' },
  { clave: 'EN_REVISION', etiqueta: 'Por revisar' },
  { clave: 'CAMBIOS', etiqueta: 'Con cambios' },
  { clave: 'APROBADA', etiqueta: 'Aprobada' },
  { clave: 'ENTREGADA', etiqueta: 'Entregada' },
  { clave: 'CANCELADA', etiqueta: 'Cancelada' },
];

export const ETIQUETA_ESTADO: Record<string, string> = {
  SOLICITADA: 'Solicitada', EN_PRODUCCION: 'En producción', EN_REVISION: 'Por revisar', CAMBIOS: 'Con cambios',
  APROBADA: 'Aprobada', ENTREGADA: 'Entregada', CANCELADA: 'Cancelada',
  PENDIENTE: 'Pendiente', APROBADO: 'Aprobado', ENTREGADO: 'Entregado', CANCELADO: 'Cancelado',
  EN_CURSO: 'Trabajando', ESPERANDO_PROVEEDOR: 'Esperando al proveedor', ESPERANDO_REVISION: 'Espera tu revisión',
  COMPLETADA: 'Completada', ERROR: 'Falló', LISTO: 'Listo', OMITIDO: 'Omitido', REUTILIZADO: 'Reutilizado',
  APROBADA_V: 'Aprobada', RECHAZADA: 'Cambios pedidos',
};

export const CANALES = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'CORREO', 'CARTELERA', 'WEB'];

export const TIPOS_EVIDENCIA: { clave: string; etiqueta: string }[] = [
  { clave: 'PUBLICACION', etiqueta: 'Enlace de la publicación' },
  { clave: 'CAPTURA', etiqueta: 'Captura de pantalla' },
  { clave: 'ARCHIVO_FUENTE', etiqueta: 'Archivo fuente (proyecto editable)' },
  { clave: 'ACTA', etiqueta: 'Acta / constancia de entrega' },
  { clave: 'METRICA', etiqueta: 'Métrica / resultado' },
  { clave: 'OTRO', etiqueta: 'Otro' },
];

export const ICONO_PASO: Record<string, string> = {
  IA_TEXTO: 'edit_note', HIGGSFIELD: 'auto_awesome', RENDER_PDF: 'picture_as_pdf',
  RENDER_IMAGEN: 'crop_original', TTS: 'record_voice_over', REVISION: 'fact_check',
};

export const NOMBRE_PASO: Record<string, string> = {
  IA_TEXTO: 'Claude', HIGGSFIELD: 'Higgsfield', RENDER_PDF: 'Render PDF',
  RENDER_IMAGEN: 'Render imagen', TTS: 'ElevenLabs', REVISION: 'Revisión humana',
};

/** Campos de especificacion que tiene sentido pedir segun el tipo de entregable. */
export const CAMPOS_ESPEC: Record<string, { clave: string; etiqueta: string; opciones?: string[]; numero?: boolean }[]> = {
  VIDEO: [
    { clave: 'aspect_ratio', etiqueta: 'Formato', opciones: ['9:16', '16:9', '1:1', '4:5'] },
    { clave: 'duracion_seg', etiqueta: 'Duración (s)', opciones: ['5', '10'] },
  ],
  IMAGEN: [{ clave: 'aspect_ratio', etiqueta: 'Formato', opciones: ['1:1', '4:5', '9:16', '16:9', '3:4'] }],
  PDF: [
    { clave: 'tamano', etiqueta: 'Tamaño', opciones: ['A4', 'CARTA', 'OFICIO'] },
    { clave: 'paginas', etiqueta: 'Páginas aprox.', numero: true },
  ],
  CURSO: [
    { clave: 'duracion_horas', etiqueta: 'Duración (h)', numero: true },
    { clave: 'tamano', etiqueta: 'Tamaño cartilla', opciones: ['A4', 'CARTA'] },
  ],
  POST: [{ clave: 'caracteres', etiqueta: 'Máx. caracteres', numero: true }],
  AUDIO: [{ clave: 'duracion_seg', etiqueta: 'Duración (s)', numero: true }],
  PRESENTACION: [{ clave: 'paginas', etiqueta: 'Diapositivas', numero: true }],
  OTRO: [],
};

export function iconoTipo(tipo: string): string {
  return TIPOS_ENTREGABLE.find((t) => t.clave === tipo)?.icono ?? 'category';
}

export function etiquetaTipo(tipo: string): string {
  return TIPOS_ENTREGABLE.find((t) => t.clave === tipo)?.etiqueta ?? tipo;
}

export function ejecucionActiva(e: Ejecucion): boolean {
  return ['PENDIENTE', 'EN_CURSO', 'ESPERANDO_PROVEEDOR', 'ESPERANDO_REVISION'].includes(e.estado);
}

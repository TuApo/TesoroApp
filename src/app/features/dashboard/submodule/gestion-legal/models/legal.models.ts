// ── Catálogos ─────────────────────────────────────────────────────────────────

export interface ProcesoTipo {
  id: number;
  codigo: string;
  nombre: string;
  color_hex: string;
  icono: string;
  activo: boolean;
}

export interface ProcesoEstado {
  id: number;
  tipo_id: number;
  codigo: string;
  nombre: string;
  color_semaforo: 'verde' | 'amarillo' | 'rojo';
  es_terminal: boolean;
}

export interface DocumentoTipo {
  id: number;
  codigo: string;
  nombre: string;
}

export interface ChecklistItem {
  id: number;
  tipo_id: number;
  documento_tipo_id: number;
  documento_tipo_nombre: string;
  requerido: boolean;
}

// ── Entidad principal ──────────────────────────────────────────────────────────

export interface ProcesoLegal {
  id: number;
  radicado: string;
  tipo_id: number;
  tipo_nombre: string;
  estado_id: number;
  estado_nombre: string;
  color_semaforo: 'verde' | 'amarillo' | 'rojo';
  trabajador_cedula: string;
  trabajador_nombre: string;
  empresa_id?: number;
  empresa_nombre?: string;
  fecha_inicio: string;
  responsable_id?: string;
  descripcion_hechos?: string;
  pretensiones?: string;
  documentos_count: number;
  actuaciones_count: number;
  created_at: string;
  updated_at: string;
}

// ── Actuaciones ────────────────────────────────────────────────────────────────

export interface ActuacionLegal {
  id: number;
  proceso_id: number;
  tipo: string;
  titulo: string;
  descripcion?: string;
  fecha_actuacion: string;
  realizado_por: string;
  estado_anterior_nombre?: string;
  estado_nuevo_nombre?: string;
  created_at: string;
}

// ── Términos ───────────────────────────────────────────────────────────────────

export interface TerminoLegal {
  id: number;
  proceso_id: number;
  tipo: string;
  descripcion?: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  dias_habiles: number;
  alertado: boolean;
  vencido: boolean;
}

// ── Partes ────────────────────────────────────────────────────────────────────

export interface ParteProceso {
  id: number;
  proceso_id: number;
  tipo: 'DEMANDANTE' | 'DEMANDADO' | 'APODERADO' | string;
  nombre: string;
  cedula?: string;
  nit?: string;
  correo?: string;
  telefono?: string;
  direccion?: string;
}

// ── Documentos ────────────────────────────────────────────────────────────────

export interface DocumentoProceso {
  id: number;
  proceso_id: number;
  actuacion_id?: number | null;
  doc_tipo_id: number;
  doc_tipo_nombre: string;
  doc_tipo_categoria?: string;
  nombre: string;
  tamano_byte: number;
  mime_type: string;
  version: number;
  es_version_actual: boolean;
  subido_por: string;
  created_at: string;
  tiene_analisis_ia: boolean;
}

// ── Paginación genérica ────────────────────────────────────────────────────────

export interface PaginaResponse<T> {
  content: T[];
  total_elements: number;
  total_pages: number;
  number: number;
  size: number;
}

// ── Parámetros de filtro bandeja ───────────────────────────────────────────────

export interface BandejaParams {
  estado?: number;
  tipo?: number;
  q?: string;
  page?: number;
  size?: number;
}

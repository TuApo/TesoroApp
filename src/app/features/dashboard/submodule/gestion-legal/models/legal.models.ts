// ── Catálogos ─────────────────────────────────────────────────────────────────

export interface ProcesoTipo {
  id: number;
  codigo: string;
  nombre: string;
  colorHex: string;
  icono: string;
  activo: boolean;
}

export interface ProcesoEstado {
  id: number;
  tipoId: number;
  codigo: string;
  nombre: string;
  colorSemaforo: 'verde' | 'amarillo' | 'rojo';
  esTerminal: boolean;
}

export interface DocumentoTipo {
  id: number;
  codigo: string;
  nombre: string;
}

export interface ChecklistItem {
  id: number;
  tipoId: number;
  documentoTipoId: number;
  documentoTipoNombre: string;
  requerido: boolean;
}

// ── Entidad principal ──────────────────────────────────────────────────────────

export interface ProcesoLegal {
  id: number;
  radicado: string;
  tipoId: number;
  tipoNombre: string;
  estadoId: number;
  estadoNombre: string;
  colorSemaforo: 'verde' | 'amarillo' | 'rojo';
  trabajadorCedula: string;
  trabajadorNombre: string;
  empresaId?: number;
  empresaNombre?: string;
  fechaInicio: string;
  responsableId?: string;
  descripcionHechos?: string;
  pretensiones?: string;
  documentosCount: number;
  actuacionesCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Actuaciones ────────────────────────────────────────────────────────────────

export interface ActuacionLegal {
  id: number;
  procesoId: number;
  tipo: string;
  titulo: string;
  descripcion?: string;
  fechaActuacion: string;
  realizadoPor: string;
  estadoAnteriorNombre?: string;
  estadoNuevoNombre?: string;
  createdAt: string;
}

// ── Términos ───────────────────────────────────────────────────────────────────

export interface TerminoLegal {
  id: number;
  procesoId: number;
  tipo: string;
  descripcion?: string;
  fechaInicio: string;
  fechaVencimiento: string;
  diasHabiles: number;
  alertado: boolean;
  vencido: boolean;
}

// ── Partes ────────────────────────────────────────────────────────────────────

export interface ParteProceso {
  id: number;
  procesoId: number;
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
  procesoId: number;
  actuacionId?: number | null;
  docTipoId: number;
  docTipoNombre: string;
  docTipoCategoria?: string;
  nombre: string;
  tamanoByte: number;
  mimeType: string;
  version: number;
  esVersionActual: boolean;
  subidoPor: string;
  createdAt: string;
  tieneAnalisisIa: boolean;
}

// ── Paginación genérica ────────────────────────────────────────────────────────

export interface PaginaResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
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

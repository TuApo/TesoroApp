import { FormAccess } from './process.models';

/**
 * Modelos de UBICACIÓN de formularios dinámicos (wire format snake_case del backend
 * ms-forms, /api/dynamic-forms). El formulario es una VISTA de un módulo anfitrión.
 */

export type PlacementStatus = 'PENDING' | 'LINKED' | 'FAILED' | 'UNLINKED';

/** Nodo del árbol de módulos para el selector de ubicación. */
export interface ModuleNode {
  id: string;
  label: string;
  icon?: string | null;
  route_path?: string | null;
  order_no?: number | null;
  manageable?: boolean;
  children?: ModuleNode[];
}

export interface Placement {
  form_id: number;
  placement_status: PlacementStatus;
  parent_module_id?: string | null;
  module_id?: string | null;
  responses_module_id?: string | null;
  responses_parent_module_id?: string | null;
  responses_menu_enabled?: boolean;
  slug?: string | null;
  route_path?: string | null;
  menu_label?: string | null;
  module_icon?: string | null;
  module_order_no?: number | null;
  placement_error?: string | null;
  placement_updated_at?: string | null;
  warnings?: string[] | null;
}

export interface PlacementRequest {
  parent_module_id: string;
  menu_label?: string;
  slug?: string;
  icon?: string;
  order_no?: number;
  responses_menu_enabled?: boolean;
  responses_parent_module_id?: string | null;
  fill_role_ids?: string[];
}

/**
 * Vista de un formulario (tab del FormViewHost; también sufijo de ruta en deep links).
 * `process` (V14) es la quinta: el seguimiento del dato, no del formulario.
 */
export type FormView = 'fill' | 'responses' | 'supports' | 'analytics' | 'process';

/** Resolución de una ruta a un formulario + qué vista mostrar (canMatch / deep links). */
export interface RouteResolution {
  form_id: number;
  module_id?: string | null;
  menu_label?: string | null;
  route_path?: string | null;
  /** Vista a montar según el sufijo de la ruta. */
  view?: FormView;
  /** No nulo si la ruta pedida es un alias: el front debe redirigir aquí. */
  canonical_route_path?: string | null;
  /** true si el formulario quedó UNLINKED (padre/módulo borrado a mano). */
  unlinked?: boolean;
  /**
   * true si el usuario puede gestionar el formulario (dueño o admin de plataforma).
   * Gobierna los tabs Respuestas/Soportes/Analítica — mismo criterio que el backend
   * exige (requireManage) en esos endpoints.
   */
  can_manage?: boolean;
  /**
   * Acceso EFECTIVO del usuario (V14). Es lo que decide qué pestañas se pintan:
   * `can_manage` sigue existiendo, pero un rol con permisos delegados no gestiona el
   * formulario y aun así ve Respuestas o Control del proceso.
   */
  access?: FormAccess;
}

/** Un archivo adjunto de una respuesta (vista Soportes). */
export interface SupportFile {
  submission_id: number;
  submitted_at?: string | null;
  section: string;
  field_name: string;
  document_id: number;
  filename?: string | null;
  mime_type?: string | null;
  size?: number | null;
  /** Descarga directa en ms-documents. Se usa SOLO para las miniaturas. */
  download_url: string;

  // ── Identificación del soporte (ms-forms se la calcula) ──────────────
  /** "seccion__campo": identifica la pregunta de forma estable entre versiones. */
  field_key: string;
  /** Etiqueta de la pregunta tal como la ve quien responde. */
  field_label: string;
  section_label?: string | null;
  /** Número de documento (cédula) de la respuesta, si el formulario lo pide. */
  record_key?: string | null;
  /** Etiqueta del campo del que salió `record_key`. */
  record_key_label?: string | null;
  /** "{cédula}-{pregunta-corta}": el identificador corto del soporte. */
  short_id: string;
  /** `short_id` + extensión: el nombre con el que se descarga. */
  suggested_filename: string;
  /** Descarga por ms-forms: nombre corto + registro de actividad. */
  audited_download_url: string;
}

/** Una pregunta con soportes (para clasificar la vista y el ZIP). */
export interface SupportFacet {
  field_key: string;
  field_label: string;
  section_label?: string | null;
  count: number;
}

/** Respuesta del listado de soportes: página + de qué preguntas y tipos hay archivos. */
export interface SupportsPage {
  content: SupportFile[];
  total: number;
  page: number;
  size: number;
  /** Total del formulario sin filtros (el "de cuántos" real). */
  total_all: number;
  fields: SupportFacet[];
  /** { imagen: 12, pdf: 3, ... } sobre el resultado de la búsqueda. */
  types: Record<string, number>;
  /** true si se alcanzó el tope de archivos rastreados. */
  partial: boolean;
}

/** Cómo se organiza el ZIP. */
export type SupportsGroupBy = 'NONE' | 'FIELD' | 'RECORD';

/** POST /forms/{id}/supports/zip. */
export interface SupportsZipRequest {
  /** Selección explícita como "submissionId:documentId". */
  document_keys?: string[];
  /** true = todo lo que casa con los filtros (ignora `document_keys`). */
  all_matching?: boolean;
  q?: string;
  fields?: string[];
  types?: string[];
  group_by?: SupportsGroupBy;
  include_manifest?: boolean;
}

/** Una descarga registrada (quién se llevó qué y cuándo). */
export interface SupportDownloadLog {
  id: number;
  occurred_at: string;
  user_id?: string | null;
  user_email?: string | null;
  user_role?: string | null;
  /** SINGLE | ZIP */
  mode: string;
  group_mode?: string | null;
  file_count: number;
  total_bytes: number;
  archive_name?: string | null;
  filters?: { q?: string; fields?: string[]; types?: string[] } | null;
  items?: Array<{
    document_id: number;
    submission_id: number;
    record_key?: string;
    field_key?: string;
    field_label?: string;
    entry_name?: string;
  }> | null;
  ip?: string | null;
  success: boolean;
  error_code?: string | null;
}

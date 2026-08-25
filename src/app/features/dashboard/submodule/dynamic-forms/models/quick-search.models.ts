/**
 * Buscador rápido del header (ms-forms, GET /api/dynamic-forms/quick-search).
 * Contrato en snake_case, igual que el resto de Formularios Dinámicos.
 */

/** Una pareja etiqueta/valor de la información rápida de un registro. */
export interface QuickSearchField {
  label: string;
  value: string;
  /** true = es el campo por el que el registro salió en la búsqueda. */
  matched: boolean;
}

/** Formulario dinámico cuyo nombre casa con lo escrito. */
export interface QuickSearchForm {
  id: number;
  name: string;
  category: string | null;
  description: string | null;
  /** Ruta canónica relativa a /dashboard, o null si no está colgado del menú. */
  route_path: string | null;
  menu_label: string | null;
  placement_status: string | null;
  submissions_count: number;
  /** false = el usuario solo puede llenarlo: no se le ofrece la tabla de registros. */
  can_view_responses: boolean;
}

/** Registro ya guardado que contiene el texto buscado. */
export interface QuickSearchRecord {
  id: number;
  form_id: number;
  form_name: string;
  route_path: string | null;
  title: string;
  record_key: string | null;
  status: string | null;
  version: number | null;
  submitted_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  match_label: string | null;
  fields: QuickSearchField[];
}

export interface QuickSearchResult {
  query: string;
  forms: QuickSearchForm[];
  records: QuickSearchRecord[];
  /** true = había más formularios de los que se alcanzó a revisar. */
  partial: boolean;
}

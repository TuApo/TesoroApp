/**
 * ORÍGENES DE OPCIONES: tablas parametrizadas usadas como opciones de un campo.
 * El API (ms-forms, /api/dynamic-forms) habla snake_case, así que las interfaces
 * espejan el wire format tal cual. Modelo y reglas: V9__df_option_source.sql.
 */

/** Tabla parametrizada del motor de catálogos (ms-auth-admin, meta_tablas). */
export interface OptionCatalog {
  code: string;
  description?: string | null;
  active: boolean;
  columns: string[];
}

/** Filtro fijo por columna. */
export interface OptionRuleFilter {
  field: string;
  op: 'eq' | 'ne' | 'in' | 'not_in' | 'contains' | 'not_empty' | 'empty';
  value?: string | null;
}

/** Columnas que se comparan contra el usuario que llena. */
export interface OptionRuleScope {
  empresa_field?: string | null;
  sede_field?: string | null;
  rol_field?: string | null;
}

/** Quién puede usar el origen. `permission` se hereda por el árbol de módulos. */
export interface OptionRuleAccess {
  roles?: string[];
  permission?: string | null;
}

export interface OptionSourceRules {
  filters?: OptionRuleFilter[];
  scope?: OptionRuleScope;
  access?: OptionRuleAccess;
}

export interface OptionSource {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  kind: string;
  catalog_code: string;
  label_field: string;
  /** Clave estable de la fila: encadena la cascada (lo guardado sigue siendo la etiqueta). */
  value_field?: string | null;
  order_field?: string | null;
  parent_source_id?: number | null;
  parent_source_code?: string | null;
  parent_link_field?: string | null;
  rules?: OptionSourceRules | null;
  active: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** POST/PUT; en el PUT todo es opcional (lo que no venga no se toca). */
export interface OptionSourceRequest {
  code?: string;
  name?: string;
  description?: string | null;
  catalog_code?: string;
  label_field?: string;
  value_field?: string | null;
  order_field?: string | null;
  parent_source_id?: number | null;
  parent_link_field?: string | null;
  rules?: OptionSourceRules | null;
  active?: boolean;
}

export interface ResolvedOption {
  value: string;
  label: string;
}

export interface OptionsResult {
  source: string;
  catalog_code: string;
  options: ResolvedOption[];
  total: number;
  truncated: boolean;
  restricted: boolean;
  reason?: string | null;
}

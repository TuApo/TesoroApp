/**
 * Modelos de la CARGA POR EXCEL de Formularios Dinámicos (ms-forms, /api/dynamic-forms/import).
 * Espejan el wire format snake_case del backend, igual que el resto del submódulo.
 *
 * La idea del contrato: la plantilla se baja YA parametrizada (a qué módulo va, quién lo
 * llena, visibilidad y recorrido) y al subirla llena el backend devuelve exactamente el
 * `BuilderRequest` que enviaría el constructor, más la ubicación. Nada se guarda al
 * cargar: lo que vuelve se vuelca en el constructor para revisarlo.
 */

import { BuilderRequest } from './dynamic-forms.models';

/** Rol elegido para llenar el formulario (viaja con id para volver intacto). */
export interface ImportRoleRef {
  id: string;
  name: string;
}

/** Lo que se define ANTES de descargar la plantilla. */
export interface TemplateConfig {
  mode: 'individual' | 'masivo';
  /** Solo masivo: cuántas filas de formulario se prellenan. */
  forms_count?: number;
  name?: string;
  description?: string;
  category?: string;
  is_public?: boolean;
  navigation?: 'wizard' | 'single';
  parent_module_id?: string | null;
  parent_module_label?: string | null;
  menu_label?: string;
  icon?: string;
  responses_menu_enabled?: boolean;
  roles?: ImportRoleRef[];
  include_examples?: boolean;
}

/** Ubicación y permisos leídos del archivo. */
export interface ImportPlacement {
  parent_module_id?: string | null;
  parent_module_label?: string | null;
  menu_label?: string | null;
  icon?: string | null;
  responses_menu_enabled?: boolean | null;
  order_no?: number | null;
  fill_role_ids?: string[];
  fill_role_names?: string[];
}

/** Un formulario leído del archivo, listo para el constructor. */
export interface ImportedForm {
  /** Código de la columna «Formulario» del Excel (F1, F2...). */
  row_code: string;
  form: BuilderRequest;
  placement: ImportPlacement;
  /** Bloqueantes: mientras haya uno, este formulario no se puede crear. */
  errors: string[];
  /** No bloqueantes: se cargó, pero conviene revisarlo. */
  warnings: string[];
  sections_count: number;
  fields_count: number;
  valid: boolean;
}

export interface ImportResult {
  forms: ImportedForm[];
  /** Errores del archivo entero (hoja ausente, ilegible...). */
  errors: string[];
  warnings: string[];
  total_forms: number;
  valid_forms: number;
  total_fields: number;
}

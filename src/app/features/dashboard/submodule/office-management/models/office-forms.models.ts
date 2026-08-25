// Modelos del motor de formularios (Gestión de Oficina). Los nombres van en snake_case
// para calzar 1:1 con el contrato de ms-forms (DTOs @JsonNaming snake_case en el backend).

export type FieldType =
  | 'texto_corto'
  | 'texto_largo'
  | 'numero'
  | 'seleccion_unica'
  | 'foto'
  | 'archivo'
  // tipos del catálogo completo (el modelo ya los soporta; se habilitan en fases siguientes)
  | 'fecha'
  | 'hora'
  | 'video'
  | 'moneda'
  | 'calificacion'
  | 'lista'
  | 'seleccion_multiple'
  | 'comentario'
  | 'seccion'
  | 'gps'
  | 'firma';

export type Visibility = 'PUBLIC' | 'PRIVATE';
export type FormStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldConfig {
  options?: FieldOption[];   // seleccion_unica / lista / seleccion_multiple
  min?: number;
  max?: number;
  max_length?: number;
  rows?: number;
  accept?: string[];         // archivo
  max_files?: number;        // foto / archivo
  source?: 'camera' | 'gallery';
}

export interface FormFieldDef {
  id?: number;
  field_type: FieldType;
  label: string;
  help_text?: string | null;
  placeholder?: string | null;
  position: number;
  required: boolean;
  config_json?: FieldConfig | null;
}

export interface RoleAccess {
  role_id: string;
  can_view: boolean;
  can_respond: boolean;
}

export interface FormDefinition {
  id?: number;
  title: string;
  description?: string | null;
  parent_module?: string | null;
  visibility: Visibility;
  status?: FormStatus;
  version?: number;
  public_token?: string | null;
  public_url?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
  fields?: FormFieldDef[];
  office_ids?: string[];
  roles?: RoleAccess[];
}

export interface FormSummary {
  id: number;
  title: string;
  parent_module?: string | null;
  visibility: Visibility;
  status: FormStatus;
  version: number;
  field_count: number;
  response_count: number;
  office_ids: string[];
  updated_at: string;
}

export interface PublishResult {
  id: number;
  status: FormStatus;
  visibility: Visibility;
  public_token?: string | null;
  public_url?: string | null;
}

export interface DashboardData {
  total_forms: number;
  published_forms: number;
  draft_forms: number;
  total_responses: number;
  forms: FormSummary[];
}

export interface ResponseValue {
  field_id: number;
  field_label?: string | null;
  field_type?: string | null;
  value_text?: string | null;
  value_json?: any;
  document_ref?: string | null;
  document_url?: string | null;
}

export interface FormResponse {
  id: number;
  form_id: number;
  form_title?: string | null;
  form_version: number;
  office_id?: string | null;
  submitted_by?: string | null;
  source: 'INTERNAL' | 'PUBLIC';
  geo_lat?: number | null;
  geo_lng?: number | null;
  submitted_at: string;
  values: ResponseValue[];
}

export interface ResponseSummary {
  id: number;
  form_id: number;
  office_id?: string | null;
  submitted_by?: string | null;
  source: 'INTERNAL' | 'PUBLIC';
  submitted_at: string;
}

export interface PageResult<T> {
  content: T[];
  total: number;
  page: number;
  size: number;
}

// Valor emitido por el renderer: escalar (value) o archivo (file) por campo.
export interface FieldValue {
  field_id: number;
  value?: string | null;
  value_json?: any;
  file?: File | null;
}

// Paleta del constructor (mapea 1:1 con los cuadros de la izquierda del screenshot).
export interface PaletteItem {
  type: FieldType;
  label: string;
  icon: string;
  enabled: boolean;   // en el primer slice se habilitan 6 tipos; el resto queda visible pero deshabilitado
}

export const PALETTE: PaletteItem[] = [
  { type: 'texto_corto',       label: 'Texto corto',       icon: 'title',                 enabled: true },
  { type: 'texto_largo',       label: 'Texto largo',       icon: 'notes',                 enabled: true },
  { type: 'numero',            label: 'Número',             icon: 'pin',                   enabled: true },
  { type: 'seleccion_unica',   label: 'Selección única',   icon: 'radio_button_checked',  enabled: true },
  { type: 'foto',              label: 'Foto',              icon: 'photo_camera',          enabled: true },
  { type: 'archivo',           label: 'Archivos',          icon: 'upload_file',           enabled: true },
  { type: 'fecha',             label: 'Fecha',             icon: 'event',                 enabled: false },
  { type: 'hora',              label: 'Hora',              icon: 'schedule',              enabled: false },
  { type: 'video',             label: 'Video',             icon: 'videocam',              enabled: false },
  { type: 'moneda',            label: 'Moneda',            icon: 'payments',              enabled: false },
  { type: 'calificacion',      label: 'Calificación',      icon: 'star',                  enabled: false },
  { type: 'lista',             label: 'Lista desplegable', icon: 'list',                  enabled: false },
  { type: 'seleccion_multiple',label: 'Selección múltiple',icon: 'check_box',             enabled: false },
  { type: 'comentario',        label: 'Comentario',        icon: 'sticky_note_2',         enabled: false },
  { type: 'seccion',           label: 'Sección',           icon: 'view_agenda',           enabled: false },
  { type: 'gps',               label: 'Ubicación (GPS)',   icon: 'location_on',           enabled: false },
  { type: 'firma',             label: 'Firma Digital',     icon: 'draw',                  enabled: false },
];

export function paletteLabel(type: FieldType): string {
  return PALETTE.find(p => p.type === type)?.label ?? type;
}

export function defaultFieldLabel(type: FieldType): string {
  return paletteLabel(type);
}

// ── Carga por Excel ──────────────────────────────────────────────────────────
// La plantilla se baja YA parametrizada (módulo, oficinas, roles y visibilidad) y al
// subirla llena el backend devuelve lo leído SIN guardar nada: lo que vuelve se vuelca
// en el constructor para revisarlo antes de crear.

/** Referencia a un catálogo externo (sede o rol): el id viaja para volver intacto. */
export interface ImportRef {
  id: string;
  name: string;
}

/** Lo que se define ANTES de descargar la plantilla. */
export interface OfficeTemplateConfig {
  mode: 'individual' | 'masivo';
  forms_count?: number;
  title?: string;
  description?: string;
  parent_module?: string;
  visibility?: Visibility;
  offices?: ImportRef[];
  view_roles?: ImportRef[];
  respond_roles?: ImportRef[];
  include_examples?: boolean;
}

/** Un formulario leído del archivo, listo para create + setFields + setOffices + setAccess. */
export interface OfficeImportedForm {
  /** Código de la columna «Formulario» del Excel (F1, F2...). */
  row_code: string;
  title: string;
  description?: string | null;
  parent_module?: string | null;
  visibility: Visibility;
  fields: FormFieldDef[];
  office_ids: string[];
  office_names: string[];
  view_roles: ImportRef[];
  respond_roles: ImportRef[];
  /** Bloqueantes: mientras haya uno, este formulario no se puede crear. */
  errors: string[];
  warnings: string[];
  fields_count: number;
  valid: boolean;
}

export interface OfficeImportResult {
  forms: OfficeImportedForm[];
  errors: string[];
  warnings: string[];
  total_forms: number;
  valid_forms: number;
  total_fields: number;
}

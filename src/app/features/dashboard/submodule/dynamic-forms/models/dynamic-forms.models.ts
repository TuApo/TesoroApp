/**
 * Modelos de Formularios Dinámicos. El API (ms-forms, /api/dynamic-forms) habla
 * snake_case — convención JSON de toda la plataforma — así que las interfaces
 * espejan el wire format tal cual (sin capas de mapeo ni shapes alternativos).
 * Contrato ÚNICO y tipado: nada de `any` en el dominio.
 *
 * Los tipos a nivel de CAMPO (DynamicField, FieldSchema, DocumentRef, FieldValue...)
 * viven en shared/components/forms/field.model.ts porque los componentes de campo
 * compartidos también los usan; aquí se re-exportan para tener un import único.
 */

export * from '@/app/shared/components/forms/field.model';

import { DynamicField, FieldSchema, FieldType, FieldValue } from '@/app/shared/components/forms/field.model';
import { PlacementStatus } from './placement.models';
import { FormAccessConfig } from './process.models';

export type { PlacementStatus } from './placement.models';

export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type VersionStatus = 'PUBLISHED' | 'DEPRECATED';

export interface FormSection {
  code?: string;
  title?: string | null;
  order_no: number;
  /**
   * Ruta de respuestas: a dónde ir al TERMINAR esta sección cuando ninguna regla de
   * campo dispara. null/ausente = la siguiente por orden · '<code>' de una sección
   * posterior · 'END' para terminar ahí el formulario.
   */
  next_section?: string | null;
  fields: DynamicField[];
}

export interface VersionInfo {
  id: number;
  version: number;
  status: VersionStatus;
  published_at: string | null;
  created_by?: string | null;
  submissions_count?: number;
}

/**
 * Tema de diseño de un formulario (df_form.ui_json → theme). Todos los campos son
 * opcionales: lo que falte lo pone el tema por defecto de la plataforma.
 * Los colores son hex (#rrggbb) porque terminan como custom properties de CSS.
 */
export interface FormTheme {
  /** Identificador del preset elegido en el constructor (solo informativo). */
  preset?: string;
  /** Color de acción (botones) y el texto que va ENCIMA de él. */
  primary?: string;
  on_primary?: string;
  accent?: string;
  /** Fondo de las tarjetas y fondo de la página. */
  surface?: string;
  bg?: string;
  text?: string;
  /** Degradado de la cabecera. */
  header_from?: string;
  header_to?: string;
  header_style?: 'gradient' | 'solid' | 'image';
  /** Material Symbol (snake_case) del icono de la cabecera. */
  icon?: string;
  /** Radio de esquina en px (0–32). */
  radius?: number;
  density?: 'comoda' | 'compacta';
  /** Portada: URL absoluta/relativa, o documento de ms-documents (se baja como blob). */
  cover_url?: string;
  cover_document_id?: number;
  cover_alt?: string;
}

/** Cómo se recorre el formulario al llenarlo. */
export interface FormNavigation {
  /** 'wizard' = una sección por paso; 'single' = todo de corrido. */
  mode?: 'wizard' | 'single';
  /** Mostrar la barra de progreso del asistente. */
  progress?: boolean;
}

/** Bloque `ui` que viaja en el detalle y en la estructura del formulario. */
export interface FormUi {
  theme?: FormTheme;
  navigation?: FormNavigation;
}

export interface FormStructure {
  form_id: number;
  form_code: string;
  form_name: string;
  form_description?: string | null;
  /** Tema + navegación (V10 de ms-forms). Ausente ⇒ look y recorrido por defecto. */
  ui?: FormUi | null;
  version: VersionInfo;
  sections: FormSection[];
}

export interface FormSummary {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  module_id?: string | null;
  responses_module_id?: string | null;
  owner_user_id: string;
  active: boolean;
  is_public: boolean;
  current_version?: number | null;
  submissions_count: number;
  created_at: string;
  updated_at?: string | null;

  // ── Resumen IA (columna "Resumen IA" del listado) ────────────────────
  // El backend devuelve el ÚLTIMO generado: se mantiene tal cual hasta que
  // alguien pida uno nuevo (regenerar cuesta una llamada al modelo).
  /** De qué trata el formulario. Null = nunca se ha generado. */
  ai_summary?: string | null;
  /** Qué se observa en las respuestas ya registradas. */
  ai_responses_summary?: string | null;
  ai_summary_at?: string | null;
  /** Respuestas que había al generarlo: si hoy hay más, está desactualizado. */
  ai_summary_submissions?: number | null;

  // ── Ubicación en el menú (VISTA de un módulo anfitrión) ──────────────
  // El listado los trae inline para pintar la columna "Ubicación" sin pedir el
  // placement fila a fila. Opcionales: un summary viejo/UNLINKED puede no traerlos.
  /** Estado de la ubicación en el menú. Ausente ⇒ tratar como PENDING. */
  placement_status?: PlacementStatus | null;
  /** Módulo padre bajo el que cuelga la entrada de menú (si LINKED). */
  parent_module_id?: string | null;
  /** Ruta bajo /dashboard de la entrada publicada (si LINKED). */
  route_path?: string | null;
  /** Etiqueta con la que aparece en el menú. */
  menu_label?: string | null;
  /** Motivo del último fallo de aprovisionamiento (si FAILED). */
  placement_error?: string | null;
}

export interface FormDetail extends FormSummary {
  /** Tema + navegación; el constructor lo edita y lo reenvía. */
  ui?: FormUi | null;
  client_id?: string | null;
  created_by?: string | null;
  /** ok | partial | failed | skipped — resultado del aprovisionamiento de módulos. */
  provisioning?: string | null;
}

/** Respuesta del endpoint de resumen IA (/forms/{id}/ai-summary). */
export interface AiSummary {
  form_id: number;
  summary?: string | null;
  responses_summary?: string | null;
  generated_at?: string | null;
  generated_by?: string | null;
  submissions_count?: number | null;
  version?: number | null;
  model?: string | null;
  /** true = llegaron respuestas después de generarlo (el texto sigue vigente). */
  stale: boolean;
}

export interface FieldTypeInfo {
  code: FieldType;
  name: string;
  description?: string | null;
  icon: string;
  default_config: FieldSchema;
  order_no: number;
}

export interface PageResult<T> {
  content: T[];
  total: number;
  page: number;
  size: number;
}

/** { [sectionCode]: { [fieldName]: valor } } */
export type SubmissionPayload = Record<string, Record<string, FieldValue>>;

export interface Submission {
  id: number;
  form_id: number;
  form_code?: string | null;
  form_name?: string | null;
  version_id: number;
  version?: number | null;
  status: SubmissionStatus;
  payload: SubmissionPayload;
  submitted_at: string | null;
  created_by: string | null;
  public_link_id: number | null;
  created_at: string;
  updated_at?: string | null;
}

export interface PublicLink {
  id: number;
  form_id: number;
  token: string;
  url: string;
  expires_at: string | null;
  max_submissions: number | null;
  submissions_count: number;
  revoked_at: string | null;
  created_at: string;
}

export interface DailyPoint {
  date: string;
  total: number;
}

export interface FieldStats {
  section: string;
  name: string;
  label: string;
  type: FieldType;
  distribution?: Record<string, number> | null;
  avg?: number | null;
  min?: number | null;
  max?: number | null;
  answered: number;
}

/** Granularidad de la línea de tiempo de la analítica. */
export type AnalyticsGranularity = 'day' | 'hour';

/** Punto de la línea de tiempo: instante local ISO (yyyy-MM-ddTHH:mm). */
export interface SeriesPoint {
  bucket: string;
  total: number;
}

/** Respuestas recibidas en cada hora del día (0..23), sumando todo el rango. */
export interface HourPoint {
  hour: number;
  total: number;
}

export interface FormAnalytics {
  form_id: number;
  total_submissions: number;
  by_status: Record<string, number>;
  daily: DailyPoint[];
  granularity?: AnalyticsGranularity;
  series?: SeriesPoint[];
  hour_of_day?: HourPoint[];
  fields: FieldStats[];
}

export interface ProvisioningResult {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  module_id?: string | null;
  responses_module_id?: string | null;
  warnings?: string[];
}

// ---------- Requests ----------

export interface BuilderRequest {
  name: string;
  description?: string | null;
  category?: string | null;
  is_public?: boolean;
  client_id?: string | null;
  menu_parent_module_id?: string | null;
  fill_role_ids?: string[];
  /** Tema + navegación; viaja con el guardado del constructor. */
  ui?: FormUi | null;
  /**
   * Permisos por rol y control del proceso (V14). Se definen AL CREAR el formulario y
   * viajan con la estructura; omitirlo deja el formulario en modo OWNER, como siempre.
   */
  access?: FormAccessConfig | null;
  sections: FormSection[];
}

export interface FormPatchRequest {
  name?: string;
  description?: string | null;
  category?: string | null;
  is_public?: boolean;
  active?: boolean;
}

export interface SubmissionCreateRequest {
  status?: SubmissionStatus;
  payload: SubmissionPayload;
}

export interface PublicLinkCreateRequest {
  expires_in_days?: number | null;
  max_submissions?: number | null;
}

/** Error RFC 7807 que devuelve el backend (propiedad code = código de negocio df_*). */
export interface ApiProblem {
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  errors?: Array<{ section: string; field: string; code: string; message: string }>;
}

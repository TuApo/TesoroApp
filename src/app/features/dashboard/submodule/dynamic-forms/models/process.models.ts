/**
 * PERMISOS y CONTROL DEL PROCESO (ms-forms V14, sujetos en V18).
 *
 * Wire format snake_case tal cual, como el resto del dominio: sin capa de mapeo.
 *
 * Dos cosas distintas que conviene no confundir:
 *  · `FormAccess`      — lo que puede el usuario ACTUAL. Gobierna qué pestañas y botones
 *                        se pintan. Lo devuelve el backend ya resuelto.
 *  · `FormAccessConfig`— la CONFIGURACIÓN completa de permisos. Solo la ve quien gestiona
 *                        el formulario; es lo que se edita en el constructor.
 */

import { SubmissionStatus } from './dynamic-forms.models';

// ---------- Permisos ----------

/** OWNER: solo el dueño y los admins gestionan. ROLES: mandan las reglas por rol. */
export type AccessMode = 'OWNER' | 'ROLES';

/** Lo que puede hacer el usuario actual sobre un formulario. */
export interface FormAccess {
  form_id: number;
  access_mode: AccessMode;
  /** Rol con el que se resolvió (para explicar un "no puedes"). */
  role?: string | null;
  can_manage: boolean;
  can_fill: boolean;
  can_view_responses: boolean;
  can_edit_responses: boolean;
  can_review: boolean;
  can_view_supports: boolean;
  can_view_analytics: boolean;
  can_process: boolean;
  can_bulk_load: boolean;
  can_export: boolean;
  process_enabled: boolean;
  process_key_field?: string | null;
  allow_edit_submitted: boolean;
  /** Columnas que puede escribir ("seccion__campo"); null = todas. */
  editable_fields?: string[] | null;
  /** Columnas que puede leer; null = todas. */
  visible_fields?: string[] | null;
}

/**
 * A QUIÉN apunta una regla de permisos (ms-forms V18).
 *
 * Antes solo se podía conceder por ROL, que es un contrato de permisos y no sirve para
 * acotar por finca, por empresa usuaria, por oficina ni por una persona. Ahora el sujeto
 * es una dimensión más de la misma regla, así que "quién entra" y "qué puede hacer" se
 * configuran juntos en una sola pantalla.
 *
 *  · ROL     — se compara con el rol del JWT (no cuesta una llamada de red).
 *  · GRUPO   — grupo/etiqueta de ms-auth-admin: finca, empresa usuaria o etiqueta libre.
 *  · SEDE    — la OFICINA: la sede que el usuario ya tiene asignada.
 *  · USUARIO — una persona concreta.
 */
export type SubjectKind = 'ROL' | 'GRUPO' | 'SEDE' | 'USUARIO';

/** Cómo se llama cada sujeto en la pantalla. */
export const NOMBRE_SUJETO: Record<SubjectKind, string> = {
  ROL: 'Rol',
  GRUPO: 'Grupo o finca',
  SEDE: 'Oficina',
  USUARIO: 'Persona',
};

/** Icono Material Symbols de cada sujeto. */
export const ICONO_SUJETO: Record<SubjectKind, string> = {
  ROL: 'badge',
  GRUPO: 'sell',
  SEDE: 'location_city',
  USUARIO: 'person',
};

/** Una regla de permisos: a quién apunta y qué puede hacer. */
export interface FormAccessRule {
  id?: number;
  /** Ausente = ROL (así viajaban todas las reglas antes de V18). */
  subject_kind?: SubjectKind;
  /** UUID en db_admin del rol / grupo / sede / persona. */
  subject_ref?: string | null;
  /** Nombre legible guardado al configurar; puede quedar viejo si lo renombran allá. */
  subject_label?: string | null;
  role_id?: string | null;
  /** Solo en las reglas de ROL: es la clave con la que se compara contra el JWT. */
  role_name?: string | null;
  can_fill: boolean;
  can_view_responses: boolean;
  can_edit_responses: boolean;
  can_review: boolean;
  can_view_supports: boolean;
  can_view_analytics: boolean;
  can_process: boolean;
  can_bulk_load: boolean;
  can_export: boolean;
  editable_fields?: string[] | null;
  visible_fields?: string[] | null;
}

/** Configuración completa: modo, proceso y todas las reglas (de cualquier sujeto). */
export interface FormAccessConfig {
  form_id?: number;
  access_mode: AccessMode;
  process_enabled: boolean;
  process_key_field?: string | null;
  allow_edit_submitted: boolean;
  rules: FormAccessRule[];
  /** Columnas del formulario, para marcar cuáles puede llenar cada rol. */
  columns?: FormColumn[];
}

/** Una columna del formulario: la unidad con la que se conceden permisos y se cruzan masivos. */
export interface FormColumn {
  /** "seccion__campo": el name de un campo solo es único dentro de su sección. */
  key: string;
  section: string;
  section_title?: string | null;
  name: string;
  label: string;
  type: string;
  required: boolean;
}

// ---------- Control del proceso ----------

/** Una fila de la tabla de seguimiento. */
export interface ProcessRecord {
  id: number;
  version?: number | null;
  version_id: number;
  status: SubmissionStatus;
  /** Valor del campo llave del formulario (cédula, contrato…), si hay llave. */
  record_key?: string | null;
  revision_no: number;
  /** true si el registro se tocó DESPUÉS de enviarse. */
  changed: boolean;
  last_change_at?: string | null;
  last_change_by?: string | null;
  submitted_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  /** Valores por columna, ya recortados a lo que el usuario puede leer. */
  values: Record<string, unknown>;
}

export interface ProcessSummary {
  form_id: number;
  total: number;
  drafts: number;
  submitted: number;
  approved: number;
  rejected: number;
  /** Registros tocados después de enviarse. */
  changed: number;
  revisions: number;
  last_change_at?: string | null;
  batches: number;
}

/** Un cambio concreto dentro de una revisión. */
export interface FieldChange {
  field: string;
  section?: string | null;
  label?: string | null;
  before?: string | null;
  after?: string | null;
}

export type RevisionAction = 'CREATE' | 'UPDATE' | 'STATUS' | 'DELETE';
export type RevisionSource = 'UI' | 'BULK' | 'PUBLIC' | 'API';

/** Una escritura sobre un registro. */
export interface Revision {
  id: number;
  submission_id: number;
  revision_no: number;
  action: RevisionAction;
  source: RevisionSource;
  status_before?: string | null;
  status_after?: string | null;
  changes: FieldChange[];
  changed_by?: string | null;
  changed_at: string;
  batch_id?: number | null;
  note?: string | null;
}

// ---------- Carga masiva ----------

export type BulkMode = 'CREATE' | 'UPDATE' | 'UPSERT';
export type BulkOutcome = 'CREATE' | 'UPDATE' | 'NO_CHANGE' | 'ERROR';

/** Diagnóstico de UNA fila del archivo, antes de aplicar nada. */
export interface BulkRow {
  row_number: number;
  outcome: BulkOutcome;
  submission_id?: number | null;
  /** 'id' | 'llave' — con qué cruzó contra la base. */
  matched_by?: string | null;
  record_key?: string | null;
  changes: FieldChange[];
  errors: string[];
  /** Columnas que venían en la fila pero el rol no puede escribir. */
  ignored_columns: string[];
}

export interface BulkPreview {
  form_id: number;
  version?: number | null;
  mode: BulkMode;
  total_rows: number;
  to_create: number;
  to_update: number;
  no_change: number;
  with_errors: number;
  /** Columnas del archivo que no corresponden a ningún campo. */
  unknown_columns: string[];
  rows: BulkRow[];
}

export interface BulkApplyResult {
  batch_id: number;
  form_id: number;
  mode: BulkMode;
  total_rows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  failed: BulkRow[];
}

/** Un lote ya aplicado (historial de cargas). */
export interface BulkBatch {
  id: number;
  form_id: number;
  mode: BulkMode;
  filename?: string | null;
  total_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  uploaded_by?: string | null;
  created_at: string;
}

/** Petición de preview/aplicar: filas ya tabuladas por el navegador. */
export interface BulkRequest {
  mode: BulkMode;
  filename?: string;
  rows: Record<string, string>[];
}

// ---------- Helpers de presentación ----------

/** Etiqueta legible de cada capacidad, para la matriz de permisos del constructor. */
export const CAPACIDADES: ReadonlyArray<{
  key: keyof FormAccessRule;
  label: string;
  hint: string;
}> = [
  { key: 'can_fill', label: 'Llenar', hint: 'Ver el formulario y responderlo' },
  { key: 'can_view_responses', label: 'Ver respuestas', hint: 'Pestaña Respuestas' },
  { key: 'can_edit_responses', label: 'Editar registros', hint: 'Corregir respuestas ya enviadas' },
  { key: 'can_review', label: 'Aprobar / rechazar', hint: 'Decidir sobre una respuesta enviada' },
  { key: 'can_view_supports', label: 'Soportes', hint: 'Pestaña Soportes (archivos adjuntos)' },
  { key: 'can_view_analytics', label: 'Analítica', hint: 'Pestaña Analítica' },
  { key: 'can_process', label: 'Control del proceso', hint: 'Pestaña de seguimiento del dato' },
  { key: 'can_bulk_load', label: 'Carga masiva', hint: 'Subir archivos para crear o corregir en bloque' },
  { key: 'can_export', label: 'Exportar', hint: 'Descargar el Excel con respuestas e historial' },
] as const;

/**
 * Clave estable de una regla dentro de la pantalla. No sirve el nombre del rol: dos
 * sujetos distintos (un rol y una finca) pueden llamarse igual, y un grupo ni siquiera
 * tiene nombre de rol.
 */
export function claveRegla(r: FormAccessRule): string {
  const kind = r.subject_kind ?? 'ROL';
  return `${kind}|${r.subject_ref ?? (r.role_name ?? '').toLowerCase()}`;
}

/** Nombre a mostrar de una regla, con el respaldo de las reglas anteriores a V18. */
export function nombreRegla(r: FormAccessRule): string {
  return r.subject_label || r.role_name || r.subject_ref || 'sin nombre';
}

/** Regla nueva con lo mínimo: el sujeto solo llena el formulario. */
export function reglaVacia(
  label: string,
  refId?: string | null,
  kind: SubjectKind = 'ROL',
): FormAccessRule {
  return {
    subject_kind: kind,
    subject_ref: refId ?? null,
    subject_label: label,
    // role_id/role_name solo tienen sentido en las reglas de rol: es por NOMBRE como el
    // servidor las compara contra el JWT sin salir a la red.
    role_id: kind === 'ROL' ? (refId ?? null) : null,
    role_name: kind === 'ROL' ? label : null,
    can_fill: true,
    can_view_responses: false,
    can_edit_responses: false,
    can_review: false,
    can_view_supports: false,
    can_view_analytics: false,
    can_process: false,
    can_bulk_load: false,
    can_export: false,
    editable_fields: null,
    visible_fields: null,
  };
}

/** Acceso "puede todo": el que asume el front mientras el backend responde. */
export function accesoDeGestor(formId: number): FormAccess {
  return {
    form_id: formId,
    access_mode: 'OWNER',
    can_manage: true,
    can_fill: true,
    can_view_responses: true,
    can_edit_responses: true,
    can_review: true,
    can_view_supports: true,
    can_view_analytics: true,
    can_process: false,
    can_bulk_load: false,
    can_export: true,
    process_enabled: false,
    allow_edit_submitted: false,
    editable_fields: null,
    visible_fields: null,
  };
}

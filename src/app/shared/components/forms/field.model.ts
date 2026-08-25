/**
 * Modelo de CAMPO de Formularios Dinámicos, a nivel shared para que los componentes
 * de campo (shared/components/forms/<tipo>/) no dependan del submódulo del dashboard.
 * El wire format del API es snake_case; estas interfaces lo espejan tal cual.
 */

export type FieldType =
  | 'TEXT_SHORT' | 'TEXT_LONG' | 'DATE' | 'TIME' | 'NUMBER' | 'CURRENCY' | 'RATING'
  | 'SINGLE_CHOICE' | 'DROPDOWN' | 'MULTIPLE_CHOICE'
  | 'PHOTO' | 'VIDEO' | 'FILE' | 'SIGNATURE' | 'LOCATION' | 'COMMENT' | 'SECTION'
  | 'SCAN_DOC' | 'SCAN_ID';

/** Tipos cuyo valor son referencias a documentos de ms-documents. */
export const TIPOS_ARCHIVO: readonly FieldType[] =
  ['PHOTO', 'VIDEO', 'FILE', 'SIGNATURE', 'SCAN_DOC', 'SCAN_ID'] as const;

/** Tipos que se capturan con el escáner (frente/reverso o documento libre). */
export function esTipoEscaneo(type: FieldType): boolean {
  return type === 'SCAN_DOC' || type === 'SCAN_ID';
}

export interface FieldValidation {
  required?: boolean;
  min_length?: number | null;
  max_length?: number | null;
  min_value?: number | null;
  max_value?: number | null;
  min_date?: string | null;
  max_date?: string | null;
  min_time?: string | null;
  max_time?: string | null;
  min_selected?: number | null;
  max_selected?: number | null;
  max_files?: number | null;
  max_size_mb?: number | null;
  allowed_extensions?: string[];
  format?: string;
}

export interface FieldOption {
  value: string;
  label: string;
}

/**
 * RUTA DE RESPUESTAS de un campo de selección única (SINGLE_CHOICE / DROPDOWN con
 * opciones estáticas): "si responde X, salta a la sección Y".
 *
 * `option` cita el `value` de la opción; `go_to` es el `code` de una sección POSTERIOR
 * o 'END' (terminar el formulario ahí). Vacío = seguir el recorrido normal. La primera
 * regla que case gana. Solo hacia adelante: el servidor lo exige al publicar, así el
 * recorrido siempre termina y el formulario nunca queda imposible de enviar.
 */
export interface FieldRoutingRule {
  option: string;
  go_to: string;
}

export interface FieldRouting {
  rules: FieldRoutingRule[];
}

/** Destino especial de una ruta: terminar el formulario. */
export const FIN_DEL_FORMULARIO = 'END';

export interface RatingConfig {
  scale_max: number;
  mode: 'NUMERIC' | 'STARS';
  show_labels: boolean;
  labels?: Record<string, string>;
}

export interface FieldSchema {
  placeholder?: string;
  description?: string;
  /** Solo COMMENT: texto fijo a mostrar. */
  text?: string;
  options?: FieldOption[];
  /**
   * Campos de selección: las opciones salen de una TABLA PARAMETRIZADA en vez de
   * `options`. La lista y sus reglas (empresa, sede, rol, permisos) las resuelve el
   * servidor al llenar, así que en cliente NO se juzga si el valor pertenece a ella.
   */
  options_source?: { source: string; parent_field?: string | null };
  rating_config?: RatingConfig;
  /** Ruta de respuestas (solo selección única con opciones estáticas). */
  routing?: FieldRouting;
  ui?: { variant?: string; full_width?: boolean };
  validation?: FieldValidation;
}

export interface DynamicField {
  id?: number;
  /** Clave dentro del payload (el backend la genera desde el label si falta). */
  name?: string;
  label: string;
  type: FieldType;
  order_no: number;
  required: boolean;
  schema: FieldSchema;
  /** Solo SECTION (un nivel de anidación). */
  children?: DynamicField[];
}

export interface DocumentRef {
  source: 'ms-documents';
  document_id: number;
  filename: string;
  mime_type: string;
  size: number;
}

export interface LocationValue {
  lat: number;
  lng: number;
  timestamp?: string;
}

export type FieldValue =
  | string
  | number
  | string[]
  | DocumentRef
  | DocumentRef[]
  | LocationValue
  | null;

/**
 * Modos del contrato uniforme de los componentes de campo:
 *  - 'config'   → tarjeta editable del builder (label, opciones, validaciones)
 *  - 'preview'  → control INTERACTIVO (preview del builder y llenado real)
 *  - 'readonly' → detalle de una respuesta, pintado por TIPO REAL (nunca heurísticas
 *                 por nombre de clave: esa fue la trampa PHOTO del sistema origen)
 */
export type FieldMode = 'config' | 'preview' | 'readonly';

/**
 * Máximo de archivos por defecto POR TIPO cuando el schema no fija max_files. DEBE
 * coincidir con los componentes de campo y con el backend (SchemaValidator): FILE=5,
 * el resto=1. Un desajuste bloqueaba el envío de un FILE multi-archivo por defecto.
 */
export function defaultMaxFiles(type: FieldType): number {
  return type === 'FILE' ? 5 : 1;
}

/** Extensión de archivo (minúsculas, sin punto) o cadena vacía. */
export function fileExtension(filename: string | undefined | null): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.substring(dot + 1).toLowerCase();
}

/** Normaliza el valor de un campo de archivos a lista (el API acepta objeto o array). */
export function asDocumentRefs(value: FieldValue): DocumentRef[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return (value as unknown[]).filter(isDocumentRef) as DocumentRef[];
  }
  return isDocumentRef(value) ? [value] : [];
}

export function isDocumentRef(v: unknown): v is DocumentRef {
  return !!v && typeof v === 'object' && (v as DocumentRef).source === 'ms-documents'
    && typeof (v as DocumentRef).document_id === 'number';
}

/**
 * Validación CLIENTE de un valor contra su campo — espejo del SchemaValidator del
 * backend (que es el que manda). Devuelve el mensaje de error o null si es válido.
 * Se usa para marcar errores en vivo y hacer scroll al primer inválido; jamás
 * sustituye la validación del servidor.
 */
export function validateFieldValue(field: DynamicField, value: FieldValue): string | null {
  const type = field.type;
  if (type === 'COMMENT' || type === 'SECTION') return null;
  const val = field.schema?.validation ?? {};
  const empty = value == null
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
  if (empty) {
    return field.required ? 'Este campo es obligatorio' : null;
  }
  switch (type) {
    case 'TEXT_SHORT':
    case 'TEXT_LONG': {
      const s = String(value);
      if (val.min_length != null && s.length < val.min_length) return `Mínimo ${val.min_length} caracteres`;
      if (val.max_length != null && s.length > val.max_length) return `Máximo ${val.max_length} caracteres`;
      return null;
    }
    case 'DATE': {
      const s = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Fecha inválida (YYYY-MM-DD)';
      if (val.min_date && s < val.min_date) return `No puede ser anterior a ${val.min_date}`;
      if (val.max_date && s > val.max_date) return `No puede ser posterior a ${val.max_date}`;
      return null;
    }
    case 'TIME': {
      const s = String(value);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return 'Hora inválida (HH:mm)';
      if (val.min_time && s < val.min_time) return `No puede ser antes de ${val.min_time}`;
      if (val.max_time && s > val.max_time) return `No puede ser después de ${val.max_time}`;
      return null;
    }
    case 'NUMBER':
    case 'CURRENCY': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return 'Debe ser un número';
      if (val.min_value != null && n < val.min_value) return `Debe ser ≥ ${val.min_value}`;
      if (val.max_value != null && n > val.max_value) return `Debe ser ≤ ${val.max_value}`;
      return null;
    }
    case 'RATING': {
      const scale = field.schema?.rating_config?.scale_max ?? 5;
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(n) || n < 0 || n > scale) return `Debe estar entre 0 y ${scale}`;
      return null;
    }
    case 'SINGLE_CHOICE':
    case 'DROPDOWN': {
      // Con origen dinámico la lista válida vive en el servidor (y depende de quién
      // llena): comprobarla contra `options` marcaría como inválido lo que sí lo es.
      if (field.schema?.options_source?.source) return null;
      const labels = (field.schema?.options ?? []).map(o => o.label);
      return labels.includes(String(value)) ? null : 'Opción inválida';
    }
    case 'MULTIPLE_CHOICE': {
      if (!Array.isArray(value)) return 'Selección inválida';
      const dynamic = !!field.schema?.options_source?.source;
      const labels = new Set((field.schema?.options ?? []).map(o => o.label));
      if (!dynamic && (value as string[]).some(v => !labels.has(v))) return 'Opción inválida';
      if (val.min_selected != null && value.length < val.min_selected) return `Selecciona al menos ${val.min_selected}`;
      if (val.max_selected != null && value.length > val.max_selected) return `Máximo ${val.max_selected} opciones`;
      return null;
    }
    case 'PHOTO':
    case 'VIDEO':
    case 'FILE':
    case 'SIGNATURE':
    case 'SCAN_DOC':
    case 'SCAN_ID': {
      const refs = asDocumentRefs(value);
      if (refs.length === 0) return field.required ? 'Este campo es obligatorio' : null;
      const maxFiles = val.max_files ?? defaultMaxFiles(type);
      if (refs.length > maxFiles) return `Máximo ${maxFiles} archivo(s)`;
      return null;
    }
    case 'LOCATION': {
      const loc = value as LocationValue;
      if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return 'Ubicación inválida';
      if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) return 'Coordenadas fuera de rango';
      return null;
    }
    default:
      return null;
  }
}

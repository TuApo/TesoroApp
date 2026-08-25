import { DynamicField, FieldOption, FieldSchema, FieldType, FormSection } from './dynamic-forms.models';

/**
 * BORRADOR de contenido de un formulario: la forma COMPACTA con la que se describe
 * "qué se pregunta", sin el ruido del modelo real (order_no, schema anidado, name…).
 *
 * Una sola forma para las dos fuentes que hoy proponen contenido —las plantillas de
 * la plataforma y lo que devuelve la IA—, así el constructor tiene UN solo camino de
 * entrada: borrador → `seccionesDesdeBorrador()` → estado del builder. Lo que se
 * guarde después pasa igual por el StructureValidator de ms-forms.
 */
export interface CampoBorrador {
  label: string;
  type: FieldType;
  required?: boolean;
  /** Ayuda bajo la pregunta (y, en COMMENT, el texto que se muestra). */
  description?: string;
  placeholder?: string;
  /** Solo tipos de selección: texto suelto o {value,label} ya armado. */
  options?: Array<string | FieldOption>;
  /** Solo COMMENT: el texto informativo. Si falta se usa `description` o el label. */
  text?: string;
  /** Solo RATING. */
  rating?: { scale_max?: number; mode?: 'NUMERIC' | 'STARS' };
}

export interface SeccionBorrador {
  titulo: string;
  campos: CampoBorrador[];
}

/**
 * Lo que se le cuenta a la IA del formulario que se está armando: de qué trata y qué
 * pregunta ya. Nunca viajan respuestas de nadie — solo la estructura.
 */
export interface ContextoFormulario {
  nombre: string;
  descripcion: string;
  categoria: string;
  /** Títulos de las secciones actuales, en orden. */
  secciones: string[];
  /** Preguntas actuales en texto ("Sección - Etiqueta (tipo)"). */
  contenido: string[];
}

const TIPOS_OPCIONES: ReadonlySet<FieldType> = new Set<FieldType>([
  'SINGLE_CHOICE', 'DROPDOWN', 'MULTIPLE_CHOICE',
]);

/** Slug snake_case sin acentos — mismo criterio que el backend usa para los `name`. */
function slug(texto: string): string {
  const s = (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^\d/.test(s) ? `o_${s}` : s;
}

/**
 * Opciones normalizadas: `value` en snake_case y único dentro del campo (ms-forms
 * además exige `label` no repetido, así que los duplicados se descartan aquí).
 */
function opcionesDesdeBorrador(opciones: Array<string | FieldOption>): FieldOption[] {
  const out: FieldOption[] = [];
  const labels = new Set<string>();
  const values = new Set<string>();
  for (const o of opciones) {
    const label = (typeof o === 'string' ? o : o?.label ?? '').trim();
    if (!label || labels.has(label.toLowerCase())) continue;
    labels.add(label.toLowerCase());
    const base = (typeof o === 'string' ? '' : o?.value ?? '').trim() || slug(label) || 'opt';
    let value = base;
    let i = 2;
    while (values.has(value)) value = `${base}_${i++}`;
    values.add(value);
    out.push({ value, label });
  }
  return out;
}

/** Un campo del borrador con la forma real que edita el constructor. */
export function campoDesdeBorrador(c: CampoBorrador, orden = 0): DynamicField {
  const schema: FieldSchema = {};
  const ayuda = c.description?.trim();
  if (ayuda) schema.description = ayuda;
  const placeholder = c.placeholder?.trim();
  if (placeholder) schema.placeholder = placeholder;

  if (TIPOS_OPCIONES.has(c.type)) {
    const opciones = opcionesDesdeBorrador(c.options ?? []);
    // Un campo de selección sin opciones no se puede publicar: mejor una opción de
    // arranque visible que un formulario que revienta al guardar.
    schema.options = opciones.length ? opciones : [{ value: 'opt_1', label: 'Opción 1' }];
  }
  if (c.type === 'RATING') {
    schema.rating_config = {
      scale_max: c.rating?.scale_max ?? 5,
      mode: c.rating?.mode ?? 'STARS',
      show_labels: false,
    };
  }
  if (c.type === 'COMMENT') {
    schema.text = (c.text ?? ayuda ?? c.label).trim();
  }

  return {
    label: c.label.trim(),
    type: c.type,
    order_no: orden + 1,
    // COMMENT no recoge valor: marcarlo obligatorio no significa nada.
    required: c.type === 'COMMENT' ? false : !!c.required,
    schema,
  };
}

/** Secciones del builder a partir de un borrador (plantilla o propuesta de la IA). */
export function seccionesDesdeBorrador(secciones: SeccionBorrador[]): FormSection[] {
  const utiles = secciones.filter(s => (s.campos?.length ?? 0) > 0);
  return utiles.map((s, i) => ({
    order_no: i + 1,
    title: s.titulo?.trim() || `Sección ${i + 1}`,
    fields: s.campos.map((c, k) => campoDesdeBorrador(c, k)),
  }));
}

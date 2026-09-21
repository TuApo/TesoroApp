/**
 * Reglas de lo que un CASO (módulo de turnos) guarda del pipeline y de cómo se vuelve a él.
 *
 * Un caso del pipeline no es una foto de los campos: es LA PERSONA y EL PASO abierto. Los
 * campos los carga la propia pantalla al buscar a la persona (y los guarda sola); volver a
 * escribirlos desde una foto dejaba la ficha llena con "Sin candidato" arriba y sin nada
 * que guardar detrás. Aquí viven las reglas puras; el adaptador las aplica sobre la
 * pantalla y se prueban sin levantarla.
 */

export type CapaCaso = 'seleccion' | 'contratacion' | 'documentos' | 'ia' | 'accesos';

/** Un contenedor que estaba desplazado: selector, cuál de los que coinciden y cuánto. */
export interface ScrollGuardado {
  sel: string;
  n: number;
  top: number;
}

/** Lo que un caso recuerda del pipeline. */
export interface EstadoPipelineCaso {
  v: 1;
  /** Documento tal como se busca (dígitos, o X + dígitos), sin puntos. */
  documento: string;
  tipo_doc?: string | null;
  /** Nombre de la persona, solo para leerlo sin cargarla. */
  nombre?: string | null;
  /** Capa del rail y paso abiertos. */
  capa: CapaCaso;
  paso?: string | null;
  scroll?: ScrollGuardado[];
}

export interface PasoCatalogo {
  readonly id: string;
  readonly label: string;
}

/** Los pasos que la pantalla ofrece HOY para esta persona (Remisión y Exámenes aparecen con el veredicto). */
export interface CatalogoPasos {
  seleccion: readonly PasoCatalogo[];
  ia: readonly PasoCatalogo[];
  contratacion: readonly PasoCatalogo[];
  documentos: readonly PasoCatalogo[];
}

export interface CapaCatalogo {
  readonly id: CapaCaso;
  readonly label: string;
}

/** Qué abrir al volver: un paso de Selección (incluye los de la IA), uno de Contratación/Documentos, o la capa sola. */
export type AccionPaso =
  | { tipo: 'seleccion'; id: string }
  | { tipo: 'contratacion'; id: string }
  | { tipo: 'capa'; id: CapaCaso };

const CAPAS: readonly CapaCaso[] = ['seleccion', 'contratacion', 'documentos', 'ia', 'accesos'];

/** "1.122.415.324" → "1122415324"; " x123 " → "X123". Vacío si no parece un documento. */
export function normalizarDocumento(d: unknown): string {
  const s = String(d ?? '').replace(/[.\s]/g, '').trim().toUpperCase();
  return /^X?\d{3,}$/.test(s) ? s : '';
}

/** ¿El documento en pantalla es el guardado? Tolera puntos y la X en minúscula. */
export function mismaPersona(enPantalla: unknown, guardado: unknown): boolean {
  const a = normalizarDocumento(enPantalla);
  const b = normalizarDocumento(guardado);
  return !!a && a === b;
}

/** Valida lo que venga del JSON del caso: solo se acepta un estado con persona y capa conocidas. */
export function leerEstadoPipeline(x: unknown): EstadoPipelineCaso | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const documento = normalizarDocumento(o['documento']);
  if (!documento) return null;
  const capa = CAPAS.includes(o['capa'] as CapaCaso) ? (o['capa'] as CapaCaso) : 'seleccion';
  const scroll = Array.isArray(o['scroll'])
    ? (o['scroll'] as unknown[])
        .filter((s): s is ScrollGuardado => !!s && typeof s === 'object'
          && typeof (s as ScrollGuardado).sel === 'string'
          && Number.isFinite((s as ScrollGuardado).n)
          && Number.isFinite((s as ScrollGuardado).top))
    : undefined;
  return {
    v: 1,
    documento,
    tipo_doc: typeof o['tipo_doc'] === 'string' && o['tipo_doc'] ? (o['tipo_doc'] as string) : null,
    nombre: typeof o['nombre'] === 'string' && o['nombre'] ? (o['nombre'] as string) : null,
    capa,
    paso: typeof o['paso'] === 'string' && o['paso'] ? (o['paso'] as string) : null,
    scroll: scroll && scroll.length ? scroll : undefined,
  };
}

/**
 * Qué abrir para volver al paso guardado.
 *
 * Si el paso ya no está a la vista (se remitió y luego se cambió el veredicto, y Remisión
 * desapareció) se abre la capa, que cae sola en su primer paso visible: nunca una pestaña vacía.
 */
export function pasoAAbrir(e: EstadoPipelineCaso, cat: CatalogoPasos): AccionPaso {
  const paso = e.paso ?? '';
  const tiene = (lista: readonly PasoCatalogo[]) => !!paso && lista.some(p => p.id === paso);
  switch (e.capa) {
    case 'seleccion':
      return tiene(cat.seleccion) ? { tipo: 'seleccion', id: paso } : { tipo: 'capa', id: 'seleccion' };
    case 'ia':
      return tiene(cat.ia) ? { tipo: 'seleccion', id: paso } : { tipo: 'capa', id: 'ia' };
    case 'contratacion':
      return tiene(cat.contratacion) ? { tipo: 'contratacion', id: paso } : { tipo: 'capa', id: 'contratacion' };
    case 'documentos':
      return tiene(cat.documentos) ? { tipo: 'contratacion', id: paso } : { tipo: 'capa', id: 'documentos' };
    default:
      return { tipo: 'capa', id: 'accesos' };
  }
}

/** "Selección · Entrevista", "Documentos · Todos los documentos", "Accesos rápidos". */
export function resumenDePaso(e: Pick<EstadoPipelineCaso, 'capa' | 'paso'>, cat: CatalogoPasos, capas: readonly CapaCatalogo[]): string {
  const capa = capas.find(c => c.id === e.capa)?.label ?? e.capa;
  const lista: readonly PasoCatalogo[] =
    e.capa === 'seleccion' ? cat.seleccion
      : e.capa === 'ia' ? cat.ia
        : e.capa === 'contratacion' ? cat.contratacion
          : e.capa === 'documentos' ? cat.documentos
            : [];
  const paso = e.paso ? lista.find(p => p.id === e.paso)?.label : null;
  return paso ? `${capa} · ${paso}` : capa;
}

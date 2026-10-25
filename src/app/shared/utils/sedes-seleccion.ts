/**
 * Sedes que Selección puede ofrecer (pedido #3, 24-sep-2026: "quitar ANDES y MONTEVERDE").
 *
 * ANDES y MONTE_VERDE siguen ACTIVAS —hay usuarios con ellas de sede principal y
 * Turnos, Nómina e Incapacidades las usan—, así que no basta con `activa`. El catálogo
 * `GET /gestion_admin/sedes/` trae desde ms-auth-admin V129 el flag `opera_seleccion`:
 * con `false` la sede no se ofrece para vacantes, entrevistas ni filtros NUEVOS de
 * Selección. Lo ya registrado con esas oficinas se sigue viendo en los reportes.
 *
 * Un backend anterior a V129 no manda el flag: se trata como `true` (se ofrece), igual
 * que una sede sin `activa`.
 */

export interface SedeCatalogo {
  nombre?: string | null;
  activa?: boolean | number | null;
  opera_seleccion?: boolean | number | null;
}

/** `true` si Selección puede ofrecer la sede como opción: activa y con `opera_seleccion` != false/0. */
export function sedeOfrecidaEnSeleccion(s: SedeCatalogo | null | undefined): boolean {
  if (!s || !String(s.nombre ?? '').trim()) return false;
  const activa = s.activa !== false && s.activa !== 0;
  const opera = s.opera_seleccion !== false && s.opera_seleccion !== 0;
  return activa && opera;
}

/**
 * Normaliza el nombre de una oficina para comparar sin importar tildes, "_", espacios
 * ni mayúsculas: 'Monte Verde' / 'MONTE_VERDE' / 'monteverde' → 'MONTEVERDE'.
 */
export function claveOficina(valor: string | null | undefined): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/** Acepta el arreglo plano o la forma paginada `{ results: [...] }`. */
function comoLista(data: unknown): SedeCatalogo[] {
  if (Array.isArray(data)) return data as SedeCatalogo[];
  const results = (data as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? (results as SedeCatalogo[]) : [];
}

/** Nombres (tal cual en el catálogo, sin repetir y ordenados) de las sedes que Selección ofrece. */
export function nombresSedesSeleccion(data: unknown): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const s of comoLista(data)) {
    if (!sedeOfrecidaEnSeleccion(s)) continue;
    const nombre = String(s.nombre ?? '').trim();
    const clave = claveOficina(nombre);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(nombre);
  }
  return out.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/**
 * Claves normalizadas (ver `claveOficina`) de las sedes que el catálogo marca como
 * FUERA de Selección (`opera_seleccion` false/0). Sirve para esconder filas de listas
 * que no salen del catálogo (p. ej. el consolidado de reportes).
 */
export function clavesFueraDeSeleccion(data: unknown): Set<string> {
  const out = new Set<string>();
  for (const s of comoLista(data)) {
    if (s && (s.opera_seleccion === false || s.opera_seleccion === 0)) {
      const clave = claveOficina(s.nombre);
      if (clave) out.add(clave);
    }
  }
  return out;
}

/**
 * Filtra una lista de nombres de oficina dejando solo las que Selección ofrece, pero
 * CONSERVA `actual` si viene (valor ya guardado en un registro viejo, o la sede propia
 * del usuario), para no dejar un selector en blanco al editar.
 */
export function filtrarOficinasSeleccion(
  nombres: readonly string[],
  fuera: ReadonlySet<string>,
  actual?: string | null,
): string[] {
  const claveActual = claveOficina(actual);
  return nombres.filter((n) => {
    const c = claveOficina(n);
    return !fuera.has(c) || (!!claveActual && c === claveActual);
  });
}

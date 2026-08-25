/**
 * BÚSQUEDA DE VACANTES POR VARIAS PALABRAS
 *
 * El filtro de toda la vida exigía que lo tecleado apareciera SEGUIDO y en UN
 * MISMO campo. Con cientos de publicaciones abiertas eso no alcanza: buscar
 * "jardines rosa cosecha" no encontraba nada aunque esas tres palabras
 * estuvieran en la vacante, cada una en un campo distinto.
 *
 * Aquí la consulta se parte en palabras y tienen que estar TODAS, sin importar
 * el orden ni en qué dato caiga cada una. Es lo que la gente ya hace sin
 * pensarlo: teclear tres pedazos de lo que recuerda.
 *
 * Vive fuera de los dos sitios que lo usan —el diálogo de la ficha y el
 * desplegable de Remisión— para que no puedan divergir: si mañana se busca
 * también por municipio, se añade una vez.
 */

/** Sin tildes y en minúscula: se busca como se teclea, no como se escribe. */
export function normalizarBusqueda(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Las palabras de la consulta, ya normalizadas y sin huecos. */
export function tokensDeConsulta(consulta: unknown): string[] {
  return normalizarBusqueda(consulta).split(/\s+/).filter(Boolean);
}

/** El texto sobre el que se busca. Conviene precalcularlo una vez por vacante. */
export function textoBuscableVacante(campos: ReadonlyArray<unknown>): string {
  return normalizarBusqueda(campos.filter((c) => c != null && c !== '').join(' '));
}

/** ¿Están TODAS las palabras en ese texto? Sin tokens, todo pasa. */
export function coincidenTodas(texto: string, tokens: readonly string[]): boolean {
  if (!tokens.length) return true;
  return tokens.every((t) => texto.includes(t));
}

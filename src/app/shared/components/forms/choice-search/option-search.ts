/**
 * Búsqueda "inteligente" sobre las OPCIONES de un campo de selección
 * (SINGLE_CHOICE / DROPDOWN / MULTIPLE_CHOICE).
 *
 * Ordena de mejor a peor coincidencia; el puntaje ES el orden de la lista:
 *   0 · exacta
 *   1 · la etiqueta empieza por lo escrito
 *   2 · lo escrito empieza una PALABRA de la etiqueta ("val" → "Cauca del Valle")
 *   3 · la etiqueta lo contiene en cualquier posición
 *   4 · contiene TODAS las palabras escritas, en cualquier orden
 *   5 · subsecuencia: las letras aparecen en orden aunque salteadas ("hld" → "holanda")
 * Sin coincidencia ⇒ la opción no se lista.
 *
 * Ignora mayúsculas y tildes ("bogota" encuentra "Bogotá"). El plegado es unidad a
 * unidad de código —NO `normalize()` sobre la cadena entera— para conservar el mapeo
 * 1:1 de índices con la etiqueta original: así los tramos resaltados marcan los
 * caracteres REALES y no se desfasan en cuanto hay una tilde.
 */
import { FieldOption } from '../field.model';

/** Trozo de etiqueta, marcado o no como coincidencia (para resaltarlo). */
export interface TextSegment {
  text: string;
  hit: boolean;
}

/** Opción que pasó el filtro, ya troceada para pintar. */
export interface OptionMatch {
  option: FieldOption;
  segments: TextSegment[];
}

/** Caracteres que abren "palabra" dentro de una etiqueta. */
const WORD_BREAK = /[\s\-_/\\.,;:()[\]{}'"|]/;

/** Pliega UNA unidad de código (minúscula, sin diacrítico) garantizando largo 1. */
function foldUnit(unit: string): string {
  const bare = unit.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (bare.length === 1) return bare;
  const lower = unit.toLowerCase();
  return lower.length === 1 ? lower : unit;
}

/** Pliega un texto conservando el mapeo 1:1 de índices con el original. */
export function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += foldUnit(text.charAt(i));
  return out;
}

/** Opción evaluada contra la consulta: puntaje, dónde pegó y qué letras resaltar. */
interface Scored {
  option: FieldOption;
  order: number;
  score: number;
  at: number;
  hits: boolean[];
}

function mark(hits: boolean[], from: number, length: number): void {
  for (let i = from; i < from + length && i < hits.length; i++) hits[i] = true;
}

/** Índice donde `needle` arranca una PALABRA dentro de `hay`, o -1. */
function wordStart(hay: string, needle: string): number {
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (i === 0 || WORD_BREAK.test(hay.charAt(i - 1))) return i;
  }
  return -1;
}

/** Evalúa una opción contra la consulta YA plegada. null = no coincide. */
function scoreOption(option: FieldOption, order: number, query: string): Scored | null {
  const label = option.label ?? '';
  const hay = fold(label);
  const hits = new Array<boolean>(label.length).fill(false);

  if (hay === query) {
    mark(hits, 0, hay.length);
    return { option, order, score: 0, at: 0, hits };
  }

  const at = hay.indexOf(query);
  if (at === 0) {
    mark(hits, 0, query.length);
    return { option, order, score: 1, at: 0, hits };
  }
  if (at > 0) {
    const word = wordStart(hay, query);
    const from = word >= 0 ? word : at;
    mark(hits, from, query.length);
    return { option, order, score: word >= 0 ? 2 : 3, at: from, hits };
  }

  const words = query.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every(w => hay.includes(w))) {
    let first = hay.length;
    for (const w of words) {
      const i = hay.indexOf(w);
      mark(hits, i, w.length);
      first = Math.min(first, i);
    }
    return { option, order, score: 4, at: first, hits };
  }

  // Subsecuencia: cada letra escrita aparece en orden, aunque haya letras en medio.
  let cursor = 0;
  let first = -1;
  for (const ch of query) {
    const i = hay.indexOf(ch, cursor);
    if (i < 0) return null;
    if (first < 0) first = i;
    hits[i] = true;
    cursor = i + 1;
  }
  return { option, order, score: 5, at: first < 0 ? 0 : first, hits };
}

/** Agrupa letras consecutivas con el mismo estado en tramos pintables. */
function toSegments(label: string, hits: boolean[]): TextSegment[] {
  const out: TextSegment[] = [];
  let i = 0;
  while (i < label.length) {
    const hit = hits[i];
    let j = i + 1;
    while (j < label.length && hits[j] === hit) j++;
    out.push({ text: label.substring(i, j), hit });
    i = j;
  }
  return out.length ? out : [{ text: label, hit: false }];
}

/**
 * Filtra y ORDENA las opciones contra lo escrito. Consulta vacía ⇒ todas, en su
 * orden original y sin resaltado (es lo que pinta el botón "ver todas").
 */
export function searchOptions(options: FieldOption[], query: string): OptionMatch[] {
  const list = options ?? [];
  const q = fold(query.trim());
  if (!q) {
    return list.map(option => ({ option, segments: [{ text: option.label ?? '', hit: false }] }));
  }
  const scored: Scored[] = [];
  list.forEach((option, order) => {
    const s = scoreOption(option, order, q);
    if (s) scored.push(s);
  });
  scored.sort((a, b) => a.score - b.score || a.at - b.at || a.order - b.order);
  return scored.map(s => ({ option: s.option, segments: toSegments(s.option.label ?? '', s.hits) }));
}

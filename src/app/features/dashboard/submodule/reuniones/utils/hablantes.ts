import { HablanteInsight, Participante } from '../models/reunion.model';
import { normalizar } from './texto';

/**
 * Colores de hablante.
 *
 * Son 12 y se indexan por `color_idx` (orden de aparición en la reunión). Los valores
 * viven en `estilos/paleta-hablantes.css` como `--hc0`…`--hc11`, con una versión para
 * claro y otra para oscuro; aquí sólo se decide QUÉ variable usa cada quien. Así un
 * mismo hablante tiene el mismo color en el panel, la línea de tiempo, la conversación
 * y los acuerdos, y el tema oscuro no obliga a recalcular nada en TypeScript.
 */
export const TOTAL_COLORES = 12;

/** `var(--hcN)` para `[style.--hc]`, o el gris de "sin identificar". */
export function colorVar(idx: number | null | undefined): string {
  if (idx == null || !Number.isFinite(idx)) return 'var(--hc-nulo)';
  return `var(--hc${((Math.trunc(idx) % TOTAL_COLORES) + TOTAL_COLORES) % TOTAL_COLORES})`;
}

/**
 * Índice de color estable para algo que no trae `color_idx` (una persona del directorio):
 * el mismo texto siempre da el mismo color.
 */
export function idxDeClave(clave: string | null | undefined): number {
  const s = clave ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % TOTAL_COLORES;
}

/** El color de un hablante: el que mandó el backend o, si falta, su posición en la lista. */
export function colorIdxDe(h: Pick<HablanteInsight, 'color_idx'>, posicion: number): number {
  return h.color_idx ?? posicion;
}

/** Hablantes en orden de aparición (que es también el orden de sus colores). */
export function ordenarHablantes<T extends Pick<HablanteInsight, 'color_idx' | 'first_at_ms'>>(hs: T[]): T[] {
  return [...hs].sort((a, b) =>
    (a.color_idx ?? 99) - (b.color_idx ?? 99) || (a.first_at_ms ?? 0) - (b.first_at_ms ?? 0));
}

/**
 * ¿La sugerencia de la IA corresponde a EXACTAMENTE un participante? Mismo criterio que el
 * backend: nombre completo o primer nombre, sin tildes. Con dos "Marcela" no se adivina.
 */
export function participanteDeSugerencia(
  sugerido: string | null | undefined, participantes: Participante[],
): Participante | null {
  const s = normalizar(sugerido);
  if (!s) return null;
  const unaPalabra = !s.includes(' ');
  const candidatos = participantes.filter(p => {
    const completo = normalizar(p.display_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`);
    const nombre = normalizar(p.first_name).split(' ')[0] || completo.split(' ')[0];
    return completo === s || completo.startsWith(`${s} `) || (unaPalabra && nombre === s);
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * Clave de persona del directorio para enlazar a su ficha (`personas/:key`).
 *
 * La manda el BACKEND en cada participante y en cada hablante con participante: sus reglas
 * (sin tratamientos de cortesía ni artículos, puntuación como espacio, `p:<id>` si no hay
 * nombre ni correo) no se reproducen aquí, porque una clave "casi igual" abre una ficha
 * vacía. Sin clave del backend no hay enlace: devuelve null.
 */
export function claveDePersona(
  ...fuentes: ({ person_key?: string | null } | null | undefined)[]
): string | null {
  for (const f of fuentes) {
    const k = f?.person_key?.trim();
    if (k) return k;
  }
  return null;
}

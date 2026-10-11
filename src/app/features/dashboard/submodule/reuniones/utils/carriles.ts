import { SegmentoTranscripcion, Tema } from '../models/reunion.model';

/** Un tramo de voz dentro del carril de una persona, en porcentaje del ancho. */
export interface BloqueCarril {
  startMs: number;
  endMs: number;
  /** Posición izquierda en % de la duración. */
  izq: number;
  /** Ancho en % (con un mínimo para que una frase corta se vea). */
  ancho: number;
}

/** El carril de una persona en la línea de tiempo. */
export interface Carril {
  speakerId: string | null;
  bloques: BloqueCarril[];
  /** Tiempo hablado real (sin las fusiones de dibujo). */
  talkMs: number;
}

export interface OpcionesCarriles {
  /**
   * Dos tramos del mismo hablante separados por menos que esto se dibujan como uno.
   * Por defecto, 1/800 de la duración (mínimo 1 s): en 4 h son 18 s, que a 1 000 px de
   * ancho es poco más de un píxel. Así un carril nunca pasa de unos cientos de nodos.
   */
  fusionMs?: number;
  /** Ancho mínimo de un bloque en %. */
  anchoMinimoPct?: number;
}

export interface BandaTema {
  tema: Tema;
  izq: number;
  ancho: number;
}

/**
 * Carriles por hablante para la línea de tiempo. `orden` fija qué carriles salen y en qué
 * orden (el de aparición); un hablante que esté en los segmentos y no en `orden` (p. ej.
 * los segmentos sin hablante) se añade al final.
 */
export function calcularCarriles(
  segmentos: SegmentoTranscripcion[],
  orden: (string | null)[],
  duracionMs: number | null | undefined,
  opciones: OpcionesCarriles = {},
): Carril[] {
  const finReal = segmentos.reduce((m, s) => Math.max(m, s.end_ms), 0);
  const dur = duracionMs && duracionMs > 0 ? Math.max(duracionMs, finReal) : finReal;
  const fusion = opciones.fusionMs ?? Math.max(1000, dur / 800);
  const minimo = opciones.anchoMinimoPct ?? 0.25;

  const tramos = new Map<string | null, { s: number; e: number }[]>();
  const habla = new Map<string | null, number>();
  const lista = [...segmentos].sort((a, b) => a.start_ms - b.start_ms);
  for (const seg of lista) {
    const k = seg.speaker_id ?? null;
    habla.set(k, (habla.get(k) ?? 0) + Math.max(0, seg.end_ms - seg.start_ms));
    const t = tramos.get(k) ?? [];
    const ultimo = t[t.length - 1];
    if (ultimo && seg.start_ms - ultimo.e <= fusion) {
      ultimo.e = Math.max(ultimo.e, seg.end_ms);
    } else {
      t.push({ s: seg.start_ms, e: seg.end_ms });
    }
    tramos.set(k, t);
  }

  const claves: (string | null)[] = [...orden];
  for (const k of tramos.keys()) if (!claves.includes(k)) claves.push(k);

  return claves.map(k => ({
    speakerId: k,
    talkMs: habla.get(k) ?? 0,
    bloques: dur > 0
      ? (tramos.get(k) ?? []).map(t => aBloque(t.s, t.e, dur, minimo))
      : [],
  }));
}

/** Bandas de temas sobre la línea de tiempo, ordenadas y recortadas a la duración. */
export function bandasTemas(temas: Tema[], duracionMs: number | null | undefined): BandaTema[] {
  const dur = duracionMs && duracionMs > 0 ? duracionMs : temas.reduce((m, t) => Math.max(m, t.end_ms), 0);
  if (!dur) return [];
  return [...temas]
    .sort((a, b) => a.start_ms - b.start_ms)
    .map(tema => {
      const b = aBloque(tema.start_ms, tema.end_ms, dur, 0);
      return { tema, izq: b.izq, ancho: b.ancho };
    })
    .filter(b => b.ancho > 0);
}

/** Fracción horizontal (0..1) → milisegundos, recortada a [0, duración]. */
export function msDesdeFraccion(fraccion: number, duracionMs: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraccion) ? fraccion : 0));
  return Math.round(f * Math.max(0, duracionMs));
}

/** Milisegundos → porcentaje (0..100) de la duración. */
export function pctDe(ms: number, duracionMs: number): number {
  if (!duracionMs || duracionMs <= 0) return 0;
  return Math.min(100, Math.max(0, (ms / duracionMs) * 100));
}

function aBloque(s: number, e: number, dur: number, minimo: number): BloqueCarril {
  const ini = Math.min(Math.max(0, s), dur);
  const fin = Math.min(Math.max(ini, e), dur);
  const izq = (ini / dur) * 100;
  let ancho = Math.max(minimo, ((fin - ini) / dur) * 100);
  if (izq + ancho > 100) ancho = Math.max(0, 100 - izq);
  return { startMs: s, endMs: e, izq: redondear(izq), ancho: redondear(ancho) };
}

const redondear = (n: number) => Math.round(n * 1000) / 1000;

import { Acuerdo, SegmentoTranscripcion } from '../models/reunion.model';

/**
 * Un turno de palabra: segmentos CONSECUTIVOS del mismo hablante. La transcripción se lee
 * como una conversación (quién habló y qué dijo), no como una lista de 3 000 renglones.
 */
export interface Turno {
  /** Estable mientras no cambie el primer segmento: sirve de `track`. */
  clave: string;
  speakerId: string | null;
  startMs: number;
  endMs: number;
  segmentos: SegmentoTranscripcion[];
  /**
   * El turno anterior es del mismo hablante: se cortó por una pausa larga o porque era un
   * monólogo muy largo. La vista lo pinta sin repetir el nombre en grande.
   */
  continua: boolean;
}

export interface OpcionesTurnos {
  /** Silencio a partir del cual el mismo hablante empieza turno nuevo. */
  pausaMaxMs?: number;
  /**
   * Máximo de segmentos por turno. Un monólogo de 20 minutos en un solo bloque no se deja
   * leer ni se beneficia de `content-visibility`, que trabaja por bloque.
   */
  maxSegmentos?: number;
}

/** Agrupa segmentos en turnos. Pura: no muta la entrada. */
export function agruparTurnos(segmentos: SegmentoTranscripcion[], opciones: OpcionesTurnos = {}): Turno[] {
  const pausaMax = opciones.pausaMaxMs ?? 30_000;
  const maxSegmentos = opciones.maxSegmentos ?? 12;
  const lista = estaOrdenado(segmentos) ? segmentos : [...segmentos].sort(porInicio);

  const turnos: Turno[] = [];
  let actual: Turno | null = null;
  for (const s of lista) {
    const quien = s.speaker_id ?? null;
    const mismo: boolean = actual !== null && actual.speakerId === quien;
    if (actual && mismo
        && s.start_ms - actual.endMs <= pausaMax
        && actual.segmentos.length < maxSegmentos) {
      actual.segmentos.push(s);
      actual.endMs = Math.max(actual.endMs, s.end_ms);
    } else {
      actual = {
        clave: `t${s.id}`,
        speakerId: quien,
        startMs: s.start_ms,
        endMs: s.end_ms,
        segmentos: [s],
        continua: mismo,
      };
      turnos.push(actual);
    }
  }
  return turnos;
}

/** Segmentos que se cruzan con el rango [desde, hasta): así se filtra por tema. */
export function segmentosEnRango(segmentos: SegmentoTranscripcion[], desde: number, hasta: number): SegmentoTranscripcion[] {
  return segmentos.filter(s => s.end_ms > desde && s.start_ms < hasta);
}

/**
 * Posición del último segmento que empezó en o antes de `ms` (búsqueda binaria: se llama
 * cuatro veces por segundo con el audio sonando). -1 si ninguno ha empezado o si ya
 * terminó hace más de `holguraMs` (un silencio largo no deja resaltado lo anterior).
 */
export function indiceSegmentoEn(segmentos: SegmentoTranscripcion[], ms: number, holguraMs = 0): number {
  let lo = 0;
  let hi = segmentos.length - 1;
  let hallado = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segmentos[mid].start_ms <= ms) { hallado = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (hallado < 0) return -1;
  return ms < segmentos[hallado].end_ms + holguraMs ? hallado : -1;
}

/**
 * Qué acuerdos se dijeron en cada segmento: el acuerdo cuelga del último segmento que
 * empezó en o antes de su `start_ms`. Los que no traen tiempo no se anclan.
 */
export function acuerdosPorSegmento(segmentos: SegmentoTranscripcion[], acuerdos: Acuerdo[]): Map<number, Acuerdo[]> {
  const mapa = new Map<number, Acuerdo[]>();
  if (!segmentos.length) return mapa;
  for (const a of acuerdos) {
    if (a.start_ms == null) continue;
    const i = Math.max(0, indiceSegmentoEn(segmentos, a.start_ms, Number.POSITIVE_INFINITY));
    const id = segmentos[i].id;
    const lista = mapa.get(id);
    if (lista) lista.push(a); else mapa.set(id, [a]);
  }
  return mapa;
}

function porInicio(a: SegmentoTranscripcion, b: SegmentoTranscripcion): number {
  return a.start_ms - b.start_ms || a.idx - b.idx;
}

function estaOrdenado(segmentos: SegmentoTranscripcion[]): boolean {
  for (let i = 1; i < segmentos.length; i++) {
    if (porInicio(segmentos[i - 1], segmentos[i]) > 0) return false;
  }
  return true;
}

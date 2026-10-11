import { acuerdosPorSegmento, agruparTurnos, indiceSegmentoEn, segmentosEnRango } from './turnos';
import { acuerdo, segmento } from '../testing/fabricas';

describe('Reuniones · agrupador de turnos', () => {
  const s = (id: number, quien: string | null, ini: number, fin: number) =>
    segmento({ id, speaker_id: quien, start_ms: ini, end_ms: fin, text: `frase ${id}` });

  it('une segmentos consecutivos del mismo hablante en un turno', () => {
    const turnos = agruparTurnos([s(1, 'a', 0, 1000), s(2, 'a', 1000, 2000), s(3, 'b', 2000, 3000), s(4, 'a', 3000, 4000)]);
    expect(turnos.length).toBe(3);
    expect(turnos.map(t => t.speakerId)).toEqual(['a', 'b', 'a']);
    expect(turnos[0].segmentos.map(x => x.id)).toEqual([1, 2]);
    expect(turnos[0].startMs).toBe(0);
    expect(turnos[0].endMs).toBe(2000);
    expect(turnos[0].clave).toBe('t1');
    expect(turnos.every(t => !t.continua)).toBeTrue();
  });

  it('agrupa también los segmentos sin hablante entre sí', () => {
    const turnos = agruparTurnos([s(1, null, 0, 1000), s(2, null, 1000, 2000), s(3, 'b', 2000, 3000)]);
    expect(turnos.length).toBe(2);
    expect(turnos[0].speakerId).toBeNull();
    expect(turnos[0].segmentos.length).toBe(2);
  });

  it('corta el turno tras una pausa larga y lo marca como continuación', () => {
    const turnos = agruparTurnos([s(1, 'a', 0, 1000), s(2, 'a', 40_000, 41_000)], { pausaMaxMs: 30_000 });
    expect(turnos.length).toBe(2);
    expect(turnos[1].continua).toBeTrue();
  });

  it('corta los monólogos largos por número de segmentos', () => {
    const segs = Array.from({ length: 7 }, (_, i) => s(i + 1, 'a', i * 1000, i * 1000 + 900));
    const turnos = agruparTurnos(segs, { maxSegmentos: 3 });
    expect(turnos.map(t => t.segmentos.length)).toEqual([3, 3, 1]);
    expect(turnos.slice(1).every(t => t.continua)).toBeTrue();
  });

  it('ordena si la entrada llega desordenada y no la muta', () => {
    const entrada = [s(2, 'a', 1000, 2000), s(1, 'a', 0, 1000)];
    const turnos = agruparTurnos(entrada);
    expect(turnos[0].segmentos.map(x => x.id)).toEqual([1, 2]);
    expect(entrada[0].id).toBe(2);
  });

  it('devuelve lista vacía sin segmentos', () => {
    expect(agruparTurnos([])).toEqual([]);
  });

  it('filtra por rango de tema (se cruzan con [desde, hasta))', () => {
    const segs = [s(1, 'a', 0, 1000), s(2, 'a', 1000, 2000), s(3, 'b', 2000, 3000)];
    expect(segmentosEnRango(segs, 900, 2000).map(x => x.id)).toEqual([1, 2]);
    expect(segmentosEnRango(segs, 3000, 4000)).toEqual([]);
  });

  it('encuentra el segmento que suena con búsqueda binaria y holgura', () => {
    const segs = [s(1, 'a', 0, 1000), s(2, 'b', 2000, 3000), s(3, 'a', 5000, 6000)];
    expect(indiceSegmentoEn(segs, 500)).toBe(0);
    expect(indiceSegmentoEn(segs, 2999)).toBe(1);
    expect(indiceSegmentoEn(segs, 3500)).toBe(-1);
    expect(indiceSegmentoEn(segs, 3500, 1500)).toBe(1);
    expect(indiceSegmentoEn(segs, -1)).toBe(-1);
    expect(indiceSegmentoEn([], 10)).toBe(-1);
  });

  it('ancla cada acuerdo al segmento en que se dijo', () => {
    const segs = [s(1, 'a', 0, 1000), s(2, 'b', 2000, 3000), s(3, 'a', 5000, 6000)];
    const mapa = acuerdosPorSegmento(segs, [
      acuerdo({ id: 'x', start_ms: 2500 }),
      acuerdo({ id: 'y', start_ms: 4000 }),   // en el silencio: cuelga del anterior
      acuerdo({ id: 'z', start_ms: null }),   // sin tiempo: no se ancla
    ]);
    expect(mapa.get(2)?.map(a => a.id)).toEqual(['x', 'y']);
    expect(mapa.has(1)).toBeFalse();
    expect([...mapa.values()].flat().some(a => a.id === 'z')).toBeFalse();
  });
});

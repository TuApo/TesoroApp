import { bandasTemas, calcularCarriles, msDesdeFraccion, pctDe } from './carriles';
import { TEMAS, segmento } from '../testing/fabricas';

describe('Reuniones · carriles de la línea de tiempo', () => {
  const s = (id: number, quien: string | null, ini: number, fin: number) =>
    segmento({ id, speaker_id: quien, start_ms: ini, end_ms: fin });

  it('un carril por hablante en el orden pedido, con bloques en % de la duración', () => {
    const carriles = calcularCarriles(
      [s(1, 'a', 0, 10_000), s(2, 'b', 10_000, 30_000), s(3, 'a', 50_000, 60_000)],
      ['a', 'b'], 100_000, { fusionMs: 1000 });
    expect(carriles.map(c => c.speakerId)).toEqual(['a', 'b']);
    expect(carriles[0].bloques).toEqual([
      { startMs: 0, endMs: 10_000, izq: 0, ancho: 10 },
      { startMs: 50_000, endMs: 60_000, izq: 50, ancho: 10 },
    ]);
    expect(carriles[1].bloques).toEqual([{ startMs: 10_000, endMs: 30_000, izq: 10, ancho: 20 }]);
    expect(carriles[0].talkMs).toBe(20_000);
  });

  it('funde tramos cercanos del mismo hablante (menos nodos en reuniones largas)', () => {
    const carriles = calcularCarriles([s(1, 'a', 0, 1000), s(2, 'a', 1500, 2500), s(3, 'a', 9000, 9500)],
      ['a'], 10_000, { fusionMs: 1000 });
    expect(carriles[0].bloques.length).toBe(2);
    expect(carriles[0].bloques[0].endMs).toBe(2500);
    expect(carriles[0].talkMs).toBe(2500);
  });

  it('da un ancho mínimo a las frases cortas y no se sale del 100 %', () => {
    const carriles = calcularCarriles([s(1, 'a', 0, 10), s(2, 'b', 99_990, 100_000)], ['a', 'b'], 100_000,
      { anchoMinimoPct: 0.5 });
    expect(carriles[0].bloques[0].ancho).toBe(0.5);
    const ultimo = carriles[1].bloques[0];
    expect(ultimo.izq + ultimo.ancho).toBeLessThanOrEqual(100);
  });

  it('añade al final los hablantes que no estaban en el orden (p. ej. sin identificar)', () => {
    const carriles = calcularCarriles([s(1, 'a', 0, 1000), s(2, null, 1000, 2000)], ['a', 'b'], 2000);
    expect(carriles.map(c => c.speakerId)).toEqual(['a', 'b', null]);
    expect(carriles[1].bloques).toEqual([]);
  });

  it('sin duración usa el final del último segmento', () => {
    const carriles = calcularCarriles([s(1, 'a', 0, 5000), s(2, 'a', 15_000, 20_000)], ['a'], null, { fusionMs: 1 });
    expect(carriles[0].bloques[1].izq).toBe(75);
  });

  it('sin segmentos ni duración, carriles vacíos', () => {
    expect(calcularCarriles([], ['a'], 0)).toEqual([{ speakerId: 'a', talkMs: 0, bloques: [] }]);
  });

  it('bandas de temas ordenadas y proporcionales', () => {
    const bandas = bandasTemas([TEMAS[1], TEMAS[0]], 38_400);
    expect(bandas.map(b => b.tema.id)).toEqual(['t1', 't2']);
    expect(bandas[0].izq).toBe(0);
    expect(bandas[0].ancho).toBeCloseTo(31.25, 2);
    expect(bandas[1].izq + bandas[1].ancho).toBeCloseTo(100, 2);
    expect(bandasTemas([], 1000)).toEqual([]);
  });

  it('convierte fracción ↔ milisegundos y porcentaje con recorte', () => {
    expect(msDesdeFraccion(0.5, 38_400)).toBe(19_200);
    expect(msDesdeFraccion(-1, 1000)).toBe(0);
    expect(msDesdeFraccion(2, 1000)).toBe(1000);
    expect(pctDe(19_200, 38_400)).toBe(50);
    expect(pctDe(50_000, 38_400)).toBe(100);
    expect(pctDe(10, 0)).toBe(0);
  });
});

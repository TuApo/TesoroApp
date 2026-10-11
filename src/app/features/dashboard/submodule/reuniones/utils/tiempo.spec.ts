import { duracionHumana, fechaCorta, fechaHora, fechaLocalIso, marcaDeTiempo, porcentaje, reloj } from './tiempo';

describe('Reuniones · formato de tiempos', () => {
  it('reloj: mm:ss y h:mm:ss', () => {
    expect(reloj(0)).toBe('00:00');
    expect(reloj(999)).toBe('00:00');
    expect(reloj(61_000)).toBe('01:01');
    expect(reloj(59 * 60_000 + 59_000)).toBe('59:59');
    expect(reloj(3_723_000)).toBe('1:02:03');
    expect(reloj(4 * 3_600_000)).toBe('4:00:00');
  });

  it('reloj: sin dato o negativo no rompe', () => {
    expect(reloj(null)).toBe('--:--');
    expect(reloj(undefined)).toBe('--:--');
    expect(reloj(Number.NaN)).toBe('--:--');
    expect(reloj(-5000)).toBe('00:00');
  });

  it('duración humana', () => {
    expect(duracionHumana(38_400)).toBe('38 s');
    expect(duracionHumana(59_400)).toBe('59 s');
    expect(duracionHumana(12 * 60_000)).toBe('12 min');
    expect(duracionHumana(65 * 60_000)).toBe('1 h 5 min');
    expect(duracionHumana(2 * 3_600_000)).toBe('2 h');
    expect(duracionHumana(0)).toBe('0 min');
    expect(duracionHumana(null)).toBe('0 min');
  });

  it('fecha corta: una fecha sin hora es LOCAL (no se corre al día anterior)', () => {
    expect(fechaCorta('2026-09-12')).toBe('12 sep 2026');
    expect(fechaCorta('2026-01-01')).toBe('1 ene 2026');
    expect(fechaCorta(null)).toBe('');
    expect(fechaCorta('no-es-fecha')).toBe('');
  });

  it('fecha y hora', () => {
    const iso = new Date(2026, 8, 26, 9, 5).toISOString();
    expect(fechaHora(iso)).toBe('26 sep 2026, 09:05');
  });

  it('fecha local en ISO', () => {
    expect(fechaLocalIso(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05');
  });

  it('porcentaje legible', () => {
    expect(porcentaje(31.2)).toBe('31 %');
    expect(porcentaje(4.5)).toBe('4,5 %');
    expect(porcentaje(5)).toBe('5 %');
    expect(porcentaje(null)).toBe('');
  });

  // Lo que manda ms-meetings de verdad en producción (27-sep-2026): el ObjectMapper de
  // Kafka de commons desplaza al de Spring y las fechas no salen como texto ISO.
  it('fechas como las manda ms-meetings: arreglo y segundos de época', () => {
    expect(fechaCorta([2026, 9, 27] as unknown as string)).toBe('27 sep 2026');
    expect(fechaHora([2026, 9, 26, 9, 5, 0, 0] as unknown as string)).toBe('26 sep 2026, 09:05');
    const seg = new Date(2026, 8, 26, 9, 5).getTime() / 1000 + 0.021;
    expect(fechaHora(seg as unknown as string)).toBe('26 sep 2026, 09:05');
    expect(fechaHora(seg * 1000 as unknown as string)).toBe('26 sep 2026, 09:05');
  });

  it('fechas ilegibles no revientan y ordenan al final', () => {
    expect(fechaCorta({} as unknown as string)).toBe('');
    expect(fechaCorta([] as unknown as string)).toBe('');
    expect(marcaDeTiempo(null)).toBe(0);
    expect(marcaDeTiempo([2026, 9, 27])).toBeGreaterThan(marcaDeTiempo([2026, 9, 26]));
    expect(marcaDeTiempo('2026-09-27')).toBe(marcaDeTiempo([2026, 9, 27]));
  });
});

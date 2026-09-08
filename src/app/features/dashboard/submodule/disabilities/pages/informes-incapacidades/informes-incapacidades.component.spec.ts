import {
  COLOR_TIPO,
  barras,
  inicioDeAnio,
  hoyIso,
  mensajeDeError,
  pastel,
  top,
} from './informes-incapacidades.component';
import { SerieInforme } from '../../models/incapacidad-gestion.model';

/** Helpers puros de la vista de informes: agrupacion "Otros", opciones de echarts y fechas. */
describe('InformesIncapacidades helpers', () => {
  const serie = (clave: string, cantidad: number, dias = cantidad * 3): SerieInforme => ({
    clave, etiqueta: clave, cantidad, dias,
  });

  it('top(n) conserva las N mayores y suma el resto en "Otros"', () => {
    const series = [serie('A', 5), serie('B', 9), serie('C', 1), serie('D', 7)];
    const r = top(series, 2);
    expect(r.map((s) => s.clave)).toEqual(['B', 'D', 'OTROS']);
    expect(r[2].cantidad).toBe(6);
    expect(r[2].dias).toBe(18);
    expect(top(series, 10)).toBe(series);
  });

  it('pastel usa el color fijo por tipo cuando se le da y barras ordena ascendente', () => {
    const opcion = pastel([serie('ENFERMEDAD_GENERAL', 3), serie('OTRO', 1)], (s) => COLOR_TIPO[s.clave]);
    const datos = (opcion.series as { data: { name: string; itemStyle?: { color: string } }[] }[])[0].data;
    expect(datos[0].itemStyle?.color).toBe('#1E88E5');
    expect(datos[1].itemStyle).toBeUndefined();

    const b = barras([serie('MADRID', 40), serie('SUBA', 10)], '#000');
    expect((b.yAxis as { data: string[] }).data).toEqual(['SUBA', 'MADRID']);
    expect((b.series as { data: number[] }[])[0].data).toEqual([10, 40]);
  });

  it('fechas por defecto: inicio de anio y hoy en ISO corto', () => {
    const fecha = new Date(2026, 8, 8);
    expect(inicioDeAnio(fecha)).toBe('2026-01-01');
    expect(hoyIso(fecha)).toBe('2026-09-08');
  });

  it('mensajeDeError prefiere el error del backend', () => {
    expect(mensajeDeError({ error: { error: 'rango invertido' } }, 'x')).toBe('rango invertido');
    expect(mensajeDeError(null, 'por defecto')).toBe('por defecto');
  });
});

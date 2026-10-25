import {
  etiquetaEstado,
  filtrosIniciales,
  isoLocal,
  nombreArchivoPresentados,
  paramsPresentados,
  pct,
} from './reporte-presentados.util';

describe('reporte-presentados.util', () => {
  it('filtros iniciales: del 1 del mes a hoy, en fecha local', () => {
    const f = filtrosIniciales(new Date(2026, 8, 27, 23, 30));
    expect(f).toEqual({ desde: '2026-09-01', hasta: '2026-09-27', oficina: '', estado: '', q: '' });
    expect(isoLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('solo manda los filtros con valor', () => {
    const base = filtrosIniciales(new Date(2026, 8, 27));
    expect(paramsPresentados(base)).toEqual({ desde: '2026-09-01', hasta: '2026-09-27' });
    expect(paramsPresentados({ ...base, oficina: ' SUBA ', estado: 'EN_ESPERA', q: '123' }, { page: 2, size: 50 }))
      .toEqual({ desde: '2026-09-01', hasta: '2026-09-27', oficina: 'SUBA', estado: 'EN_ESPERA', q: '123', page: '2', size: '50' });
  });

  it('etiquetas y porcentajes', () => {
    expect(etiquetaEstado('EN_ESPERA')).toBe('En espera de vacante');
    expect(etiquetaEstado('OTRO')).toBe('OTRO');
    expect(pct(1, 3)).toBe(33);
    expect(pct(5, 0)).toBe(0);
  });

  it('nombre del Excel: el del servidor o uno armado', () => {
    const f = filtrosIniciales(new Date(2026, 8, 27));
    expect(nombreArchivoPresentados('attachment; filename="presentados_2026-09-01_a_2026-09-27.xlsx"', f))
      .toBe('presentados_2026-09-01_a_2026-09-27.xlsx');
    expect(nombreArchivoPresentados(null, f)).toBe('presentados_2026-09-01_a_2026-09-27.xlsx');
  });
});

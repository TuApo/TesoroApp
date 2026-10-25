import {
  accesosDelMenu,
  barrasH,
  diagnosticosASerie,
  rangoDePeriodo,
  tendencia,
  tonoVariacion,
} from './inicio-incapacidades.component';

/** Helpers puros del Inicio: accesos segun el menu, periodos rapidos y opciones de echarts. */
describe('InicioIncapacidades helpers', () => {
  it('accesosDelMenu deja SOLO los modulos del menu bajo disabilities, en el orden del catalogo', () => {
    const r = accesosDelMenu([
      { ruta: '/dashboard/disabilities/consulta', nombre: 'Consulta de incapacidades', icono: 'fact_check' },
      { ruta: '/dashboard/nomina/novedades', nombre: 'Novedades', icono: 'x' },
      { ruta: '/dashboard/disabilities/registro', nombre: 'Registro de incapacidad', icono: '' },
      { ruta: '/dashboard/disabilities/inicio', nombre: 'Inicio', icono: 'home' },
      { ruta: '/dashboard/disabilities/nuevo', nombre: 'Algo nuevo', icono: '' },
    ]);
    expect(r.map((a) => a.ruta)).toEqual([
      '/dashboard/disabilities/registro',
      '/dashboard/disabilities/consulta',
      '/dashboard/disabilities/nuevo',
    ]);
    expect(r[0].icono).toBe('post_add'); // sin icono en el menu: el del catalogo
    expect(r[1].nombre).toBe('Consulta de incapacidades'); // el nombre lo pone el menu
    expect(accesosDelMenu([])).toEqual([]);
  });

  it('rangoDePeriodo: anio, mes, mes anterior; los 12 meses los decide el servidor', () => {
    const hoy = new Date(2026, 9, 23);
    expect(rangoDePeriodo('ANIO', hoy)).toEqual({ desde: '2026-01-01', hasta: '2026-10-23' });
    expect(rangoDePeriodo('MES', hoy)).toEqual({ desde: '2026-10-01', hasta: '2026-10-23' });
    expect(rangoDePeriodo('MES_ANTERIOR', hoy)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
    expect(rangoDePeriodo('ULTIMOS_12', hoy)).toEqual({});
  });

  it('tonoVariacion: subir incapacidades es malo', () => {
    expect(tonoVariacion(12.5)).toBe('sube');
    expect(tonoVariacion(-3)).toBe('baja');
    expect(tonoVariacion(null)).toBe('igual');
  });

  it('graficas: barras de mayor arriba, diagnosticos con descripcion y tendencia con doble eje', () => {
    const b = barrasH([
      { clave: 'MADRID', etiqueta: 'MADRID', cantidad: 40, dias: 1 },
      { clave: 'SUBA', etiqueta: 'SUBA', cantidad: 10, dias: 1 },
    ], '#000');
    expect((b.yAxis as { data: string[] }).data).toEqual(['SUBA', 'MADRID']);

    expect(diagnosticosASerie([{ codigo: 'J00', descripcion: 'RINOFARINGITIS', cantidad: 2, dias: 3 }])[0].etiqueta)
      .toBe('J00 · RINOFARINGITIS');

    const t = tendencia([{ anio: 2026, mes: 10, etiqueta: 'Oct 2026', cantidad: 5, dias: 20 }]);
    expect((t.series as unknown[]).length).toBe(2);
    expect((t.yAxis as unknown[]).length).toBe(2);
  });
});

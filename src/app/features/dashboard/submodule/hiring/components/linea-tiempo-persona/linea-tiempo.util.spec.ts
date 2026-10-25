import type { EventoLineaTiempo } from '../../service/linea-tiempo/linea-tiempo.service';
import {
  agruparPorDia, alternarTipo, diaDe, esFuturo, etiquetaDia, horaDe, hoyBogota, iconoDe,
} from './linea-tiempo.util';

/**
 * Lo delicado de la línea de tiempo no es pintarla sino el DÍA de cada hito:
 * un día sin hora pasado por `new Date()` cae en el día anterior (medianoche
 * UTC) y un instante UTC de la noche pertenece al día anterior en Bogotá.
 */
function ev(p: Partial<EventoLineaTiempo>): EventoLineaTiempo {
  return {
    fecha: null, solo_fecha: false, tipo: 'SELECCION', subtipo: 'ENTREVISTA', nivel: 'NEUTRO',
    titulo: 'x', detalle: null, oficina: null, usuario: null, proceso_id: null, contrato: null,
    fuente: 'test', ...p,
  };
}

describe('linea-tiempo.util · días y horas', () => {
  it('un día sin hora se toma tal cual, sin correrlo por la zona horaria', () => {
    expect(diaDe({ fecha: '2026-09-06', solo_fecha: true })).toBe('2026-09-06');
    expect(horaDe({ fecha: '2026-09-06', solo_fecha: true })).toBeNull();
  });

  it('una hora de Bogotá se lee tal cual', () => {
    const e = { fecha: '2026-09-24T10:30:00-05:00', solo_fecha: false };
    expect(diaDe(e)).toBe('2026-09-24');
    expect(horaDe(e)).toBe('10:30 a. m.');
    expect(horaDe({ fecha: '2026-09-24T00:05:00-05:00', solo_fecha: false })).toBe('12:05 a. m.');
    expect(horaDe({ fecha: '2026-09-24T12:00:00-05:00', solo_fecha: false })).toBe('12:00 p. m.');
  });

  it('un instante UTC de la madrugada es la noche anterior en Bogotá', () => {
    const e = { fecha: '2026-09-25T03:30:00Z', solo_fecha: false };
    expect(diaDe(e)).toBe('2026-09-24');
    expect(horaDe(e)).toBe('10:30 p. m.');
  });

  it('sin fecha o con basura no inventa un día', () => {
    expect(diaDe({ fecha: null, solo_fecha: false })).toBeNull();
    expect(diaDe({ fecha: 'basura', solo_fecha: false })).toBeNull();
    expect(diaDe({ fecha: 'basura', solo_fecha: true })).toBeNull();
  });

  it('hoy en Bogotá', () => {
    // 2026-09-28 02:00 UTC = 27 de septiembre, 9 p. m., en Bogotá.
    expect(hoyBogota(new Date('2026-09-28T02:00:00Z'))).toBe('2026-09-27');
  });

  it('etiquetas de día', () => {
    const hoy = '2026-09-27';
    expect(etiquetaDia('2026-09-27', hoy)).toBe('Hoy');
    expect(etiquetaDia('2026-09-26', hoy)).toBe('Ayer');
    expect(etiquetaDia('2026-09-28', hoy)).toBe('Mañana');
    expect(etiquetaDia('2026-09-22', hoy)).toBe('martes 22 sep 2026');
    // Cambio de mes y de año al restar un día.
    expect(etiquetaDia('2025-12-31', '2026-01-01')).toBe('Ayer');
    expect(esFuturo('2026-10-01', hoy)).toBeTrue();
    expect(esFuturo('2026-09-27', hoy)).toBeFalse();
    expect(esFuturo(null, hoy)).toBeFalse();
  });
});

describe('linea-tiempo.util · agrupar', () => {
  it('junta solo hitos contiguos del mismo día y respeta el orden del servidor', () => {
    const lista = [
      ev({ fecha: '2026-10-01', solo_fecha: true, subtipo: 'INGRESO' }),
      ev({ fecha: '2026-09-27T16:00:00-05:00', subtipo: 'CONTRATACION' }),
      ev({ fecha: '2026-09-27T09:00:00-05:00', subtipo: 'ENTREVISTA' }),
      ev({ fecha: '2026-09-20', solo_fecha: true, subtipo: 'INCAPACIDAD' }),
      ev({ fecha: null, subtipo: 'APERTURA' }),
    ];
    const g = agruparPorDia(lista, '2026-09-27');
    expect(g.map((x) => x.dia)).toEqual(['2026-10-01', '2026-09-27', '2026-09-20', 'sin-fecha']);
    expect(g[0].futuro).toBeTrue();
    expect(g[1].etiqueta).toBe('Hoy');
    expect(g[1].eventos.map((e) => e.subtipo)).toEqual(['CONTRATACION', 'ENTREVISTA']);
    expect(g[3].etiqueta).toBe('Sin fecha');
    expect(g[3].futuro).toBeFalse();
  });
});

describe('linea-tiempo.util · filtro e íconos', () => {
  it('alternar un tipo lo prende o lo apaga, en el orden de los chips', () => {
    expect(alternarTipo([], 'VETO')).toEqual(['VETO']);
    expect(alternarTipo(['VETO'], 'PRUEBA')).toEqual(['PRUEBA', 'VETO']);
    expect(alternarTipo(['PRUEBA', 'VETO'], 'VETO')).toEqual(['PRUEBA']);
  });

  it('con todos prendidos equivale a no filtrar', () => {
    const casiTodos = ['SELECCION', 'PRUEBA', 'EXAMEN', 'CONTRATO', 'VETO', 'INCAPACIDAD'] as const;
    expect(alternarTipo(casiTodos, 'DATOS')).toEqual([]);
  });

  it('el ícono sale del hito y, si no se conoce, de su grupo', () => {
    expect(iconoDe({ tipo: 'CONTRATO', subtipo: 'RETIRO' })).toBe('logout');
    expect(iconoDe({ tipo: 'VETO', subtipo: 'OTRO_NUEVO' })).toBe('gpp_bad');
  });
});

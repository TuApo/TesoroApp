import { of } from 'rxjs';
import * as XLSX from 'xlsx';

import type { Page } from '../../models/incapacidad-v2.model';
import { CargaLiquidacionDetalle, FilaLiquidacion } from '../../models/incapacidad-salud.model';
import { filaLiquidacion, incapacidadRef, cargaLiquidacion } from './liquidacion.fixtures.spec-helper';
import {
  alertaDeCarga,
  claseResultadoFila,
  codigoVisible,
  fechaCorta,
  fechaHora,
  filasSinCruce,
  libroFilasSinCruce,
  mensajeDeError,
  mismaEps,
  normalizarCausal,
  pesos,
  resumenVigente,
  traerTodasLasPaginas,
} from './liquidacion.utils';

/** Helpers puros de Liquidacion: formatos, resumen de la carga, alerta y Excel. */
describe('liquidacion.utils', () => {
  it('formatea pesos colombianos sin decimales y deja raya si no hay valor', () => {
    const texto = pesos(350184.4);
    expect(texto).toContain('$');
    expect(texto).toContain('350.184');
    expect(texto).not.toContain(',');
    expect(pesos(null)).toBe('—');
  });

  it('pinta fechas dd/MM/yyyy sin el desfase UTC y respeta los textos ilegibles', () => {
    expect(fechaCorta('2026-09-03')).toBe('03/09/2026');
    expect(fechaCorta('2026-01-31T00:00:00Z')).toBe('31/01/2026');
    expect(fechaCorta(null)).toBe('');
    expect(fechaCorta('no es fecha')).toBe('no es fecha');
    expect(fechaHora('2026-10-06T14:05:00')).toBe('06/10/2026 14:05');
  });

  it('prefiere el codigo de oficina y si no hay usa el general sin guion bajo', () => {
    expect(codigoVisible(incapacidadRef({ codigoOficina: 'TASB018' }))).toBe('TASB018');
    expect(codigoVisible(incapacidadRef({ codigoOficina: null, codigoUnico: '1005851505_20260801' }))).toBe('100585150520260801');
    expect(codigoVisible(null)).toBe('');
  });

  it('normaliza la causal como ms-hr (sin tildes, mayusculas, sin signos)', () => {
    expect(normalizarCausal('  Uno y dos días   NO cumple. ')).toBe('UNO Y DOS DIAS NO CUMPLE');
    expect(normalizarCausal('causal  51.')).toBe('CAUSAL 51');
    expect(mismaEps('Nueva EPS', 'NUEVA  EPS ')).toBeTrue();
    expect(mismaEps('SANITAS', 'NUEVA EPS')).toBeFalse();
  });

  it('colorea el resultado de cada fila', () => {
    expect(claseResultadoFila('CRUZA')).toBe('ges-chip-ok');
    expect(claseResultadoFila('NO_CRUZA')).toBe('ges-chip-peligro');
    expect(claseResultadoFila('AMBIGUA')).toBe('ges-chip-aviso');
    expect(claseResultadoFila('DUPLICADA')).toBe('ges-chip-neutro');
    expect(claseResultadoFila('ERROR')).toBe('ges-chip-peligro');
  });

  describe('resumen y alerta de la carga', () => {
    const filas: FilaLiquidacion[] = [
      filaLiquidacion({ id: 1, resultado: 'CRUZA' }),
      filaLiquidacion({ id: 2, resultado: 'NO_CRUZA', incapacidad: null }),
      filaLiquidacion({ id: 3, resultado: 'DUPLICADA' }),
      filaLiquidacion({ id: 4, hoja: 'NEGACIONES', resultado: 'CRUZA', accion: 'FINALIZA', causalId: 1, incapacidad: incapacidadRef({ id: 9 }) }),
      filaLiquidacion({ id: 5, hoja: 'NEGACIONES', resultado: 'CRUZA', accion: 'RECOBRO', sinHomologar: true, incapacidad: incapacidadRef({ id: 10 }) }),
      filaLiquidacion({ id: 6, hoja: 'NEGACIONES', resultado: 'ERROR', sinHomologar: true, incapacidad: null }),
    ];
    const detalle = (f: FilaLiquidacion[]): CargaLiquidacionDetalle => ({
      carga: cargaLiquidacion(),
      resumen: {
        pagos: { total: 99, cruzan: 99, noCruzan: 0, ambiguas: 0, duplicadas: 0, errores: 0 },
        negaciones: { total: 0, cruzan: 0, noCruzan: 0, ambiguas: 0, duplicadas: 0, errores: 0, finalizan: 0, recobro: 0, sinHomologar: 0 },
        // ms-hr solo suma los pagos que CRUZAN (y no se entera de las asignaciones a mano).
        valorTotalPagos: 350184,
        incapacidadesDistintas: 1,
      },
      filas: f,
    });

    it('recalcula los conteos y el valor de la plantilla desde las filas (cuadran con la tabla)', () => {
      const r = resumenVigente(detalle(filas))!;
      expect(r.pagos).toEqual({ total: 3, cruzan: 1, noCruzan: 1, ambiguas: 0, duplicadas: 1, errores: 0 });
      expect(r.negaciones.total).toBe(3);
      expect(r.negaciones.cruzan).toBe(2);
      expect(r.negaciones.errores).toBe(1);
      expect(r.negaciones.finalizan).toBe(1);
      expect(r.negaciones.recobro).toBe(1);
      expect(r.negaciones.sinHomologar).toBe(2);
      // Valor de la plantilla = TODAS las filas de Pagos (3 x 350.184), no solo la que cruza.
      expect(r.valorTotalPagos).toBe(1050552);
      // Filas 1 y 4/5 cruzan con las incapacidades 100, 9 y 10.
      expect(r.incapacidadesDistintas).toBe(3);
    });

    it('un pago sin valor legible (fila con error) no rompe la suma de la plantilla', () => {
      const r = resumenVigente(detalle([filaLiquidacion({ id: 1, valorPagado: 1000 }), filaLiquidacion({ id: 2, resultado: 'ERROR', valorPagado: null })]))!;
      expect(r.valorTotalPagos).toBe(1000);
    });

    it('sin filas respeta el resumen que mando el backend', () => {
      expect(resumenVigente(detalle([]))?.pagos.total).toBe(99);
      expect(resumenVigente(null)).toBeNull();
    });

    it('arma el texto que pidio la funcional con singulares y plurales', () => {
      const a = alertaDeCarga(resumenVigente(detalle(filas)))!;
      expect(a.titulo).toBe('Subiste 3 pagos y 3 negaciones: 3 cruzan con una incapacidad, 1 no cruza.');
      expect(a.tono).toBe('aviso');
      expect(a.detalle.join(' ')).toContain('1 ya registrada');
      expect(a.detalle.join(' ')).toContain('1 con error');
      expect(a.detalle.join(' ')).toContain('otra fecha de inicio');
      expect(a.detalle.join(' ')).toContain('2 negaciones no tienen la causal homologada');
    });

    it('todo cruza: tono ok; nada cruza: tono peligro', () => {
      const ok = alertaDeCarga(resumenVigente(detalle([filaLiquidacion({ id: 1 })])))!;
      expect(ok.tono).toBe('ok');
      expect(ok.titulo).toBe('Subiste 1 pago y 0 negaciones: 1 cruza con una incapacidad, 0 no cruzan.');
      const nada = alertaDeCarga(resumenVigente(detalle([filaLiquidacion({ id: 1, resultado: 'NO_CRUZA' })])))!;
      expect(nada.tono).toBe('peligro');
    });
  });

  it('exporta las filas sin cruce con las columnas de la plantilla, resultado y sugerencias', () => {
    const filas = [
      filaLiquidacion({ id: 1, resultado: 'CRUZA' }),
      filaLiquidacion({
        id: 2, fila: 7, resultado: 'NO_CRUZA', resultadoEtiqueta: 'No cruza', mensaje: 'Sin incapacidad con ese codigo',
        incapacidad: null, sugerencias: [incapacidadRef({ codigoOficina: 'TASB020', fechaInicio: '2026-08-02', fechaFin: '2026-08-04' })],
      }),
      filaLiquidacion({ id: 3, hoja: 'NEGACIONES', resultado: 'ERROR', causalTexto: 'CAUSAL 51', fechaRespuesta: '2026-09-10' }),
    ];
    const sinCruce = filasSinCruce(filas);
    expect(sinCruce.map((f) => f.id)).toEqual([2, 3]);

    const libro = libroFilasSinCruce(sinCruce);
    expect(libro.SheetNames).toEqual(['Pagos', 'Negaciones']);
    const pagos = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Pagos']);
    expect(Object.keys(pagos[0]).slice(0, 4)).toEqual(['EPS', 'Cedula', 'Fecha inicio', 'Codigo unico']);
    expect(pagos[0]['Fecha inicio']).toBe('01/08/2026');
    expect(pagos[0]['Fila original']).toBe(7);
    expect(pagos[0]['Motivo']).toBe('Sin incapacidad con ese codigo');
    expect(String(pagos[0]['Sugerencias'])).toContain('TASB020 (02/08/2026 a 04/08/2026');
    const negaciones = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Negaciones']);
    expect(negaciones[0]['Causal de negacion (EPS)']).toBe('CAUSAL 51');
    expect(negaciones[0]['Fecha de respuesta']).toBe('10/09/2026');
  });

  it('trae todas las paginas en orden para exportar lo filtrado', (hecho) => {
    const paginas: Page<number>[] = [
      { content: [1, 2], number: 0, size: 2, totalElements: 5, totalPages: 3 },
      { content: [3, 4], number: 1, size: 2, totalElements: 5, totalPages: 3 },
      { content: [5], number: 2, size: 2, totalElements: 5, totalPages: 3 },
    ];
    const pedidas: number[] = [];
    traerTodasLasPaginas((p) => {
      pedidas.push(p);
      return of(paginas[p]);
    }).subscribe((todas) => {
      expect(todas).toEqual([1, 2, 3, 4, 5]);
      expect(pedidas).toEqual([0, 1, 2]);
      hecho();
    });
  });

  it('corta en el tope de paginas', (hecho) => {
    const pedidas: number[] = [];
    traerTodasLasPaginas(
      (p) => {
        pedidas.push(p);
        return of({ content: [p], number: p, size: 1, totalElements: 10, totalPages: 10 } as Page<number>);
      },
      2,
    ).subscribe((todas) => {
      expect(todas).toEqual([0, 1]);
      expect(pedidas).toEqual([0, 1]);
      hecho();
    });
  });

  it('saca el mensaje legible de los errores de ms-hr', () => {
    expect(mensajeDeError({ status: 409, error: { error: 'La carga no esta SIMULADA' } }, 'x')).toBe('La carga no esta SIMULADA');
    expect(mensajeDeError({ status: 0 }, 'x')).toContain('No hay conexión');
    expect(mensajeDeError({ status: 500, error: null }, 'Por defecto')).toBe('Por defecto');
  });
});

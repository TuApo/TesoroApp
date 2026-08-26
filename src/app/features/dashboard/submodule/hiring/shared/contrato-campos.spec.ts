import { centroDeCostosDe, centroDeCostosImpreso } from './contrato-campos';
import { faltantesDePagoTransporte } from '../pages/recruitment-pipeline/pago-transporte.rules';

/**
 * La columna es `ccentro_de_costos` y el guardado acepta `Ccentro_de_costos`:
 * leer solo la forma con mayúscula dejaba la generación bloqueada y el centro
 * de costo en blanco en la ficha y el carnet, con el dato guardado.
 */
describe('centro de costos · cómo lo devuelve la API vs cómo se guarda', () => {
  it('lo lee venga como venga', () => {
    expect(centroDeCostosDe({ ccentro_de_costos: 'CC-100' })).toBe('CC-100');
    expect(centroDeCostosDe({ Ccentro_de_costos: 'CC-100' })).toBe('CC-100');
    expect(centroDeCostosDe({ centro_de_costos: 'CC-100' })).toBe('CC-100');
    expect(centroDeCostosDe({})).toBe('');
    expect(centroDeCostosDe(null)).toBe('');
  });

  it('el impreso manda sobre el de nómina, y cae a él si no está', () => {
    expect(centroDeCostosImpreso({ carnet_centro_costo: 'CARNET', ccentro_de_costos: 'NOMINA' }))
      .toBe('CARNET');
    expect(centroDeCostosImpreso({ ccentro_de_costos: 'NOMINA' })).toBe('NOMINA');
  });

  it('con el centro de costos guardado, la generación NO se bloquea', () => {
    const contrato = {
      forma_de_pago: 'Daviplata',
      numero_para_pagos: '3024670656',
      // Tal cual lo devuelve la API.
      ccentro_de_costos: 'CC-100',
      subcentro_de_costos: 'SC-1',
      porcentaje_arl: 5,
      cesantias: 'FONDO NACIONAL DEL AHORRO',
      grupo: 'G1',
      categoria: 'C1',
      operacion: 'OP',
      fecha_ingreso: '2026-08-27',
      fecha_contrato: '2026-08-25',
    };
    expect(faltantesDePagoTransporte(contrato)).toEqual([]);
  });

  it('sin centro de costos sí lo pide', () => {
    expect(faltantesDePagoTransporte({
      forma_de_pago: 'Daviplata',
      numero_para_pagos: '3024670656',
      subcentro_de_costos: 'SC-1',
      porcentaje_arl: 5,
      cesantias: 'FNA',
      grupo: 'G1',
      categoria: 'C1',
      operacion: 'OP',
      fecha_ingreso: '2026-08-27',
      fecha_contrato: '2026-08-25',
    })).toEqual(['Centro de costos']);
  });
});

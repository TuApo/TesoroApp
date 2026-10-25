import { entidadDeCobro, esTipoArl } from './entidad-cobro';

describe('entidad de cobro (reunion 2026-10-20)', () => {
  it('accidente de trabajo y enfermedad laboral se cobran a la ARL', () => {
    expect(esTipoArl('ACCIDENTE_TRABAJO')).toBeTrue();
    expect(esTipoArl('ENFERMEDAD_LABORAL')).toBeTrue();
    expect(esTipoArl('ENFERMEDAD_GENERAL')).toBeFalse();
    expect(entidadDeCobro('ACCIDENTE_TRABAJO', 'COMPENSAR EPS')).toBe('ARL SURA');
    expect(entidadDeCobro('ACCIDENTE_TRABAJO', 'COMPENSAR EPS', 'ARL SURA ')).toBe('ARL SURA');
  });

  it('lo demas se cobra a la EPS', () => {
    expect(entidadDeCobro('ENFERMEDAD_GENERAL', ' NUEVA EPS ')).toBe('NUEVA EPS');
    expect(entidadDeCobro(null, 'SANITAS EPS')).toBe('SANITAS EPS');
    expect(entidadDeCobro('LICENCIA_MATERNIDAD', null)).toBe('');
  });
});

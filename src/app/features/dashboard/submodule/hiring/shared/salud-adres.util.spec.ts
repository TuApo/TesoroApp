import { detalleExcepcion, saludAdresDe } from './salud-adres.util';

describe('hiring/shared/salud-adres.util', () => {
  const base = { cedula: '1', encontrado: true, campos: {} };
  const rx = { regimen: 'EXCEPCION O ESPECIAL (OBSERVACION ADRES)', entidad: null, estado: null, fecha: null };

  it('sin respuesta o sin nada que avisar devuelve null', () => {
    expect(saludAdresDe(null)).toBeNull();
    expect(saludAdresDe({ ...base, regimen_excepcion: null, adres_sin_registro: false })).toBeNull();
  });

  it('régimen de excepción', () => {
    expect(saludAdresDe({ ...base, regimen_excepcion: rx })).toEqual({ excepcion: rx, sinRegistro: false });
  });

  it('ADRES sin registro pide verificar', () => {
    expect(saludAdresDe({ ...base, regimen_excepcion: null, adres_sin_registro: true }))
      .toEqual({ excepcion: null, sinRegistro: true });
  });

  it('si ya hay excepción, el aviso de sin registro sobra', () => {
    expect(saludAdresDe({ ...base, regimen_excepcion: rx, adres_sin_registro: true }))
      .toEqual({ excepcion: rx, sinRegistro: false });
  });

  it('arma el detalle con lo que haya', () => {
    expect(detalleExcepcion(null)).toBe('');
    expect(detalleExcepcion({ regimen: 'ESPECIAL', entidad: 'FOMAG', estado: 'ACTIVO', fecha: null }))
      .toBe('Régimen: ESPECIAL · Entidad: FOMAG · Estado: ACTIVO');
  });
});

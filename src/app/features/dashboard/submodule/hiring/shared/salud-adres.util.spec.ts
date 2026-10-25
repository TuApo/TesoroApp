import { detalleExcepcion, observacionExcepcionAdres, saludAdresDe } from './salud-adres.util';

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

  describe('observacionExcepcionAdres (texto del PDF)', () => {
    const pie = 'La información registrada en esta página es reflejo de lo reportado por las entidades del Régimen '
      + 'Subsidiado y el Régimen Contributivo, en cumplimiento de la Resolución 1133 de 2021';

    it('detecta la observación de régimen de excepción', () => {
      const t = 'Estación de origen: 192.0.2.10 Observaciones Los datos de afiliación correspondientes al '
        + 'número de identificación registrado, presentan a la fecha inconsistencia con una entidad del '
        + 'Regimen de Excepcion o Especial, se sugiere dirigirse a la entidad ' + pie;
      expect(observacionExcepcionAdres(t)).toBeTrue();
    });

    it('un PDF normal (solo el pie con "Régimen") no avisa', () => {
      expect(observacionExcepcionAdres('Observaciones ' + pie)).toBeFalse();
      expect(observacionExcepcionAdres('AFILIADO ACTIVO NUEVA EPS ' + pie)).toBeFalse();
      expect(observacionExcepcionAdres('')).toBeFalse();
      expect(observacionExcepcionAdres(null)).toBeFalse();
    });
  });
});

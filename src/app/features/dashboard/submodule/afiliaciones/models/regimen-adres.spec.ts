import { esRegimenExcepcion, etiquetaRegimenAdres, regimenAdresClass } from './regimen-adres';

describe('afiliaciones/models/regimen-adres', () => {
  it('reconoce el régimen especial o de excepción, con o sin tildes', () => {
    expect(esRegimenExcepcion('EXCEPCION O ESPECIAL (OBSERVACION ADRES)')).toBeTrue();
    expect(esRegimenExcepcion('Régimen de Excepción')).toBeTrue();
    expect(esRegimenExcepcion('CONTRIBUTIVO')).toBeFalse();
    expect(esRegimenExcepcion(null)).toBeFalse();
  });

  it('etiqueta corta para la tabla', () => {
    expect(etiquetaRegimenAdres('EXCEPCION O ESPECIAL (OBSERVACION ADRES)')).toBe('Especial/excepción');
    expect(etiquetaRegimenAdres('SUBSIDIADO')).toBe('SUBSIDIADO');
    expect(etiquetaRegimenAdres('')).toBe('');
    expect(etiquetaRegimenAdres('NULL')).toBe('');
  });

  it('clase del chip', () => {
    expect(regimenAdresClass('ESPECIAL')).toBe('adres-excepcion');
    expect(regimenAdresClass('Sin Registro')).toBe('adres-bad');
    expect(regimenAdresClass('CONTRIBUTIVO')).toBe('adres-ok');
    expect(regimenAdresClass('OTRO')).toBe('adres-neutro');
  });
});

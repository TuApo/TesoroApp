import { codigoSinGuion } from './codigos';

describe('codigoSinGuion', () => {
  it('quita el guion bajo del codigo tecnico historico', () => {
    expect(codigoSinGuion('1075263514_20260704')).toBe('107526351420260704');
    expect(codigoSinGuion('1073235544_20260819-2')).toBe('107323554420260819-2');
  });

  it('deja intactos los codigos que ya no lo llevan', () => {
    expect(codigoSinGuion('APTC004')).toBe('APTC004');
    expect(codigoSinGuion('107526351420260704')).toBe('107526351420260704');
  });

  it('tolera vacios y nulos', () => {
    expect(codigoSinGuion('')).toBe('');
    expect(codigoSinGuion(null)).toBe('');
    expect(codigoSinGuion(undefined)).toBe('');
  });
});

import { cedulaPrecargable, nombresDesdeAdres } from './precarga-antecedentes.util';

describe('precarga-antecedentes.util', () => {
  it('parte nombres y apellidos de ADRES', () => {
    expect(nombresDesdeAdres('IVAN DAVID', 'BERMUDEZ CASTAÑEDA')).toEqual({
      primer_nombre: 'IVAN', segundo_nombre: 'DAVID',
      primer_apellido: 'BERMUDEZ', segundo_apellido: 'CASTAÑEDA',
    });
    expect(nombresDesdeAdres(' MARIA  DE LOS ANGELES ', 'PEREZ')).toEqual({
      primer_nombre: 'MARIA', segundo_nombre: 'DE LOS ANGELES',
      primer_apellido: 'PEREZ', segundo_apellido: null,
    });
  });

  it('sin nombres no propone nada', () => {
    expect(nombresDesdeAdres(null, '')).toBeNull();
  });

  it('solo precarga cédulas numéricas', () => {
    expect(cedulaPrecargable(' 1122415324 ')).toBe('1122415324');
    expect(cedulaPrecargable('X123456')).toBeNull();
    expect(cedulaPrecargable('')).toBeNull();
  });
});

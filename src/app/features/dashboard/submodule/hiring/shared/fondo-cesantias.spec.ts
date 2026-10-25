import { fondoCesantias, fondoCesantiasDesdeAfp, opcionesFondoCesantias } from './fondo-cesantias';

describe('fondo-cesantias', () => {
  it('lleva lo guardado al nombre del catálogo, erratas incluidas', () => {
    expect(fondoCesantias('PROTECCIÓN')).toBe('PROTECCIÓN');
    expect(fondoCesantias('proteccion')).toBe('PROTECCIÓN');
    expect(fondoCesantias('PORTECCION')).toBe('PROTECCIÓN');
    expect(fondoCesantias('Old Mutual')).toBe('SKANDIA');
    expect(fondoCesantias('  ')).toBeNull();
    expect(fondoCesantias(null)).toBeNull();
    expect(fondoCesantias('OTRO FONDO')).toBe('OTRO FONDO');
  });

  it('propone el fondo de la AFP, salvo Colpensiones', () => {
    expect(fondoCesantiasDesdeAfp([{ nombre: 'EPS', observacion: 'SALUD TOTAL' }, { nombre: 'AFP', observacion: 'PORVENIR' }]))
      .toBe('PORVENIR');
    expect(fondoCesantiasDesdeAfp([{ nombre: 'AFP', observacion: 'COLPENSIONES' }])).toBeNull();
    expect(fondoCesantiasDesdeAfp([{ nombre: 'AFP', observacion: 'NO TIENE' }])).toBeNull();
    expect(fondoCesantiasDesdeAfp(undefined)).toBeNull();
  });

  it('las opciones conservan un valor guardado que no está en el catálogo', () => {
    expect(opcionesFondoCesantias('PORVENIR')).not.toContain('OTRO');
    expect(opcionesFondoCesantias('OTRO FONDO')).toContain('OTRO FONDO');
  });
});

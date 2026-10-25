import {
  claveOficina,
  clavesFueraDeSeleccion,
  filtrarOficinasSeleccion,
  nombresSedesSeleccion,
  sedeOfrecidaEnSeleccion,
} from './sedes-seleccion';

describe('shared/utils/sedes-seleccion', () => {
  const catalogo = [
    { nombre: 'SUBA', activa: true, opera_seleccion: true },
    { nombre: 'ANDES', activa: true, opera_seleccion: false },
    { nombre: 'MONTE_VERDE', activa: true, opera_seleccion: 0 },
    { nombre: 'BOSA', activa: true }, // backend anterior a V129: sin flag
    { nombre: 'CERRADA', activa: false, opera_seleccion: true },
    { nombre: 'FONTIBÓN', activa: 1, opera_seleccion: 1 },
    { nombre: '  ', activa: true, opera_seleccion: true },
  ];

  it('ofrece solo activas con opera_seleccion distinto de false/0', () => {
    expect(sedeOfrecidaEnSeleccion(catalogo[0])).toBeTrue();
    expect(sedeOfrecidaEnSeleccion(catalogo[1])).toBeFalse();
    expect(sedeOfrecidaEnSeleccion(catalogo[2])).toBeFalse();
    expect(sedeOfrecidaEnSeleccion(catalogo[3])).toBeTrue();
    expect(sedeOfrecidaEnSeleccion(catalogo[4])).toBeFalse();
    expect(sedeOfrecidaEnSeleccion(null)).toBeFalse();
  });

  it('lista los nombres ofrecidos, sin vacíos y ordenados', () => {
    expect(nombresSedesSeleccion(catalogo)).toEqual(['BOSA', 'FONTIBÓN', 'SUBA']);
    expect(nombresSedesSeleccion({ results: catalogo })).toEqual(['BOSA', 'FONTIBÓN', 'SUBA']);
    expect(nombresSedesSeleccion(null)).toEqual([]);
  });

  it('normaliza la clave de oficina', () => {
    expect(claveOficina('Monte Verde')).toBe('MONTEVERDE');
    expect(claveOficina('MONTE_VERDE')).toBe('MONTEVERDE');
    expect(claveOficina('Fontibón')).toBe('FONTIBON');
    expect(claveOficina(null)).toBe('');
  });

  it('arma las claves de sedes fuera de Selección', () => {
    const fuera = clavesFueraDeSeleccion(catalogo);
    expect(Array.from(fuera).sort()).toEqual(['ANDES', 'MONTEVERDE']);
  });

  it('filtra nombres pero conserva el valor actual', () => {
    const fuera = clavesFueraDeSeleccion(catalogo);
    const nombres = ['ANDES', 'SUBA', 'MONTE_VERDE', 'BOSA'];
    expect(filtrarOficinasSeleccion(nombres, fuera)).toEqual(['SUBA', 'BOSA']);
    expect(filtrarOficinasSeleccion(nombres, fuera, 'andes')).toEqual(['ANDES', 'SUBA', 'BOSA']);
  });
});

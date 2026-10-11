import { contiene, fragmentoAlrededor, iniciales, mensajeError, nombreCorto, normalizar, partirCoincidencias } from './texto';

describe('Reuniones · utilidades de texto', () => {
  it('normaliza sin tildes, en minúsculas y con espacios colapsados', () => {
    expect(normalizar('  Decisión   de NÓMINA ')).toBe('decision de nomina');
  });

  it('resalta sin tildes ni mayúsculas conservando el texto original', () => {
    const partes = partirCoincidencias('La decisión y otra Decision.', 'decision');
    expect(partes).toEqual([
      { texto: 'La ', marca: false },
      { texto: 'decisión', marca: true },
      { texto: ' y otra ', marca: false },
      { texto: 'Decision', marca: true },
      { texto: '.', marca: false },
    ]);
    expect(partirCoincidencias('hola', '')).toEqual([{ texto: 'hola', marca: false }]);
    expect(contiene('Cierre de NÓMINA', 'nomina')).toBeTrue();
  });

  it('iniciales: "Persona 3" es P3', () => {
    expect(iniciales('Marcela Gómez')).toBe('MG');
    expect(iniciales('Persona 3')).toBe('P3');
    expect(iniciales('Ana María López Díaz')).toBe('AL');
    expect(iniciales('')).toBe('?');
    expect(nombreCorto('Marcela Gómez')).toBe('Marcela');
    expect(nombreCorto('Persona 3')).toBe('Persona 3');
  });

  it('recorta alrededor de la coincidencia con puntos suspensivos', () => {
    const largo = `${'palabra '.repeat(40)}cierre de nómina ${'otra '.repeat(40)}`;
    const f = fragmentoAlrededor(largo, 'cierre', 30);
    expect(f.startsWith('…')).toBeTrue();
    expect(f.endsWith('…')).toBeTrue();
    expect(f).toContain('cierre de nómina');
    expect(fragmentoAlrededor('corto', 'x')).toBe('corto');
  });

  it('mensajes de error legibles', () => {
    expect(mensajeError({ status: 400, error: { error: 'Nombre obligatorio' } }, 'X')).toBe('Nombre obligatorio');
    expect(mensajeError({ status: 0 }, 'X')).toContain('No hay conexión');
    expect(mensajeError({ status: 403 }, 'X')).toContain('No tienes permiso');
    expect(mensajeError({ status: 503 }, 'No se pudo buscar')).toBe('No se pudo buscar: el servicio no está disponible en este momento.');
    expect(mensajeError(null, 'Por defecto')).toBe('Por defecto');
  });
});

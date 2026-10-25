import {
  alcanceSalud,
  dividirNombreCompleto,
  etiquetaNivel,
  nivelSalud,
  unirNombreCompleto,
  usaFormularioSimplificado,
} from './nivel-salud';

describe('nivel-salud (reunion 2026-10-20)', () => {
  it('toma el nivel MAS alto y ADMIN cuenta como todos', () => {
    expect(nivelSalud(['COORDINADOR', 'SALUD-N1-SUBE'])).toBe('N1');
    expect(nivelSalud(['salud-n1-sube', 'SALUD-N2-RADICA'])).toBe('N2');
    expect(nivelSalud(['SALUD-N4-CONSULTA', 'SALUD-N3-LIQUIDA'])).toBe('N3');
    expect(nivelSalud(['SALUD-N4-CONSULTA'])).toBe('N4');
    expect(nivelSalud(['SALUD-N1-SUBE', 'SALUD-TODOS'])).toBe('TODOS');
    expect(nivelSalud(['ADMIN'])).toBe('TODOS');
    // COORDINADOR sin nivel de Salud = nivel 1 (2026-10-22); un nivel explicito manda.
    expect(nivelSalud(['COORDINADOR'])).toBe('N1');
    expect(nivelSalud(['COORDINADOR', 'SALUD-N4-CONSULTA'])).toBe('N4');
    expect(nivelSalud(['COORDINADOR', 'SALUD-N2-RADICA'])).toBe('N2');
    expect(nivelSalud(['SALUD-N4-CONSULTA', 'OTRO'])).toBe('N4');
    expect(nivelSalud(null)).toBeNull();
  });

  it('solo el nivel 1 usa el formulario simplificado', () => {
    expect(usaFormularioSimplificado(['SALUD-N1-SUBE'])).toBeTrue();
    expect(usaFormularioSimplificado(['SALUD-N1-SUBE', 'SALUD-ALCANCE-ANDES-MONTEVERDE'])).toBeTrue();
    expect(usaFormularioSimplificado(['SALUD-N1-SUBE', 'SALUD-N2-RADICA'])).toBeFalse();
    expect(usaFormularioSimplificado(['SALUD-N3-LIQUIDA'])).toBeFalse();
    expect(usaFormularioSimplificado(['ADMIN'])).toBeFalse();
    expect(usaFormularioSimplificado([])).toBeFalse();
    expect(usaFormularioSimplificado(['COORDINADOR'])).toBeTrue();
    expect(usaFormularioSimplificado(['COORDINADOR', 'SALUD-N3-LIQUIDA'])).toBeFalse();
  });

  it('nombra el alcance por finca y queda vacio si ve todo', () => {
    expect(alcanceSalud(['SALUD-N4-CONSULTA', 'SALUD-ALCANCE-ANDES-MONTEVERDE'])).toBe('Andes y Monteverde');
    expect(alcanceSalud(['SALUD-ALCANCE-BELCHITE-FUTURO'])).toBe('Belchite y Futuro');
    expect(alcanceSalud(['SALUD-N1-SUBE'])).toBe('');
    // COORDINADOR: el servidor lo recorta a su oficina salvo con un rol mayor (2026-10-22).
    expect(alcanceSalud(['COORDINADOR'])).toBe('tu oficina');
    expect(alcanceSalud(['COORDINADOR', 'SALUD-ALCANCE-ANDES-MONTEVERDE'])).toBe('Andes y Monteverde, tu oficina');
    expect(alcanceSalud(['COORDINADOR', 'SALUD-N2-RADICA'])).toBe('');
    expect(alcanceSalud(['COORDINADOR', 'GERENCIA'])).toBe('');
    expect(alcanceSalud(['COORDINADOR', 'ADMIN'])).toBe('');
    expect(etiquetaNivel('TODOS')).toBe('Todos los niveles');
    expect(etiquetaNivel(null)).toBe('');
  });

  it('divide el nombre unico con los apellidos primero', () => {
    expect(dividirNombreCompleto('quintero ramirez luisa fernanda')).toEqual({
      primerApellido: 'QUINTERO',
      segundoApellido: 'RAMIREZ',
      primerNombre: 'LUISA',
      segundoNombre: 'FERNANDA',
    });
    expect(dividirNombreCompleto('  ACOSTA  ROJAS YULI ')).toEqual({
      primerApellido: 'ACOSTA',
      segundoApellido: 'ROJAS',
      primerNombre: 'YULI',
      segundoNombre: '',
    });
    expect(dividirNombreCompleto('PEREZ ANA').primerNombre).toBe('ANA');
    expect(dividirNombreCompleto('').primerApellido).toBe('');
    expect(unirNombreCompleto({ primerApellido: 'PEREZ', primerNombre: 'ANA', segundoNombre: ' ' })).toBe('PEREZ ANA');
  });
});

import {
  entradasDeHoja,
  estadoFuente,
  leerCedulas,
  limpiarCedula,
  partirTexto,
  tipoDocCanonico,
} from './consulta-antecedentes.util';

describe('consulta-antecedentes.util', () => {
  it('limpia cédulas con puntos, espacios, tipo y celdas numéricas', () => {
    expect(limpiarCedula('1.122.415.324')).toBe('1122415324');
    expect(limpiarCedula(' 1122415324 ')).toBe('1122415324');
    expect(limpiarCedula(1122415324)).toBe('1122415324');
    expect(limpiarCedula('1122415324.0')).toBe('1122415324');
    expect(limpiarCedula('CC 1122415324')).toBe('1122415324');
  });

  it('descarta lo que no es cédula', () => {
    expect(limpiarCedula('')).toBeNull();
    expect(limpiarCedula('Cédula')).toBeNull();
    expect(limpiarCedula('123')).toBeNull();
    expect(limpiarCedula('123456789012')).toBeNull();
    expect(limpiarCedula('JUAN 1122415324')).toBeNull();
  });

  it('cuenta repetidas e inválidas', () => {
    const l = leerCedulas(partirTexto('1122415324\n1.122.415.324, 9000000464; abc\n\n'));
    expect(l.validas.map((v) => v.cedula)).toEqual(['1122415324', '9000000464']);
    expect(l.duplicadas).toBe(1);
    expect(l.invalidas).toEqual(['abc']);
  });

  it('normaliza el tipo de documento', () => {
    expect(tipoDocCanonico('pet')).toBe('PPT');
    expect(tipoDocCanonico('C.E.')).toBe('CE');
    expect(tipoDocCanonico('')).toBe('CC');
    expect(tipoDocCanonico('raro')).toBe('CC');
  });

  it('encuentra la columna por encabezado aunque no sea la primera', () => {
    const filas = [
      ['Nombre', 'Tipo documento', 'Número de documento'],
      ['Ana', 'CE', '1.122.415.324'],
      ['Luis', '', 9000000464],
    ];
    expect(entradasDeHoja(filas)).toEqual([
      { valor: '1.122.415.324', tipo: 'CE' },
      { valor: 9000000464, tipo: '' },
    ]);
  });

  it('sin encabezado toma la primera columna con cédulas', () => {
    const filas = [['x', 1122415324], ['y', '9000000464']];
    expect(entradasDeHoja(filas).map((e) => e.valor)).toEqual([1122415324, '9000000464']);
  });

  it('traduce el estado de la cola', () => {
    expect(estadoFuente(null)).toBe('sin_fila');
    expect(estadoFuente('SIN_CONSULTAR')).toBe('en_cola');
    expect(estadoFuente('EN_PROGRESO')).toBe('consultando');
    expect(estadoFuente('BLOQUEADO')).toBe('bloqueado');
    expect(estadoFuente('FINALIZADO')).toBe('consultado');
  });
});

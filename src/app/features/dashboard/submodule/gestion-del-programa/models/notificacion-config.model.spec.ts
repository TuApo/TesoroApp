/**
 * Lógica pura del modelo de parametrización.
 *
 * Lo que se prueba aquí no es cosmético: `condicion_json` mal serializado hace
 * que la regla NO dispare (el evaluador del backend devuelve false ante un JSON
 * que no puede leer) y ese fallo es invisible — se ve como "no llegó la
 * notificación", no como un error.
 */
import {
  parseAudiencia,
  parseCondiciones,
  placeholdersDe,
  serializarCondiciones,
} from './notificacion-config.model';

describe('parseCondiciones', () => {
  it('sin condiciones devuelve lista vacía (la regla siempre aplica)', () => {
    expect(parseCondiciones(null)).toEqual([]);
    expect(parseCondiciones('')).toEqual([]);
    expect(parseCondiciones('   ')).toEqual([]);
  });

  it('lee la lista de condiciones del backend', () => {
    const json = '[{"campo":"destino","op":"IN","valor":["CONTRATACION"]}]';
    expect(parseCondiciones(json)).toEqual([
      { campo: 'destino', op: 'IN', valor: ['CONTRATACION'] },
    ]);
  });

  it('devuelve null ante JSON inválido, no lista vacía', () => {
    // La diferencia importa: con [] el formulario pisaría una condición escrita
    // a mano; con null se muestra en crudo y se conserva.
    expect(parseCondiciones('{ esto no es json')).toBeNull();
    expect(parseCondiciones('{"campo":"x"}')).withContext('un objeto no es una lista').toBeNull();
  });
});

describe('serializarCondiciones', () => {
  it('una lista vacía se guarda como null', () => {
    expect(serializarCondiciones([])).toBeNull();
  });

  it('descarta las filas sin campo (a medio escribir)', () => {
    expect(serializarCondiciones([{ campo: '  ', op: 'EQ', valor: 'x' }])).toBeNull();
  });

  it('omite el valor en los operadores que no lo usan', () => {
    const json = serializarCondiciones([{ campo: 'link', op: 'EXISTS', valor: 'sobra' }]);
    expect(JSON.parse(json!)).toEqual([{ campo: 'link', op: 'EXISTS' }]);
  });

  it('conserva el valor como lista en IN', () => {
    const json = serializarCondiciones([
      { campo: 'destino', op: 'IN', valor: ['CONTRATACION', 'GESTION_HUMANA'] },
    ]);
    expect(JSON.parse(json!)).toEqual([
      { campo: 'destino', op: 'IN', valor: ['CONTRATACION', 'GESTION_HUMANA'] },
    ]);
  });

  it('ida y vuelta sin pérdida', () => {
    const original = [
      { campo: 'destino', op: 'IN' as const, valor: ['A', 'B'] },
      { campo: 'horasRestantes', op: 'LTE' as const, valor: '2' },
    ];
    expect(parseCondiciones(serializarCondiciones(original))).toEqual(original);
  });
});

describe('parseAudiencia', () => {
  it('lee la lista de ids', () => {
    expect(parseAudiencia('["a","b"]')).toEqual(['a', 'b']);
  });

  it('ante basura devuelve vacío en vez de romper el formulario', () => {
    expect(parseAudiencia('no-json')).toEqual([]);
    expect(parseAudiencia(null)).toEqual([]);
  });
});

describe('placeholdersDe', () => {
  it('extrae los campos de una plantilla, incluidas las rutas con puntos', () => {
    expect(placeholdersDe('Vence {{card.title}}', 'Quedan {{horas}} h'))
      .toEqual(['card.title', 'horas']);
  });

  it('no repite el mismo campo usado en título y mensaje', () => {
    expect(placeholdersDe('{{titulo}}', '{{titulo}}')).toEqual(['titulo']);
  });

  it('tolera espacios dentro de las llaves', () => {
    expect(placeholdersDe('{{ card.id }}')).toEqual(['card.id']);
  });

  it('ignora nulos y textos sin placeholders', () => {
    expect(placeholdersDe(null, undefined, 'texto plano')).toEqual([]);
  });
});

import { graficasAnalisisMd, informeAnalisisMd } from './analisis-informe';
import { AnalisisCandidato, normalizarAnalisis } from './analisis-ia.service';
import { markdownToHtml } from '../../../nomina/pages/analitica-nomina-ia/markdown-lite';

/**
 * El panel "Lectura del expediente" mostraba el JSON crudo del modelo cuando
 * este se quedaba sin tokens. Ahora pinta un informe en Markdown armado aquí.
 */
describe('Lectura del expediente — informe en Markdown', () => {
  const completo: AnalisisCandidato = {
    resumen: 'Operario con **3 contratos** previos en cultivo.',
    ajusteVacante: { nivel: 'alto', porque: 'Ya trabajó en la finca | bloque 4.' },
    estabilidadLaboral: { nivel: 'medio', porque: 'Contratos cortos\nde 3 meses.' },
    cargoSugerido: { cargo: 'Operario de cultivo', porque: 'Experiencia en corte.' },
    redDeApoyo: { resumen: 'Vive con la madre, que cuida a los hijos.', evidencia: 'vivienda.responsable_hijos' },
    aFavor: [{ punto: 'Experiencia en flores', evidencia: 'contratos: 3' }, { punto: '' }],
    enContra: [],
    riesgos: [{ punto: 'Antecedentes consultados hace 5 meses' }],
    datosQueFaltan: ['Examen médico', '  '],
    preguntasSugeridas: ['¿Tiene transporte a la finca?'],
  };

  it('arma las secciones del informe en orden', () => {
    const md = informeAnalisisMd(completo);
    const orden = ['Resumen ejecutivo', 'Indicadores clave', 'Red de apoyo', 'Puntos a favor',
      'Puntos en contra', 'Riesgos a verificar', 'Información pendiente', 'Preguntas sugeridas'];
    let desde = -1;
    for (const titulo of orden) {
      const i = md.indexOf(`### ${titulo}`);
      expect(i).withContext(titulo).toBeGreaterThan(desde);
      desde = i;
    }
  });

  it('la tabla de indicadores no se parte por saltos de línea ni barras del modelo', () => {
    const html = markdownToHtml(informeAnalisisMd(completo));
    expect(html).toContain('<table>');
    expect(html).toContain('<strong>Alto</strong>');
    expect(html).toContain('Ya trabajó en la finca / bloque 4.');
    expect(html).toContain('Contratos cortos de 3 meses.');
  });

  it('descarta puntos y textos vacíos y dice cuando una lista no trae nada', () => {
    const md = informeAnalisisMd(completo);
    expect(md).toContain('1. Experiencia en flores — *contratos: 3*');
    expect(md).not.toContain('2. ');
    expect(md).toContain('*El expediente no da puntos en contra.*');
    expect(md).toContain('- Examen médico');
  });

  it('los nombres de campo con guion bajo no se vuelven cursiva', () => {
    const html = markdownToHtml(informeAnalisisMd(completo));
    expect(html).toContain('vivienda.responsable_hijos');
  });

  it('si el resumen llega siendo el JSON crudo, se lee el JSON', () => {
    const crudo = JSON.stringify({ resumen: 'Operario.', aFavor: [{ punto: 'A' }] });
    const a = normalizarAnalisis({ resumen: '```json\n' + crudo + '\n```', cedula: '1' });
    expect(a.resumen).toBe('Operario.');
    expect(a.cedula).toBe('1');
    expect(a.parcial).toBeUndefined();
  });

  it('si el JSON viene cortado, salva lo que alcanzó y lo marca parcial', () => {
    const a = normalizarAnalisis({ resumen: '{"resumen":"Operario.","aFavor":[{"punto":"A"},{"punto":"B","evid' });
    expect(a.resumen).toBe('Operario.');
    expect(a.parcial).toBeTrue();
    expect(a.aviso).toContain('cortó');
    expect(informeAnalisisMd(a)).not.toContain('{');
  });

  it('un resumen en prosa pasa tal cual', () => {
    const a: AnalisisCandidato = { resumen: 'Operario con experiencia.' };
    expect(normalizarAnalisis(a).resumen).toBe('Operario con experiencia.');
  });

  it('tipa lo que el modelo manda fuera del contrato', () => {
    const a = normalizarAnalisis({
      resumen: JSON.stringify({
        resumen: 'Operario.',
        ajusteVacante: { nivel: 'ALTO' },
        estabilidadLaboral: { nivel: 'Media', porque: 3 },
        aFavor: ['Puntual', { punto: 'Experiencia', evidencia: 'contratos' }, {}],
        datosQueFaltan: [{ punto: 'Examen' }, 7],
        observacionesGenerales: { transporte: 'Ruta 4', turnos: ['día', 'noche'] },
      }),
    } as AnalisisCandidato);
    expect(a.ajusteVacante?.nivel).toBe('alto');
    expect(a.estabilidadLaboral).toEqual({ nivel: 'medio', porque: '3' });
    expect(a.aFavor).toEqual([{ punto: 'Puntual' }, { punto: 'Experiencia', evidencia: 'contratos' }]);
    expect(a.datosQueFaltan).toEqual(['Examen', '7']);
    const md = informeAnalisisMd(a);
    expect(md).toContain('### Observaciones generales');
    expect(md).toContain('- **Transporte:** Ruta 4');
    expect(md).toContain('- **Turnos:** día, noche');
    expect(md).not.toContain('{');
  });

  it('una lista de objetos extra sale como tabla', () => {
    const a = normalizarAnalisis({ resumen: 'x', contratos: [{ finca: 'A', meses: 3 }] } as AnalisisCandidato);
    const html = markdownToHtml(informeAnalisisMd(a));
    expect(html).toContain('<table>');
    expect(html).toContain('Finca');
  });

  it('arma balance y semáforo como gráficas, y suma las que mande la IA', () => {
    const a = normalizarAnalisis({
      ...completo,
      graficas: [{ titulo: 'Contratos por año', opciones: { series: [{ type: 'line', data: [1, 2] }] } }, { nada: 1 }],
    } as AnalisisCandidato);
    const g = graficasAnalisisMd(a);
    expect(g.length).toBe(3);
    expect(g[0]).toContain('#### Balance del perfil');
    expect(g[1]).toContain('Ajuste a la vacante: Alto');
    expect(g[2]).toContain('#### Contratos por año');
    for (const b of g) {
      const json = b.slice(b.indexOf('```echarts\n') + 11, b.lastIndexOf('```'));
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });

  it('sin datos no hay gráficas', () => {
    expect(graficasAnalisisMd(normalizarAnalisis({ resumen: 'x' }))).toEqual([]);
  });
});

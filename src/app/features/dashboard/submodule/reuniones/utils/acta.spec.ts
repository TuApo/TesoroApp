import { generarActaMarkdown, nombreArchivoActa, nombreDeSegmento, responsableDe } from './acta';
import { ACUERDOS, HABLANTES, SEGMENTOS, acuerdo, detalle, insights, segmento } from '../testing/fabricas';

describe('Reuniones · acta en Markdown', () => {
  const d = detalle();
  const base = () => generarActaMarkdown({
    reunion: { code: 'REU-0001', name: 'Cierre de nómina de septiembre', held_on: '2026-09-12', objective: 'Definir la fecha' },
    insights: insights(),
    segmentos: SEGMENTOS,
    participantes: d.participants,
    generadoEn: new Date(2026, 8, 26, 10, 0),
  });

  it('trae encabezado con código, fecha, duración y personas', () => {
    const md = base();
    expect(md.startsWith('# Acta de reunión: Cierre de nómina de septiembre')).toBeTrue();
    expect(md).toContain('- **Código:** REU-0001');
    expect(md).toContain('- **Fecha:** 12 sep 2026');
    expect(md).toContain('- **Duración:** 38 s');
    expect(md).toContain('- **Personas que hablaron:** 3');
    expect(md).toContain('- **Objetivo:** Definir la fecha');
  });

  it('lista quiénes hablaron con tiempo y porcentaje, y el resumen', () => {
    const md = base();
    expect(md).toContain('- **Marcela Gómez**: 12 s, 31 % del tiempo');
    expect(md).toContain('- **Persona 2** (Sistemas): 14 s');
    expect(md).toContain('## Resumen\n\nSe acordó cerrar la nómina el viernes.\nJavier enviará el reporte.');
  });

  it('pone los temas con su rango de tiempo', () => {
    expect(base()).toContain('1. **Cierre de nómina** [00:00–00:12]: Fecha del cierre.');
  });

  it('agrupa compromisos por persona, con fecha dicha, minuto y estado', () => {
    const md = base();
    expect(md).toContain('### Decisiones');
    expect(md).toContain('- Cerrar la nómina el viernes _(planteó: Marcela Gómez)_ · [00:06]');
    expect(md).toContain('### Compromisos por persona');
    expect(md).toContain('**Javier**\n\n- [ ] Enviar el reporte de accesos (para: el viernes 15) · [00:19]');
    expect(md).toContain('**Luisa**\n\n- [x] Validar contratos nuevos · [00:27]');
  });

  it('incluye la transcripción completa por turnos con nombres y minutos', () => {
    const md = base();
    expect(md).toContain('## Transcripción completa');
    expect(md).toContain('**[00:00] Marcela Gómez:** Buenos días, soy Marcela, de nómina. Necesitamos cerrar la nómina el viernes.');
    expect(md).toContain('**[00:12] Persona 2:** Soy Javier, de sistemas.');
    expect(md).toContain('_Acta generada desde TuApo el 26 sep 2026._');
  });

  it('omite los descartados y avisa cuando no hay resumen ni acuerdos', () => {
    const md = generarActaMarkdown({
      reunion: { code: 'X', name: 'Vacía', held_on: null },
      insights: insights({ analysis: null, topics: [], items: [acuerdo({ id: 'q', text: 'Descartado', status: 'DESCARTADO' })] }),
      segmentos: [],
    });
    expect(md).toContain('_Sin resumen generado._');
    expect(md).toContain('_No se registraron acuerdos._');
    expect(md).toContain('_Sin transcripción._');
    expect(md).not.toContain('Descartado');
    expect(md).not.toContain('## Temas');
  });

  it('un salto de línea dentro de un acuerdo no rompe la lista', () => {
    const md = generarActaMarkdown({
      reunion: { code: 'X', name: 'N', held_on: null },
      insights: insights({ items: [acuerdo({ id: 'z', kind: 'RIESGO', text: 'Uno\nDos' })] }),
      segmentos: [],
    });
    expect(md).toContain('- Uno Dos');
  });

  it('resuelve el responsable y el nombre del segmento con el mismo criterio que la vista', () => {
    const mapa = new Map(HABLANTES.map(h => [h.id, h]));
    expect(responsableDe(ACUERDOS[1], mapa)).toBe('Javier');
    expect(responsableDe(acuerdo({ id: 'o', owner_speaker_id: 'h1' }), mapa)).toBe('Marcela Gómez');
    expect(responsableDe(acuerdo({ id: 'p', owner_participant_id: 'p2' }), mapa, d.participants)).toBe('Javier Ruiz');
    expect(responsableDe(acuerdo({ id: 'n' }), mapa)).toBeNull();
    expect(nombreDeSegmento(SEGMENTOS[0], mapa)).toBe('Marcela Gómez');
    expect(nombreDeSegmento(segmento({ id: 9, speaker_label: 'Persona 9' }), mapa)).toBe('Persona 9');
  });

  it('nombre de archivo seguro', () => {
    expect(nombreArchivoActa('REU-0001', 'Cierre de nómina: ¡septiembre!')).toBe('acta-REU-0001-cierre-de-nomina-septiembre.md');
    expect(nombreArchivoActa('', '')).toBe('acta-reunion.md');
  });
});

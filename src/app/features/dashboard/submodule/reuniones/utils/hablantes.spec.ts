import { claveDePersona, colorVar, idxDeClave, ordenarHablantes, participanteDeSugerencia } from './hablantes';
import { estadoReunionHumano, pasoPipeline } from './estado';
import { hablante, participante, resumen } from '../testing/fabricas';

describe('Reuniones · hablantes y estado', () => {
  it('color por índice, con vuelta a los 12 y gris sin índice', () => {
    expect(colorVar(0)).toBe('var(--hc0)');
    expect(colorVar(13)).toBe('var(--hc1)');
    expect(colorVar(-1)).toBe('var(--hc11)');
    expect(colorVar(null)).toBe('var(--hc-nulo)');
    expect(idxDeClave('u:42')).toBe(idxDeClave('u:42'));
    expect(idxDeClave('u:42')).toBeGreaterThanOrEqual(0);
    expect(idxDeClave('u:42')).toBeLessThan(12);
  });

  it('ordena por color (orden de aparición)', () => {
    const hs = ordenarHablantes([hablante({ id: 'b', color_idx: 1 }), hablante({ id: 'a', color_idx: 0 }), hablante({ id: 'c', color_idx: null })]);
    expect(hs.map(h => h.id)).toEqual(['a', 'b', 'c']);
  });

  it('la sugerencia de la IA coincide sólo con UN participante', () => {
    const ps = [
      participante({ id: '1', first_name: 'Marcela', last_name: 'Gómez', display_name: 'Marcela Gómez' }),
      participante({ id: '2', first_name: 'Javier', last_name: 'Ruiz', display_name: 'Javier Ruiz' }),
      participante({ id: '3', first_name: 'Javier', last_name: 'Pérez', display_name: 'Javier Pérez' }),
    ];
    expect(participanteDeSugerencia('Marcela', ps)?.id).toBe('1');
    expect(participanteDeSugerencia('marcela gomez', ps)?.id).toBe('1');
    expect(participanteDeSugerencia('Javier', ps)).toBeNull();          // dos Javier: no se adivina
    expect(participanteDeSugerencia('Javier Ruiz', ps)?.id).toBe('2');
    expect(participanteDeSugerencia('Damián', ps)).toBeNull();
    expect(participanteDeSugerencia(null, ps)).toBeNull();
  });

  it('la clave de persona es la que manda el backend: no se recalcula', () => {
    // "Doctora" y el guion los quita el backend; el front no debe inventarse otra clave.
    const p = participante({ id: 'x', display_name: 'Doctora Ana Peña-Ruiz', person_key: 'n:ana pena ruiz' });
    expect(claveDePersona(p)).toBe('n:ana pena ruiz');
    // El hablante manda primero; si no la trae, la del participante.
    expect(claveDePersona(hablante({ id: 'h', person_key: 'u:42' }), p)).toBe('u:42');
    expect(claveDePersona(hablante({ id: 'h', person_key: null }), p)).toBe('n:ana pena ruiz');
    // Sin clave del backend (un backend viejo) no hay enlace, en vez de uno que abra una ficha vacía.
    expect(claveDePersona(participante({ id: 'x', usuario_id: '42', display_name: 'A' }))).toBeNull();
    expect(claveDePersona(null, undefined)).toBeNull();
  });

  it('estado de la reunión en lenguaje humano', () => {
    expect(estadoReunionHumano(resumen()).texto).toBe('Transcrita y resumida');
    expect(estadoReunionHumano(resumen({ recordings_count: 0, pipeline_status: null })).texto).toBe('Sin grabación');
    expect(estadoReunionHumano(resumen({ pipeline_status: 'TRANSCRIBING', transcript_status: 'EN_PROCESO' })))
      .toEqual({ texto: 'Transcribiendo lo que se dijo…', tono: 'progreso', icono: 'autorenew' });
    expect(estadoReunionHumano(resumen({ pipeline_status: 'FAILED', transcript_status: 'ERROR' })).tono).toBe('error');
    expect(estadoReunionHumano(resumen({ analysis_status: 'ERROR' })).texto).toBe('Transcrita, sin resumen');
    expect(estadoReunionHumano(resumen({ analysis_status: 'EN_PROCESO' })).texto).toBe('Resumiendo…');
  });

  it('paso visible del pipeline', () => {
    expect(pasoPipeline('UPLOADED')).toEqual({ paso: 1, total: 5, texto: 'Recibimos la grabación' });
    expect(pasoPipeline('TRANSCRIBING').paso).toBe(3);
    expect(pasoPipeline('GENERATING_SUMMARY').paso).toBe(5);
    expect(pasoPipeline('COMPLETED').paso).toBe(5);
  });
});

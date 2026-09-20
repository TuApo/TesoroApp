import {
  campoMotivoContrario,
  campoMotivoDe,
  ESTADOS_OBSERVACION,
  MAX_MOTIVO,
  observacionCompleta,
} from './observacion-evaluador.rules';

describe('observación del evaluador', () => {
  it('son exactamente tres estados', () => {
    expect(ESTADOS_OBSERVACION.map((e) => e.valor)).toEqual(['APLICA', 'NO_APLICA', 'EN_ESPERA']);
  });

  it('APLICA no pide motivo', () => {
    expect(campoMotivoDe('APLICA')).toBeNull();
    expect(observacionCompleta('APLICA', {})).toBeTrue();
  });

  it('NO_APLICA exige el motivo por el que no puede ser contratado', () => {
    expect(campoMotivoDe('NO_APLICA')).toBe('motivoNoAplica');
    expect(observacionCompleta('NO_APLICA', {})).toBeFalse();
    expect(observacionCompleta('NO_APLICA', { motivoNoAplica: '   ' })).toBeFalse();
    expect(observacionCompleta('NO_APLICA', { motivoNoAplica: 'Reportado por la finca' })).toBeTrue();
  });

  it('EN_ESPERA exige la observación de por qué aplica pero no ahora', () => {
    expect(campoMotivoDe('EN_ESPERA')).toBe('motivoEspera');
    expect(observacionCompleta('EN_ESPERA', {})).toBeFalse();
    expect(observacionCompleta('EN_ESPERA', { motivoEspera: 'Sin vacante de poscosecha' })).toBeTrue();
  });

  it('el motivo de un estado no vale para el otro', () => {
    expect(observacionCompleta('NO_APLICA', { motivoEspera: 'texto' })).toBeFalse();
    expect(observacionCompleta('EN_ESPERA', { motivoNoAplica: 'texto' })).toBeFalse();
  });

  it('sin estado elegido la observación no está completa', () => {
    for (const v of [null, undefined, '', 'CUALQUIERA']) {
      expect(observacionCompleta(v, { motivoNoAplica: 'x', motivoEspera: 'x' })).toBeFalse();
    }
  });

  it('el motivo se corta en el tope', () => {
    expect(observacionCompleta('NO_APLICA', { motivoNoAplica: 'x'.repeat(MAX_MOTIVO) })).toBeTrue();
    expect(observacionCompleta('NO_APLICA', { motivoNoAplica: 'x'.repeat(MAX_MOTIVO + 1) })).toBeFalse();
  });

  it('al elegir un estado se limpia el motivo del otro', () => {
    expect(campoMotivoContrario('NO_APLICA')).toBe('motivoEspera');
    expect(campoMotivoContrario('EN_ESPERA')).toBe('motivoNoAplica');
    expect(campoMotivoContrario('APLICA')).toBeNull();
  });
});

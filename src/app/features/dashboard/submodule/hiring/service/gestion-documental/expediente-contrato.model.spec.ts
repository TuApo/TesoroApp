import {
  ContratoExpediente,
  etiquetaContrato,
  fechaCorta,
  procesoValido,
  textoAsignacion,
  tonoEstado,
} from './expediente-contrato.model';

function contrato(over: Partial<ContratoExpediente> = {}): ContratoExpediente {
  return {
    proceso_id: 112614,
    codigo_contrato: '726312',
    fecha_ingreso: '2026-08-19',
    fecha_retiro: null,
    contrato_activo: true,
    temporal: 'TA',
    empresa_usuaria: null,
    oficina: 'SUBA',
    contratado: true,
    contratado_at: null,
    proceso_creado_at: null,
    tiene_contrato: true,
    seleccionado: false,
    ...over,
  };
}

describe('expediente-contrato.model', () => {
  describe('procesoValido', () => {
    it('acepta ids positivos como número o texto', () => {
      expect(procesoValido(112614)).toBe('112614');
      expect(procesoValido(' 7 ')).toBe('7');
      expect(procesoValido('007')).toBe('7');
    });

    it('nunca manda basura que etiquete mal un documento', () => {
      expect(procesoValido(undefined)).toBeNull();
      expect(procesoValido(null)).toBeNull();
      expect(procesoValido('undefined')).toBeNull();
      expect(procesoValido('null')).toBeNull();
      expect(procesoValido(0)).toBeNull();
      expect(procesoValido(-3)).toBeNull();
      expect(procesoValido('12a')).toBeNull();
      expect(procesoValido(1.5)).toBeNull();
    });
  });

  describe('etiquetaContrato', () => {
    it('muestra código, ingreso y retiro', () => {
      expect(etiquetaContrato(contrato())).toBe('726312 · ingreso 2026-08-19');
      expect(etiquetaContrato(contrato({ fecha_retiro: '2026-09-01' })))
        .toBe('726312 · ingreso 2026-08-19 · retiro 2026-09-01');
    });

    it('dice qué falta cuando no hay código', () => {
      expect(etiquetaContrato(contrato({ codigo_contrato: null, fecha_ingreso: null }))).toBe('Sin código');
      expect(etiquetaContrato(contrato({ codigo_contrato: '', tiene_contrato: false, fecha_ingreso: null })))
        .toBe('Proceso sin contrato');
      expect(etiquetaContrato(null)).toBe('Sin contrato');
    });
  });

  it('tonoEstado pinta cada estado', () => {
    expect(tonoEstado('OK')).toEqual({ texto: 'Entregado', tono: 'ok' });
    expect(tonoEstado('SIN_ASIGNAR')).toEqual({ texto: 'Sin asignar', tono: 'warn' });
    expect(tonoEstado('FALTA')).toEqual({ texto: 'Falta', tono: 'danger' });
    expect(tonoEstado(undefined).tono).toBe('danger');
  });

  it('textoAsignacion explica el origen', () => {
    expect(textoAsignacion('UNICO_CONTRATO')).toContain('Único contrato');
    expect(textoAsignacion(null)).toBe('');
  });

  it('fechaCorta deja la fecha local sin hora', () => {
    expect(fechaCorta('2026-08-19')).toBe('2026-08-19');
    expect(fechaCorta('')).toBe('');
    expect(fechaCorta(null)).toBe('');
    expect(fechaCorta('2026-09-02T15:00:00Z')).toMatch(/^2026-09-0[12]$/);
  });
});

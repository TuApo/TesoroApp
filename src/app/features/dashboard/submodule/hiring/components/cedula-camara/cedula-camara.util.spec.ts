import {
  etiquetaPaso, interpretarArmado, mensajeFallo, porcentajePaso, TIPO_CARA,
} from './cedula-camara.util';

describe('cedula-camara.util', () => {

  it('los tipos de cara son los que ms-documents reconoce (CedulaAmpliadaService.esCara)', () => {
    expect(TIPO_CARA.frente).toBe('DOCUMENTO_IDENTIDAD_FRENTE');
    expect(TIPO_CARA.reverso).toBe('DOCUMENTO_IDENTIDAD_REVERSO');
  });

  describe('interpretarArmado', () => {
    it('CREADA y YA_ESTABA con id sirven', () => {
      expect(interpretarArmado({ estado: 'CREADA', id: 120 })).toEqual(
        jasmine.objectContaining({ ok: true, id: 120, estado: 'CREADA' }));
      expect(interpretarArmado({ estado: 'ya_estaba', id: '77' })).toEqual(
        jasmine.objectContaining({ ok: true, id: 77, estado: 'YA_ESTABA' }));
    });

    it('SIN_CARAS no sirve y lo dice', () => {
      const r = interpretarArmado({ estado: 'SIN_CARAS', id: null });
      expect(r.ok).toBeFalse();
      expect(r.mensaje).toContain('dos caras');
    });

    it('sin id, o sin respuesta, no se da por armada', () => {
      expect(interpretarArmado({ estado: 'CREADA', id: null }).ok).toBeFalse();
      expect(interpretarArmado({ estado: 'CREADA', id: 0 }).ok).toBeFalse();
      expect(interpretarArmado(null).ok).toBeFalse();
      expect(interpretarArmado('CREADA').ok).toBeFalse();
    });
  });

  describe('mensajeFallo', () => {
    it('dice qué quedó guardado según el paso', () => {
      expect(mensajeFallo('frente', '')).toContain('no quedó nada guardado');
      expect(mensajeFallo('reverso', '')).toContain('El frente quedó guardado');
      expect(mensajeFallo('armando', '')).toContain('Las dos caras quedaron guardadas');
    });

    it('agrega el detalle del servidor cuando lo hay', () => {
      expect(mensajeFallo('frente', 'Tipo de archivo no permitido')).toContain('Detalle: Tipo de archivo no permitido');
      expect(mensajeFallo('frente', '   ')).not.toContain('Detalle');
    });
  });

  it('etiqueta y avance por paso', () => {
    expect(etiquetaPaso('inactivo')).toBe('Tomar con cámara');
    expect(etiquetaPaso('armando')).toContain('150 %');
    expect(porcentajePaso('inactivo')).toBe(0);
    expect(porcentajePaso('frente')).toBeLessThan(porcentajePaso('reverso'));
    expect(porcentajePaso('reverso')).toBeLessThan(porcentajePaso('armando'));
  });
});

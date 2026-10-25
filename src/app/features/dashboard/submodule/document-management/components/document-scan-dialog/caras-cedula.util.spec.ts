import { esCarasCedula, medidasAcotadas, nombreArchivoCara } from './caras-cedula.util';

describe('caras-cedula.util', () => {

  describe('medidasAcotadas', () => {
    it('no toca una imagen que ya cabe', () => {
      expect(medidasAcotadas(1200, 760, 1800)).toEqual({ ancho: 1200, alto: 760 });
    });

    it('reduce por el lado mayor sin deformar (horizontal)', () => {
      const m = medidasAcotadas(2400, 1514, 1800);
      expect(m.ancho).toBe(1800);
      expect(m.alto).toBe(Math.round(1514 * 1800 / 2400));
    });

    it('reduce por el lado mayor sin deformar (vertical)', () => {
      const m = medidasAcotadas(1080, 1920, 1800);
      expect(m.alto).toBe(1800);
      expect(m.ancho).toBe(Math.round(1080 * 1800 / 1920));
    });

    it('nunca agranda ni devuelve cero', () => {
      expect(medidasAcotadas(1, 1, 1800)).toEqual({ ancho: 1, alto: 1 });
      expect(medidasAcotadas(0, 0, 1800)).toEqual({ ancho: 1, alto: 1 });
      expect(medidasAcotadas(5000, 2, 1800)).toEqual({ ancho: 1800, alto: 1 });
    });
  });

  describe('nombreArchivoCara', () => {
    it('quita tildes y símbolos', () => {
      expect(nombreArchivoCara('Cédula de extranjería', 'frente')).toBe('cedula_de_extranjeria_frente.jpg');
    });

    it('sin nombre usa "documento"', () => {
      expect(nombreArchivoCara('', 'reverso')).toBe('documento_reverso.jpg');
      expect(nombreArchivoCara(null, 'reverso')).toBe('documento_reverso.jpg');
      expect(nombreArchivoCara('***', 'frente')).toBe('documento_frente.jpg');
    });

    it('se queda por debajo de los 100 caracteres del backend', () => {
      expect(nombreArchivoCara('x'.repeat(300), 'reverso').length).toBeLessThan(100);
    });
  });

  describe('esCarasCedula', () => {
    const jpg = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'c.jpg', { type: 'image/jpeg' });

    it('acepta las dos caras', () => {
      expect(esCarasCedula({ frente: jpg(), reverso: jpg() })).toBeTrue();
    });

    it('rechaza lo que devuelve el modo PDF, el cierre sin nada y caras vacías', () => {
      expect(esCarasCedula([jpg()])).toBeFalse();
      expect(esCarasCedula(undefined)).toBeFalse();
      expect(esCarasCedula({ frente: jpg() })).toBeFalse();
      expect(esCarasCedula({ frente: jpg(), reverso: new File([], 'v.jpg') })).toBeFalse();
    });
  });
});

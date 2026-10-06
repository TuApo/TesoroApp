import {
  TIPOS_DOCUMENTO_CANONICOS,
  canonizarTipoDocumento,
  empiezaConX,
  etiquetaTipoDocumento,
  pareceNumeroDocumento,
} from './tipo-documento';

describe('tipo de documento canonico', () => {
  it('ofrece los cinco tipos del registro, sin NIT', () => {
    expect(TIPOS_DOCUMENTO_CANONICOS.map((t) => t.valor)).toEqual(['CC', 'CE', 'PPT', 'TI', 'PA']);
  });

  it('reduce las grafias reales de contratacion al canonico (espejo de ms-hr)', () => {
    for (const crudo of ['CC', 'C.C', 'C.C.', 'cc', ' CEDULA ', 'Cédula de ciudadanía']) {
      expect(canonizarTipoDocumento(crudo)).withContext(crudo).toBe('CC');
    }
    for (const crudo of ['PPT', 'P.P.T', 'PET', 'PT', 'PEP', 'P.E.P']) {
      expect(canonizarTipoDocumento(crudo)).withContext(crudo).toBe('PPT');
    }
    expect(canonizarTipoDocumento('C.E')).toBe('CE');
    expect(canonizarTipoDocumento('T.I')).toBe('TI');
    expect(canonizarTipoDocumento('PAS')).toBe('PA');
    expect(canonizarTipoDocumento('Pasaporte')).toBe('PA');
  });

  it('reconoce lo MISMO que ms-hr: nombres largos y separadores raros (revision)', () => {
    // Antes solo se quitaban puntos: "C E", "C-C" o "Cédula de extranjería" quedaban en null
    // mientras el servidor si los reconocia (compara solo letras y digitos).
    expect(canonizarTipoDocumento('Cédula de extranjería')).toBe('CE');
    expect(canonizarTipoDocumento('C E')).toBe('CE');
    expect(canonizarTipoDocumento('C-C')).toBe('CC');
    expect(canonizarTipoDocumento('Tarjeta de identidad')).toBe('TI');
    expect(canonizarTipoDocumento('Permiso por protección temporal')).toBe('PPT');
    expect(canonizarTipoDocumento('Permiso especial de permanencia')).toBe('PPT');
  });

  it('no adivina: lo desconocido o vacio queda en null', () => {
    expect(canonizarTipoDocumento('CONT.')).toBeNull();
    expect(canonizarTipoDocumento('NIT')).toBeNull();
    expect(canonizarTipoDocumento('0')).toBeNull();
    expect(canonizarTipoDocumento('')).toBeNull();
    expect(canonizarTipoDocumento(null)).toBeNull();
  });

  it('da la etiqueta legible de cada tipo', () => {
    expect(etiquetaTipoDocumento('PPT')).toContain('PEP/PET');
    expect(etiquetaTipoDocumento('NIT')).toBe('');
  });

  it('distingue un numero de documento (con o sin X) de un nombre', () => {
    expect(pareceNumeroDocumento('1075263514')).toBeTrue();
    expect(pareceNumeroDocumento('X1234567')).toBeTrue();
    expect(pareceNumeroDocumento('PEREZ')).toBeFalse();
    expect(empiezaConX('x1234567')).toBeTrue();
    expect(empiezaConX('XIMENA')).toBeFalse();
    expect(empiezaConX('1234567')).toBeFalse();
  });
});

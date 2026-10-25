import { anioAuxilio, auxilioTransporteDelAnio, esSi, textoAuxilio } from './auxilio-transporte.util';

describe('auxilio-transporte.util', () => {
  const VIG = [
    { anio: 2025, salario_minimo: '1423500.00', auxilio_transporte: '200000.00' },
    { anio: 2026, salario_minimo: '1750905.00', auxilio_transporte: '249095.00' },
  ];

  it('toma el auxilio del año pedido', () => {
    expect(auxilioTransporteDelAnio(VIG, 2026)).toBe(249095);
    expect(auxilioTransporteDelAnio(VIG, 2025)).toBe(200000);
  });

  it('un año sin fila cae al último anterior configurado', () => {
    expect(auxilioTransporteDelAnio(VIG, 2027)).toBe(249095);
  });

  it('sin nada configurado hasta ese año es null', () => {
    expect(auxilioTransporteDelAnio(VIG, 2019)).toBeNull();
    expect(auxilioTransporteDelAnio([], 2026)).toBeNull();
    expect(auxilioTransporteDelAnio(null, 2026)).toBeNull();
  });

  it('año: fecha de contrato, luego ingreso, luego el actual', () => {
    const hoy = new Date(2026, 9, 14);
    expect(anioAuxilio('2025-12-01', '2026-01-10', hoy)).toBe(2025);
    expect(anioAuxilio(null, '2024-03-01', hoy)).toBe(2024);
    expect(anioAuxilio(new Date(2025, 0, 2), null, hoy)).toBe(2025);
    expect(anioAuxilio(null, null, hoy)).toBe(2026);
  });

  it('texto en pesos o "Sin configurar"', () => {
    expect(textoAuxilio(249095)).toBe('$ 249.095');
    expect(textoAuxilio(null)).toBe('Sin configurar');
  });

  it('SI con o sin tilde', () => {
    expect(esSi('Sí')).toBeTrue();
    expect(esSi('SI')).toBeTrue();
    expect(esSi(true)).toBeTrue();
    expect(esSi('No')).toBeFalse();
    expect(esSi(null)).toBeFalse();
  });
});

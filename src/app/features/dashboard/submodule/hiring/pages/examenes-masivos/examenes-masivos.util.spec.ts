import {
  armarTandas,
  contarConceptos,
  entradaZipEsExamen,
  esPdfPorNombre,
  esZipPorNombre,
  hoyLocal,
  motivoNoSubible,
  nombreBase,
  tamanoLegible,
} from './examenes-masivos.util';

/** Carga masiva de exámenes (pedido #11): ZIP, tandas y qué frena una fila. */
describe('examenes-masivos.util', () => {
  const MB = 1024 * 1024;

  it('reconoce PDF y ZIP por el nombre', () => {
    expect(esPdfPorNombre('1122415324.PDF')).toBeTrue();
    expect(esPdfPorNombre('foto.jpg')).toBeFalse();
    expect(esZipPorNombre('lote-javap.zip')).toBeTrue();
    expect(nombreBase('JAVAP/2026-09/1122415324.pdf')).toBe('1122415324.pdf');
    expect(nombreBase('JAVAP\\1122415324.pdf')).toBe('1122415324.pdf');
  });

  it('del ZIP solo toma los PDF de verdad', () => {
    expect(entradaZipEsExamen('JAVAP/1122415324.pdf')).toBeTrue();
    expect(entradaZipEsExamen('JAVAP/', true)).toBeFalse();
    expect(entradaZipEsExamen('__MACOSX/JAVAP/._1122415324.pdf')).toBeFalse();
    expect(entradaZipEsExamen('JAVAP/._1122415324.pdf')).toBeFalse();
    expect(entradaZipEsExamen('JAVAP/listado.xlsx')).toBeFalse();
  });

  it('arma tandas por cantidad y por peso, en orden', () => {
    const f = (n: number, mb: number) => ({ n, tamano: mb * MB });
    const tandas = armarTandas([f(1, 1), f(2, 1), f(3, 1), f(4, 1), f(5, 1), f(6, 1)], 5, 10 * MB);
    expect(tandas.map((t) => t.map((x) => x.n))).toEqual([[1, 2, 3, 4, 5], [6]]);

    const pesadas = armarTandas([f(1, 6), f(2, 6), f(3, 11), f(4, 1)], 5, 10 * MB);
    expect(pesadas.map((t) => t.map((x) => x.n))).toEqual([[1], [2], [3], [4]]);
    expect(armarTandas([], 5, 10 * MB)).toEqual([]);
  });

  it('dice qué le falta a una fila para subirse', () => {
    const base = {
      estado_cruce: 'OK', estado_carga: 'PENDIENTE', concepto: null,
      restricciones: null, fecha_examen: null,
    } as any;
    const hoy = '2026-09-28';
    expect(motivoNoSubible(base, hoy)).toBe('Falta el concepto');
    expect(motivoNoSubible({ ...base, concepto: 'APTO' }, hoy)).toBeNull();
    expect(motivoNoSubible({ ...base, concepto: 'APTO_CON_RESTRICCIONES' }, hoy)).toBe('Faltan las restricciones');
    expect(motivoNoSubible({ ...base, concepto: 'APTO_CON_RESTRICCIONES', restricciones: 'Sin alturas' }, hoy)).toBeNull();
    expect(motivoNoSubible({ ...base, concepto: 'APTO', fecha_examen: '2026-10-01' }, hoy)).toContain('futura');
    expect(motivoNoSubible({ ...base, concepto: 'APTO', estado_cruce: 'SIN_PROCESO' }, hoy)).toContain('proceso');
    expect(motivoNoSubible({ ...base, concepto: 'APTO', estado_carga: 'SUBIDO' }, hoy)).toBe('Ya se subió');
    expect(motivoNoSubible({ ...base, concepto: 'APTO', excluida: true }, hoy)).toBe('Quitada del lote');
    expect(motivoNoSubible({ ...base, concepto: 'NO_APTO', estado_cruce: 'AVISO' }, hoy)).toBeNull();
  });

  it('cuenta los conceptos para la confirmación', () => {
    const c = contarConceptos([{ concepto: 'APTO' }, { concepto: 'APTO' }, { concepto: 'NO_APTO' }, { concepto: null }]);
    expect(c.APTO).toBe(2);
    expect(c.NO_APTO).toBe(1);
    expect(c.APLAZADO).toBe(0);
  });

  it('formatea tamaños y fechas', () => {
    expect(tamanoLegible(0)).toBe('');
    expect(tamanoLegible(2048)).toBe('2 KB');
    expect(tamanoLegible(2.1 * MB)).toBe('2,1 MB');
    expect(hoyLocal(new Date(2026, 8, 5))).toBe('2026-09-05');
  });
});

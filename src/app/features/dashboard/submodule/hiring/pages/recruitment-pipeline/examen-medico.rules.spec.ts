import {
  CAMPO_IPS,
  CAMPO_LISTA_EXAMENES,
  PRIMERO_CARGA_EXAMEN,
  conceptoHabilitado,
  faltantesParaCargarExamen,
  motivoConceptoBloqueado,
  textoFaltantesCarga,
  FALTA_CONCEPTO,
  FALTA_PDF,
  conceptoPermiteContratar,
  esBloqueoExamen,
  etiquetaConcepto,
  evaluarExamen,
  examenesSinResultado,
  resultadosDesdeTitulo,
  resultadosMarcados,
  tituloConResultados,
  tituloSinResultados,
  normalizarConcepto,
  textoBloqueoExamen,
} from './examen-medico.rules';

/**
 * Examen médico requerido para contratar (pedido #10): qué bloquea la pestaña
 * Contratación y qué se le dice a quien está contratando.
 */
describe('examen-medico.rules', () => {
  const nuevo = (extra: any = {}) => ({
    id: 5,
    created_at: '2026-09-29T15:00:00Z',
    examen_bloqueo: { aplica: true, desde: '2026-09-28', salto: null },
    ...extra,
  });

  it('normaliza los conceptos y sus grafías viejas', () => {
    expect(normalizarConcepto('apto con restricciones')).toBe('APTO_CON_RESTRICCIONES');
    expect(normalizarConcepto('NO APTO')).toBe('NO_APTO');
    expect(normalizarConcepto('aplazado')).toBe('APLAZADO');
    expect(normalizarConcepto('')).toBeNull();
    expect(normalizarConcepto(null)).toBeNull();
    expect(normalizarConcepto('quizás')).toBeNull();
  });

  it('solo APTO y APTO CON RESTRICCIONES permiten contratar', () => {
    expect(conceptoPermiteContratar('APTO')).toBeTrue();
    expect(conceptoPermiteContratar('APTO_CON_RESTRICCIONES')).toBeTrue();
    expect(conceptoPermiteContratar('NO_APTO')).toBeFalse();
    expect(conceptoPermiteContratar('APLAZADO')).toBeFalse();
    expect(conceptoPermiteContratar(null)).toBeFalse();
    expect(etiquetaConcepto(null)).toBe('Sin concepto');
  });

  it('un proceso viejo (antes del corte) no se bloquea', () => {
    const e = evaluarExamen({ examen_bloqueo: { aplica: false } }, []);
    expect(e.bloquea).toBeFalse();
    expect(e.faltantes).toEqual([]);
  });

  it('sin examen_bloqueo (backend viejo) tampoco bloquea', () => {
    expect(evaluarExamen({ id: 1 }, []).bloquea).toBeFalse();
  });

  it('un proceso nuevo sin PDF ni concepto bloquea y dice las dos cosas', () => {
    const e = evaluarExamen(nuevo(), []);
    expect(e.bloquea).toBeTrue();
    expect(e.faltantes).toEqual([FALTA_PDF, FALTA_CONCEPTO]);
    expect(textoBloqueoExamen(e)).toContain(FALTA_PDF);
  });

  it('un PDF de antes de abrir el proceso no cuenta', () => {
    const viejo = [{ uploaded_at: '2026-03-01T10:00:00Z' }];
    expect(evaluarExamen(nuevo(), viejo, 'APTO').pdfCargado).toBeFalse();
    const deHoy = [{ uploaded_at: '2026-09-30T10:00:00Z' }];
    expect(evaluarExamen(nuevo(), deHoy, 'APTO').bloquea).toBeFalse();
  });

  it('el PDF enlazado en el examen cuenta aunque no esté en la lista', () => {
    const e = evaluarExamen(nuevo({ examen_medico: { documento_id: 99, concepto: 'APTO_CON_RESTRICCIONES' } }), []);
    expect(e.pdfCargado).toBeTrue();
    expect(e.bloquea).toBeFalse();
  });

  it('APLAZADO y NO APTO bloquean aunque haya PDF', () => {
    const conPdf = nuevo({ examen_medico: { documento_id: 99 } });
    expect(evaluarExamen(conPdf, [], 'APLAZADO').faltantes[0]).toContain('APLAZADO');
    expect(evaluarExamen(conPdf, [], 'NO_APTO').bloquea).toBeTrue();
  });

  it('lo elegido en pantalla manda sobre lo guardado', () => {
    const guardadoNoApto = nuevo({ examen_medico: { documento_id: 99, concepto: 'NO_APTO' } });
    expect(evaluarExamen(guardadoNoApto, [], 'APTO').bloquea).toBeFalse();
    expect(evaluarExamen(guardadoNoApto, []).bloquea).toBeTrue();
  });

  it('un salto de ADMIN abre la pestaña pero sigue diciendo qué faltaba', () => {
    const e = evaluarExamen(nuevo({ examen_bloqueo: { aplica: true, salto: { por: 'admin@x.co', motivo: 'IPS caída' } } }), []);
    expect(e.bloquea).toBeFalse();
    expect(e.faltantes.length).toBe(2);
    expect(e.salto?.por).toBe('admin@x.co');
  });

  it('reconoce el 409 del backend', () => {
    expect(esBloqueoExamen({ status: 409, error: { codigo: 'EXAMEN_MEDICO_REQUERIDO' } })).toBeTrue();
    expect(esBloqueoExamen({ status: 409, error: { codigo: 'TARJETA_NO_ASIGNABLE' } })).toBeFalse();
  });
});

/**
 * Orden estricto de Salud ocupacional: IPS + lista → cargar el PDF → concepto.
 * La carga del PDF es independiente del concepto.
 */
describe('examen-medico.rules · orden de carga', () => {
  it('IPS principal y Lista de exámenes son obligatorios para cargar el examen', () => {
    expect(faltantesParaCargarExamen('', [])).toEqual([CAMPO_IPS, CAMPO_LISTA_EXAMENES]);
    expect(faltantesParaCargarExamen('  ', ['Audiometría'])).toEqual([CAMPO_IPS]);
    expect(faltantesParaCargarExamen('IPS X', null)).toEqual([CAMPO_LISTA_EXAMENES]);
    expect(faltantesParaCargarExamen('IPS X', ['', null])).toEqual([CAMPO_LISTA_EXAMENES]);
    expect(faltantesParaCargarExamen('IPS X', ['Audiometría'])).toEqual([]);
  });

  it('dice qué falta en una sola frase', () => {
    expect(textoFaltantesCarga([])).toBe('');
    expect(textoFaltantesCarga([CAMPO_IPS])).toBe('Para cargar el examen falta: IPS principal.');
    expect(textoFaltantesCarga([CAMPO_IPS, CAMPO_LISTA_EXAMENES]))
      .toBe('Para cargar el examen falta: IPS principal y Lista de exámenes.');
  });

  it('el concepto solo se habilita con los obligatorios llenos Y el PDF cargado', () => {
    expect(conceptoHabilitado([], true)).toBeTrue();
    expect(conceptoHabilitado([], false)).toBeFalse();
    expect(conceptoHabilitado([CAMPO_IPS], true)).toBeFalse();
    expect(conceptoHabilitado([CAMPO_IPS, CAMPO_LISTA_EXAMENES], false)).toBeFalse();
  });

  it('explica por qué el concepto está cerrado: "Primero carga el examen"', () => {
    expect(motivoConceptoBloqueado([], true)).toBeNull();
    expect(motivoConceptoBloqueado([], false)).toContain(PRIMERO_CARGA_EXAMEN);
    const m = motivoConceptoBloqueado([CAMPO_IPS, CAMPO_LISTA_EXAMENES], false)!;
    expect(m).toContain(PRIMERO_CARGA_EXAMEN);
    expect(m).toContain('IPS principal y Lista de exámenes');
  });
});

describe('examenesSinResultado (APTO / NO APTO obligatorio antes de cargar)', () => {
  it('lista los exámenes sin APTO ni NO APTO', () => {
    expect(examenesSinResultado(['Audiometría', 'Optometría', 'Ingreso'],
      [{ aptoStatus: 'APTO' }, { aptoStatus: null }, {}])).toEqual(['Optometría', 'Ingreso']);
  });
  it('con todos marcados no falta nada', () => {
    expect(examenesSinResultado(['A', 'B'], [{ aptoStatus: 'APTO' }, { aptoStatus: 'NO APTO' }])).toEqual([]);
  });
  it('sin lista no falta nada (eso lo exige la lista de exámenes)', () => {
    expect(examenesSinResultado([], [])).toEqual([]);
    expect(examenesSinResultado(null, null)).toEqual([]);
  });
});

describe('resultado por examen en el título del soporte', () => {
  const res = [{ examen: 'Audiometría', resultado: 'APTO' as const }, { examen: 'Optometría', resultado: 'NO APTO' as const }];

  it('va antes de la extensión y se puede leer de vuelta', () => {
    const t = tituloConResultados('EXAMENES_MEDICOS_1_20261015.pdf', res);
    expect(t).toBe('EXAMENES_MEDICOS_1_20261015 [Audiometría=APTO; Optometría=NO APTO].pdf');
    expect(resultadosDesdeTitulo(t)).toEqual(res);
    expect(tituloSinResultados(t)).toBe('EXAMENES_MEDICOS_1_20261015.pdf');
  });

  it('sin resultados el título no cambia; un título viejo no trae resultados', () => {
    expect(tituloConResultados('X.pdf', [])).toBe('X.pdf');
    expect(resultadosDesdeTitulo('EXAMENES_MEDICOS_1_20260901.pdf')).toEqual([]);
    expect(tituloSinResultados('EXAMENES_MEDICOS_1_20260901.pdf')).toBe('EXAMENES_MEDICOS_1_20260901.pdf');
  });

  it('no pasa de 250 caracteres y nunca deja un examen a medias', () => {
    const muchos = Array.from({ length: 40 }, (_, i) => ({ examen: `Examen largo numero ${i}`, resultado: 'APTO' as const }));
    const t = tituloConResultados('EXAMENES_MEDICOS_1_20261015.pdf', muchos);
    expect(t.length).toBeLessThanOrEqual(250);
    expect(resultadosDesdeTitulo(t).every((r) => r.resultado === 'APTO')).toBeTrue();
  });

  it('caracteres reservados del nombre no rompen la lectura', () => {
    const t = tituloConResultados('X.pdf', [{ examen: 'Lab [a=b]; c', resultado: 'NO APTO' }]);
    expect(resultadosDesdeTitulo(t)).toEqual([{ examen: 'Lab a b c', resultado: 'NO APTO' }]);
  });

  it('resultadosMarcados ignora los exámenes sin marcar', () => {
    expect(resultadosMarcados(['A', 'B'], [{ aptoStatus: 'NO APTO' }, {}]))
      .toEqual([{ examen: 'A', resultado: 'NO APTO' }]);
  });
});

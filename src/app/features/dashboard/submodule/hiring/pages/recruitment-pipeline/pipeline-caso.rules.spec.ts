import {
  CatalogoPasos,
  leerEstadoPipeline,
  mismaPersona,
  normalizarDocumento,
  pasoAAbrir,
  resumenDePaso,
} from './pipeline-caso.rules';

const CAPAS = [
  { id: 'seleccion' as const, label: 'Selección' },
  { id: 'contratacion' as const, label: 'Contratación' },
  { id: 'documentos' as const, label: 'Documentos' },
  { id: 'ia' as const, label: 'Inteligencia artificial' },
  { id: 'accesos' as const, label: 'Accesos rápidos' },
];

/** El catálogo ANTES del veredicto: sin Remisión ni Exámenes. */
const SIN_VEREDICTO: CatalogoPasos = {
  seleccion: [
    { id: 'antecedentes', label: 'Antecedentes' },
    { id: 'formacion', label: 'Formación y laboral' },
    { id: 'entrevista', label: 'Entrevista' },
  ],
  ia: [{ id: 'ia', label: 'Resumen del perfil' }, { id: 'iaChat', label: 'Chat' }],
  contratacion: [{ id: 'pago', label: 'Pago y Transporte' }, { id: 'obra', label: 'Datos de obra' }, { id: 'huella', label: 'Cédula & Huella' }],
  documentos: [{ id: 'docsTodos', label: 'Todos los documentos' }, { id: 'docEmpalme', label: 'Organización de empalme' }],
};

const CON_VEREDICTO: CatalogoPasos = {
  ...SIN_VEREDICTO,
  seleccion: [...SIN_VEREDICTO.seleccion, { id: 'remision', label: 'Remisión' }, { id: 'examenes', label: 'Exámenes de ingreso' }],
};

describe('pipeline-caso.rules', () => {
  it('normaliza el documento como lo busca la pantalla (sin puntos, X mayúscula)', () => {
    expect(normalizarDocumento('1.122.415.324')).toBe('1122415324');
    expect(normalizarDocumento(' x9999001 ')).toBe('X9999001');
    expect(normalizarDocumento(1122415324)).toBe('1122415324');
    expect(normalizarDocumento('IVAN')).toBe('');
    expect(normalizarDocumento(null)).toBe('');
  });

  it('la misma persona se reconoce con o sin puntos; nadie coincide con vacío', () => {
    expect(mismaPersona('1.122.415.324', '1122415324')).toBeTrue();
    expect(mismaPersona('1122415324', '1122415325')).toBeFalse();
    expect(mismaPersona(null, '1122415324')).toBeFalse();
    expect(mismaPersona('', '')).toBeFalse();
  });

  it('lee un estado guardado y rechaza lo que no tiene persona', () => {
    const e = leerEstadoPipeline({ v: 1, documento: '1.122.415.324', capa: 'contratacion', paso: 'pago', scroll: [{ sel: '.x', n: 0, top: 120 }, { malo: true }] });
    expect(e).not.toBeNull();
    expect(e!.documento).toBe('1122415324');
    expect(e!.capa).toBe('contratacion');
    expect(e!.paso).toBe('pago');
    expect(e!.scroll).toEqual([{ sel: '.x', n: 0, top: 120 }]);
    expect(leerEstadoPipeline({ capa: 'seleccion' })).toBeNull();
    expect(leerEstadoPipeline('nada')).toBeNull();
    // Una capa desconocida cae en Selección: siempre hay algo que abrir.
    expect(leerEstadoPipeline({ documento: '123456', capa: 'otra' })!.capa).toBe('seleccion');
  });

  it('vuelve al paso guardado cuando sigue a la vista', () => {
    expect(pasoAAbrir({ v: 1, documento: '1', capa: 'seleccion', paso: 'entrevista' }, SIN_VEREDICTO))
      .toEqual({ tipo: 'seleccion', id: 'entrevista' });
    expect(pasoAAbrir({ v: 1, documento: '1', capa: 'ia', paso: 'iaChat' }, SIN_VEREDICTO))
      .toEqual({ tipo: 'seleccion', id: 'iaChat' });
    expect(pasoAAbrir({ v: 1, documento: '1', capa: 'contratacion', paso: 'obra' }, SIN_VEREDICTO))
      .toEqual({ tipo: 'contratacion', id: 'obra' });
    expect(pasoAAbrir({ v: 1, documento: '1', capa: 'documentos', paso: 'docEmpalme' }, SIN_VEREDICTO))
      .toEqual({ tipo: 'contratacion', id: 'docEmpalme' });
  });

  it('si el paso ya no está a la vista abre la capa, nunca una pestaña vacía', () => {
    // Se guardó en Remisión y luego el veredicto cambió: Remisión desapareció.
    expect(pasoAAbrir({ v: 1, documento: '1', capa: 'seleccion', paso: 'remision' }, SIN_VEREDICTO))
      .toEqual({ tipo: 'capa', id: 'seleccion' });
    expect(pasoAAbrir({ v: 1, documento: '1', capa: 'seleccion', paso: 'remision' }, CON_VEREDICTO))
      .toEqual({ tipo: 'seleccion', id: 'remision' });
    expect(pasoAAbrir({ v: 1, documento: '1', capa: 'contratacion', paso: null }, SIN_VEREDICTO))
      .toEqual({ tipo: 'capa', id: 'contratacion' });
    expect(pasoAAbrir({ v: 1, documento: '1', capa: 'accesos' }, SIN_VEREDICTO))
      .toEqual({ tipo: 'capa', id: 'accesos' });
  });

  it('resume el paso para la pestaña del caso', () => {
    expect(resumenDePaso({ capa: 'seleccion', paso: 'entrevista' }, SIN_VEREDICTO, CAPAS)).toBe('Selección · Entrevista');
    expect(resumenDePaso({ capa: 'documentos', paso: 'docsTodos' }, SIN_VEREDICTO, CAPAS)).toBe('Documentos · Todos los documentos');
    expect(resumenDePaso({ capa: 'accesos', paso: null }, SIN_VEREDICTO, CAPAS)).toBe('Accesos rápidos');
    expect(resumenDePaso({ capa: 'seleccion', paso: 'remision' }, SIN_VEREDICTO, CAPAS)).toBe('Selección');
  });
});

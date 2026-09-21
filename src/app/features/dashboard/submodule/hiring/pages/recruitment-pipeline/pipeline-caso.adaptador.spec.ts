import { AdaptadorPipelineCaso, PipelineParaCaso, RUTA_PIPELINE } from './pipeline-caso.adaptador';
import { AccionPaso, CapaCaso, CatalogoPasos } from './pipeline-caso.rules';

const CATALOGO: CatalogoPasos = {
  seleccion: [{ id: 'antecedentes', label: 'Antecedentes' }, { id: 'formacion', label: 'Formación y laboral' }, { id: 'entrevista', label: 'Entrevista' }],
  ia: [{ id: 'ia', label: 'Resumen del perfil' }, { id: 'iaChat', label: 'Chat' }],
  contratacion: [{ id: 'pago', label: 'Pago y Transporte' }, { id: 'obra', label: 'Datos de obra' }, { id: 'huella', label: 'Cédula & Huella' }],
  documentos: [{ id: 'docsTodos', label: 'Todos los documentos' }, { id: 'docEmpalme', label: 'Organización de empalme' }],
};

/** Una pantalla de mentira: la búsqueda "responde" cuando el test lo dice. */
class PantallaFalsa implements PipelineParaCaso {
  documento: string | null = null;
  nombre: string | null = null;
  capa: CapaCaso = 'seleccion';
  paso: string | null = 'entrevista';
  lista = true;
  enBusqueda: string | null = null;
  abiertos: AccionPaso[] = [];
  busquedas: { documento: string; tipoDoc?: string | null }[] = [];
  /** Personas que "existen": al buscarlas, aparecen. */
  existen = new Set<string>();

  documentoEnPantalla() { return this.documento; }
  tipoDocEnPantalla() { return this.documento ? 'CC' : null; }
  nombreEnPantalla() { return this.nombre; }
  capaAbierta() { return this.capa; }
  pasoAbierto() { return this.paso; }
  catalogo() { return CATALOGO; }
  capas() {
    return [
      { id: 'seleccion' as const, label: 'Selección' }, { id: 'contratacion' as const, label: 'Contratación' },
      { id: 'documentos' as const, label: 'Documentos' }, { id: 'ia' as const, label: 'Inteligencia artificial' },
      { id: 'accesos' as const, label: 'Accesos rápidos' },
    ];
  }
  vistaLista() { return this.lista; }
  buscando() { return this.enBusqueda !== null; }
  documentoBuscado() { return this.enBusqueda; }
  buscarPorDocumento(documento: string, tipoDoc?: string | null) {
    this.busquedas.push({ documento, tipoDoc });
    this.enBusqueda = documento;
    // Responde en el siguiente tic, como el servidor.
    setTimeout(() => {
      this.documento = this.existen.has(documento) ? documento : null;
      this.enBusqueda = null;
    }, 5);
  }
  abrirPaso(a: AccionPaso) { this.abiertos.push(a); }
  raiz() { return null; }
}

describe('AdaptadorPipelineCaso', () => {
  let pantalla: PantallaFalsa;
  let adaptador: AdaptadorPipelineCaso;

  beforeEach(() => {
    pantalla = new PantallaFalsa();
    adaptador = new AdaptadorPipelineCaso(pantalla);
  });

  it('sin persona no hay nada que guardar, y la ruta es la del pipeline a secas', () => {
    expect(adaptador.capturar()).toBeNull();
    expect(adaptador.ruta()).toBe(RUTA_PIPELINE);
    expect(adaptador.persona().documento).toBeNull();
  });

  it('con persona guarda documento, paso y pone la cédula en la ruta', () => {
    pantalla.documento = '1.122.415.324';
    pantalla.nombre = 'IVAN BERMUDEZ';
    pantalla.capa = 'contratacion';
    pantalla.paso = 'pago';
    const e = adaptador.capturar()!;
    expect(e.documento).toBe('1122415324');
    expect(e.capa).toBe('contratacion');
    expect(e.paso).toBe('pago');
    expect(adaptador.ruta()).toBe(`${RUTA_PIPELINE}?cedula=1122415324`);
    expect(adaptador.persona()).toEqual({ documento: '1122415324', persona_nombre: 'IVAN BERMUDEZ', motivo: 'Contratación · Pago y Transporte' });
    expect(adaptador.resumen()).toBe('Contratación · Pago y Transporte');
  });

  it('al volver busca a la persona por el buscador y luego abre el paso', async () => {
    pantalla.existen.add('1122415324');
    const avances: number[] = [];
    await adaptador.restaurar({ v: 1, documento: '1122415324', tipo_doc: 'CC', capa: 'seleccion', paso: 'entrevista' }, p => avances.push(p));
    expect(pantalla.busquedas).toEqual([{ documento: '1122415324', tipoDoc: 'CC' }]);
    expect(pantalla.abiertos).toEqual([{ tipo: 'seleccion', id: 'entrevista' }]);
    expect(avances[avances.length - 1]).toBe(1);
  });

  it('si la persona ya está en pantalla no la vuelve a buscar', async () => {
    pantalla.documento = '1122415324';
    await adaptador.restaurar({ v: 1, documento: '1.122.415.324', capa: 'documentos', paso: 'docsTodos' }, () => {});
    expect(pantalla.busquedas).toEqual([]);
    expect(pantalla.abiertos).toEqual([{ tipo: 'contratacion', id: 'docsTodos' }]);
  });

  it('si la pantalla ya la está buscando (cédula en la URL) solo espera', async () => {
    pantalla.enBusqueda = '1122415324';
    pantalla.existen.add('1122415324');
    setTimeout(() => { pantalla.documento = '1122415324'; pantalla.enBusqueda = null; }, 20);
    await adaptador.restaurar({ v: 1, documento: '1122415324', capa: 'seleccion', paso: 'formacion' }, () => {});
    expect(pantalla.busquedas).toEqual([]);
    expect(pantalla.abiertos).toEqual([{ tipo: 'seleccion', id: 'formacion' }]);
  });

  it('cambiar de caso cambia de persona: busca a la nueva aunque haya otra en pantalla', async () => {
    pantalla.documento = '1122415324';
    pantalla.existen.add('79000000');
    await adaptador.restaurar({ v: 1, documento: '79000000', capa: 'seleccion', paso: 'antecedentes' }, () => {});
    expect(pantalla.busquedas.map(b => b.documento)).toEqual(['79000000']);
    expect(pantalla.documento).toBe('79000000');
    expect(pantalla.abiertos).toEqual([{ tipo: 'seleccion', id: 'antecedentes' }]);
  });

  it('si no se encuentra a la persona no abre ningún paso', async () => {
    await adaptador.restaurar({ v: 1, documento: '55555555', capa: 'contratacion', paso: 'pago' }, () => {});
    expect(pantalla.busquedas.length).toBe(1);
    expect(pantalla.abiertos).toEqual([]);
  });

  it('ignora un estado que no es del pipeline', async () => {
    await adaptador.restaurar({ nada: true } as unknown as never, () => {});
    expect(pantalla.busquedas).toEqual([]);
    expect(pantalla.abiertos).toEqual([]);
  });
});

import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import Swal from 'sweetalert2';


import { environment } from '@/environments/environment';

import {
  CatalogosIncapacidad,
  IncapacidadResumen,
  Page,
} from '../../models/incapacidad-v2.model';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import { ConsultaIncapacidadesComponent, FilaTabla } from './consulta-incapacidades.component';
import {
  FiltrosConsultaIncapacidad,
  IncapacidadResumenExtendido,
} from './consulta-incapacidades.model';
import { DialogoExportarIncapacidadesComponent } from './dialogos/dialogo-exportar-incapacidades/dialogo-exportar-incapacidades.component';
import { DialogoExportMasivoComponent } from './dialogos/dialogo-export-masivo/dialogo-export-masivo.component';
import {
  CLAVES_EXPORTACION_POR_DEFECTO,
  COLUMNAS_EXPORTABLES,
  cabecerasExportacion,
  clavesAColumnas,
  construirCsv,
  construirFilasExportacion,
  indicadorSoportes,
  nombreArchivoExportacion,
  soportesCompletos,
} from './exportacion-incapacidades';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

/**
 * `Swal.fire` tiene 6 sobrecargas y jasmine no sabe espiarlas: se expone con
 * una firma simple para poder consultar los argumentos en las aserciones.
 */
function swalEspiable(): { fire: (...args: unknown[]) => Promise<unknown> } {
  return Swal as unknown as { fire: (...args: unknown[]) => Promise<unknown> };
}

const CATALOGOS: CatalogosIncapacidad = {
  tiposIncapacidad: [
    { codigo: 'ENFERMEDAD_GENERAL', etiqueta: 'Enfermedad general' },
    { codigo: 'ACCIDENTE_TRABAJO', etiqueta: 'Accidente de trabajo' },
  ],
  estados: [
    { codigo: 'RECIBIDA', etiqueta: 'Recibida' },
    { codigo: 'VALIDADA', etiqueta: 'Validada' },
  ],
  estadosDocumento: [
    { codigo: 'OK', etiqueta: 'Documentacion OK' },
    { codigo: 'PRESCRITA', etiqueta: 'Prescrita', automatico: true },
    { codigo: 'NO_CUMPLE', etiqueta: 'No cumple cotizacion', automatico: true },
  ],
  responsablesPago: [
    { codigo: 'EPS', etiqueta: 'EPS' },
    { codigo: 'EMPLEADOR', etiqueta: 'Empleador' },
  ],
  tiposSoporte: [{ codigo: 'INCAPACIDAD_MEDICA', etiqueta: 'Incapacidad medica' }],
};

const FILA_A: IncapacidadResumenExtendido = {
  id: 11,
  consecutivoSistema: 'INC-2026-0011',
  cedula: '1005851505',
  nombreCompleto: 'ANA PEREZ',
  tipoIncapacidad: 'ENFERMEDAD_GENERAL',
  fechaInicio: '2026-01-31',
  fechaFin: '2026-02-04',
  dias: 5,
  estado: 'RECIBIDA',
  estadoDocumento: 'OK',
  responsablePago: 'EPS',
  eps: 'NUEVA EPS',
  empresa: 'TU ALIANZA SAS',
  centroCosto: 'CC-100',
  oficina: 'SOACHA',
  creadoEn: '2026-02-05T10:15:00',
  creadoPor: 'daniel.torres',
  diasEmpresa: 2,
  diasEntidad: 3,
  soportesAdjuntos: 1,
  soportesExigidos: 2,
  afp: 'PORVENIR',
  temporal: 'Tu Alianza',
};

const FILA_B: IncapacidadResumenExtendido = {
  id: 12,
  consecutivoSistema: 'INC-2026-0012',
  cedula: '52123456',
  nombreCompleto: 'LUIS GOMEZ',
  tipoIncapacidad: 'ACCIDENTE_TRABAJO',
  fechaInicio: '2026-02-10',
  fechaFin: '2026-02-12',
  dias: 3,
  estado: 'VALIDADA',
  estadoDocumento: 'PRESCRITA',
  responsablePago: 'EMPLEADOR',
  eps: 'SURA',
  empresa: 'APOYO LABORAL SAS',
  centroCosto: 'CC-200',
  oficina: 'BOGOTA',
  creadoEn: '2026-02-13T08:00:00',
  creadoPor: 'maria.lopez',
  diasEmpresa: 3,
  diasEntidad: 0,
  soportesAdjuntos: 2,
  soportesExigidos: 2,
  afp: 'COLFONDOS',
  temporal: 'Apoyo Laboral',
};

function pagina(
  contenido: IncapacidadResumenExtendido[],
  total = contenido.length,
  numero = 0,
  size = 20,
): Page<IncapacidadResumen> {
  return {
    content: contenido,
    number: numero,
    size,
    totalElements: total,
    totalPages: Math.max(1, Math.ceil(total / size)),
  };
}

describe('ConsultaIncapacidadesComponent', () => {
  let fixture: ComponentFixture<ConsultaIncapacidadesComponent>;
  let componente: ConsultaIncapacidadesComponent;
  let httpMock: HttpTestingController;
  let dialogoFalso: { open: jasmine.Spy };

  /**
   * `HttpTestingController.match()` SACA las peticiones de la lista de
   * pendientes, asi que se van acumulando en esta cola propia. Los objetos
   * `TestRequest` siguen siendo respondibles despues de haber sido "matcheados".
   */
  let cola: TestRequest[] = [];

  const capturar = (): void => {
    cola = cola.concat(httpMock.match((r) => r.url === BASE || r.url === `${BASE}/resumen`));
  };

  /** KPI = la llamada unica a /resumen (V44) o, en el camino de respaldo, los size=1. */
  const esKpi = (r: TestRequest): boolean =>
    r.request.url.endsWith('/resumen') || r.request.params.get('size') === '1';

  /** La peticion del listado principal (la unica que NO pide `size=1`). */
  const peticionPrincipal = (): TestRequest => {
    capturar();
    const indice = cola.findIndex((r) => !esKpi(r));
    if (indice < 0) throw new Error('No hay peticion de listado principal pendiente');
    const [encontrada] = cola.splice(indice, 1);
    return encontrada;
  };

  /** Saca de la cola las peticiones de KPI (`size=1`). */
  const peticionesKpi = (): TestRequest[] => {
    capturar();
    const kpis = cola.filter(esKpi);
    cola = cola.filter((r) => !esKpi(r));
    return kpis;
  };

  /** Responde los KPI: la llamada unica a /resumen o las 6 size=1 del respaldo. */
  const responderKpis = (totales: Partial<Record<string, number>> = {}): void => {
    for (const peticion of peticionesKpi()) {
      if (peticion.request.url.endsWith('/resumen')) {
        peticion.flush({
          total: totales['total'] ?? 0,
          porEstado: {
            RECIBIDA: totales['recibidas'] ?? 0,
            VALIDADA: totales['validadas'] ?? 0,
          },
          porEstadoDocumento: {
            PRESCRITA: totales['prescritas'] ?? 0,
            NO_CUMPLE: totales['noCumplen'] ?? 0,
          },
          sinSoportes: totales['soportesIncompletos'] ?? 0,
        });
        continue;
      }
      const p = peticion.request.params;
      let clave = 'total';
      if (p.get('estado') === 'RECIBIDA') clave = 'recibidas';
      else if (p.get('estado') === 'VALIDADA') clave = 'validadas';
      else if (p.get('estadoDocumento') === 'PRESCRITA') clave = 'prescritas';
      else if (p.get('estadoDocumento') === 'NO_CUMPLE') clave = 'noCumplen';
      else if (p.get('soportesCompletos') === 'false') clave = 'soportesIncompletos';
      peticion.flush(pagina([], totales[clave] ?? 0, 0, 1));
    }
  };

  /** Cuantas peticiones de listado quedan sin atender. */
  const pendientesDeListado = (): number => {
    capturar();
    return cola.length;
  };

  beforeEach(async () => {
    cola = [];
    dialogoFalso = {
      open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(undefined) }),
    };

    await TestBed.configureTestingModule({
      imports: [ConsultaIncapacidadesComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MatDialog, useValue: dialogoFalso },
      ],
    }).compileComponents();

    // El servicio cachea los catalogos en un signal de ambito root: como cada
    // prueba levanta un TestBed nuevo, la cache no se arrastra entre pruebas.
    fixture = TestBed.createComponent(ConsultaIncapacidadesComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    httpMock.expectOne(`${BASE}/catalogos`).flush(CATALOGOS);
    // Matriz de EPS (V43): vacia en estas pruebas para que los desplegables
    // sigan derivandose SOLO de las facetas observadas (lo que se afirma abajo).
    httpMock.expectOne(`${BASE}/eps-matriz`).flush([]);
  });

  afterEach(() => {
    fixture.destroy();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Los filtros arman bien los parametros de la peticion
  // ═══════════════════════════════════════════════════════════════════

  describe('filtros -> parametros de la peticion', () => {
    it('la consulta inicial pide la pagina 0 y no manda claves vacias', () => {
      const req = peticionPrincipal();

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('page')).toBe('0');
      expect(req.request.params.get('size')).toBe('20');
      expect(req.request.params.has('empresa')).toBeFalse();
      expect(req.request.params.has('q')).toBeFalse();
      expect(req.request.params.has('soportesCompletos')).toBeFalse();

      req.flush(pagina([FILA_A, FILA_B], 2));
      responderKpis();
    });

    it('manda al servidor cada filtro de texto y de catalogo', () => {
      peticionPrincipal().flush(pagina([FILA_A], 1));
      responderKpis();

      componente.formulario.patchValue({
        q: '  1005851505  ',
        empresa: 'TU ALIANZA SAS',
        centroCosto: 'CC-100',
        temporal: 'Tu Alianza',
        eps: 'NUEVA EPS',
        afp: 'PORVENIR',
        oficina: 'SOACHA',
        tipoIncapacidad: 'ENFERMEDAD_GENERAL',
        estado: 'RECIBIDA',
        estadoDocumento: 'OK',
        responsablePago: 'EPS',
        registradoPor: 'daniel.torres',
      });
      componente.aplicarFiltros();

      const params = peticionPrincipal().request.params;
      expect(params.get('q')).toBe('1005851505');
      expect(params.get('empresa')).toBe('TU ALIANZA SAS');
      expect(params.get('centroCosto')).toBe('CC-100');
      expect(params.get('temporal')).toBe('Tu Alianza');
      expect(params.get('eps')).toBe('NUEVA EPS');
      expect(params.get('afp')).toBe('PORVENIR');
      expect(params.get('oficina')).toBe('SOACHA');
      expect(params.get('tipoIncapacidad')).toBe('ENFERMEDAD_GENERAL');
      expect(params.get('estado')).toBe('RECIBIDA');
      expect(params.get('estadoDocumento')).toBe('OK');
      expect(params.get('responsablePago')).toBe('EPS');
      expect(params.get('registradoPor')).toBe('daniel.torres');
    });

    it('manda los dos rangos de fecha en formato yyyy-MM-dd', () => {
      peticionPrincipal().flush(pagina([], 0));
      responderKpis();

      componente.formulario.patchValue({
        rangoInicio: { start: new Date(2026, 0, 31), end: new Date(2026, 1, 28) },
        rangoRegistro: { start: new Date(2026, 2, 1), end: new Date(2026, 2, 15) },
      });
      componente.aplicarFiltros();

      const params = peticionPrincipal().request.params;
      // Si se usara toISOString(), en zonas UTC- se restaria un dia.
      expect(params.get('desde')).toBe('2026-01-31');
      expect(params.get('hasta')).toBe('2026-02-28');
      expect(params.get('registradoDesde')).toBe('2026-03-01');
      expect(params.get('registradoHasta')).toBe('2026-03-15');
    });

    it('manda soportesCompletos solo cuando no es "cualquiera"', () => {
      peticionPrincipal().flush(pagina([], 0));
      responderKpis();

      componente.formulario.patchValue({ soportesCompletos: 'false' });
      componente.aplicarFiltros();
      expect(peticionPrincipal().request.params.get('soportesCompletos')).toBe('false');

      componente.formulario.patchValue({ soportesCompletos: '' });
      componente.aplicarFiltros();
      expect(peticionPrincipal().request.params.has('soportesCompletos')).toBeFalse();
    });

    it('al cambiar de pagina conserva los filtros y pide la pagina pedida', () => {
      peticionPrincipal().flush(pagina([FILA_A], 60));
      responderKpis();

      componente.formulario.patchValue({ empresa: 'APOYO LABORAL SAS' });
      componente.aplicarFiltros();
      peticionPrincipal().flush(pagina([FILA_B], 60));

      componente.alCambiarPagina({ pageIndex: 2, pageSize: 20, length: 60 });

      const params = peticionPrincipal().request.params;
      expect(params.get('page')).toBe('2');
      expect(params.get('empresa')).toBe('APOYO LABORAL SAS');
    });

    it('al aplicar un filtro nuevo vuelve a la pagina 0', () => {
      peticionPrincipal().flush(pagina([FILA_A], 60));
      responderKpis();

      componente.alCambiarPagina({ pageIndex: 2, pageSize: 20, length: 60 });
      peticionPrincipal().flush(pagina([FILA_A], 60, 2));
      expect(componente.pagina()).toBe(2);

      componente.formulario.patchValue({ eps: 'SURA' });
      componente.aplicarFiltros();

      expect(componente.pagina()).toBe(0);
      expect(peticionPrincipal().request.params.get('page')).toBe('0');
    });

    it('no repite la peticion si los filtros no cambiaron', () => {
      peticionPrincipal().flush(pagina([FILA_A], 1));
      responderKpis();

      componente.aplicarFiltros();
      expect(pendientesDeListado()).toBe(0);
    });

    it('quitar un chip limpia su control y vuelve a consultar', () => {
      peticionPrincipal().flush(pagina([FILA_A], 1));
      responderKpis();

      componente.formulario.patchValue({ empresa: 'TU ALIANZA SAS' });
      componente.aplicarFiltros();
      peticionPrincipal().flush(pagina([FILA_A], 1));
      responderKpis();

      const chip = componente.chips().find((c) => c.claves[0] === 'empresa');
      expect(chip).toBeDefined();

      componente.quitarChip(chip!);
      componente.aplicarFiltros();

      expect(componente.formulario.controls.empresa.value).toBe('');
      expect(peticionPrincipal().request.params.has('empresa')).toBeFalse();
    });

    it('limpiar todo deja la consulta sin ningun filtro', () => {
      peticionPrincipal().flush(pagina([FILA_A], 1));
      responderKpis();

      componente.formulario.patchValue({
        empresa: 'TU ALIANZA SAS',
        estado: 'RECIBIDA',
        rangoInicio: { start: new Date(2026, 0, 1), end: null },
      });
      componente.aplicarFiltros();
      peticionPrincipal().flush(pagina([FILA_A], 1));
      responderKpis();
      expect(componente.chips().length).toBe(3);

      componente.limpiarTodo();
      componente.aplicarFiltros();

      const params = peticionPrincipal().request.params;
      expect(params.has('empresa')).toBeFalse();
      expect(params.has('estado')).toBeFalse();
      expect(params.has('desde')).toBeFalse();
      expect(componente.chips().length).toBe(0);
    });

    it('ordenar por una columna manda el parametro sort al servidor', () => {
      peticionPrincipal().flush(pagina([FILA_A], 1));
      responderKpis();

      componente.orden.set({ campo: 'fechaInicio', direccion: 'desc' });
      componente.recargar();

      expect(peticionPrincipal().request.params.get('sort')).toBe('fechaInicio,desc');
      responderKpis();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Los KPI se pintan (y salen del backend, no de la pagina cargada)
  // ═══════════════════════════════════════════════════════════════════

  describe('KPI', () => {
    it('pide los conteos con UNA llamada a /resumen arrastrando los filtros activos', () => {
      peticionPrincipal().flush(pagina([FILA_A], 1));
      responderKpis();

      componente.formulario.patchValue({ empresa: 'TU ALIANZA SAS' });
      componente.aplicarFiltros();
      peticionPrincipal().flush(pagina([FILA_A], 1));

      const kpis = peticionesKpi();
      expect(kpis.length).toBe(1);
      expect(kpis[0].request.url.endsWith('/resumen')).toBeTrue();
      expect(kpis[0].request.params.get('empresa')).toBe('TU ALIANZA SAS');
      kpis[0].flush({ total: 0, porEstado: {}, porEstadoDocumento: {}, sinSoportes: 0 });
    });

    it('si /resumen falla, degrada a las seis peticiones size=1 del contrato viejo', () => {
      peticionPrincipal().flush(pagina([FILA_A], 1));
      const resumen = peticionesKpi();
      expect(resumen.length).toBe(1);
      resumen[0].flush({ error: 'sin resumen' }, { status: 503, statusText: 'Service Unavailable' });

      const tarjetas = peticionesKpi();
      expect(tarjetas.length).toBe(6);
      expect(tarjetas.some((r) => r.request.params.get('estado') === 'RECIBIDA')).toBeTrue();
      expect(tarjetas.some((r) => r.request.params.get('estado') === 'VALIDADA')).toBeTrue();
      expect(tarjetas.some((r) => r.request.params.get('estadoDocumento') === 'PRESCRITA')).toBeTrue();
      expect(tarjetas.some((r) => r.request.params.get('estadoDocumento') === 'NO_CUMPLE')).toBeTrue();
      expect(tarjetas.some((r) => r.request.params.get('soportesCompletos') === 'false')).toBeTrue();

      tarjetas.forEach((r) => r.flush(pagina([], 0, 0, 1)));
    });

    it('usa el totalElements del backend, no el numero de filas cargadas', () => {
      // La pagina trae 2 filas pero el backend dice que hay 837 en total.
      peticionPrincipal().flush(pagina([FILA_A, FILA_B], 837));
      responderKpis({
        total: 837,
        recibidas: 300,
        validadas: 420,
        prescritas: 12,
        noCumplen: 5,
        soportesIncompletos: 100,
      });

      expect(componente.filas().length).toBe(2);
      expect(componente.total()).toBe(837);
      expect(componente.kpis().total).toBe(837);
      expect(componente.kpis().recibidas).toBe(300);
      expect(componente.kpis().validadas).toBe(420);
      expect(componente.kpis().prescritas).toBe(12);
      expect(componente.kpis().noCumplen).toBe(5);
      expect(componente.kpis().soportesIncompletos).toBe(100);
    });

    it('pinta las seis tarjetas con sus valores en el DOM', () => {
      peticionPrincipal().flush(pagina([FILA_A], 837));
      responderKpis({
        total: 837,
        recibidas: 300,
        validadas: 420,
        prescritas: 12,
        noCumplen: 5,
        soportesIncompletos: 100,
      });
      fixture.detectChanges();

      const tarjetas: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.kpi-tarjeta'),
      );
      expect(tarjetas.length).toBe(6);

      const textos = tarjetas.map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim());
      expect(textos[0]).toContain('837');
      expect(textos[0]).toContain('Total');
      expect(textos[1]).toContain('300');
      expect(textos[3]).toContain('12');
      expect(textos[5]).toContain('100');
    });

    it('en el respaldo, si un conteo falla esa tarjeta queda vacia y las demas se pintan', () => {
      peticionPrincipal().flush(pagina([FILA_A], 10));

      // El /resumen agregado falla -> el componente degrada a las 6 peticiones size=1.
      const resumen = peticionesKpi();
      expect(resumen.length).toBe(1);
      resumen[0].flush('boom', { status: 500, statusText: 'Server Error' });

      for (const peticion of peticionesKpi()) {
        if (peticion.request.params.get('estadoDocumento') === 'PRESCRITA') {
          peticion.flush('boom', { status: 500, statusText: 'Server Error' });
        } else {
          peticion.flush(pagina([], 7, 0, 1));
        }
      }

      expect(componente.kpis().prescritas).toBeNull();
      expect(componente.kpis().total).toBe(7);
      expect(componente.kpis().recibidas).toBe(7);
    });

    it('al pulsar la tarjeta de prescritas aplica ese filtro', () => {
      peticionPrincipal().flush(pagina([FILA_A], 10));
      responderKpis();

      const tarjeta = componente.kpisDefinidos.find((k) => k.clave === 'prescritas')!;
      componente.aplicarKpi(tarjeta);
      componente.aplicarFiltros();

      expect(peticionPrincipal().request.params.get('estadoDocumento')).toBe('PRESCRITA');
      expect(componente.kpiActivo(tarjeta)).toBeTrue();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Filas y columnas
  // ═══════════════════════════════════════════════════════════════════

  describe('mapeo de filas', () => {
    beforeEach(() => {
      peticionPrincipal().flush(pagina([FILA_A, FILA_B], 2));
      responderKpis();
    });

    it('traduce los codigos a las etiquetas del catalogo', () => {
      const fila = componente.filas()[0] as FilaTabla;
      expect(fila.tipoIncapacidad).toBe('Enfermedad general');
      expect(fila.estado).toBe('Recibida');
      expect(fila.estadoDocumento).toBe('Documentacion OK');
      expect(fila.responsablePago).toBe('EPS');
    });

    it('convierte las fechas a Date local (sin correr un dia)', () => {
      const fila = componente.filas()[0] as FilaTabla;
      expect(fila.fechaInicio instanceof Date).toBeTrue();
      expect(fila.fechaInicio!.getFullYear()).toBe(2026);
      expect(fila.fechaInicio!.getMonth()).toBe(0);
      expect(fila.fechaInicio!.getDate()).toBe(31);
    });

    it('arma el indicador n/m de soportes y sabe si estan completos', () => {
      const [a, b] = componente.filas();
      expect(a.soportes).toBe('1/2');
      expect(a.soportesOk).toBeFalse();
      expect(b.soportes).toBe('2/2');
      expect(b.soportesOk).toBeTrue();
    });

    it('solo permite validar las que estan en RECIBIDA', () => {
      const [a, b] = componente.filas();
      expect(a.puedeValidarse).toBeTrue();
      expect(b.puedeValidarse).toBeFalse();
    });

    it('alimenta los desplegables con los valores distintos que llegaron', () => {
      expect(componente.opcionesEmpresa().map((o) => o.valor)).toEqual([
        'APOYO LABORAL SAS',
        'TU ALIANZA SAS',
      ]);
      expect(componente.opcionesEps().map((o) => o.valor)).toEqual(['NUEVA EPS', 'SURA']);
      expect(componente.opcionesRegistradoPor().map((o) => o.valor)).toEqual([
        'daniel.torres',
        'maria.lopez',
      ]);
    });

    it('colorea los chips de estado usando las etiquetas del catalogo', () => {
      const columnaEstado = componente.columnas().find((c) => c.name === 'estado');
      expect(columnaEstado?.type).toBe('status');
      expect(columnaEstado?.statusConfig?.['Recibida']).toBeDefined();
      expect(columnaEstado?.statusConfig?.['Validada']).toBeDefined();
    });

    it('deja todas las columnas sin filtro local (el filtrado es de servidor)', () => {
      expect(componente.columnas().every((c) => c.filterable === false)).toBeTrue();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Acciones de fila
  // ═══════════════════════════════════════════════════════════════════

  describe('acciones', () => {
    beforeEach(() => {
      peticionPrincipal().flush(pagina([FILA_A, FILA_B], 2));
      responderKpis();
    });

    it('eliminar pide confirmacion y llama al DELETE', async () => {
      const swal = spyOn(swalEspiable(), 'fire').and.
        returnValue(Promise.resolve({ isConfirmed: true }));

      componente.eliminar(componente.filas()[0]);
      await Promise.resolve();
      await Promise.resolve();

      expect(swal).toHaveBeenCalled();
      const req = httpMock.expectOne(`${BASE}/11`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('eliminar no llama al DELETE si el usuario cancela', async () => {
      spyOn(swalEspiable(), 'fire').and.returnValue(
        Promise.resolve({ isConfirmed: false }),
      );

      componente.eliminar(componente.filas()[0]);
      await Promise.resolve();
      await Promise.resolve();

      httpMock.expectNone(`${BASE}/11`);
    });

    it('validar con 409 muestra los motivos de bloqueo y no revienta', () => {
      const swal = spyOn(swalEspiable(), 'fire').and.
        returnValue(Promise.resolve({}));

      componente.validar(componente.filas()[0]);

      httpMock
        .expectOne(`${BASE}/11/validar`)
        .flush(
          { motivosBloqueo: ['Falta la historia clinica', 'Esta prescrita'] },
          { status: 409, statusText: 'Conflict' },
        );

      expect(swal).toHaveBeenCalled();
      const argumento = JSON.stringify(swal.calls.mostRecent().args[0]);
      expect(argumento).toContain('Falta la historia clinica');
      expect(argumento).toContain('Esta prescrita');
    });

    it('ver detalle abre el dialogo con el id de la fila', () => {
      componente.verDetalle(componente.filas()[1]);

      expect(dialogoFalso.open).toHaveBeenCalled();
      const configuracion = dialogoFalso.open.calls.mostRecent().args[1] as {
        data: { id: number };
      };
      expect(configuracion.data.id).toBe(12);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. Exportacion desde el componente
  // ═══════════════════════════════════════════════════════════════════

  describe('exportacion (integracion con el dialogo)', () => {
    it('le pasa al dialogo los filtros aplicados, la pagina actual y las columnas', () => {
      peticionPrincipal().flush(pagina([FILA_A, FILA_B], 837));
      responderKpis();

      componente.formulario.patchValue({ eps: 'SURA' });
      componente.aplicarFiltros();
      peticionPrincipal().flush(pagina([FILA_B], 400));
      responderKpis();

      componente.abrirExportacion();

      expect(dialogoFalso.open).toHaveBeenCalled();
      const [componenteAbierto, configuracion] = dialogoFalso.open.calls.mostRecent().args as [
        unknown,
        { data: { filtros: Record<string, string>; total: number; columnasEnTabla: string[]; filasPaginaActual: unknown[] } },
      ];

      expect(componenteAbierto).toBe(DialogoExportarIncapacidadesComponent);
      expect(configuracion.data.filtros['eps']).toBe('SURA');
      expect(configuracion.data.total).toBe(400);
      expect(configuracion.data.filasPaginaActual.length).toBe(1);
      expect(configuracion.data.columnasEnTabla).toContain('cedula');
      expect(configuracion.data.columnasEnTabla).not.toContain('actions');
    });

    it('"Base actual" abre la descarga masiva en modo base actual, sin filtros (reunion 2026-10-05)', () => {
      peticionPrincipal().flush(pagina([FILA_A, FILA_B], 837));
      responderKpis();

      componente.formulario.patchValue({ eps: 'SURA' });
      componente.aplicarFiltros();
      peticionPrincipal().flush(pagina([FILA_B], 400));
      responderKpis();

      // El boton esta en la barra de resultados, junto a "Descarga masiva".
      fixture.detectChanges();
      const botones = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.acciones-toolbar button'),
      ).map((b) => (b.textContent ?? '').trim());
      const iMasiva = botones.findIndex((t) => t.includes('Descarga masiva'));
      expect(botones[iMasiva + 1]).toContain('Base actual');

      componente.abrirBaseActual();

      const [componenteAbierto, configuracion] = dialogoFalso.open.calls.mostRecent().args as [
        unknown,
        { data: { filtros: Record<string, string>; totalEstimado: number | null; modo: string } },
      ];
      expect(componenteAbierto).toBe(DialogoExportMasivoComponent);
      expect(configuracion.data.modo).toBe('BASE_ACTUAL');
      expect(configuracion.data.filtros).toEqual({});
      expect(configuracion.data.totalEstimado).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6. Motor de exportacion (puro: sin TestBed ni navegador)
// ═════════════════════════════════════════════════════════════════════

describe('exportacion de incapacidades', () => {
  const ETIQUETAS = {
    tipoIncapacidad: () => 'Enfermedad general',
    estado: () => 'Recibida',
    estadoDocumento: () => 'Documentacion OK',
    responsablePago: () => 'EPS',
  };

  it('respeta EXACTAMENTE las columnas seleccionadas', () => {
    const filas = construirFilasExportacion([FILA_A], ['cedula', 'estado'], ETIQUETAS);

    expect(filas.length).toBe(1);
    expect(Object.keys(filas[0])).toEqual(['Cedula', 'Estado']);
    expect(filas[0]['Cedula']).toBe('1005851505');
    expect(filas[0]['Estado']).toBe('Recibida');
  });

  it('no cuela columnas que el usuario desmarco', () => {
    const filas = construirFilasExportacion([FILA_A], ['cedula'], ETIQUETAS);
    expect(Object.keys(filas[0])).not.toContain('Nombre del trabajador');
    expect(Object.keys(filas[0])).not.toContain('EPS');
  });

  it('conserva el orden canonico aunque se pidan las claves desordenadas', () => {
    const filas = construirFilasExportacion(
      [FILA_A],
      ['creadoPor', 'cedula', 'consecutivoSistema'],
      ETIQUETAS,
    );
    expect(Object.keys(filas[0])).toEqual(['Codigo unico', 'Cedula', 'Registrado por']);
    expect(cabecerasExportacion(['creadoPor', 'cedula'])).toEqual(['Cedula', 'Registrado por']);
  });

  it('ignora en silencio las claves desconocidas', () => {
    const columnas = clavesAColumnas(['cedula', 'inventada', 'dias']);
    expect(columnas.map((c) => c.clave)).toEqual(['cedula', 'dias']);
  });

  it('si no hay ninguna columna marcada, cada fila sale vacia', () => {
    const filas = construirFilasExportacion([FILA_A, FILA_B], [], ETIQUETAS);
    expect(filas.length).toBe(2);
    expect(Object.keys(filas[0])).toEqual([]);
  });

  it('formatea las fechas como dd/MM/yyyy sin correr el dia', () => {
    const filas = construirFilasExportacion([FILA_A], ['fechaInicio', 'fechaFin'], ETIQUETAS);
    expect(filas[0]['Fecha inicio']).toBe('31/01/2026');
    expect(filas[0]['Fecha fin']).toBe('04/02/2026');
  });

  it('deja vacios los numeros que el backend no envio, sin inventar ceros', () => {
    const sinDias: IncapacidadResumenExtendido = { ...FILA_A, diasEmpresa: null, diasEntidad: undefined };
    const filas = construirFilasExportacion([sinDias], ['diasEmpresa', 'diasEntidad', 'dias'], ETIQUETAS);
    expect(filas[0]['Dias empresa']).toBe('');
    expect(filas[0]['Dias entidad']).toBe('');
    expect(filas[0]['Dias']).toBe(5);
  });

  it('las columnas por defecto son las 42 del consolidado oficial (reunion 2026-08-20)', () => {
    expect(CLAVES_EXPORTACION_POR_DEFECTO.length).toBe(42);
    expect(CLAVES_EXPORTACION_POR_DEFECTO).toContain('cedula');
    expect(CLAVES_EXPORTACION_POR_DEFECTO).toContain('estado');
    expect(CLAVES_EXPORTACION_POR_DEFECTO).toContain('codigoSede');
    expect(CLAVES_EXPORTACION_POR_DEFECTO).toContain('transcrita');
    expect(CLAVES_EXPORTACION_POR_DEFECTO).not.toContain('id');
    expect(CLAVES_EXPORTACION_POR_DEFECTO.length).toBeLessThan(COLUMNAS_EXPORTABLES.length);
  });

  it('el consolidado arranca con Semana, Lugar radicado, Codigo unico y Codigo sede, en ese orden', () => {
    const cabeceras = cabecerasExportacion(CLAVES_EXPORTACION_POR_DEFECTO);
    expect(cabeceras.slice(0, 6)).toEqual([
      'Semana',
      'Lugar radicado',
      'Codigo unico',
      'Codigo sede',
      'Numero contrato',
      'Empleador',
    ]);
    expect(cabeceras[cabeceras.length - 1]).toBe('Radicado por');
  });

  it('la columna Codigo unico prefiere el codigo consecutivo de cartera (TASB018)', () => {
    const conCodigo: IncapacidadResumenExtendido = { ...FILA_A, codigoConsecutivo: 'TASB018' };
    const filas = construirFilasExportacion([conCodigo, FILA_A], ['consecutivoSistema'], ETIQUETAS);
    expect(filas[0]['Codigo unico']).toBe('TASB018');
    // Sin codigo de cartera (historicas) cae al codigo tecnico.
    expect(String(filas[1]['Codigo unico']).length).toBeGreaterThan(0);
  });

  it('el CSV usa punto y coma y escapa lo que haga falta', () => {
    const conComillas: IncapacidadResumenExtendido = {
      ...FILA_A,
      nombreCompleto: 'PEREZ; ANA "LA JEFA"',
    };
    const claves = ['cedula', 'nombreCompleto'];
    const filas = construirFilasExportacion([conComillas], claves, ETIQUETAS);
    const csv = construirCsv(filas, cabecerasExportacion(claves));
    const lineas = csv.split('\r\n');

    expect(lineas[0]).toBe('Cedula;Nombre completo');
    expect(lineas[1]).toBe('1005851505;"PEREZ; ANA ""LA JEFA"""');
  });

  it('el CSV escribe una linea por registro', () => {
    const claves = ['cedula'];
    const filas = construirFilasExportacion([FILA_A, FILA_B], claves, ETIQUETAS);
    const csv = construirCsv(filas, cabecerasExportacion(claves));
    expect(csv.split('\r\n').length).toBe(3);
  });

  it('calcula el indicador de soportes y si estan completos', () => {
    expect(indicadorSoportes(FILA_A)).toBe('1/2');
    expect(soportesCompletos(FILA_A)).toBeFalse();
    expect(soportesCompletos(FILA_B)).toBeTrue();
    expect(soportesCompletos({ ...FILA_A, soportesAdjuntos: null, soportesExigidos: null })).toBeNull();
    expect(indicadorSoportes({ ...FILA_A, soportesAdjuntos: null })).toBe('');
  });

  it('el nombre del archivo lleva marca de tiempo local', () => {
    const nombre = nombreArchivoExportacion('xlsx', new Date(2026, 7, 4, 9, 5));
    expect(nombre).toBe('incapacidades_20260804_0905.xlsx');
  });
});

// ═════════════════════════════════════════════════════════════════════
// 7. El servicio se usa con la firma acordada en F1
// ═════════════════════════════════════════════════════════════════════

describe('contrato con IncapacidadV2Service', () => {
  it('listar acepta los filtros extendidos de la consulta', () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    const srv = TestBed.inject(IncapacidadV2Service);
    const httpMock = TestBed.inject(HttpTestingController);

    // OJO: `listar()` declara `FiltrosIncapacidadV2`. Los filtros extendidos
    // viajan porque el servicio recorre las claves del objeto, pero hay que
    // pasarlos como variable tipada: un literal chocaria con la comprobacion
    // de propiedades sobrantes de TypeScript.
    const filtros: FiltrosConsultaIncapacidad = {
      empresa: 'TU ALIANZA SAS',
      soportesCompletos: 'false',
      registradoDesde: '2026-01-01',
      temporal: 'Tu Alianza',
      afp: 'PORVENIR',
      registradoPor: 'daniel.torres',
    };

    srv.listar(filtros, 1, 50, { campo: 'creadoEn', direccion: 'desc' }).subscribe();

    const req = httpMock.expectOne((r) => r.url === BASE);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('size')).toBe('50');
    expect(req.request.params.get('sort')).toBe('creadoEn,desc');
    expect(req.request.params.get('soportesCompletos')).toBe('false');
    expect(req.request.params.get('registradoPor')).toBe('daniel.torres');
    req.flush(pagina([], 0));
  });
});

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '@/environments/environment';
import { IncapacidadV2Service } from './incapacidad-v2.service';
import {
  CatalogosIncapacidad,
  CrearIncapacidadV2Request,
  IncapacidadResumen,
  ListaSoportesResponse,
  Page,
  ResultadoPromocion,
  SoporteIncapacidad,
  ValidacionResponse,
  ValidarIncapacidadRequest,
} from '../../models/incapacidad-v2.model';

const API = environment.apiUrl;
const BASE = `${API}/Incapacidades/v2`;

const REQ_VALIDAR: ValidarIncapacidadRequest = {
  cedula: '1005851505',
  fechaIngreso: '2024-01-15',
  tipoIncapacidad: 'ENFERMEDAD_GENERAL',
  fechaInicio: '2026-07-01',
  fechaFin: '2026-07-05',
  codigoDiagnostico: 'J00',
  eps: 'NUEVA EPS',
  estadoDocumento: 'OK',
  soportesCargados: ['INCAPACIDAD_MEDICA'],
};

const REQ_CREAR: CrearIncapacidadV2Request = {
  cedula: '1005851505',
  fechaIngreso: '2024-01-15',
  eps: 'SURA',
  tipoIncapacidad: 'ENFERMEDAD_GENERAL',
  fechaInicio: '2026-01-01',
  fechaFin: '2026-01-03',
  codigoDiagnostico: 'J00',
  estadoDocumento: 'OK',
  oficina: 'SOACHA',
  // El backend lo llama `recibidoPor`: cualquier otro nombre es un 400.
  recibidoPor: 'ANA PEREZ',
};

/** `SoporteResponse` tal como lo devuelve el POST de soportes. */
const SOPORTE: SoporteIncapacidad = {
  id: 9,
  incapacidadId: 55,
  tipo: 'HISTORIAL_CLINICO',
  tipoEtiqueta: 'Historia clinica',
  nombreArchivo: 'historia.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  documentId: 321,
  fileUrl: '/media/incapacidades/historia.pdf',
  versionNumber: 1,
  subidoPor: 'ana@tsservicios.co',
  subidoEn: '2026-08-04T15:04:05Z',
  estado: 'SINCRONIZADO',
};

const CATALOGOS: CatalogosIncapacidad = {
  tiposIncapacidad: [{ codigo: 'ENFERMEDAD_GENERAL', etiqueta: 'Enfermedad general' }],
  estados: [{ codigo: 'RECIBIDA', etiqueta: 'Recibida' }],
  estadosDocumento: [
    { codigo: 'OK', etiqueta: 'Documentacion OK', automatico: false },
    { codigo: 'PRESCRITA', etiqueta: 'Prescrita', automatico: true },
  ],
  responsablesPago: [{ codigo: 'EPS', etiqueta: 'EPS' }],
  tiposSoporte: [{ codigo: 'INCAPACIDAD_MEDICA', etiqueta: 'Incapacidad medica' }],
};

const PAGINA_VACIA: Page<IncapacidadResumen> = {
  content: [],
  number: 0,
  size: 20,
  totalElements: 0,
  totalPages: 0,
};

describe('IncapacidadV2Service', () => {
  let servicio: IncapacidadV2Service;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.setItem('token', 'Bearer token-de-prueba');

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        IncapacidadV2Service,
      ],
    });

    servicio = TestBed.inject(IncapacidadV2Service);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('token');
  });

  it('se crea', () => {
    expect(servicio).toBeTruthy();
  });

  describe('validar', () => {
    it('hace POST a /Incapacidades/v2/validar con el cuerpo tal cual', () => {
      const recibidas: ValidacionResponse[] = [];
      servicio.validar(REQ_VALIDAR).subscribe((r) => recibidas.push(r));

      const req = http.expectOne(`${BASE}/validar`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(REQ_VALIDAR);
      expect(req.request.headers.get('Authorization')).toBe('Bearer token-de-prueba');

      req.flush({ dias: 5, puedeValidar: true, motivosBloqueo: [] });
      expect(recibidas.length).toBe(1);
      expect(recibidas[0].dias).toBe(5);
    });

    it('propaga el error sin transformarlo', () => {
      const errores: HttpErrorResponse[] = [];
      servicio.validar(REQ_VALIDAR).subscribe({
        next: () => fail('no deberia emitir'),
        error: (e: HttpErrorResponse) => errores.push(e),
      });

      http.expectOne(`${BASE}/validar`).flush('boom', { status: 500, statusText: 'Error' });
      expect(errores.length).toBe(1);
      expect(errores[0].status).toBe(500);
    });
  });

  describe('CRUD', () => {
    it('crear hace POST a la base', () => {
      servicio.crear(REQ_CREAR).subscribe();
      const req = http.expectOne(BASE);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(REQ_CREAR);
      req.flush({ id: 1 });
    });

    it('actualizar hace PUT a /{id}', () => {
      servicio.actualizar(7, REQ_CREAR).subscribe();
      const req = http.expectOne(`${BASE}/7`);
      expect(req.request.method).toBe('PUT');
      req.flush({ id: 7 });
    });

    it('obtener hace GET a /{id}', () => {
      servicio.obtener(7).subscribe();
      const req = http.expectOne(`${BASE}/7`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: 7 });
    });

    it('eliminar hace DELETE a /{id}', () => {
      servicio.eliminar(7).subscribe();
      const req = http.expectOne(`${BASE}/7`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });
  });

  describe('promoverAValidada', () => {
    it('devuelve ok:true con el 200', () => {
      const resultados: ResultadoPromocion[] = [];
      servicio.promoverAValidada(7).subscribe((r) => resultados.push(r));

      const req = http.expectOne(`${BASE}/7/validar`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 7, estado: 'VALIDADA' });

      expect(resultados.length).toBe(1);
      expect(resultados[0].ok).toBe(true);
      expect(resultados[0].motivosBloqueo).toEqual([]);
    });

    it('traduce el 409 a ok:false con los motivosBloqueo', () => {
      const resultados: ResultadoPromocion[] = [];
      const errores: unknown[] = [];
      servicio.promoverAValidada(7).subscribe({
        next: (r) => resultados.push(r),
        error: (e: unknown) => errores.push(e),
      });

      http.expectOne(`${BASE}/7/validar`).flush(
        { motivosBloqueo: ['Falta historia clinica', 'No cumple cotizacion'] },
        { status: 409, statusText: 'Conflict' },
      );

      expect(errores.length).toBe(0);
      expect(resultados.length).toBe(1);
      expect(resultados[0].ok).toBe(false);
      expect(resultados[0].motivosBloqueo).toEqual([
        'Falta historia clinica',
        'No cumple cotizacion',
      ]);
    });

    it('da un motivo por defecto si el 409 viene sin cuerpo util', () => {
      const resultados: ResultadoPromocion[] = [];
      servicio.promoverAValidada(7).subscribe((r) => resultados.push(r));

      http.expectOne(`${BASE}/7/validar`).flush(null, {
        status: 409,
        statusText: 'Conflict',
      });

      expect(resultados[0].ok).toBe(false);
      expect(resultados[0].motivosBloqueo.length).toBe(1);
    });

    it('NO se traga los errores distintos de 409', () => {
      const errores: HttpErrorResponse[] = [];
      servicio.promoverAValidada(7).subscribe({
        next: () => fail('no deberia emitir'),
        error: (e: HttpErrorResponse) => errores.push(e),
      });

      http.expectOne(`${BASE}/7/validar`).flush('nope', { status: 500, statusText: 'Error' });
      expect(errores.length).toBe(1);
      expect(errores[0].status).toBe(500);
    });
  });

  describe('listar', () => {
    it('manda page, size y sort', () => {
      const paginas: Page<IncapacidadResumen>[] = [];
      servicio
        .listar({}, 2, 50, { campo: 'fechaInicio', direccion: 'desc' })
        .subscribe((p) => paginas.push(p));

      const req = http.expectOne((r) => r.url === BASE);
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('size')).toBe('50');
      expect(req.request.params.get('sort')).toBe('fechaInicio,desc');

      req.flush({ ...PAGINA_VACIA, number: 2, size: 50 });
      expect(paginas.length).toBe(1);
      expect(paginas[0].content).toEqual([]);
    });

    it('acepta el sort como cadena', () => {
      servicio.listar({}, 0, 20, 'cedula,asc').subscribe();
      const req = http.expectOne((r) => r.url === BASE);
      expect(req.request.params.get('sort')).toBe('cedula,asc');
      req.flush(PAGINA_VACIA);
    });

    it('omite los filtros vacios, nulos o de solo espacios', () => {
      servicio
        .listar({ cedula: '  1005  ', eps: '   ', estado: undefined, q: '' }, 0, 20)
        .subscribe();

      const req = http.expectOne((r) => r.url === BASE);
      expect(req.request.params.get('cedula')).toBe('1005');
      expect(req.request.params.has('eps')).toBe(false);
      expect(req.request.params.has('estado')).toBe(false);
      expect(req.request.params.has('q')).toBe(false);
      expect(req.request.params.has('sort')).toBe(false);

      req.flush(PAGINA_VACIA);
    });
  });

  describe('catalogos', () => {
    it('pide los catalogos UNA sola vez y cachea en el signal', () => {
      expect(servicio.catalogosListos()).toBe(false);

      servicio.catalogos().subscribe();
      http.expectOne(`${BASE}/catalogos`).flush(CATALOGOS);

      expect(servicio.catalogosListos()).toBe(true);
      expect(servicio.catalogosCache()).toEqual(CATALOGOS);

      const segundas: CatalogosIncapacidad[] = [];
      servicio.catalogos().subscribe((c) => segundas.push(c));
      http.expectNone(`${BASE}/catalogos`);
      expect(segundas).toEqual([CATALOGOS]);
    });

    it('comparte la peticion en vuelo entre suscriptores concurrentes', () => {
      const recibidos: CatalogosIncapacidad[] = [];
      servicio.catalogos().subscribe((c) => recibidos.push(c));
      servicio.catalogos().subscribe((c) => recibidos.push(c));

      // Un solo GET pese a los dos suscriptores.
      http.expectOne(`${BASE}/catalogos`).flush(CATALOGOS);

      expect(recibidos).toEqual([CATALOGOS, CATALOGOS]);
    });

    it('propaga el error y permite reintentar', () => {
      const errores: HttpErrorResponse[] = [];
      servicio.catalogos().subscribe({
        next: () => fail('no deberia emitir'),
        error: (e: HttpErrorResponse) => errores.push(e),
      });
      http.expectOne(`${BASE}/catalogos`).flush('boom', { status: 503, statusText: 'X' });

      expect(errores.length).toBe(1);
      expect(errores[0].status).toBe(503);
      expect(servicio.catalogosListos()).toBe(false);

      // El reintento vuelve a pegarle al backend.
      servicio.catalogos().subscribe();
      http.expectOne(`${BASE}/catalogos`).flush(CATALOGOS);
      expect(servicio.catalogosListos()).toBe(true);
    });

    it('invalidarCatalogos fuerza una nueva peticion', () => {
      servicio.catalogos().subscribe();
      http.expectOne(`${BASE}/catalogos`).flush(CATALOGOS);

      servicio.invalidarCatalogos();
      expect(servicio.catalogosListos()).toBe(false);

      servicio.catalogos().subscribe();
      http.expectOne(`${BASE}/catalogos`).flush(CATALOGOS);
    });
  });

  describe('endpoints de contratacion reutilizados', () => {
    it('buscarEmpleados manda q y limit', () => {
      servicio.buscarEmpleados('juan', 15).subscribe();
      const req = http.expectOne((r) => r.url === `${API}/contratacion/empleados/buscar`);
      expect(req.request.params.get('q')).toBe('juan');
      expect(req.request.params.get('limit')).toBe('15');
      req.flush([]);
    });

    it('buscarEmpleadosPorDocumento va a /Incapacidades/v2/empleados/buscar con q, tipo y limit', () => {
      let filas: unknown[] = [];
      servicio.buscarEmpleadosPorDocumento('X1234', 'PPT').subscribe((r) => (filas = r));
      const req = http.expectOne((r) => r.url === `${BASE}/empleados/buscar`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('q')).toBe('X1234');
      expect(req.request.params.get('tipo')).toBe('PPT');
      expect(req.request.params.get('limit')).toBe('15');
      req.flush([
        { cedula: '1234', nombreCompleto: 'ANA', tipoDocumento: 'PET', tipoDocumentoCanonico: 'PPT',
          fechaIngreso: null, fechaIngresoTexto: '01/02/2024' },
      ]);
      // Sin fecha tipada se cae al texto crudo (parsearFechaFlexible lo entiende).
      expect((filas[0] as { fechaIngreso: string }).fechaIngreso).toBe('01/02/2024');
    });

    it('buscarEmpleadosPorDocumento sin tipo no manda el parametro (busqueda de siempre)', () => {
      servicio.buscarEmpleadosPorDocumento('perez', null, 10).subscribe();
      const req = http.expectOne((r) => r.url === `${BASE}/empleados/buscar`);
      expect(req.request.params.has('tipo')).toBeFalse();
      expect(req.request.params.get('limit')).toBe('10');
      req.flush([]);
    });

    it('datosContratacion codifica la cedula en la ruta', () => {
      servicio.datosContratacion('1005 851').subscribe();
      const req = http.expectOne(
        `${API}/contratacion/datosIncapacidadContratacion/1005%20851`,
      );
      expect(req.request.method).toBe('GET');
      req.flush({});
    });

    it('buscarCodigosDiagnostico usa el endpoint CIE-10 con limit por defecto', () => {
      servicio.buscarCodigosDiagnostico('gripa').subscribe();
      const req = http.expectOne(
        (r) => r.url === `${API}/Incapacidades/codigos-diagnostico/search`,
      );
      expect(req.request.params.get('q')).toBe('gripa');
      expect(req.request.params.get('limit')).toBe('20');
      req.flush([]);
    });

    it('buscarIps usa el endpoint de IPS', () => {
      servicio.buscarIps('clinica', 5).subscribe();
      const req = http.expectOne((r) => r.url === `${API}/Incapacidades/ips/search`);
      expect(req.request.params.get('limit')).toBe('5');
      req.flush([]);
    });
  });

  describe('subirSoporte', () => {
    it('va al endpoint v2 anclado en el id NUMERICO, no al multipart legacy', () => {
      const archivo = new File(['contenido'], 'incapacidad.pdf', { type: 'application/pdf' });
      const recibidos: SoporteIncapacidad[] = [];
      servicio.subirSoporte(55, 'HISTORIAL_CLINICO', archivo).subscribe((s) => recibidos.push(s));

      const req = http.expectOne(`${BASE}/55/soportes`);
      expect(req.request.method).toBe('POST');

      const cuerpo = req.request.body as FormData;
      expect(cuerpo instanceof FormData).toBe(true);
      expect((cuerpo.get('file') as File).name).toBe('incapacidad.pdf');
      // El tipo viaja como nombre del enum, no como legacy_field.
      expect(cuerpo.get('tipoSoporte')).toBe('HISTORIAL_CLINICO');
      expect(cuerpo.has('legacy_field')).toBe(false);

      // El navegador debe poner el boundary: no se fuerza Content-Type.
      expect(req.request.headers.has('Content-Type')).toBe(false);
      expect(req.request.headers.get('Authorization')).toBe('Bearer token-de-prueba');

      req.flush(SOPORTE, { status: 201, statusText: 'Created' });
      expect(recibidos).toEqual([SOPORTE]);
    });

    it('NO pega al endpoint legacy /documentos/upload', () => {
      servicio.subirSoporte(55, 'INCAPACIDAD_MEDICA', new File([''], 'a.pdf')).subscribe();
      http.expectNone((r) => r.url.includes('/documentos/upload'));
      http.expectOne(`${BASE}/55/soportes`).flush(SOPORTE, { status: 201, statusText: 'Created' });
    });

    it('propaga el 400 del backend (formato o tamano invalidos) con su mensaje', () => {
      const errores: HttpErrorResponse[] = [];
      servicio.subirSoporte(55, 'FURAT', new File(['x'], 'malo.docx')).subscribe({
        next: () => fail('no deberia emitir'),
        error: (e: HttpErrorResponse) => errores.push(e),
      });

      http.expectOne(`${BASE}/55/soportes`).flush(
        { message: 'El archivo debe ser PDF, JPG o PNG.' },
        { status: 400, statusText: 'Bad Request' },
      );

      expect(errores.length).toBe(1);
      expect(errores[0].status).toBe(400);
      expect((errores[0].error as { message: string }).message).toContain('PDF');
    });

    it('propaga el 404 cuando la incapacidad no existe o esta inactiva', () => {
      const errores: HttpErrorResponse[] = [];
      servicio.subirSoporte(999, 'FURAT', new File(['x'], 'f.pdf')).subscribe({
        next: () => fail('no deberia emitir'),
        error: (e: HttpErrorResponse) => errores.push(e),
      });

      http
        .expectOne(`${BASE}/999/soportes`)
        .flush({ message: 'Incapacidad no encontrada' }, { status: 404, statusText: 'Not Found' });

      expect(errores[0].status).toBe(404);
    });

    it('no toca la red si la incapacidad todavia no tiene id', () => {
      const errores: unknown[] = [];
      servicio.subirSoporte(0, 'FURAT', new File(['x'], 'f.pdf')).subscribe({
        next: () => fail('no deberia emitir'),
        error: (e: unknown) => errores.push(e),
      });

      expect(errores.length).toBe(1);
      expect((errores[0] as Error).message).toContain('id');
      http.expectNone(() => true);
    });
  });

  describe('listarSoportes / eliminarSoporte', () => {
    it('listarSoportes hace GET a /{id}/soportes', () => {
      const respuestas: ListaSoportesResponse[] = [];
      servicio.listarSoportes(55).subscribe((r) => respuestas.push(r));

      const req = http.expectOne(`${BASE}/55/soportes`);
      expect(req.request.method).toBe('GET');
      req.flush({ incapacidadId: 55, soportes: [SOPORTE] });

      expect(respuestas[0].incapacidadId).toBe(55);
      expect(respuestas[0].soportes[0].estado).toBe('SINCRONIZADO');
    });

    it('eliminarSoporte hace DELETE a /{id}/soportes/{tipo}', () => {
      servicio.eliminarSoporte(55, 'REGISTRO_NACIDO_VIVO').subscribe();
      const req = http.expectOne(`${BASE}/55/soportes/REGISTRO_NACIDO_VIVO`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });
  });

  describe('urlAbsolutaDocumento', () => {
    it('deja pasar las URL absolutas', () => {
      expect(servicio.urlAbsolutaDocumento('https://x.co/a.pdf')).toBe('https://x.co/a.pdf');
    });

    it('resuelve las rutas relativas contra apiUrl', () => {
      expect(servicio.urlAbsolutaDocumento('/media/a.pdf')).toBe(`${API}/media/a.pdf`);
      expect(servicio.urlAbsolutaDocumento('media/a.pdf')).toBe(`${API}/media/a.pdf`);
    });

    it('devuelve cadena vacia con valores vacios', () => {
      expect(servicio.urlAbsolutaDocumento(null)).toBe('');
      expect(servicio.urlAbsolutaDocumento(undefined)).toBe('');
      expect(servicio.urlAbsolutaDocumento('')).toBe('');
    });
  });

  describe('descargarDocumento', () => {
    // El gateway exige JWT en /api/v1/documents/**: un <a href> plano navegaba
    // sin Authorization y daba 401. La descarga DEBE ir por HttpClient con token.
    it('baja el documento como blob CON el header Authorization', () => {
      const blobs: Blob[] = [];
      servicio.descargarDocumento('/api/v1/documents/560920/download').subscribe((b) => blobs.push(b));

      const req = http.expectOne(`${API}/api/v1/documents/560920/download`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      expect(req.request.headers.get('Authorization')).toBe('Bearer token-de-prueba');
      req.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));

      expect(blobs.length).toBe(1);
      expect(blobs[0].type).toBe('application/pdf');
    });
  });
});

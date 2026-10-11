import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '@/environments/environment';
import { ReunionesService } from './reuniones.service';
import { ACUERDOS, PERSONAS, ficha, insights } from '../testing/fabricas';
import { Analisis } from '../models/reunion.model';

const BASE = `${environment.apiUrl}/api/v1/meetings`;

describe('ReunionesService (v2)', () => {
  let api: ReunionesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ReunionesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('insights: GET /{id}/insights', () => {
    let recibido: unknown;
    api.insights('m1').subscribe(r => (recibido = r));
    const req = http.expectOne(`${BASE}/m1/insights`);
    expect(req.request.method).toBe('GET');
    req.flush(insights());
    expect((recibido as { recording_id: string }).recording_id).toBe('r1');
  });

  it('analizar: POST /{id}/analyze y acepta el análisis suelto o envuelto', () => {
    const analisis: Analisis = { id: 'a', status: 'PENDIENTE', summary: null, model: null, error: null, generated_at: null, version: 2 };
    const resultados: (Analisis | null)[] = [];
    api.analizar('m1').subscribe(r => resultados.push(r));
    const req = http.expectOne(`${BASE}/m1/analyze`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ analysis: analisis }, { status: 202, statusText: 'Accepted' });

    api.analizar('m1').subscribe(r => resultados.push(r));
    http.expectOne(`${BASE}/m1/analyze`).flush(analisis, { status: 202, statusText: 'Accepted' });
    expect(resultados).toEqual([analisis, analisis]);
  });

  it('acuerdos: POST /{id}/items, PUT /items/{id}, DELETE /items/{id}', () => {
    const cuerpo = { kind: 'COMPROMISO' as const, text: 'Enviar el reporte', owner_speaker_id: 'h2', due_text: 'el viernes', start_ms: 19500 };
    api.crearAcuerdo('m1', cuerpo).subscribe();
    const alta = http.expectOne(`${BASE}/m1/items`);
    expect(alta.request.method).toBe('POST');
    expect(alta.request.body).toEqual(cuerpo);
    alta.flush(ACUERDOS[1]);

    api.actualizarAcuerdo('a2', { ...cuerpo, status: 'HECHO' }).subscribe();
    const put = http.expectOne(`${BASE}/items/a2`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body.status).toBe('HECHO');
    put.flush(ACUERDOS[1]);

    api.eliminarAcuerdo('a2').subscribe();
    const del = http.expectOne(`${BASE}/items/a2`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
  });

  it('segmentos: página, tamaño y filtros por hablante y rango', () => {
    api.segmentos('r1', 2, 500, { speaker_id: 'h1', from_ms: 0, to_ms: 12000 }).subscribe();
    const req = http.expectOne(r => r.url === `${BASE}/recordings/r1/segments`);
    const p = req.request.params;
    expect(p.get('page')).toBe('2');
    expect(p.get('size')).toBe('500');
    expect(p.get('speaker_id')).toBe('h1');
    expect(p.get('from_ms')).toBe('0');
    expect(p.get('to_ms')).toBe('12000');
    req.flush({ content: [], totalElements: 0, totalPages: 0, number: 2, size: 500 });
  });

  it('segmentos sin filtros no manda parámetros de filtro', () => {
    api.segmentos('r1', 0, 500).subscribe();
    const req = http.expectOne(r => r.url === `${BASE}/recordings/r1/segments`);
    expect(req.request.params.keys().sort()).toEqual(['page', 'size']);
    req.flush({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 500 });
  });

  it('hablantes: asignar (PUT), confirmar y crear participante desde la sugerencia (POST)', () => {
    api.asignarHablante('h2', null).subscribe();
    const put = http.expectOne(`${BASE}/speakers/h2`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ participant_id: null });
    put.flush({});

    api.confirmarHablante('h2').subscribe();
    const conf = http.expectOne(`${BASE}/speakers/h2/confirm`);
    expect(conf.request.method).toBe('POST');
    conf.flush({});

    api.participanteDesdeSugerencia('h2').subscribe();
    const crear = http.expectOne(`${BASE}/speakers/h2/participant-from-suggestion`);
    expect(crear.request.method).toBe('POST');
    crear.flush({});
  });

  it('búsqueda global: GET /search con q, person y limit', () => {
    api.buscarGlobal('cierre de nómina', { persona: 'u:42', limit: 100 }).subscribe();
    const req = http.expectOne(r => r.url === `${BASE}/search`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('cierre de nómina');
    expect(req.request.params.get('person')).toBe('u:42');
    expect(req.request.params.get('limit')).toBe('100');
    req.flush({ query: 'cierre de nómina', total: 0, matches: [] });

    api.buscarGlobal('accesos').subscribe();
    const sinFiltros = http.expectOne(r => r.url === `${BASE}/search`);
    expect(sinFiltros.request.params.keys()).toEqual(['q']);
    sinFiltros.flush({ query: 'accesos', total: 0, matches: [] });
  });

  it('personas: GET /people (con q opcional)', () => {
    api.personas().subscribe();
    const todas = http.expectOne(r => r.url === `${BASE}/people`);
    expect(todas.request.params.keys()).toEqual([]);
    todas.flush(PERSONAS);

    api.personas(' mar ').subscribe();
    const filtradas = http.expectOne(r => r.url === `${BASE}/people`);
    expect(filtradas.request.params.get('q')).toBe('mar');
    filtradas.flush(PERSONAS);
  });

  it('ficha de persona: la clave va codificada en la ruta', () => {
    api.persona('u:42').subscribe();
    http.expectOne(`${BASE}/people/u%3A42`).flush(ficha());

    api.persona('e:ana@proveedor.co').subscribe();
    http.expectOne(`${BASE}/people/e%3Aana%40proveedor.co`).flush(ficha());

    api.persona('n:damian torres').subscribe();
    http.expectOne(`${BASE}/people/n%3Adamian%20torres`).flush(ficha());
  });
});

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { environment } from '@/environments/environment';
import { ArchivosBackendService } from './archivos-backend.service';

/**
 * El backend devuelve RUTAS protegidas, no imágenes. Puestas crudas en un
 * `<img>` el navegador las pide al front (que responde su index.html) y con el
 * dominio de la API delante responde 401, porque un `<img>` no manda token.
 * Por eso la firma quedaba guardada y en pantalla decía "Sin registrar".
 */
describe('ArchivosBackendService', () => {
  let srv: ArchivosBackendService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        ArchivosBackendService,
      ],
    });
    srv = TestBed.inject(ArchivosBackendService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('completa la ruta del backend contra la API', () => {
    expect(srv.absoluta('/gestion_contratacion/biometria/file/123/firma'))
      .toBe(`${environment.apiUrl}/gestion_contratacion/biometria/file/123/firma`);
    expect(srv.absoluta('api/v1/documents/9/download'))
      .toBe(`${environment.apiUrl}/api/v1/documents/9/download`);
  });

  it('deja pasar lo que ya es pintable', () => {
    expect(srv.visible('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(srv.visible('blob:https://x/y')).toBe('blob:https://x/y');
    // Servidor ajeno: se pinta tal cual, sin pedirlo con token.
    expect(srv.visible('https://formulario.tsservicios.co/media/x.png'))
      .toBe('https://formulario.tsservicios.co/media/x.png');
    expect(srv.visible(null)).toBeNull();
    expect(srv.visible('')).toBeNull();
  });

  it('descarga con HttpClient —que sí lleva el token— y sirve un blob local', () => {
    const ruta = '/gestion_contratacion/biometria/file/123/firma';

    // Primera lectura: aún no está, y dispara la descarga.
    expect(srv.visible(ruta)).toBeNull();

    const req = http.expectOne(`${environment.apiUrl}${ruta}`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x'], { type: 'image/png' }));

    const url = srv.visible(ruta);
    expect(url).toMatch(/^blob:/);
    // Ya descargado: no se vuelve a pedir.
    expect(srv.visible(ruta)).toBe(url);
  });

  it('una ruta que falla no se reintenta en cada repintado', () => {
    const ruta = '/api/v1/documents/9/download';
    expect(srv.visible(ruta)).toBeNull();
    http.expectOne(`${environment.apiUrl}${ruta}`).error(new ProgressEvent('error'), {
      status: 404, statusText: 'Not Found',
    });

    expect(srv.visible(ruta)).toBeNull();
    http.expectNone(`${environment.apiUrl}${ruta}`);
  });

  it('invalidar suelta la copia para que la nueva firma se vea', () => {
    const ruta = '/gestion_contratacion/biometria/file/123/firma';
    srv.visible(ruta);
    http.expectOne(`${environment.apiUrl}${ruta}`).flush(new Blob(['a'], { type: 'image/png' }));
    const primera = srv.visible(ruta);

    srv.invalidar(ruta);

    expect(srv.visible(ruta)).toBeNull();
    http.expectOne(`${environment.apiUrl}${ruta}`).flush(new Blob(['b'], { type: 'image/png' }));
    expect(srv.visible(ruta)).not.toBe(primera);
  });
});

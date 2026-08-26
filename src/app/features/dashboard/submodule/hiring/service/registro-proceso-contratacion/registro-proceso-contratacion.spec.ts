import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { environment } from '@/environments/environment';
import { RegistroProcesoContratacion } from './registro-proceso-contratacion';

const BASE = `${environment.apiUrl}/gestion_contratacion`;

/**
 * EL SOBRE DE `?full=1`.
 *
 * `candidatos/by-document/{doc}?full=1` devuelve al candidato DENTRO de un
 * sobre (`{candidato:{…}, contacto:{…}, entrevistas:[…]}`) y la aplicación
 * entera lo lee en la raíz. Cuando esto se rompió, la ficha decía "Sin nombre
 * registrado", el documento salía "CC · —" y firmar o subir la cédula
 * respondía "busca primero a la persona" con la persona en pantalla. Nada
 * fallaba: los campos simplemente no estaban donde se los buscaba.
 */
describe('RegistroProcesoContratacion · sobre de by-document', () => {
  let srv: RegistroProcesoContratacion;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        RegistroProcesoContratacion,
      ],
    });
    srv = TestBed.inject(RegistroProcesoContratacion);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sube los datos de la persona a la raíz y conserva las relaciones', (done) => {
    srv.getCandidatoPorDocumento('1122415324', true).subscribe((c: any) => {
      expect(c.numero_documento).toBe('1122415324');
      expect(c.tipo_doc).toBe('CC');
      expect(c.primer_nombre).toBe('IVAN');
      // Las relaciones se quedan donde estaban…
      expect(c.contacto.email).toBe('correo@ejemplo.com');
      expect(c.entrevistas.length).toBe(1);
      // …y el sobre sigue accesible para quien ya lo leyera anidado.
      expect(c.candidato.numero_documento).toBe('1122415324');
      done();
    });

    const req = http.expectOne(
      (r) => r.url === `${BASE}/candidatos/by-document/1122415324/`,
    );
    req.flush({
      candidato: {
        id: 110626,
        tipo_doc: 'CC',
        numero_documento: '1122415324',
        primer_nombre: 'IVAN',
      },
      contacto: { email: 'correo@ejemplo.com' },
      entrevistas: [{ id: 1, proceso: null }],
    });
  });

  it('una relación del sobre NO puede quedar pisada por el candidato', (done) => {
    srv.getCandidatoPorDocumento('123', true).subscribe((c: any) => {
      expect(c.contacto.email).toBe('el-de-la-raiz@ejemplo.com');
      done();
    });

    const req = http.expectOne(
      (r) => r.url === `${BASE}/candidatos/by-document/123/`,
    );
    req.flush({
      candidato: { numero_documento: '123', contacto: { email: 'viejo@ejemplo.com' } },
      contacto: { email: 'el-de-la-raiz@ejemplo.com' },
    });
  });

  it('sin ?full=1 el candidato ya viene plano y no se toca', (done) => {
    srv.getCandidatoPorDocumento('123').subscribe((c: any) => {
      expect(c.numero_documento).toBe('123');
      expect(c.candidato).toBeUndefined();
      done();
    });

    const req = http.expectOne(
      (r) => r.url === `${BASE}/candidatos/by-document/123/`,
    );
    expect(req.request.params.get('full')).toBeNull();
    req.flush({ id: 1, numero_documento: '123', tipo_doc: 'CC' });
  });
});

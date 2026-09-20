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

/**
 * EL GUARDADO REEMPLAZA LAS LISTAS.
 *
 * `formaciones`, `experiencias` e `hijos` se borran y se recrean en el backend
 * cuando llegan no vacías. Todo lo que el formulario no mande en esas listas se
 * pierde, y así se estuvo borrando en cada entrevista guardada la institución,
 * el título, el año y el nivel de educación superior que la persona había
 * diligenciado en el formulario de la vacante.
 */
describe('RegistroProcesoContratacion · el upsert no puede vaciar lo que no edita', () => {
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

  /**
   * Manda el formulario y devuelve el cuerpo que salió por HTTP.
   *
   * Es un PATCH, y el servicio pasa todo el payload por MAYÚSCULAS SIN TILDES
   * antes de mandarlo: las expectativas de abajo comparan contra eso.
   */
  function enviar(form: any): any {
    srv.upsertCandidatoByDocumentoFromForm(form).subscribe({ error: () => undefined });
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url.includes('by-document-upsert'));
    const body = req.request.body;
    req.flush({ ok: true });
    return body;
  }

  const base = { tipo_doc: 'CC', numero_documento: '1122415324' };

  it('la formación viaja completa, no solo el nivel', () => {
    const body = enviar({
      ...base,
      nivel: 'OTROS',
      estudiosExtra: 'TECNÓLOGO',
      tituloObtenido: 'GESTIÓN AGROPECUARIA',
      institucionEstudio: 'SENA',
      anioFinalizacion: 2021,
    });

    expect(body.formaciones.length).toBe(1);
    expect(body.formaciones[0]).toEqual(jasmine.objectContaining({
      nivel: 'OTROS',
      estudios_extra: 'TECNOLOGO',
      titulo_obtenido: 'GESTION AGROPECUARIA',
      institucion: 'SENA',
      anio_finalizacion: 2021,
    }));
  });

  it('un año vacío no viaja como 0 ni como NaN', () => {
    const body = enviar({ ...base, nivel: '11', anioFinalizacion: '' });
    expect(body.formaciones[0].anio_finalizacion).toBeNull();
  });

  it('sin nivel no se manda la lista: así el backend no borra la que ya hay', () => {
    const body = enviar({ ...base, nivel: '' });
    expect(body.formaciones).toBeUndefined();
  });

  it('cada empresa viaja con los datos que la entrevista no edita', () => {
    const body = enviar({
      ...base,
      experiencias: [{
        empresa: 'FLORES SÁGARO',
        telefonos: '6015551234',
        direccion: 'KM 3 VIA CHIA',
        barrio: 'LA BALSA',
        nombre_jefe: 'PEDRO PEREZ',
        cargo: 'OPERARIO',
        fecha_retiro: '2025-11-30',
        motivo_retiro: 'RENUNCIA',
        tiempo_trabajado: '2 AÑOS',
      }],
    });

    expect(body.experiencias[0]).toEqual(jasmine.objectContaining({
      empresa: 'FLORES SAGARO',
      telefonos: '6015551234',
      direccion: 'KM 3 VIA CHIA',
      barrio: 'LA BALSA',
      nombre_jefe: 'PEDRO PEREZ',
      cargo: 'OPERARIO',
      fecha_retiro: '2025-11-30',
      motivo_retiro: 'RENUNCIA',
    }));
  });

  it('flores y experiencia laboral son dos preguntas, no una', () => {
    // Tiene experiencia laboral pero NO en flores: antes las dos compartían
    // `tiene_experiencia` y quedaba marcado como florista.
    const body = enviar({ ...base, experienciaLaboral: 'SI', experienciaFlores: 'No' });
    expect(body.experiencia_resumen.tiene_experiencia).toBeTrue();
    expect(body.entrevistas[0].cuenta_experiencia_flores).toBe('NO');
  });

  it('el tipo de experiencia en flores va a su columna, no a la de áreas', () => {
    const body = enviar({
      ...base,
      experienciaFlores: 'Sí',
      tipoExperienciaFlores: 'CULTIVO',
      areaExperiencia: ['CORTE', 'CLASIFICACION'],
    });
    expect(body.entrevistas[0].tipo_experiencia_flores).toBe('CULTIVO');
    expect(body.experiencia_resumen.area_experiencia).toBe('CORTE, CLASIFICACION');
  });
});

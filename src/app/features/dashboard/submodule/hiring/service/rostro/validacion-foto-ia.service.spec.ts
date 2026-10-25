import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '@/environments/environment';

import {
  IA_NO_DISPONIBLE, ValidacionFotoIa, ValidacionFotoIaService, normalizarValidacion,
} from './validacion-foto-ia.service';

const URL = `${environment.apiUrl}/gestion_contratacion/biometria/foto/validar`;

/**
 * La regla de oro: la IA puede decir "no sirve", pero si NO contesta —o
 * contesta algo que no se entiende— la foto se puede usar igual. Una IA caída
 * no puede dejar a nadie sin foto.
 */
describe('normalizarValidacion', () => {
  it('respuesta completa y apta', () => {
    const r = normalizarValidacion({
      disponible: true, apta: true, puntaje: 91.6, motivos: [],
      checks: { un_rostro: true, fondo_blanco: true, raro: 'x' }, modelo: 'deepseek-flash',
    });
    expect(r.disponible).toBeTrue();
    expect(r.apta).toBeTrue();
    expect(r.puntaje).toBe(92);
    expect(r.checks).toEqual({ un_rostro: true, fondo_blanco: true });
    expect(r.modelo).toBe('deepseek-flash');
  });

  it('rechazada conserva los motivos, y si no trae ninguno pone uno', () => {
    expect(normalizarValidacion({ disponible: true, apta: false, motivos: ['  Fondo con sombras ', ''] }).motivos)
      .toEqual(['Fondo con sombras']);
    expect(normalizarValidacion({ disponible: true, apta: false, motivos: [] }).motivos.length).toBe(1);
  });

  it('lo que no se entiende es "no disponible", nunca "rechazada"', () => {
    expect(normalizarValidacion(null)).toEqual(IA_NO_DISPONIBLE);
    expect(normalizarValidacion('texto')).toEqual(IA_NO_DISPONIBLE);
    expect(normalizarValidacion({ disponible: false, apta: null, motivos: [], checks: {} })).toEqual(IA_NO_DISPONIBLE);
    expect(normalizarValidacion({ disponible: true, apta: 'si' })).toEqual(IA_NO_DISPONIBLE);
    // La respuesta simulada de la cola offline.
    expect(normalizarValidacion({ _isOfflineMock: true, disponible: true, apta: true })).toEqual(IA_NO_DISPONIBLE);
  });
});

describe('ValidacionFotoIaService', () => {
  let svc: ValidacionFotoIaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ValidacionFotoIaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('manda la imagen con origen TESORO y la cédula, fuera de la cola offline', () => {
    let r: ValidacionFotoIa | undefined;
    svc.validar('data:image/jpeg;base64,AAAA', 'X9999001').subscribe((v) => (r = v));

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ imagen: 'data:image/jpeg;base64,AAAA', origen: 'TESORO', numero_documento: 'X9999001' });
    expect(req.request.headers.get('X-Offline-Sync')).toBe('true');
    req.flush({ disponible: true, apta: false, puntaje: 40, motivos: ['El fondo debe quedar blanco y uniforme'], checks: { fondo_blanco: false } });

    expect(r?.apta).toBeFalse();
    expect(r?.motivos).toEqual(['El fondo debe quedar blanco y uniforme']);
  });

  it('un error del servidor se convierte en "no disponible"', () => {
    let r: ValidacionFotoIa | undefined;
    svc.validar('data:image/jpeg;base64,AAAA').subscribe((v) => (r = v));
    http.expectOne(URL).flush({ error: 'x' }, { status: 429, statusText: 'Too Many Requests' });
    expect(r).toEqual(IA_NO_DISPONIBLE);
  });
});

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { environment } from '@/environments/environment';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { CedulaCamaraService, FalloCedulaCamara } from './cedula-camara.service';
import { PasoCedula } from './cedula-camara.util';

describe('CedulaCamaraService', () => {
  let svc: CedulaCamaraService;
  let http: HttpTestingController;
  let docs: jasmine.SpyObj<GestionDocumentalService>;

  const url = `${environment.apiUrl}/gestion_documental/documentosPruebas/`;
  const jpg = (n: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], n, { type: 'image/jpeg' });
  const caras = () => ({ frente: jpg('cedula_frente.jpg'), reverso: jpg('cedula_reverso.jpg') });

  /** Deja pasar las microtareas entre `await`s. */
  const vaciar = () => new Promise(r => setTimeout(r, 0));

  beforeEach(() => {
    docs = jasmine.createSpyObj('GestionDocumentalService', ['armarCedulaAmpliada', 'invalidarDocumentos']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: GestionDocumentalService, useValue: docs },
      ],
    });
    svc = TestBed.inject(CedulaCamaraService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sube frente y luego reverso con el typeName de cada cara, y pide la hoja al 150 %', async () => {
    docs.armarCedulaAmpliada.and.returnValue(of({ estado: 'YA_ESTABA', id: 555 }));
    const pasos: PasoCedula[] = [];
    const p = svc.subirYArmar(' X9999001 ', caras(), (x) => pasos.push(x));

    const r1 = http.expectOne(url);
    expect(r1.request.method).toBe('POST');
    const f1 = r1.request.body as FormData;
    expect(f1.get('owner_id')).toBe('X9999001');
    expect(f1.get('typeName')).toBe('DOCUMENTO_IDENTIDAD_FRENTE');
    expect((f1.get('file') as File).name).toBe('cedula_frente.jpg');
    r1.flush({ ok: true, documentId: 1 }, { status: 201, statusText: 'Created' });
    await vaciar();

    const r2 = http.expectOne(url);
    expect((r2.request.body as FormData).get('typeName')).toBe('DOCUMENTO_IDENTIDAD_REVERSO');
    r2.flush({ ok: true, documentId: 2 }, { status: 201, statusText: 'Created' });

    const armada = await p;
    expect(docs.armarCedulaAmpliada).toHaveBeenCalledWith('X9999001');
    expect(docs.invalidarDocumentos).toHaveBeenCalledWith('X9999001');
    expect(armada).toEqual({ cedula: 'X9999001', id: 555, estado: 'YA_ESTABA' });
    expect(svc.ultimaArmada()).toEqual(armada);
    expect(pasos).toEqual(['frente', 'reverso', 'armando']);
  });

  it('si falla el frente no sube el reverso ni arma nada', async () => {
    const p = svc.subirYArmar('123', caras());
    http.expectOne(url).flush({ error: 'x' }, { status: 500, statusText: 'Error' });

    await expectAsync(p).toBeRejectedWith(jasmine.objectContaining({ paso: 'frente' }));
    http.expectNone(url);
    expect(docs.armarCedulaAmpliada).not.toHaveBeenCalled();
    expect(svc.ultimaArmada()).toBeNull();
  });

  it('si el servidor no ve las dos caras (SIN_CARAS) falla en el paso de armado', async () => {
    docs.armarCedulaAmpliada.and.returnValue(of({ estado: 'SIN_CARAS', id: null }));
    const p = svc.subirYArmar('123', caras());
    http.expectOne(url).flush({ ok: true, documentId: 1 });
    await vaciar();
    http.expectOne(url).flush({ ok: true, documentId: 2 });

    const err = await p.then(() => null, (e) => e);
    expect(err instanceof FalloCedulaCamara).toBeTrue();
    expect(err.paso).toBe('armando');
    expect(svc.ultimaArmada()).toBeNull();
  });

  it('un error de red al armar también se reporta en el paso de armado', async () => {
    docs.armarCedulaAmpliada.and.returnValue(throwError(() => ({ status: 500 })));
    const p = svc.subirYArmar('123', caras());
    http.expectOne(url).flush({ ok: true });
    await vaciar();
    http.expectOne(url).flush({ ok: true });

    await expectAsync(p).toBeRejectedWith(jasmine.objectContaining({ paso: 'armando' }));
  });

  it('sin documento no sube nada', async () => {
    await expectAsync(svc.subirYArmar('  ', caras())).toBeRejected();
    http.expectNone(url);
  });
});

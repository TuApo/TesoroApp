import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { GestionDocumentalService } from './gestion-documental.service';

describe('GestionDocumentalService · expediente por cédula', () => {
  let svc: GestionDocumentalService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(GestionDocumentalService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const pedir = (owner: string) =>
    http.expectOne((r) => r.url.endsWith('/gestion_documental/documentos/') && r.params.get('cedula') === owner);

  it('sigue la regla de make_owner_id', () => {
    expect(GestionDocumentalService.tipoConPrefijo('PET')).toBeTrue();
    expect(GestionDocumentalService.tipoConPrefijo('P.P.T')).toBeTrue();
    expect(GestionDocumentalService.tipoConPrefijo('CE')).toBeTrue();
    expect(GestionDocumentalService.tipoConPrefijo('CC')).toBeFalse();
    expect(GestionDocumentalService.tipoConPrefijo('C.C.')).toBeFalse();
    expect(GestionDocumentalService.tipoConPrefijo(null)).toBeFalse();
  });

  it('CC: solo la cédula pelada', () => {
    let out: any[] = [];
    svc.getDocumentosDeCandidato('9000446', { tipoDoc: 'CC' }).subscribe((r) => (out = r));
    pedir('9000446').flush([{ id: 1, type: 7 }]);
    expect(out.map((d) => d.id)).toEqual([1]);
  });

  it('PET: junta la cédula pelada y la de prefijo x, del más nuevo al más viejo', () => {
    let out: any[] = [];
    svc.getDocumentosDeCandidato('9000446', { tipoDoc: 'PET' }).subscribe((r) => (out = r));
    pedir('9000446').flush([{ id: 10, type: 4 }]);
    pedir('x9000446').flush([{ id: 30, type: 5 }, { id: 20, type: 7 }]);
    expect(out.map((d) => d.id)).toEqual([30, 20, 10]);
  });

  it('un 404 en una de las dos llaves es expediente vacío, no error', () => {
    let out: any[] | null = null;
    svc.getDocumentosDeCandidato('9000446', { tipoDoc: 'PPT' }).subscribe((r) => (out = r));
    pedir('9000446').flush('no', { status: 404, statusText: 'Not Found' });
    pedir('x9000446').flush([{ id: 5, type: 8 }]);
    expect(out!.map((d: any) => d.id)).toEqual([5]);
  });
});

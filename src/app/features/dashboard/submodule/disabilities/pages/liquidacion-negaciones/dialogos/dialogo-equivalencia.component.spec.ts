import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';
import { causalNegacion, equivalenciaCausal } from '../../liquidacion/liquidacion.fixtures.spec-helper';
import { DatosDialogoEquivalencia, DialogoEquivalenciaComponent } from './dialogo-equivalencia.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

const CAUSALES = [
  causalNegacion(),
  causalNegacion({ id: 3, codigo: 'SIN_AFILIACION', nombre: 'Sin afiliacion', accion: 'RECOBRO' }),
  causalNegacion({ id: 9, codigo: 'VIEJA', nombre: 'Vieja', accion: 'RECOBRO', activo: false }),
];

describe('DialogoEquivalenciaComponent', () => {
  let httpMock: HttpTestingController;
  let refFalso: { close: jasmine.Spy };
  /** MAT_DIALOG_DATA se resuelve al crear el dialogo: cada prueba pone aqui sus datos. */
  let datosActuales: DatosDialogoEquivalencia;

  const crear = (datos: Partial<DatosDialogoEquivalencia>) => {
    datosActuales = { modo: 'crear', causales: CAUSALES, epsOpciones: ['NUEVA EPS'], ...datos };
    const fixture = TestBed.createComponent(DialogoEquivalenciaComponent);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    refFalso = { close: jasmine.createSpy('close') };
    await TestBed.configureTestingModule({
      imports: [DialogoEquivalenciaComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useFactory: () => datosActuales },
        { provide: MatDialogRef, useValue: refFalso },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('homologar: propone la EPS de la negacion, reaplica siempre y devuelve el resultado', () => {
    const fixture = crear({ modo: 'homologar', textoExterno: 'Causal 51', eps: 'NUEVA EPS' });
    const c = fixture.componentInstance;
    expect(c.alcance()).toBe('EPS');
    expect(c.eps()).toBe('NUEVA EPS');
    // Las inactivas no se ofrecen.
    expect(c.causalesOfrecidas().map((x) => x.id)).toEqual([1, 3]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Causal 51');

    c.causalId.set(3);
    c.reaplicar.set(false); // en 'homologar' se ignora: siempre reaplica
    c.guardar();
    const req = httpMock.expectOne(`${BASE}/liquidacion/equivalencias`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(jasmine.objectContaining({ causalId: 3, eps: 'NUEVA EPS', textoExterno: 'Causal 51', reaplicar: true }));
    const resultado = { equivalencia: equivalenciaCausal(), negacionesActualizadas: 4, incapacidadesRecalculadas: 3 };
    req.flush(resultado);
    expect(refFalso.close).toHaveBeenCalledOnceWith({ tipo: 'creada', resultado });
  });

  it('"Todas las EPS" manda el comodin * y un 409 deja el dialogo abierto con el mensaje', () => {
    const fixture = crear({ modo: 'crear' });
    const c = fixture.componentInstance;
    expect(c.alcance()).toBe('TODAS');
    c.textoExterno.set('NO CUMPLE 4 SEMANAS');
    c.causalId.set(1);
    c.guardar();
    const req = httpMock.expectOne(`${BASE}/liquidacion/equivalencias`);
    expect(req.request.body.eps).toBe('*');
    expect(req.request.body.reaplicar).toBeTrue();
    req.flush({ error: 'Ya existe una equivalencia para ese texto' }, { status: 409, statusText: 'Conflict' });
    expect(refFalso.close).not.toHaveBeenCalled();
    expect(c.error()).toBe('Ya existe una equivalencia para ese texto');
  });

  it('valida texto, EPS y causal antes de llamar al backend', () => {
    const c = crear({ modo: 'crear' }).componentInstance;
    c.guardar();
    expect(c.error()).toContain('texto');
    c.textoExterno.set('Causal 51');
    c.alcance.set('EPS');
    c.guardar();
    expect(c.error()).toContain('EPS');
    c.eps.set('NUEVA EPS');
    c.guardar();
    expect(c.error()).toContain('causal');
    httpMock.expectNone(`${BASE}/liquidacion/equivalencias`);
  });

  it('editar hace PUT con activo y ofrece la causal actual aunque este inactiva', () => {
    const c = crear({ modo: 'editar', equivalencia: equivalenciaCausal({ causalId: 9, activo: true }) }).componentInstance;
    expect(c.causalesOfrecidas().map((x) => x.id)).toEqual([1, 3, 9]);
    c.activo.set(false);
    c.causalId.set(3);
    c.guardar();
    const req = httpMock.expectOne(`${BASE}/liquidacion/equivalencias/30`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ causalId: 3, eps: 'NUEVA EPS', textoExterno: 'Causal 51', activo: false });
    const editada = equivalenciaCausal({ causalId: 3, activo: false });
    req.flush(editada);
    expect(refFalso.close).toHaveBeenCalledOnceWith({ tipo: 'editada', equivalencia: editada });
  });
});

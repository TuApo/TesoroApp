import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';

import { environment } from '@/environments/environment';
import { recobroPrueba, resultadoPrueba, swalEspiable } from '../../radicacion/radicacion.datos-prueba';
import type { DatosRadicado } from '../../radicacion/radicacion.utils';
import { DatosDialogoRegistrarRecobro, DialogoRegistrarRecobroComponent } from './dialogo-registrar-recobro.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

const DATOS_DIALOGO: DatosDialogoRegistrarRecobro = {
  items: [
    recobroPrueba({}, { id: 41, codigoOficina: 'TASB041', nombreCompleto: 'RUIZ ANA' }),
    recobroPrueba({}, { id: 42, codigoOficina: 'TASB042', nombreCompleto: 'DIAZ LUIS' }),
  ],
};

const RADICADO: DatosRadicado = {
  numeroRadicado: 'PQR-2026-9',
  fechaRadicado: '2026-10-05',
  dondeRadicado: 'CORREO',
  observaciones: 'Se adjunta planilla PILA',
};

describe('DialogoRegistrarRecobroComponent', () => {
  let fixture: ComponentFixture<DialogoRegistrarRecobroComponent>;
  let componente: DialogoRegistrarRecobroComponent;
  let httpMock: HttpTestingController;
  let refFalso: { close: jasmine.Spy; disableClose: boolean; backdropClick: () => Subject<MouseEvent>; keydownEvents: () => Subject<KeyboardEvent> };
  let fondo: Subject<MouseEvent>;

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    fondo = new Subject<MouseEvent>();
    const teclas = new Subject<KeyboardEvent>();
    refFalso = { close: jasmine.createSpy('close'), disableClose: false, backdropClick: () => fondo, keydownEvents: () => teclas };

    await TestBed.configureTestingModule({
      imports: [DialogoRegistrarRecobroComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: DATOS_DIALOGO },
        { provide: MatDialogRef, useValue: refFalso },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogoRegistrarRecobroComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  it('lista las incapacidades marcadas con su causal', () => {
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('TASB041');
    expect(texto).toContain('DIAZ LUIS');
    expect(texto).toContain('NO SE EVIDENCIA PAGO DE SEGURIDAD SOCIAL');
    expect(texto).toContain('Registrar recobro (2)');
    expect(refFalso.disableClose).toBeTrue();
  });

  it('confirma y registra el mismo radicado de recobro para todas', async () => {
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
    await componente.guardar(RADICADO);
    const req = httpMock.expectOne(`${BASE}/recobros`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(
      jasmine.objectContaining({
        incapacidadIds: [41, 42],
        numeroRadicado: 'PQR-2026-9',
        fechaRadicado: '2026-10-05',
        dondeRadicado: 'CORREO',
        observaciones: 'Se adjunta planilla PILA',
      }),
    );
    req.flush(resultadoPrueba([{ id: 41, ok: true }, { id: 42, ok: true }]));
    expect(componente.items().length).toBe(0);
    expect(componente.resultado()?.exitosos).toBe(2);

    componente.cerrar();
    expect(refFalso.close).toHaveBeenCalledWith({ recargar: true });
  });

  it('las que fallan se quedan en el dialogo con su motivo', async () => {
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
    await componente.guardar(RADICADO);
    httpMock.expectOne(`${BASE}/recobros`).flush(
      resultadoPrueba([{ id: 41, ok: true }, { id: 42, ok: false, mensaje: 'No tiene radicado inicial' }]),
    );
    expect(componente.items().map((i) => i.incapacidad.id)).toEqual([42]);
    expect(componente.errores().get(42)).toBe('No tiene radicado inicial');
  });

  it('cancelar la confirmacion no escribe; cerrar sin guardar no pide recargar', async () => {
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: false }));
    await componente.guardar(RADICADO);
    httpMock.expectNone(`${BASE}/recobros`);
    fondo.next(new MouseEvent('click'));
    expect(refFalso.close).toHaveBeenCalledWith({ recargar: false });
  });

  it('mientras guarda no se cierra (fondo ni boton); al terminar si, y pide recargar', async () => {
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
    await componente.guardar(RADICADO);
    const req = httpMock.expectOne(`${BASE}/recobros`);
    fondo.next(new MouseEvent('click'));
    componente.cerrar();
    expect(refFalso.close).not.toHaveBeenCalled();
    req.flush(resultadoPrueba([{ id: 41, ok: true }, { id: 42, ok: true }]));
    fondo.next(new MouseEvent('click'));
    expect(refFalso.close).toHaveBeenCalledWith({ recargar: true });
  });

  it('sin conexion el recobro queda en cola: avisa y las incapacidades se quedan', async () => {
    const fire = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
    await componente.guardar(RADICADO);
    httpMock.expectOne(`${BASE}/recobros`).flush({ incapacidadIds: [41, 42], id: -7, _isOfflineMock: true });
    expect(() => fixture.detectChanges()).not.toThrow();
    expect((fire.calls.mostRecent().args[0] as { icon: string }).icon).toBe('warning');
    expect(componente.items().length).toBe(2);
    expect(componente.resultado()).toBeNull();
    componente.cerrar();
    expect(refFalso.close).toHaveBeenCalledWith({ recargar: false });
  });

  it('quitar una incapacidad la saca de este registro', () => {
    componente.quitar(DATOS_DIALOGO.items[0]);
    expect(componente.items().map((i) => i.incapacidad.id)).toEqual([42]);
  });
});

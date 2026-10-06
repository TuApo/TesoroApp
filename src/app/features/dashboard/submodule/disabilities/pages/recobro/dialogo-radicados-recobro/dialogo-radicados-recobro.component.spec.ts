import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';

import { environment } from '@/environments/environment';
import { radicadoPrueba, recobroPrueba, swalEspiable } from '../../radicacion/radicacion.datos-prueba';
import { DatosDialogoRadicados, DialogoRadicadosRecobroComponent } from './dialogo-radicados-recobro.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

const DATOS_DIALOGO: DatosDialogoRadicados = {
  item: recobroPrueba({}, { id: 51, codigoOficina: 'TASB051', nombreCompleto: 'RUIZ ANA' }),
};

const RADICADOS = [
  radicadoPrueba({ id: null, incapacidadId: 51, tipo: 'RADICACION', numeroRadicado: 'RAD-INICIAL', fechaRadicado: '2026-02-10' }),
  radicadoPrueba({ id: 80, incapacidadId: 51, tipo: 'RECOBRO', numeroRadicado: 'PQR-1', fechaRadicado: '2026-03-05', dondeRadicado: 'CORREO' }),
  radicadoPrueba({ id: 81, incapacidadId: 51, tipo: 'RECOBRO', numeroRadicado: 'PQR-2', fechaRadicado: '2026-04-01' }),
];

describe('DialogoRadicadosRecobroComponent', () => {
  let fixture: ComponentFixture<DialogoRadicadosRecobroComponent>;
  let componente: DialogoRadicadosRecobroComponent;
  let httpMock: HttpTestingController;
  let refFalso: { close: jasmine.Spy; disableClose: boolean; backdropClick: () => Subject<MouseEvent>; keydownEvents: () => Subject<KeyboardEvent> };
  let teclas: Subject<KeyboardEvent>;

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    teclas = new Subject<KeyboardEvent>();
    const fondo = new Subject<MouseEvent>();
    refFalso = { close: jasmine.createSpy('close'), disableClose: false, backdropClick: () => fondo, keydownEvents: () => teclas };

    await TestBed.configureTestingModule({
      imports: [DialogoRadicadosRecobroComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: DATOS_DIALOGO },
        { provide: MatDialogRef, useValue: refFalso },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogoRadicadosRecobroComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  it('carga TODOS los radicados de la incapacidad con su fecha, del mas viejo al mas nuevo', () => {
    httpMock.expectOne(`${BASE}/51/radicados`).flush(RADICADOS);
    fixture.detectChanges();
    expect(componente.lineas().map((l) => l.rotulo)).toEqual(['Radicación inicial', 'Recobro 1', 'Recobro 2']);
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('RAD-INICIAL');
    expect(texto).toContain('PQR-2');
    expect(texto).toContain('05/03/2026');
    expect(texto).toContain('Correo');
    expect(texto).toContain('NO SE EVIDENCIA PAGO DE SEGURIDAD SOCIAL');
  });

  it('solo se anulan recobros con id (el inicial se corrige volviendo a radicar)', () => {
    httpMock.expectOne(`${BASE}/51/radicados`).flush(RADICADOS);
    expect(componente.puedeAnular(RADICADOS[0])).toBeFalse();
    expect(componente.puedeAnular(radicadoPrueba({ id: 9, tipo: 'RADICACION' }))).toBeFalse();
    expect(componente.puedeAnular(RADICADOS[1])).toBeTrue();
    expect(componente.puedeAnular({ ...RADICADOS[1], anulado: true })).toBeFalse();
  });

  it('anular confirma con motivo, recarga la lista y al cerrar pide recargar la bandeja', async () => {
    httpMock.expectOne(`${BASE}/51/radicados`).flush(RADICADOS);
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true, value: '  numero mal digitado ' }));

    await componente.anular(RADICADOS[2]);
    const req = httpMock.expectOne(`${BASE}/radicados/81/anular`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(jasmine.objectContaining({ motivo: 'numero mal digitado' }));
    req.flush({ ...RADICADOS[2], anulado: true });

    httpMock.expectOne(`${BASE}/51/radicados`).flush([RADICADOS[0], RADICADOS[1], { ...RADICADOS[2], anulado: true }]);
    expect(componente.vigentes()).toBe(2);
    expect(componente.lineas()[2].rotulo).toBe('Recobro anulado');

    teclas.next(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(refFalso.close).toHaveBeenCalledWith({ recargar: true });
  });

  it('si no confirma no anula; cerrar sin cambios no pide recargar', async () => {
    httpMock.expectOne(`${BASE}/51/radicados`).flush(RADICADOS);
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: false }));
    await componente.anular(RADICADOS[1]);
    httpMock.expectNone(`${BASE}/radicados/80/anular`);
    componente.cerrar();
    expect(refFalso.close).toHaveBeenCalledWith({ recargar: false });
  });

  it('con una anulacion en vuelo no se cierra; si queda en la cola offline avisa y no pide recargar', async () => {
    httpMock.expectOne(`${BASE}/51/radicados`).flush(RADICADOS);
    const fire = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true, value: '' }));
    await componente.anular(RADICADOS[2]);
    const req = httpMock.expectOne(`${BASE}/radicados/81/anular`);
    componente.cerrar();
    expect(refFalso.close).not.toHaveBeenCalled();
    req.flush({ motivo: null, id: -9, _isOfflineMock: true });
    // No llego al servidor: no se recarga la linea de tiempo ni se avisa a la bandeja.
    httpMock.expectNone(`${BASE}/51/radicados`);
    expect((fire.calls.mostRecent().args[0] as { icon: string }).icon).toBe('warning');
    componente.cerrar();
    expect(refFalso.close).toHaveBeenCalledWith({ recargar: false });
  });

  it('un error al cargar se muestra con opcion de reintentar', () => {
    httpMock.expectOne(`${BASE}/51/radicados`).flush({ error: 'No encontrada' }, { status: 404, statusText: 'Not Found' });
    expect(componente.error()).toBe('No encontrada');
    componente.cargar();
    httpMock.expectOne(`${BASE}/51/radicados`).flush([]);
    expect(componente.error()).toBe('');
  });
});

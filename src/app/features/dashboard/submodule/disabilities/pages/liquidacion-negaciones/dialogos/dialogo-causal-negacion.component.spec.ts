import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';
import { causalNegacion } from '../../liquidacion/liquidacion.fixtures.spec-helper';
import {
  DatosDialogoCausal,
  DialogoCausalNegacionComponent,
  codigoDesdeNombre,
} from './dialogo-causal-negacion.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

describe('DialogoCausalNegacionComponent', () => {
  let httpMock: HttpTestingController;
  let refFalso: { close: jasmine.Spy };
  let datosActuales: DatosDialogoCausal;

  const crear = (datos: DatosDialogoCausal) => {
    datosActuales = datos;
    const fixture = TestBed.createComponent(DialogoCausalNegacionComponent);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    refFalso = { close: jasmine.createSpy('close') };
    await TestBed.configureTestingModule({
      imports: [DialogoCausalNegacionComponent],
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

  it('sugiere el codigo desde el nombre (sin tildes ni signos)', () => {
    expect(codigoDesdeNombre('Cotizante no registrado / sin afiliación')).toBe('COTIZANTE_NO_REGISTRADO_SIN_AFILIACION');
    const c = crear({ causal: null, ordenSugerido: 6 }).componentInstance;
    c.cambiarNombre('Incapacidad incompleta');
    expect(c.codigo()).toBe('INCAPACIDAD_INCOMPLETA');
    // Si el usuario toca el codigo, ya no se pisa.
    c.cambiarCodigo('inc_incompleta');
    c.cambiarNombre('Otra cosa');
    expect(c.codigo()).toBe('INC_INCOMPLETA');
  });

  it('avisa si se marca FINALIZA una causal distinta de las dos de la reunion', () => {
    const fixture = crear({ causal: null });
    const c = fixture.componentInstance;
    c.cambiarNombre('Sin afiliacion');
    c.accion.set('FINALIZA');
    fixture.detectChanges();
    expect(c.avisoFinaliza()).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('deberían finalizar');

    c.cambiarCodigo('SIN_APORTES_4_SEMANAS');
    expect(c.avisoFinaliza()).toBeFalse();
  });

  it('crea con POST y cierra devolviendo la causal guardada', () => {
    const c = crear({ causal: null, ordenSugerido: 6 }).componentInstance;
    c.cambiarNombre('Incapacidad incompleta');
    c.terminacion.set('  ');
    c.guardar();
    const req = httpMock.expectOne(`${BASE}/liquidacion/causales`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      codigo: 'INCAPACIDAD_INCOMPLETA', nombre: 'Incapacidad incompleta', accion: 'RECOBRO', terminacion: null, orden: 6, activo: true,
    });
    const guardada = causalNegacion({ id: 7, codigo: 'INCAPACIDAD_INCOMPLETA', accion: 'RECOBRO' });
    req.flush(guardada);
    expect(refFalso.close).toHaveBeenCalledOnceWith(guardada);
  });

  it('edita con PUT, avisa del cambio de accion y muestra el 409 sin cerrar', () => {
    const fixture = crear({ causal: causalNegacion({ id: 3, codigo: 'SIN_AFILIACION', accion: 'RECOBRO', terminacion: null }) });
    const c = fixture.componentInstance;
    c.accion.set('FINALIZA');
    expect(c.cambiaAccion()).toBeTrue();
    c.guardar();
    const req = httpMock.expectOne(`${BASE}/liquidacion/causales/3`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.accion).toBe('FINALIZA');
    req.flush({ error: 'Ya existe una causal con ese codigo' }, { status: 409, statusText: 'Conflict' });
    expect(refFalso.close).not.toHaveBeenCalled();
    expect(c.error()).toBe('Ya existe una causal con ese codigo');
  });

  it('no llama al backend con un codigo invalido', () => {
    const c = crear({ causal: null }).componentInstance;
    c.cambiarNombre('Algo');
    c.codigo.set('CON ESPACIO');
    c.guardar();
    expect(c.error()).toContain('código');
    httpMock.expectNone(`${BASE}/liquidacion/causales`);
  });
});

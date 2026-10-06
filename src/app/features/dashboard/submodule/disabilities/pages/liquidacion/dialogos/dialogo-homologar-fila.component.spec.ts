import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { causalNegacion, filaLiquidacion } from '../liquidacion.fixtures.spec-helper';
import { DatosDialogoHomologarFila, DialogoHomologarFilaComponent } from './dialogo-homologar-fila.component';

describe('DialogoHomologarFilaComponent', () => {
  let refFalso: { close: jasmine.Spy };
  const datos: DatosDialogoHomologarFila = {
    fila: filaLiquidacion({ id: 5, hoja: 'NEGACIONES', eps: 'NUEVA EPS', causalTexto: 'Causal 51', sinHomologar: true, fechaRespuesta: '2026-09-11' }),
    causales: [
      causalNegacion(),
      causalNegacion({ id: 3, codigo: 'SIN_AFILIACION', nombre: 'Sin afiliacion', accion: 'RECOBRO', terminacion: null }),
    ],
  };

  beforeEach(async () => {
    refFalso = { close: jasmine.createSpy('close') };
    await TestBed.configureTestingModule({
      imports: [DialogoHomologarFilaComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: datos },
        { provide: MatDialogRef, useValue: refFalso },
      ],
    }).compileComponents();
  });

  it('muestra el texto de la EPS y el efecto de la causal elegida', () => {
    const fixture = TestBed.createComponent(DialogoHomologarFilaComponent);
    const c = fixture.componentInstance;
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Causal 51');
    expect(texto).toContain('11/09/2026');

    c.causalId.set(1);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('quedará finalizada como «FINALIZADO NEGADO 1 Y 2 DIAS»');
    c.causalId.set(3);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('pasará a Recobro');
  });

  it('devuelve la causal y si se recuerda para la EPS (por defecto si)', () => {
    const c = TestBed.createComponent(DialogoHomologarFilaComponent).componentInstance;
    c.confirmar();
    expect(refFalso.close).not.toHaveBeenCalled();
    c.causalId.set(3);
    c.confirmar();
    expect(refFalso.close).toHaveBeenCalledOnceWith({ causalId: 3, recordar: true });
    c.recordar.set(false);
    c.confirmar();
    expect(refFalso.close).toHaveBeenCalledWith({ causalId: 3, recordar: false });
  });

  it('al CAMBIAR la causal de una fila ya homologada no recuerda por defecto (no re-apunta la equivalencia)', () => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, {
      useValue: { ...datos, fila: { ...datos.fila, sinHomologar: false, causalId: 1, accion: 'FINALIZA' } },
    });
    const c = TestBed.createComponent(DialogoHomologarFilaComponent).componentInstance;
    expect(c.recordar()).toBeFalse();
    c.causalId.set(3);
    c.confirmar();
    expect(refFalso.close).toHaveBeenCalledOnceWith({ causalId: 3, recordar: false });
  });

  it('sin texto de causal no se puede recordar (ms-hr responde 400)', () => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { ...datos, fila: { ...datos.fila, causalTexto: '  ' } } });
    const fixture = TestBed.createComponent(DialogoHomologarFilaComponent);
    const c = fixture.componentInstance;
    fixture.detectChanges();
    expect(c.recordar()).toBeFalse();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no hay nada que recordar');
    c.recordar.set(true);
    c.causalId.set(3);
    c.confirmar();
    expect(refFalso.close).toHaveBeenCalledOnceWith({ causalId: 3, recordar: false });
  });
});

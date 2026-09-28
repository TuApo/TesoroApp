import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';

import { DialogoInformeUmbralComponent } from './dialogo-informe-umbral.component';

const URL_UMBRALES = `${environment.apiUrl}/Incapacidades/v2/informes/umbrales`;

/**
 * El dialogo es solo el envoltorio del panel de umbrales (revision 2026-09-28): la logica y sus
 * pruebas viven en `panel-umbrales.component.spec.ts` y `utils/umbrales.spec.ts`.
 */
describe('DialogoInformeUmbralComponent', () => {
  let fixture: ComponentFixture<DialogoInformeUmbralComponent>;
  let httpMock: HttpTestingController;
  let refFalso: { close: jasmine.Spy };

  beforeEach(async () => {
    refFalso = { close: jasmine.createSpy('close') };
    await TestBed.configureTestingModule({
      imports: [DialogoInformeUmbralComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MatDialogRef, useValue: refFalso },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DialogoInformeUmbralComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  it('monta el panel, que pide el informe de umbrales en el tiempo', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const req = httpMock.expectOne(URL_UMBRALES);
    expect(req.request.method).toBe('GET');
    req.flush({
      fechaCorte: '2026-09-28', umbralFondo: 180, umbralEps: 540, ventanaRecienteDias: 30,
      horizontes: [15, 30, 60, 90], conteos: {}, cadenas: [],
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-panel-umbrales')).not.toBeNull();
    expect(el.textContent).toContain('Umbrales de 180 y 540 días');
  });

  it('cerrar() cierra el dialogo', () => {
    fixture.detectChanges();
    httpMock.expectOne(URL_UMBRALES).flush({
      fechaCorte: '2026-09-28', umbralFondo: 180, umbralEps: 540, ventanaRecienteDias: 30,
      horizontes: [15, 30, 60, 90], conteos: {}, cadenas: [],
    });
    fixture.componentInstance.cerrar();
    expect(refFalso.close).toHaveBeenCalled();
  });
});

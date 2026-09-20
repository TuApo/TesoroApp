import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';

import { ResultadoCargaMasivaRadicados } from '../../../../models/incapacidad-v2.model';
import { DialogoCargaMasivaRadicadosComponent } from './dialogo-carga-masiva-radicados.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;
const URL_CARGA = `${BASE}/radicados/carga-masiva`;

/** Respuesta tipica del backend: 3 filas, 2 radicadas y 1 con error. */
const RESULTADO: ResultadoCargaMasivaRadicados = {
  total: 3,
  exitosos: 2,
  fallidos: 1,
  filas: [
    {
      fila: 2,
      cedula: '1070982591',
      fechaInicio: '12/08/2026',
      numeroRadicado: 'RAD-000123',
      ok: true,
      mensaje: 'Radicado guardado',
      incapacidadId: 55,
    },
    {
      fila: 3,
      cedula: '52123456',
      fechaInicio: '01/08/2026',
      numeroRadicado: 'RAD-000124',
      ok: true,
      mensaje: 'Radicado guardado',
      incapacidadId: 56,
    },
    {
      fila: 4,
      cedula: '900000000',
      fechaInicio: '02/08/2026',
      numeroRadicado: 'RAD-000125',
      ok: false,
      mensaje: 'No existe incapacidad para esa cedula y fecha de inicio',
      incapacidadId: null,
    },
  ],
};

function archivoDePrueba(nombre = 'radicados.xlsx'): File {
  return new File(['contenido'], nombre, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('DialogoCargaMasivaRadicadosComponent', () => {
  let fixture: ComponentFixture<DialogoCargaMasivaRadicadosComponent>;
  let componente: DialogoCargaMasivaRadicadosComponent;
  let httpMock: HttpTestingController;
  let refFalso: { close: jasmine.Spy };

  beforeEach(async () => {
    refFalso = { close: jasmine.createSpy('close') };

    await TestBed.configureTestingModule({
      imports: [DialogoCargaMasivaRadicadosComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: refFalso },
        { provide: MAT_DIALOG_DATA, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogoCargaMasivaRadicadosComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
  });

  afterEach(() => {
    // El constructor NO dispara HTTP: cualquier peticion sin atender es un bug.
    httpMock.verify();
    fixture.destroy();
  });

  /** Elige archivo, procesa y responde el backend con `respuesta`. */
  const procesarConRespuesta = (respuesta: ResultadoCargaMasivaRadicados): void => {
    componente.tomarArchivo(archivoDePrueba());
    fixture.detectChanges();
    componente.procesar();

    const req = httpMock.expectOne(URL_CARGA);
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBeTrue();
    req.flush(respuesta);
    fixture.detectChanges();
  };

  it('se crea sin disparar peticiones HTTP', () => {
    expect(componente).toBeTruthy();
    httpMock.expectNone(URL_CARGA);
  });

  it('al procesar hace POST multipart a /radicados/carga-masiva y pinta los contadores', () => {
    procesarConRespuesta(RESULTADO);

    expect(componente.resultado()).toEqual(RESULTADO);
    expect(componente.procesando()).toBeFalse();

    const contadores = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.cmr-contador-valor',
    );
    expect(contadores.length).toBe(3);
    expect(contadores[0].textContent?.trim()).toBe('3'); // total
    expect(contadores[1].textContent?.trim()).toBe('2'); // exitosos
    expect(contadores[2].textContent?.trim()).toBe('1'); // fallidos

    // La tabla estandar pinta las 3 filas del detalle (como filas o como
    // tarjetas, segun el ancho de la ventana del navegador de pruebas).
    const filas = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'app-tabla-estandar .te-fila, app-tabla-estandar .te-tarjeta',
    );
    expect(filas.length).toBe(3);

    // La fila que no se radico se resalta con la clase de la tabla.
    expect(componente.claseResultado(RESULTADO.filas[2])).toBe('te-fila--peligro');
    expect(componente.claseResultado(RESULTADO.filas[0])).toBe('');
  });

  it('al cerrar tras un procesamiento con exitosos devuelve { recargar: true }', () => {
    procesarConRespuesta(RESULTADO);

    componente.cerrar();

    expect(refFalso.close).toHaveBeenCalledWith({ recargar: true });
  });

  it('al cerrar sin haber radicado nada devuelve { recargar: false }', () => {
    componente.cerrar();

    expect(refFalso.close).toHaveBeenCalledWith({ recargar: false });
  });

  it('rechaza extensiones distintas de .xlsx/.csv sin llamar al backend', () => {
    componente.tomarArchivo(archivoDePrueba('radicados.pdf'));
    fixture.detectChanges();

    expect(componente.archivo()).toBeNull();
    expect(componente.error()).toContain('.xlsx o .csv');

    componente.procesar(); // sin archivo valido no debe salir nada
    httpMock.expectNone(URL_CARGA);
  });

  it('un fallo HTTP muestra el error y NO cierra el dialogo', () => {
    componente.tomarArchivo(archivoDePrueba());
    fixture.detectChanges();
    componente.procesar();

    httpMock
      .expectOne(URL_CARGA)
      .flush({ message: 'Archivo sin cabeceras' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(componente.procesando()).toBeFalse();
    expect(componente.resultado()).toBeNull();
    expect(componente.error()).toContain('HTTP 400');
    expect(refFalso.close).not.toHaveBeenCalled();
  });
});

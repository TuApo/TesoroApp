import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';

import {
  FilaInformeUmbral,
  InformeUmbral,
} from '../../../../models/incapacidad-v2.model';
import { DialogoInformeUmbralComponent } from './dialogo-informe-umbral.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;
const URL_INFORME = `${BASE}/informes/proximos-umbral`;

/** Fila base; cada constante concreta pisa solo lo que le importa. */
function fila(extra: Partial<FilaInformeUmbral>): FilaInformeUmbral {
  return {
    incapacidadId: 1,
    cedula: '1005851505',
    nombreCompleto: 'ANA PEREZ',
    empresa: 'TU ALIANZA SAS',
    eps: 'NUEVA EPS',
    afp: 'PORVENIR',
    codigoDiagnostico: 'M545',
    descripcionDiagnostico: 'Lumbago no especificado',
    diasAcumulados: 100,
    fechaFinUltima: '2026-08-01',
    responsablePago: 'EPS',
    responsablePagoEtiqueta: 'EPS',
    tramo: 'PROXIMO_180',
    tramoEtiqueta: 'Proximo a 180',
    ...extra,
  };
}

const FILA_PROXIMO_180 = fila({
  incapacidadId: 11,
  cedula: '1005851505',
  nombreCompleto: 'ANA PEREZ',
  diasAcumulados: 165,
  tramo: 'PROXIMO_180',
  tramoEtiqueta: 'Proximo a 180',
});

const FILA_SUPERA_180 = fila({
  incapacidadId: 12,
  cedula: '52123456',
  nombreCompleto: 'LUIS GOMEZ',
  diasAcumulados: 210,
  responsablePago: 'FONDO_PENSIONES',
  responsablePagoEtiqueta: 'Fondo de pensiones',
  tramo: 'SUPERA_180',
  tramoEtiqueta: 'Supera 180',
});

const FILA_PROXIMO_540 = fila({
  incapacidadId: 13,
  cedula: '79456123',
  nombreCompleto: 'MARIA RIOS',
  diasAcumulados: 520,
  responsablePago: 'FONDO_PENSIONES',
  responsablePagoEtiqueta: 'Fondo de pensiones',
  tramo: 'PROXIMO_540',
  tramoEtiqueta: 'Proximo a 540',
});

const INFORME: InformeUmbral = {
  margenDias: 30,
  total: 3,
  filas: [FILA_PROXIMO_180, FILA_SUPERA_180, FILA_PROXIMO_540],
};

const INFORME_VACIO: InformeUmbral = { margenDias: 60, total: 0, filas: [] };

describe('DialogoInformeUmbralComponent', () => {
  let fixture: ComponentFixture<DialogoInformeUmbralComponent>;
  let componente: DialogoInformeUmbralComponent;
  let httpMock: HttpTestingController;
  let refFalso: { close: jasmine.Spy };

  /** La peticion del informe pendiente (la URL lleva `margen` como param). */
  const peticionInforme = (): TestRequest =>
    httpMock.expectOne((r) => r.url === URL_INFORME);

  /** Filas de la tabla estandar (como filas o como tarjetas, segun el ancho). */
  const filasPintadas = (): NodeListOf<HTMLElement> =>
    (fixture.nativeElement as HTMLElement).querySelectorAll(
      'app-tabla-estandar .te-fila, app-tabla-estandar .te-tarjeta',
    );

  beforeEach(async () => {
    refFalso = { close: jasmine.createSpy('close') };

    await TestBed.configureTestingModule({
      imports: [DialogoInformeUmbralComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: refFalso },
      ],
    }).compileComponents();

    // El dialogo dispara el GET en el constructor: la peticion ya queda
    // pendiente desde createComponent, sin necesidad de detectChanges.
    fixture = TestBed.createComponent(DialogoInformeUmbralComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  // ═══════════════════════════════════════════════════════════════════
  // (a) Carga inicial: GET con margen=30 + contadores y filas del flush
  // ═══════════════════════════════════════════════════════════════════

  it('al abrirse pide el informe con margen 30 y pinta contadores y filas', () => {
    const req = peticionInforme();
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('margen')).toBe('30');

    req.flush(INFORME);
    fixture.detectChanges();

    // Contadores en el orden de la cabecera:
    // Proximo a 180 / Supera 180 / Proximo a 540 / Supera 540.
    const valores = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.umb-contador-valor'),
      (e) => e.textContent?.trim(),
    );
    expect(valores).toEqual(['1', '1', '1', '0']);

    // La tabla pinta las 3 filas ordenadas por dias acumulados DESC.
    const filasDom = filasPintadas();
    expect(filasDom.length).toBe(3);
    expect(filasDom[0].textContent).toContain('MARIA RIOS'); // 520 dias
    expect(filasDom[1].textContent).toContain('LUIS GOMEZ'); // 210 dias
    expect(filasDom[2].textContent).toContain('ANA PEREZ'); // 165 dias
  });

  it('mientras el GET esta en vuelo la tabla muestra su esqueleto de carga', () => {
    fixture.detectChanges();
    expect(componente.cargando()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-tabla-estandar .te-esqueleto'),
    ).not.toBeNull();

    peticionInforme().flush(INFORME);
    fixture.detectChanges();
    expect(componente.cargando()).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-tabla-estandar .te-esqueleto'),
    ).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════
  // (b) Cambiar el margen dispara un nuevo GET con ese margen
  // ═══════════════════════════════════════════════════════════════════

  it('cambiar el margen dispara un nuevo GET con ese margen', () => {
    peticionInforme().flush(INFORME);
    fixture.detectChanges();

    componente.cambiarMargen(60);

    const req = peticionInforme();
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('margen')).toBe('60');

    req.flush(INFORME_VACIO);
    fixture.detectChanges();

    expect(componente.margen()).toBe(60);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Nadie esta proximo a los umbrales con este margen.',
    );
  });

  it('repetir el mismo margen o pasar uno desconocido NO vuelve a pegarle al backend', () => {
    peticionInforme().flush(INFORME);
    fixture.detectChanges();

    componente.cambiarMargen(30); // el actual
    componente.cambiarMargen(45); // no esta en el selector

    httpMock.expectNone((r) => r.url === URL_INFORME);
    expect(componente.margen()).toBe(30);
  });

  // ═══════════════════════════════════════════════════════════════════
  // (c) Columnas planas: la busqueda y los filtros los hace la tabla estandar
  // ═══════════════════════════════════════════════════════════════════

  it('las columnas exponen valores planos y el tramo sale como chip con tono', () => {
    peticionInforme().flush(INFORME);
    fixture.detectChanges();

    const columna = (id: string) => componente.columnas.find((c) => c.id === id)!;
    expect(columna('cedula').valor(FILA_SUPERA_180)).toBe('52123456');
    expect(columna('nombre').valor(FILA_SUPERA_180)).toBe('LUIS GOMEZ');
    expect(columna('dias').valor(FILA_SUPERA_180)).toBe(210);
    expect(columna('responsable').valor(FILA_SUPERA_180)).toBe('Fondo de pensiones');
    expect(columna('tramo').badge!(FILA_SUPERA_180)?.tono).toBe('danger');
    expect(columna('tramo').badge!(FILA_PROXIMO_180)?.tono).toBe('warn');
    expect(columna('tramo').badge!(FILA_PROXIMO_540)?.tono).toBe('violet');

    // Los contadores salen de TODO el informe, no de lo que filtre la tabla.
    expect(componente.conteoTramo('PROXIMO_180')).toBe(1);
    expect(componente.conteoTramo('SUPERA_540')).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════
  // Error + reintentar
  // ═══════════════════════════════════════════════════════════════════

  it('con un fallo del backend muestra el error y "Reintentar" vuelve a pedir el informe', () => {
    peticionInforme().flush('boom', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No se pudo cargar el informe de umbrales',
    );

    const botonReintentar = (fixture.nativeElement as HTMLElement).querySelector(
      '.umb-estado-error button',
    ) as HTMLButtonElement;
    botonReintentar.click();

    const req = peticionInforme();
    expect(req.request.params.get('margen')).toBe('30');
    req.flush(INFORME);
    fixture.detectChanges();

    expect(componente.error()).toBe('');
    expect(filasPintadas().length).toBe(3);
  });

  // ═══════════════════════════════════════════════════════════════════
  // Cierre
  // ═══════════════════════════════════════════════════════════════════

  it('cerrar cierra el dialogo por la referencia', () => {
    peticionInforme().flush(INFORME);
    fixture.detectChanges();

    componente.cerrar();
    expect(refFalso.close).toHaveBeenCalled();
  });
});

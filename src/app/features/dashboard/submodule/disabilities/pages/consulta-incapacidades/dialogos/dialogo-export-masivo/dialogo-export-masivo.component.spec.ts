import { provideZonelessChangeDetection } from '@angular/core';
import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';
import { ExportJob } from '../../../../models/incapacidad-v2.model';
import {
  DatosDialogoExportMasivo,
  DialogoExportMasivoComponent,
  INTERVALO_SONDEO_MS,
  nombrePorDefectoExport,
} from './dialogo-export-masivo.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

const DATOS: DatosDialogoExportMasivo = {
  filtros: { empresa: 'TU ALIANZA SAS', estado: 'RADICADA' },
  totalEstimado: 40,
};

/** Un `ExportJob` completo con overrides puntuales. */
function job(parcial: Partial<ExportJob> = {}): ExportJob {
  return {
    id: 'job-1',
    tipo: 'ZIP_SOPORTES',
    tipoEtiqueta: 'ZIP de soportes',
    estado: 'PENDIENTE',
    estadoEtiqueta: 'Pendiente',
    totalRegistros: null,
    procesados: null,
    nombreResultado: null,
    tamanoBytes: null,
    mensajeError: null,
    creadoEn: '2026-08-18T10:00:00',
    ...parcial,
  };
}

describe('DialogoExportMasivoComponent', () => {
  let fixture: ComponentFixture<DialogoExportMasivoComponent>;
  let componente: DialogoExportMasivoComponent;
  let httpMock: HttpTestingController;
  let refFalso: { close: jasmine.Spy };

  beforeEach(async () => {
    // Sin usuario en localStorage el cuerpo del POST no lleva actor: mas
    // predecible para las aserciones sobre el body.
    localStorage.removeItem('user');
    localStorage.removeItem('token');

    refFalso = { close: jasmine.createSpy('close') };

    await TestBed.configureTestingModule({
      imports: [DialogoExportMasivoComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: DATOS },
        { provide: MatDialogRef, useValue: refFalso },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogoExportMasivoComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture.destroy();
    // En zoneless + fakeAsync una emision del timer puede dejar UN sondeo en
    // vuelo al cortar la prueba; se drena para que verify() valide lo demas.
    for (const pendiente of httpMock.match((r) => r.url.includes('/exports/'))) {
      if (!pendiente.cancelled) {
        pendiente.flush(job({ estado: 'EN_PROCESO', estadoEtiqueta: 'En proceso' }));
      }
    }
    httpMock.verify();
  });

  // ═══════════════════════════════════════════════════════════════════
  // (a) Construccion: NADA de HTTP hasta que el usuario genera
  // ═══════════════════════════════════════════════════════════════════

  it('se crea en el paso de seleccion sin disparar ninguna peticion HTTP', () => {
    fixture.detectChanges();

    expect(componente).toBeTruthy();
    expect(componente.fase()).toBe('seleccion');
    expect(componente.tipo()).toBe('ZIP_SOPORTES');
    expect(componente.puedeGenerar()).toBeTrue();
    // El constructor y el primer render no tocan la red.
    expect(httpMock.match(() => true).length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════
  // (b) Generar: POST /exports y sondeo GET /exports/{id} con progreso
  // ═══════════════════════════════════════════════════════════════════

  it('al generar hace POST /exports con tipo y filtros y sondea pintando el progreso', fakeAsync(() => {
    fixture.detectChanges();

    componente.seleccionarTipo('EXCEL_CONSOLIDADO');
    componente.generar();

    const post = httpMock.expectOne(`${BASE}/exports`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body.tipo).toBe('EXCEL_CONSOLIDADO');
    expect(post.request.body.filtros).toEqual(DATOS.filtros);
    post.flush(job({ tipo: 'EXCEL_CONSOLIDADO', tipoEtiqueta: 'Excel consolidado' }));

    // `timer(0, ...)`: el primer sondeo sale de inmediato.
    tick(0);
    httpMock.expectOne(`${BASE}/exports/job-1`).flush(
      job({
        tipo: 'EXCEL_CONSOLIDADO',
        estado: 'EN_PROCESO',
        estadoEtiqueta: 'En proceso',
        totalRegistros: 40,
        procesados: 10,
      }),
    );

    expect(componente.fase()).toBe('progreso');
    expect(componente.progresoDeterminado()).toBeTrue();
    expect(componente.progreso()).toBe(25);
    expect(componente.job()?.estadoEtiqueta).toBe('En proceso');

    // Siguiente vuelta del timer: el progreso avanza.
    tick(INTERVALO_SONDEO_MS);
    httpMock.expectOne(`${BASE}/exports/job-1`).flush(
      job({
        tipo: 'EXCEL_CONSOLIDADO',
        estado: 'EN_PROCESO',
        estadoEtiqueta: 'En proceso',
        totalRegistros: 40,
        procesados: 30,
      }),
    );

    expect(componente.progreso()).toBe(75);

    // El trabajo sigue EN_PROCESO: se descarta el timer pendiente del sondeo.
    discardPeriodicTasks();
  }));

  it('la barra es indeterminada mientras el servidor no informa el total', fakeAsync(() => {
    fixture.detectChanges();

    componente.generar();
    httpMock.expectOne(`${BASE}/exports`).flush(job());

    tick(0);
    httpMock
      .expectOne(`${BASE}/exports/job-1`)
      .flush(job({ estado: 'EN_PROCESO', estadoEtiqueta: 'En proceso' }));

    expect(componente.fase()).toBe('progreso');
    expect(componente.progresoDeterminado()).toBeFalse();
    expect(componente.progreso()).toBe(0);

    discardPeriodicTasks();
  }));

  // ═══════════════════════════════════════════════════════════════════
  // (c) COMPLETADO: descarga automatica UNA vez + boton "Descargar"
  // ═══════════════════════════════════════════════════════════════════

  it('en COMPLETADO para el sondeo, descarga sola una vez y deja el boton para repetir', fakeAsync(() => {
    fixture.detectChanges();
    const guardar = spyOn(componente, 'guardarArchivo');

    componente.generar();
    httpMock.expectOne(`${BASE}/exports`).flush(job({ estado: 'EN_PROCESO' }));

    tick(0);
    httpMock.expectOne(`${BASE}/exports/job-1`).flush(
      job({
        estado: 'COMPLETADO',
        estadoEtiqueta: 'Completado',
        totalRegistros: 40,
        procesados: 40,
        nombreResultado: 'soportes-semana-33.zip',
        tamanoBytes: 2048,
      }),
    );

    // Llegar a COMPLETADO dispara la descarga automatica del blob.
    const blob = new Blob(['zip'], { type: 'application/zip' });
    const descarga = httpMock.expectOne(`${BASE}/exports/job-1/descargar`);
    expect(descarga.request.method).toBe('GET');
    descarga.flush(blob);

    expect(componente.fase()).toBe('completado');
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar).toHaveBeenCalledWith(jasmine.any(Blob), 'soportes-semana-33.zip');

    // El estado terminal corto el sondeo: no debe salir otro GET de estado.
    tick(INTERVALO_SONDEO_MS * 2);
    httpMock.expectNone(`${BASE}/exports/job-1`);

    // Descarga manual: vuelve a pedir el blob, NO vuelve a sondear.
    componente.descargar();
    httpMock.expectOne(`${BASE}/exports/job-1/descargar`).flush(blob);
    expect(guardar).toHaveBeenCalledTimes(2);
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ERROR del trabajo: mensaje + "Intentar de nuevo" vuelve al paso 1
  // ═══════════════════════════════════════════════════════════════════

  it('en ERROR muestra el mensaje del servidor y reintentar vuelve a la seleccion', fakeAsync(() => {
    fixture.detectChanges();

    componente.generar();
    httpMock.expectOne(`${BASE}/exports`).flush(job());

    tick(0);
    httpMock.expectOne(`${BASE}/exports/job-1`).flush(
      job({
        estado: 'ERROR',
        estadoEtiqueta: 'Error',
        mensajeError: 'Se agoto el espacio en disco.',
      }),
    );

    expect(componente.fase()).toBe('error');
    expect(componente.job()?.mensajeError).toBe('Se agoto el espacio en disco.');

    // El estado terminal tambien corta el sondeo.
    tick(INTERVALO_SONDEO_MS * 2);
    httpMock.expectNone(`${BASE}/exports/job-1`);

    componente.reintentar();
    expect(componente.fase()).toBe('seleccion');
    expect(componente.job()).toBeNull();
    expect(componente.error()).toBe('');
  }));
});

// ═════════════════════════════════════════════════════════════════════
// Modo "Base actual" (reunion 2026-10-05): tipo fijo, sin tarjetas ni filtros
// ═════════════════════════════════════════════════════════════════════

describe('DialogoExportMasivoComponent en modo Base actual', () => {
  let fixture: ComponentFixture<DialogoExportMasivoComponent>;
  let componente: DialogoExportMasivoComponent;
  let httpMock: HttpTestingController;

  /** Aunque la consulta tuviera filtros, la base actual NO los manda. */
  const DATOS_BASE: DatosDialogoExportMasivo = {
    filtros: { eps: 'SURA' },
    totalEstimado: null,
    modo: 'BASE_ACTUAL',
  };

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');

    await TestBed.configureTestingModule({
      imports: [DialogoExportMasivoComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: DATOS_BASE },
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogoExportMasivoComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture.destroy();
    for (const pendiente of httpMock.match((r) => r.url.includes('/exports/'))) {
      if (!pendiente.cancelled) {
        pendiente.flush(job({ estado: 'EN_PROCESO', estadoEtiqueta: 'En proceso' }));
      }
    }
    httpMock.verify();
  });

  it('arranca con EXCEL_BASE_ACTUAL fijo, sin tarjetas de tipo y con el texto de la base', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(componente.esBaseActual).toBeTrue();
    expect(componente.tipo()).toBe('EXCEL_BASE_ACTUAL');
    expect(componente.puedeGenerar()).toBeTrue();
    expect(html.querySelectorAll('.exm-tarjeta').length).toBe(0);
    expect(html.textContent).toContain('Base actual');
    expect(html.textContent).toContain(
      'Descarga el consolidado completo de la base (todas las incapacidades) con radicados, pagos y negaciones',
    );

    // No se puede cambiar el tipo desde fuera de la seleccion.
    componente.seleccionarTipo('ZIP_SOPORTES');
    expect(componente.tipo()).toBe('EXCEL_BASE_ACTUAL');
  });

  it('genera el trabajo SIN filtros y descarga con el nombre del servidor', fakeAsync(() => {
    fixture.detectChanges();
    const guardar = spyOn(componente, 'guardarArchivo');

    componente.generar();
    const post = httpMock.expectOne(`${BASE}/exports`);
    expect(post.request.body.tipo).toBe('EXCEL_BASE_ACTUAL');
    expect(post.request.body.filtros).toEqual({});
    post.flush(job({ tipo: 'EXCEL_BASE_ACTUAL', tipoEtiqueta: 'Base actual (consolidado completo)' }));

    tick(0);
    httpMock.expectOne(`${BASE}/exports/job-1`).flush(
      job({
        tipo: 'EXCEL_BASE_ACTUAL',
        estado: 'COMPLETADO',
        estadoEtiqueta: 'Completado',
        nombreResultado: 'base_actual_incapacidades.xlsx',
      }),
    );
    httpMock.expectOne(`${BASE}/exports/job-1/descargar`).flush(new Blob(['xlsx']));

    expect(guardar).toHaveBeenCalledWith(jasmine.any(Blob), 'base_actual_incapacidades.xlsx');
    discardPeriodicTasks();
  }));

  it('si el servidor no da nombre, usa uno por defecto con la extension del tipo', fakeAsync(() => {
    fixture.detectChanges();
    const guardar = spyOn(componente, 'guardarArchivo');

    componente.generar();
    httpMock.expectOne(`${BASE}/exports`).flush(job({ tipo: 'EXCEL_BASE_ACTUAL' }));
    tick(0);
    httpMock
      .expectOne(`${BASE}/exports/job-1`)
      .flush(job({ tipo: 'EXCEL_BASE_ACTUAL', estado: 'COMPLETADO', estadoEtiqueta: 'Completado' }));
    httpMock.expectOne(`${BASE}/exports/job-1/descargar`).flush(new Blob(['xlsx']));

    expect(guardar).toHaveBeenCalledWith(jasmine.any(Blob), 'base-actual-incapacidades.xlsx');
    discardPeriodicTasks();
  }));
});

describe('nombrePorDefectoExport', () => {
  it('da .zip a los ZIP (soportes y SEVENET) y .xlsx a los Excel (consolidado y base actual)', () => {
    expect(nombrePorDefectoExport('ZIP_SOPORTES')).toMatch(/\.zip$/);
    expect(nombrePorDefectoExport('ZIP_SEVENET')).toMatch(/\.zip$/);
    expect(nombrePorDefectoExport('EXCEL_CONSOLIDADO')).toMatch(/\.xlsx$/);
    expect(nombrePorDefectoExport('EXCEL_BASE_ACTUAL')).toMatch(/\.xlsx$/);
  });
});

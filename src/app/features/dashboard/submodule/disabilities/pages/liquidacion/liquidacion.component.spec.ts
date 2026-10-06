import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import Swal from 'sweetalert2';

import { environment } from '@/environments/environment';
import type { Page } from '../../models/incapacidad-v2.model';
import {
  CargaLiquidacion,
  CargaLiquidacionDetalle,
  FilaLiquidacion,
  ResultadoAplicacion,
} from '../../models/incapacidad-salud.model';
import { DialogoHomologarFilaComponent } from './dialogos/dialogo-homologar-fila.component';
import { LiquidacionComponent } from './liquidacion.component';
import {
  cargaLiquidacion,
  causalNegacion,
  filaLiquidacion,
  incapacidadRef,
} from './liquidacion.fixtures.spec-helper';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

/** `Swal.fire` tiene varias sobrecargas: se expone con una firma simple para espiarla. */
function swalEspiable(): { fire: (...args: unknown[]) => Promise<unknown> } {
  return Swal as unknown as { fire: (...args: unknown[]) => Promise<unknown> };
}

/** Deja correr las promesas de SweetAlert2 (el `.then` de la confirmacion). */
async function microtareas(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function pagina<T>(content: T[], total = content.length): Page<T> {
  return { content, number: 0, size: 25, totalElements: total, totalPages: Math.max(1, Math.ceil(total / 25)), first: true, last: true, empty: content.length === 0 };
}

const SUGERIDA = incapacidadRef({ id: 200, codigoOficina: 'TASB020', codigoUnico: '100585150520260802', fechaInicio: '2026-08-02', fechaFin: '2026-08-06' });

/** Plantilla tipica: 3 pagos (cruza, no cruza con sugerencia, varias posibles) y 3 negaciones. */
function filasCarga(): FilaLiquidacion[] {
  return [
    filaLiquidacion({ id: 1, fila: 2, resultado: 'CRUZA', valorPagado: 350184 }),
    filaLiquidacion({
      id: 2, fila: 3, resultado: 'NO_CRUZA', resultadoEtiqueta: 'No cruza', valorPagado: 120000, incapacidad: null,
      mensaje: 'Ninguna incapacidad con cedula 1005851505 y fecha de inicio 01/08/2026', sugerencias: [SUGERIDA],
    }),
    filaLiquidacion({
      id: 3, fila: 4, resultado: 'AMBIGUA', valorPagado: 50000, incapacidad: null,
      sugerencias: [incapacidadRef({ id: 300 }), incapacidadRef({ id: 301, codigoUnico: '100585150520260801-2' })],
    }),
    filaLiquidacion({
      id: 4, fila: 2, hoja: 'NEGACIONES', resultado: 'CRUZA', valorPagado: null, fechaRespuesta: '2026-09-10',
      causalTexto: 'Uno y dos dias no cumple', causalId: 1, causalCodigo: 'DIAS_1_2_NO_RECONOCIDOS', causalNombre: '1 y 2 dias', accion: 'FINALIZA',
      incapacidad: incapacidadRef({ id: 400 }),
    }),
    filaLiquidacion({
      id: 5, fila: 3, hoja: 'NEGACIONES', eps: 'NUEVA EPS', resultado: 'CRUZA', valorPagado: null, fechaRespuesta: '2026-09-11',
      causalTexto: 'Causal 51', sinHomologar: true, accion: 'RECOBRO', incapacidad: incapacidadRef({ id: 500 }),
    }),
    filaLiquidacion({
      id: 6, fila: 4, hoja: 'NEGACIONES', eps: 'Nueva EPS', resultado: 'NO_CRUZA', valorPagado: null, fechaRespuesta: '2026-09-11',
      causalTexto: 'causal  51.', sinHomologar: true, accion: 'RECOBRO', incapacidad: null,
    }),
  ];
}

function detalleCarga(filas = filasCarga(), carga: Partial<CargaLiquidacion> = {}): CargaLiquidacionDetalle {
  return {
    carga: cargaLiquidacion({ filasPagos: 3, filasNegaciones: 3, cruzadas: 3, noCruzadas: 2, ...carga }),
    resumen: {
      pagos: { total: 3, cruzan: 1, noCruzan: 1, ambiguas: 1, duplicadas: 0, errores: 0 },
      negaciones: { total: 3, cruzan: 2, noCruzan: 1, ambiguas: 0, duplicadas: 0, errores: 0, finalizan: 1, recobro: 1, sinHomologar: 2 },
      valorTotalPagos: 520184,
      incapacidadesDistintas: 3,
    },
    filas,
  };
}

describe('LiquidacionComponent', () => {
  let fixture: ComponentFixture<LiquidacionComponent>;
  let componente: LiquidacionComponent;
  let httpMock: HttpTestingController;
  let dialogoFalso: { open: jasmine.Spy };

  const texto = (selector: string): string =>
    ((fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  const responderHistorial = (cargas: CargaLiquidacion[] = []) =>
    httpMock.expectOne((r) => r.url === `${BASE}/liquidacion/cargas` && r.method === 'GET').flush(pagina(cargas));

  /** Sube la plantilla y responde la simulacion (+ la recarga del historial). */
  const simular = (detalle = detalleCarga()) => {
    componente.tomarArchivo(new File(['x'], 'liquidacion_septiembre.xlsx'));
    const req = httpMock.expectOne(`${BASE}/liquidacion/cargas/simular`);
    req.flush(detalle);
    responderHistorial([detalle.carga]);
    fixture.detectChanges();
    return req;
  };

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    dialogoFalso = { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(undefined) }) };

    await TestBed.configureTestingModule({
      imports: [LiquidacionComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MatDialog, useValue: dialogoFalso },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LiquidacionComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  it('al entrar carga el historial paginado y lo pinta', () => {
    const req = httpMock.expectOne((r) => r.url === `${BASE}/liquidacion/cargas`);
    expect(req.request.params.get('pagina')).toBe('0');
    expect(req.request.params.get('tamano')).toBe('25');
    req.flush(pagina([cargaLiquidacion({ id: 3, estado: 'APLICADA', nombreArchivo: 'agosto.xlsx', aplicadas: 21 })], 1));
    fixture.detectChanges();

    expect(componente.totalCargas()).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('agosto.xlsx');
    // Sin carga en revision no hay alerta.
    expect(texto('.liq-alerta-titulo')).toBe('');
  });

  it('descarga la plantilla del backend con su nombre', () => {
    responderHistorial();
    const guardar = spyOn(componente, 'guardarArchivo');

    componente.descargarPlantilla();
    const req = httpMock.expectOne(`${BASE}/liquidacion/plantilla`);
    expect(req.request.responseType).toBe('blob');
    const blob = new Blob(['xlsx']);
    req.flush(blob);

    expect(guardar).toHaveBeenCalledOnceWith(jasmine.any(Blob), 'plantilla_liquidacion_incapacidades.xlsx');
  });

  it('rechaza archivos que no son .xlsx o pasan de 10 MB sin llamar al backend', () => {
    responderHistorial();
    componente.tomarArchivo(new File(['x'], 'liquidacion.csv'));
    expect(componente.errorCarga()).toContain('.xlsx');

    const grande = new File(['x'], 'grande.xlsx');
    Object.defineProperty(grande, 'size', { value: 10 * 1024 * 1024 + 1 });
    componente.tomarArchivo(grande);
    expect(componente.errorCarga()).toContain('10 MB');

    httpMock.expectNone(`${BASE}/liquidacion/cargas/simular`);
  });

  it('simular muestra la ALERTA de cuantas cruzan y las tarjetas por resultado', () => {
    responderHistorial();
    const req = simular();

    const cuerpo = req.request.body as FormData;
    expect(cuerpo instanceof FormData).toBeTrue();
    expect((cuerpo.get('file') as File).name).toBe('liquidacion_septiembre.xlsx');

    expect(texto('.liq-alerta-titulo')).toBe('Subiste 3 pagos y 3 negaciones: 3 cruzan con una incapacidad, 2 no cruzan.');
    expect(componente.alerta()?.tono).toBe('aviso');
    const r = componente.resumen()!;
    expect(r.pagos.ambiguas).toBe(1);
    expect(r.negaciones.finalizan).toBe(1);
    expect(r.negaciones.recobro).toBe(1);
    expect(r.negaciones.sinHomologar).toBe(2);
    // Valor de la plantilla (backend) y valor que entraria al aplicar (solo lo que cruza).
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('520.184');
    expect(componente.valorAplicable()).toBe(350184);
    expect(componente.filasAplicables().length).toBe(3);
    expect(texto('.liq-acciones')).toContain('Aplicar 3 filas');
  });

  it('el filtro rapido deja solo las filas de ese resultado y la tarjeta cambia de hoja', () => {
    responderHistorial();
    simular();

    componente.filtrarPor('PAGOS', 'NO_CRUZA');
    expect(componente.filasVisibles().map((f) => f.id)).toEqual([2]);
    componente.filtrarPor('NEGACIONES', 'SIN_HOMOLOGAR');
    expect(componente.hoja()).toBe('NEGACIONES');
    expect(componente.filasVisibles().map((f) => f.id)).toEqual([5, 6]);
  });

  it('asigna con un clic la sugerencia (otra fecha de inicio) y la alerta se recalcula', () => {
    responderHistorial();
    simular();
    componente.filtrarPor('PAGOS', 'NO_CRUZA');
    fixture.detectChanges();

    const boton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="Asignar a TASB020"]');
    expect(boton).withContext('boton Asignar de la sugerencia').not.toBeNull();
    boton!.click();

    const req = httpMock.expectOne(`${BASE}/liquidacion/cargas/7/filas/2/asignar`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.incapacidadId).toBe(200);
    req.flush(filaLiquidacion({ id: 2, fila: 3, resultado: 'CRUZA', asignadaManual: true, valorPagado: 120000, incapacidad: SUGERIDA }));
    fixture.detectChanges();

    expect(componente.alerta()?.titulo).toBe('Subiste 3 pagos y 3 negaciones: 4 cruzan con una incapacidad, 1 no cruza.');
    expect(componente.filasAplicables().length).toBe(4);
    expect(componente.valorAplicable()).toBe(470184);
  });

  it('soltar devuelve una fila asignada a mano (incapacidadId null)', () => {
    responderHistorial();
    const filas = filasCarga();
    filas[1] = { ...filas[1], resultado: 'CRUZA', asignadaManual: true, incapacidad: SUGERIDA };
    simular(detalleCarga(filas));

    componente.soltar(componente.filas()[1]);
    const req = httpMock.expectOne(`${BASE}/liquidacion/cargas/7/filas/2/asignar`);
    expect(req.request.body.incapacidadId).toBeNull();
    req.flush(filasCarga()[1]);
    expect(componente.filas()[1].resultado).toBe('NO_CRUZA');
  });

  it('homologa la causal de una negacion y, al recordarla, tambien sus filas hermanas', () => {
    responderHistorial();
    simular();
    const swal = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({}));
    dialogoFalso.open.and.returnValue({ afterClosed: () => of({ causalId: 3, recordar: true }) });

    componente.homologar(componente.filas()[4]);
    const causales = httpMock.expectOne((r) => r.url === `${BASE}/liquidacion/causales`);
    expect(causales.request.params.get('incluirInactivas')).toBe('false');
    causales.flush([
      causalNegacion(),
      causalNegacion({ id: 3, codigo: 'SIN_AFILIACION', accion: 'RECOBRO', nombre: 'Sin afiliacion', orden: 3 }),
      causalNegacion({ id: 9, codigo: 'VIEJA', activo: false }),
    ]);

    expect(dialogoFalso.open).toHaveBeenCalled();
    const [tipo, config] = dialogoFalso.open.calls.mostRecent().args as [unknown, { data: { causales: { id: number }[] } }];
    expect(tipo).toBe(DialogoHomologarFilaComponent);
    // Solo se ofrecen las activas.
    expect(config.data.causales.map((c) => c.id)).toEqual([1, 3]);

    const principal = httpMock.expectOne(`${BASE}/liquidacion/cargas/7/filas/5/causal`);
    expect(principal.request.body.causalId).toBe(3);
    expect(principal.request.body.recordarEquivalencia).toBeTrue();
    principal.flush({ ...componente.filas()[4], sinHomologar: false, causalId: 3, causalCodigo: 'SIN_AFILIACION' });

    // Misma EPS (escrita distinto) y mismo texto normalizado: se homologa sin crear otra equivalencia.
    const hermana = httpMock.expectOne(`${BASE}/liquidacion/cargas/7/filas/6/causal`);
    expect(hermana.request.body.recordarEquivalencia).toBeFalse();
    hermana.flush({ ...componente.filas()[5], sinHomologar: false, causalId: 3 });

    expect(componente.resumen()?.negaciones.sinHomologar).toBe(0);
    expect(swal).toHaveBeenCalled();
    expect(JSON.stringify(swal.calls.mostRecent().args[0])).toContain('1 fila');
  });

  it('aplicar confirma, muestra "Usted acaba de liquidar..." y recarga la carga', async () => {
    responderHistorial();
    simular();
    const swal = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));

    componente.aplicar();
    const confirmacion = JSON.stringify(swal.calls.mostRecent().args[0]);
    expect(confirmacion).toContain('Aplicar 3 filas');
    expect(confirmacion).toContain('1 pago');
    await microtareas();

    const req = httpMock.expectOne(`${BASE}/liquidacion/cargas/7/aplicar`);
    expect(req.request.method).toBe('POST');
    const resultado: ResultadoAplicacion = {
      carga: cargaLiquidacion({ estado: 'APLICADA', aplicadas: 3 }),
      pagosAplicados: 1, negacionesAplicadas: 2, finalizadas: 1, aRecobro: 1, incapacidadesLiquidadas: 3, noAplicadas: 3,
      valorTotalPagos: 350184,
      mensaje: 'Usted acaba de liquidar 3 incapacidades: 1 pagada, 1 finalizada y 1 a recobro.',
    };
    req.flush(resultado);

    expect(JSON.stringify(swal.calls.mostRecent().args[0])).toContain('Usted acaba de liquidar 3 incapacidades');
    const aplicadas = filasCarga().map((f) => (f.resultado === 'CRUZA' ? { ...f, aplicada: true } : f));
    httpMock.expectOne(`${BASE}/liquidacion/cargas/7`).flush(detalleCarga(aplicadas, { estado: 'APLICADA', aplicadoPor: 'ligia', aplicadoEn: '2026-10-06T10:00:00' }));
    responderHistorial();
    fixture.detectChanges();

    expect(componente.editable()).toBeFalse();
    expect(componente.valorAplicable()).toBe(350184);
    expect(texto('.liq-revision .ges-aviso-info')).toContain('Carga aplicada por ligia');
  });

  it('aplicar no hace nada si el usuario cancela', async () => {
    responderHistorial();
    simular();
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: false }));
    componente.aplicar();
    await microtareas();
    httpMock.expectNone(`${BASE}/liquidacion/cargas/7/aplicar`);
  });

  it('descartar deja la carga DESCARTADA y cierra la revision', async () => {
    responderHistorial();
    simular();
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
    componente.descartar();
    await microtareas();
    httpMock.expectOne(`${BASE}/liquidacion/cargas/7/descartar`).flush(cargaLiquidacion({ estado: 'DESCARTADA' }));
    responderHistorial();
    expect(componente.detalle()).toBeNull();
  });

  it('exporta a Excel solo las filas que no cruzaron', () => {
    responderHistorial();
    simular();
    const guardar = spyOn(componente, 'guardarLibro');
    componente.exportarSinCruce();
    expect(guardar).toHaveBeenCalledTimes(1);
    const [libro, nombre] = guardar.calls.mostRecent().args;
    expect(nombre).toMatch(/^liquidacion_sin_cruce_carga7_\d{8}-\d{4}\.xlsx$/);
    expect(libro.SheetNames).toEqual(['Pagos', 'Negaciones']);
  });

  it('un 200 falso del modo sin conexion no se toma como simulacion', () => {
    responderHistorial();
    componente.tomarArchivo(new File(['x'], 'liq.xlsx'));
    httpMock.expectOne(`${BASE}/liquidacion/cargas/simular`).flush({ success: true, offlineQueue: true });
    expect(componente.detalle()).toBeNull();
    expect(componente.errorCarga()).toContain('No hay conexión');
  });

  it('anular una carga aplicada exige escribir ANULAR y recarga el historial', async () => {
    const aplicada = cargaLiquidacion({ id: 3, estado: 'APLICADA', aplicadas: 21 });
    responderHistorial([aplicada]);
    const swal = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true, value: 'ANULAR' }));

    componente.anularCarga(aplicada);
    const opciones = swal.calls.mostRecent().args[0] as { inputValidator: (v: string) => string | null };
    expect(opciones.inputValidator('anular')).toBeNull();
    expect(opciones.inputValidator('si')).toContain('ANULAR');
    await microtareas();

    httpMock.expectOne(`${BASE}/liquidacion/cargas/3/anular`).flush(cargaLiquidacion({ id: 3, estado: 'ANULADA' }));
    responderHistorial([cargaLiquidacion({ id: 3, estado: 'ANULADA' })]);
  });

  it('ver detalle de una carga del historial la abre en la revision', () => {
    responderHistorial([cargaLiquidacion({ id: 3, estado: 'APLICADA' })]);
    componente.verCarga(cargaLiquidacion({ id: 3, estado: 'APLICADA' }));
    httpMock.expectOne(`${BASE}/liquidacion/cargas/3`).flush(detalleCarga(filasCarga(), { id: 3, estado: 'APLICADA' }));
    expect(componente.carga()?.id).toBe(3);
    expect(componente.editable()).toBeFalse();
  });
});

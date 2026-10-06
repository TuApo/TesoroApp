import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import Swal from 'sweetalert2';

import { environment } from '@/environments/environment';
import type { Page } from '../../models/incapacidad-v2.model';
import { CausalSinHomologar, NegacionItem } from '../../models/incapacidad-salud.model';
import {
  causalNegacion,
  equivalenciaCausal,
  negacionItem,
} from '../liquidacion/liquidacion.fixtures.spec-helper';
import { DialogoCausalNegacionComponent } from './dialogos/dialogo-causal-negacion.component';
import { DialogoEquivalenciaComponent } from './dialogos/dialogo-equivalencia.component';
import {
  LiquidacionNegacionesComponent,
  TAB_CAUSALES,
  TAB_EQUIVALENCIAS,
  TAB_SIN_HOMOLOGAR,
  filtrosDeNegaciones,
  mensajeReaplicar,
} from './liquidacion-negaciones.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

function swalEspiable(): { fire: (...args: unknown[]) => Promise<unknown> } {
  return Swal as unknown as { fire: (...args: unknown[]) => Promise<unknown> };
}

async function microtareas(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function pagina<T>(content: T[], total = content.length): Page<T> {
  return { content, number: 0, size: 50, totalElements: total, totalPages: 1, first: true, last: true, empty: content.length === 0 };
}

const SIN_HOMOLOGAR: CausalSinHomologar[] = [
  { eps: 'NUEVA EPS', textoExterno: 'Causal 51', textoNormalizado: 'CAUSAL 51', veces: 4, ultimaFecha: '2026-09-11' },
  { eps: 'SANITAS', textoExterno: 'uno y dos dias no cumple', textoNormalizado: 'UNO Y DOS DIAS NO CUMPLE', veces: 2, ultimaFecha: '2026-09-02' },
];

const CAUSALES = [
  causalNegacion(),
  causalNegacion({ id: 2, codigo: 'SIN_APORTES_4_SEMANAS', nombre: 'Sin aportes 4 semanas', orden: 2 }),
  causalNegacion({ id: 3, codigo: 'SIN_AFILIACION', nombre: 'Sin afiliacion', accion: 'RECOBRO', terminacion: null, orden: 3, equivalencias: 1 }),
];

describe('LiquidacionNegacionesComponent', () => {
  let fixture: ComponentFixture<LiquidacionNegacionesComponent>;
  let componente: LiquidacionNegacionesComponent;
  let httpMock: HttpTestingController;
  let dialogoFalso: { open: jasmine.Spy };

  const peticionNegaciones = (): TestRequest => httpMock.expectOne((r) => r.url === `${BASE}/liquidacion/negaciones`);
  const peticionCausales = (): TestRequest => httpMock.expectOne((r) => r.url === `${BASE}/liquidacion/causales`);
  const responderSinHomologar = (filas = SIN_HOMOLOGAR) =>
    httpMock.expectOne(`${BASE}/liquidacion/causales/sin-homologar`).flush(filas);

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    dialogoFalso = { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(undefined) }) };

    await TestBed.configureTestingModule({
      imports: [LiquidacionNegacionesComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MatDialog, useValue: dialogoFalso },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LiquidacionNegacionesComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${BASE}/eps-matriz`).flush([]);
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  it('al entrar lista las negaciones y cuenta los textos sin homologar en la pestana', () => {
    peticionNegaciones().flush(pagina<NegacionItem>([negacionItem(), negacionItem({ id: 9, sinHomologar: false, causalNombre: 'Sin afiliacion', causalCodigo: 'SIN_AFILIACION' })], 2));
    responderSinHomologar();
    fixture.detectChanges();

    expect(componente.total()).toBe(2);
    expect(componente.totalSinHomologar()).toBe(6);
    const pestanas = (fixture.nativeElement as HTMLElement).querySelector('.mat-mdc-tab-labels')?.textContent ?? '';
    expect(pestanas).toContain('Sin homologar');
    expect(pestanas).toContain('2');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Causal 51');
  });

  it('filtra por accion y "solo sin homologar" (sin claves vacias)', () => {
    peticionNegaciones().flush(pagina([]));
    responderSinHomologar([]);

    componente.formulario = { q: '', eps: ' NUEVA EPS ', accion: 'RECOBRO', soloSinHomologar: true };
    componente.filtrar();
    const params = peticionNegaciones().request.params;
    expect(params.get('accion')).toBe('RECOBRO');
    expect(params.get('sinHomologar')).toBe('true');
    expect(params.get('eps')).toBe('NUEVA EPS');
    expect(params.has('q')).toBeFalse();

    expect(filtrosDeNegaciones({ q: '', eps: '', accion: '', soloSinHomologar: false }, null)).toEqual({});
  });

  it('causales internas: avisa cuales deben finalizar y abre el dialogo de alta', () => {
    peticionNegaciones().flush(pagina([]));
    responderSinHomologar([]);

    componente.cambiarTab(TAB_CAUSALES);
    const req = peticionCausales();
    expect(req.request.params.get('incluirInactivas')).toBe('true');
    req.flush([CAUSALES[2], CAUSALES[0], CAUSALES[1]]);
    fixture.detectChanges();

    // Ordenadas por "orden".
    expect(componente.causales()!.map((c) => c.id)).toEqual([1, 2, 3]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('1 y 2 días no reconocidos');

    dialogoFalso.open.and.returnValue({ afterClosed: () => of(causalNegacion({ id: 4, codigo: 'NUEVA', orden: 4 })) });
    componente.nuevaCausal();
    const [tipo, config] = dialogoFalso.open.calls.mostRecent().args as [unknown, { data: { causal: unknown; ordenSugerido: number } }];
    expect(tipo).toBe(DialogoCausalNegacionComponent);
    expect(config.data.causal).toBeNull();
    expect(config.data.ordenSugerido).toBe(4);
    // Guardada: se recarga la lista.
    peticionCausales().flush(CAUSALES);
  });

  it('cambiar la accion de una causal recarga las negaciones (se re-evaluan)', () => {
    peticionNegaciones().flush(pagina([]));
    responderSinHomologar([]);
    componente.cambiarTab(TAB_CAUSALES);
    peticionCausales().flush(CAUSALES);

    dialogoFalso.open.and.returnValue({ afterClosed: () => of({ ...CAUSALES[2], accion: 'FINALIZA' }) });
    componente.editarCausal(CAUSALES[2]);
    peticionCausales().flush(CAUSALES);
    peticionNegaciones().flush(pagina([]));
  });

  it('homologar desde "Sin homologar" crea la equivalencia con reaplicar y dice cuantas negaciones se actualizaron', () => {
    peticionNegaciones().flush(pagina([]));
    responderSinHomologar();
    const swal = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({}));

    componente.cambiarTab(TAB_SIN_HOMOLOGAR);
    responderSinHomologar();

    dialogoFalso.open.and.returnValue({
      afterClosed: () => of({ tipo: 'creada', resultado: { equivalencia: equivalenciaCausal(), negacionesActualizadas: 4, incapacidadesRecalculadas: 3 } }),
    });
    componente.homologar('Causal 51', 'NUEVA EPS');
    peticionCausales().flush(CAUSALES);

    const [tipo, config] = dialogoFalso.open.calls.mostRecent().args as [unknown, { data: { modo: string; textoExterno: string; eps: string } }];
    expect(tipo).toBe(DialogoEquivalenciaComponent);
    expect(config.data.modo).toBe('homologar');
    expect(config.data.textoExterno).toBe('Causal 51');
    expect(config.data.eps).toBe('NUEVA EPS');

    expect(JSON.stringify(swal.calls.mostRecent().args[0])).toContain('Se actualizaron 4 negaciones y se recalcularon 3 incapacidades.');
    // Se refresca todo lo que la equivalencia movio.
    peticionNegaciones().flush(pagina([]));
    httpMock.expectOne(`${BASE}/liquidacion/equivalencias`).flush([equivalenciaCausal()]);
    responderSinHomologar([SIN_HOMOLOGAR[1]]);
    peticionCausales().flush(CAUSALES);
    expect(componente.sinHomologar().length).toBe(1);
  });

  it('equivalencias: lista, edita y elimina con confirmacion', async () => {
    peticionNegaciones().flush(pagina([]));
    responderSinHomologar([]);

    componente.cambiarTab(TAB_EQUIVALENCIAS);
    httpMock.expectOne(`${BASE}/liquidacion/equivalencias`).flush([equivalenciaCausal(), equivalenciaCausal({ id: 31, eps: '*', textoExterno: 'NO CUMPLE 4 SEMANAS' })]);
    peticionCausales().flush(CAUSALES);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Todas las EPS');

    componente.editarEquivalencia(componente.equivalencias()![0]);
    const config = dialogoFalso.open.calls.mostRecent().args[1] as { data: { modo: string; equivalencia: { id: number } } };
    expect(config.data.modo).toBe('editar');
    expect(config.data.equivalencia.id).toBe(30);

    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
    componente.eliminarEquivalencia(componente.equivalencias()![1]);
    await microtareas();
    const req = httpMock.expectOne(`${BASE}/liquidacion/equivalencias/31`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    httpMock.expectOne(`${BASE}/liquidacion/equivalencias`).flush([equivalenciaCausal()]);
    peticionCausales().flush(CAUSALES);
  });

  it('anular una negacion manda el motivo y recarga', async () => {
    peticionNegaciones().flush(pagina([negacionItem()]));
    responderSinHomologar([]);
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true, value: '' }));

    componente.anular(componente.negaciones()[0]);
    await microtareas();
    const req = httpMock.expectOne(`${BASE}/liquidacion/negaciones/8/anular`);
    expect(req.request.body.motivo).toBeNull();
    req.flush(negacionItem({ anulado: true }));
    peticionNegaciones().flush(pagina([]));
    responderSinHomologar([]);
  });

  it('si falla la consulta de "Sin homologar" muestra el error y no dice que todo esta homologado', async () => {
    peticionNegaciones().flush(pagina([]));
    responderSinHomologar([]);

    componente.cambiarTab(TAB_SIN_HOMOLOGAR);
    fixture.detectChanges();
    await fixture.whenStable();
    // Cambiar la pestana por codigo hace que mat-tab-group tambien la emita: se responden todas.
    for (const req of httpMock.match(`${BASE}/liquidacion/causales/sin-homologar`)) {
      req.flush({ error: 'ms-hr no responde' }, { status: 500, statusText: 'Server Error' });
    }
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(componente.errorSinHomologar()).toBe('ms-hr no responde');
    expect(texto).toContain('ms-hr no responde');
    expect(texto).not.toContain('Todas las negaciones tienen su causal homologada');
  });

  it('exportar usa los filtros de lo que esta en pantalla, no lo escrito sin aplicar', () => {
    peticionNegaciones().flush(pagina([negacionItem()], 1));
    responderSinHomologar([]);
    spyOn(componente, 'guardarLibro');
    componente.formulario = { q: '', eps: '', accion: 'FINALIZA', soloSinHomologar: true };

    componente.exportar();
    const req = peticionNegaciones();
    expect(req.request.params.has('accion')).toBeFalse();
    expect(req.request.params.has('sinHomologar')).toBeFalse();
    req.flush(pagina([negacionItem()], 1));
  });

  it('mensajeReaplicar con singulares y sin coincidencias', () => {
    peticionNegaciones().flush(pagina([]));
    responderSinHomologar([]);
    expect(mensajeReaplicar(1, 1)).toBe('Se actualizó 1 negación y se recalculó 1 incapacidad.');
    expect(mensajeReaplicar(0, 0)).toContain('No había negaciones');
  });
});

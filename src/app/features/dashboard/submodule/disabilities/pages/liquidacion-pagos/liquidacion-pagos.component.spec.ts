import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

import { environment } from '@/environments/environment';
import { PagoItem, PaginaPagos } from '../../models/incapacidad-salud.model';
import { pagoItem } from '../liquidacion/liquidacion.fixtures.spec-helper';
import { pesos } from '../liquidacion/liquidacion.utils';
import { LiquidacionPagosComponent, filtrosDePagos } from './liquidacion-pagos.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

function swalEspiable(): { fire: (...args: unknown[]) => Promise<unknown> } {
  return Swal as unknown as { fire: (...args: unknown[]) => Promise<unknown> };
}

async function microtareas(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function paginaPagos(content: PagoItem[], total: number, valorTotal: number, numero = 0, totalPaginas = 1): PaginaPagos {
  return { content, number: numero, size: 50, totalElements: total, totalPages: totalPaginas, first: numero === 0, last: numero + 1 >= totalPaginas, empty: content.length === 0, valorTotal };
}

describe('LiquidacionPagosComponent', () => {
  let fixture: ComponentFixture<LiquidacionPagosComponent>;
  let componente: LiquidacionPagosComponent;
  let httpMock: HttpTestingController;

  const peticionPagos = (): TestRequest => httpMock.expectOne((r) => r.url === `${BASE}/liquidacion/pagos`);

  /** Crea la pantalla; `antes` corre antes del primer render (ngOnInit). */
  const crear = (antes?: (c: LiquidacionPagosComponent) => void) => {
    fixture = TestBed.createComponent(LiquidacionPagosComponent);
    componente = fixture.componentInstance;
    antes?.(componente);
    fixture.detectChanges();
    httpMock.expectOne(`${BASE}/eps-matriz`).flush([
      { nombre: 'SALUD TOTAL', formaCargue: 'UN_PDF', formaCargueEtiqueta: 'Un PDF', requiereSoporteEps: true, orden: 1 },
      { nombre: 'NUEVA EPS', formaCargue: 'UN_PDF', formaCargueEtiqueta: 'Un PDF', requiereSoporteEps: false, orden: 2 },
    ]);
  };

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    await TestBed.configureTestingModule({
      imports: [LiquidacionPagosComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    fixture?.destroy();
  });

  it('pinta el valor total de TODO el filtro (valorTotal), no solo la pagina', () => {
    crear();
    const req = peticionPagos();
    expect(req.request.params.get('pagina')).toBe('0');
    expect(req.request.params.get('tamano')).toBe('50');
    expect(req.request.params.has('q')).toBeFalse();
    req.flush(paginaPagos([pagoItem(), pagoItem({ id: 6, valorPagado: 1000 })], 120, 41234567));
    fixture.detectChanges();

    expect(componente.total()).toBe(120);
    expect(componente.valorTotal()).toBe(41234567);
    const kpis = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi-tarjeta')).map((k) => k.textContent ?? '');
    expect(kpis[0]).toContain('120');
    expect(kpis[1]).toContain(pesos(41234567));
    expect(kpis[1]).toContain('41.234.567');
    expect(componente.epsOpciones()).toEqual(['SALUD TOTAL', 'NUEVA EPS']);
  });

  it('manda q, EPS y el rango de fecha de pago en yyyy-MM-dd sin desfase', () => {
    crear();
    peticionPagos().flush(paginaPagos([], 0, 0));

    componente.formulario = { q: '  1005851505 ', eps: 'SALUD TOTAL', desde: new Date(2026, 8, 1), hasta: new Date(2026, 8, 30) };
    componente.pagina.set(3);
    componente.filtrar();

    const params = peticionPagos().request.params;
    expect(params.get('q')).toBe('1005851505');
    expect(params.get('eps')).toBe('SALUD TOTAL');
    expect(params.get('desde')).toBe('2026-09-01');
    expect(params.get('hasta')).toBe('2026-09-30');
    expect(params.get('pagina')).toBe('0');
  });

  it('filtra por la carga que llega del historial de Liquidacion', () => {
    crear((c) => c.cargaId.set(7));
    const req = peticionPagos();
    expect(req.request.params.get('cargaId')).toBe('7');
    req.flush(paginaPagos([pagoItem()], 1, 350184));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Solo los pagos de la carga #7');
  });

  it('filtrosDePagos no manda claves vacias', () => {
    expect(filtrosDePagos({ q: ' ', eps: '', desde: null, hasta: null }, null)).toEqual({});
  });

  it('anular pide confirmacion, manda el motivo y recarga', async () => {
    crear();
    peticionPagos().flush(paginaPagos([pagoItem()], 1, 350184));
    spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true, value: '  Valor digitado mal ' }));

    componente.anular(componente.filas()[0]);
    await microtareas();

    const req = httpMock.expectOne(`${BASE}/liquidacion/pagos/5/anular`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.motivo).toBe('Valor digitado mal');
    req.flush(pagoItem({ anulado: true }));
    peticionPagos().flush(paginaPagos([pagoItem({ anulado: true })], 1, 0));
  });

  it('exporta todas las paginas del filtro a Excel', () => {
    crear();
    peticionPagos().flush(paginaPagos([pagoItem()], 3, 700368));
    const guardar = spyOn(componente, 'guardarLibro');

    componente.exportar();
    const p0 = peticionPagos();
    expect(p0.request.params.get('tamano')).toBe('200');
    expect(p0.request.params.get('pagina')).toBe('0');
    p0.flush(paginaPagos([pagoItem({ id: 1 }), pagoItem({ id: 2 })], 3, 700368, 0, 2));
    const p1 = peticionPagos();
    expect(p1.request.params.get('pagina')).toBe('1');
    p1.flush(paginaPagos([pagoItem({ id: 3, valorPagado: 1 })], 3, 700368, 1, 2));

    expect(guardar).toHaveBeenCalledTimes(1);
    const [libro, nombre] = guardar.calls.mostRecent().args;
    expect(nombre).toMatch(/^pagos_incapacidades_\d{8}-\d{4}\.xlsx$/);
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Pagos']);
    expect(filas.length).toBe(3);
    expect(filas[0]['Valor pagado']).toBe(350184);
    expect(filas[0]['Fecha de pago']).toBe('03/07/2026');
    expect(filas[0]['Soporte contable']).toBe('DOC-072');
  });
});

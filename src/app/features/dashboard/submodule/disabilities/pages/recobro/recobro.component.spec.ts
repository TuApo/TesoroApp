import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';

import { environment } from '@/environments/environment';
import type { RecobroItem } from '../../models/incapacidad-salud.model';
import { paginaPrueba, radicadoPrueba, recobroPrueba } from '../radicacion/radicacion.datos-prueba';
import { DialogoRadicadosRecobroComponent } from './dialogo-radicados-recobro/dialogo-radicados-recobro.component';
import { DialogoRegistrarRecobroComponent } from './dialogo-registrar-recobro/dialogo-registrar-recobro.component';
import { RecobroComponent } from './recobro.component';
import { causalHomologada, rotularRadicados, situacionDe, ultimoRecobro } from './recobro.utils';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

const REC_A = recobroPrueba({}, { id: 31, nombreCompleto: 'RUIZ ANA' });
const REC_B = recobroPrueba(
  { recobros: [radicadoPrueba({ id: 70, tipo: 'RECOBRO', numeroRadicado: 'PQR-1', negacionId: 5 })], totalRadicados: 2 },
  { id: 32, nombreCompleto: 'DIAZ LUIS' },
);

describe('RecobroComponent', () => {
  let fixture: ComponentFixture<RecobroComponent>;
  let componente: RecobroComponent;
  let httpMock: HttpTestingController;
  let dialogoFalso: { open: jasmine.Spy };
  let cierre: Subject<unknown>;

  const recobros = (): TestRequest[] => httpMock.match((r) => r.url === `${BASE}/recobros` && r.method === 'GET');

  /** Atiende las peticiones de la bandeja: los dos conteos (tamano 1) y el listado. */
  const responder = (filas: RecobroItem[] = [REC_A, REC_B], conteos = { PENDIENTE: 7, RADICADO: 3 }): TestRequest | undefined => {
    let listado: TestRequest | undefined;
    for (const req of recobros()) {
      const p = req.request.params;
      if (p.get('tamano') === '1') {
        req.flush(paginaPrueba([], conteos[p.get('situacion') as 'PENDIENTE' | 'RADICADO'] ?? 0, 0, 1));
      } else {
        listado = req;
        req.flush(paginaPrueba(filas, filas.length));
      }
    }
    return listado;
  };

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    cierre = new Subject<unknown>();
    dialogoFalso = { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => cierre.asObservable() }) };

    await TestBed.configureTestingModule({
      imports: [RecobroComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MatDialog, useValue: dialogoFalso },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecobroComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${BASE}/eps-matriz`).flush([]);
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  it('al entrar trae los conteos por situacion y la bandeja de PENDIENTES', () => {
    const peticiones = recobros();
    expect(peticiones.length).toBe(3);
    const listado = peticiones.find((r) => r.request.params.get('tamano') !== '1')!;
    expect(listado.request.params.get('situacion')).toBe('PENDIENTE');
    expect(listado.request.params.get('pagina')).toBe('0');
    expect(listado.request.params.get('tamano')).toBe('25');
    expect(listado.request.params.has('q')).toBeFalse();
    for (const r of peticiones) {
      const s = r.request.params.get('situacion');
      r.flush(r.request.params.get('tamano') === '1' ? paginaPrueba([], s === 'PENDIENTE' ? 7 : 3, 0, 1) : paginaPrueba([REC_A, REC_B], 2));
    }
    expect(componente.conteoPendientes()).toBe(7);
    expect(componente.conteoRadicados()).toBe(3);
    expect(componente.filas().length).toBe(2);
    expect(componente.total()).toBe(2);
  });

  it('cambiar la situacion consulta de nuevo desde la primera pagina con los filtros', () => {
    responder();
    componente.filtros = { q: ' 1005 ', eps: 'NUEVA EPS' };
    componente.cambiarSituacion('RADICADO');
    const req = recobros()[0];
    expect(req.request.params.get('situacion')).toBe('RADICADO');
    expect(req.request.params.get('q')).toBe('1005');
    expect(req.request.params.get('eps')).toBe('NUEVA EPS');
    expect(req.request.params.get('pagina')).toBe('0');
    req.flush(paginaPrueba([REC_B], 1));

    componente.cambiarSituacion('TODOS');
    const todos = recobros()[0];
    expect(todos.request.params.get('situacion')).toBe('TODOS');
    todos.flush(paginaPrueba([], 0));
  });

  it('la paginacion va al servidor y un blur sin cambios no repite la consulta', () => {
    responder();
    componente.paginar({ pagina: 3, porPagina: 50 });
    const req = recobros()[0];
    expect(req.request.params.get('pagina')).toBe('3');
    expect(req.request.params.get('tamano')).toBe('50');
    req.flush(paginaPrueba([], 0));
    componente.filtrar();
    expect(recobros().length).toBe(0);
  });

  it('"Registrar radicado de recobro" abre el dialogo con las marcadas y recarga al guardar', () => {
    responder();
    componente.seleccion.select(componente.filas()[0], componente.filas()[1]);
    expect(componente.marcadas()).toBe(2);
    componente.registrarSeleccion();

    const [tipo, config] = dialogoFalso.open.calls.mostRecent().args as [unknown, { data: { items: RecobroItem[] }; panelClass: string }];
    expect(tipo).toBe(DialogoRegistrarRecobroComponent);
    expect(config.data.items.map((i) => i.incapacidad.id)).toEqual([31, 32]);
    expect(config.panelClass).toBe('disab-dialogo');

    cierre.next({ recargar: true });
    expect(componente.marcadas()).toBe(0);
    expect(recobros().length).toBe(3); // conteos + listado
    responder();
  });

  it('cerrar el dialogo sin guardar no recarga', () => {
    responder();
    componente.registrar([REC_A]);
    cierre.next({ recargar: false });
    expect(recobros().length).toBe(0);
  });

  it('"Ver radicados" abre el dialogo de la incapacidad', () => {
    responder();
    componente.verRadicados(REC_B);
    const [tipo, config] = dialogoFalso.open.calls.mostRecent().args as [unknown, { data: { item: RecobroItem } }];
    expect(tipo).toBe(DialogoRadicadosRecobroComponent);
    expect(config.data.item.incapacidad.id).toBe(32);
    cierre.next({ recargar: true });
    responder();
  });

  it('un error de la bandeja queda a la vista', () => {
    for (const r of recobros()) {
      if (r.request.params.get('tamano') === '1') r.flush(paginaPrueba([], 0, 0, 1));
      else r.flush({ error: 'Fallo' }, { status: 500, statusText: 'Server Error' });
    }
    expect(componente.error()).toBe('Fallo');
  });

  it('pinta causal, homologada y situacion de cada fila', () => {
    responder([REC_A]);
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('NO SE EVIDENCIA PAGO DE SEGURIDAD SOCIAL');
    expect(texto).toContain('SIN_PAGO_SS');
    expect(texto).toContain('Pendiente de recobro');
  });
});

describe('recobro.utils', () => {
  it('situacionDe respeta el filtro y en TODOS deduce como el backend', () => {
    expect(situacionDe(REC_A, 'RADICADO')).toBe('RADICADO');
    expect(situacionDe(REC_A)).toBe('PENDIENTE'); // sin recobros
    expect(situacionDe(REC_B)).toBe('RADICADO'); // amarrado a la ultima negacion
    const viejo = recobroPrueba({
      recobros: [radicadoPrueba({ tipo: 'RECOBRO', negacionId: 1, creadoEn: '2026-02-01T00:00:00Z' })],
    });
    expect(situacionDe(viejo)).toBe('PENDIENTE'); // anterior a la ultima negacion
    const sinNegacion = recobroPrueba({ negacion: null, recobros: [radicadoPrueba({ tipo: 'RECOBRO' })] });
    expect(situacionDe(sinNegacion)).toBe('RADICADO');
  });

  it('ultimoRecobro ignora los anulados', () => {
    const item = recobroPrueba({
      recobros: [
        radicadoPrueba({ id: 1, tipo: 'RECOBRO', numeroRadicado: 'A' }),
        radicadoPrueba({ id: 2, tipo: 'RECOBRO', numeroRadicado: 'B', anulado: true }),
      ],
    });
    expect(ultimoRecobro(item)?.numeroRadicado).toBe('A');
    expect(ultimoRecobro(REC_A)).toBeNull();
  });

  it('causalHomologada une codigo y nombre o queda vacia', () => {
    expect(causalHomologada(REC_A)).toBe('SIN_PAGO_SS · Sin pago de seguridad social');
    expect(causalHomologada(recobroPrueba({ negacion: { ...REC_A.negacion!, causalCodigo: null, causalNombre: null } }))).toBe('');
    expect(causalHomologada(recobroPrueba({ negacion: null }))).toBe('');
  });

  it('rotularRadicados numera los recobros vigentes en orden', () => {
    const r = rotularRadicados([
      radicadoPrueba({ id: null, tipo: 'RADICACION' }),
      radicadoPrueba({ id: 2, tipo: 'RECOBRO' }),
      radicadoPrueba({ id: 3, tipo: 'RECOBRO', anulado: true }),
      radicadoPrueba({ id: 4, tipo: 'RECOBRO' }),
    ]);
    expect(r.map((x) => x.rotulo)).toEqual(['Radicación inicial', 'Recobro 1', 'Recobro anulado', 'Recobro 2']);
  });
});

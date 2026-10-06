import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { environment } from '@/environments/environment';
import type { RadicadoItem } from '../../models/incapacidad-salud.model';
import { DialogoCargaMasivaRadicadosComponent } from '../consulta-incapacidades/dialogos/dialogo-carga-masiva-radicados/dialogo-carga-masiva-radicados.component';
import { encontradoPrueba, paginaPrueba, radicadoPrueba, refPrueba, resultadoPrueba } from './radicacion.datos-prueba';
import { RadicacionComponent, TAB_RECIENTES } from './radicacion.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

const PEND_A = refPrueba({ id: 21, codigoUnico: '2120260101', codigoOficina: 'APSB021', nombreCompleto: 'RUIZ ANA' });
const PEND_B = refPrueba({ id: 22, codigoUnico: '2220260102', codigoOficina: null, nombreCompleto: 'DIAZ LUIS', estado: 'PENDIENTE_RADICACION' });

describe('RadicacionComponent', () => {
  let fixture: ComponentFixture<RadicacionComponent>;
  let componente: RadicacionComponent;
  let httpMock: HttpTestingController;
  let dialogoFalso: { open: jasmine.Spy };

  const pendientes = (): TestRequest => httpMock.expectOne((r) => r.url === `${BASE}/radicacion/pendientes`);
  const historial = (): TestRequest => httpMock.expectOne((r) => r.url === `${BASE}/radicacion/historial`);

  beforeEach(async () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    dialogoFalso = { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of({ recargar: true }) }) };

    await TestBed.configureTestingModule({
      imports: [RadicacionComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MatDialog, useValue: dialogoFalso },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RadicacionComponent);
    componente = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${BASE}/eps-matriz`).flush([
      { nombre: 'NUEVA EPS', formaCargue: 'UN_PDF', formaCargueEtiqueta: 'Un PDF', requiereSoporteEps: false, orden: 1 },
      { nombre: 'SALUD TOTAL', formaCargue: 'UN_PDF', formaCargueEtiqueta: 'Un PDF', requiereSoporteEps: true, orden: 2 },
    ]);
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  it('al entrar pide las pendientes de la primera pagina, solo del aplicativo, sin claves vacias', () => {
    const req = pendientes();
    expect(req.request.method).toBe('GET');
    const p = req.request.params;
    expect(p.get('pagina')).toBe('0');
    expect(p.get('tamano')).toBe('25');
    expect(p.get('soloAplicativo')).toBe('true');
    expect(p.has('q')).toBeFalse();
    expect(p.has('eps')).toBeFalse();
    expect(p.has('entidadGrupo')).toBeFalse();
    req.flush(paginaPrueba([PEND_A, PEND_B], 42));
    expect(componente.pendientes().length).toBe(2);
    expect(componente.totalPendientes()).toBe(42);
    expect(componente.epsOpciones()).toEqual(['NUEVA EPS', 'SALUD TOTAL']);
  });

  it('los filtros viajan al servidor y vuelven a la primera pagina; sin cambios no repite la consulta', () => {
    pendientes().flush(paginaPrueba([PEND_A], 1));
    componente.paginarPendientes({ pagina: 2, porPagina: 50 });
    pendientes().flush(paginaPrueba([], 1, 2, 50));

    componente.filtros = { q: ' 1005 ', eps: 'SALUD TOTAL', oficina: 'SOACHA', entidadGrupo: 'APOYO', soloAplicativo: false };
    componente.filtrarPendientes();
    const p = pendientes().request.params;
    expect(p.get('q')).toBe('1005');
    expect(p.get('eps')).toBe('SALUD TOTAL');
    expect(p.get('oficina')).toBe('SOACHA');
    expect(p.get('entidadGrupo')).toBe('APOYO');
    expect(p.get('soloAplicativo')).toBe('false');
    expect(p.get('pagina')).toBe('0');
    expect(p.get('tamano')).toBe('50');

    componente.filtrarPendientes(); // blur sin cambios
    httpMock.expectNone((r) => r.url === `${BASE}/radicacion/pendientes`);
  });

  it('un filtro nuevo cancela la consulta en vuelo: una respuesta vieja no pisa la tabla', () => {
    const vieja = pendientes();
    componente.filtros = { ...componente.filtros, eps: 'SALUD TOTAL' };
    componente.filtrarPendientes();
    expect(vieja.cancelled).toBeTrue();
    const nueva = pendientes();
    expect(nueva.request.params.get('eps')).toBe('SALUD TOTAL');
    nueva.flush(paginaPrueba([PEND_B], 1));
    expect(componente.pendientes().map((r) => r.id)).toEqual([22]);
    expect(componente.cargandoPendientes()).toBeFalse();
  });

  it('un error al cargar pendientes queda a la vista', () => {
    pendientes().flush({ error: 'Servicio no disponible' }, { status: 503, statusText: 'Service Unavailable' });
    expect(componente.errorPendientes()).toBe('Servicio no disponible');
    expect(componente.cargandoPendientes()).toBeFalse();
  });

  it('pendientes → "Agregar a radicar" lleva las marcadas al bloque de codigos sin teclear', () => {
    pendientes().flush(paginaPrueba([PEND_A, PEND_B], 2));
    fixture.detectChanges();

    componente.seleccionPendientes.select(PEND_A, PEND_B);
    expect(componente.marcadasPendientes()).toBe(2);
    componente.agregarSeleccion();

    const req = httpMock.expectOne(`${BASE}/radicacion/buscar`);
    expect(req.request.body).toEqual({ codigos: ['2120260101', '2220260102'], modo: 'RADICACION' });
    req.flush({
      encontrados: [
        encontradoPrueba({ codigo: '2120260101' }, PEND_A),
        encontradoPrueba({ codigo: '2220260102' }, PEND_B),
      ],
      noEncontrados: [],
    });

    const panel = componente.panel()!;
    expect(panel.encontrados().map((e) => e.incapacidad.id)).toEqual([21, 22]);
    expect(panel.cantidadMarcadas()).toBe(2);
    expect(componente.marcadasPendientes()).toBe(0);
    // Lo que ya esta en el bloque se resalta en pendientes.
    expect(componente.clasePendiente(PEND_A)).toBe('te-fila--info');
  });

  it('al guardar en el bloque se recargan pendientes (y recientes si ya se abrieron)', () => {
    pendientes().flush(paginaPrueba([PEND_A], 1));
    componente.cambiarTab(TAB_RECIENTES);
    historial().flush(paginaPrueba<RadicadoItem>([], 0));

    componente.panel()!.guardado.emit(resultadoPrueba([{ id: 21, ok: true }]));
    pendientes().flush(paginaPrueba([], 0));
    const req = historial();
    expect(req.request.params.get('pagina')).toBe('0');
    req.flush(paginaPrueba([radicadoPrueba()], 1));
    expect(componente.totalPendientes()).toBe(0);
    expect(componente.historial().length).toBe(1);
  });

  describe('radicados recientes', () => {
    beforeEach(() => pendientes().flush(paginaPrueba([], 0)));

    it('se cargan al abrir la pestana, una sola vez, con tipo RADICACION', () => {
      componente.cambiarTab(TAB_RECIENTES);
      const req = historial();
      expect(req.request.params.get('tipo')).toBe('RADICACION');
      expect(req.request.params.get('pagina')).toBe('0');
      req.flush(paginaPrueba([radicadoPrueba({ numeroAnterior: 'VIEJO', lote: 'abc' })], 1));
      expect(componente.totalHistorial()).toBe(1);

      componente.cambiarTab(0);
      componente.cambiarTab(TAB_RECIENTES);
      httpMock.expectNone((r) => r.url === `${BASE}/radicacion/historial`);
    });

    it('la busqueda y la paginacion van al servidor', () => {
      componente.cambiarTab(TAB_RECIENTES);
      historial().flush(paginaPrueba<RadicadoItem>([], 0));

      componente.buscarHistorial('RAD-7');
      const req = historial();
      expect(req.request.params.get('q')).toBe('RAD-7');
      expect(req.request.params.get('pagina')).toBe('0');
      req.flush(paginaPrueba<RadicadoItem>([], 0));

      componente.paginarHistorial({ pagina: 1, porPagina: 100 });
      const req2 = historial();
      expect(req2.request.params.get('pagina')).toBe('1');
      expect(req2.request.params.get('tamano')).toBe('100');
      expect(req2.request.params.get('q')).toBe('RAD-7');
      req2.flush(paginaPrueba<RadicadoItem>([], 0));
    });
  });

  it('la carga masiva por Excel de siempre sigue disponible y recarga al cerrar', () => {
    pendientes().flush(paginaPrueba([], 0));
    componente.abrirCargaMasiva();
    expect(dialogoFalso.open).toHaveBeenCalledWith(DialogoCargaMasivaRadicadosComponent, jasmine.objectContaining({ panelClass: 'disab-dialogo' }));
    pendientes().flush(paginaPrueba([], 0));
  });

  it('pinta la cabecera, el bloque de codigos y las pestanas', () => {
    pendientes().flush(paginaPrueba([PEND_A], 1));
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Radicación');
    expect(texto).toContain('Radicar por código único');
    expect(texto).toContain('Pendientes por radicar');
    expect(texto).toContain('Radicados recientes');
  });
});

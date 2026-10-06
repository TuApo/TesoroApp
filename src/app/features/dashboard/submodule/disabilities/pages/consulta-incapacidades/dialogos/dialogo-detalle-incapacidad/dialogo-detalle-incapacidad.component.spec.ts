/**
 * Pruebas del detalle de una incapacidad, centradas en la seccion "Radicados y liquidacion"
 * (reunion 2026-10-05): TODOS los radicados (inicial + recobros) y la respuesta de la EPS
 * (pagos, negaciones y terminacion), con carga perezosa y tolerante a error.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';
import {
  LiquidacionIncapacidad,
  RadicadoItem,
} from '../../../../models/incapacidad-salud.model';
import { IncapacidadResumenExtendido } from '../../consulta-incapacidades.model';
import {
  DatosDialogoDetalle,
  DialogoDetalleIncapacidadComponent,
  pesos,
  radicadoAVista,
} from './dialogo-detalle-incapacidad.component';

const BASE = `${environment.apiUrl}/Incapacidades/v2`;

const RESUMEN: IncapacidadResumenExtendido = {
  id: 7,
  cedula: '1001',
  nombreCompleto: 'PEREZ GOMEZ JUAN CARLOS',
  tipoIncapacidad: 'ENFERMEDAD_GENERAL',
  fechaInicio: '2026-09-01',
  fechaFin: '2026-09-05',
  dias: 5,
  estado: 'RECOBRO',
  estadoDocumento: 'OK',
  responsablePago: 'EPS',
  eps: 'SALUD TOTAL EPS',
};

/** Un radicado con overrides puntuales. */
function radicado(parcial: Partial<RadicadoItem> = {}): RadicadoItem {
  return {
    id: 1,
    incapacidadId: 7,
    codigoUnico: '100120260901',
    codigoOficina: 'TASB018',
    cedula: '1001',
    nombreCompleto: 'PEREZ GOMEZ JUAN CARLOS',
    eps: 'SALUD TOTAL EPS',
    tipo: 'RADICACION',
    tipoEtiqueta: 'Radicacion',
    numeroRadicado: 'RAD-001',
    fechaRadicado: '2026-09-08',
    dondeRadicado: 'PAGINA',
    dondeRadicadoEtiqueta: 'Portal web',
    entidad: 'SALUD TOTAL EPS',
    lote: null,
    numeroAnterior: null,
    negacionId: null,
    observaciones: null,
    radicadoPor: 'luis.carlos',
    creadoEn: '2026-09-08T10:00:00',
    anulado: false,
    ...parcial,
  };
}

const LIQUIDACION: LiquidacionIncapacidad = {
  pagos: [
    {
      id: 31,
      incapacidad: null as never,
      eps: 'SALUD TOTAL EPS',
      valorPagado: 350184,
      diasLiquidados: 3,
      diasAutorizados: 3,
      fechaPago: '2026-07-03',
      numeroIncapacidadEps: '0072',
      soporteContable: 'DOC 072',
      observaciones: null,
      cargaId: 4,
      creadoPor: 'ligia',
      creadoEn: '2026-10-01T10:00:00',
      anulado: false,
    },
  ],
  negaciones: [
    {
      id: 41,
      incapacidad: null as never,
      eps: 'SALUD TOTAL EPS',
      diasLiquidados: 2,
      fechaRespuesta: '2026-09-20',
      causalTexto: 'NO SE EVIDENCIA PAGO DE SEGURIDAD SOCIAL',
      causalId: 3,
      causalCodigo: 'SIN_PAGO_SS',
      causalNombre: 'Sin pago de seguridad social',
      accion: 'RECOBRO',
      accionEtiqueta: null,
      terminacion: null,
      sinHomologar: false,
      observaciones: null,
      cargaId: 4,
      creadoPor: 'ligia',
      creadoEn: '2026-10-01T10:00:00',
      anulado: false,
    },
  ],
  valorPagadoTotal: 350184,
  terminacion: 'RECOBRO EN CURSO',
};

describe('DialogoDetalleIncapacidadComponent', () => {
  let fixture: ComponentFixture<DialogoDetalleIncapacidadComponent>;
  let comp: DialogoDetalleIncapacidadComponent;
  let http: HttpTestingController;

  function crear(resumen: IncapacidadResumenExtendido = RESUMEN): void {
    const datos: DatosDialogoDetalle = { id: 7, resumen };
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: datos });
    fixture = TestBed.createComponent(DialogoDetalleIncapacidadComponent);
    comp = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  /** Responde el detalle y la radicacion (V44), que son las peticiones del arranque. */
  function responderArranque(detalle: Record<string, unknown> = {}): void {
    http.expectOne(`${BASE}/7/radicacion`).flush(
      { error: 'sin radicacion' },
      { status: 404, statusText: 'Not Found' },
    );
    http.expectOne(`${BASE}/7`).flush({
      id: 7,
      cedula: '1001',
      nombreCompleto: 'PEREZ GOMEZ JUAN CARLOS',
      estado: 'RECOBRO',
      cargo: 'OPERARIO DE CAMPO',
      ...detalle,
    });
  }

  function texto(): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    localStorage.removeItem('token');
    await TestBed.configureTestingModule({
      imports: [DialogoDetalleIncapacidadComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { id: 7, resumen: RESUMEN } },
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  it('no pide radicados ni liquidacion hasta tener el detalle (carga perezosa)', () => {
    crear();
    http.expectNone(`${BASE}/7/radicados`);
    http.expectNone(`${BASE}/7/liquidacion`);

    responderArranque();

    // En RECOBRO la seccion se consulta sola, una vez llegado el detalle.
    http.expectOne(`${BASE}/7/radicados`).flush([]);
    http.expectOne(`${BASE}/7/liquidacion`).flush({
      pagos: [],
      negaciones: [],
      valorPagadoTotal: 0,
      terminacion: null,
    });
    expect(comp.saludConsultada()).toBeTrue();
    expect(texto()).toContain('Sin radicados registrados');
  });

  it('lista TODOS los radicados (inicial y recobros) y la liquidacion con su terminacion', () => {
    crear();
    responderArranque();

    http.expectOne(`${BASE}/7/radicados`).flush([
      // Radicado inicial historico (solo vive en la fila de la incapacidad): id null.
      radicado({ id: null }),
      radicado({
        id: 5,
        tipo: 'RECOBRO',
        tipoEtiqueta: 'Recobro',
        numeroRadicado: 'PQR-77',
        fechaRadicado: '2026-09-25',
        dondeRadicado: 'PUNTO_FISICO',
        dondeRadicadoEtiqueta: 'Punto fisico',
        radicadoPor: 'ligia',
      }),
    ]);
    http.expectOne(`${BASE}/7/liquidacion`).flush(LIQUIDACION);

    const t = texto();
    expect(t).toContain('Radicados y liquidación');
    // Radicados: tipo, numero, fecha, donde (con los nombres de la funcional) y quien.
    expect(t).toContain('RAD-001');
    expect(t).toContain('08/09/2026');
    expect(t).toContain('Página web');
    expect(t).toContain('luis.carlos');
    expect(t).toContain('Recobro');
    expect(t).toContain('PQR-77');
    expect(t).toContain('Presencial');
    // Pagos: fecha, valor y dias.
    expect(t).toContain('350.184');
    expect(t).toContain('Pagado el 03/07/2026');
    expect(t).toContain('3 días liquidados');
    // Negaciones: fecha de respuesta, causal (homologada) y accion.
    expect(t).toContain('Sin pago de seguridad social');
    expect(t).toContain('Respuesta del 20/09/2026');
    expect(t).toContain('Pasa a recobro');
    // Terminacion.
    expect(t).toContain('RECOBRO EN CURSO');
    // El cargo (nuevo) se muestra en la ficha.
    expect(t).toContain('OPERARIO DE CAMPO');
  });

  it('si un endpoint falla, la seccion avisa y el resto del dialogo sigue funcionando', () => {
    crear();
    responderArranque();

    http
      .expectOne(`${BASE}/7/radicados`)
      .flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    http.expectOne(`${BASE}/7/liquidacion`).flush(LIQUIDACION);

    const t = texto();
    expect(comp.errorRadicadosSalud()).toBe('boom');
    expect(t).toContain('boom');
    // La liquidacion, que si respondio, se pinta igual.
    expect(t).toContain('350.184');
    // Y el resto del detalle sigue ahi.
    expect(t).toContain('PEREZ GOMEZ JUAN CARLOS');
    expect(comp.grupos().length).toBeGreaterThan(0);
    expect(comp.error()).toBe('');
  });

  it('con ambos endpoints caidos (backend anterior) solo avisa, sin romper el dialogo', () => {
    crear();
    responderArranque();

    http.expectOne(`${BASE}/7/radicados`).flush(null, { status: 404, statusText: 'Not Found' });
    http.expectOne(`${BASE}/7/liquidacion`).flush(null, { status: 404, statusText: 'Not Found' });

    const t = texto();
    expect(t).toContain('No se pudieron consultar los radicados');
    expect(t).toContain('No se pudo consultar la liquidación');
    expect(comp.cargandoSalud()).toBeFalse();
  });

  it('en RECIBIDA no la consulta sola: queda el boton "Consultar"', () => {
    crear({ ...RESUMEN, estado: 'RECIBIDA' });
    responderArranque({ estado: 'RECIBIDA' });

    http.expectNone(`${BASE}/7/radicados`);
    http.expectNone(`${BASE}/7/liquidacion`);
    expect(texto()).toContain('Consultar');

    const boton = (fixture.nativeElement as HTMLElement).querySelector(
      '.det-salud-consultar',
    ) as HTMLButtonElement;
    boton.click();

    http.expectOne(`${BASE}/7/radicados`).flush([]);
    http.expectOne(`${BASE}/7/liquidacion`).flush({
      pagos: [],
      negaciones: [],
      valorPagadoTotal: 0,
      terminacion: '',
    });
    expect(texto()).toContain('La EPS todavía no ha respondido');
  });

  it('sin cargo (incapacidades anteriores) la ficha no pinta la fila de cargo', () => {
    crear({ ...RESUMEN, estado: 'RECIBIDA' });
    responderArranque({ estado: 'RECIBIDA', cargo: null });

    const vinculacion = comp.grupos().find((g) => g.titulo === 'Vinculacion');
    expect(vinculacion?.campos.some((c) => c.etiqueta === 'Cargo')).toBeFalse();
  });
});

describe('detalle: utilidades de radicados y liquidacion', () => {
  it('radicadoAVista usa Pagina web / Correo / Presencial y marca el inicial historico', () => {
    const inicial = radicadoAVista(radicado({ id: null }), 0);
    expect(inicial.clave).toBe('inicial-0');
    expect(inicial.tipo).toBe('Radicación');
    expect(inicial.donde).toBe('Página web');
    expect(inicial.fecha).toBe('08/09/2026');

    const recobro = radicadoAVista(radicado({ id: 9, tipo: 'RECOBRO', dondeRadicado: 'CORREO' }), 1);
    expect(recobro.tipo).toBe('Recobro');
    expect(recobro.esRecobro).toBeTrue();
    expect(recobro.donde).toBe('Correo');

    const sinCanal = radicadoAVista(radicado({ dondeRadicado: null, dondeRadicadoEtiqueta: null }), 2);
    expect(sinCanal.donde).toBe('—');
  });

  it('pesos formatea en COP sin decimales y tolera vacios', () => {
    expect(pesos(350184)).toContain('350.184');
    expect(pesos(null)).toBe('—');
  });
});

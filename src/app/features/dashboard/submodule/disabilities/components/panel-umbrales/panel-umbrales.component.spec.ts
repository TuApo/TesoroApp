import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';

import { CadenaUmbral, InformeUmbrales } from '../../models/incapacidad-gestion.model';
import { PanelUmbralesComponent } from './panel-umbrales.component';

const URL_UMBRALES = `${environment.apiUrl}/Incapacidades/v2/informes/umbrales`;

function cadena(extra: Partial<CadenaUmbral>): CadenaUmbral {
  return {
    incapacidadId: 1, codigoConsecutivo: null, cedula: '1', nombreCompleto: 'X', empresa: 'ELITE',
    centroCosto: 'BELCHITE', oficina: 'MADRID', entidadGrupo: 'APOYO', eps: 'NUEVA EPS', afp: 'PORVENIR',
    codigoDiagnostico: 'M545', descripcionDiagnostico: 'Lumbago', fechaInicioUltima: null,
    fechaFinUltima: null, diasUltima: 10, origen: null, situacion: 'VIGENTE',
    situacionEtiqueta: 'Incapacitado hoy', motivoRevision: null, inicioCadena: null,
    diasAcumuladosFin: 0, diasAcumuladosHoy: 0, fechaPasaFondo: null, fondoCertificado: false,
    fechaVuelveEps: null, epsCertificado: false, pagadorHoy: 'EPS', pagadorHoyEtiqueta: 'EPS',
    ...extra,
  };
}

// Corte 28/09/2026.
const INFORME: InformeUmbrales = {
  fechaCorte: '2026-09-28', umbralFondo: 180, umbralEps: 540, ventanaRecienteDias: 30,
  horizontes: [15, 30, 60, 90],
  conteos: { VIGENTE: 2, RECIENTE: 1, HISTORICO: 1, POR_REVISAR: 1 },
  cadenas: [
    // Hoy en el dia 170 (inicio 12/04/2026), registrado hasta el 03/10 (dia 175): dia 181 el 09/10.
    cadena({ incapacidadId: 11, cedula: '111', nombreCompleto: 'ANA PEREZ', inicioCadena: '2026-04-12',
      fechaFinUltima: '2026-10-03', diasAcumuladosFin: 175, diasAcumuladosHoy: 170,
      fechaPasaFondo: '2026-10-09', fondoCertificado: false, fechaVuelveEps: '2027-10-04' }),
    // Hoy en el dia 200: ya con el fondo.
    cadena({ incapacidadId: 12, cedula: '222', nombreCompleto: 'LUIS GOMEZ', inicioCadena: '2026-03-13',
      fechaFinUltima: '2026-10-20', diasAcumuladosFin: 222, diasAcumuladosHoy: 200,
      fechaPasaFondo: '2026-09-09', fondoCertificado: true, fechaVuelveEps: '2027-09-04',
      pagadorHoy: 'FONDO_PENSIONES' }),
    cadena({ incapacidadId: 13, cedula: '333', nombreCompleto: 'MARIA RIOS', situacion: 'RECIENTE',
      situacionEtiqueta: 'Termino hace poco', fechaFinUltima: '2026-09-20', diasAcumuladosFin: 250,
      diasAcumuladosHoy: 250, pagadorHoy: 'FONDO_PENSIONES' }),
    cadena({ incapacidadId: 14, cedula: '444', nombreCompleto: 'JUAN VIEJO', situacion: 'HISTORICO',
      situacionEtiqueta: 'Historico', fechaFinUltima: '2023-01-30', diasAcumuladosFin: 400, diasAcumuladosHoy: 400 }),
    cadena({ incapacidadId: 15, cedula: '555', nombreCompleto: 'ERROR DIGITACION', situacion: 'POR_REVISAR',
      situacionEtiqueta: 'Fechas por revisar', fechaInicioUltima: '2026-05-26', fechaFinUltima: '2926-05-27',
      motivoRevision: 'Una sola incapacidad de 328.720 dias: revise la fecha fin',
      diasAcumuladosFin: 328720, diasAcumuladosHoy: 328720 }),
  ],
};

describe('PanelUmbralesComponent', () => {
  let fixture: ComponentFixture<PanelUmbralesComponent>;
  let panel: PanelUmbralesComponent;
  let httpMock: HttpTestingController;

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanelUmbralesComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PanelUmbralesComponent);
    panel = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne(URL_UMBRALES).flush(INFORME);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
  });

  it('arranca en "casos activos": incapacitados hoy + terminaron hace poco, sin historia ni errores', () => {
    expect(panel.alcance()).toBe('ACTIVOS');
    expect(panel.conteoAlcance().ACTIVOS).toBe(3);
    expect(panel.filas().map((f) => f.c.incapacidadId)).toEqual([11, 12, 13]);
    expect(texto()).toContain('Casos activos');
    expect(texto()).toContain('Corte: 28/09/2026');
  });

  it('el panorama cuenta hoy y a 15/30/60/90 dias', () => {
    const cortes = panel.cortes();
    expect(cortes.map((c) => c.dias)).toEqual([0, 15, 30, 60, 90]);
    expect(cortes[0].conFondo).toBe(2);     // LUIS (200) + MARIA (250, termino hace poco)
    expect(cortes[1].pasanAlFondo).toBe(1); // ANA pasa el dia 181 el 09/10 si sigue incapacitada
    expect(cortes[1].conFondo).toBe(3);
  });

  it('elegir "+N pasan al fondo" deja en la tabla solo a quienes cruzan en el periodo', () => {
    panel.elegirHorizonte(15, 'PASAN_FONDO');
    fixture.detectChanges();
    expect(panel.filas().map((f) => f.c.incapacidadId)).toEqual([11]);
    expect(panel.textoAnalisis()).toBe('el 13/10/2026');
  });

  it('apagar las prorrogas cuenta solo lo registrado: ANA no alcanza el dia 181', () => {
    panel.alternarProrrogas(false);
    panel.elegirHorizonte(15, 'PASAN_FONDO');
    expect(panel.filas().length).toBe(0);
  });

  it('historicos y fechas por revisar se ven aparte y sin panorama', () => {
    panel.elegirAlcance('HISTORICO');
    fixture.detectChanges();
    expect(panel.vistaActiva()).toBeFalse();
    expect(panel.filas().map((f) => f.c.incapacidadId)).toEqual([14]);
    expect(texto()).toContain('la cuenta se cerró');

    panel.elegirAlcance('POR_REVISAR');
    fixture.detectChanges();
    expect(panel.filas().map((f) => f.c.incapacidadId)).toEqual([15]);
    expect(panel.columnas().map((c) => c.id)).toContain('motivo');
    expect(panel.columnas().map((c) => c.id)).not.toContain('dia181');
  });

  it('textos del dia 181: ya ocurrio / si sigue incapacitado', () => {
    const [ana, luis] = panel.filas();
    const hoy = panel.hoy();
    expect(panel.textoHito(ana.c, ana.c.fechaPasaFondo, ana.c.fondoCertificado, 180, hoy))
      .toBe('si sigue incapacitado · en 11 días');
    expect(panel.textoHito(luis.c, luis.c.fechaPasaFondo, luis.c.fondoCertificado, 180, hoy))
      .toContain('ya ocurrió');
  });

  it('abrir lleva a la incapacidad', () => {
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    panel.abrirIncapacidad(panel.filas()[0]);
    expect(nav).toHaveBeenCalledWith(['/dashboard/disabilities/registro', 11]);
  });
});

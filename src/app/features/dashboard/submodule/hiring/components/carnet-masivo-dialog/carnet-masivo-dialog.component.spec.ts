/**
 * Generación masiva de carnets — pruebas de componente.
 *
 * Es donde más lógica se cambió y nada de eso se había verificado:
 *   - Apoyo y Tu Alianza usan FORMATOS distintos y no pueden compartir hoja.
 *   - El conteo de hojas se hace por temporal (5 + 5 son 2 hojas, no 1).
 *   - Sin temporal en la vacante la fila se bloquea, en vez de asumir Apoyo.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';

import { CarnetMasivoDialogComponent } from './carnet-masivo-dialog.component';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { VacantesService } from '../../../vacancies/service/vacantes/vacantes.service';
import { normalizarPorHoja } from '../generate-contracting-documents/carnet-impresion';
import { buildCarnetApoyoLotePdf } from '../generate-contracting-documents/carnet-apoyo-fill';
import { buildCarnetsMasivoPdf } from '../generate-contracting-documents/carnet-masivo-fill';

const CLAVE_POR_HOJA = 'carnet.impresion.por_hoja';

/** Páginas del PDF (cada hoja son 2: frentes y reversos). */
async function paginas(blob: Blob): Promise<number> {
  const txt = await blob.text();
  return (txt.match(/\/Type \/Page[^s]/g) ?? []).length;
}

/** Fila lista para generar (sin datos faltantes). */
function fila(temporal: 'apoyo' | 'alianza', cedula = '1000000001') {
  return {
    cedula, nombre: 'BAZA GARCIA LEIVIS', tipoDoc: 'CC',
    yaGenerado: false, faltantes: [], error: null, procesoId: 1,
    temporal, apellidos: 'BAZA GARCIA', nombres: 'LEIVIS ESTHER',
    datos: {
      nombreCompleto: 'BAZA GARCIA LEIVIS ESTHER', cedula,
      centroCostos: 'FANTASY', cargo: 'CULTIVO', consecutivo: '180005',
      fechaIngreso: '04/08/2026', eps: 'SURA', afp: 'PORVENIR',
      emergenciaNombre: 'MARIA', emergenciaTelefono: '3001234567',
      logoDataUrl: null, fotoDataUrl: null,
    },
  } as any;
}

describe('CarnetMasivoDialogComponent', () => {
  let fixture: ComponentFixture<CarnetMasivoDialogComponent>;
  let comp: CarnetMasivoDialogComponent;

  beforeEach(async () => {
    // La preferencia de otro test (o del navegador) no puede cambiar las cuentas.
    localStorage.removeItem(CLAVE_POR_HOJA);
    await TestBed.configureTestingModule({
      imports: [CarnetMasivoDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: MAT_DIALOG_DATA, useValue: { cedulas: [] } },
        {
          provide: RegistroProcesoContratacion,
          useValue: {
            getCandidatoPorDocumento: () => of(null),
            updateProcesoByDocumento: () => of({}),
          },
        },
        {
          provide: GestionDocumentalService,
          useValue: { guardarDocumento: () => of({ id: 1 }) },
        },
        { provide: VacantesService, useValue: { obtenerVacante: () => of(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CarnetMasivoDialogComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** Carga filas y las marca todas. */
  function cargar(filas: any[]) {
    comp.filas.set(filas);
    comp.marcarTodas(true);
    fixture.detectChanges();
  }

  // ─────────────────────────────────────────────────────────────
  describe('separación por temporal', () => {

    it('cuenta por separado las de cada temporal', () => {
      cargar([fila('apoyo', '1'), fila('apoyo', '2'), fila('alianza', '3')]);
      expect(comp.porTemporal().apoyo).toBe(2);
      expect(comp.porTemporal().alianza).toBe(1);
    });

    it('5 de Apoyo + 5 de Alianza son DOS hojas, no una', () => {
      // Caben 9 por hoja, pero no comparten hoja: cada formato usa la suya.
      const filas = [
        ...Array.from({ length: 5 }, (_, i) => fila('apoyo', `a${i}`)),
        ...Array.from({ length: 5 }, (_, i) => fila('alianza', `b${i}`)),
      ];
      cargar(filas);
      expect(comp.seleccionadas().length).toBe(10);
      expect(comp.hojas()).toBe(2);
    });

    it('9 de una sola temporal caben en una hoja', () => {
      cargar(Array.from({ length: 9 }, (_, i) => fila('apoyo', `a${i}`)));
      expect(comp.hojas()).toBe(1);
    });

    it('10 de una sola temporal necesitan dos hojas', () => {
      cargar(Array.from({ length: 10 }, (_, i) => fila('alianza', `b${i}`)));
      expect(comp.hojas()).toBe(2);
    });

    it('sin nada marcado no hay hojas', () => {
      comp.filas.set([fila('apoyo')]);
      comp.marcarTodas(false);
      expect(comp.hojas()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('carnets por hoja', () => {

    it('por defecto la hoja va llena (9)', () => {
      expect(comp.porHoja()).toBe(9);
    });

    it('acota a 1..9: nada se desborda de la grilla', () => {
      expect(normalizarPorHoja(0)).toBe(9);
      expect(normalizarPorHoja(-3)).toBe(9);
      expect(normalizarPorHoja('x')).toBe(9);
      expect(normalizarPorHoja(null)).toBe(9);
      expect(normalizarPorHoja(1)).toBe(1);
      expect(normalizarPorHoja(4.7)).toBe(4);
      expect(normalizarPorHoja(12)).toBe(9);
    });

    it('las hojas se cuentan con lo elegido', () => {
      cargar(Array.from({ length: 10 }, (_, i) => fila('apoyo', `a${i}`)));
      comp.elegirPorHoja(4);
      expect(comp.hojas()).toBe(3);   // 4 + 4 + 2
      comp.elegirPorHoja(1);
      expect(comp.hojas()).toBe(10);
    });

    it('sigue separando por temporal con lo elegido', () => {
      cargar([
        ...Array.from({ length: 5 }, (_, i) => fila('apoyo', `a${i}`)),
        ...Array.from({ length: 3 }, (_, i) => fila('alianza', `b${i}`)),
      ]);
      comp.elegirPorHoja(2);
      expect(comp.hojas()).toBe(3 + 2);
    });

    it('se recuerda en el puesto', () => {
      comp.elegirPorHoja(6);
      expect(localStorage.getItem(CLAVE_POR_HOJA)).toBe('6');
      const otro = TestBed.createComponent(CarnetMasivoDialogComponent).componentInstance;
      expect(otro.porHoja()).toBe(6);
    });

    it('el PDF de Apoyo arma las hojas con lo elegido', async () => {
      const gente = Array.from({ length: 5 }, (_, i) => fila('apoyo', `${i}`).datos);
      expect(await paginas(buildCarnetApoyoLotePdf(gente, null, 2))).toBe(3 * 2);
      expect(await paginas(buildCarnetApoyoLotePdf(gente, null))).toBe(1 * 2);
    });

    it('el PDF de Tu Alianza arma las hojas con lo elegido', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({
        CEDULA: `${i}`, CODIGO: '1', APELLIDOS: 'A', NOMBRES: 'B', FECHA_INGRESO: '01/01/2026',
        CENTRO_COSTO: 'X', FAMILIAR_EMERGENCIA_NOMBRE: 'M', FAMILIAR_EMERGENCIA_TELEFONO: '3',
        TELEFONO_COORDINADOR: null, fotoDataUrl: null, qrDataUrl: null,
      })) as any[];
      const opts = { telefonoCoordinador: '1', arl: 'SURA' };
      expect(await paginas(buildCarnetsMasivoPdf(rows, { ...opts, porHoja: 3 }))).toBe(2 * 2);
      expect(await paginas(buildCarnetsMasivoPdf(rows, opts))).toBe(1 * 2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('vista previa', () => {

    it('entra todo lo marcado, aunque le falten datos', () => {
      cargar([
        fila('apoyo', '1'),
        { ...fila('apoyo', '2'), faltantes: ['foto', 'EPS'] },
        { ...fila('alianza', '3'), datos: null, error: 'No se encontró el candidato.' },
      ]);
      expect(comp.aPrevisualizar().length).toBe(3);
      expect(comp.seleccionadas().length).toBe(1);
      expect(comp.soloVistaPrevia()).toBe(2);
      expect(comp.hojasPrevia()).toBe(2);   // una de Apoyo y una de Tu Alianza
      expect(comp.hojas()).toBe(1);
    });

    it('"solo pendientes" también marca a los incompletos', () => {
      comp.filas.set([
        { ...fila('apoyo', '1'), faltantes: ['foto'] },
        { ...fila('apoyo', '2'), yaGenerado: true },
      ]);
      comp.soloPendientes();
      expect(comp.aPrevisualizar().map(f => f.cedula)).toEqual(['1']);
    });

    it('a quien le falta todo se pinta con la cédula y lo demás en blanco', () => {
      const d = (comp as any).datosVistaPrevia({ ...fila('apoyo', '77'), datos: null, nombre: '' });
      expect(d.cedula).toBe('77');
      expect(d.eps).toBe('');
      const blob = buildCarnetApoyoLotePdf([d], null);
      expect(blob.size).toBeGreaterThan(0);
    });

    it('junta las hojas de las dos temporales en un solo PDF', async () => {
      const apoyo = buildCarnetApoyoLotePdf(
        Array.from({ length: 5 }, (_, i) => fila('apoyo', `${i}`).datos), null, 2);   // 3 hojas
      const alianza = buildCarnetsMasivoPdf([{
        CEDULA: '9', CODIGO: '', APELLIDOS: '', NOMBRES: '', FECHA_INGRESO: '',
        CENTRO_COSTO: '', FAMILIAR_EMERGENCIA_NOMBRE: '', FAMILIAR_EMERGENCIA_TELEFONO: '',
        TELEFONO_COORDINADOR: null, fotoDataUrl: null, qrDataUrl: null,
      }] as any[], { telefonoCoordinador: '1', arl: 'SURA' });                         // 1 hoja
      const todo: Blob = await (comp as any).unirPdfs([apoyo, alianza]);
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await todo.arrayBuffer());
      expect(pdf.getPageCount()).toBe((3 + 1) * 2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('filas bloqueadas', () => {

    it('una fila con datos faltantes no se puede generar', () => {
      const f = { ...fila('apoyo'), faltantes: ['foto'] };
      expect(comp.puedeGenerar(f)).toBeFalse();
    });

    it('una fila con error no se puede generar', () => {
      const f = { ...fila('apoyo'), error: 'No se encontró el candidato.' };
      expect(comp.puedeGenerar(f)).toBeFalse();
    });

    it('una fila sin datos no se puede generar', () => {
      const f = { ...fila('apoyo'), datos: null };
      expect(comp.puedeGenerar(f)).toBeFalse();
    });

    it('una fila completa sí se puede generar', () => {
      expect(comp.puedeGenerar(fila('apoyo'))).toBeTrue();
    });

    it('las bloqueadas no entran en el conteo de seleccionadas', () => {
      cargar([fila('apoyo', '1'), { ...fila('apoyo', '2'), faltantes: ['foto'] }]);
      expect(comp.seleccionadas().length).toBe(1);
      expect(comp.bloqueadas()).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('marcado de filas', () => {

    it('"solo pendientes" no marca los que ya tienen carnet', () => {
      comp.filas.set([
        fila('apoyo', '1'),
        { ...fila('apoyo', '2'), yaGenerado: true },
      ]);
      comp.soloPendientes();
      fixture.detectChanges();

      expect(comp.seleccionadas().length).toBe(1);
      expect(comp.seleccionadas()[0].cedula).toBe('1');
    });

    it('se puede marcar a mano uno ya generado para regenerarlo', () => {
      const yaTiene = { ...fila('apoyo', '2'), yaGenerado: true };
      comp.filas.set([yaTiene]);
      comp.marcar(yaTiene, true);
      fixture.detectChanges();

      expect(comp.seleccionadas().length).toBe(1);
      expect(comp.regenerando()).toBe(1);
    });

    it('desmarcar deja la selección vacía', () => {
      cargar([fila('apoyo')]);
      comp.marcarTodas(false);
      expect(comp.seleccionadas().length).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('cierre del diálogo', () => {

    it('sin cambios devuelve false', () => {
      const ref = TestBed.inject(MatDialogRef) as any;
      comp.cerrar();
      expect(ref.close).toHaveBeenCalledWith(false);
    });

    it('con cambios devuelve true para que el pipeline recargue', () => {
      const ref = TestBed.inject(MatDialogRef) as any;
      comp.cambios = true;
      comp.cerrar();
      expect(ref.close).toHaveBeenCalledWith(true);
    });
  });
});

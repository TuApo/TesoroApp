/**
 * Pestaña "Remisión" — pruebas de componente.
 *
 * Asigna la vacante y arma la remisión para entrevista o prueba técnica. Lo que
 * más importa acá es que la TEMPORAL se deduzca bien (decide el logo y el
 * código del formato) y que las fechas no salgan corridas o en formato raro,
 * porque ese papel se imprime y se le entrega a la persona.
 *
 * Incluye el uso torpe: vacantes a medio llenar, fechas basura, candidatos sin
 * contrato.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import Swal from 'sweetalert2';

import { HelpInformationComponent } from './help-information.component';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { VacantesService } from '../../service/vacantes/vacantes.service';
import { GestionParametrizacionService } from '../../../users/services/gestion-parametrizacion/gestion-parametrizacion.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';

describe('HelpInformationComponent', () => {
  let fixture: ComponentFixture<HelpInformationComponent>;
  let comp: HelpInformationComponent;
  let dialog: jasmine.SpyObj<MatDialog>;

  beforeEach(async () => {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as any);

    await TestBed.configureTestingModule({
      imports: [HelpInformationComponent, NoopAnimationsModule],
      providers: [
        // El rail de dos capas lo provee `RecruitmentPipelineComponent`; probando
        // el hijo suelto hay que darlo a mano.
        PipelineNavService,
        // El hijo `form-entrevista` lee la ruta para preasignar la oficina.
        provideRouter([]),
        {
          provide: RegistroProcesoContratacion,
          useValue: {
            updateProcesoByDocumento: () => of({ proceso: {} }),
            getCandidatoPorDocumento: () => of(null),
          },
        },
        { provide: VacantesService, useValue: { obtenerVacantes: () => of([]), listar: () => of([]) } },
        {
          provide: GestionParametrizacionService,
          useValue: { listMetaValoresByTablaCodigo: () => of([]), listDatosByTablaCodigo: () => of([]) },
        },
        { provide: UtilityServiceService, useValue: { getUser: () => Promise.resolve({}) } },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpInformationComponent);
    comp = fixture.componentInstance;
    (comp as any).dialog = dialog;

    // El aviso "temporal por descarte" de generarRemision es un toast real;
    // sin el spy dejaba DOM y timers de SweetAlert vivos entre tests.
    spyOn(Swal, 'fire').and.resolveTo({ isConfirmed: false } as any);
  });

  const temporalDe = (v: any) => (comp as any).temporalDeVacante(v).temporal;
  const temporalRaw = (v: any) => (comp as any).temporalDeVacante(v);
  const aFecha = (v: any) => (comp as any).aDDMMAAAA(v);

  // ───────────────────────────────────────────────────────────
  describe('deducir la temporal (decide logo y código del formato)', () => {

    it('reconoce TU ALIANZA', () => {
      expect(temporalDe({ temporal: 'TU ALIANZA SAS' })).toBe('alianza');
    });

    it('reconoce APOYO LABORAL', () => {
      expect(temporalDe({ temporal: 'APOYO LABORAL SAS' })).toBe('apoyo');
    });

    it('no le importan las minúsculas', () => {
      expect(temporalDe({ temporal: 'tu alianza sas' })).toBe('alianza');
    });

    it('aguanta espacios de más', () => {
      expect(temporalDe({ temporal: '  TU ALIANZA  ' })).toBe('alianza');
    });

    it('si la vacante no trae temporal, mira la empresa usuaria', () => {
      expect(temporalDe({ temporal: null, empresa_usuaria_solicita: 'TU ALIANZA' })).toBe('alianza');
    });

    it('sin nada de información cae en Apoyo, marcado como "por descarte"', () => {
      // Es el comportamiento histórico; el flag avisa al operador que el
      // membrete no salió de la vacante sino de un default.
      expect(temporalRaw({})).toEqual({ temporal: 'apoyo', porDefecto: true });
    });

    it('una vacante null no revienta', () => {
      expect(() => temporalDe(null)).not.toThrow();
    });

    it('una temporal con nombre inventado cae en Apoyo por descarte', () => {
      expect(temporalRaw({ temporal: 'EMPRESA X' })).toEqual({ temporal: 'apoyo', porDefecto: true });
    });

    it('deducir de la temporal o de la empresa usuaria NO es "por descarte"', () => {
      expect(temporalRaw({ temporal: 'APOYO LABORAL SAS' }).porDefecto).toBeFalse();
      expect(temporalRaw({ empresa_usuaria_solicita: 'APOYO LABORAL TS' }).porDefecto).toBeFalse();
      expect(temporalRaw({ empresa_usuaria_solicita: 'TU ALIANZA' }).porDefecto).toBeFalse();
    });
  });

  // ───────────────────────────────────────────────────────────
  describe('fechas del formato impreso', () => {

    it('convierte ISO a dd/mm/aaaa', () => {
      expect(aFecha('2026-08-04')).toBe('04/08/2026');
    });

    it('convierte ISO con hora a dd/mm/aaaa', () => {
      expect(aFecha('2026-08-04T13:45:00')).toBe('04/08/2026');
    });

    it('una fecha vacía queda vacía, no "Invalid Date"', () => {
      expect(aFecha('')).toBe('');
      expect(aFecha(null)).toBe('');
      expect(aFecha(undefined)).toBe('');
    });

    it('texto basura NO produce "NaN/NaN/NaN"', () => {
      const r = aFecha('lo que sea');
      expect(r).not.toContain('NaN');
    });

    it('un número suelto no revienta', () => {
      expect(() => aFecha(12345)).not.toThrow();
    });

    it('la fecha de hoy sale en dd/mm/aaaa', () => {
      const hoy = (comp as any).hoyDDMMAAAA();
      expect(hoy).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });
  });

  // ───────────────────────────────────────────────────────────
  describe('código de contrato para el recuadro de la remisión', () => {

    const codigoDe = (c: any) => (comp as any).codigoContratoDe(c);

    it('un candidato sin entrevistas devuelve cadena vacía', () => {
      expect(codigoDe({ entrevistas: [] })).toBe('');
    });

    it('un candidato null no revienta', () => {
      expect(() => codigoDe(null)).not.toThrow();
    });

    it('sin contrato devuelve cadena vacía, no "undefined"', () => {
      const r = codigoDe({ entrevistas: [{ proceso: {} }] });
      expect(r).toBe('');
      expect(r).not.toContain('undefined');
    });
  });

  // ───────────────────────────────────────────────────────────
  describe('remisión', () => {

    it('abre el diálogo con ancho fijo para que no se corte', () => {
      comp.generarRemision();
      expect(dialog.open).toHaveBeenCalled();
      const config = dialog.open.calls.mostRecent().args[1] as any;
      expect(config.width).withContext('sin ancho, Material lo limita a 80vw y corta el contenido')
        .toBeTruthy();
      expect(config.maxWidth).toBeTruthy();
    });

    it('sin candidato tampoco revienta', () => {
      expect(() => comp.generarRemision()).not.toThrow();
    });

    it('los datos del candidato viajan al diálogo', () => {
      fixture.componentRef.setInput('candidatoSeleccionado', {
        numero_documento: '1082490391',
        primer_nombre: 'LEIVIS', primer_apellido: 'BAZA',
        entrevistas: [{ proceso: {} }],
      });

      comp.generarRemision();

      const data = (dialog.open.calls.mostRecent().args[1] as any).data;
      expect(data.cedula).toBe('1082490391');
      expect(data.nombreCandidato).toContain('LEIVIS');
    });

    it('avisa cuando la temporal salió por descarte, sin bloquear el diálogo', () => {
      comp.generarRemision(); // sin vacante → porDefecto=true

      expect(dialog.open).toHaveBeenCalled();
      expect(Swal.fire).toHaveBeenCalled();
      const arg = (Swal.fire as jasmine.Spy).calls.mostRecent().args[0] as any;
      expect(arg.title).toContain('Temporal no definida');
    });

    it('los campos que se llenan a mano van VACÍOS a propósito', () => {
      fixture.componentRef.setInput('candidatoSeleccionado', {
        numero_documento: '1', entrevistas: [{ proceso: {} }],
      });

      comp.generarRemision();

      const data = (dialog.open.calls.mostRecent().args[1] as any).data;
      expect(data.area).toBe('');
      expect(data.preguntarPor).toBe('');
      expect(data.gestionHumana).toBe('');
    });
  });

  /**
   * El desplegable de la vacante: mismo criterio que el selector de la ficha.
   * Antes exigía que lo tecleado apareciera SEGUIDO dentro de un mismo campo,
   * así que tres palabras repartidas entre empresa, finca y cargo no
   * encontraban nada.
   */
  describe('búsqueda de vacantes en el desplegable', () => {
    const V = (id: number, empresa: string, finca: string, cargo: string, codigo: string | null = null) => ({
      id,
      empresa_usuaria_solicita: empresa,
      finca,
      cargo,
      codigo_elite: codigo,
      temporal: 'APOYO LABORAL SAS',
      oficinas_que_contratan: [{ nombre: 'SOACHA', numeroDeGenteRequerida: 5, ruta: false }],
      // Los cupos salen de `personas_solicitadas`, NO de las oficinas: sin esto
      // `falt()` da 0 y el desplegable esconde la vacante por estar llena.
      personas_solicitadas: 5,
      conteo_estados: { contratado: 1 },
      activo: true,
    }) as any;

    beforeEach(() => {
      comp.vacantes.set([
        V(1, 'JARDINES DE LOS ANDES', 'LA ROSA', 'COSECHA', 'JA-11'),
        V(2, 'JARDINES DE LOS ANDES', 'EL CLAVEL', 'POSCOSECHA', 'JA-12'),
        V(3, 'FLORES DE LOS ANDES', 'LA ROSA', 'SUPERVISOR', 'FA-01'),
      ]);
    });

    /** Los cargos que quedan visibles, aplanando el árbol empresa → finca. */
    function cargos(): string[] {
      return comp.vacantesAgrupadas()
        .flatMap((e: any) => e.fincas)
        .flatMap((f: any) => f.vacantes)
        .map((v: any) => v.cargo);
    }

    it('sin consulta salen todas', () => {
      comp.searchVacanteCtrl.setValue('');
      expect(cargos().sort()).toEqual(['COSECHA', 'POSCOSECHA', 'SUPERVISOR']);
    });

    it('varias palabras en campos distintos encuentran la vacante', () => {
      comp.searchVacanteCtrl.setValue('jardines rosa cosecha');
      expect(cargos()).toEqual(['COSECHA']);
    });

    it('el orden de las palabras da igual', () => {
      comp.searchVacanteCtrl.setValue('cosecha rosa jardines');
      expect(cargos()).toEqual(['COSECHA']);
    });

    it('si falta una palabra no sale', () => {
      comp.searchVacanteCtrl.setValue('jardines rosa supervisor');
      expect(cargos()).toEqual([]);
    });

    it('busca sin tildes y por código', () => {
      comp.searchVacanteCtrl.setValue('FA-01');
      expect(cargos()).toEqual(['SUPERVISOR']);
    });
  });

});

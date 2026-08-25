/**
 * Pestaña "Contratación" — pruebas de componente.
 *
 * Guarda pago y transporte, referencias y traslados. Se le quitaron los
 * validadores obligatorios a cuatro campos (sub centro de costo, grupo y los
 * clasificadores 2 y 3) y eso no se había verificado más allá de que compilara:
 * si el formulario quedara inválido por otro lado, el guardado no dispararía y
 * nadie se enteraría.
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { HiringQuestionsComponent } from './hiring-questions.component';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { VacantesService } from '../../service/vacantes/vacantes.service';
import { FarmsService } from '../../../farms/services/farms/farms.service';
import { TarjetasService } from '../../service/tarjetas.service';
import { PositionsService } from '../../../positions/services/positions/positions.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';

function candidato(contrato: any = {}) {
  return {
    numero_documento: '1082490391',
    tipo_doc: 'CC',
    primer_nombre: 'LEIVIS',
    primer_apellido: 'BAZA',
    entrevistas: [{
      oficina: 'FACA_PRIMERA',
      proceso: { id: 1, publicacion: 10, contrato: { codigo_contrato: '180005', ...contrato } },
    }],
  };
}

describe('HiringQuestionsComponent', () => {
  let fixture: ComponentFixture<HiringQuestionsComponent>;
  let comp: HiringQuestionsComponent;
  let procesos: jasmine.SpyObj<RegistroProcesoContratacion>;
  let docs: jasmine.SpyObj<GestionDocumentalService>;

  beforeEach(async () => {
    procesos = jasmine.createSpyObj('RegistroProcesoContratacion',
      ['updateProcesoByDocumento', 'getCandidatoPorDocumento']);
    procesos.updateProcesoByDocumento.and.returnValue(of({ proceso: {} } as any));
    procesos.getCandidatoPorDocumento.and.returnValue(of(null as any));

    docs = jasmine.createSpyObj('GestionDocumentalService',
      ['getDocuments', 'guardarDocumento', 'obtenerDocumentosPorTipo', 'getDocumentosDeCandidato', 'invalidarDocumentos']);
    docs.getDocuments.and.returnValue(of([]));
    docs.getDocumentosDeCandidato.and.returnValue(of([]));
    docs.obtenerDocumentosPorTipo.and.returnValue(of([]));
    docs.guardarDocumento.and.returnValue(of({ id: 1 }));

    await TestBed.configureTestingModule({
      imports: [HiringQuestionsComponent, NoopAnimationsModule],
      providers: [
        // El rail de dos capas lo provee `RecruitmentPipelineComponent`; probando
        // el hijo suelto hay que darlo a mano.
        PipelineNavService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RegistroProcesoContratacion, useValue: procesos },
        { provide: GestionDocumentalService, useValue: docs },
        { provide: VacantesService, useValue: { obtenerVacante: () => of(null) } },
        { provide: FarmsService, useValue: { list: () => of([]) } },
        { provide: TarjetasService, useValue: { list: () => of([]), listar: () => of([]) } },
        { provide: PositionsService, useValue: { list: () => of([]) } },
        { provide: UtilityServiceService, useValue: { getUser: () => Promise.resolve({}) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HiringQuestionsComponent);
    comp = fixture.componentInstance;
  });

  function abrir(cand: any) {
    fixture.componentRef.setInput('candidatoSeleccionado', cand);
    fixture.detectChanges();
  }

  // ─────────────────────────────────────────────────────────────
  describe('campos que dejaron de ser obligatorios', () => {

    const OPCIONALES = ['subCentroCostos', 'grupo', 'categoria', 'operacion'];

    beforeEach(() => fixture.detectChanges());

    for (const campo of OPCIONALES) {
      it(`"${campo}" es válido estando vacío`, () => {
        const ctrl = comp.pagoTransporteForm.get(campo)!;
        ctrl.setValue(null);
        expect(ctrl.valid).withContext(`${campo} no debería exigir valor`).toBeTrue();
      });
    }

    it('ninguno de los cuatro aporta errores al formulario', () => {
      for (const campo of OPCIONALES) comp.pagoTransporteForm.get(campo)!.setValue(null);
      for (const campo of OPCIONALES) {
        expect(comp.pagoTransporteForm.get(campo)!.errors).toBeNull();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('campos que SIGUEN siendo obligatorios', () => {

    beforeEach(() => fixture.detectChanges());

    const REQUERIDOS = ['formaPago', 'Ccostos', 'porcentajeARL', 'cesantias', 'fechaIngreso'];

    for (const campo of REQUERIDOS) {
      it(`"${campo}" sigue exigiendo valor`, () => {
        const ctrl = comp.pagoTransporteForm.get(campo)!;
        ctrl.setValue(null);
        expect(ctrl.valid).withContext(`${campo} debería seguir siendo obligatorio`).toBeFalse();
      });
    }
  });

  // ─────────────────────────────────────────────────────────────
  describe('tipos documentales de referencias y traslados', () => {

    it('usa los ids correctos de producción', () => {
      fixture.detectChanges();
      const mapa = (comp as any).typeMap;
      expect(mapa.personal1).toBe(16, 'REFERENCIA_PERSONAL');
      expect(mapa.familiar1).toBe(17, 'REFERENCIA_FAMILIAR');
      expect(mapa.traslado).toBe(18, 'TRASLADOS');
      expect(mapa.laboral1).toBe(86, 'REFERENCIA_LABORAL');
    });

    it('las referencias personales y familiares tienen dos cupos', () => {
      fixture.detectChanges();
      const mapa = (comp as any).typeMap;
      expect(mapa.personal1).toBe(mapa.personal2);
      expect(mapa.familiar1).toBe(mapa.familiar2);
      expect(mapa.laboral1).toBe(mapa.laboral2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('llenado desde el candidato', () => {

    it('abre un candidato con contrato sin reventar', () => {
      expect(() => abrir(candidato())).not.toThrow();
      expect(comp.pagoTransporteForm).toBeTruthy();
    });

    it('un candidato sin contrato no revienta el componente', () => {
      expect(() => abrir({
        numero_documento: '999',
        entrevistas: [{ proceso: { id: 2 } }],
      })).not.toThrow();
    });

    it('sin candidato tampoco revienta', () => {
      expect(() => fixture.detectChanges()).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('guardado de datos de obra', () => {

    it('no llama al backend si no hay candidato', fakeAsync(() => {
      fixture.detectChanges();
      comp.guardarDatosObra();
      tick();
      expect(procesos.updateProcesoByDocumento).not.toHaveBeenCalled();
    }));

    it('manda el número de documento en el payload', fakeAsync(() => {
      abrir(candidato());
      comp.datosObraForm.patchValue({ descripcionObra: 'CORTE DE FLOR' });

      comp.guardarDatosObra();
      tick();

      expect(procesos.updateProcesoByDocumento).toHaveBeenCalled();
      const payload = procesos.updateProcesoByDocumento.calls.mostRecent().args[0] as any;
      expect(payload.numero_documento).toBe('1082490391');
      expect(payload.contrato_detalle.descripcion_de_obra).toBe('CORTE DE FLOR');
    }));

    it('los campos vacíos viajan como null, no como cadena vacía', fakeAsync(() => {
      abrir(candidato());
      comp.datosObraForm.patchValue({ descripcionObra: '', centroCosto: '  ' });

      comp.guardarDatosObra();
      tick();

      const payload = procesos.updateProcesoByDocumento.calls.mostRecent().args[0] as any;
      expect(payload.contrato_detalle.descripcion_de_obra).toBeNull();
      expect(payload.contrato_detalle.centro_costo_obra).toBeNull();
    }));
  });
});

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
import { of, throwError } from 'rxjs';

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
      ['getDocuments', 'guardarDocumento', 'obtenerDocumentosPorTipo', 'getDocumentosDeCandidato', 'invalidarDocumentos',
       'armarCedulaAmpliada']);
    docs.getDocuments.and.returnValue(of([]));
    docs.armarCedulaAmpliada.and.returnValue(of({ estado: 'SIN_CARAS', id: null }));
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

    const OPCIONALES = ['subCentroCostos', 'grupo', 'categoria', 'operacion',
                        'porcentajeARL', 'cesantias'];

    beforeEach(() => fixture.detectChanges());

    for (const campo of OPCIONALES) {
      it(`"${campo}" es válido estando vacío`, () => {
        const ctrl = comp.pagoTransporteForm.get(campo)!;
        ctrl.setValue(null);
        expect(ctrl.valid).withContext(`${campo} no debería exigir valor`).toBeTrue();
      });
    }

    it('ninguno aporta errores al formulario', () => {
      for (const campo of OPCIONALES) comp.pagoTransporteForm.get(campo)!.setValue(null);
      for (const campo of OPCIONALES) {
        expect(comp.pagoTransporteForm.get(campo)!.errors).toBeNull();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('campos que SIGUEN siendo obligatorios', () => {

    beforeEach(() => fixture.detectChanges());

    // `porcentajeARL` y `cesantias` dejaron de estar aquí (2026-09-08): salieron de
    // la ficha y un obligatorio invisible deja el formulario inválido para siempre.
    const REQUERIDOS = ['formaPago', 'Ccostos', 'fechaIngreso'];

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
  describe('guardado automático de Pago y Transporte (sin botón "Cargar")', () => {

    it('a medias guarda lo respondido sin marcar contratado ni pedir código', fakeAsync(() => {
      abrir(candidato());
      comp.pagoTransporteForm.patchValue({ formaPago: 'Daviplata', numeroPagos: '3001234567' });
      comp.pagoTransporteForm.get('Ccostos')!.setValue(null);
      expect(comp.pagoTransporteForm.valid).toBeFalse();

      let error: any = null;
      comp.cargarPagoTransporte({ silencioso: true }).catch(e => (error = e));
      tick();

      expect(error).toBeNull();
      const body = procesos.updateProcesoByDocumento.calls.mostRecent().args[0] as any;
      expect(body.contratado).toBeUndefined();
      expect(body.contrato).toBeUndefined();
      expect(body.contrato_detalle.forma_de_pago).toBe('Daviplata');
    }));

    it('completo marca contratado y pide el código, sin abrir avisos', fakeAsync(() => {
      abrir(candidato());
      comp.pagoTransporteForm.patchValue({
        formaPago: 'Daviplata', numeroPagos: '3001234567', seguroFunerario: false,
        Ccostos: 'CC-1', porcentajeARL: 0.522, cesantias: 'PORVENIR', horasExtras: false,
        fechaIngreso: '2026-09-01', fechaContrato: '2026-09-01',
      });
      comp.cargarPagoTransporte({ silencioso: true });
      tick();
      const body = procesos.updateProcesoByDocumento.calls.mostRecent().args[0] as any;
      expect(body.contratado).toBeTrue();
      expect(body.contrato.generar_codigo).toBeTrue();
    }));

    it('un fallo del backend llega al indicador en vez de a un aviso', fakeAsync(() => {
      abrir(candidato());
      procesos.updateProcesoByDocumento.and.returnValue(throwError(() => ({ status: 500 })));
      let error: any = null;
      comp.cargarPagoTransporte({ silencioso: true }).catch(e => (error = e));
      tick();
      expect(error).toEqual({ status: 500 });
    }));
  });

  // ─────────────────────────────────────────────────────────────
  describe('documento de identidad', () => {

    it('la tarjeta se nombra según el tipo de documento', () => {
      abrir({ ...candidato(), tipo_doc: 'PPT' });
      expect(comp.nombreDocumento()).toBe('Permiso por protección temporal');
    });

    it('sin tipo se asume cédula de ciudadanía', () => {
      abrir({ ...candidato(), tipo_doc: '' });
      expect(comp.nombreDocumento()).toBe('Cédula de ciudadanía');
    });

    it('si ya está en el expediente deja verlo', () => {
      docs.getDocuments.and.returnValue(of([{ id: 77, type: 29 }]));
      docs.armarCedulaAmpliada.and.returnValue(of({ estado: 'YA_ESTABA', id: 77 }));
      abrir(candidato());
      expect(comp.cedulaSubida()).toBeTrue();
      expect(comp.cedulaDocumentoId()).toBe(77);
    });

    it('si las caras del formulario son más nuevas, muestra el rehecho', () => {
      docs.getDocuments.and.returnValue(of([{ id: 77, type: 29 }]));
      docs.armarCedulaAmpliada.and.returnValue(of({ estado: 'CREADA', id: 120 }));
      abrir(candidato());
      expect(comp.cedulaDocumentoId()).toBe(120);
    });

    it('con el backend sin la ruta nueva, lo que ya había se sigue viendo', () => {
      docs.getDocuments.and.returnValue(of([{ id: 77, type: 29 }]));
      docs.armarCedulaAmpliada.and.returnValue(throwError(() => ({ status: 404 })));
      abrir(candidato());
      expect(comp.cedulaSubida()).toBeTrue();
      expect(comp.cedulaDocumentoId()).toBe(77);
    });

    it('sin documento arma el ampliado desde las caras del formulario', () => {
      docs.armarCedulaAmpliada.and.returnValue(of({ estado: 'CREADA', id: 91 }));
      abrir(candidato());
      expect(docs.armarCedulaAmpliada).toHaveBeenCalledWith('1082490391');
      expect(comp.cedulaSubida()).toBeTrue();
      expect(comp.cedulaDocumentoId()).toBe(91);
    });

    it('sin caras en el formulario sigue "sin subir"', () => {
      abrir(candidato());
      expect(docs.armarCedulaAmpliada).toHaveBeenCalled();
      expect(comp.cedulaSubida()).toBeFalse();
      expect(comp.cedulaDocumentoId()).toBeNull();
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

  // ─────────────────────────────────────────────────────────────
  // Ruta, recargo de horas extras y temporal (V57).
  //
  // Los tres son campos nuevos del tab; `temporal` tenía columna desde la
  // migración del legacy pero ningún guardado la escribía. Lo que se prueba es
  // el viaje completo: cargar lo guardado → guardar → volver a cargar.
  describe('ruta, recargo de HE y temporal', () => {

    /** Guarda el tab con el formulario ya válido y devuelve el `contrato_detalle`. */
    function guardarYLeerDetalle(): any {
      comp.pagoTransporteForm.patchValue({
        formaPago: 'Daviplata',
        numeroPagos: '3001234567',
        seguroFunerario: false,
        Ccostos: 'CC-1',
        porcentajeARL: 0.522,
        cesantias: 'PORVENIR',
        horasExtras: false,
        fechaIngreso: '2026-09-01',
        fechaContrato: '2026-09-01',
      });
      comp.cargarPagoTransporte();
      tick();
      return procesos.updateProcesoByDocumento.calls.mostRecent().args[0] as any;
    }

    it('no existen como controles obligatorios', () => {
      fixture.detectChanges();
      for (const campo of ['usaRuta', 'valorTransporte', 'porcentajeHorasExtras']) {
        const ctrl = comp.pagoTransporteForm.get(campo)!;
        expect(ctrl).withContext(`falta el control ${campo}`).toBeTruthy();
        ctrl.setValue(null);
        expect(ctrl.valid).withContext(`${campo} no debe ser obligatorio`).toBeTrue();
      }
    });

    it('carga lo que ya está guardado en el contrato', () => {
      abrir(candidato({
        temporal: 'TA',
        usa_ruta: true,
        valor_transporte: 12000,
        porcentaje_horas_extras: 25,
      }));

      expect(comp.pagoTransporteForm.get('temporal')!.value).toBe('TA');
      expect(comp.pagoTransporteForm.get('usaRuta')!.value).toBeTrue();
      expect(comp.pagoTransporteForm.get('valorTransporte')!.value).toBe(12000);
      expect(comp.pagoTransporteForm.get('porcentajeHorasExtras')!.value).toBe(25);
    });

    it('un contrato histórico sin las columnas nuevas los deja sin responder', () => {
      // NULL es "no se preguntó". Un `false` aquí afirmaría que no usa ruta.
      abrir(candidato());

      expect(comp.pagoTransporteForm.get('usaRuta')!.value).toBeNull();
      expect(comp.pagoTransporteForm.get('valorTransporte')!.value).toBeNull();
      expect(comp.pagoTransporteForm.get('porcentajeHorasExtras')!.value).toBeNull();
    });

    it('usa ruta = SÍ viaja como true junto al valor', fakeAsync(() => {
      abrir(candidato());
      comp.pagoTransporteForm.patchValue({ usaRuta: true, valorTransporte: 12000 });

      const payload = guardarYLeerDetalle();

      expect(payload.contrato_detalle.usa_ruta).toBeTrue();
      expect(payload.contrato_detalle.valor_transporte).toBe(12000);
    }));

    it('usa ruta = NO viaja como false, no como null', fakeAsync(() => {
      // `false` es una respuesta y tiene que persistirse como tal.
      abrir(candidato());
      comp.pagoTransporteForm.patchValue({ usaRuta: false });

      const payload = guardarYLeerDetalle();

      expect(payload.contrato_detalle.usa_ruta).toBeFalse();
    }));

    it('sin responder viaja como null para poder dejarlo en blanco', fakeAsync(() => {
      abrir(candidato());
      comp.pagoTransporteForm.patchValue({ usaRuta: null });

      const payload = guardarYLeerDetalle();

      expect(payload.contrato_detalle.usa_ruta).toBeNull();
    }));

    it('el valor del transporte solo aplica si usa ruta', () => {
      fixture.detectChanges();

      comp.pagoTransporteForm.patchValue({ usaRuta: false, valorTransporte: null });
      expect(comp.estadoCampo('valorTransporte')).toBe('normal');

      comp.pagoTransporteForm.patchValue({ usaRuta: true, valorTransporte: 12000 });
      expect(comp.estadoCampo('valorTransporte')).toBe('completo');
    });

    it('el recargo de HE es independiente del porcentaje ARL', fakeAsync(() => {
      abrir(candidato());
      comp.pagoTransporteForm.patchValue({ porcentajeARL: 0.522, porcentajeHorasExtras: 25 });

      const payload = guardarYLeerDetalle();

      // Dos claves distintas y dos valores distintos: ni se pisan ni se comparten.
      expect(payload.contrato_detalle.porcentaje_arl).toBe(0.522);
      expect(payload.contrato_detalle.porcentaje_horas_extras).toBe(25);
    }));

    it('la temporal viaja al guardar, que es lo que faltaba', fakeAsync(() => {
      abrir(candidato({ temporal: 'AL' }));

      const payload = guardarYLeerDetalle();

      expect(payload.contrato_detalle.temporal).toBe('AL');
    }));

    it('sin temporal resuelta no se manda la clave, para no borrar la guardada', fakeAsync(() => {
      abrir(candidato());
      comp.pagoTransporteForm.get('temporal')!.setValue('');

      const payload = guardarYLeerDetalle();

      expect('temporal' in payload.contrato_detalle).toBeFalse();
    }));

    it('el cargo se muestra pero NO se guarda: su fuente es la vacante', fakeAsync(() => {
      abrir(candidato());

      const payload = guardarYLeerDetalle();

      expect(comp.pagoTransporteForm.get('cargo')).toBeTruthy();
      expect('cargo' in payload.contrato_detalle).toBeFalse();
    }));

    it('no se rompió el contrato del payload existente', fakeAsync(() => {
      abrir(candidato());

      const payload = guardarYLeerDetalle();

      expect(payload.numero_documento).toBe('1082490391');
      expect(payload.contratado).toBeTrue();
      expect(payload.contrato.generar_codigo).toBeTrue();
      // Los datos de obra siguen viajando en el mismo guardado.
      expect('descripcion_de_obra' in payload.contrato_detalle).toBeTrue();
    }));
  });

  // ─────────────────────────────────────────────────────────────
  // Ficha de CONTRATACIÓN: los 9 campos que se pidieron con un origen concreto.
  describe('ficha de contratación', () => {

    /** Reabre el componente con una vacante concreta detrás del proceso. */
    async function abrirConVacante(vac: any, contrato: any = {}) {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [HiringQuestionsComponent, NoopAnimationsModule],
        providers: [
          PipelineNavService, provideHttpClient(), provideHttpClientTesting(),
          { provide: RegistroProcesoContratacion, useValue: procesos },
          { provide: GestionDocumentalService, useValue: docs },
          { provide: VacantesService, useValue: { obtenerVacante: () => of(vac) } },
          { provide: FarmsService, useValue: { list: () => of([]), resolverPorVacante: () => of(null) } },
          { provide: TarjetasService, useValue: { list: () => of([]), listar: () => of([]) } },
          { provide: PositionsService, useValue: { list: () => of([]) } },
          { provide: UtilityServiceService, useValue: { getUser: () => Promise.resolve({}) } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(HiringQuestionsComponent);
      comp = fixture.componentInstance;
      fixture.componentRef.setInput('candidatoSeleccionado', candidato(contrato));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    const VACANTE = {
      cargo: 'OPERARIO DE CORTE',
      temporal: 'TA',
      salario: 1750905,
      auxilio_transporte: 'Si',
      empresa_usuaria_solicita: 'THE ELITE FLOWER',
      fechadeIngreso: '2026-09-15',
      finca: 'GUAYMARAL',
    };

    it('cargo y temporal se llenan solos desde la vacante', async () => {
      await abrirConVacante(VACANTE);

      expect(comp.pagoTransporteForm.get('cargo')!.value).toBe('OPERARIO DE CORTE');
      expect(comp.pagoTransporteForm.get('temporal')!.value).toBe('TA');
    });

    it('el salario se trae de la vacante', async () => {
      await abrirConVacante(VACANTE);

      expect(comp.pagoTransporteForm.get('salario')!.value).toBe(1750905);
    });

    it('la empresa usuaria refleja la de la vacante sin ser una segunda copia editable', async () => {
      await abrirConVacante(VACANTE);

      expect(comp.pagoTransporteForm.get('empresaUsuaria')!.value).toBe('THE ELITE FLOWER');
      // Espejo: deshabilitado, para que no haya dos escritores del mismo campo.
      expect(comp.pagoTransporteForm.get('empresaUsuaria')!.disabled).toBeTrue();
    });

    it('cargo y temporal no se pueden editar a mano', async () => {
      await abrirConVacante(VACANTE);

      expect(comp.pagoTransporteForm.get('cargo')!.disabled).toBeTrue();
      expect(comp.pagoTransporteForm.get('temporal')!.disabled).toBeTrue();
    });

    it('la sucursal se llena a mano: queda editable', async () => {
      await abrirConVacante(VACANTE);

      expect(comp.pagoTransporteForm.get('sucursal')!.enabled).toBeTrue();
    });

    // ── Fecha de ingreso: propuesta por la vacante, editable, sin tocarla ──
    it('la fecha de ingreso se propone desde la vacante', async () => {
      await abrirConVacante(VACANTE);

      expect(comp.pagoTransporteForm.get('fechaIngreso')!.value).toBe('2026-09-15');
      expect(comp.fechaIngresoEditada()).toBeFalse();
    });

    it('lo ya guardado en el contrato gana sobre la propuesta de la vacante', async () => {
      await abrirConVacante(VACANTE, { fecha_ingreso: '2026-09-20' });

      expect(comp.pagoTransporteForm.get('fechaIngreso')!.value).toBe('2026-09-20');
      // Y se ve la traza de que difieren.
      expect(comp.fechaIngresoEditada()).toBeTrue();
      expect(comp.fechaIngresoVacante).toBe('2026-09-15');
    });

    it('editarla NO manda nada de la vacante en el payload', fakeAsync(() => {
      abrir(candidato());
      comp.pagoTransporteForm.patchValue({
        formaPago: 'Daviplata', numeroPagos: '3001234567', seguroFunerario: false,
        Ccostos: 'CC-1', porcentajeARL: 0.522, cesantias: 'PORVENIR', horasExtras: false,
        fechaIngreso: '2026-09-20', fechaContrato: '2026-09-20',
      });

      comp.cargarPagoTransporte();
      tick();

      const payload = procesos.updateProcesoByDocumento.calls.mostRecent().args[0] as any;
      // La fecha editada va al CONTRATO...
      expect(payload.contrato_detalle.fecha_ingreso).toBe('2026-09-20');
      // ...y no se toca la publicación ni ninguna clave de la vacante.
      expect('publicacion' in payload).toBeFalse();
      expect('vacante_fecha_ingreso' in payload).toBeFalse();
      expect('fechadeIngreso' in payload.contrato_detalle).toBeFalse();
    }));

    // ── Número de la cuenta: texto ──
    it('el número de la cuenta acepta texto, no solo 16-18 dígitos', () => {
      fixture.detectChanges();
      comp.pagoTransporteForm.get('formaPago')!.setValue('Bancolombia');
      const ctrl = comp.pagoTransporteForm.get('numeroPagos')!;

      ctrl.setValue('CTA-AHORROS 123-456');

      expect(ctrl.hasError('pattern')).toBeFalse();
      expect(ctrl.valid).toBeTrue();
    });

    it('pero sigue siendo obligatorio', () => {
      fixture.detectChanges();
      comp.pagoTransporteForm.get('formaPago')!.setValue('Bancolombia');
      const ctrl = comp.pagoTransporteForm.get('numeroPagos')!;

      ctrl.setValue('');

      expect(ctrl.hasError('required')).toBeTrue();
    });

    it('horas extras es un booleano y NO es una respuesta válida cuenta como llena', () => {
      fixture.detectChanges();
      const ctrl = comp.pagoTransporteForm.get('horasExtras')!;

      ctrl.setValue(false);
      expect(ctrl.valid).toBeTrue();
      expect(comp.campoCompleto('horasExtras')).toBeTrue();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Seguro funerario: el importe sale de la parametrización del CENTRO DE COSTO.
  // Con un solo seguro se resuelve solo; con dos hay que elegir, porque es plata
  // que se le descuenta a la persona.
  describe('valor del seguro funerario', () => {

    const ORDINARIO = { seguro_funerario_id: 1, nombre: 'Seguro funerario ordinario', valor: 4750, periodicidad: 'QUINCENAL', asignada: true };
    const ESPECIAL = { seguro_funerario_id: 2, nombre: 'Seguro funerario especial', valor: 13169, periodicidad: 'QUINCENAL', asignada: true };
    /** El endpoint devuelve TODOS los activos; `asignada:false` NO aplica al centro. */
    const NO_ASIGNADO = { ...ESPECIAL, asignada: false };

    function conSeguros(seguros: any[]) {
      (comp as any).segurosDelCentro = seguros
        .filter(s => s.asignada)
        .map(s => ({ id: s.seguro_funerario_id, nombre: s.nombre, valor: s.valor, periodicidad: s.periodicidad }));
      (comp as any).sincronizarSeguroFunerario();
    }

    beforeEach(() => fixture.detectChanges());

    it('el valor no se muestra si el seguro es NO', () => {
      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(false);
      conSeguros([ORDINARIO]);

      expect(comp.mostrarValorSeguro).toBeFalse();
    });

    it('al marcar SI se muestra el valor', () => {
      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(true);
      conSeguros([ORDINARIO]);

      expect(comp.mostrarValorSeguro).toBeTrue();
      expect(comp.valorSeguro).toBe(4750);
    });

    it('con un solo seguro se resuelve solo, sin pedir que se elija', () => {
      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(true);
      conSeguros([ORDINARIO]);

      expect(comp.seguroRequiereEleccion).toBeFalse();
      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.value).toBe(1);
      // Y no bloquea el guardado.
      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.valid).toBeTrue();
    });

    it('con dos seguros hay que elegir y sin elegir no se puede guardar', () => {
      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(true);
      conSeguros([ORDINARIO, ESPECIAL]);

      expect(comp.seguroRequiereEleccion).toBeTrue();
      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.value).toBeNull();
      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.valid).toBeFalse();
      expect(comp.valorSeguro).toBeNull();
    });

    it('al elegir uno de los dos queda su valor y ya se puede guardar', () => {
      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(true);
      conSeguros([ORDINARIO, ESPECIAL]);

      comp.pagoTransporteForm.get('seguroFunerarioId')!.setValue(2);

      expect(comp.valorSeguro).toBe(13169);
      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.valid).toBeTrue();
    });

    it('solo ofrece los seguros ASIGNADOS al centro', () => {
      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(true);
      conSeguros([ORDINARIO, NO_ASIGNADO]);

      expect(comp.segurosDelCentro.length).toBe(1);
      expect(comp.seguroRequiereEleccion).toBeFalse();
      expect(comp.valorSeguro).toBe(4750);
    });

    it('con dos seguros, elegir NO deja de exigir la elección', () => {
      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(true);
      conSeguros([ORDINARIO, ESPECIAL]);
      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.valid).toBeFalse();

      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(false);
      comp.onSeguroFunerarioChange();

      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.valid).toBeTrue();
    });

    it('cambiar de finca descarta un seguro que el centro nuevo no tiene', () => {
      comp.pagoTransporteForm.get('seguroFunerario')!.setValue(true);
      conSeguros([ORDINARIO, ESPECIAL]);
      comp.pagoTransporteForm.get('seguroFunerarioId')!.setValue(2);

      // Centro nuevo: solo el ordinario. El 2 ya no aplica.
      conSeguros([ORDINARIO]);

      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.value).toBe(1);
      expect(comp.valorSeguro).toBe(4750);
    });

    it('guarda el id y el importe elegidos', fakeAsync(() => {
      abrir(candidato());
      conSeguros([ORDINARIO, ESPECIAL]);
      comp.pagoTransporteForm.patchValue({
        formaPago: 'Daviplata', numeroPagos: '3001234567', Ccostos: 'CC-1',
        horasExtras: false, fechaIngreso: '2026-09-01', fechaContrato: '2026-09-01',
        seguroFunerario: true, seguroFunerarioId: 2,
      });

      comp.cargarPagoTransporte();
      tick();

      const d = (procesos.updateProcesoByDocumento.calls.mostRecent().args[0] as any).contrato_detalle;
      expect(d.seguro_funerario).toBeTrue();
      expect(d.seguro_funerario_id).toBe(2);
      expect(d.seguro_funerario_valor).toBe(13169);
    }));

    it('con el seguro en NO manda id e importe en null', fakeAsync(() => {
      abrir(candidato());
      conSeguros([ORDINARIO]);
      comp.pagoTransporteForm.patchValue({
        formaPago: 'Daviplata', numeroPagos: '3001234567', Ccostos: 'CC-1',
        horasExtras: false, fechaIngreso: '2026-09-01', fechaContrato: '2026-09-01',
        seguroFunerario: false,
      });

      comp.cargarPagoTransporte();
      tick();

      const d = (procesos.updateProcesoByDocumento.calls.mostRecent().args[0] as any).contrato_detalle;
      expect(d.seguro_funerario_id).toBeNull();
      expect(d.seguro_funerario_valor).toBeNull();
    }));

    it('un contrato viejo muestra el importe con el que se firmó', () => {
      // Aunque el parametrizador haya cambiado el valor del seguro después.
      abrir(candidato({ seguro_funerario: true, seguro_funerario_id: 1, seguro_funerario_valor: 4000 }));

      expect(comp.pagoTransporteForm.get('seguroFunerarioId')!.value).toBe(1);
      expect(comp.valorSeguro).toBe(4000);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('indicador verde de completitud', () => {

    beforeEach(() => fixture.detectChanges());

    it('un campo vacío no está completo', () => {
      comp.pagoTransporteForm.get('cesantias')!.setValue(null);
      expect(comp.campoCompleto('cesantias')).toBeFalse();
    });

    it('un select con opción válida está completo', () => {
      comp.pagoTransporteForm.get('cesantias')!.setValue('PORVENIR');
      expect(comp.campoCompleto('cesantias')).toBeTrue();
    });

    it('un booleano en NO está completo', () => {
      comp.pagoTransporteForm.get('horasExtras')!.setValue(false);
      expect(comp.campoCompleto('horasExtras')).toBeTrue();
    });

    it('un campo inválido no se pone verde', () => {
      const ctrl = comp.pagoTransporteForm.get('numeroPagos')!;
      comp.pagoTransporteForm.get('formaPago')!.setValue('Bancolombia');
      ctrl.setValue('123');           // el patrón pide 16-18 dígitos
      ctrl.markAsTouched();

      expect(comp.estadoCampo('numeroPagos')).toBe('error');
      expect(comp.campoCompleto('numeroPagos')).toBeFalse();
    });

    it('un readonly con dato se pone verde', () => {
      // `salario` va deshabilitado: Angular lo reporta inválido y aun así el dato
      // está resuelto y tiene que verse completo.
      comp.pagoTransporteForm.get('salario')!.setValue(1750905);
      expect(comp.campoCompleto('salario')).toBeTrue();
    });

    it('un condicional que no aplica no cuenta como pendiente ni se pinta', () => {
      // Daviplata oculta la contraseña de la tarjeta.
      comp.pagoTransporteForm.get('formaPago')!.setValue('Daviplata');
      comp.pagoTransporteForm.get('contraseniaAsignada')!.setValue('');

      expect(comp.estadoCampo('contraseniaAsignada')).toBe('normal');
    });

    it('el mismo condicional sí cuenta con otra forma de pago', () => {
      comp.pagoTransporteForm.get('formaPago')!.setValue('Bancolombia');
      comp.pagoTransporteForm.get('contraseniaAsignada')!.setValue('CLAVE');

      expect(comp.campoCompleto('contraseniaAsignada')).toBeTrue();
    });

    it('no se necesita guardar para ponerse verde', () => {
      comp.pagoTransporteForm.get('grupo')!.setValue('GRUPO 1');

      expect(comp.campoCompleto('grupo')).toBeTrue();
      expect(procesos.updateProcesoByDocumento).not.toHaveBeenCalled();
    });

    it('los datos que llegan guardados aparecen verdes al recargar', () => {
      abrir(candidato({ cesantias: 'PORVENIR', grupo: 'GRUPO 1', horas_extras: false }));

      expect(comp.campoCompleto('cesantias')).toBeTrue();
      expect(comp.campoCompleto('grupo')).toBeTrue();
      expect(comp.campoCompleto('horasExtras')).toBeTrue();
    });
  });
});

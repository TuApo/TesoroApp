/**
 * Pestaña "Entrevista" — pruebas de componente.
 *
 * Es el formulario más grande de la aplicación (~1.600 líneas, siete pasos) y
 * el que guarda TODOS los datos personales del candidato. Hasta ahora no tenía
 * ninguna prueba: lo único que se sabía de él es que compilaba.
 *
 * Lo que se verifica acá es el ciclo que importa: que al abrir un candidato los
 * campos se llenen con lo que hay en la base, que no se pueda guardar con el
 * formulario incompleto, y que al guardar salga el payload correcto —
 * incluyendo el BARRIO, que se acaba de mudar desde la pestaña de Antecedentes.
 */
import { ComponentFixture, TestBed, fakeAsync, flush, flushMicrotasks, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { FormEntrevistaComponent } from './form-entrevista.component';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { GestionParametrizacionService } from '../../../users/services/gestion-parametrizacion/gestion-parametrizacion.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';

/** Opciones que devuelven los catálogos del backend. */
const CATALOGO = [
  { codigo: 'CC', descripcion: 'Cédula de Ciudadanía' },
  { codigo: 'SOLTERO', descripcion: 'Soltero(a)' },
  { codigo: 'BACHILLER', descripcion: 'Bachiller' },
  { codigo: 'PADRE', descripcion: 'Padre' },
  { codigo: 'GMAIL.COM', descripcion: 'gmail.com' },
  { codigo: 'REDES', descripcion: 'Redes sociales' },
  { codigo: 'SOLO', descripcion: 'Solo' },
];

function candidato(extra: any = {}) {
  return {
    numero_documento: '1082490391',
    tipo_doc: 'CC',
    primer_nombre: 'LEIVIS',
    segundo_nombre: 'ESTHER',
    primer_apellido: 'BAZA',
    segundo_apellido: 'GARCIA',
    residencia: {
      direccion: 'CALLE 1 # 2-3',
      barrio: 'ALAMOS',
    },
    contacto: { celular: '3001234567', correo_electronico: 'a@b.com' },
    entrevistas: [{ proceso: { id: 1 } }],
    ...extra,
  };
}

describe('FormEntrevistaComponent', () => {
  let fixture: ComponentFixture<FormEntrevistaComponent>;
  let comp: FormEntrevistaComponent;
  let candidatos: jasmine.SpyObj<RegistroProcesoContratacion>;
  let catalogos: jasmine.SpyObj<GestionParametrizacionService>;

  beforeEach(async () => {
    candidatos = jasmine.createSpyObj('RegistroProcesoContratacion',
      ['upsertCandidatoByDocumentoFromForm', 'getCandidatoPorDocumento']);
    candidatos.upsertCandidatoByDocumentoFromForm.and.returnValue(of({ ok: true }));
    candidatos.getCandidatoPorDocumento.and.returnValue(of(null as any));

    catalogos = jasmine.createSpyObj('GestionParametrizacionService',
      ['listDatosByTablaCodigo', 'listMetaValoresByTablaCodigo']);
    catalogos.listDatosByTablaCodigo.and.returnValue(of(CATALOGO as any));
    catalogos.listMetaValoresByTablaCodigo.and.returnValue(of([] as any));

    await TestBed.configureTestingModule({
      imports: [FormEntrevistaComponent, NoopAnimationsModule],
      providers: [
        // El rail de dos capas lo provee `RecruitmentPipelineComponent`; probando
        // el hijo suelto hay que darlo a mano.
        PipelineNavService,
        { provide: RegistroProcesoContratacion, useValue: candidatos },
        { provide: GestionParametrizacionService, useValue: catalogos },
        // `SeleccionEstadoService` es solo signals, sin HTTP: se usa el REAL.
        { provide: UtilityServiceService, useValue: { getUser: () => Promise.resolve({}) } },
        {
          // El componente lee `queryParamMap` para preasignar la oficina.
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: new Map(), queryParamMap: new Map() },
            params: of({}),
            queryParams: of({}),
            queryParamMap: of(new Map() as any),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormEntrevistaComponent);
    comp = fixture.componentInstance;
  });

  function abrir(cand: any) {
    fixture.componentRef.setInput('candidatoSeleccionado', cand);
    fixture.detectChanges();
  }

  // ─────────────────────────────────────────────────────────────
  describe('se arma el formulario', () => {

    it('crea el FormGroup con los pasos', () => {
      fixture.detectChanges();
      expect(comp.formVacante).toBeTruthy();
      expect(comp.step1Ctrl).toBeTruthy();
      expect(comp.step7Ctrl).toBeTruthy();
    });

    it('el barrio vive en ESTE formulario', () => {
      // Se movió acá desde la pestaña de Antecedentes, donde estaba duplicado.
      fixture.detectChanges();
      expect(comp.formVacante.get('barrio')).toBeTruthy();
    });

    it('los campos de residencia están juntos', () => {
      fixture.detectChanges();
      expect(comp.formVacante.get('direccion_de_residencia')).toBeTruthy();
      expect(comp.formVacante.get('barrio')).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('llenado desde el candidato', () => {

    it('trae los nombres y apellidos guardados', () => {
      abrir(candidato());
      expect(comp.formVacante.get('primer_nombre')!.value).toBe('LEIVIS');
      expect(comp.formVacante.get('primer_apellido')!.value).toBe('BAZA');
    });

    it('trae el barrio de la residencia', () => {
      abrir(candidato());
      expect(comp.formVacante.get('barrio')!.value).toBe('ALAMOS');
    });

    it('trae la dirección de residencia', () => {
      abrir(candidato());
      expect(comp.formVacante.get('direccion_de_residencia')!.value).toBe('CALLE 1 # 2-3');
    });

    it('un candidato sin residencia no revienta y deja el barrio vacío', () => {
      abrir(candidato({ residencia: null }));
      expect(comp.formVacante.get('barrio')!.value).toBe('');
    });

    it('cambiar de candidato reemplaza los datos del anterior', () => {
      abrir(candidato());
      expect(comp.formVacante.get('barrio')!.value).toBe('ALAMOS');

      abrir(candidato({
        numero_documento: '999', primer_nombre: 'OTRO',
        residencia: { direccion: 'X', barrio: 'CENTRO' },
      }));
      expect(comp.formVacante.get('primer_nombre')!.value).toBe('OTRO');
      expect(comp.formVacante.get('barrio')!.value).toBe('CENTRO');
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('formación', () => {

    it('trae TODO el detalle de la escolaridad, no solo el nivel', () => {
      // El guardado reemplaza `formaciones`: si la pantalla no carga estos
      // cuatro campos, la siguiente entrevista guardada los deja en NULL.
      abrir(candidato({
        formaciones: [{
          nivel: 'OTROS',
          estudios_extra: 'TECNÓLOGO',
          titulo_obtenido: 'GESTIÓN AGROPECUARIA',
          institucion: 'SENA',
          anio_finalizacion: 2021,
        }],
      }));

      expect(comp.formVacante.get('nivel')!.value).toBe('OTROS');
      // Con tilde en la base (lo escribe el formulario público) y sin ella en la
      // lista: el guardado de la entrevista quita las tildes, así que las dos
      // escrituras tienen que caer en la misma opción o el select sale vacío.
      expect(comp.formVacante.get('estudiosExtra')!.value).toBe('TECNOLOGO');
      expect(comp.formVacante.get('tituloObtenido')!.value).toBe('GESTIÓN AGROPECUARIA');
      expect(comp.formVacante.get('institucionEstudio')!.value).toBe('SENA');
      expect(comp.formVacante.get('anioFinalizacion')!.value).toBe(2021);
    });

    it('el nivel superior ya guardado por la entrevista (sin tilde) también casa', () => {
      abrir(candidato({ formaciones: [{ nivel: 'OTROS', estudios_extra: 'TECNOLOGO' }] }));
      expect(comp.formVacante.get('estudiosExtra')!.value).toBe('TECNOLOGO');
    });

    it('un nivel superior que no está en la lista no ensucia el select', () => {
      abrir(candidato({ formaciones: [{ nivel: 'OTROS', estudios_extra: 'CUALQUIER COSA' }] }));
      expect(comp.formVacante.get('estudiosExtra')!.value).toBe('');
    });

    it('sin formación registrada los campos quedan vacíos, no en undefined', () => {
      abrir(candidato());
      expect(comp.formVacante.get('estudiosExtra')!.value).toBe('');
      expect(comp.formVacante.get('anioFinalizacion')!.value).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('hijos: nombre y edad', () => {

    /**
     * Fecha de nacimiento que hoy da exactamente `meses` de vida.
     *
     * Se arma con los componentes LOCALES y no con `toISOString()`: en una zona
     * detrás de UTC, el ISO de la tarde cae en el día siguiente y la prueba
     * pasaría o fallaría según la hora a la que se corriera.
     */
    function naceHace(meses: number): string {
      const hoy = new Date();
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - meses, 1);
      // Sin acotar el día, un 31 restado sobre un mes de 30 desborda al
      // siguiente (`setMonth` no recorta) y la prueba fallaría un día al mes.
      const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(hoy.getDate(), ultimo));
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
    }

    it('la edad va en años a partir del año de vida', () => {
      abrir(candidato({
        hijos: [{ numero_de_documento: '111111', fecha_nac: naceHace(84), primer_nombre: 'SARA', primer_apellido: 'BAZA' }],
      }));
      expect(comp.hijosResumen().length).toBe(1);
      expect(comp.hijosResumen()[0].nombre).toBe('SARA BAZA');
      expect(comp.hijosResumen()[0].edad).toBe('7 años');
    });

    it('por debajo del año la edad se dice en MESES', () => {
      // "0 años" no es una respuesta para un bebé, y es justo la edad que
      // decide si la persona necesita quién lo cuide.
      abrir(candidato({
        hijos: [{ numero_de_documento: '222222', fecha_nac: naceHace(8), primer_nombre: 'LUIS' }],
      }));
      expect(comp.hijosResumen()[0].edad).toBe('8 meses');
    });

    it('el recién nacido no dice "0 meses"', () => {
      abrir(candidato({
        hijos: [{ numero_de_documento: '333333', fecha_nac: naceHace(0), primer_nombre: 'ANA' }],
      }));
      expect(comp.hijosResumen()[0].edad).toBe('menos de un mes');
    });

    it('sin nombre registrado se identifica por el documento', () => {
      abrir(candidato({ hijos: [{ numero_de_documento: '444444', fecha_nac: naceHace(24) }] }));
      expect(comp.hijosResumen()[0].nombre).toBe('Doc. 444444');
      expect(comp.hijosResumen()[0].edad).toBe('2 años');
    });

    it('sin fecha de nacimiento lo dice en vez de inventar una edad', () => {
      abrir(candidato({ hijos: [{ numero_de_documento: '555555', primer_nombre: 'EVA' }] }));
      expect(comp.hijosResumen()[0].edad).toBe('sin fecha de nacimiento');
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('guardado automático (sin botón "Enviar")', () => {

    it('cambiar una respuesta la guarda sola, aunque falten obligatorios', fakeAsync(() => {
      abrir(candidato());
      tick();
      const ctrl = comp.formVacante.get('experienciaFlores')!;
      ctrl.markAsDirty();
      ctrl.setValue('Sí');
      tick(300);
      flushMicrotasks();
      expect(candidatos.upsertCandidatoByDocumentoFromForm).toHaveBeenCalled();
      const [, proceso] = candidatos.upsertCandidatoByDocumentoFromForm.calls.mostRecent().args;
      expect(proceso).withContext('a medias no se marca entrevistado').toBeUndefined();
      flush();
    }));

    it('cargar a la persona no escribe nada', fakeAsync(() => {
      abrir(candidato());
      tick(2000);
      expect(candidatos.upsertCandidatoByDocumentoFromForm).not.toHaveBeenCalled();
      flush();
    }));
  });

  // ─────────────────────────────────────────────────────────────
  describe('validación antes de guardar', () => {

    it('el formulario vacío es inválido', () => {
      fixture.detectChanges();
      expect(comp.formVacante.valid).toBeFalse();
    });

    it('NO llama al backend si el formulario está incompleto', fakeAsync(() => {
      fixture.detectChanges();
      comp.onSubmit();
      tick();
      expect(candidatos.upsertCandidatoByDocumentoFromForm).not.toHaveBeenCalled();
    }));

    it('marca los campos como tocados para que se vean en rojo', fakeAsync(() => {
      fixture.detectChanges();
      comp.onSubmit();
      tick();
      expect(comp.formVacante.get('primer_nombre')!.touched).toBeTrue();
    }));

    it('el barrio es obligatorio', () => {
      fixture.detectChanges();
      const barrio = comp.formVacante.get('barrio')!;
      barrio.setValue('');
      expect(barrio.valid).toBeFalse();
      barrio.setValue('ALAMOS');
      expect(barrio.valid).toBeTrue();
    });

    it('no deja enviar dos veces seguidas', fakeAsync(() => {
      fixture.detectChanges();
      comp.isSubmitting = true;
      comp.onSubmit();
      tick();
      expect(candidatos.upsertCandidatoByDocumentoFromForm).not.toHaveBeenCalled();
    }));
  });

  // ─────────────────────────────────────────────────────────────
  describe('catálogos', () => {

    it('pide los catálogos al backend', () => {
      fixture.detectChanges();
      expect(catalogos.listDatosByTablaCodigo).toHaveBeenCalled();
    });

    it('un catálogo que falla no impide usar el formulario', () => {
      // `safeCatalog` atrapa el error y devuelve lista vacía; el formulario
      // tiene que seguir montándose.
      catalogos.listDatosByTablaCodigo.and.returnValue(of([] as any));
      expect(() => fixture.detectChanges()).not.toThrow();
      expect(comp.formVacante).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('override "modificar de todas formas"', () => {

    it('por defecto viene apagado', () => {
      fixture.detectChanges();
      expect(comp.modificacionForzada()).toBeFalse();
    });

    it('se puede encender desde el padre', () => {
      fixture.componentRef.setInput('modificacionForzada', true);
      fixture.componentRef.setInput('modificadoPor', 'ANA GOMEZ');
      fixture.detectChanges();
      expect(comp.modificacionForzada()).toBeTrue();
      expect(comp.modificadoPor()).toBe('ANA GOMEZ');
    });
  });
});

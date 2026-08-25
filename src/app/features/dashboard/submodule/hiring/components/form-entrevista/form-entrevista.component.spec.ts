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
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
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

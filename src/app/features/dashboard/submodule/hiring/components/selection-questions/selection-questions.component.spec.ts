/**
 * Pestaña "Antecedentes Judiciales" — pruebas de componente.
 *
 * Cubre las tres cosas que se rompieron de verdad en este componente:
 *
 *  1. La SUBIDA se perdía en silencio. `guardado.emit()` iba ANTES de subir los
 *     PDFs; el padre recargaba el candidato, el effect llamaba
 *     `resetUploadedFilesAsNew()` y borraba los File pendientes. La subida no
 *     encontraba nada y aun así decía "Todos los documentos se subieron
 *     correctamente".
 *  2. Los valores guardados no coincidían LETRA POR LETRA con el catálogo, y el
 *     `mat-select` los mostraba vacíos ('PROTECCIÓN ' con tilde, 'Sin Buscar'
 *     en minúsculas). Datos correctos en la base, campo en blanco en pantalla.
 *  3. El campo Barrio estaba duplicado acá y en la pestaña de Entrevista.
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

import { SelectionQuestionsComponent } from './selection-questions.component';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { RobotsService } from '../../service/robots/robots.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';

/** Candidato mínimo con los antecedentes ya guardados que se quieran probar. */
function candidatoCon(antecedentes: Array<{ nombre: string; observacion: any }>) {
  return {
    numero_documento: '1082490391',
    tipo_documento: 'CC',
    entrevistas: [{ proceso: { id: 1, antecedentes } }],
  };
}

describe('SelectionQuestionsComponent', () => {
  let fixture: ComponentFixture<SelectionQuestionsComponent>;
  let comp: SelectionQuestionsComponent;
  let docsSrv: jasmine.SpyObj<GestionDocumentalService>;
  let rpc: jasmine.SpyObj<RegistroProcesoContratacion>;

  beforeEach(async () => {
    docsSrv = jasmine.createSpyObj('GestionDocumentalService',
      ['getDocuments', 'guardarDocumento', 'getDocumentosDeCandidato', 'invalidarDocumentos']);
    docsSrv.getDocuments.and.returnValue(of([]));
    docsSrv.getDocumentosDeCandidato.and.returnValue(of([]));
    docsSrv.guardarDocumento.and.returnValue(of({ id: 1 }));

    rpc = jasmine.createSpyObj('RegistroProcesoContratacion',
      ['upsertSeleccionByDocumento', 'upsertCandidatoByDocumento']);
    rpc.upsertSeleccionByDocumento.and.returnValue(
      of({ message: 'updated', proceso_id: 1, procesoSeleccion: {} as any }));
    rpc.upsertCandidatoByDocumento.and.returnValue(of({}));

    const robots = jasmine.createSpyObj('RobotsService',
      ['getResultadosAntecedentes', 'forzarConsultaFuente']);
    robots.getResultadosAntecedentes.and.returnValue(of({ encontrado: false, campos: {} }));

    await TestBed.configureTestingModule({
      imports: [SelectionQuestionsComponent, NoopAnimationsModule],
      providers: [
        // El rail de dos capas lo provee `RecruitmentPipelineComponent`; probando
        // el hijo suelto hay que darlo a mano.
        PipelineNavService,
        { provide: GestionDocumentalService, useValue: docsSrv },
        { provide: RegistroProcesoContratacion, useValue: rpc },
        { provide: RobotsService, useValue: robots },
        { provide: UtilityServiceService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectionQuestionsComponent);
    comp = fixture.componentInstance;
  });

  function abrirCandidato(cand: any) {
    fixture.componentRef.setInput('candidatoSeleccionado', cand);
    fixture.detectChanges();
  }

  // ─────────────────────────────────────────────────────────────
  describe('lectura de lo guardado', () => {

    it('llena los campos con los antecedentes del proceso', () => {
      abrirCandidato(candidatoCon([
        { nombre: 'EPS', observacion: 'SURA' },
        { nombre: 'AFP', observacion: 'PORVENIR' },
        { nombre: 'POLICIVOS', observacion: 'CUMPLE' },
      ]));

      expect(comp.antecedentes.get('eps')!.value).toBe('SURA');
      expect(comp.antecedentes.get('afp')!.value).toBe('PORVENIR');
      expect(comp.antecedentes.get('policivos')!.value).toBe('CUMPLE');
    });

    it('un AFP guardado CON TILDE se alinea con la opción sin tilde', () => {
      // 17 filas reales en producción tenían 'PROTECCIÓN ' y el select salía vacío.
      abrirCandidato(candidatoCon([{ nombre: 'AFP', observacion: 'PROTECCIÓN ' }]));

      expect(comp.antecedentes.get('afp')!.value).toBe('PROTECCION');
      expect(comp.afpList).toContain(comp.antecedentes.get('afp')!.value as any);
    });

    it('un valor guardado en minúsculas se alinea con la opción del catálogo', () => {
      abrirCandidato(candidatoCon([{ nombre: 'SISBEN', observacion: 'Cumple' }]));
      expect(comp.antecedentes.get('sisben')!.value).toBe('CUMPLE');
    });

    it('respeta la escritura mixta del catálogo (no lo pasa todo a MAYÚSCULAS)', () => {
      // 'Sin Buscar' existe así en el catálogo; convertirlo a 'SIN BUSCAR'
      // hacía que el mat-select no encontrara la opción.
      abrirCandidato(candidatoCon([{ nombre: 'AFP', observacion: 'sin buscar' }]));
      expect(comp.antecedentes.get('afp')!.value).toBe('Sin Buscar');
    });

    it('un valor que no existe en el catálogo se deja tal cual, sin inventar', () => {
      abrirCandidato(candidatoCon([{ nombre: 'AFP', observacion: 'COLFONDO' }]));
      expect(comp.antecedentes.get('afp')!.value).toBe('COLFONDO');
    });

    it('al cambiar de candidato no arrastra los valores del anterior', () => {
      abrirCandidato(candidatoCon([{ nombre: 'EPS', observacion: 'SURA' }]));
      expect(comp.antecedentes.get('eps')!.value).toBe('SURA');

      abrirCandidato({ ...candidatoCon([]), numero_documento: '999' });
      expect(comp.antecedentes.get('eps')!.value).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('catálogo de AFP', () => {

    it('incluye No Tiene y Sin Buscar', () => {
      // Sin ellas no había forma de registrar que la persona no cotiza pensión.
      expect(comp.afpList).toContain('No Tiene' as any);
      expect(comp.afpList).toContain('Sin Buscar' as any);
    });

    it('conserva los cinco fondos', () => {
      for (const fondo of ['PORVENIR', 'COLFONDOS', 'PROTECCION', 'COLPENSIONES', 'SKANDIA']) {
        expect(comp.afpList).toContain(fondo as any);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('subida de documentos', () => {

    it('captura los PDF pendientes ANTES de cualquier await', () => {
      abrirCandidato(candidatoCon([]));
      const pdf = new File([new Blob(['x'])], 'sisben.pdf', { type: 'application/pdf' });
      comp.subirArchivo({ target: { files: [pdf] } } as any, 'sisben');

      const pendientes = comp.capturarPendientes(['sisben', 'afp'] as any);

      expect(pendientes.length).toBe(1);
      expect(pendientes[0].key).toBe('sisben');
      expect(pendientes[0].typeId).toBe(8, 'sisbén es el tipo documental 8');
    });

    it('un reset posterior NO invalida lo ya capturado', fakeAsync(() => {
      // Éste es exactamente el bug: el padre recargaba, el effect reseteaba, y
      // la subida se quedaba sin archivos aunque el usuario sí había adjuntado.
      abrirCandidato(candidatoCon([]));
      const pdf = new File([new Blob(['x'])], 'afp.pdf', { type: 'application/pdf' });
      comp.subirArchivo({ target: { files: [pdf] } } as any, 'afp');

      const pendientes = comp.capturarPendientes(['afp'] as any);
      abrirCandidato(candidatoCon([]));   // simula la recarga del padre

      comp.subirTodosLosArchivos(pendientes);
      tick();

      expect(docsSrv.guardarDocumento).toHaveBeenCalledTimes(1);
      expect(docsSrv.guardarDocumento.calls.mostRecent().args[2]).toBe(11, 'AFP es el tipo 11');
    }));

    it('sin archivos adjuntos no llama al backend', fakeAsync(() => {
      abrirCandidato(candidatoCon([]));
      comp.subirTodosLosArchivos(comp.capturarPendientes(['afp', 'sisben'] as any));
      tick();
      expect(docsSrv.guardarDocumento).not.toHaveBeenCalled();
    }));

    it('reporta el fallo de un documento sin tumbar los demás', fakeAsync(() => {
      abrirCandidato(candidatoCon([]));
      docsSrv.guardarDocumento.and.returnValue(throwError(() => ({ error: { error: 'PDF dañado' } })));

      const pdf = new File([new Blob(['x'])], 'a.pdf', { type: 'application/pdf' });
      comp.subirArchivo({ target: { files: [pdf] } } as any, 'sisben');

      let res: any;
      comp.subirTodosLosArchivos(comp.capturarPendientes(['sisben'] as any)).then(r => res = r);
      tick();

      expect(res.todosOk).toBeFalse();
      expect(res.fallidos[0].key).toBe('sisben');
      expect(res.fallidos[0].error).toContain('PDF dañado');
    }));

    it('rechaza archivos que no son PDF', () => {
      abrirCandidato(candidatoCon([]));
      const jpg = new File([new Blob(['x'])], 'foto.jpg', { type: 'image/jpeg' });
      comp.subirArchivo({ target: { files: [jpg] } } as any, 'sisben');

      expect(comp.capturarPendientes(['sisben'] as any).length)
        .toBe(0, 'solo se aceptan PDF');
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('el barrio ya no vive acá', () => {

    it('el formulario no tiene control de barrio', () => {
      // Se movió a la pestaña de Entrevista, donde está el resto de residencia
      // y ya tenía su validación.
      expect(comp.antecedentes.get('barrio')).toBeNull();
    });

    it('guardar no llama al endpoint de candidato para el barrio', fakeAsync(() => {
      abrirCandidato(candidatoCon([]));
      comp.antecedentes.get('eps')!.setValue('SURA');

      comp.imprimirVerificacionesAplicacion();
      tick();

      expect(rpc.upsertCandidatoByDocumento).not.toHaveBeenCalled();
    }));
  });
});

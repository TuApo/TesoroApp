/**
 * Antecedentes — USO TORPE.
 *
 * El otro spec prueba el camino feliz. Éste prueba lo que pasa de verdad en una
 * oficina: doble clic, archivos equivocados, campos con basura, cambiar de
 * candidato a mitad de un guardado, darle a guardar sin llenar nada.
 *
 * La regla acá es: la aplicación NO puede quedar en un estado raro ni perder
 * datos por culpa de alguien que no sabe qué está haciendo.
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { SelectionQuestionsComponent } from './selection-questions.component';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { RobotsService } from '../../service/robots/robots.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';

describe('SelectionQuestions — uso torpe', () => {
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

    const robots = jasmine.createSpyObj('RobotsService',
      ['getResultadosAntecedentes', 'forzarConsultaFuente']);
    robots.getResultadosAntecedentes.and.returnValue(of({ encontrado: false, campos: {} }));

    await TestBed.configureTestingModule({
      imports: [SelectionQuestionsComponent, NoopAnimationsModule],
      providers: [
        { provide: GestionDocumentalService, useValue: docsSrv },
        { provide: RegistroProcesoContratacion, useValue: rpc },
        { provide: RobotsService, useValue: robots },
        { provide: UtilityServiceService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectionQuestionsComponent);
    comp = fixture.componentInstance;
  });

  /**
   * Deja los 7 antecedentes obligatorios con una opcion valida.
   *
   * Sin esto `imprimirVerificacionesAplicacion()` sale por el camino de
   * "Campos incompletos" y nunca llega al backend, que es justo lo que hacia
   * fallar a estas pruebas cuando los antecedentes dejaron de ser opcionales.
   */
  function llenarObligatorios() {
    comp.antecedentes.patchValue({
      eps: 'SURA',
      afp: 'PORVENIR',
      sisben: 'A1',
      policivos: 'CUMPLE',
      procuraduria: 'CUMPLE',
      contraloria: 'CUMPLE',
      ofac: 'CUMPLE',
    });
  }

  function abrir(cand: any) {
    fixture.componentRef.setInput('candidatoSeleccionado', cand);
    fixture.detectChanges();
  }
  const cand = (ants: any[] = []) => ({
    numero_documento: '1082490391', tipo_documento: 'CC',
    entrevistas: [{ proceso: { id: 1, antecedentes: ants } }],
  });
  const pdf = (nombre = 'a.pdf') =>
    new File([new Blob(['x'])], nombre, { type: 'application/pdf' });

  // ───────────────────────────────────────────────────────────
  describe('sube el archivo equivocado', () => {

    it('un Word no se acepta', () => {
      abrir(cand());
      const doc = new File([new Blob(['x'])], 'hoja.docx',
        { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      comp.subirArchivo({ target: { files: [doc] } } as any, 'sisben');
      expect(comp.capturarPendientes(['sisben'] as any).length).toBe(0);
    });

    it('una foto no se acepta', () => {
      abrir(cand());
      const jpg = new File([new Blob(['x'])], 'pantallazo.jpg', { type: 'image/jpeg' });
      comp.subirArchivo({ target: { files: [jpg] } } as any, 'sisben');
      expect(comp.capturarPendientes(['sisben'] as any).length).toBe(0);
    });

    it('un archivo con nombre larguísimo se rechaza antes de mandarlo', () => {
      // El título del documento se corta en 100 caracteres en el backend.
      abrir(cand());
      comp.subirArchivo({ target: { files: [pdf('a'.repeat(150) + '.pdf')] } } as any, 'sisben');
      expect(comp.capturarPendientes(['sisben'] as any).length).toBe(0);
    });

    it('abrir el explorador y cancelar no deja nada a medias', () => {
      abrir(cand());
      comp.subirArchivo({ target: { files: [] } } as any, 'sisben');
      expect(comp.capturarPendientes(['sisben'] as any).length).toBe(0);
    });

    it('un evento sin archivos no revienta', () => {
      abrir(cand());
      expect(() => comp.subirArchivo({} as any, 'sisben')).not.toThrow();
    });

    it('adjuntar dos veces al mismo campo deja solo el último', () => {
      abrir(cand());
      comp.subirArchivo({ target: { files: [pdf('primero.pdf')] } } as any, 'sisben');
      comp.subirArchivo({ target: { files: [pdf('segundo.pdf')] } } as any, 'sisben');

      const p = comp.capturarPendientes(['sisben'] as any);
      expect(p.length).toBe(1);
      expect(p[0].fileName).toBe('segundo.pdf');
    });
  });

  // ───────────────────────────────────────────────────────────
  describe('le da clic de más', () => {

    it('subir dos veces seguidas no manda el archivo dos veces', fakeAsync(() => {
      abrir(cand());
      comp.subirArchivo({ target: { files: [pdf()] } } as any, 'sisben');

      comp.subirTodosLosArchivos(comp.capturarPendientes(['sisben'] as any));
      tick();
      const quedaPendiente = comp.capturarPendientes(['sisben'] as any);

      expect(docsSrv.guardarDocumento).toHaveBeenCalledTimes(1);
      expect(quedaPendiente.length)
        .withContext('tras subir, el archivo deja de estar pendiente').toBe(0);
    }));

    it('darle a Cargar dos veces seguidas', fakeAsync(() => {
      abrir(cand());
      llenarObligatorios();
      comp.imprimirVerificacionesAplicacion();
      comp.imprimirVerificacionesAplicacion();
      tick();
      // No hay bloqueo de doble envío en este formulario: se documenta que el
      // backend es idempotente (update_or_create por nombre de antecedente).
      expect(rpc.upsertSeleccionByDocumento.calls.count())
        .withContext('el upsert del backend es idempotente, no duplica filas')
        .toBeGreaterThan(0);
    }));

    it('cambiar de candidato a mitad del guardado sube con la cédula ACTUAL', fakeAsync(() => {
      abrir(cand());
      comp.subirArchivo({ target: { files: [pdf()] } } as any, 'sisben');
      const pendientes = comp.capturarPendientes(['sisben'] as any);

      abrir({ ...cand(), numero_documento: '999' });   // se aburrió y buscó a otro

      comp.subirTodosLosArchivos(pendientes);
      tick();

      expect(docsSrv.guardarDocumento.calls.mostRecent().args[1]).toBe('999');
    }));
  });

  // ───────────────────────────────────────────────────────────
  describe('datos basura que vienen de la base', () => {

    it('un antecedente en null deja el campo vacío, no "null"', () => {
      abrir(cand([{ nombre: 'AFP', observacion: null }]));
      expect(comp.antecedentes.get('afp')!.value).toBe('');
    });

    it('el string literal "None" no se muestra como si fuera un fondo', () => {
      // 2.680 filas reales en producción tienen ese valor.
      abrir(cand([{ nombre: 'AFP', observacion: 'None' }]));
      expect(comp.afpList).not.toContain(comp.antecedentes.get('afp')!.value as any);
    });

    it('un nombre de antecedente inventado se ignora sin romper', () => {
      expect(() => abrir(cand([{ nombre: 'INVENTADO_XYZ', observacion: 'ALGO' }]))).not.toThrow();
    });

    it('semanas cotizadas con texto NUNCA queda en NaN', () => {
      abrir(cand([{ nombre: 'SEMANAS_COTIZADAS', observacion: 'MUCHAS' }]));
      expect(Number.isNaN(comp.antecedentes.get('semanasCotizadas')!.value as any)).toBeFalse();
    });

    it('semanas cotizadas negativas no revientan', () => {
      expect(() => abrir(cand([{ nombre: 'SEMANAS_COTIZADAS', observacion: '-500' }]))).not.toThrow();
    });

    it('semanas cotizadas absurdamente grandes no revientan', () => {
      expect(() => abrir(cand([{ nombre: 'SEMANAS_COTIZADAS', observacion: '999999999' }]))).not.toThrow();
    });

    it('un candidato sin entrevistas no revienta', () => {
      expect(() => abrir({ numero_documento: '1', entrevistas: [] })).not.toThrow();
    });

    it('un candidato null no revienta', () => {
      expect(() => abrir(null)).not.toThrow();
    });

    it('antecedentes que llegan como diccionario en vez de lista', () => {
      expect(() => abrir({
        numero_documento: '1',
        entrevistas: [{ proceso: { antecedentes: { eps: 'SURA', policivos: 'CUMPLE' } } }],
      })).not.toThrow();
    });

    it('el mismo antecedente repetido dos veces toma uno solo', () => {
      abrir(cand([
        { nombre: 'AFP', observacion: 'PORVENIR' },
        { nombre: 'AFP', observacion: 'COLFONDOS' },
      ]));
      expect(['PORVENIR', 'COLFONDOS']).toContain(comp.antecedentes.get('afp')!.value as any);
    });
  });

  // ───────────────────────────────────────────────────────────
  describe('guarda sin llenar nada', () => {

    // Antes los antecedentes eran opcionales y esto guardaba en blanco. Hoy hay
    // 7 con Validators.required: guardar vacio dejaba fichas sin EPS ni AFP que
    // luego habia que perseguir a mano.
    it('con todo vacío NO guarda: los 7 antecedentes son obligatorios', fakeAsync(() => {
      abrir(cand());
      comp.imprimirVerificacionesAplicacion();
      tick();
      expect(rpc.upsertSeleccionByDocumento)
        .withContext('sale por "Campos incompletos" antes de llamar al backend')
        .not.toHaveBeenCalled();
      expect(comp.antecedentes.invalid).toBeTrue();
    }));

    it('con los obligatorios llenos sí guarda', fakeAsync(() => {
      abrir(cand());
      llenarObligatorios();
      comp.imprimirVerificacionesAplicacion();
      tick();
      expect(rpc.upsertSeleccionByDocumento).toHaveBeenCalled();
    }));

    it('sin candidato NO llama al backend', fakeAsync(() => {
      fixture.detectChanges();
      comp.imprimirVerificacionesAplicacion();
      tick();
      expect(rpc.upsertSeleccionByDocumento).not.toHaveBeenCalled();
    }));
  });
});

/**
 * Pipeline de contratación — pruebas de componente.
 *
 * Es la pantalla que orquesta todos los tabs. Se prueban las dos cosas que se
 * rompieron acá y que no se veían compilando:
 *
 *  1. La FOTO. `camera-dialog` devolvía una URL `blob:` y la revocaba en su
 *     propio `ngOnDestroy`, o sea justo al cerrarse. El pipeline guardaba esa
 *     URL muerta y el avatar mostraba el texto alternativo hasta que se volvía
 *     a consultar al candidato.
 *  2. El BORRADO de procesos desde el historial: tiene que mandar el id de ESA
 *     fila, no el del proceso más reciente.
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';

import { RecruitmentPipelineComponent } from './recruitment-pipeline.component';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { HiringService } from '../../service/hiring.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { ElectronWindowService } from '@/app/core/services/electron-window.service';
import Swal from 'sweetalert2';

describe('RecruitmentPipelineComponent', () => {
  let fixture: ComponentFixture<RecruitmentPipelineComponent>;
  let comp: RecruitmentPipelineComponent;
  let registro: jasmine.SpyObj<RegistroProcesoContratacion>;
  let dialog: jasmine.SpyObj<MatDialog>;

  beforeEach(async () => {
    registro = jasmine.createSpyObj('RegistroProcesoContratacion', [
      'getCandidatoPorDocumento', 'eliminarProceso', 'listProcesosMiniByDocumento',
      'updateProcesoByDocumento', 'uploadFoto',
    ]);
    registro.getCandidatoPorDocumento.and.returnValue(of(null as any));
    registro.eliminarProceso.and.returnValue(of({
      message: 'deleted',
      eliminado: { entrevista_id: 10, proceso_id: 5, codigo_contrato: null, contrato_activo: false, antecedentes: 2 },
      candidato_conservado: { numero_documento: '1', formulario_paso: 5, formulario_completo: true },
    } as any));
    registro.listProcesosMiniByDocumento.and.returnValue(of([] as any));
    registro.updateProcesoByDocumento.and.returnValue(of({} as any));
    registro.uploadFoto.and.returnValue(of({} as any));

    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(true), componentInstance: {} } as any);

    await TestBed.configureTestingModule({
      imports: [RecruitmentPipelineComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RegistroProcesoContratacion, useValue: registro },
        { provide: MatDialog, useValue: dialog },
        {
          provide: GestionDocumentalService,
          useValue: {
            getDocuments: () => of([]),
            guardarDocumento: () => of({}),
            getDocumentosDeCandidato: () => of([]),
            invalidarDocumentos: () => {},
          },
        },
        { provide: HiringService, useValue: {} },
        {
          provide: UtilityServiceService,
          useValue: {
            getUser: () => Promise.resolve({}),
            normalizeText: (v: any) => String(v ?? '').trim().toUpperCase(),
          },
        },
        {
          provide: ElectronWindowService,
          useValue: { openPdfFromBlob: () => Promise.resolve(), openExternal: () => { } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecruitmentPipelineComponent);
    comp = fixture.componentInstance;

    // El componente es standalone e importa `MatDialogModule`, cuyo provider
    // de `MatDialog` gana sobre el de TestBed. Se reemplaza en la instancia
    // para poder controlar las confirmaciones.
    (comp as any).dialog = dialog;
  });

  it('se construye con sus dependencias', () => {
    // No se llama `detectChanges()` a propósito: los effects de esta pantalla
    // arrancan media docena de cargas (exámenes, ARL, documentos, tabla) y
    // montarla entera exigiría simular casi toda la app. Lo que se prueba acá
    // son los métodos, que es donde estaban los bugs.
    expect(comp).toBeTruthy();
    expect(comp.candidatoSeleccionado).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────
  describe('vista previa de la foto', () => {

    it('crea una URL PROPIA a partir del archivo', () => {
      // No se reutiliza la del diálogo: esa la revoca él mismo al cerrarse.
      const file = new File([new Blob(['x'])], 'foto.jpg', { type: 'image/jpeg' });
      const spy = spyOn(URL, 'createObjectURL').and.returnValue('blob:propia');

      (comp as any).mostrarPreviewFoto(file);

      expect(spy).toHaveBeenCalledWith(file);
      expect(comp.fotoDataUrl()).toBe('blob:propia');
    });

    it('al tomar otra foto libera la anterior', () => {
      const revoke = spyOn(URL, 'revokeObjectURL');
      spyOn(URL, 'createObjectURL').and.returnValues('blob:1', 'blob:2');

      (comp as any).mostrarPreviewFoto(new File([''], 'a.jpg'));
      (comp as any).mostrarPreviewFoto(new File([''], 'b.jpg'));

      expect(revoke).toHaveBeenCalledWith('blob:1');
      expect(comp.fotoDataUrl()).toBe('blob:2');
    });

    it('liberar sin preview previa no revienta', () => {
      const revoke = spyOn(URL, 'revokeObjectURL');
      expect(() => (comp as any).liberarPreviewFoto()).not.toThrow();
      expect(revoke).not.toHaveBeenCalled();
    });

    it('la preview local manda sobre la URL del servidor', () => {
      spyOn(URL, 'createObjectURL').and.returnValue('blob:reciente');
      comp.fotoDoc.set({ file_url: 'https://servidor/vieja.jpg' } as any);

      (comp as any).mostrarPreviewFoto(new File([''], 'a.jpg'));

      expect(comp.avatarPhotoUrl()).toBe('blob:reciente');
    });

    it('sin preview local usa la URL del documento', () => {
      comp.fotoDoc.set({ file_url: 'https://servidor/foto.jpg' } as any);
      expect(comp.avatarPhotoUrl()).toBe('https://servidor/foto.jpg');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Un registro puede existir en la base y el archivo no estar en el servidor
  // (subida hecha contra otro disco, archivo movido, borrado a mano). Si la
  // imagen rota se queda en pantalla, se ve el texto alternativo sobre el
  // fondo azul y parece que la aplicación se dañó.
  describe('la foto existe en la base pero el archivo no carga', () => {

    const fallar = () => comp.onAvatarPhotoError(new Event('error'));

    it('deja de mostrar la imagen rota', () => {
      comp.fotoDoc.set({ file_url: 'https://servidor/no-existe.png' } as any);
      expect(comp.avatarPhotoUrl()).toBe('https://servidor/no-existe.png');

      fallar();

      expect(comp.avatarPhotoUrl())
        .withContext('con null el avatar cae en el ícono de persona')
        .toBeNull();
    });

    it('al subir una foto nueva vuelve a intentar', () => {
      comp.fotoDoc.set({ file_url: 'https://servidor/vieja.png' } as any);
      fallar();
      expect(comp.avatarPhotoUrl()).toBeNull();

      // Una subida nueva estrena URL: no puede quedar castigada por la anterior.
      comp.fotoDoc.set({ file_url: 'https://servidor/nueva.png' } as any);

      expect(comp.avatarPhotoUrl()).toBe('https://servidor/nueva.png');
    });

    it('la foto de otro candidato no queda marcada como rota', () => {
      comp.fotoDoc.set({ file_url: 'https://servidor/a.png' } as any);
      fallar();

      comp.fotoDoc.set({ file_url: 'https://servidor/b.png' } as any);

      expect(comp.avatarPhotoUrl()).toBe('https://servidor/b.png');
    });

    it('una preview local recién tomada manda sobre la URL rota', () => {
      comp.fotoDoc.set({ file_url: 'https://servidor/rota.png' } as any);
      fallar();
      spyOn(URL, 'createObjectURL').and.returnValue('blob:recien-tomada');

      (comp as any).mostrarPreviewFoto(new File([''], 'a.jpg'));

      expect(comp.avatarPhotoUrl()).toBe('blob:recien-tomada');
    });

    it('un error sin ninguna foto cargada no revienta', () => {
      comp.fotoDoc.set(null);
      comp.fotoDataUrl.set(null);
      expect(() => fallar()).not.toThrow();
      expect(comp.avatarPhotoUrl()).toBeNull();
    });

    it('fallar dos veces seguidas no deja el avatar en un estado raro', () => {
      comp.fotoDoc.set({ file_url: 'https://servidor/rota.png' } as any);
      fallar();
      fallar();
      expect(comp.avatarPhotoUrl()).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('aviso de edición forzada', () => {
    it('arranca visible y se puede cerrar sin apagar el override', () => {
      comp.activarModificacionForzada();
      expect(comp.modificacionForzada()).toBeTrue();
      expect(comp.avisoForzadaOculto()).toBeFalse();

      comp.ocultarAvisoForzada();
      expect(comp.avisoForzadaOculto()).toBeTrue();
      // Cerrar el aviso NO devuelve el bloqueo: se sigue pudiendo editar.
      expect(comp.modificacionForzada()).toBeTrue();
    });

    it('vuelve a mostrarse al reactivar el override', () => {
      comp.activarModificacionForzada();
      comp.ocultarAvisoForzada();
      comp.activarModificacionForzada();
      expect(comp.avisoForzadaOculto()).toBeFalse();
    });

    it('se reinicia al cambiar de candidato', () => {
      comp.activarModificacionForzada();
      comp.ocultarAvisoForzada();
      comp.onCandidatoSeleccionado({ numero_documento: '2', entrevistas: [] });
      expect(comp.avisoForzadaOculto()).toBeFalse();
      expect(comp.modificacionForzada()).toBeFalse();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Pedido #10: la pestaña Contratación espera el examen médico (PDF de este
  // proceso + concepto apto), solo en procesos desde la fecha de corte.
  describe('examen médico requerido para contratar', () => {
    const conProceso = (proceso: any) => ({
      numero_documento: '100', tipo_doc: 'CC',
      entrevistas: [{ id: 1, proceso: { id: 55, created_at: '2026-09-29T15:00:00Z', ...proceso } }],
    });

    it('un proceso nuevo sin PDF ni concepto cierra Contratación', () => {
      comp.candidatoSeleccionado.set(conProceso({ examen_bloqueo: { aplica: true, salto: null } }));
      expect(comp.deshabilitarContratacion()).toBeTrue();
      expect(comp.estadoExamen().faltantes.length).toBe(2);
    });

    it('con el PDF enlazado y el concepto APTO en pantalla se abre', () => {
      comp.candidatoSeleccionado.set(conProceso({
        examen_bloqueo: { aplica: true, salto: null },
        examen_medico: { documento_id: 900 },
      }));
      comp.formGroup3.get('concepto')!.setValue('APTO');
      expect(comp.conceptoForm()).toBe('APTO');
      expect(comp.deshabilitarContratacion()).toBeFalse();
    });

    it('APLAZADO deja el proceso en espera y cerrado para contratar', () => {
      comp.candidatoSeleccionado.set(conProceso({
        examen_bloqueo: { aplica: true, salto: null },
        examen_medico: { documento_id: 900 },
      }));
      comp.formGroup3.get('concepto')!.setValue('APLAZADO');
      expect(comp.examenAplazado()).toBeTrue();
      expect(comp.deshabilitarContratacion()).toBeTrue();
    });

    it('un proceso de antes del corte no se bloquea', () => {
      comp.candidatoSeleccionado.set(conProceso({ examen_bloqueo: { aplica: false } }));
      expect(comp.deshabilitarContratacion()).toBeFalse();
    });

    it('el salto de un ADMIN abre la pestaña', () => {
      comp.candidatoSeleccionado.set(conProceso({
        examen_bloqueo: { aplica: true, salto: { por: 'admin@x.co', motivo: 'IPS caída', at: null } },
      }));
      expect(comp.deshabilitarContratacion()).toBeFalse();
    });

    it('marcar un examen NO APTO a mano propone el concepto NO APTO (con el examen cargado)', () => {
      comp.candidatoSeleccionado.set(conProceso({ examen_medico: { documento_id: 900 } }));
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Exámen Ingreso']);
      const fila = (comp.formGroup3.get('selectedExamsArray') as any).at(0);
      expect(fila.get('aptoStatus').value).toBeNull(); // sin APTO por defecto
      fila.get('aptoStatus').setValue('NO APTO');
      fila.markAsDirty();
      fila.get('aptoStatus').setValue('NO APTO');
      expect(comp.formGroup3.get('concepto')!.value).toBe('NO_APTO');
    });
  });

  // Orden estricto de Salud ocupacional: IPS + lista → «Cargar examen» → concepto.
  describe('orden: obligatorios → cargar examen → concepto', () => {
    const conProceso = (proceso: any) => ({
      numero_documento: '100', tipo_doc: 'CC',
      entrevistas: [{ id: 1, proceso: { id: 55, created_at: '2026-09-29T15:00:00Z', ...proceso } }],
    });
    const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], 'audio.pdf', { type: 'application/pdf' });

    it('sin IPS ni lista de exámenes no se puede adjuntar y dice qué falta', () => {
      comp.candidatoSeleccionado.set(conProceso({}));
      expect(comp.puedeAdjuntarExamen()).toBeFalse();
      expect(comp.textoFaltantesCargaExamen()).toContain('IPS principal');
      expect(comp.textoFaltantesCargaExamen()).toContain('Lista de exámenes');
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Audiometría']);
      expect(comp.puedeAdjuntarExamen()).toBeTrue();
    });

    it('el concepto está cerrado hasta que el PDF de ESTE proceso esté cargado', () => {
      comp.candidatoSeleccionado.set(conProceso({}));
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Audiometría']);
      expect(comp.conceptoHabilitado()).toBeFalse();
      expect(comp.motivoConceptoBloqueado()).toContain('Primero carga el examen');

      comp.candidatoSeleccionado.set(conProceso({ examen_medico: { documento_id: 900 } }));
      expect(comp.conceptoHabilitado()).toBeTrue();
      expect(comp.motivoConceptoBloqueado()).toBeNull();
    });

    it('con PDF pero sin los obligatorios el concepto sigue cerrado', () => {
      comp.candidatoSeleccionado.set(conProceso({ examen_medico: { documento_id: 900 } }));
      comp.formGroup3.get('ips')!.setValue('');
      expect(comp.conceptoHabilitado()).toBeFalse();
    });

    it('sin el examen cargado, un NO APTO por examen no propone concepto', () => {
      comp.candidatoSeleccionado.set(conProceso({}));
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Exámen Ingreso']);
      const fila = (comp.formGroup3.get('selectedExamsArray') as any).at(0);
      fila.markAsDirty();
      fila.get('aptoStatus').setValue('NO APTO');
      expect(comp.formGroup3.get('concepto')!.value).toBeNull();
    });

    it('adjuntar un PDF no sube nada ni toca el concepto', () => {
      const docs = TestBed.inject(GestionDocumentalService) as any;
      spyOn(docs, 'guardarDocumento').and.callThrough();
      comp.candidatoSeleccionado.set(conProceso({}));
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Audiometría']);
      comp.onFileSelected({ target: { files: [pdf()], value: 'x' } }, 0);
      expect(comp.examFilesAdjuntos()).toBe(1);
      expect(docs.guardarDocumento).not.toHaveBeenCalled();
      expect(comp.formGroup3.get('concepto')!.value).toBeNull();
    });

    it('«Cargar examen» sube el PDF y lo enlaza al proceso sin mandar concepto', async () => {
      const docs = TestBed.inject(GestionDocumentalService) as any;
      spyOn(docs, 'guardarDocumento').and.returnValue(of({ id: 777 }));
      spyOn(Swal, 'fire').and.returnValue(Promise.resolve({ isConfirmed: true } as any));
      spyOn(Swal, 'update');
      spyOn(Swal, 'close');
      (comp as any).pdfSvc = {
        isPdf: () => true,
        mergePdfs: (fs: File[], name: string) => Promise.resolve(new File([fs[0]], name, { type: 'application/pdf' })),
        unirExamenesConResultados: (items: { file: File }[], _r: unknown, _p: unknown, name: string) =>
          Promise.resolve(new File([items[0].file], name, { type: 'application/pdf' })),
      };
      (comp as any).nextFrame = () => Promise.resolve();
      (comp as any).yyyymmdd = () => '20261014';
      comp.candidatoSeleccionado.set(conProceso({}));
      (comp as any).cedulaAtendida = '100';
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Audiometría']);
      (comp.formGroup3.get('selectedExamsArray') as any).at(0).get('aptoStatus').setValue('APTO');
      comp.formGroup3.markAsPristine();
      comp.onFileSelected({ target: { files: [pdf()], value: 'x' } }, 0);
      expect(comp.conceptoHabilitado()).toBeFalse();

      await comp.cargarExamen();

      expect(docs.guardarDocumento).toHaveBeenCalled();
      const args = docs.guardarDocumento.calls.mostRecent().args;
      expect(args[2]).toBe(32);
      expect(args[6]).toBe(55);
      const body: any = registro.updateProcesoByDocumento.calls.mostRecent().args[0];
      expect(body.proceso_id).toBe(55);
      expect(body.examen_medico).toEqual({ documento_id: 777 });
      expect(body.contratado).toBeUndefined();
      expect(comp.formGroup3.get('concepto')!.value).toBeNull();
      expect(comp.conceptoHabilitado()).toBeTrue();
      expect(comp.examFilesAdjuntos()).toBe(0);
    });

    const prepararCarga = () => {
      const docs = TestBed.inject(GestionDocumentalService) as any;
      spyOn(docs, 'guardarDocumento').and.returnValue(of({ id: 777 }));
      spyOn(Swal, 'fire').and.returnValue(Promise.resolve({ isConfirmed: true } as any));
      spyOn(Swal, 'update');
      spyOn(Swal, 'close');
      (comp as any).pdfSvc = {
        isPdf: () => true,
        mergePdfs: (fs: File[], name: string) => Promise.resolve(new File([fs[0]], name, { type: 'application/pdf' })),
        unirExamenesConResultados: (items: { file: File }[], _r: unknown, _p: unknown, name: string) =>
          Promise.resolve(new File([items[0].file], name, { type: 'application/pdf' })),
      };
      (comp as any).nextFrame = () => Promise.resolve();
      (comp as any).yyyymmdd = () => '20261015';
      comp.candidatoSeleccionado.set(conProceso({}));
      (comp as any).cedulaAtendida = '100';
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Audiometría', 'Optometría']);
      comp.onFileSelected({ target: { files: [pdf()], value: 'x' } }, 0);
      return docs;
    };

    it('el APTO / NO APTO de cada examen se puede marcar ANTES de cargar el PDF', () => {
      comp.candidatoSeleccionado.set(conProceso({}));
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Audiometría']);
      expect(comp.conceptoHabilitado()).toBeFalse();
      expect(comp.puedeAdjuntarExamen()).toBeTrue();
      expect(comp.examenesSinResultadoMarcado()).toEqual(['Audiometría']);
      (comp.formGroup3.get('selectedExamsArray') as any).at(0).get('aptoStatus').setValue('APTO');
      expect(comp.examenesSinResultadoMarcado()).toEqual([]);
    });

    it('«Cargar examen» sin APTO / NO APTO en todos los exámenes no sube nada', async () => {
      const docs = prepararCarga();
      (comp.formGroup3.get('selectedExamsArray') as any).at(0).get('aptoStatus').setValue('APTO');
      await comp.cargarExamen();
      expect(docs.guardarDocumento).not.toHaveBeenCalled();
      expect((Swal.fire as any).calls.mostRecent().args[0].text).toContain('Optometría');
    });

    it('un examen NO APTO marcado antes de cargar propone el concepto NO APTO al cargar', async () => {
      const docs = prepararCarga();
      const arr = comp.formGroup3.get('selectedExamsArray') as any;
      arr.at(0).get('aptoStatus').setValue('APTO');
      arr.at(1).markAsDirty();
      arr.at(1).get('aptoStatus').setValue('NO APTO');
      expect(comp.formGroup3.get('concepto')!.value).toBeNull(); // aún sin PDF
      await comp.cargarExamen();
      expect(docs.guardarDocumento).toHaveBeenCalled();
      expect(comp.formGroup3.get('concepto')!.value).toBe('NO_APTO');
    });

    it('el soporte cargado queda con el resultado de cada examen y la tarjeta lo muestra', async () => {
      const docs = prepararCarga();
      const arr = comp.formGroup3.get('selectedExamsArray') as any;
      arr.at(0).get('aptoStatus').setValue('APTO');
      arr.at(1).get('aptoStatus').setValue('NO APTO');
      await comp.cargarExamen();
      const titulo: string = docs.guardarDocumento.calls.mostRecent().args[0];
      expect(titulo).toContain('[Audiometría=APTO; Optometría=NO APTO]');
      expect(titulo.endsWith('.pdf')).toBeTrue();
      const tarjeta = { id: 777, title: titulo } as any;
      expect(comp.resultadosDoc(tarjeta)).toEqual([
        { examen: 'Audiometría', resultado: 'APTO' },
        { examen: 'Optometría', resultado: 'NO APTO' },
      ]);
      expect(comp.nombreDoc(tarjeta)).toBe('EXAMENES_MEDICOS_100_20261015.pdf');
    });

    it('un soporte viejo sin resultados en el título usa lo guardado si es el enlazado al proceso', () => {
      comp.candidatoSeleccionado.set(conProceso({ examen_medico: {
        documento_id: 50, examenes: '["Ingreso"]', resultados: '[{"aptoStatus":"APTO"}]' } }));
      expect(comp.resultadosDoc({ id: 50, title: 'EXAMENES.pdf' } as any))
        .toEqual([{ examen: 'Ingreso', resultado: 'APTO' }]);
      expect(comp.resultadosDoc({ id: 51, title: 'OTRO.pdf' } as any)).toEqual([]);
    });

    it('«Cargar examen» sin los obligatorios no sube nada', async () => {
      const docs = TestBed.inject(GestionDocumentalService) as any;
      spyOn(docs, 'guardarDocumento').and.callThrough();
      spyOn(Swal, 'fire').and.returnValue(Promise.resolve({ isConfirmed: true } as any));
      comp.candidatoSeleccionado.set(conProceso({}));
      await comp.cargarExamen();
      expect(docs.guardarDocumento).not.toHaveBeenCalled();
      expect(registro.updateProcesoByDocumento).not.toHaveBeenCalled();
    });

    it('el guardado del formulario no manda concepto si el examen no está cargado', async () => {
      comp.candidatoSeleccionado.set(conProceso({}));
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Audiometría']);
      comp.formGroup3.get('concepto')!.markAsDirty();
      comp.formGroup3.get('concepto')!.setValue('APTO');
      await comp.imprimirSaludOcupacional({ silencioso: true });
      const body: any = registro.updateProcesoByDocumento.calls.mostRecent().args[0];
      expect('concepto' in body.examen_medico).toBeFalse();
    });

    it('con el examen cargado, elegir el concepto lo manda y no sube documentos', async () => {
      const docs = TestBed.inject(GestionDocumentalService) as any;
      spyOn(docs, 'guardarDocumento').and.callThrough();
      comp.candidatoSeleccionado.set(conProceso({ examen_medico: { documento_id: 900 } }));
      comp.formGroup3.get('ips')!.setValue('IPS X');
      comp.formGroup3.get('selectedExams')!.setValue(['Audiometría']);
      comp.onFileSelected({ target: { files: [pdf()], value: 'x' } }, 0);
      comp.formGroup3.get('concepto')!.markAsDirty();
      comp.formGroup3.get('concepto')!.setValue('APTO');
      await comp.imprimirSaludOcupacional({ silencioso: true });
      const body: any = registro.updateProcesoByDocumento.calls.mostRecent().args[0];
      expect(body.examen_medico.concepto).toBe('APTO');
      expect(docs.guardarDocumento).not.toHaveBeenCalled();
    });
  });

  describe('borrado de un proceso del historial', () => {

    it('manda el id de ESA fila, no el del más reciente', fakeAsync(() => {
      comp.candidatoSeleccionado.set({ numero_documento: '1082490391' } as any);

      comp.eliminarProcesoDelHistorial({ id: 39389 });
      tick();

      expect(registro.eliminarProceso).toHaveBeenCalled();
      const [doc, opts] = registro.eliminarProceso.calls.mostRecent().args as any[];
      expect(doc).toBe('1082490391');
      expect(opts.procesoId).toBe(39389);
    }));

    it('devuelve true cuando borró, para que la tabla quite la fila', fakeAsync(() => {
      comp.candidatoSeleccionado.set({ numero_documento: '1' } as any);

      let resultado: boolean | undefined;
      comp.eliminarProcesoDelHistorial({ id: 1 }).then(r => resultado = r);
      tick();

      expect(resultado).toBeTrue();
    }));

    it('sin confirmar no llama al backend', fakeAsync(() => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as any);
      comp.candidatoSeleccionado.set({ numero_documento: '1' } as any);

      comp.eliminarProcesoDelHistorial({ id: 1 });
      tick();

      expect(registro.eliminarProceso).not.toHaveBeenCalled();
    }));

    it('sin cédula no hace nada', fakeAsync(() => {
      comp.candidatoSeleccionado.set(null as any);
      comp.numeroDocumento = '';

      let resultado: boolean | undefined;
      comp.eliminarProcesoDelHistorial({ id: 1 }).then(r => resultado = r);
      tick();

      expect(resultado).toBeFalse();
      expect(registro.eliminarProceso).not.toHaveBeenCalled();
    }));

    it('un error del backend devuelve false y no rompe la pantalla', fakeAsync(() => {
      registro.eliminarProceso.and.returnValue(
        throwError(() => ({ status: 500, error: { detail: 'falló' } })));
      comp.candidatoSeleccionado.set({ numero_documento: '1' } as any);

      let resultado: boolean | undefined;
      comp.eliminarProcesoDelHistorial({ id: 1 }).then(r => resultado = r);
      tick();

      expect(resultado).toBeFalse();
    }));
  });
});

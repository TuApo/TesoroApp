import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { Subject, of, throwError } from 'rxjs';
import Swal from 'sweetalert2';

import { SearchDocumentsComponent } from './search-documents.component';
import { DocumentacionService } from '../../service/documentacion/documentacion.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';

/** Réplica reducida de lo que devuelve `document-search/`. */
function version(over: any = {}) {
  return {
    id: 1,
    document: 1,
    version_number: 1,
    is_current: true,
    file_url: 'https://media/v1.pdf',
    uploaded_at: '2026-02-10T07:13:06Z',
    original_filename: 'archivo.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    ...over,
  };
}

const RESPUESTA: any = {
  SIN_CONTRATO: [
    // Tipo con histórico: 3 archivos en un solo expediente.
    {
      id: 1, title: 'POL.pdf', type: 6, type_name: 'POLICIVOS',
      file_url: 'https://media/pol_v3.pdf', versions_total: 3, versions_truncated: false,
      versions: [
        version({ id: 30, document: 1, version_number: 3, is_current: true, file_url: 'https://media/pol_v3.pdf', original_filename: 'pol_v3.pdf', uploaded_at: '2026-03-26T11:06:53Z' }),
        version({ id: 20, document: 1, version_number: 2, is_current: false, file_url: 'https://media/pol_v2.pdf', original_filename: 'pol_v2.pdf', uploaded_at: '2026-03-26T10:12:08Z' }),
        version({ id: 10, document: 1, version_number: 1, is_current: false, file_url: 'https://media/pol_v1.pdf', original_filename: 'pol_v1.pdf', uploaded_at: '2026-02-10T07:13:06Z' }),
      ],
    },
    // Mismo tipo documental, dos expedientes (SLOTS).
    {
      id: 2, title: 'Referencia 1', type: 16, type_name: 'REFERENCIA FAMILIAR',
      file_url: 'https://media/ref1.pdf', versions_total: 1, versions_truncated: false,
      versions: [version({ id: 41, document: 2, file_url: 'https://media/ref1.pdf', original_filename: 'ref1.pdf' })],
    },
    {
      id: 3, title: 'Referencia 2', type: 16, type_name: 'REFERENCIA FAMILIAR',
      file_url: 'https://media/ref2.pdf', versions_total: 1, versions_truncated: false,
      versions: [version({ id: 42, document: 3, file_url: 'https://media/ref2.pdf', original_filename: 'ref2.pdf' })],
    },
    // Expediente inflado por el bucle del robot: backend recorta.
    {
      id: 4, title: 'OFAC.pdf', type: 5, type_name: 'OFAC',
      file_url: 'https://media/ofac_last.pdf', versions_total: 52856, versions_truncated: true,
      versions: [
        version({ id: 52856, document: 4, version_number: 52856, is_current: true, file_url: 'https://media/ofac_last.pdf' }),
        version({ id: 52855, document: 4, version_number: 52855, is_current: false, file_url: 'https://media/ofac_prev.pdf' }),
      ],
    },
    // Expediente sin ningún archivo cargado.
    {
      id: 5, title: 'CONTR.pdf', type: 4, type_name: 'CONTRALORIA',
      file_url: null, versions_total: 0, versions_truncated: false, versions: [],
    },
  ],
};

describe('SearchDocumentsComponent', () => {
  let component: SearchDocumentsComponent;
  let fixture: any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchDocumentsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MatDialog, useValue: {} },
        {
          provide: DocumentacionService,
          useValue: {
            mostrar_jerarquia_anidada: () => of([]),
            buscar_documentos: () => of(RESPUESTA),
            actualizarDocumento: () => of({}),
          },
        },
        { provide: UtilityServiceService, useValue: { obtenerCodigosContrato: () => of({ data: [] }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchDocumentsComponent);
    component = fixture.componentInstance;
  });

  function categorias() {
    return (component as any).construirCategorias(RESPUESTA);
  }

  function tipo(nombre: string) {
    return categorias()[0].tipos.find((t: any) => t.nombre === nombre);
  }

  it('lista todos los archivos del tipo, no solo el vigente', () => {
    const policivos = tipo('POLICIVOS');

    expect(policivos.archivos.length).toBe(3);
    expect(policivos.totalReal).toBe(3);
    expect(policivos.archivos.map((a: any) => a.versionNumber)).toEqual([3, 2, 1]);
    expect(policivos.archivos.map((a: any) => a.isCurrent)).toEqual([true, false, false]);
    expect(policivos.archivos.map((a: any) => a.fileUrl)).toEqual([
      'https://media/pol_v3.pdf',
      'https://media/pol_v2.pdf',
      'https://media/pol_v1.pdf',
    ]);
  });

  it('junta en un solo tipo los expedientes que comparten tipo documental', () => {
    const referencias = tipo('REFERENCIA FAMILIAR');

    expect(referencias.archivos.length).toBe(2);
    expect(referencias.archivos.map((a: any) => a.nombre)).toEqual(['ref1.pdf', 'ref2.pdf']);
    // Cada fila conserva su expediente, que es lo que necesita editarPDF.
    expect(referencias.archivos.map((a: any) => a.doc.id)).toEqual([2, 3]);
  });

  it('nunca esconde el vigente de un expediente tras "ver más"', () => {
    // Dos expedientes del mismo tipo y el primero con historial largo: apilados por
    // expediente, el vigente del segundo caería fuera de los 5 primeros.
    const conHistorial = {
      SIN_CONTRATO: [
        {
          id: 1, title: 'Referencia 1', type: 16, type_name: 'REFERENCIA FAMILIAR',
          file_url: 'https://media/r1v6.pdf', versions_total: 6, versions_truncated: false,
          versions: [6, 5, 4, 3, 2, 1].map((n) => version({
            id: n, document: 1, version_number: n, is_current: n === 6,
            file_url: `https://media/r1v${n}.pdf`, original_filename: `r1v${n}.pdf`,
            uploaded_at: `2026-03-0${n}T10:00:00Z`,
          })),
        },
        {
          id: 2, title: 'Referencia 2', type: 16, type_name: 'REFERENCIA FAMILIAR',
          file_url: 'https://media/r2v1.pdf', versions_total: 1, versions_truncated: false,
          versions: [version({ id: 90, document: 2, file_url: 'https://media/r2v1.pdf', original_filename: 'r2v1.pdf', uploaded_at: '2026-01-01T10:00:00Z' })],
        },
      ],
    };

    const grupo = (component as any).construirCategorias(conHistorial)[0].tipos[0];
    const visibles = component.archivosVisibles(grupo);

    expect(visibles.map((a: any) => a.nombre)).toContain('r2v1.pdf');
    // Los dos vigentes van primero; el historial del primero queda detrás.
    expect(visibles.slice(0, 2).every((a: any) => a.isCurrent)).toBeTrue();
    expect(grupo.archivos.length).toBe(7);
  });

  it('informa el total real cuando el backend recorta el histórico', () => {
    const ofac = tipo('OFAC');

    expect(ofac.truncado).toBeTrue();
    expect(ofac.archivos.length).toBe(2);
    expect(ofac.totalReal).toBe(52856);
  });

  it('mantiene la fila "sin archivo" para expedientes vacíos', () => {
    const contraloria = tipo('CONTRALORIA');

    expect(contraloria.archivos.length).toBe(1);
    expect(contraloria.archivos[0].fileUrl).toBeNull();
  });

  it('cuenta los archivos reales de la categoría', () => {
    // 3 policivos + 2 referencias + 52.856 ofac + 0 contraloria
    expect(categorias()[0].totalArchivos).toBe(3 + 2 + 52856 + 0);
  });

  it('oculta los archivos que pasan del tope hasta que se despliega el tipo', () => {
    const grupo = {
      typeId: 5, nombre: 'OFAC', truncado: false, totalReal: 8, expandido: false,
      archivos: Array.from({ length: 8 }, (_, i) => ({ key: `k${i}` })),
    } as any;

    expect(component.archivosVisibles(grupo).length).toBe(5);
    expect(component.archivosOcultos(grupo)).toBe(3);

    component.alternarTipo(grupo);

    expect(grupo.expandido).toBeTrue();
    expect(component.archivosVisibles(grupo).length).toBe(8);
  });

  it('avisa cuando el backend recortó el número de expedientes', () => {
    const conMeta = {
      ...RESPUESTA,
      _meta: { documents_total: 5505, documents_returned: 500, documents_truncated: true, versions_limit: 50 },
    };
    TestBed.inject(DocumentacionService).buscar_documentos = () => of(conMeta) as any;

    component.form.patchValue({ cedula: '1007154844' });
    component.onSubmit();
    fixture.detectChanges();

    // `_meta` no es una lista de expedientes: no debe colarse como categoría.
    expect(component.documentosPorCategoria.map((c) => c.categoria)).toEqual(['SIN_CONTRATO']);
    expect(component.meta?.documents_truncated).toBeTrue();
    expect(fixture.nativeElement.querySelector('.truncated-banner').textContent).toContain('5505');
  });

  it('ignora la respuesta de "sin resultados" en vez de tratarla como documentos', () => {
    const vacio = (component as any).construirCategorias({
      message: 'No se encontraron documentos para la cédula 123.',
      document_types: { empleado: [{ id: 28, name: 'HOJA DE VIDA' }], empresa: [] },
    });

    expect(vacio).toEqual([]);
  });

  it('usa type_name del backend cuando la jerarquía local aún no cargó', () => {
    component.tiposDocumentales = [];

    expect(tipo('POLICIVOS')).toBeTruthy();
  });

  describe('unión de documentos', () => {
    function archivosDe(nombreTipo: string) {
      return tipo(nombreTipo).archivos;
    }

    it('el modo unión arranca apagado y no hay selección', () => {
      expect(component.modoUnion).toBeFalse();
      expect(component.seleccion).toEqual([]);
    });

    it('marca los archivos en el orden en que se seleccionan', () => {
      const [v3, v2, v1] = archivosDe('POLICIVOS');

      component.alternarSeleccion(v1);
      component.alternarSeleccion(v3);
      component.alternarSeleccion(v2);

      expect(component.seleccion.map((a: any) => a.nombre)).toEqual(['pol_v1.pdf', 'pol_v3.pdf', 'pol_v2.pdf']);
      expect(component.posicionEnUnion(v1)).toBe(1);
      expect(component.posicionEnUnion(v3)).toBe(2);
      expect(component.posicionEnUnion(v2)).toBe(3);
    });

    it('al desmarcar, renumera el resto', () => {
      const [v3, v2, v1] = archivosDe('POLICIVOS');
      [v1, v2, v3].forEach((a) => component.alternarSeleccion(a));

      component.alternarSeleccion(v1); // fuera el primero

      expect(component.estaSeleccionado(v1)).toBeFalse();
      expect(component.posicionEnUnion(v1)).toBe(0);
      expect(component.posicionEnUnion(v2)).toBe(1);
      expect(component.posicionEnUnion(v3)).toBe(2);
    });

    it('no deja unir lo que no es PDF ni imagen', () => {
      const xlsx = (component as any).construirArchivo({
        key: 'k', doc: {} as any, fileUrl: 'https://media/reporte.xlsx', uploadedAt: null,
        versionNumber: 1, isCurrent: true, nombre: 'reporte.xlsx', sizeBytes: 10,
      });

      expect(xlsx.extension).toBe('xlsx');
      expect(xlsx.esUnible).toBeFalse();

      component.alternarSeleccion(xlsx);

      expect(component.seleccion).toEqual([]);
    });

    it('reconoce como unibles los PDF mal tipificados y las imágenes', () => {
      const construir = (nombre: string, url: string) =>
        (component as any).construirArchivo({
          key: nombre, doc: {} as any, fileUrl: url, uploadedAt: null,
          versionNumber: 1, isCurrent: true, nombre, sizeBytes: 10,
        });

      // El mime real de este en BD sería application/octet-stream: manda la extensión.
      expect(construir('escaneo.pdf', 'https://media/x.pdf').esUnible).toBeTrue();
      expect(construir('cedula.PNG', 'https://media/x.png').esUnible).toBeTrue();
      expect(construir('foto.jpeg', 'https://media/x.jpeg').esUnible).toBeTrue();
      // Sin nombre útil, la extensión sale de la URL (con querystring).
      expect(construir('', 'https://media/x.pdf?v=2').extension).toBe('pdf');
    });

    it('un expediente sin archivo no se puede unir', () => {
      const [sinArchivo] = archivosDe('CONTRALORIA');

      expect(sinArchivo.fileUrl).toBeNull();
      expect(sinArchivo.esUnible).toBeFalse();
    });

    it('apagar el modo unión descarta la selección', () => {
      component.alternarModoUnion();
      archivosDe('POLICIVOS').forEach((a: any) => component.alternarSeleccion(a));
      expect(component.seleccion.length).toBe(3);

      component.alternarModoUnion();

      expect(component.modoUnion).toBeFalse();
      expect(component.seleccion).toEqual([]);
    });

    it('en modo unión el click de la fila marca en vez de previsualizar', () => {
      const [v3] = archivosDe('POLICIVOS');
      const verPDF = spyOn(component, 'verPDF');

      component.modoUnion = true;
      component.alClickFila(v3);

      expect(verPDF).not.toHaveBeenCalled();
      expect(component.estaSeleccionado(v3)).toBeTrue();

      component.modoUnion = false;
      component.alClickFila(v3);

      expect(verPDF).toHaveBeenCalledWith(v3.fileUrl);
    });

    it('una búsqueda nueva limpia lo seleccionado', () => {
      archivosDe('POLICIVOS').forEach((a: any) => component.alternarSeleccion(a));

      component.form.patchValue({ cedula: '1053006132' });
      component.onSubmit();

      expect(component.seleccion).toEqual([]);
    });

    describe('descarga', () => {
      // Cada PDF de prueba se hace con páginas de un tamaño distinto: al leer el
      // resultado, el tamaño de cada página delata de qué archivo salió y en qué
      // orden quedó. Verifica la unión de verdad, no un mock.
      const LADOS: Record<string, number> = { a: 200, b: 300, c: 400 };
      let guardado: { blob: Blob; nombre: string } | null;

      async function pdfDePrueba(lado: number, paginas: number): Promise<Uint8Array> {
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.create();
        for (let i = 0; i < paginas; i++) doc.addPage([lado, lado]);
        return doc.save();
      }

      async function paginasDelResultado(): Promise<Array<number>> {
        const { PDFDocument } = await import('pdf-lib');
        const bytes = await guardado!.blob.arrayBuffer();
        const doc = await PDFDocument.load(bytes);
        return doc.getPages().map((p) => Math.round(p.getWidth()));
      }

      function archivo(id: string, paginas: number) {
        return (component as any).construirArchivo({
          key: id, doc: {} as any, fileUrl: `https://media/${id}.pdf`, uploadedAt: null,
          versionNumber: 1, isCurrent: true, nombre: `${id}.pdf`, sizeBytes: 1,
        });
      }

      beforeEach(() => {
        guardado = null;
        spyOn(Swal, 'fire').and.returnValue(Promise.resolve({} as any));
        spyOn(Swal, 'update');
        spyOn(Swal, 'showLoading');
        spyOn(Swal, 'close');
        spyOn(Swal, 'isVisible').and.returnValue(true);
        spyOn(Swal, 'isLoading').and.returnValue(true);
        spyOn<any>(component, 'guardarArchivo').and.callFake((blob: Blob, nombre: string) => {
          guardado = { blob, nombre };
          return Promise.resolve();
        });
        // a.pdf = 1 pág de 200, b.pdf = 2 págs de 300, c.pdf = 1 pág de 400
        spyOn(window, 'fetch').and.callFake(async (url: any) => {
          const id = String(url).match(/\/(\w)\.pdf/)![1];
          const bytes = await pdfDePrueba(LADOS[id], id === 'b' ? 2 : 1);
          return new Response(bytes as any, { status: 200 });
        });
      });

      it('une los PDF respetando el orden de selección', async () => {
        component.alternarSeleccion(archivo('c', 1));
        component.alternarSeleccion(archivo('a', 1));
        component.alternarSeleccion(archivo('b', 2));

        await component.descargarUnion();

        // c(400) → a(200) → b(300, dos páginas): el orden de marcado, no el del listado.
        expect(await paginasDelResultado()).toEqual([400, 200, 300, 300]);
      });

      it('nombra el archivo con la cédula y cuántos unió', async () => {
        component.form.patchValue({ cedula: '1053006132' });
        component.alternarSeleccion(archivo('a', 1));
        component.alternarSeleccion(archivo('b', 2));

        await component.descargarUnion();

        expect(guardado!.nombre).toBe('union_1053006132_2archivos.pdf');
        expect(guardado!.blob.type).toBe('application/pdf');
      });

      it('no descarga nada con menos de 2 archivos', async () => {
        component.alternarSeleccion(archivo('a', 1));

        await component.descargarUnion();

        expect(guardado).toBeNull();
      });

      it('avisa y no descarga si un archivo falla al bajar', async () => {
        (window.fetch as jasmine.Spy).and.returnValue(
          Promise.resolve(new Response('', { status: 404 })),
        );
        component.alternarSeleccion(archivo('a', 1));
        component.alternarSeleccion(archivo('b', 2));

        await component.descargarUnion();

        expect(guardado).toBeNull();
        expect((Swal.fire as jasmine.Spy).calls.allArgs().some(([o]: any) => o?.icon === 'error')).toBeTrue();
      });
    });
  });

  describe('feedback con Swal', () => {
    // Se espían las llamadas en vez del DOM: SweetAlert2 muestra y cierra con
    // animación asíncrona, y lo que se quiere fijar aquí es qué le pide el
    // componente y en qué orden — que es justo donde estaba el bug.
    let fire: jasmine.Spy;
    let close: jasmine.Spy;

    beforeEach(() => {
      fire = spyOn(Swal, 'fire').and.returnValue(Promise.resolve({} as any));
      close = spyOn(Swal, 'close');
      spyOn(Swal, 'showLoading');
      // El modal de carga está abierto salvo que un test diga lo contrario.
      spyOn(Swal, 'isVisible').and.returnValue(true);
      spyOn(Swal, 'isLoading').and.returnValue(true);
    });

    function opciones(llamada: number) {
      return fire.calls.argsFor(llamada)[0] as any;
    }

    it('muestra progreso mientras busca y lo cierra al llegar la respuesta', () => {
      const respuesta = new Subject<any>();
      TestBed.inject(DocumentacionService).buscar_documentos = () => respuesta as any;

      component.form.patchValue({ cedula: '1053006132' });
      component.onSubmit();

      expect(opciones(0).title).toBe('Cargando');
      expect(opciones(0).text).toContain('Buscando');
      expect(Swal.showLoading).toHaveBeenCalled;
      expect(close).not.toHaveBeenCalled();

      respuesta.next(RESPUESTA);

      expect(close).toHaveBeenCalledTimes(1);
    });

    it('muestra el error de búsqueda sin cerrarlo antes (el close+fire lo hacía invisible)', () => {
      TestBed.inject(DocumentacionService).buscar_documentos = () =>
        throwError(() => new Error('500')) as any;

      component.form.patchValue({ cedula: '1053006132' });
      component.onSubmit();

      // fire[0] = carga, fire[1] = error. Sin close() entre medias: `fire` ya
      // reemplaza el modal, y cerrar antes se comía la alerta.
      expect(opciones(1).icon).toBe('error');
      expect(close).not.toHaveBeenCalled();
    });

    it('no deja colgado el indicador de carga de contratos al borrar la cédula', fakeAsync(() => {
      // Prod usa un spinner en línea (`cargandoContratos`), no un modal de Swal,
      // para no secuestrar la pantalla mientras trae los contratos de una cédula.
      // El indicador debe quedar activo mientras la petición no responde y apagarse
      // en cuanto la cédula se borra (switchMap cancela la petición en vuelo).
      TestBed.inject(UtilityServiceService).obtenerCodigosContrato = () => new Subject<any>() as any;

      component.ngOnInit();

      component.form.get('cedula')!.setValue('1053006132');
      tick(600);
      expect(component.cargandoContratos).toBeTrue();

      component.form.get('cedula')!.setValue('');
      tick(600);

      expect(component.cargandoContratos).toBeFalse();
    }));

    it('el campo de cédula sobrevive a un error de red', fakeAsync(() => {
      const utility = TestBed.inject(UtilityServiceService);
      utility.obtenerCodigosContrato = () => throwError(() => new Error('red caída')) as any;

      component.ngOnInit();

      component.form.get('cedula')!.setValue('111');
      tick(600);
      // Prod avisa con un toast `warning` (no bloqueante), no con un modal `error`.
      expect(fire.calls.allArgs().some(([o]: any) => o?.icon === 'warning')).toBeTrue();

      // Tras el error, el stream debe seguir vivo: antes el callback de error
      // terminaba la suscripción y el campo no volvía a consultar nunca.
      utility.obtenerCodigosContrato = () => of({ data: ['725520'] }) as any;
      component.form.get('cedula')!.setValue('222');
      tick(600);

      expect(component.codigosContrato).toEqual(['725520']);
    }));
  });

  it('pinta una fila por archivo y despliega los ocultos al pulsar', () => {
    component.form.patchValue({ cedula: '1053006132' });
    component.onSubmit();
    fixture.detectChanges();

    const filas = () => fixture.nativeElement.querySelectorAll('.doc-row');
    const textoTipos = fixture.nativeElement.querySelectorAll('.type-name');

    // 4 tipos documentales, y POLICIVOS aporta sus 3 archivos (antes era 1 fila).
    expect(textoTipos.length).toBe(4);
    expect(filas().length).toBe(3 + 2 + 2 + 1);
    expect(fixture.nativeElement.textContent).toContain('pol_v1.pdf');
    expect(fixture.nativeElement.textContent).toContain('Histórico');
    expect(fixture.nativeElement.textContent).toContain('Vigente');

    // El tipo recortado avisa en vez de mentir con el conteo.
    expect(fixture.nativeElement.querySelector('.truncated-note').textContent)
      .toContain('de 52856');

    // Ningún tipo pasa del tope, así que no hay botón de desplegar.
    expect(fixture.nativeElement.querySelector('.toggle-versions')).toBeNull();
  });
});

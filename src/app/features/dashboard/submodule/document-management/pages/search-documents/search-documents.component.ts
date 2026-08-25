import { SharedModule } from '@/app/shared/shared.module';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import {  Component, ElementRef, ViewChild , ChangeDetectionStrategy, ChangeDetectorRef, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl, Title, Meta } from '@angular/platform-browser';
import { debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import Swal from 'sweetalert2';
import { MatDialog } from '@angular/material/dialog';
import { DocumentacionService, TipoDocumentalNode, GrupoTipos, agruparTiposPorPadre } from '../../service/documentacion/documentacion.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { PdfEditorDialogComponent } from '../../components/pdf-editor-dialog/pdf-editor-dialog.component';

/** Un archivo real del expediente (DocumentVersion en el backend). */
interface DocumentoVersion {
  id: number;
  document: number;
  version_number: number;
  is_current: boolean;
  file_url: string | null;
  uploaded_at: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
}

/** Expediente: agrupa el histórico de archivos de un tipo documental. */
interface Documento {
  id: number;
  title: string;
  file_url: string;
  type: number;
  type_name?: string;
  owner_id?: string;
  contract_number?: string;
  uploaded_at?: string;
  version_number?: number;
  original_filename?: string;
  size_bytes?: number;
  versions?: DocumentoVersion[];
  versions_total?: number;
  versions_truncated?: boolean;
}

export interface TipoDocumental {
  id: number;
  name: string;
  estado: boolean;
  subtypes?: TipoDocumental[]; // subtipos anidados
}

/** Una fila de la lista: un archivo concreto, no un expediente. */
interface ArchivoVM {
  key: string;
  doc: Documento;
  fileUrl: string | null;
  uploadedAt: string | null;
  versionNumber: number | null;
  isCurrent: boolean;
  nombre: string;
  sizeBytes: number;
  /** Extensión real, sacada del nombre/URL. Ver `esUnible`. */
  extension: string;
  /** Se puede meter en la unión (PDF o imagen). Los .xlsx y demás, no. */
  esUnible: boolean;
}

/** Un tipo documental con todos sus archivos. */
interface TipoGrupoVM {
  typeId: number;
  nombre: string;
  archivos: ArchivoVM[];
  /** Archivos que existen realmente (puede ser mayor que archivos.length). */
  totalReal: number;
  /** El backend recortó el histórico por ser demasiado largo. */
  truncado: boolean;
  expandido: boolean;
}

interface CategoriaVM {
  categoria: string;
  tipos: TipoGrupoVM[];
  totalArchivos: number;
}

/** Recorte que aplicó el backend a la búsqueda completa. */
interface BusquedaMeta {
  documents_total: number;
  documents_returned: number;
  documents_truncated: boolean;
  versions_limit: number;
}

/** Archivos que se listan sin desplegar. El resto queda tras "ver más". */
const ARCHIVOS_VISIBLES_POR_DEFECTO = 5;

/**
 * Extensiones que se pueden unir en un PDF. Se decide por extensión y NO por
 * `mime_type`: en la base hay ~296k versiones guardadas como
 * `application/octet-stream` que en realidad son PDF, así que filtrar por mime
 * dejaría fuera un tercio de los PDFs reales.
 */
const EXTENSIONES_PDF = ['pdf'];
const EXTENSIONES_IMAGEN = ['png', 'jpg', 'jpeg'];


@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-search-documents',
  standalone: true,
  imports: [
    SharedModule
  ],
  templateUrl: './search-documents.component.html',
  styleUrl: './search-documents.component.css'
} )
export class SearchDocumentsComponent implements OnInit {
  /** Árbol anidado: se usa para resolver el nombre de un tipo por su id. */
  tiposDocumentales: TipoDocumentalNode[] = [];
  /** Lo que pinta el selector: agrupado por el tipo padre. */
  gruposTipos: GrupoTipos[] = [];
  codigosContrato: string[] = [];
  cargandoContratos = false;
  form: FormGroup;
  documentosPorCategoria: CategoriaVM[] = [];
  buscando = false;
  yaBusco = false;
  /** Recorte que aplicó el backend a la búsqueda completa (o null si no recortó). */
  meta: BusquedaMeta | null = null;
  /** URL del archivo en la vista previa, para resaltar su fila. */
  archivoSeleccionado: string | null = null;
  /** Modo unión: lo activa el check "Unir documentos" y habilita la selección. */
  modoUnion = false;
  /** Archivos marcados, EN EL ORDEN en que se marcaron: así se une. */
  seleccion: ArchivoVM[] = [];
  @ViewChild('pdfPreview') pdfPreview!: ElementRef<HTMLIFrameElement>;

  private destroyRef = inject(DestroyRef);

  constructor(
    private fb: FormBuilder,
    private documentacionService: DocumentacionService,
    private utilityService: UtilityServiceService,
    private sanitizer: DomSanitizer,
    private titleService: Title,
    private metaService: Meta,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private docViewer: DocViewerService
  ) {
    // SEO Init
    this.titleService.setTitle('Buscar Documentos | Gestión Documental');
    this.metaService.updateTag({ name: 'description', content: 'Consulta tipos documentales y verifica si existen archivos asociados.' });

    this.form = this.fb.group({
      cedula: ['', Validators.required],
      codigoContrato: [''],
      tipoDocumental: [''],
      textoBuscar: ['']
    });
  }


  ngOnInit(): void {
    this.documentacionService.mostrar_jerarquia_anidada()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (arbol) => {
          this.tiposDocumentales = arbol;
          this.gruposTipos = agruparTiposPorPadre(arbol);
          this.cdr.markForCheck(); // App zoneless: sin esto el selector queda vacío
        },
        error: () => Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo obtener la jerarquía de tipos documentales.' })
      });

    // Al escribir la cédula se traen sus códigos de contrato.
    // 600 ms: lo justo para no disparar en cada tecla, sin que se sienta lento.
    this.form.get('cedula')!.valueChanges
      .pipe(
        debounceTime(600),
        distinctUntilChanged(),
        switchMap((cedula) => {
          this.codigosContrato = [];
          this.form.get('codigoContrato')!.setValue('', { emitEvent: false });
          if (!cedula) {
            this.cargandoContratos = false;
            this.cdr.markForCheck();
            return of(null);
          }
          // Carga en línea, sin modal que bloquee: escribir una cédula no debería
          // secuestrar la pantalla con un diálogo.
          this.cargandoContratos = true;
          this.cdr.markForCheck();
          return this.utilityService.obtenerCodigosContrato(cedula).pipe(
            catchError(() => {
              Swal.fire({ toast: true, position: 'top-end', icon: 'warning', showConfirmButton: false, timer: 3000,
                title: 'No se pudieron traer los códigos de contrato' });
              return of(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((codigos: any) => {
        this.cargandoContratos = false;
        this.codigosContrato = codigos?.data ?? [];
        this.cdr.markForCheck();
      });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.cdr.markForCheck();
      return;
    }

    this.buscando = true;
    this.mostrarCarga('Buscando documentos…');
    this.cdr.markForCheck();

    this.documentacionService.buscar_documentos(this.form.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.documentosPorCategoria = this.construirCategorias(data);
          this.meta = data?.['_meta'] ?? null;
          // Los resultados cambian: lo marcado antes ya no está en pantalla.
          this.seleccion = [];
          this.buscando = false;
          this.yaBusco = true;
          this.limpiarPreview();
          this.cerrarCarga();
          this.cdr.markForCheck(); // App zoneless: sin esto los resultados no se pintan
        },
        error: () => {
          this.buscando = false;
          this.yaBusco = true;
          this.cdr.markForCheck();
          this.mostrarError('No se pudieron obtener los documentos.');
        }
      });
  }

  /**
   * Los tres helpers de abajo existen para no repetir el error clásico de
   * `Swal.close()` seguido de `Swal.fire()`: el close es asíncrono y se come al
   * fire que venga detrás, así que la alerta nunca aparece. `fire` ya reemplaza
   * el modal abierto, no hace falta cerrarlo antes.
   */
  private mostrarCarga(texto: string): void {
    Swal.fire({
      title: 'Cargando',
      icon: 'info',
      text: texto,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
  }

  private cerrarCarga(): void {
    // Solo cierra si lo que hay abierto es el modal de carga: si no, cerraríamos
    // una alerta de error que el usuario todavía no ha leído.
    if (Swal.isVisible() && Swal.isLoading()) {
      Swal.close();
    }
  }

  private mostrarError(texto: string): void {
    Swal.fire({ icon: 'error', title: 'Error', text: texto });
  }

  /**
   * La respuesta es `{ contrato: Documento[] }`. Cada contrato se reagrupa por tipo
   * documental y cada expediente se abre en sus archivos, para listar el histórico
   * completo y no solo el vigente.
   *
   * Cuando no hay resultados el backend responde `{ message, document_types }`, así
   * que se ignora todo valor que no sea una lista de expedientes.
   */
  private construirCategorias(data: any): CategoriaVM[] {
    return Object.entries(data ?? {})
      .filter(([, documentos]) => Array.isArray(documentos))
      .map(([categoria, documentos]) => {
        const tipos = this.agruparPorTipo(documentos as Documento[]);
        return {
          categoria,
          tipos,
          totalArchivos: tipos.reduce((total, tipo) => total + tipo.totalReal, 0),
        };
      });
  }

  private agruparPorTipo(documentos: Documento[]): TipoGrupoVM[] {
    const grupos = new Map<number, TipoGrupoVM>();

    for (const doc of documentos) {
      let grupo = grupos.get(doc.type);
      if (!grupo) {
        grupo = {
          typeId: doc.type,
          // `type_name` viene del backend; la jerarquía local es solo respaldo porque
          // puede no haber cargado todavía cuando llega la búsqueda.
          nombre: doc.type_name || this.obtenerNombreDelTipo(doc.type),
          archivos: [],
          totalReal: 0,
          truncado: false,
          expandido: false,
        };
        grupos.set(doc.type, grupo);
      }

      const archivos = this.construirArchivos(doc);
      grupo.archivos.push(...archivos);
      grupo.totalReal += doc.versions_total ?? archivos.length;
      grupo.truncado = grupo.truncado || !!doc.versions_truncated;
    }

    const tipos = [...grupos.values()];

    // Los vigentes primero: un tipo puede tener varios expedientes (p. ej. las dos
    // referencias) y, apilados por expediente, el vigente del segundo quedaría
    // escondido tras "ver más" en cuanto el primero acumule historial.
    for (const tipo of tipos) {
      tipo.archivos.sort((a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) ||
        (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
    }

    return tipos.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  /** Abre un expediente en una fila por archivo. */
  private construirArchivos(doc: Documento): ArchivoVM[] {
    const versiones = doc.versions ?? [];

    if (versiones.length) {
      return versiones.map((version) => this.construirArchivo({
        key: `doc${doc.id}-v${version.id}`,
        doc,
        fileUrl: version.file_url,
        uploadedAt: version.uploaded_at,
        versionNumber: version.version_number,
        isCurrent: version.is_current,
        nombre: version.original_filename || doc.title,
        sizeBytes: version.size_bytes ?? 0,
      }));
    }

    // Expediente sin archivos cargados (o backend antiguo sin `versions`).
    return [this.construirArchivo({
      key: `doc${doc.id}-actual`,
      doc,
      fileUrl: doc.file_url ?? null,
      uploadedAt: doc.uploaded_at ?? null,
      versionNumber: doc.version_number ?? null,
      isCurrent: true,
      nombre: doc.original_filename || doc.title,
      sizeBytes: doc.size_bytes ?? 0,
    })];
  }

  private construirArchivo(base: Omit<ArchivoVM, 'extension' | 'esUnible'>): ArchivoVM {
    const extension = this.extensionDe(base.nombre, base.fileUrl);
    return {
      ...base,
      extension,
      esUnible: !!base.fileUrl && [...EXTENSIONES_PDF, ...EXTENSIONES_IMAGEN].includes(extension),
    };
  }

  /** Extensión real del archivo. El nombre original manda; la URL es respaldo. */
  private extensionDe(nombre: string, fileUrl: string | null): string {
    for (const fuente of [nombre, fileUrl ?? '']) {
      const limpio = fuente.split('?')[0].split('#')[0];
      const punto = limpio.lastIndexOf('.');
      if (punto >= 0 && punto < limpio.length - 1) {
        return limpio.slice(punto + 1).toLowerCase();
      }
    }
    return '';
  }

  totalArchivos(): number {
    return this.documentosPorCategoria.reduce((total, cat) => total + cat.totalArchivos, 0);
  }

  // ─── Unión de documentos ────────────────────────────────────────────────
  //
  // La unión se arma en el cliente con pdf-lib (ya es dependencia, igual que
  // file-saver): no hace falta endpoint nuevo y se reusa el mismo `fetch` del
  // fileUrl que ya usa el editor de PDF.

  alternarModoUnion(): void {
    this.modoUnion = !this.modoUnion;
    if (!this.modoUnion) {
      this.seleccion = [];
    }
  }

  /** Marca/desmarca. El orden de la unión es el orden en que se fue marcando. */
  alternarSeleccion(archivo: ArchivoVM): void {
    if (!archivo.esUnible) return;

    const i = this.seleccion.findIndex((a) => a.key === archivo.key);
    if (i >= 0) {
      this.seleccion.splice(i, 1);
    } else {
      this.seleccion.push(archivo);
    }
  }

  estaSeleccionado(archivo: ArchivoVM): boolean {
    return this.seleccion.some((a) => a.key === archivo.key);
  }

  /** Posición 1..N en la unión, o 0 si no está seleccionado. */
  posicionEnUnion(archivo: ArchivoVM): number {
    return this.seleccion.findIndex((a) => a.key === archivo.key) + 1;
  }

  limpiarSeleccion(): void {
    this.seleccion = [];
  }

  /** En modo unión el click de la fila marca; fuera de él, previsualiza. */
  alClickFila(archivo: ArchivoVM): void {
    if (this.modoUnion) {
      this.alternarSeleccion(archivo);
    } else if (archivo.fileUrl) {
      this.verPDF(archivo.fileUrl);
    }
  }

  async descargarUnion(): Promise<void> {
    const archivos = [...this.seleccion];
    if (archivos.length < 2) return;

    this.mostrarCarga(`Uniendo ${archivos.length} archivos…`);

    try {
      const { PDFDocument } = await import('pdf-lib');
      const union = await PDFDocument.create();

      for (let i = 0; i < archivos.length; i++) {
        const archivo = archivos[i];
        Swal.update({ text: `Uniendo ${i + 1} de ${archivos.length}: ${archivo.nombre}` });
        Swal.showLoading();

        const bytes = await this.descargarBytes(archivo.fileUrl!);

        if (EXTENSIONES_IMAGEN.includes(archivo.extension)) {
          await this.agregarImagen(union, bytes, archivo.extension);
        } else {
          // `ignoreEncryption`: hay PDFs con cifrado vacío que pdf-lib rechaza
          // pero que se leen sin contraseña.
          const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const paginas = await union.copyPages(origen, origen.getPageIndices());
          paginas.forEach((pagina) => union.addPage(pagina));
        }
      }

      const salida = await union.save();
      await this.guardarArchivo(
        new Blob([salida as BlobPart], { type: 'application/pdf' }),
        this.nombreDeUnion(archivos.length),
      );

      this.cerrarCarga();
      Swal.fire({
        icon: 'success',
        title: 'Unión lista',
        text: `Se unieron ${archivos.length} archivos.`,
        timer: 2200,
        showConfirmButton: false,
      });
    } catch (err) {
      console.error('Error uniendo documentos:', err);
      this.mostrarError(
        'No se pudo unir los documentos. Puede que alguno esté dañado o protegido con contraseña.',
      );
    }
  }

  private async guardarArchivo(blob: Blob, nombre: string): Promise<void> {
    const { saveAs } = await import('file-saver');
    saveAs(blob, nombre);
  }

  private async descargarBytes(fileUrl: string): Promise<ArrayBuffer> {
    const respuesta = await fetch(fileUrl);
    if (!respuesta.ok) {
      throw new Error(`No se pudo descargar ${fileUrl}: HTTP ${respuesta.status}`);
    }
    return respuesta.arrayBuffer();
  }

  /** Mete una imagen como página propia, ajustada al tamaño de la imagen. */
  private async agregarImagen(union: any, bytes: ArrayBuffer, extension: string): Promise<void> {
    const imagen = extension === 'png'
      ? await union.embedPng(bytes)
      : await union.embedJpg(bytes);

    const pagina = union.addPage([imagen.width, imagen.height]);
    pagina.drawImage(imagen, { x: 0, y: 0, width: imagen.width, height: imagen.height });
  }

  private nombreDeUnion(cantidad: number): string {
    const cedula = this.form.get('cedula')?.value || 'documentos';
    return `union_${cedula}_${cantidad}archivos.pdf`;
  }

  /** Los primeros N archivos, o todos si el usuario desplegó el tipo. */
  archivosVisibles(tipo: TipoGrupoVM): ArchivoVM[] {
    return tipo.expandido ? tipo.archivos : tipo.archivos.slice(0, ARCHIVOS_VISIBLES_POR_DEFECTO);
  }

  archivosOcultos(tipo: TipoGrupoVM): number {
    return Math.max(0, tipo.archivos.length - ARCHIVOS_VISIBLES_POR_DEFECTO);
  }

  alternarTipo(tipo: TipoGrupoVM): void {
    tipo.expandido = !tipo.expandido;
  }

  formatoTamano(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  trackByCategoria(index: number, item: CategoriaVM): string {
    return item.categoria;
  }

  trackByTipo(index: number, tipo: TipoGrupoVM): number {
    return tipo.typeId;
  }

  trackByArchivo(index: number, archivo: ArchivoVM): string {
    return archivo.key;
  }

  private limpiarPreview() {
    this.archivoSeleccionado = null;
    if (this.pdfPreview) this.pdfPreview.nativeElement.src = 'about:blank';
  }


  async verPDF(docUrl: string | null): Promise<void> {
    // El gateway exige JWT y la API manda X-Frame-Options: deny → se descarga con token
    // (fetch) → blob y se enmarca el blob (los blob sí se pueden enmarcar y no requieren auth).
    if (docUrl && this.pdfPreview) {
      const blobUrl = await this.docViewer.toBlobUrl(docUrl);
      if (!blobUrl) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar el documento.' });
        return;
      }
      this.pdfPreview.nativeElement.src = blobUrl;
      this.archivoSeleccionado = docUrl;
      this.cdr.markForCheck();
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se encontró el iframe o la URL del documento.' });
    }
  }

  /**
   * Busca recursivamente un tipo documental por su `id`.
   * @param listaTipos Lista de tipos (nivel actual).
   * @param idBuscado  ID del tipo documental que se quiere ubicar.
   * @returns          El tipo documental (si existe), o undefined.
   */
  private buscarTipoPorId(listaTipos: TipoDocumental[], idBuscado: number): TipoDocumental | undefined {
    for (const tipo of listaTipos) {
      if (tipo.id === idBuscado) {
        return tipo;
      }
      if (tipo.subtypes && tipo.subtypes.length > 0) {
        const resultado = this.buscarTipoPorId(tipo.subtypes, idBuscado);
        if (resultado) {
          return resultado;
        }
      }
    }
    return undefined;
  }

  /**
   * Devuelve el nombre del tipo documental, dada su ID.
   * @param typeId ID del tipo documental.
   */
  public obtenerNombreDelTipo(typeId: number): string {
    const tipo = this.buscarTipoPorId(this.tiposDocumentales, typeId);
    return tipo ? tipo.name : 'Tipo documental desconocido';
  }

  editarPDF(doc: Documento): void {
    if (!doc.file_url) return;

    // Use Electron IPC to open in external PDF editor (Adobe Acrobat)
    const electronApi = (window as any).electron;
    if (!electronApi?.pdf?.editExternal) {
      // Fallback for non-Electron environment: open dialog viewer
      const dialogRef = this.dialog.open(PdfEditorDialogComponent, {
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
        panelClass: 'pdf-editor-fullscreen-dialog',
        disableClose: true,
        data: {
          fileUrl: doc.file_url,
          docId: doc.id,
          title: doc.title,
          ownerId: this.form.get('cedula')?.value || doc.owner_id || '',
          type: doc.type,
          contractNumber: this.form.get('codigoContrato')?.value || doc.contract_number || ''
        }
      });
      dialogRef.afterClosed().subscribe(result => {
        if (result?.saved) {
          this.onSubmit();
        }
      });
      return;
    }

    // ── Electron path: open in Adobe Acrobat ──
    Swal.fire({
      title: 'Abriendo en editor externo…',
      html: 'Descargando el documento y abriendo Adobe Acrobat.<br><small>Guarda el archivo en Acrobat cuando termines de editar.</small>',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    electronApi.pdf.editExternal(doc.file_url).then((result: any) => {
      if (!result.success) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: result.error || 'No se pudo abrir el editor de PDF.'
        });
        return;
      }

      Swal.fire({
        icon: 'info',
        title: 'Editando en Adobe Acrobat',
        html: `
          <p style="margin-bottom:8px;">El documento se abrió en tu editor de PDF.</p>
          <p style="font-weight:700;">Cuando termines de editar:</p>
          <ol style="text-align:left;font-size:14px;">
            <li>Guarda el archivo en Adobe (Ctrl+S)</li>
            <li>Haz clic en <b>"Subir Cambios"</b> abajo</li>
          </ol>
        `,
        showCancelButton: true,
        confirmButtonText: '📤 Subir Cambios',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#4CAF50',
        allowOutsideClick: false
      }).then(async (swalResult) => {
        if (swalResult.isConfirmed) {
          // Read the modified file and upload
          Swal.fire({
            title: 'Subiendo documento editado…',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
          });

          try {
            // Read the modified file via IPC (main process reads it)
            const readResult = await electronApi.pdf.readFile();
            if (!readResult.success) {
              throw new Error(readResult.error || 'No se pudo leer el archivo');
            }

            // Convert base64 to Blob
            const byteCharacters = atob(readResult.bytes);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });

            const cedula = this.form.get('cedula')?.value || doc.owner_id || '';
            const contrato = this.form.get('codigoContrato')?.value || doc.contract_number || '';

            this.documentacionService.actualizarDocumento(
              doc.title,
              cedula,
              doc.type,
              blob,
              'documento_editado.pdf',
              contrato
            )
              .subscribe({
                next: () => {
                  electronApi.pdf.finishEdit();
                  Swal.fire({
                    icon: 'success',
                    title: '¡Guardado!',
                    text: 'El documento editado fue subido exitosamente.',
                    timer: 2500,
                    showConfirmButton: false
                  });
                  this.onSubmit();
                },
                error: (err: any) => {
                  console.error('Upload error:', err);
                  Swal.fire({
                    icon: 'error',
                    title: 'Error al Subir',
                    text: 'No se pudo subir el documento editado.'
                  });
                }
              });
          } catch (err) {
            console.error('Error reading modified file:', err);
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'No se pudo leer el archivo modificado.'
            });
            electronApi.pdf.finishEdit();
          }
        } else {
          // User cancelled
          electronApi.pdf.finishEdit();
        }
      });
    }).catch((err: any) => {
      console.error('Error opening external editor:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo abrir el editor externo.'
      });
    });
  }
}

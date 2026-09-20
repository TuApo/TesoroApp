import {
  Component,
  Inject,
  ChangeDetectionStrategy,
  OnInit,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { trigger, style, transition, animate } from '@angular/animations';

export interface ViewerDocument {
  id: number;
  title: string;
  type_name?: string;
  file_url: string;
  /**
   * Tipo MIME real, cuando quien abre el visor lo sabe.
   *
   * Es lo unico fiable: `file_url` puede ser un `blob:` (sin extension) o una
   * ruta de la API como `/api/v1/documents/123/download?versionId=456`, que
   * tampoco termina en `.pdf`. Sin esto, esos documentos —que son casi todos—
   * caian en "Vista previa no disponible" aunque fueran PDF.
   */
  mime?: string;
}

export interface VerPdfsData {
  title: string;
  documents: ViewerDocument[];
}

@Component({
  selector: 'app-ver-pdfs',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatDividerModule,
    MatTooltipModule
],
  templateUrl: './ver-pdfs.component.html',
  styleUrls: ['./ver-pdfs.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('dialogFade', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(8px)' }),
        animate(
          '180ms ease-out',
          style({ opacity: 1, transform: 'translateY(0)' }),
        ),
      ]),
      transition(':leave', [
        animate(
          '150ms ease-in',
          style({ opacity: 0, transform: 'translateY(6px)' }),
        ),
      ]),
    ]),
  ],
})
export class VerPdfsComponent implements OnInit {
  selectedIndex = 0;

  /** URL segura que se bindea al iframe */
  currentSafeUrl: SafeResourceUrl | null = null;

  /** Estado de carga para mostrar el loader */
  loading = false;

  /** Mensaje de error (solo por si quieres setearlo desde fuera en un futuro) */
  loadError: string | null = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: VerPdfsData,
    private readonly dialogRef: MatDialogRef<VerPdfsComponent>,
    private readonly sanitizer: DomSanitizer,
  ) {}

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    if (this.hasDocuments && this.isPdf(this.selectedDoc)) {
      this.loadPdfPreview(this.selectedDoc);
    }
  }

  // ---------------------------------------------------------------------------
  // GETTERS
  // ---------------------------------------------------------------------------

  get hasDocuments(): boolean {
    return Array.isArray(this.data?.documents) && this.data.documents.length > 0;
  }

  get selectedDoc(): ViewerDocument | null {
    if (!this.hasDocuments) return null;
    return this.data.documents[this.selectedIndex] ?? null;
  }

  // ---------------------------------------------------------------------------
  // SELECCIÓN / CIERRE
  // ---------------------------------------------------------------------------

  selectDoc(index: number): void {
    if (index === this.selectedIndex) return;

    this.selectedIndex = index;

    if (this.isPdf(this.selectedDoc)) {
      this.loadPdfPreview(this.selectedDoc);
    } else {
      this.resetCurrentPreviewState();
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  // ---------------------------------------------------------------------------
  // HELPERS DE TIPO
  // ---------------------------------------------------------------------------

  /**
   * Texto sobre el que se adivina la extension.
   *
   * Se mira el TITULO ademas de la URL: el titulo del expediente si trae el
   * nombre real del archivo ("EXAMENES_MEDICOS_....pdf"), mientras que la URL
   * de descarga y los `blob:` no tienen extension ninguna.
   */
  private nombreParaTipo(doc: ViewerDocument | null): string {
    return `${doc?.title ?? ''} ${doc?.file_url ?? ''}`.toLowerCase();
  }

  private tieneExtension(doc: ViewerDocument | null, exts: string[]): boolean {
    const s = this.nombreParaTipo(doc);
    return exts.some((e) => s.includes(e));
  }

  isPdf(doc: ViewerDocument | null): boolean {
    if (!doc?.file_url) return false;
    if (doc.mime) return doc.mime.toLowerCase().includes('pdf');
    return this.tieneExtension(doc, ['.pdf']);
  }

  isExcel(doc: ViewerDocument | null): boolean {
    if (!doc?.file_url) return false;
    if (doc.mime) {
      const m = doc.mime.toLowerCase();
      return m.includes('spreadsheet') || m.includes('excel');
    }
    return this.tieneExtension(doc, ['.xlsx', '.xls']);
  }

  isImage(doc: ViewerDocument | null): boolean {
    if (!doc?.file_url) return false;
    if (doc.mime) return doc.mime.toLowerCase().startsWith('image/');
    return this.tieneExtension(doc, ['.png', '.jpg', '.jpeg', '.gif', '.webp']);
  }

  getChipLabel(doc: ViewerDocument): string {
    if (this.isPdf(doc)) return 'PDF';
    if (this.isExcel(doc)) return 'Excel';
    if (this.isImage(doc)) return 'Imagen';
    return doc.type_name || 'Documento';
  }

  getIcon(doc: ViewerDocument): string {
    if (this.isPdf(doc)) return 'picture_as_pdf';
    if (this.isExcel(doc)) return 'table_chart';
    if (this.isImage(doc)) return 'image';
    return 'description';
  }

  // ---------------------------------------------------------------------------
  // PREVIEW PDF USANDO DIRECTAMENTE file_url
  // ---------------------------------------------------------------------------

  private resetCurrentPreviewState(): void {
    this.currentSafeUrl = null;
    this.loadError = null;
    this.loading = false;
  }

  private loadPdfPreview(doc: ViewerDocument | null): void {
    this.resetCurrentPreviewState();

    if (!doc || !this.isPdf(doc)) return;

    // mostramos loader mientras el iframe termina de cargar
    this.loading = true;
    this.currentSafeUrl =
      this.sanitizer.bypassSecurityTrustResourceUrl(doc.file_url);
  }

  /** Se llama cuando el iframe termina de cargar el PDF */
  onIframeLoaded(): void {
    this.loading = false;
  }

  // ---------------------------------------------------------------------------
  // ACCIONES (ABRIR / DESCARGAR)
  // ---------------------------------------------------------------------------

  openInNewTab(doc: ViewerDocument | null): void {
    if (!doc?.file_url) return;
    window.open(doc.file_url, '_blank', 'noreferrer');
  }

  download(doc: ViewerDocument | null): void {
    if (!doc?.file_url) return;
    window.open(doc.file_url, '_blank', 'noreferrer');
  }
}

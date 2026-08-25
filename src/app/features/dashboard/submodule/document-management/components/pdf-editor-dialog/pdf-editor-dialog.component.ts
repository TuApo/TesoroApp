import { 
  Component,
  Inject,
  ChangeDetectorRef,
  ViewChild,
  OnInit
, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NgxExtendedPdfViewerModule, NgxExtendedPdfViewerComponent } from 'ngx-extended-pdf-viewer';
import Swal from 'sweetalert2';
import { DocumentacionService } from '../../service/documentacion/documentacion.service';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';

export interface PdfEditorDialogData {
  fileUrl: string;
  docId: number;
  title: string;
  ownerId: string;
  type: number;
  contractNumber?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-pdf-editor-dialog',
  standalone: true,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    NgxExtendedPdfViewerModule
],
  templateUrl: './pdf-editor-dialog.component.html',
  styleUrl: './pdf-editor-dialog.component.css'
} )
export class PdfEditorDialogComponent implements OnInit {
  @ViewChild('pdfViewer') pdfViewer?: NgxExtendedPdfViewerComponent;

  isSaving = false;
  isLoading = true;
  loadError = false;
  isBrowser: boolean;

  // PDF source as Uint8Array (loaded from URL)
  pdfBytes: Uint8Array | null = null;

  constructor(
    public dialogRef: MatDialogRef<PdfEditorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PdfEditorDialogData,
    @Inject(PLATFORM_ID) private platformId: Object,
    private http: HttpClient,
    private docService: DocumentacionService,
    private docViewer: DocViewerService,
    private cdr: ChangeDetectorRef
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit(): void {
    if (this.isBrowser) {
      this.loadPdfBytes();
    }
  }

  // ─── Load PDF bytes to avoid CORS issues ────────────────
  private async loadPdfBytes(): Promise<void> {
    this.isLoading = true;
    this.loadError = false;

    // HttpClient pasa por el auth.interceptor (añade JWT para la API). Se resuelve la URL a
    // absoluta para que el interceptor reconozca el host de la API y no se resuelva contra el
    // host del front (el fetch nativo previo daba 401 y no manejaba URLs relativas).
    const url = this.docViewer.absolute(this.data.fileUrl);
    this.http.get(url, { responseType: 'arraybuffer' }).subscribe({
      next: (buffer) => {
        this.pdfBytes = new Uint8Array(buffer);
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (httpErr) => {
        console.error('Error loading PDF:', httpErr);
        this.isLoading = false;
        this.loadError = true;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── Save: export annotated PDF and upload ──────────────
  async savePdf(): Promise<void> {
    this.isSaving = true;
    this.cdr.detectChanges();

    try {
      // Use the global PDFViewerApplication to export the doc with annotations
      const pdfApp = (window as any).PDFViewerApplication;
      if (pdfApp && pdfApp.pdfDocument) {
        const data = await pdfApp.pdfDocument.saveDocument();
        const blob = new Blob([data], { type: 'application/pdf' });
        await this.uploadPdf(blob);
        return;
      }

      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo exportar el PDF editado.' });
      this.isSaving = false;
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Error saving PDF:', err);
      this.isSaving = false;
      this.cdr.detectChanges();
      Swal.fire({ icon: 'error', title: 'Error', text: 'Error al procesar el PDF.' });
    }
  }

  private uploadPdf(blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docService.actualizarDocumento(
        this.data.title,
        this.data.ownerId,
        this.data.type,
        blob,
        'documento_editado.pdf',
        this.data.contractNumber
      )
        .subscribe({
          next: () => {
            this.isSaving = false;
            this.cdr.detectChanges();
            Swal.fire({
              icon: 'success',
              title: '¡Guardado!',
              text: 'El documento ha sido actualizado exitosamente.',
              timer: 2000,
              showConfirmButton: false
            });
            this.dialogRef.close({ saved: true });
            resolve();
          },
          error: (err: any) => {
            this.isSaving = false;
            this.cdr.detectChanges();
            console.error('Upload error:', err);
            Swal.fire({
              icon: 'error',
              title: 'Error al Guardar',
              text: 'No se pudo subir el documento editado.'
            });
            reject(err);
          }
        });
    });
  }

  // ─── Cancel ─────────────────────────────────────────────
  cancel(): void {
    Swal.fire({
      icon: 'warning',
      title: '¿Cerrar editor?',
      text: 'Los cambios no guardados se perderán.',
      showCancelButton: true,
      confirmButtonText: 'Sí, cerrar',
      cancelButtonText: 'Seguir editando',
      confirmButtonColor: '#EF4444'
    }).then(result => {
      if (result.isConfirmed) {
        this.dialogRef.close();
      }
    });
  }
}

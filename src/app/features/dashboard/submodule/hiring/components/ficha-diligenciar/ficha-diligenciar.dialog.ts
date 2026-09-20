import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import { take } from 'rxjs';

import { aplanarPdfDiligenciado } from '../generate-contracting-documents/pdf-aplanado.util';

export interface FichaDiligenciarData {
  titulo: string;
  /** PDF generado con los datos de la persona y los campos SIN aplanar. */
  bytes: Uint8Array;
  nombreArchivo: string;
}

/** Cierra con el PDF ya diligenciado y aplanado; `undefined` = se canceló. */
export type FichaDiligenciarResultado = { file: File } | undefined;

/**
 * Diligenciar a mano lo que le falta a un documento generado (ficha técnica).
 *
 * El generador llena lo que sabe y deja los campos editables. Aquí se ve el
 * documento tal cual saldrá, se escribe en las casillas vacías (o con la
 * herramienta de texto donde no hay casilla) y al guardar se aplana: al
 * expediente llega bloqueado, igual que un documento generado.
 */
@Component({
  selector: 'app-ficha-diligenciar-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, NgxExtendedPdfViewerModule],
  templateUrl: './ficha-diligenciar.dialog.html',
  styleUrls: ['./ficha-diligenciar.dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FichaDiligenciarDialogComponent {
  readonly data = inject<FichaDiligenciarData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<FichaDiligenciarDialogComponent, FichaDiligenciarResultado>>(MatDialogRef);
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  /** URL local (blob) del PDF. `null` hasta que el diálogo termina de abrir. */
  readonly srcUrl = signal<string | null>(null);
  /** El visor ya pintó el documento: antes no hay nada que guardar. */
  readonly cargado = signal(false);

  constructor() {
    // Se pasa una URL y NO los bytes: el visor guarda el ArrayBuffer una sola vez
    // y pdf.js lo transfiere a su worker al abrirlo. Si abre dos veces (pasa
    // cuando ya hubo otro visor en la sesión), la segunda recibe el búfer vacío
    // y la ficha sale en blanco. Una URL se puede leer las veces que haga falta.
    // Y se espera a que el diálogo termine de abrir: el visor mide su contenedor
    // al arrancar y durante la animación todavía no tiene tamaño.
    this.ref.afterOpened().pipe(take(1)).subscribe(() => {
      this.srcUrl.set(URL.createObjectURL(new Blob([this.data.bytes as BlobPart], { type: 'application/pdf' })));
    });
    inject(DestroyRef).onDestroy(() => {
      const u = this.srcUrl();
      if (u) URL.revokeObjectURL(u);
    });
  }

  alCargar(): void {
    this.cargado.set(true);
    this.error.set(null);
  }

  alFallar(e: unknown): void {
    console.error('[ficha-diligenciar] el visor no pudo abrir la ficha:', e);
    this.error.set('No se pudo mostrar la ficha: ' + ((e as Error)?.message || String(e)));
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    try {
      // Mismo camino que el editor de gestión documental: pdf.js exporta el
      // documento con lo que se escribió en los campos y las anotaciones.
      const app = (window as any).PDFViewerApplication;
      if (!app?.pdfDocument) throw new Error('El visor todavía no terminó de cargar el documento.');
      const editado: Uint8Array = await app.pdfDocument.saveDocument();
      const plano = await aplanarPdfDiligenciado(editado);
      const file = new File([plano as BlobPart], this.data.nombreArchivo, { type: 'application/pdf' });
      this.ref.close({ file });
    } catch (e: any) {
      console.error('[ficha-diligenciar] no se pudo guardar:', e);
      this.error.set(e?.message || 'No se pudo preparar el documento para guardarlo.');
      this.guardando.set(false);
    }
  }

  cancelar(): void {
    this.ref.close();
  }
}

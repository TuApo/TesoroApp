import {  Component, Inject , ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

export interface PreviewDialogData {
  title: string;
  items: {
    name: string;
    valid: boolean;
    error?: string;
  }[];
}

type ArchivoPreview = PreviewDialogData['items'][number];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-file-preview-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    ...TABLA_ESTANDAR,
],
  templateUrl: './file-preview-dialog.component.html',
  styleUrl: './file-preview-dialog.component.css'
} )
export class FilePreviewDialogComponent {
  /** Columnas de la tabla estándar: el estado viaja plano (OK / Error) y el detalle del error va a la copia. */
  readonly columnas: ColumnaTabla<ArchivoPreview>[] = [
    { id: 'name', header: 'Archivo', valor: (i) => i.name, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'status', header: 'Estado', valor: (i) => (i.valid ? 'OK' : 'Error'), tarjeta: 'badge',
      copiaTexto: (i) => (i.valid ? 'OK' : ['Error', i.error].filter(Boolean).join(': ')) },
  ];

  constructor(
    public dialogRef: MatDialogRef<FilePreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PreviewDialogData
  ) { }

  close(): void {
    this.dialogRef.close();
  }
}

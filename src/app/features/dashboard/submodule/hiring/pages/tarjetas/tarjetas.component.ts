import {  Component, ViewChild, AfterViewInit , ChangeDetectionStrategy } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';

import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { DynamicFormDialogComponent, DynamicDialogData, FieldConfig } from '@/app/shared/components/dynamic-form-dialog/dynamic-form-dialog.component';
import { TarjetasService, Tarjeta, ImportResult } from '../../service/tarjetas.service';
import Swal from 'sweetalert2';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tarjetas',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatChipsModule,
    StandardFilterTable,
    ...TABLA_ESTANDAR,
],
  templateUrl: './tarjetas.component.html',
  styleUrls: ['./tarjetas.component.css']
} )
export class TarjetasComponent implements AfterViewInit {
  @ViewChild(StandardFilterTable) table!: StandardFilterTable;

  columns: ColumnDefinition[] = [
    { name: 'identification_number', header: 'Número de Identificación', type: 'text', sortable: true, filterable: true },
    { name: 'card_number', header: 'Número Tarjeta', type: 'text', sortable: true, filterable: true },
    { name: 'created_at', header: 'Fecha Creación', type: 'date', sortable: true, filterable: true },
    { name: 'actions', header: 'Acciones', type: 'custom', filterable: false, sortable: false, stickyEnd: true, width: '120px' }
  ];

  /** Errores por fila que devuelve la importación del Excel (tabla estándar). */
  readonly columnasErrores: ColumnaTabla<{ row: number | string; error: string }>[] = [
    { id: 'row', header: 'Fila', valor: (e) => e.row, align: 'right', ancho: '90px', tarjeta: 'titulo' },
    { id: 'error', header: 'Error', valor: (e) => e.error, tarjeta: 'cuerpo', minAncho: '220px' },
  ];

  data: Tarjeta[] = [];
  isLoading = false;
  isUploading = false;

  // Upload
  selectedFile: File | null = null;
  importResult: ImportResult | null = null;

  constructor(
    private tarjetasService: TarjetasService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) { }

  ngAfterViewInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.isLoading = true;
    this.tarjetasService.list().subscribe({
      next: (res) => {
        const list = Array.isArray(res) ? res : res.results || [];
        this.data = list;
        this.isLoading = false;
      },
      error: (err) => {
        console.error(err);
        this.isLoading = false;
        this.snackBar.open('Error al cargar tarjetas', 'Cerrar', { duration: 3000 });
      }
    });
  }

  // File Upload
  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.importResult = null;
    }
  }

  onImport(): void {
    if (!this.selectedFile) return;

    Swal.fire({
      title: '¿Importar archivo?',
      text: `Se procesará el archivo: ${this.selectedFile.name}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, importar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.executeImport();
      }
    });
  }

  executeImport(): void {
    if (!this.selectedFile) return;
    this.isUploading = true;

    this.tarjetasService.importExcel(this.selectedFile).subscribe({
      next: (res) => {
        this.isUploading = false;
        this.importResult = res;
        this.selectedFile = null;
        this.loadData();
        Swal.fire('Importación completada', `Creados: ${res.created}, Actualizados: ${res.updated}`, 'success');
      },
      error: (err) => {
        this.isUploading = false;
        console.error(err);
        Swal.fire('Error', 'Hubo un problema al importar el archivo.', 'error');
      }
    });
  }

  // CRUD
  onCreate(): void {
    const fields: FieldConfig[] = [
      { name: 'identification_number', label: 'Número de Identificación', type: 'text', required: true },
      { name: 'card_number', label: 'Número Tarjeta', type: 'text', required: true }
    ];

    const dialogRef = this.dialog.open(DynamicFormDialogComponent, {
      data: {
        title: 'Crear Tarjeta',
        fields: fields
      } as DynamicDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.isLoading = true;
        this.tarjetasService.create(result).subscribe({
          next: () => {
            this.snackBar.open('Tarjeta creada exitosamente', 'Cerrar', { duration: 3000 });
            this.loadData();
          },
          error: (err) => {
            this.isLoading = false;
            console.error(err);
            Swal.fire('Error', 'No se pudo crear la tarjeta. Verifique si el número ya existe.', 'error');
          }
        });
      }
    });
  }

  onEdit(row: Tarjeta): void {
    const fields: FieldConfig[] = [
      { name: 'identification_number', label: 'Número de Identificación', type: 'text', required: true },
      { name: 'card_number', label: 'Número Tarjeta', type: 'text', required: true, disabled: false }
    ];

    const dialogRef = this.dialog.open(DynamicFormDialogComponent, {
      data: {
        title: 'Editar Tarjeta',
        fields: fields,
        value: row
      } as DynamicDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.isLoading = true;
        this.tarjetasService.update(row.id, result).subscribe({
          next: () => {
            this.snackBar.open('Tarjeta actualizada', 'Cerrar', { duration: 3000 });
            this.loadData();
          },
          error: (err) => {
            this.isLoading = false;
            console.error(err);
            Swal.fire('Error', 'No se pudo actualizar la tarjeta.', 'error');
          }
        });
      }
    });
  }

  onDelete(row: Tarjeta): void {
    Swal.fire({
      title: '¿Eliminar tarjeta?',
      text: `Se eliminará la tarjeta ${row.card_number}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.isLoading = true;
        this.tarjetasService.delete(row.id).subscribe({
          next: () => {
            this.snackBar.open('Tarjeta eliminada', 'Cerrar', { duration: 3000 });
            this.loadData();
          },
          error: (err) => {
            this.isLoading = false;
            console.error(err);
            Swal.fire('Error', 'No se pudo eliminar la tarjeta.', 'error');
          }
        });
      }
    });
  }
}

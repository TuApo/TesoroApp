import {  Component, OnInit, ViewChild, ElementRef, inject , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { PositionsService, Cargo } from '../../services/positions/positions.service';
import { DynamicFormDialogComponent, FieldConfig } from '@/app/shared/components/dynamic-form-dialog/dynamic-form-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-manage-positions',
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule, StandardFilterTable, MatMenuModule],
  templateUrl: './manage-positions.component.html',
  styleUrls: ['./manage-positions.component.css']
} )
export class ManagePositionsComponent implements OnInit {
  private svc = inject(PositionsService);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);
  @ViewChild('fileInp', { static: false }) fileInp!: ElementRef<HTMLInputElement>;

  viewData: Cargo[] = [];
  loading = false;

  columns: ColumnDefinition[] = [
    { name: 'nombre', header: 'Nombre', type: 'text', stickyStart: true },
    // format:'percent' -> antes salía "12.5" crudo; ahora "12,5 %"
    { name: 'porcentaje_arl', header: 'ARL', type: 'number', format: 'percent', align: 'right', width: '12ch' },
    { name: 'actions', header: 'Acciones', type: 'custom', stickyEnd: true }
  ];

  ngOnInit(): void { this.cargar(); }

  cargar(): void {
    this.loading = true;
    this.cdr.markForCheck();
    this.svc.list().subscribe({
      next: rows => { this.viewData = rows || []; this.loading = false; this.cdr.markForCheck(); },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
        this.error('No se pudieron cargar los cargos.');
      }
    });
  }

  /** Un solo sistema de feedback en toda la app: SweetAlert, no alert() del SO. */
  private error(text: string) {
    Swal.fire({ icon: 'error', title: 'Error', text });
  }

  private ok(title: string) {
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', showConfirmButton: false, timer: 1800, title });
  }

  // ---------- Nuevo ----------
  nuevo(): void {
    const fields: FieldConfig[] = [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true, maxLength: 150, hint: 'Máx. 150 caracteres' },
      {
        name: 'porcentaje_arl', label: 'ARL (0–100)', type: 'number',
        required: true, min: 0, max: 100, inputMode: 'decimal', suffix: '%',
        hint: 'Puedes usar coma o punto como separador',
        parse: (raw: any) => {
          if (raw == null) return null;
          const n = Number(String(raw).replace(',', '.'));
          return Number.isFinite(n) ? n : raw;
        }
      }
    ];

    const ref = this.dialog.open(DynamicFormDialogComponent, {
      width: '480px',
      autoFocus: true,
      data: { title: 'Nuevo cargo', fields }
    });

    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const body: Cargo = { nombre: result.nombre, porcentaje_arl: result.porcentaje_arl };
      this.svc.create(body).subscribe({
        next: () => { this.ok('Cargo creado'); this.cargar(); },
        error: (err) => this.error(err?.error?.detail || 'No se pudo crear el cargo.')
      });
    });
  }

  // ---------- Editar ----------
  editar(row: Cargo): void {
    const fields: FieldConfig[] = [
      { name: 'nombre', label: 'Nombre (no editable)', type: 'text', disabled: true },
      {
        name: 'porcentaje_arl', label: 'ARL (0–100)', type: 'number',
        required: true, min: 0, max: 100, inputMode: 'decimal', suffix: '%',
        parse: (raw: any) => {
          const n = Number(String(raw).replace(',', '.'));
          return Number.isFinite(n) ? n : raw;
        }
      }
    ];

    const ref = this.dialog.open(DynamicFormDialogComponent, {
      width: '480px',
      autoFocus: false,
      data: {
        title: `Editar: ${row.nombre}`,
        fields,
        value: { nombre: row.nombre, porcentaje_arl: row.porcentaje_arl }
      }
    });

    ref.afterClosed().subscribe(result => {
      if (!result) return;
      this.svc.patch(row.nombre, { porcentaje_arl: result.porcentaje_arl }).subscribe({
        next: () => { this.ok('Cargo actualizado'); this.cargar(); },
        error: () => this.error('No se pudo actualizar el cargo.')
      });
    });
  }

  // ---------- Eliminar / Importar / Exportar ----------
  eliminar(row: Cargo) {
    // confirm() nativo -> diálogo de marca, y además nombra lo que se va a borrar.
    Swal.fire({
      icon: 'warning',
      title: '¿Eliminar el cargo?',
      html: `Se eliminará <b>${row.nombre}</b>. Esta acción no se puede deshacer.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b42318',
      cancelButtonColor: '#64748b',
    }).then(res => {
      if (!res.isConfirmed) return;
      this.svc.remove(row.nombre).subscribe({
        next: () => { this.ok('Cargo eliminado'); this.cargar(); },
        error: (e) => this.error(e?.error?.detail || 'No se pudo eliminar el cargo.')
      });
    });
  }

  triggerImport(): void { this.fileInp?.nativeElement?.click(); }

  onImportFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    this.loading = true;
    this.cdr.markForCheck();
    this.svc.importExcel(file).subscribe({
      next: () => { this.ok('Cargos importados'); this.cargar(); input.value = ''; },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
        this.error('No se pudo importar el archivo. Revisa que sea un Excel válido.');
        input.value = '';
      }
    });
  }

  exportar(): void { this.svc.downloadExcel(); }
}

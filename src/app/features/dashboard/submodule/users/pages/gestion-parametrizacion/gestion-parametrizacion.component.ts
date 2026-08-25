// src/app/features/parametrizacion/components/gestion-parametrizacion/gestion-parametrizacion.component.ts
import {  Component, OnInit, inject, signal , ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { StandardFilterTable,  } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { SharedModule } from '@/app/shared/shared.module';
import { DynamicFormDialogComponent, FieldConfig } from '@/app/shared/components/dynamic-form-dialog/dynamic-form-dialog.component';
import { MetaConfigDialogComponent } from '../../components/meta-config-dialog/meta-config-dialog.component';
import { GestionParametrizacionService, MetaTabla } from '../../services/gestion-parametrizacion/gestion-parametrizacion.service';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';

interface AppRelease {
  version: string;
  filename: string;
  url: string;
  releaseDate: string;
  sizeMB: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-gestion-parametrizacion',
  standalone: true,
  imports: [
    SharedModule,
    StandardFilterTable,
    MatSnackBarModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
],
  templateUrl: './gestion-parametrizacion.component.html',
  styleUrls: ['./gestion-parametrizacion.component.css']
} )

export class GestionParametrizacionComponent implements OnInit {
  private svc = inject(GestionParametrizacionService);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  data = signal<MetaTabla[]>([]);
  appRelease = signal<AppRelease | null>(null);
  cargandoVersion = signal(true);

  // Columnas (incluye 'actions' para botones Campos/Valores)
  columns: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '136px', filterable: false },
    { name: 'codigo', header: 'Código', type: 'text', filterable: true, stickyStart: true },
    { name: 'descripcion', header: 'Descripción', type: 'text', filterable: true, width: '40%' },
    {
      name: 'activo',
      header: 'Activo',
      type: 'status',
      // Estado por excepción: "Activo" es lo esperado y se deja en neutro (sin entrada
      // en statusConfig el badge hereda el color de la celda). Solo se resalta "Inactivo".
      statusConfig: {
        false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' },
      },
    },
    { name: 'updated_at', header: 'Actualizado', type: 'date' },
  ];

  pageSizeOptions = [10, 20, 50];
  defaultPageSize = 10;

  ngOnInit(): void {
    this.cargarTablas();
    this.cargarVersionApp();
  }

  cargarVersionApp(): void {
    this.http.get<AppRelease>('/downloads/latest.json').subscribe({
      next: release => { this.appRelease.set(release); this.cargandoVersion.set(false); },
      error: () => this.cargandoVersion.set(false),
    });
  }

  descargarAppEscritorio(): void {
    const release = this.appRelease();
    if (!release) return;
    const a = document.createElement('a');
    a.href = release.url;
    a.download = release.filename;
    a.click();
  }

  cargarTablas(): void {
    this.svc.listMetaTablas().subscribe({
      next: res => this.data.set(res || []),
      error: () => this.snack.open('No se pudieron cargar las MetaTablas', 'Cerrar', { duration: 3500 }),
    });
  }

  // === Crear ===
  onNuevaTabla(): void {
    const fields = this.buildTablaFields(false);
    // 50vw se quedaba en ~180px en móvil y desbordaba el formulario.
    const ref = this.dialog.open(DynamicFormDialogComponent, {
      width: 'min(560px, 95vw)',
      data: { title: 'Nueva MetaTabla', submitText: 'Crear', fields }
    });

    ref.afterClosed().subscribe((formValue: any) => {
      if (!formValue) return;
      this.svc.createMetaTabla(formValue).subscribe({
        next: () => { this.snack.open('Tabla creada', 'OK', { duration: 2500 }); this.cargarTablas(); },
        error: () => this.snack.open('No se pudo crear la tabla', 'Cerrar', { duration: 3500 })
      });
    });
  }

  // === Editar (click de fila) ===
  // El código sólo puede cambiar al crear: en edición es la clave que identifica la tabla.
  onEditarTabla(tabla: MetaTabla): void {
    const fields = this.buildTablaFields(true);
    const ref = this.dialog.open(DynamicFormDialogComponent, {
      width: 'min(560px, 95vw)',
      data: {
        title: `Editar: ${tabla.codigo}`,
        submitText: 'Guardar',
        fields,
        value: {
          codigo: tabla.codigo,
          descripcion: tabla.descripcion ?? '',
          activo: tabla.activo,
        }
      }
    });

    ref.afterClosed().subscribe((formValue: any) => {
      if (!formValue) return;
      this.svc.updateMetaTabla(tabla.codigo, {
        descripcion: formValue.descripcion,
        activo: formValue.activo,
      }).subscribe({
        next: () => { this.snack.open('Tabla actualizada', 'OK', { duration: 2500 }); this.cargarTablas(); },
        error: () => this.snack.open('No se pudo actualizar la tabla', 'Cerrar', { duration: 3500 })
      });
    });
  }

  private buildTablaFields(isEdit: boolean): FieldConfig[] {
    return [
      {
        name: 'codigo',
        label: 'Código',
        type: 'text',
        required: true,
        maxLength: 64,
        placeholder: 'p.ej. AFILIADO',
        disabled: isEdit,
        pattern: /^[A-Z0-9_.-]{2,64}$/
      },
      {
        name: 'descripcion',
        label: 'Descripción',
        type: 'textarea',
        maxLength: 1000
      },
      {
        name: 'activo',
        label: 'Activo',
        type: 'checkbox'
      }
    ];
  }

  descargarExcelServidor(): void {
    this.svc.descargarExcel('/descargar/meta_tablas.xlsx').subscribe({
      next: blob => this.svc.saveBlobAs('meta_tablas.xlsx', blob),
      error: () => this.snack.open('Error descargando Excel', 'Cerrar', { duration: 3000 }),
    });
  }

  descargarZipServidor(): void {
    this.svc.descargarZip('/descargar/meta_tablas.zip').subscribe({
      next: blob => this.svc.saveBlobAs('meta_tablas.zip', blob),
      error: () => this.snack.open('Error descargando ZIP', 'Cerrar', { duration: 3000 }),
    });
  }

  /** ===== Diálogo de Config (Campos / Valores) desde acciones ===== */
  openMetaConfig(row: MetaTabla, mode: 'campos' | 'valores') {
    const ref = this.dialog.open(MetaConfigDialogComponent, {
      minWidth: '70vw',
      data: { mode, tabla: row }   // ← pasa el objeto completo, más robusto
    });

    ref.afterClosed().subscribe(out => {
      if (out?.refresh) this.cargarTablas();
    });
  }




}

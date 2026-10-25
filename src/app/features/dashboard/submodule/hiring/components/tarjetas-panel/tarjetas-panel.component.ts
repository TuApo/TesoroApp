import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import Swal from 'sweetalert2';

import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import {
  DynamicFormDialogComponent,
  DynamicDialogData,
  FieldConfig,
} from '@/app/shared/components/dynamic-form-dialog/dynamic-form-dialog.component';
import { FiltroTarjetas, Tarjeta, TarjetasService } from '../../service/tarjetas.service';
import {
  DialogoCargaTarjetasComponent,
  ResultadoDialogoCargaTarjetas,
} from '../../pages/tarjetas/dialogo-carga-tarjetas/dialogo-carga-tarjetas.component';
import { DialogoHistorialCargasComponent } from './dialogo-historial-cargas.component';

/** Campo de orden que entiende el backend para cada columna de la tabla. */
const CAMPO_ORDEN: Record<string, string> = {
  identification_number: 'identificationNumber',
  card_number: 'cardNumber',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  id: 'id',
};

/**
 * Panel de **Tarjetas**: consultar, administrar, exportar y cargar masivamente.
 *
 * <p>Vive en un componente propio porque se usa en DOS sitios: la pestaña «Tarjetas» del
 * parametrizador de vacantes y la pantalla suelta de Contratación. Tenerlo duplicado
 * garantizaba que uno de los dos se quedara atrás.
 *
 * <p>El listado pagina, filtra y ordena <b>en el servidor</b> (son más de 55.000 tarjetas),
 * la exportación la genera el backend con el filtro completo —no con la página visible— y
 * la carga masiva pasa siempre por simular → revisar → confirmar.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tarjetas-panel',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    StandardFilterTable,
    // Sin esta directiva las columnas propias (origen, lote, acciones) se pintan VACÍAS:
    // `appCellTemplate` deja de ser una directiva y pasa a ser un atributo cualquiera.
    ColumnCellTemplateDirective,
  ],
  // Los dos calendarios del filtro necesitan adaptador de fechas; el resto de pantallas
  // con `matDatepicker` lo declaran igual, componente a componente.
  providers: [provideNativeDateAdapter()],
  templateUrl: './tarjetas-panel.component.html',
  styleUrl: './tarjetas-panel.component.css',
})
export class TarjetasPanelComponent {
  private readonly srv = inject(TarjetasService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns: ColumnDefinition[] = [
    { name: 'identification_number', header: 'Número de Identificación', type: 'text', sortable: true, filterable: true },
    { name: 'card_number', header: 'Número Tarjeta', type: 'text', sortable: true, filterable: true },
    { name: 'origen', header: 'Origen', type: 'text', sortable: false, filterable: false, width: '130px' },
    { name: 'creado_por', header: 'Creado / cargado por', type: 'custom', sortable: false, filterable: false },
    { name: 'created_at', header: 'Fecha de creación', type: 'date', sortable: true, filterable: false },
    { name: 'import_batch_id', header: 'Lote', type: 'custom', sortable: false, filterable: false, width: '90px' },
    // La tabla pinta esta columna con `#actionsTemplate` (un ContentChild por nombre), no
    // con `appCellTemplate`: solo la reconoce si la columna se llama exactamente 'actions'.
    { name: 'actions', header: 'Acciones', type: 'custom', sortable: false, filterable: false, width: '100px' },
  ];

  // ── Estado del listado ──────────────────────────────────────────────────

  readonly data = signal<Tarjeta[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly tamanoPagina = signal(50);
  readonly isLoading = signal(false);
  readonly exportando = signal(false);

  readonly busqueda = signal<string>('');
  readonly desde = signal<Date | null>(null);
  readonly hasta = signal<Date | null>(null);
  readonly origen = signal<string>('');
  readonly loteId = signal<number | null>(null);
  readonly orden = signal<{ campo: string; direccion: 'asc' | 'desc' }>({ campo: 'id', direccion: 'desc' });

  readonly hayFiltros = computed(() =>
    !!this.busqueda() || !!this.desde() || !!this.hasta() || !!this.origen() || this.loteId() != null);

  constructor() {
    this.cargar();
  }

  // ── Carga ───────────────────────────────────────────────────────────────

  private filtro(): FiltroTarjetas {
    return {
      search: this.busqueda() || null,
      desde: this.aIso(this.desde()),
      hasta: this.aIso(this.hasta()),
      lote_id: this.loteId(),
      origen: this.origen() || null,
    };
  }

  cargar(): void {
    this.isLoading.set(true);
    const o = this.orden();
    this.srv.consultar(this.filtro(), this.pagina(), this.tamanoPagina(), o.campo, o.direccion).subscribe({
      next: (p) => {
        this.data.set(p.content);
        this.total.set(p.total_elements);
        this.isLoading.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.isLoading.set(false);
        this.snackBar.open(this.mensaje(e, 'No se pudieron cargar las tarjetas'), 'Cerrar', { duration: 4000 });
      },
    });
  }

  // ── Filtros / tabla ─────────────────────────────────────────────────────

  alBuscar(texto: string): void {
    if ((texto ?? '') === this.busqueda()) return;
    this.busqueda.set(texto ?? '');
    this.pagina.set(0);
    this.cargar();
  }

  alCambiarPagina(evento: { page: number; size: number }): void {
    this.pagina.set(evento.page);
    this.tamanoPagina.set(evento.size);
    this.cargar();
  }

  alOrdenar(evento: { active: string; direction: 'asc' | 'desc' | '' }): void {
    this.orden.set(evento.direction
      ? { campo: CAMPO_ORDEN[evento.active] ?? 'id', direccion: evento.direction }
      : { campo: 'id', direccion: 'desc' });
    this.pagina.set(0);
    this.cargar();
  }

  aplicarFiltros(): void {
    this.pagina.set(0);
    this.cargar();
  }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.desde.set(null);
    this.hasta.set(null);
    this.origen.set('');
    this.loteId.set(null);
    this.pagina.set(0);
    this.cargar();
  }

  // ── Exportar ────────────────────────────────────────────────────────────

  /**
   * Exporta TODO lo que cumple el filtro, no la página visible. Si hay 20.000 filas
   * filtradas y la pantalla muestra 50, el archivo trae las 20.000.
   */
  exportarExcel(): void {
    this.exportando.set(true);
    this.srv.exportarExcel(this.filtro()).subscribe({
      next: (blob) => {
        this.descargar(blob, `tarjetas_${new Date().toISOString().slice(0, 10)}.xlsx`);
        this.exportando.set(false);
        this.snackBar.open(`Exportadas ${this.total()} tarjetas`, 'Cerrar', { duration: 3000 });
      },
      error: (e: HttpErrorResponse) => {
        this.exportando.set(false);
        this.snackBar.open(this.mensaje(e, 'No se pudo generar el Excel'), 'Cerrar', { duration: 4000 });
      },
    });
  }

  // ── Carga masiva e historial ────────────────────────────────────────────

  abrirCarga(): void {
    this.dialog
      .open(DialogoCargaTarjetasComponent, { maxWidth: '96vw', disableClose: true })
      .afterClosed()
      .subscribe((r: ResultadoDialogoCargaTarjetas | undefined) => {
        if (r?.recargar) this.cargar();
      });
  }

  abrirHistorial(): void {
    this.dialog.open(DialogoHistorialCargasComponent, { maxWidth: '96vw', width: '1200px' });
  }

  // ── CRUD individual ─────────────────────────────────────────────────────

  private campos(): FieldConfig[] {
    return [
      { name: 'identification_number', label: 'Número de Identificación', type: 'text', required: true },
      { name: 'card_number', label: 'Número Tarjeta', type: 'text', required: true },
    ];
  }

  onCreate(): void {
    this.dialog.open(DynamicFormDialogComponent, {
      data: { title: 'Crear Tarjeta', fields: this.campos() } as DynamicDialogData,
    }).afterClosed().subscribe((result) => {
      if (!result) return;
      this.srv.create(result).subscribe({
        next: () => {
          this.snackBar.open('Tarjeta creada', 'Cerrar', { duration: 3000 });
          this.cargar();
        },
        // El backend valida con LAS MISMAS reglas que la carga masiva y responde
        // {error, codigo}: se muestra su mensaje, no uno genérico.
        error: (e: HttpErrorResponse) =>
          Swal.fire('No se pudo crear', this.mensaje(e, 'Verifique los datos.'), 'error'),
      });
    });
  }

  onEdit(row: Tarjeta): void {
    this.dialog.open(DynamicFormDialogComponent, {
      data: { title: 'Editar Tarjeta', fields: this.campos(), value: row } as DynamicDialogData,
    }).afterClosed().subscribe((result) => {
      if (!result) return;
      this.srv.update(row.id, result).subscribe({
        next: () => {
          this.snackBar.open('Tarjeta actualizada', 'Cerrar', { duration: 3000 });
          this.cargar();
        },
        error: (e: HttpErrorResponse) =>
          Swal.fire('No se pudo actualizar', this.mensaje(e, 'Verifique los datos.'), 'error'),
      });
    });
  }

  onDelete(row: Tarjeta): void {
    Swal.fire({
      title: '¿Eliminar tarjeta?',
      text: `Se eliminará la tarjeta ${row.card_number} de la identificación ${row.identification_number}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.srv.delete(row.id).subscribe({
        next: () => {
          this.snackBar.open('Tarjeta eliminada', 'Cerrar', { duration: 3000 });
          this.cargar();
        },
        error: (e: HttpErrorResponse) =>
          Swal.fire('No se pudo eliminar', this.mensaje(e, 'Inténtelo de nuevo.'), 'error'),
      });
    });
  }

  /** Filtra el listado por el lote de una carga concreta. */
  verLote(id: number): void {
    this.loteId.set(id);
    this.pagina.set(0);
    this.cargar();
  }

  // ── internos ────────────────────────────────────────────────────────────

  private descargar(blob: Blob, nombre: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  private aIso(fecha: Date | null): string | null {
    if (!fecha) return null;
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return null;
    const mes = `${d.getMonth() + 1}`.padStart(2, '0');
    const dia = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  private mensaje(e: HttpErrorResponse, porDefecto: string): string {
    return e.error?.error ?? e.error?.message ?? e.error?.detail ?? porDefecto;
  }
}

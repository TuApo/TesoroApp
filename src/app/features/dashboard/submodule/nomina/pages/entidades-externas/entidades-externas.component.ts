import { ChangeDetectorRef, Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import Swal from 'sweetalert2';

import { NominaService, EntidadExterna, TipoEntidadExterna } from '../../service/nomina/nomina.service';
import { EntidadExternaFormDialogComponent, TIPOS_ENTIDAD } from './entidad-externa-form-dialog.component';

type FiltroEstado = 'activas' | 'inactivas' | 'todas';

/**
 * Submódulo Nómina → Entidades Externas. Mantenimiento con borrado lógico de la
 * tabla polimórfica nomina_entidades_externas, restringido a los tipos
 * permitidos. Listar / buscar / filtrar por tipo y estado / crear / editar /
 * desactivar / reactivar. NO existe eliminación física.
 */
@Component({
  selector: 'app-entidades-externas',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './entidades-externas.component.html',
  styleUrls: ['./entidades-externas.component.css'],
})
export class EntidadesExternasComponent implements OnInit, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  displayedColumns = ['nombre', 'nit', 'codigo', 'tipo', 'activo', 'centros_costo_count', 'contratos_count', 'acciones'];
  dataSource = new MatTableDataSource<EntidadExterna>([]);
  isLoading = false;

  readonly TIPOS = TIPOS_ENTIDAD;
  readonly TIPO_LABEL: Record<string, string> =
    Object.fromEntries(TIPOS_ENTIDAD.map(t => [t.value, t.label]));

  filterTipo: TipoEntidadExterna | '' = '';   // '' = todos
  filterEstado: FiltroEstado = 'activas';
  filterSearch = '';

  private all: EntidadExterna[] = [];

  constructor(
    private nominaService: NominaService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  private estadoParam(): boolean | null {
    if (this.filterEstado === 'activas') return true;
    if (this.filterEstado === 'inactivas') return false;
    return null;
  }

  cargar(): void {
    this.isLoading = true;
    this.cdr.markForCheck();
    this.nominaService.getEntidadesExternas({
      tipo: this.filterTipo || null,
      activo: this.estadoParam(),
    }).subscribe({
      next: (data) => {
        this.all = data ?? [];
        this.aplicarFiltros();
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al cargar entidades externas', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  aplicarFiltros(): void {
    const q = (this.filterSearch || '').trim().toLowerCase();
    this.dataSource.data = this.all.filter((e) => {
      if (!q) return true;
      const blob = [e.nombre, e.nombre_comercial, e.nit, e.codigo]
        .filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    });
    if (this.paginator) this.paginator.firstPage();
    this.cdr.markForCheck();
  }

  onSearchChange(value: string): void {
    this.filterSearch = value;
    this.aplicarFiltros();
  }

  /** tipo y estado se filtran en el backend → recargar. */
  onServerFilterChange(): void {
    this.cargar();
  }

  limpiarFiltros(): void {
    this.filterSearch = '';
    this.filterTipo = '';
    this.filterEstado = 'activas';
    this.cargar();
  }

  tipoLabel(tipo: string): string {
    return this.TIPO_LABEL[tipo] ?? tipo;
  }

  /** Los conteos solo aplican a EMPRESA_USUARIA (para el resto el backend manda null). */
  aplicaConteos(e: EntidadExterna): boolean {
    return e.tipo === 'EMPRESA_USUARIA';
  }

  abrirDialogoCrear(): void {
    const ref = this.dialog.open(EntidadExternaFormDialogComponent, {
      width: '640px',
      data: { entidad: null },
    });
    ref.afterClosed().subscribe((ok) => { if (ok) this.cargar(); });
  }

  abrirDialogoEditar(entidad: EntidadExterna): void {
    const ref = this.dialog.open(EntidadExternaFormDialogComponent, {
      width: '640px',
      data: { entidad },
    });
    ref.afterClosed().subscribe((ok) => { if (ok) this.cargar(); });
  }

  async desactivar(entidad: EntidadExterna): Promise<void> {
    const base = 'La entidad no será eliminada. Solo quedará inactiva y no ' +
      'aparecerá para nuevas operaciones. Las relaciones históricas se conservan.';
    const tieneDatos = (entidad.contratos_count ?? 0) > 0 || (entidad.centros_costo_count ?? 0) > 0;
    const detalle = tieneDatos
      ? `<br><br><b>Esta entidad tiene ${entidad.contratos_count ?? 0} contratos y ` +
        `${entidad.centros_costo_count ?? 0} centros de costo asociados.</b>`
      : '';

    const res = await Swal.fire({
      title: `Desactivar “${entidad.nombre}”`,
      html: `${base}${detalle}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;

    this.nominaService.desactivarEntidadExterna(entidad.id).subscribe({
      next: () => {
        this.snackBar.open('Entidad externa desactivada', 'Cerrar', { duration: 2500 });
        this.cargar();
      },
      error: (err) => {
        this.snackBar.open(err?.error?.error ?? 'No se pudo desactivar', 'Cerrar', { duration: 3500 });
      },
    });
  }

  async reactivar(entidad: EntidadExterna): Promise<void> {
    const res = await Swal.fire({
      title: `Reactivar “${entidad.nombre}”`,
      html: 'La entidad volverá a estar disponible para nuevas operaciones de nómina, según su tipo.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, reactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3f51b5',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;

    this.nominaService.reactivarEntidadExterna(entidad.id).subscribe({
      next: () => {
        this.snackBar.open('Entidad externa reactivada', 'Cerrar', { duration: 2500 });
        this.cargar();
      },
      error: (err) => {
        this.snackBar.open(err?.error?.error ?? 'No se pudo reactivar', 'Cerrar', { duration: 3500 });
      },
    });
  }
}

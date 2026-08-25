import { ChangeDetectorRef, Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { Observable, startWith, map } from 'rxjs';

import { MatCardModule } from '@angular/material/card';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import Swal from 'sweetalert2';

import { NominaService, CentroCostoAdmin, Client } from '../../service/nomina/nomina.service';
import { CentroCostoFormDialogComponent } from './centro-costo-form-dialog.component';

type FiltroEstado = 'activos' | 'inactivos' | 'todos';

/**
 * Submódulo Nómina → Centros de Costo. Mantenimiento con borrado lógico:
 * listar / buscar / filtrar por empresa usuaria y estado / crear / editar /
 * desactivar / reactivar. NO existe eliminación física (no hay botón ni endpoint
 * de borrado). El estado y la empresa usuaria se filtran en el backend; la
 * búsqueda por texto es client-side sobre el resultado ya filtrado.
 */
@Component({
  selector: 'app-centros-costo',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatChipsModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './centros-costo.component.html',
  styleUrls: ['./centros-costo.component.css'],
})
export class CentrosCostoComponent implements OnInit, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  displayedColumns = ['codigo', 'nombre', 'empresa', 'sede', 'direccion', 'estado', 'contratos', 'acciones'];
  dataSource = new MatTableDataSource<CentroCostoAdmin>([]);
  isLoading = false;

  filterEstado: FiltroEstado = 'activos';      // por defecto: solo activos
  filterEmpresa: number | null = null;         // empresa usuaria (server-side)
  filterSearch = '';

  /** Empresas usuarias ACTIVAS para el selector de filtro. */
  empresas: Client[] = [];

  /** Filtro empresa usuaria como type-ahead: se filtra mientras se escribe. */
  empresaControl = new FormControl<any>('');
  filteredEmpresas$!: Observable<Client[]>;

  private all: CentroCostoAdmin[] = [];

  constructor(
    private nominaService: NominaService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargarEmpresas();
    this.cargar();

    // Type-ahead: mientras se escribe, se filtran las opciones de empresa usuaria.
    this.filteredEmpresas$ = this.empresaControl.valueChanges.pipe(
      startWith(''),
      map((v) => (typeof v === 'string' ? v : v?.nombre_legal || '')),
      map((nombre) => (nombre ? this._filterEmpresas(nombre) : this.empresas.slice())),
    );

    // Al elegir una empresa (o limpiar el texto) se aplica el filtro server-side.
    this.empresaControl.valueChanges.subscribe((v) => {
      if (v && typeof v === 'object' && v.id_entidad != null) {
        if (this.filterEmpresa !== v.id_entidad) {
          this.filterEmpresa = v.id_entidad;
          this.cargar();
        }
      } else if (v === '' || v == null) {
        if (this.filterEmpresa !== null) {
          this.filterEmpresa = null;
          this.cargar();
        }
      }
      // Mientras es un texto parcial (typing) solo se filtran las opciones; no se recarga.
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  private estadoParam(): boolean | null {
    if (this.filterEstado === 'activos') return true;
    if (this.filterEstado === 'inactivos') return false;
    return null; // todos
  }

  /** Empresas usuarias activas (para el filtro). El backend solo devuelve activas. */
  private cargarEmpresas(): void {
    this.nominaService.getEntidadesPorTipo('EMPRESA_USUARIA').subscribe({
      next: (data) => {
        this.empresas = data ?? [];
        // Re-dispara el valueChanges para que las opciones aparezcan ya cargadas.
        this.empresaControl.updateValueAndValidity();
        this.cdr.markForCheck();
      },
      error: () => { /* el filtro de empresa queda vacío; no bloquea la lista */ },
    });
  }

  private _filterEmpresas(nombre: string): Client[] {
    const q = nombre.toLowerCase();
    return this.empresas.filter((e) => e.nombre_legal.toLowerCase().includes(q));
  }

  /** Texto mostrado en el input tras seleccionar una empresa del autocomplete. */
  displayEmpresa(empresa: Client): string {
    return empresa && typeof empresa === 'object' ? empresa.nombre_legal : '';
  }

  cargar(): void {
    this.isLoading = true;
    this.cdr.markForCheck();
    this.nominaService.getCentrosCostoAdmin({
      empresaUsuariaId: this.filterEmpresa,
      activo: this.estadoParam(),
    }).subscribe({
      next: (data) => {
        this.all = data ?? [];
        this.aplicarFiltros();
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al cargar centros de costo', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  aplicarFiltros(): void {
    const q = (this.filterSearch || '').trim().toLowerCase();
    this.dataSource.data = this.all.filter((c) => {
      if (!q) return true;
      const blob = [c.codigo_interno, c.nombre, c.empresa_usuaria_nombre, c.sede_fisica, c.direccion]
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

  onFiltroServerChange(): void {
    // Empresa usuaria y estado se filtran en el backend → recargamos.
    this.cargar();
  }

  limpiarFiltros(): void {
    this.filterSearch = '';
    this.filterEstado = 'activos';
    this.filterEmpresa = null;
    this.empresaControl.setValue('', { emitEvent: false });
    this.cargar();
  }

  abrirDialogoCrear(): void {
    const ref = this.dialog.open(CentroCostoFormDialogComponent, {
      width: '640px',
      data: { centro: null, empresaPreseleccionada: this.filterEmpresa },
    });
    ref.afterClosed().subscribe((ok) => { if (ok) this.cargar(); });
  }

  abrirDialogoEditar(centro: CentroCostoAdmin): void {
    const ref = this.dialog.open(CentroCostoFormDialogComponent, {
      width: '640px',
      data: { centro, empresaPreseleccionada: null },
    });
    ref.afterClosed().subscribe((ok) => { if (ok) this.cargar(); });
  }

  async desactivar(centro: CentroCostoAdmin): Promise<void> {
    const base = 'El centro de costo no será eliminado. Solo quedará inactivo y no ' +
      'aparecerá para nuevas operaciones. Los contratos existentes conservarán su relación.';
    const detalle = centro.contratos_count > 0
      ? `<br><br><b>Este centro de costo tiene ${centro.contratos_count} contratos asociados.</b>`
      : '';

    const res = await Swal.fire({
      title: `Desactivar “${centro.nombre}”`,
      html: `${base}${detalle}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;

    this.nominaService.desactivarCentroCosto(centro.id_ceco).subscribe({
      next: () => {
        this.snackBar.open('Centro de costo desactivado', 'Cerrar', { duration: 2500 });
        this.cargar();
      },
      error: (err) => {
        const msg = err?.error?.error ?? 'No se pudo desactivar el centro de costo';
        this.snackBar.open(msg, 'Cerrar', { duration: 3500 });
      },
    });
  }

  async reactivar(centro: CentroCostoAdmin): Promise<void> {
    const res = await Swal.fire({
      title: `Reactivar “${centro.nombre}”`,
      html: 'El centro de costo volverá a estar disponible para nuevas operaciones de nómina.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, reactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3f51b5',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;

    this.nominaService.reactivarCentroCosto(centro.id_ceco).subscribe({
      next: () => {
        this.snackBar.open('Centro de costo reactivado', 'Cerrar', { duration: 2500 });
        this.cargar();
      },
      error: (err) => {
        const msg = err?.error?.error ?? 'No se pudo reactivar el centro de costo';
        this.snackBar.open(msg, 'Cerrar', { duration: 3500 });
      },
    });
  }
}

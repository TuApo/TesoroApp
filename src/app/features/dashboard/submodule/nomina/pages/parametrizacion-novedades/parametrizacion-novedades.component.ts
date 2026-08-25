import { ChangeDetectorRef, Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NominaService, ConceptoNomina } from '../../service/nomina/nomina.service';
import { ConceptoFormDialogComponent } from './concepto-form-dialog.component';

@Component({
  selector: 'app-parametrizacion-novedades',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
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
    MatSlideToggleModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './parametrizacion-novedades.component.html',
  styleUrls: ['./parametrizacion-novedades.component.css'],
})
export class ParametrizacionNovedadesComponent implements OnInit, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  displayedColumns = ['codigo', 'descripcion', 'abreviatura', 'naturaleza', 'unidad', 'afecta_ibc', 'activo', 'acciones'];
  dataSource = new MatTableDataSource<ConceptoNomina>([]);
  isLoading = false;

  filterUnidad = '';
  filterNaturaleza = '';
  filterAgrupador = '';
  filterSearch = '';

  /** Agrupador: super-categoría de reporte (V29). El valor '' = todos,
   *  'SIN' = sin agrupar (agrupador NULL en BD). */
  readonly AGRUPADOR_LABELS: Record<string, string> = {
    AUSENCIAS: 'Ausencias',
    INCAPACIDADES: 'Incapacidades',
    EXTRAS_Y_BONIFICACIONES: 'Extras y Bonificaciones',
  };

  readonly UNIDAD_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    DIA:   { label: 'Día',   icon: 'today',        color: 'unidad-dia' },
    HORA:  { label: 'Hora',  icon: 'schedule',     color: 'unidad-hora' },
    VALOR: { label: 'Valor', icon: 'attach_money', color: 'unidad-valor' },
  };

  readonly NATURALEZA_LABELS: Record<string, { label: string; color: string }> = {
    DEVENGO:          { label: 'Devengo',          color: 'nat-devengo' },
    DEDUCCION:        { label: 'Deducción',         color: 'nat-deduccion' },
    APORTE_EMPLEADO:  { label: 'Aporte Empleado',   color: 'nat-aporte-emp' },
    APORTE_EMPLEADOR: { label: 'Aporte Empleador',  color: 'nat-aporte-emp' },
    PROVISION:        { label: 'Provisión',         color: 'nat-provision' },
    OTRO:             { label: 'Otro',              color: 'nat-otro' },
  };

  private allConceptos: ConceptoNomina[] = [];

  constructor(
    private nominaService: NominaService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargarConceptos();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  cargarConceptos(): void {
    this.isLoading = true;
    this.cdr.markForCheck();
    this.nominaService.getConceptos({}).subscribe({
      next: (data) => {
        this.allConceptos = data ?? [];
        this.aplicarFiltros();
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al cargar conceptos', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  aplicarFiltros(): void {
    const q = (this.filterSearch || '').trim().toLowerCase();
    const u = this.filterUnidad || '';
    const n = this.filterNaturaleza || '';
    const g = this.filterAgrupador || '';
    this.dataSource.data = this.allConceptos.filter(c => {
      if (u && c.unidad !== u) return false;
      if (n && c.naturaleza !== n) return false;
      if (g) {
        if (g === 'SIN') { if (c.agrupador) return false; }
        else if (c.agrupador !== g) return false;
      }
      if (q) {
        const blob = [
          c.codigo, c.descripcion, c.abreviatura,
          c.naturaleza, c.unidad, c.agrupador,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    if (this.paginator) this.paginator.firstPage();
    this.cdr.markForCheck();
  }

  onSearchChange(value: string): void {
    this.filterSearch = value;
    this.aplicarFiltros();
  }

  abrirDialogoCrear(): void {
    const ref = this.dialog.open(ConceptoFormDialogComponent, {
      width: '560px',
      data: { concepto: null },
    });
    ref.afterClosed().subscribe((resultado) => {
      if (resultado) this.cargarConceptos();
    });
  }

  abrirDialogoEditar(concepto: ConceptoNomina): void {
    const ref = this.dialog.open(ConceptoFormDialogComponent, {
      width: '560px',
      data: { concepto },
    });
    ref.afterClosed().subscribe((resultado) => {
      if (resultado) this.cargarConceptos();
    });
  }

  toggleActivo(concepto: ConceptoNomina): void {
    const nuevoEstado = !concepto.activo;
    this.nominaService.actualizarConcepto(concepto.id_concepto!, { activo: nuevoEstado }).subscribe({
      next: () => {
        concepto.activo = nuevoEstado;
        this.snackBar.open(
          `Novedad ${nuevoEstado ? 'activada' : 'desactivada'}`,
          'Cerrar',
          { duration: 2000 }
        );
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al actualizar estado', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  limpiarFiltros(): void {
    this.filterUnidad = '';
    this.filterNaturaleza = '';
    this.filterAgrupador = '';
    this.filterSearch = '';
    this.aplicarFiltros();
  }

  contarPor(campo: keyof ConceptoNomina, valor: any): number {
    return this.dataSource.data.filter(c => c[campo] === valor).length;
  }
}

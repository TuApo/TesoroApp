import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
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

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
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
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './parametrizacion-novedades.component.html',
  styleUrls: ['./parametrizacion-novedades.component.css'],
})
export class ParametrizacionNovedadesComponent implements OnInit {
  /** Conceptos que pasan los filtros de unidad / naturaleza / agrupador. */
  conceptos: ConceptoNomina[] = [];
  isLoading = false;

  // La búsqueda por texto, el orden y los filtros por columna los da la tabla estándar.
  filterUnidad = '';
  filterNaturaleza = '';
  filterAgrupador = '';

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

  readonly columnas: ColumnaTabla<ConceptoNomina>[] = [
    { id: 'codigo', header: 'Código', valor: (c) => c.codigo, tarjeta: 'subtitulo' },
    { id: 'descripcion', header: 'Descripción', valor: (c) => c.descripcion, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'abreviatura', header: 'Abreviatura', valor: (c) => c.abreviatura ?? '', prioridad: 2, tarjeta: 'meta' },
    { id: 'naturaleza', header: 'Naturaleza', tarjeta: 'badge',
      valor: (c) => this.NATURALEZA_LABELS[c.naturaleza]?.label ?? c.naturaleza },
    { id: 'unidad', header: 'Unidad', tarjeta: 'badge',
      valor: (c) => this.UNIDAD_LABELS[c.unidad]?.label ?? c.unidad },
    { id: 'afecta_ibc', header: 'Afecta IBC', align: 'center', prioridad: 2, tarjeta: 'meta',
      valor: (c) => c.afecta_ibc },
    { id: 'activo', header: 'Estado', align: 'center', interactiva: true, copiable: false, tarjeta: 'meta',
      valor: (c) => (c.activo ? 'Activo' : 'Inactivo') },
  ];

  readonly idConcepto = (c: ConceptoNomina, i: number) => c.id_concepto ?? `i${i}`;
  readonly claseFila = (c: ConceptoNomina) => (c.activo ? '' : 'te-fila--atenuada');

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
    const u = this.filterUnidad || '';
    const n = this.filterNaturaleza || '';
    const g = this.filterAgrupador || '';
    this.conceptos = this.allConceptos.filter(c => {
      if (u && c.unidad !== u) return false;
      if (n && c.naturaleza !== n) return false;
      if (g) {
        if (g === 'SIN') { if (c.agrupador) return false; }
        else if (c.agrupador !== g) return false;
      }
      return true;
    });
    this.cdr.markForCheck();
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
        // Arreglo nuevo: la tabla estándar solo recalcula cuando cambia la referencia.
        this.conceptos = [...this.conceptos];
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
    this.aplicarFiltros();
  }

  contarPor(campo: keyof ConceptoNomina, valor: any): number {
    return this.conceptos.filter(c => c[campo] === valor).length;
  }
}

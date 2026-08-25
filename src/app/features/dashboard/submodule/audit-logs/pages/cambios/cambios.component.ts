import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject, DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';

import { AuditLogsService } from '../../services/audit-logs.service';
import { ChangeLogEntry, ACTION_LABELS, ACTION_COLORS } from '../../models/audit-logs.models';

const ACCIONES = ['CREATE', 'UPDATE', 'DELETE', 'VIEW'];

const MODULOS = [
  'CONTRATACION', 'AFILIACIONES', 'DOCUMENTOS', 'TESORERIA',
  'NOMINA', 'VACANTES', 'HR', 'ROBOTS', 'ADMIN', 'LEGAL'
];

@Component({
  selector: 'app-cambios',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatTableModule, MatPaginatorModule, MatButtonModule, MatIconModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatTooltipModule,
    MatChipsModule, MatProgressSpinnerModule, MatCardModule
  ],
  templateUrl: './cambios.component.html',
  styleUrl: './cambios.component.css'
})
export class CambiosComponent implements OnInit {
  private svc = inject(AuditLogsService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private bp = inject(BreakpointObserver);

  isMobile = false;
  cambios: ChangeLogEntry[] = [];
  totalElements = 0;
  cargando = false;
  pageSize = 50;
  pageIndex = 0;

  readonly acciones = ACCIONES;
  readonly modulos = MODULOS;
  readonly actionLabels = ACTION_LABELS;
  readonly actionColors = ACTION_COLORS;

  filtroAccion = new FormControl<string | null>(null);
  filtroModulo = new FormControl<string | null>(null);
  filtroEntidad = new FormControl('');
  filtroEntidadId = new FormControl('');

  readonly displayedColumns = ['occurredAt', 'actor', 'modulo', 'entidad', 'accion', 'campo', 'descripcion', 'detalle'];

  expandedRow: ChangeLogEntry | null = null;

  ngOnInit() {
    this.bp.observe('(max-width: 768px)').pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => { this.isMobile = r.matches; this.cdr.markForCheck(); });

    this.cargar();
    this.filtroAccion.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.pageIndex = 0; this.cargar(); });
    this.filtroModulo.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.pageIndex = 0; this.cargar(); });
    this.filtroEntidad.valueChanges.pipe(debounceTime(500), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.pageIndex = 0; this.cargar(); });
    this.filtroEntidadId.valueChanges.pipe(debounceTime(500), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.pageIndex = 0; this.cargar(); });
  }

  cargar() {
    this.cargando = true;
    this.svc.getCambios({
      accion: this.filtroAccion.value ?? undefined,
      modulo: this.filtroModulo.value ?? undefined,
      entidad: this.filtroEntidad.value || undefined,
      entidadId: this.filtroEntidadId.value || undefined,
      page: this.pageIndex,
      size: this.pageSize
    }).subscribe({
      next: r => {
        this.cambios = r.content;
        this.totalElements = r.total_elements;
        this.cargando = false;
        this.cdr.markForCheck();
      },
      error: () => { this.cargando = false; this.cdr.markForCheck(); }
    });
  }

  onPage(e: PageEvent) {
    this.pageIndex = e.pageIndex;
    this.pageSize = e.pageSize;
    this.cargar();
  }

  limpiar() {
    this.filtroAccion.setValue(null);
    this.filtroModulo.setValue(null);
    this.filtroEntidad.setValue('');
    this.filtroEntidadId.setValue('');
    this.pageIndex = 0;
    this.cargar();
  }

  toggleDetalle(row: ChangeLogEntry) {
    this.expandedRow = this.expandedRow === row ? null : row;
  }

  labelAccion(a: string) { return this.actionLabels[a] ?? a; }
  colorAccion(a: string) { return this.actionColors[a] ?? '#9e9e9e'; }
  formatDate(epoch: number | string): string {
    if (epoch == null) return '—';
    const d = typeof epoch === 'string'
      ? new Date(epoch)
      : new Date(epoch > 3e10 ? epoch : epoch * 1000);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO');
  }
  hasDetalle(c: ChangeLogEntry) { return c.valor_anterior || c.valor_nuevo; }
}

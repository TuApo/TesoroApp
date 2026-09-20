import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject, DestroyRef, TemplateRef, viewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent,
} from '../../../../../../shared/components/tabla-estandar';

import { AuditLogsService } from '../../services/audit-logs.service';
import { ChangeLogEntry, ACTION_LABELS, ACTION_COLORS } from '../../models/audit-logs.models';

const ACCIONES = ['CREATE', 'UPDATE', 'DELETE', 'VIEW'];

/** occurred_at llega en segundos (o milisegundos, o ISO): Date para ordenar/copiar. */
function aFechaEpoch(epoch: number | string): Date | null {
  if (epoch == null) return null;
  const d = typeof epoch === 'string'
    ? new Date(epoch)
    : new Date(epoch > 3e10 ? epoch : epoch * 1000);
  return isNaN(d.getTime()) ? null : d;
}

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
    MatButtonModule, MatIconModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatTooltipModule,
    MatChipsModule, MatCardModule, MatDialogModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './cambios.component.html',
  styleUrl: './cambios.component.css'
})
export class CambiosComponent implements OnInit {
  private svc = inject(AuditLogsService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);

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

  // Tabla estándar en modo servidor: el backend pagina y filtra, pero no
  // ordena ni busca texto libre (por eso columnas sin orden y sin buscador).
  readonly columnas: ColumnaTabla<ChangeLogEntry>[] = [
    { id: 'occurredAt', header: 'Fecha', valor: (c) => aFechaEpoch(c.occurred_at),
      formato: (c) => this.formatDate(c.occurred_at), copiaTexto: (c) => this.formatDate(c.occurred_at),
      ordenable: false, tarjeta: 'meta', minAncho: '140px' },
    { id: 'actor', header: 'Actor', valor: (c) => c.actor_email ?? '', ordenable: false, tarjeta: 'titulo' },
    { id: 'modulo', header: 'Módulo', valor: (c) => c.modulo, ordenable: false, tarjeta: 'meta' },
    { id: 'entidad', header: 'Entidad', ordenable: false, tarjeta: 'subtitulo',
      valor: (c) => (c.entidad_id ? `${c.entidad} · ${c.entidad_id}` : c.entidad) },
    { id: 'accion', header: 'Acción', valor: (c) => this.labelAccion(c.accion), ordenable: false, tarjeta: 'badge',
      badge: (c) => ({ texto: this.labelAccion(c.accion), color: this.colorAccion(c.accion),
        fondo: this.colorAccion(c.accion) + '22' }) },
    { id: 'campo', header: 'Campo', valor: (c) => c.campo ?? '', ordenable: false, prioridad: 2, tarjeta: 'meta' },
    { id: 'descripcion', header: 'Descripción', valor: (c) => c.descripcion ?? '',
      formato: (c) => c.descripcion ?? '—', ordenable: false, prioridad: 2, tarjeta: 'cuerpo', minAncho: '200px' },
  ];

  readonly idCambio = (c: ChangeLogEntry) => c.id;

  /** La tabla estándar recuerda su página: se le reinicia cuando un filtro vuelve a la 1. */
  private readonly tabla = viewChild(TablaEstandarComponent);
  /** Antes/después de un cambio: antes era una fila expandible, ahora un diálogo. */
  private readonly detalleTpl = viewChild<TemplateRef<unknown>>('detalleTpl');

  ngOnInit() {
    this.cargar();
    this.filtroAccion.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.irAPrimeraPagina(); this.cargar(); });
    this.filtroModulo.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.irAPrimeraPagina(); this.cargar(); });
    this.filtroEntidad.valueChanges.pipe(debounceTime(500), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.irAPrimeraPagina(); this.cargar(); });
    this.filtroEntidadId.valueChanges.pipe(debounceTime(500), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.irAPrimeraPagina(); this.cargar(); });
  }

  cargar() {
    this.cargando = true;
    this.cdr.markForCheck();
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

  onPage(e: { pagina: number; porPagina: number }) {
    this.pageIndex = e.pagina;
    this.pageSize = e.porPagina;
    this.cargar();
  }

  limpiar() {
    this.filtroAccion.setValue(null);
    this.filtroModulo.setValue(null);
    this.filtroEntidad.setValue('');
    this.filtroEntidadId.setValue('');
    this.irAPrimeraPagina();
    this.cargar();
  }

  private irAPrimeraPagina() {
    this.pageIndex = 0;
    this.tabla()?.pagina.set(0);
  }

  verDetalle(row: ChangeLogEntry) {
    const tpl = this.detalleTpl();
    if (!tpl) return;
    this.dialog.open(tpl, { data: row, width: '900px', maxWidth: '96vw' });
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

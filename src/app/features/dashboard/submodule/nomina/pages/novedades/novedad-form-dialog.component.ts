import { ChangeDetectorRef, Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';
import Swal from 'sweetalert2';

import {
  Client, ConceptoNomina, Empleado, NominaService, NovedadPeriodo, PeriodoNominaDto,
} from '../../service/nomina/nomina.service';

export interface NovedadFormDialogData {
  cliente: Client;
  periodo: PeriodoNominaDto;
  novedad?: NovedadPeriodo;
}

/**
 * Formulario crear/editar de una novedad del periodo. El empleado se busca
 * dentro de la empresa usuaria del contexto; el concepto sale del catálogo
 * activo y su UNIDAD decide los campos a diligenciar (horas, rango de días
 * o valor). En edición el empleado queda bloqueado (cambiarlo = otra novedad).
 */
@Component({
  selector: 'app-novedad-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatAutocompleteModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <div class="dialog-header">
      <mat-icon class="dialog-icon">{{ isEditing ? 'edit_note' : 'post_add' }}</mat-icon>
      <div class="dialog-titles">
        <h2 mat-dialog-title>{{ isEditing ? 'Editar Novedad' : 'Nueva Novedad' }}</h2>
        <p class="dialog-subtitle">
          {{ data.cliente.nombre_legal }} · {{ data.periodo.descripcion }}
        </p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <mat-dialog-content>
      <div class="form-grid">

        <!-- Empleado -->
        <mat-form-field appearance="outline" class="span-2" *ngIf="!isEditing">
          <mat-label>Empleado</mat-label>
          <mat-icon matPrefix>person_search</mat-icon>
          <input type="text" matInput [formControl]="empleadoCtrl" [matAutocomplete]="autoE"
                 placeholder="Busque por nombre o documento...">
          <mat-autocomplete #autoE="matAutocomplete" [displayWith]="displayEmpleado">
            <mat-option *ngIf="buscandoEmpleados" disabled class="opt-loading">
              <mat-spinner diameter="18"></mat-spinner> Buscando...
            </mat-option>
            <mat-option *ngFor="let e of empleados$ | async" [value]="e">
              <div class="opt-two-lines">
                <span>{{ e.nombre_completo }}</span>
                <small>{{ e.tipo_documento }} {{ e.numero_documento }}</small>
              </div>
            </mat-option>
          </mat-autocomplete>
          <mat-hint>Solo empleados con contrato en la empresa seleccionada</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="span-2" *ngIf="isEditing">
          <mat-label>Empleado</mat-label>
          <mat-icon matPrefix>person</mat-icon>
          <input matInput [value]="(data.novedad?.nombre_empleado || '') + ' — ' + (data.novedad?.documento || '')" disabled>
        </mat-form-field>

        <!-- Concepto -->
        <mat-form-field appearance="outline" class="span-2">
          <mat-label>Concepto de novedad</mat-label>
          <mat-icon matPrefix>category</mat-icon>
          <input type="text" matInput [formControl]="conceptoCtrl" [matAutocomplete]="autoK"
                 placeholder="Busque por código o descripción...">
          <mat-autocomplete #autoK="matAutocomplete" [displayWith]="displayConcepto">
            <mat-option *ngFor="let c of conceptosFiltrados$ | async" [value]="c">
              <div class="opt-concepto">
                <span class="opt-codigo">{{ c.codigo }}</span>
                <span class="opt-desc">{{ c.descripcion }}</span>
                <span class="opt-badge" [class.devengo]="c.naturaleza === 'DEVENGO'"
                      [class.deduccion]="c.naturaleza === 'DEDUCCION'">{{ c.naturaleza }}</span>
              </div>
            </mat-option>
          </mat-autocomplete>
          <mat-hint *ngIf="conceptoSel">
            Unidad: {{ etiquetaUnidad }} · {{ conceptoSel!.naturaleza }}
            <ng-container *ngIf="conceptoSel!.afecta_ibc"> · afecta IBC</ng-container>
          </mat-hint>
        </mat-form-field>

        <!-- Campos según la unidad del concepto -->
        <ng-container *ngIf="unidad === 'HORA'">
          <mat-form-field appearance="outline">
            <mat-label>Cantidad de horas</mat-label>
            <mat-icon matPrefix>schedule</mat-icon>
            <input matInput type="number" min="0.25" step="0.25" [formControl]="cantidadCtrl">
            <mat-error *ngIf="cantidadCtrl.hasError('required')">Ingrese las horas</mat-error>
            <mat-error *ngIf="cantidadCtrl.hasError('min')">Debe ser mayor que cero</mat-error>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Fecha (opcional)</mat-label>
            <input matInput [matDatepicker]="dp1" [formControl]="fechaInicioCtrl">
            <mat-datepicker-toggle matSuffix [for]="dp1"></mat-datepicker-toggle>
            <mat-datepicker #dp1></mat-datepicker>
            <mat-hint>Día en que ocurrió la novedad</mat-hint>
          </mat-form-field>
        </ng-container>

        <ng-container *ngIf="unidad === 'DIA'">
          <mat-form-field appearance="outline">
            <mat-label>Fecha inicio</mat-label>
            <input matInput [matDatepicker]="dp2" [formControl]="fechaInicioCtrl">
            <mat-datepicker-toggle matSuffix [for]="dp2"></mat-datepicker-toggle>
            <mat-datepicker #dp2></mat-datepicker>
            <mat-error *ngIf="fechaInicioCtrl.hasError('required')">Obligatoria</mat-error>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Fecha fin</mat-label>
            <input matInput [matDatepicker]="dp3" [formControl]="fechaFinCtrl" [min]="fechaInicioCtrl.value">
            <mat-datepicker-toggle matSuffix [for]="dp3"></mat-datepicker-toggle>
            <mat-datepicker #dp3></mat-datepicker>
            <mat-error *ngIf="fechaFinCtrl.hasError('required')">Obligatoria</mat-error>
          </mat-form-field>
          <div class="dias-info span-2" *ngIf="diasCalculados > 0">
            <mat-icon>event_available</mat-icon>
            <span><strong>{{ diasCalculados }}</strong> día(s) de novedad
              <em *ngIf="fueraDePeriodo"> — el rango se sale del periodo seleccionado; el cálculo tomará el tramo que corresponda</em>
            </span>
          </div>
        </ng-container>

        <ng-container *ngIf="unidad === 'VALOR'">
          <mat-form-field appearance="outline" class="span-2">
            <mat-label>Valor</mat-label>
            <mat-icon matPrefix>attach_money</mat-icon>
            <input matInput type="number" min="1" [formControl]="valorCtrl" placeholder="0">
            <mat-hint *ngIf="valorCtrl.value">{{ valorCtrl.value | currency:'COP':'symbol-narrow':'1.0-0' }}</mat-hint>
            <mat-error *ngIf="valorCtrl.hasError('required')">Ingrese el valor</mat-error>
            <mat-error *ngIf="valorCtrl.hasError('min')">Debe ser mayor que cero</mat-error>
          </mat-form-field>
        </ng-container>

        <!-- Observación -->
        <mat-form-field appearance="outline" class="span-2">
          <mat-label>Observación (opcional)</mat-label>
          <textarea matInput rows="2" [formControl]="observacionCtrl"
                    placeholder="Detalle o soporte de la novedad..."></textarea>
        </mat-form-field>
      </div>

      <!-- Resumen de lo que se guardará -->
      <div class="resumen" *ngIf="resumen">
        <mat-icon>task_alt</mat-icon>
        <span [innerHTML]="resumen"></span>
      </div>
    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="guardando">Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="guardando || !puedeGuardar">
        <mat-spinner *ngIf="guardando" diameter="18" class="btn-spinner"></mat-spinner>
        {{ guardando ? 'Guardando...' : (isEditing ? 'Guardar cambios' : 'Registrar novedad') }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex; align-items: center; gap: 14px;
      padding: 20px 24px 14px;
    }
    .dialog-icon {
      width: 44px; height: 44px; font-size: 26px;
      display: flex; align-items: center; justify-content: center;
      background: #f0fdfa; color: #0d9488; border-radius: 12px;
      flex-shrink: 0;
    }
    .dialog-titles h2 { margin: 0; padding: 0; font-size: 1.15rem; }
    .dialog-subtitle { margin: 2px 0 0; color: #64748b; font-size: .82rem; }

    mat-dialog-content { padding-top: 20px !important; }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 16px;
    }
    .span-2 { grid-column: 1 / -1; }

    .opt-two-lines { display: flex; flex-direction: column; line-height: 1.25; padding: 2px 0; }
    .opt-two-lines small { color: #94a3b8; font-size: .75rem; }
    .opt-loading { display: flex; align-items: center; gap: 8px; }

    .opt-concepto { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .opt-codigo {
      font-family: monospace; font-weight: 700; font-size: .78rem;
      background: #f0fdfa; color: #0f766e; border: 1px solid #99f6e4;
      padding: 1px 6px; border-radius: 5px; flex-shrink: 0;
    }
    .opt-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .opt-badge {
      font-size: .62rem; font-weight: 700; text-transform: uppercase;
      background: #f3f4f6; color: #4b5563;
      padding: 2px 7px; border-radius: 10px; flex-shrink: 0;
    }
    .opt-badge.devengo   { background: #e8f5e9; color: #2e7d32; }
    .opt-badge.deduccion { background: #ffebee; color: #c62828; }

    .dias-info {
      display: flex; align-items: center; gap: 8px;
      background: #f0fdfa; border: 1px solid #99f6e4; color: #0f766e;
      border-radius: 10px; padding: 8px 14px; margin: 2px 0 14px;
      font-size: .85rem;
    }
    .dias-info em { font-style: normal; color: #b45309; }
    .dias-info mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .resumen {
      display: flex; align-items: center; gap: 10px;
      background: #f8fafc; border: 1px dashed #cbd5e1;
      border-radius: 10px; padding: 10px 14px; margin-top: 4px;
      color: #334155; font-size: .85rem;
    }
    .resumen mat-icon { color: #0d9488; font-size: 20px; width: 20px; height: 20px; }

    mat-dialog-actions { padding: 14px 24px !important; gap: 8px; }
    .btn-spinner { display: inline-block; margin-right: 8px; }
  `],
})
export class NovedadFormDialogComponent implements OnInit {

  empleadoCtrl = new FormControl<Empleado | string | null>(null);
  conceptoCtrl = new FormControl<ConceptoNomina | string | null>(null);
  cantidadCtrl = new FormControl<number | null>(null);
  fechaInicioCtrl = new FormControl<Date | null>(null);
  fechaFinCtrl = new FormControl<Date | null>(null);
  valorCtrl = new FormControl<number | null>(null);
  observacionCtrl = new FormControl<string>('');

  empleados$!: Observable<Empleado[]>;
  conceptosFiltrados$!: Observable<ConceptoNomina[]>;
  buscandoEmpleados = false;
  guardando = false;

  private conceptos: ConceptoNomina[] = [];

  constructor(
    public dialogRef: MatDialogRef<NovedadFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: NovedadFormDialogData,
    private nominaService: NominaService,
    private cdr: ChangeDetectorRef,
  ) {}

  get isEditing(): boolean { return !!this.data.novedad?.id; }

  ngOnInit(): void {
    // Empleados: búsqueda server-side dentro de la empresa usuaria del contexto.
    this.empleados$ = this.empleadoCtrl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(v => {
        const q = typeof v === 'string' ? v.trim() : '';
        if (!q || q.length < 2) return of([] as Empleado[]);
        this.buscandoEmpleados = true;
        this.cdr.markForCheck();
        return this.nominaService.getEmpleados({
          q, cliente_id: this.data.cliente.id_entidad,
          solo_con_contrato: 1, page_size: 15,
        }).pipe(
          map(res => res?.results || []),
          catchError(() => of([] as Empleado[])),
        );
      }),
      map(list => { this.buscandoEmpleados = false; this.cdr.markForCheck(); return list; }),
    );

    // Conceptos: catálogo activo, filtrado en cliente.
    this.nominaService.getConceptosActivos().subscribe(cs => {
      this.conceptos = cs || [];
      this.conceptoCtrl.updateValueAndValidity({ emitEvent: true });
      this.cdr.markForCheck();
    });
    this.conceptosFiltrados$ = this.conceptoCtrl.valueChanges.pipe(
      startWith(''),
      map(v => typeof v === 'string' ? v : v ? `${v.codigo} ${v.descripcion}` : ''),
      map(q => {
        const f = (q || '').toLowerCase();
        const base = this.conceptos;
        if (!f) return base.slice(0, 80);
        return base.filter(c =>
          c.codigo.toLowerCase().includes(f) ||
          (c.descripcion || '').toLowerCase().includes(f)).slice(0, 80);
      }),
    );

    // Al cambiar el concepto se ajustan los validadores según su unidad.
    this.conceptoCtrl.valueChanges.subscribe(() => this.ajustarValidadores());

    if (this.isEditing) this.precargar(this.data.novedad!);
  }

  private precargar(n: NovedadPeriodo): void {
    const concepto = this.conceptos.find(c => c.codigo === n.codigo_concepto) || {
      codigo: n.codigo_concepto,
      descripcion: n.descripcion_concepto || n.codigo_concepto,
      naturaleza: (n.naturaleza as any) || 'OTRO',
      unidad: (n.unidad as any) || 'VALOR',
      afecta_ibc: false,
      activo: true,
    } as ConceptoNomina;
    this.conceptoCtrl.setValue(concepto);
    this.cantidadCtrl.setValue(n.cantidad ?? null);
    this.valorCtrl.setValue(n.valor ?? null);
    this.observacionCtrl.setValue(n.observacion || '');
    if (n.fecha_inicio) this.fechaInicioCtrl.setValue(this.parseFecha(n.fecha_inicio));
    if (n.fecha_fin) this.fechaFinCtrl.setValue(this.parseFecha(n.fecha_fin));
    this.ajustarValidadores();
  }

  // ── Selecciones / derivados ──────────────────────────────────────────────
  get empleadoSel(): Empleado | null {
    const v = this.empleadoCtrl.value;
    return v && typeof v === 'object' ? v : null;
  }

  get conceptoSel(): ConceptoNomina | null {
    const v = this.conceptoCtrl.value;
    return v && typeof v === 'object' ? v : null;
  }

  get unidad(): 'HORA' | 'DIA' | 'VALOR' | null {
    return this.conceptoSel?.unidad || null;
  }

  get etiquetaUnidad(): string {
    switch (this.unidad) {
      case 'HORA': return 'horas';
      case 'DIA': return 'días (rango de fechas)';
      case 'VALOR': return 'valor monetario';
      default: return '';
    }
  }

  get diasCalculados(): number {
    const ini = this.fechaInicioCtrl.value, fin = this.fechaFinCtrl.value;
    if (!ini || !fin || fin < ini) return 0;
    return Math.round((fin.getTime() - ini.getTime()) / 86400000) + 1;
  }

  /** true si el rango de fechas se sale del periodo elegido (solo informativo). */
  get fueraDePeriodo(): boolean {
    const ini = this.fechaInicioCtrl.value, fin = this.fechaFinCtrl.value;
    if (!ini || !fin) return false;
    const pIni = this.parseFecha(this.data.periodo.fecha_inicio);
    const pFin = this.parseFecha(this.data.periodo.fecha_fin);
    return (pIni != null && ini < pIni) || (pFin != null && fin > pFin);
  }

  get puedeGuardar(): boolean {
    const empleadoOk = this.isEditing || !!this.empleadoSel;
    if (!empleadoOk || !this.conceptoSel) return false;
    switch (this.unidad) {
      case 'HORA': return (this.cantidadCtrl.value || 0) > 0;
      case 'DIA': return !!this.fechaInicioCtrl.value && !!this.fechaFinCtrl.value && this.diasCalculados > 0;
      case 'VALOR': return (this.valorCtrl.value || 0) > 0;
      default: return false;
    }
  }

  get resumen(): string {
    if (!this.puedeGuardar) return '';
    const emp = this.isEditing
      ? (this.data.novedad?.nombre_empleado || this.data.novedad?.documento || '')
      : (this.empleadoSel?.nombre_completo || '');
    const c = this.conceptoSel!;
    let detalle = '';
    switch (this.unidad) {
      case 'HORA': detalle = `<b>${this.cantidadCtrl.value} hora(s)</b>`; break;
      case 'DIA': detalle = `<b>${this.diasCalculados} día(s)</b>`; break;
      case 'VALOR': {
        const v = Number(this.valorCtrl.value || 0);
        detalle = `<b>$${v.toLocaleString('es-CO')}</b>`;
        break;
      }
    }
    return `Se registrará <b>${c.codigo} — ${c.descripcion}</b>: ${detalle} para <b>${emp}</b> en <b>${this.data.periodo.descripcion}</b>.`;
  }

  displayEmpleado(e: Empleado | null): string {
    return e && typeof e === 'object' ? `${e.nombre_completo} — ${e.numero_documento}` : (e as any) || '';
  }

  displayConcepto(c: ConceptoNomina | null): string {
    return c && typeof c === 'object' ? `${c.codigo} — ${c.descripcion}` : (c as any) || '';
  }

  private ajustarValidadores(): void {
    this.cantidadCtrl.clearValidators();
    this.fechaInicioCtrl.clearValidators();
    this.fechaFinCtrl.clearValidators();
    this.valorCtrl.clearValidators();
    switch (this.unidad) {
      case 'HORA':
        this.cantidadCtrl.setValidators([Validators.required, Validators.min(0.01)]);
        break;
      case 'DIA':
        this.fechaInicioCtrl.setValidators([Validators.required]);
        this.fechaFinCtrl.setValidators([Validators.required]);
        break;
      case 'VALOR':
        this.valorCtrl.setValidators([Validators.required, Validators.min(1)]);
        break;
    }
    [this.cantidadCtrl, this.fechaInicioCtrl, this.fechaFinCtrl, this.valorCtrl]
      .forEach(c => c.updateValueAndValidity({ emitEvent: false }));
  }

  // ── Guardado ─────────────────────────────────────────────────────────────
  guardar(): void {
    if (!this.puedeGuardar || this.guardando) return;
    const c = this.conceptoSel!;
    const base: NovedadPeriodo = this.isEditing
      ? { ...this.data.novedad! }
      : {
          id_cliente: this.data.cliente.id_entidad,
          id_periodo: this.data.periodo.id_periodo,
          id_persona: this.empleadoSel!.id_persona ?? null,
          id_contrato: this.empleadoSel!.contrato_activo?.id_contrato ?? null,
          documento: this.empleadoSel!.numero_documento || '',
          nombre_empleado: this.empleadoSel!.nombre_completo || null,
          codigo_concepto: c.codigo,
        };

    base.codigo_concepto = c.codigo;
    base.descripcion_concepto = c.descripcion;
    base.naturaleza = c.naturaleza;
    base.unidad = c.unidad;
    base.observacion = (this.observacionCtrl.value || '').trim() || null;

    switch (this.unidad) {
      case 'HORA':
        base.cantidad = Number(this.cantidadCtrl.value);
        base.fecha_inicio = this.formatFecha(this.fechaInicioCtrl.value);
        base.fecha_fin = base.fecha_inicio;
        base.valor = null;
        break;
      case 'DIA':
        base.cantidad = this.diasCalculados;
        base.fecha_inicio = this.formatFecha(this.fechaInicioCtrl.value);
        base.fecha_fin = this.formatFecha(this.fechaFinCtrl.value);
        base.valor = null;
        break;
      case 'VALOR':
        base.cantidad = null;
        base.fecha_inicio = this.formatFecha(this.fechaInicioCtrl.value);
        base.fecha_fin = base.fecha_inicio;
        base.valor = Number(this.valorCtrl.value);
        break;
    }

    this.guardando = true;
    const req$ = this.isEditing
      ? this.nominaService.actualizarNovedadPeriodo(
            this.data.novedad!.id!, this.data.cliente.id_entidad, base)
      : this.nominaService.crearNovedadPeriodo(base);

    req$.subscribe({
      next: res => {
        this.guardando = false;
        Swal.fire({
          title: this.isEditing ? 'Novedad actualizada' : 'Novedad registrada',
          icon: 'success', timer: 1500, showConfirmButton: false,
        });
        this.dialogRef.close(res || base);
      },
      error: err => {
        this.guardando = false;
        this.cdr.markForCheck();
        if (err?.status === 404 || err?.status === 501) {
          Swal.fire('Servicio no disponible',
            'El backend de novedades del periodo (/api/nomina/novedades-periodo) aún no está desplegado.',
            'info');
        } else {
          const msg = err?.error?.mensaje || err?.error?.message || 'No se pudo guardar la novedad.';
          Swal.fire('Error', msg, 'error');
        }
      },
    });
  }

  // ── Fechas (yyyy-MM-dd ⇆ Date local, sin sorpresas de zona horaria) ──────
  private formatFecha(d: Date | null): string | null {
    if (!d) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  private parseFecha(s: string | null | undefined): Date | null {
    if (!s) return null;
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
}

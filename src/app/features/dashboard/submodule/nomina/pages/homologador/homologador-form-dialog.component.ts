import { ChangeDetectorRef, Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ConceptoNomina, HomologadorExterno, NominaService } from '../../service/nomina/nomina.service';

interface HomologadorDialogData {
  homologacion: HomologadorExterno | null;
  entidadId: number;
  conceptoSugerido?: ConceptoNomina | null;
}

@Component({
  selector: 'app-homologador-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="dialog-header">
      <mat-icon class="dialog-icon">{{ isEditing ? 'edit_note' : 'sync_alt' }}</mat-icon>
      <div>
        <h2 mat-dialog-title>{{ isEditing ? 'Editar homologacion' : 'Nueva homologacion' }}</h2>
        <p class="dialog-subtitle">Relaciona un concepto externo con un concepto maestro de Tu Alianza</p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid">
        <div class="section-title">Concepto de la empresa externa</div>

        <mat-form-field appearance="outline" class="field-half">
          <mat-label>Codigo externo</mat-label>
          <input matInput formControlName="codigo_externo" placeholder="Ej: NOV_001" maxlength="50">
          <mat-error *ngIf="form.get('codigo_externo')?.hasError('required')">Obligatorio</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-half">
          <mat-label>Clasificacion externa</mat-label>
          <input matInput formControlName="clasificacion_externa" placeholder="Ej: Devengo" maxlength="100">
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-full">
          <mat-label>Nombre del concepto externo</mat-label>
          <input matInput formControlName="concepto_externo" placeholder="Ej: Bonificacion por produccion" maxlength="200">
          <mat-error *ngIf="form.get('concepto_externo')?.hasError('required')">Obligatorio</mat-error>
        </mat-form-field>

        <div class="section-title">Concepto maestro Tu Alianza</div>

        <mat-form-field appearance="outline" class="field-full">
          <mat-label>Concepto maestro</mat-label>
          <mat-select formControlName="concepto">
            <mat-option *ngFor="let c of conceptosFiltrados" [value]="c.id_concepto">
              <span class="opt-codigo">[{{ c.codigo }}]</span> {{ c.descripcion }}
              <span class="opt-nat">({{ c.naturaleza_display || c.naturaleza }})</span>
            </mat-option>
          </mat-select>
          <mat-error *ngIf="form.get('concepto')?.hasError('required')">Seleccione un concepto</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-full compact-field">
          <mat-label>Filtrar conceptos</mat-label>
          <input
            matInput
            [(ngModel)]="searchConcepto"
            [ngModelOptions]="{ standalone: true }"
            (input)="filtrarConceptos()"
            placeholder="Buscar por codigo o descripcion..."
          >
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>

        <div class="section-title">Mapeo operativo (opcional)</div>

        <mat-form-field appearance="outline" class="field-half">
          <mat-label>Tabla operativa destino</mat-label>
          <input matInput formControlName="tabla_operativa_destino" placeholder="Ej: nomina_bonificaciones_auxilios" maxlength="100">
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-half">
          <mat-label>Campo operativo destino</mat-label>
          <input matInput formControlName="campo_operativo_destino" placeholder="Ej: bonif_1_constitutiva_salario" maxlength="100">
        </mat-form-field>

        <div class="section-title">Estado y observaciones</div>

        <mat-form-field appearance="outline" class="field-half">
          <mat-label>Estado de homologacion</mat-label>
          <mat-select formControlName="estado_homologacion">
            <mat-option value="HOMOLOGADO">Homologado</mat-option>
            <mat-option value="HOMOLOGADO_CON_OBSERVACION">Homologado con observacion</mat-option>
            <mat-option value="REVISAR">Revisar</mat-option>
            <mat-option value="SIN_HOMOLOGACION">Sin homologacion</mat-option>
          </mat-select>
        </mat-form-field>

        <div class="toggle-row field-half">
          <mat-slide-toggle formControlName="activo" color="primary">Activo</mat-slide-toggle>
        </div>

        <mat-form-field appearance="outline" class="field-full">
          <mat-label>Observacion</mat-label>
          <textarea matInput formControlName="observacion" rows="3" placeholder="Notas adicionales sobre esta homologacion..."></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancelar()" [disabled]="saving">Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="form.invalid || saving">
        <mat-spinner *ngIf="saving" diameter="18" style="display:inline-block;margin-right:6px"></mat-spinner>
        {{ isEditing ? 'Guardar cambios' : 'Crear homologacion' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px 24px 12px;
    }
    .dialog-icon { font-size: 36px; width: 36px; height: 36px; color: #3f51b5; color: light-dark(#3f51b5, #acb4e2); }
    h2[mat-dialog-title] { margin: 0; font-size: 18px; }
    .dialog-subtitle { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
    mat-dialog-content { padding: 16px 24px !important; max-height: 65vh; }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
    }
    .field-full, .section-title { grid-column: 1 / -1; }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: #3f51b5; color: light-dark(#3f51b5, #acb4e2);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 12px 0 4px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--border-strong);
    }
    .section-title:first-child { margin-top: 0; }
    .compact-field { margin-top: -8px; }
    .toggle-row {
      display: flex;
      align-items: center;
      padding: 16px 0;
    }
    .opt-codigo { font-weight: 600; color: #3f51b5; color: light-dark(#3f51b5, #acb4e2); font-family: monospace; }
    .opt-nat { font-size: 11px; color: var(--muted); margin-left: 4px; }
    mat-dialog-actions { padding: 12px 24px 16px !important; }
  `],
})
export class HomologadorFormDialogComponent implements OnInit {
  form!: FormGroup;
  isEditing = false;
  saving = false;

  conceptos: ConceptoNomina[] = [];
  conceptosFiltrados: ConceptoNomina[] = [];
  searchConcepto = '';

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<HomologadorFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: HomologadorDialogData,
    private nominaService: NominaService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.isEditing = !!this.data.homologacion;
    const homologacion = this.data.homologacion;
    const conceptoInicial = homologacion?.concepto ?? this.data.conceptoSugerido?.id_concepto ?? '';

    this.form = this.fb.group({
      entidad_externa: [this.data.entidadId, Validators.required],
      codigo_externo: [homologacion?.codigo_externo ?? '', Validators.required],
      concepto_externo: [homologacion?.concepto_externo ?? '', Validators.required],
      clasificacion_externa: [homologacion?.clasificacion_externa ?? ''],
      concepto: [conceptoInicial, Validators.required],
      tabla_operativa_destino: [homologacion?.tabla_operativa_destino ?? ''],
      campo_operativo_destino: [homologacion?.campo_operativo_destino ?? ''],
      estado_homologacion: [homologacion?.estado_homologacion ?? 'SIN_HOMOLOGACION', Validators.required],
      observacion: [homologacion?.observacion ?? ''],
      activo: [homologacion?.activo ?? true],
    });

    this.cargarConceptos();
  }

  cargarConceptos(): void {
    this.nominaService.getConceptos().subscribe({
      next: (data) => {
        this.conceptos = this.incluirConceptoActual(data);
        this.conceptosFiltrados = this.conceptos;
        this.preseleccionarConceptoSugerido();
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al cargar conceptos', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * /conceptos solo devuelve conceptos activos. Si la homologacion en edicion
   * apunta a un concepto que no esta en esa lista (inactivo, o recuperable por
   * sus datos denormalizados), lo inyecta como opcion marcada "(inactivo)" para
   * que el mat-select muestre el mapeo actual en vez de quedar en blanco. Asi
   * cualquier homologacion huerfana es visible y reasignable a un concepto valido.
   */
  private incluirConceptoActual(activos: ConceptoNomina[]): ConceptoNomina[] {
    const actual = this.data.homologacion;
    const conceptoId = actual?.concepto;
    if (!conceptoId) return activos;
    if (activos.some((concepto) => concepto.id_concepto === conceptoId)) return activos;

    const sintetico = {
      id_concepto: conceptoId,
      codigo: actual?.concepto_codigo || String(conceptoId),
      descripcion: `${actual?.concepto_descripcion || 'Concepto ' + conceptoId} (inactivo)`,
      naturaleza: (actual?.concepto_naturaleza as ConceptoNomina['naturaleza']) || 'OTRO',
      unidad: 'VALOR',
      afecta_ibc: false,
      activo: false,
      naturaleza_display: actual?.concepto_naturaleza,
    } as ConceptoNomina;
    return [sintetico, ...activos];
  }

  filtrarConceptos(): void {
    const term = this.searchConcepto.trim().toLowerCase();
    if (!term) {
      this.conceptosFiltrados = this.conceptos;
      return;
    }

    this.conceptosFiltrados = this.conceptos.filter((concepto) =>
      concepto.codigo.toLowerCase().includes(term) ||
      concepto.descripcion.toLowerCase().includes(term) ||
      (concepto.abreviatura ?? '').toLowerCase().includes(term)
    );
  }

  guardar(): void {
    if (this.form.invalid) return;

    this.saving = true;
    const payload = this.form.value;
    const request$ = this.isEditing
      ? this.nominaService.actualizarHomologacion(this.data.homologacion!.id_homologacion!, payload)
      : this.nominaService.crearHomologacion(payload);

    request$.subscribe({
      next: () => {
        this.snackBar.open(
          this.isEditing ? 'Homologacion actualizada' : 'Homologacion creada',
          'Cerrar',
          { duration: 2500 },
        );
        this.dialogRef.close(true);
      },
      error: (err) => {
        const errors = err?.error;
        let msg = 'Error al guardar';
        if (errors) {
          const firstKey = Object.keys(errors)[0];
          const firstVal = errors[firstKey];
          msg = Array.isArray(firstVal) ? firstVal[0] : (typeof firstVal === 'string' ? firstVal : msg);
        }
        this.snackBar.open(msg, 'Cerrar', { duration: 4000 });
        this.saving = false;
        this.cdr.markForCheck();
      },
    });
  }

  cancelar(): void {
    this.dialogRef.close(false);
  }

  private preseleccionarConceptoSugerido(): void {
    const conceptoId = this.form.get('concepto')?.value;
    if (!conceptoId) return;

    const existe = this.conceptos.some((concepto) => concepto.id_concepto === conceptoId);
    if (!existe && this.data.conceptoSugerido?.id_concepto) {
      this.form.patchValue({ concepto: this.data.conceptoSugerido.id_concepto });
    }
  }
}

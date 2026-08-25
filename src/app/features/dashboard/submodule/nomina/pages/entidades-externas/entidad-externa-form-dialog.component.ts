import { ChangeDetectorRef, Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NominaService, EntidadExterna, EntidadExternaUpsert, TipoEntidadExterna } from '../../service/nomina/nomina.service';

/** Opciones de tipo permitidas (valor interno + etiqueta). CLIENTE NO se ofrece. */
export const TIPOS_ENTIDAD: { value: TipoEntidadExterna; label: string }[] = [
  { value: 'EMPRESA_USUARIA', label: 'Empresa usuaria' },
  { value: 'EMPRESA_PROPIA',  label: 'Empresa propia' },
  { value: 'EPS',             label: 'EPS' },
  { value: 'AFP',             label: 'AFP' },
  { value: 'BANCO',           label: 'Banco' },
  { value: 'CCF',             label: 'Caja de compensación (CCF)' },
];

/**
 * Formulario crear/editar de entidad externa (modal). El tipo es un selector
 * controlado (nunca texto libre); no incluye CLIENTE. En edición, si la entidad
 * es una empresa usuaria con CECOs o contratos, se advierte que el tipo no puede
 * cambiarse (el backend lo bloquea de todas formas).
 */
@Component({
  selector: 'app-entidad-externa-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="dialog-header">
      <mat-icon class="dialog-icon">{{ isEditing ? 'edit_note' : 'add_business' }}</mat-icon>
      <div>
        <h2 mat-dialog-title>{{ isEditing ? 'Editar Entidad Externa' : 'Nueva Entidad Externa' }}</h2>
        <p class="dialog-subtitle">Registro en el modelo de nómina (tipo controlado)</p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <mat-dialog-content>
      <div class="aviso-tipo" *ngIf="tipoBloqueado">
        <mat-icon>lock</mat-icon>
        <span>No es posible cambiar el tipo: esta empresa usuaria tiene
          {{ data.entidad?.contratos_count || 0 }} contrato(s) y
          {{ data.entidad?.centros_costo_count || 0 }} centro(s) de costo asociados.</span>
      </div>

      <form [formGroup]="form" class="form-grid">

        <mat-form-field appearance="outline" class="field-tipo">
          <mat-label>Tipo de entidad</mat-label>
          <mat-select formControlName="tipo">
            <mat-option *ngFor="let t of TIPOS" [value]="t.value">{{ t.label }}</mat-option>
          </mat-select>
          <mat-error *ngIf="form.get('tipo')?.hasError('required')">El tipo es obligatorio</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-nombre">
          <mat-label>Nombre / Razón social</mat-label>
          <input matInput formControlName="nombre" placeholder="Ej: SURA EPS" maxlength="150">
          <mat-error *ngIf="form.get('nombre')?.hasError('required')">El nombre es obligatorio</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-comercial">
          <mat-label>Nombre comercial</mat-label>
          <input matInput formControlName="nombre_comercial" placeholder="Opcional" maxlength="150">
          <mat-hint>Opcional</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-nit">
          <mat-label>NIT</mat-label>
          <input matInput formControlName="nit" placeholder="Ej: 800088702-2" maxlength="20">
          <mat-hint>Opcional</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-codigo">
          <mat-label>Código</mat-label>
          <input matInput formControlName="codigo" placeholder="Opcional" maxlength="20">
          <mat-hint>Código interno / ministerio (opcional)</mat-hint>
        </mat-form-field>

      </form>
    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancelar()" [disabled]="saving">Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="form.invalid || saving">
        <mat-spinner *ngIf="saving" diameter="18" style="display:inline-block;margin-right:6px"></mat-spinner>
        {{ isEditing ? 'Guardar cambios' : 'Crear entidad' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px 12px; }
    .dialog-icon { font-size: 36px; width: 36px; height: 36px; color: #3f51b5; }
    h2[mat-dialog-title] { margin: 0; font-size: 18px; }
    .dialog-subtitle { margin: 2px 0 0; font-size: 13px; color: #666; }
    mat-dialog-content { padding: 16px 24px !important; }
    .aviso-tipo {
      display: flex; align-items: center; gap: 8px;
      background: #fff4e5; color: #8a5300; border: 1px solid #ffd8a8;
      border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 13px;
    }
    .aviso-tipo mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
    .field-tipo, .field-nombre { grid-column: 1 / -1; }
    mat-dialog-actions { padding: 12px 24px 16px !important; }
  `],
})
export class EntidadExternaFormDialogComponent implements OnInit {
  readonly TIPOS = TIPOS_ENTIDAD;
  form!: FormGroup;
  isEditing = false;
  saving = false;
  tipoBloqueado = false;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<EntidadExternaFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { entidad: EntidadExterna | null },
    private nominaService: NominaService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.isEditing = !!this.data.entidad;
    const e = this.data.entidad;

    // Empresa usuaria con relaciones → el tipo no puede cambiar (guard del backend).
    this.tipoBloqueado = !!e && e.tipo === 'EMPRESA_USUARIA'
      && ((e.centros_costo_count ?? 0) > 0 || (e.contratos_count ?? 0) > 0);

    this.form = this.fb.group({
      tipo:             [{ value: e?.tipo ?? '', disabled: this.tipoBloqueado }, [Validators.required]],
      nombre:           [e?.nombre ?? '', [Validators.required]],
      nombre_comercial: [e?.nombre_comercial ?? ''],
      nit:              [e?.nit ?? ''],
      codigo:           [e?.codigo ?? ''],
    });
  }

  guardar(): void {
    if (this.form.invalid) return;
    this.saving = true;
    // getRawValue incluye controles deshabilitados (tipo bloqueado conserva su valor).
    const v = this.form.getRawValue();
    const payload: EntidadExternaUpsert = {
      tipo: v.tipo as TipoEntidadExterna,
      nombre: (v.nombre ?? '').trim(),
      nombre_comercial: (v.nombre_comercial ?? '').trim() || null,
      nit: (v.nit ?? '').trim() || null,
      codigo: (v.codigo ?? '').trim() || null,
    };

    const op$ = this.isEditing
      ? this.nominaService.actualizarEntidadExterna(this.data.entidad!.id, payload)
      : this.nominaService.crearEntidadExterna(payload);

    op$.subscribe({
      next: () => {
        this.snackBar.open(
          this.isEditing ? 'Entidad externa actualizada' : 'Entidad externa creada',
          'Cerrar', { duration: 2500 },
        );
        this.dialogRef.close(true);
      },
      error: (err) => {
        // El backend responde { error: "mensaje" } (400/404/409). El guard de
        // cambio de tipo devuelve 409 con el mensaje correspondiente.
        const msg = err?.error?.error ?? err?.error?.detail ?? 'No se pudo guardar la entidad externa';
        this.snackBar.open(msg, 'Cerrar', { duration: 5000 });
        this.saving = false;
        this.cdr.markForCheck();
      },
    });
  }

  cancelar(): void {
    this.dialogRef.close(false);
  }
}

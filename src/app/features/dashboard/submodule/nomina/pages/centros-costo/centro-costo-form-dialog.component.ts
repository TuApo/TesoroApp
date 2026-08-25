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

import {
  NominaService, CentroCostoAdmin, CentroCostoUpsert, Client,
} from '../../service/nomina/nomina.service';

/**
 * Formulario crear/editar de centro de costo (modal). La empresa usuaria es
 * obligatoria al crear. En edición, si el centro de costo YA tiene contratos
 * asociados, la empresa usuaria queda BLOQUEADA (no se puede reasignar para no
 * romper la trazabilidad histórica); los demás campos sí se editan. El estado
 * (activo/inactivo) se cambia desde la lista (desactivar/reactivar), no aquí.
 */
@Component({
  selector: 'app-centro-costo-form-dialog',
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
      <mat-icon class="dialog-icon">{{ isEditing ? 'edit_note' : 'add' }}</mat-icon>
      <div>
        <h2 mat-dialog-title>{{ isEditing ? 'Editar Centro de Costo' : 'Nuevo Centro de Costo' }}</h2>
        <p class="dialog-subtitle">Pertenece a una empresa usuaria (mantenimiento con borrado lógico)</p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid">

        <!-- Empresa usuaria: select cuando se puede elegir; solo lectura si está bloqueada -->
        <mat-form-field appearance="outline" class="field-empresa" *ngIf="!bloqueaEmpresa">
          <mat-label>Empresa usuaria</mat-label>
          <mat-select formControlName="id_cliente">
            <mat-option *ngFor="let e of empresas" [value]="e.id_entidad">{{ e.nombre_legal }}</mat-option>
          </mat-select>
          <mat-hint>Solo empresas usuarias activas</mat-hint>
          <mat-error *ngIf="form.get('id_cliente')?.hasError('required')">
            La empresa usuaria es obligatoria
          </mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-empresa" *ngIf="bloqueaEmpresa">
          <mat-label>Empresa usuaria</mat-label>
          <input matInput [value]="data.centro?.empresa_usuaria_nombre || ''" disabled>
        </mat-form-field>

        <div class="warn-banner" *ngIf="bloqueaEmpresa">
          <mat-icon>lock</mat-icon>
          <span>
            No es posible cambiar la empresa usuaria de este centro de costo porque tiene
            {{ data.centro?.contratos_count }} contratos asociados. Puede editar los demás datos permitidos.
          </span>
        </div>

        <mat-form-field appearance="outline" class="field-codigo">
          <mat-label>Código interno</mat-label>
          <input matInput formControlName="codigo_interno" placeholder="Ej: CC-01" maxlength="20">
          <mat-hint>Opcional; único dentro de la empresa usuaria</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-sede">
          <mat-label>Sede física</mat-label>
          <input matInput formControlName="sede_fisica" placeholder="Opcional" maxlength="100">
          <mat-hint>Opcional</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-nombre">
          <mat-label>Nombre del centro de costo</mat-label>
          <input matInput formControlName="nombre" placeholder="Ej: PLANTA POSTCOSECHA" maxlength="100">
          <mat-error *ngIf="form.get('nombre')?.hasError('required')">El nombre es obligatorio</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-direccion">
          <mat-label>Dirección</mat-label>
          <input matInput formControlName="direccion" placeholder="Ej: Calle 10 # 20-30" maxlength="200">
          <mat-hint>Opcional; dirección física del centro de costo</mat-hint>
        </mat-form-field>

      </form>
    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancelar()" [disabled]="saving">Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="form.invalid || saving">
        <mat-spinner *ngIf="saving" diameter="18" style="display:inline-block;margin-right:6px"></mat-spinner>
        {{ isEditing ? 'Guardar cambios' : 'Crear centro de costo' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px 12px; }
    .dialog-icon { font-size: 36px; width: 36px; height: 36px; color: #3f51b5; }
    h2[mat-dialog-title] { margin: 0; font-size: 18px; }
    .dialog-subtitle { margin: 2px 0 0; font-size: 13px; color: #666; }
    mat-dialog-content { padding: 16px 24px !important; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
    .field-empresa, .field-nombre, .field-direccion, .warn-banner { grid-column: 1 / -1; }
    .warn-banner {
      display: flex; align-items: flex-start; gap: 8px;
      background: #fff6e5; border: 1px solid #ffe0a3; color: #8a5a00;
      border-radius: 8px; padding: 10px 12px; font-size: 13px; margin: 2px 0 6px;
    }
    .warn-banner mat-icon { font-size: 18px; width: 18px; height: 18px; margin-top: 1px; }
    mat-dialog-actions { padding: 12px 24px 16px !important; }
  `],
})
export class CentroCostoFormDialogComponent implements OnInit {
  form!: FormGroup;
  isEditing = false;
  saving = false;
  bloqueaEmpresa = false;   // edición con contratos → empresa usuaria no editable
  empresas: Client[] = [];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CentroCostoFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA)
    public data: { centro: CentroCostoAdmin | null; empresaPreseleccionada: number | null },
    private nominaService: NominaService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const c = this.data.centro;
    this.isEditing = !!c;
    this.bloqueaEmpresa = this.isEditing && (c?.contratos_count ?? 0) > 0;

    this.form = this.fb.group({
      id_cliente:     [c?.id_cliente ?? this.data.empresaPreseleccionada ?? null, [Validators.required]],
      codigo_interno: [c?.codigo_interno ?? ''],
      nombre:         [c?.nombre ?? '', [Validators.required]],
      sede_fisica:    [c?.sede_fisica ?? ''],
      direccion:      [c?.direccion ?? ''],
    });

    // Empresa bloqueada: el control no participa en la validación ni en el envío.
    if (this.bloqueaEmpresa) this.form.get('id_cliente')!.disable();

    // Empresas usuarias ACTIVAS para el selector (solo cuando se puede elegir).
    if (!this.bloqueaEmpresa) {
      this.nominaService.getEntidadesPorTipo('EMPRESA_USUARIA').subscribe({
        next: (data) => { this.empresas = data ?? []; this.cdr.markForCheck(); },
        error: () => {
          this.snackBar.open('No se pudieron cargar las empresas usuarias', 'Cerrar', { duration: 3000 });
        },
      });
    }
  }

  guardar(): void {
    if (this.form.invalid) return;
    this.saving = true;
    const v = this.form.value;
    // Si la empresa está bloqueada, el control está disabled (no está en form.value):
    // conservamos la empresa actual del centro para no cambiarla.
    const idCliente = this.bloqueaEmpresa
      ? (this.data.centro?.id_cliente ?? null)
      : (v.id_cliente ?? null);

    const payload: CentroCostoUpsert = {
      id_cliente: idCliente,
      codigo_interno: (v.codigo_interno ?? '').trim() || null,
      nombre: (v.nombre ?? '').trim(),
      sede_fisica: (v.sede_fisica ?? '').trim() || null,
      direccion: (v.direccion ?? '').trim() || null,
    };

    const op$ = this.isEditing
      ? this.nominaService.actualizarCentroCosto(this.data.centro!.id_ceco, payload)
      : this.nominaService.crearCentroCosto(payload);

    op$.subscribe({
      next: () => {
        this.snackBar.open(
          this.isEditing ? 'Centro de costo actualizado' : 'Centro de costo creado',
          'Cerrar', { duration: 2500 },
        );
        this.dialogRef.close(true);
      },
      error: (err) => {
        // El backend responde { error: "mensaje" } (400/404/409).
        const msg = err?.error?.error ?? err?.error?.detail ?? 'No se pudo guardar el centro de costo';
        this.snackBar.open(msg, 'Cerrar', { duration: 4500 });
        this.saving = false;
        this.cdr.markForCheck();
      },
    });
  }

  cancelar(): void {
    this.dialogRef.close(false);
  }
}

import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NotificacionesConfigService } from '../../services/notificaciones-config.service';
import {
  COLORES_SUGERIDOS,
  ICONOS_SUGERIDOS,
  NotificationType,
  OpcionAudiencia,
  TipoRequest,
  URGENCIAS,
  Urgencia,
} from '../../models/notificacion-config.model';

export interface TipoFormDialogData {
  /** Ausente = alta. */
  tipo?: NotificationType;
}

/**
 * Alta/edición de un tipo del catálogo (`notif_tipo`).
 *
 * El tipo es lo que la campana y la página de Novedades leen para pintar cada
 * aviso. Hasta que existió esta tabla, ícono, color y etiqueta estaban
 * hardcodeados en tres sitios a la vez (el sidebar, la página de notificaciones
 * y el servicio de Java), y agregar un tipo costaba tres despliegues.
 *
 * La CLAVE es inmutable después de crear: es la referencia estable que usan las
 * reglas y el código de los productores, y renombrarla rompería en silencio las
 * notificaciones ya configuradas. El backend la ignora en el PATCH; aquí el
 * campo se deshabilita para que eso se vea en pantalla y no sorprenda.
 */
@Component({
  selector: 'app-tipo-form-dialog',
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
    MatSlideToggleModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="dialog-header">
      <mat-icon class="dialog-icon">{{ esEdicion ? 'edit_note' : 'new_label' }}</mat-icon>
      <div>
        <h2 mat-dialog-title>{{ esEdicion ? 'Editar tipo' : 'Nuevo tipo de notificación' }}</h2>
        <p class="dialog-subtitle">Cómo se ve y se agrupa esta clase de aviso</p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <mat-dialog-content>
      <!-- Vista previa: es la única forma de saber si el ícono existe de verdad -->
      <div class="preview">
        <span class="preview-avatar" [style.background]="colorActual + '1a'" [style.color]="colorActual">
          <mat-icon>{{ iconoActual }}</mat-icon>
        </span>
        <div class="preview-texto">
          <span class="preview-titulo">{{ form.value.nombre || 'Nombre del tipo' }}</span>
          <span class="preview-sub">Así se verá en la campana y en Novedades</span>
        </div>
      </div>

      <form [formGroup]="form" class="form-grid">
        <mat-form-field appearance="outline">
          <mat-label>Clave</mat-label>
          <input matInput formControlName="clave" placeholder="HR_INCAPACIDAD_ALERTA" maxlength="64">
          <mat-icon matSuffix *ngIf="esEdicion" matTooltip="La clave no se puede cambiar">lock</mat-icon>
          <mat-hint>{{ esEdicion ? 'Inmutable: las reglas la referencian' : 'Mayúsculas y guion bajo' }}</mat-hint>
          <mat-error *ngIf="form.get('clave')?.hasError('required')">La clave es obligatoria</mat-error>
          <mat-error *ngIf="form.get('clave')?.hasError('pattern')">
            Solo letras mayúsculas, números y guion bajo
          </mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Nombre visible</mat-label>
          <input matInput formControlName="nombre" placeholder="Incapacidades · Alerta" maxlength="120">
          <mat-error *ngIf="form.get('nombre')?.hasError('required')">El nombre es obligatorio</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="col-2">
          <mat-label>Descripción</mat-label>
          <input matInput formControlName="descripcion" maxlength="255"
                 placeholder="Qué clase de avisos agrupa este tipo">
          <mat-hint>Opcional</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Ícono</mat-label>
          <input matInput formControlName="icono" placeholder="notifications" maxlength="50">
          <mat-hint>Nombre de Material Symbols</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Color</mat-label>
          <input matInput formControlName="color" placeholder="#2563eb" maxlength="20">
          <mat-error *ngIf="form.get('color')?.hasError('pattern')">Usa un hex como #2563eb</mat-error>
        </mat-form-field>

        <div class="col-2 paleta">
          <span class="paleta-label">Íconos sugeridos</span>
          <div class="paleta-items">
            <button type="button" class="chip-icono" *ngFor="let i of ICONOS"
                    [class.sel]="iconoActual === i" (click)="form.get('icono')?.setValue(i)"
                    [matTooltip]="i">
              <mat-icon>{{ i }}</mat-icon>
            </button>
          </div>
        </div>

        <div class="col-2 paleta">
          <span class="paleta-label">Colores sugeridos</span>
          <div class="paleta-items">
            <button type="button" class="chip-color" *ngFor="let c of COLORES"
                    [class.sel]="colorActual.toLowerCase() === c" [style.background]="c"
                    (click)="form.get('color')?.setValue(c)" [matTooltip]="c"></button>
          </div>
        </div>

        <mat-form-field appearance="outline">
          <mat-label>Urgencia por defecto</mat-label>
          <mat-select formControlName="urgencia_default">
            <mat-option *ngFor="let u of URGENCIAS" [value]="u.value">{{ u.label }}</mat-option>
          </mat-select>
          <mat-hint>Cada regla puede forzar otra</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Módulo</mat-label>
          <mat-select formControlName="modulo_id">
            <mat-option [value]="null">Sin módulo</mat-option>
            <mat-option *ngFor="let m of modulos" [value]="m.id">{{ m.nombre }}</mat-option>
          </mat-select>
          <mat-hint>Agrupa y filtra los avisos por área</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Orden en el catálogo</mat-label>
          <input matInput type="number" formControlName="orden" min="0">
          <mat-hint>Menor primero</mat-hint>
        </mat-form-field>

        <div class="toggle-campo">
          <mat-slide-toggle color="primary" formControlName="agrupable">Agrupable</mat-slide-toggle>
          <span class="toggle-ayuda">Varios avisos iguales se colapsan en una sola línea.</span>
        </div>
      </form>
    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="cancelar()" [disabled]="guardando">Cancelar</button>
      <button mat-flat-button color="primary" type="button" (click)="guardar()" [disabled]="guardando">
        <mat-spinner diameter="18" *ngIf="guardando"></mat-spinner>
        <mat-icon *ngIf="!guardando">save</mat-icon>
        {{ esEdicion ? 'Guardar cambios' : 'Crear tipo' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px 12px; }
    .dialog-icon { font-size: 36px; width: 36px; height: 36px; color: #3f51b5; }
    h2[mat-dialog-title] { margin: 0; font-size: 18px; }
    .dialog-subtitle { margin: 2px 0 0; font-size: 13px; color: #666; }
    mat-dialog-content { padding: 16px 24px !important; }
    mat-dialog-actions { padding: 12px 24px 16px !important; }
    mat-dialog-actions mat-spinner { margin-right: 8px; }

    .preview {
      display: flex; align-items: center; gap: 12px;
      border: 1px solid #e3e5ee; border-radius: 10px; padding: 12px 14px;
      background: #fafbfe; margin-bottom: 16px;
    }
    .preview-avatar {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border-radius: 10px; flex: 0 0 auto;
    }
    .preview-avatar mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .preview-texto { display: flex; flex-direction: column; line-height: 1.25; }
    .preview-titulo { font-size: 14px; font-weight: 600; color: #23262f; }
    .preview-sub { font-size: 12px; color: #8a8fa3; }

    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
    .col-2 { grid-column: 1 / -1; }

    .paleta { display: flex; flex-direction: column; gap: 6px; padding-bottom: 8px; }
    .paleta-label { font-size: 12px; color: #6b6f80; }
    .paleta-items { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip-icono {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; border-radius: 8px; cursor: pointer;
      border: 1px solid #e3e5ee; background: #fff; color: #5a5f73;
    }
    .chip-icono mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .chip-icono.sel { border-color: #3f51b5; background: #eef1fb; color: #3f51b5; }
    .chip-color {
      width: 26px; height: 26px; border-radius: 50%; cursor: pointer;
      border: 2px solid transparent; outline: 1px solid #e3e5ee;
    }
    .chip-color.sel { border-color: #23262f; }

    .toggle-campo { display: flex; flex-direction: column; gap: 4px; padding: 8px 0 16px; }
    .toggle-ayuda { font-size: 12px; color: #6b6f80; line-height: 1.4; }

    @media (max-width: 640px) { .form-grid { grid-template-columns: 1fr; } }
  `],
})
export class TipoFormDialogComponent implements OnInit {
  form!: FormGroup;
  guardando = false;
  readonly esEdicion: boolean;

  modulos: OpcionAudiencia[] = [];

  readonly URGENCIAS = URGENCIAS;
  readonly ICONOS = ICONOS_SUGERIDOS;
  readonly COLORES = COLORES_SUGERIDOS;

  constructor(
    private fb: FormBuilder,
    private api: NotificacionesConfigService,
    private snack: MatSnackBar,
    private ref: MatDialogRef<TipoFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TipoFormDialogData,
  ) {
    this.esEdicion = !!data?.tipo;
  }

  ngOnInit(): void {
    const t = this.data?.tipo;

    this.form = this.fb.group({
      clave: [
        { value: t?.clave ?? '', disabled: this.esEdicion },
        [Validators.required, Validators.maxLength(64), Validators.pattern(/^[A-Z0-9_]+$/)],
      ],
      nombre: [t?.nombre ?? '', [Validators.required, Validators.maxLength(120)]],
      descripcion: [t?.descripcion ?? '', Validators.maxLength(255)],
      icono: [t?.icono ?? 'notifications', Validators.maxLength(50)],
      color: [t?.color ?? '#2563eb', Validators.pattern(/^#[0-9a-fA-F]{3,8}$/)],
      urgencia_default: [(t?.urgencia_default ?? 'INFO') as Urgencia, Validators.required],
      modulo_id: [t?.modulo_id ?? null],
      agrupable: [t?.agrupable ?? false],
      orden: [t?.orden ?? 0, Validators.min(0)],
    });

    this.api.modulos().subscribe((ms) => (this.modulos = ms));
  }

  /** Lo que pinta la vista previa; con el campo vacío usa el mismo respaldo que el backend. */
  get iconoActual(): string { return (this.form?.value.icono as string) || 'notifications'; }
  get colorActual(): string { return (this.form?.value.color as string) || '#64748b'; }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.snack.open('Revisa los campos marcados', 'Cerrar', { duration: 4000 });
      return;
    }

    // getRawValue y no value: `clave` está deshabilitado al editar y `value` lo
    // omitiría. Da igual para el PATCH (el backend la ignora), pero así el
    // payload que se arma es el mismo en alta y en edición.
    const v = this.form.getRawValue();
    const payload: TipoRequest = {
      nombre: (v.nombre as string).trim(),
      descripcion: (v.descripcion as string)?.trim() || null,
      icono: (v.icono as string)?.trim() || 'notifications',
      color: (v.color as string)?.trim() || '#64748b',
      urgencia_default: v.urgencia_default as Urgencia,
      modulo_id: (v.modulo_id as string | null) ?? null,
      agrupable: !!v.agrupable,
      orden: Number(v.orden ?? 0),
    };
    if (!this.esEdicion) {
      payload.clave = (v.clave as string).trim().toUpperCase();
      payload.activo = true;
    }

    this.guardando = true;
    const peticion = this.esEdicion
      ? this.api.actualizarTipo(this.data.tipo!.id, payload)
      : this.api.crearTipo(payload);

    peticion.subscribe({
      next: (guardado) => { this.guardando = false; this.ref.close(guardado); },
      error: (e) => {
        this.guardando = false;
        const err = e as { error?: { error?: string } | string };
        const msg = typeof err?.error === 'string'
          ? err.error
          : err?.error?.error ?? 'No se pudo guardar el tipo';
        this.snack.open(msg, 'Cerrar', { duration: 7000 });
      },
    });
  }

  cancelar(): void { this.ref.close(); }
}

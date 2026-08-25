import { ChangeDetectorRef, Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NominaService, ConceptoNomina } from '../../service/nomina/nomina.service';

@Component({
  selector: 'app-concepto-form-dialog',
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
    MatSlideToggleModule,
    MatSnackBarModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="dialog-header">
      <mat-icon class="dialog-icon">{{ isEditing ? 'edit_note' : 'add_circle' }}</mat-icon>
      <div>
        <h2 mat-dialog-title>{{ isEditing ? 'Editar Novedad' : 'Nueva Novedad' }}</h2>
        <p class="dialog-subtitle">Parametrización de concepto de nómina (días / horas / valores)</p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid">

        <mat-form-field appearance="outline" class="field-codigo">
          <mat-label>Código</mat-label>
          <input matInput formControlName="codigo" placeholder="Ej: AUS_INJ_H" maxlength="20">
          <mat-hint>Máx. 20 caracteres, sin espacios</mat-hint>
          <mat-error *ngIf="form.get('codigo')?.hasError('required')">El código es obligatorio</mat-error>
          <mat-error *ngIf="form.get('codigo')?.hasError('pattern')">Solo letras, números y guiones bajos</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-abrev">
          <mat-label>Abreviatura</mat-label>
          <input matInput formControlName="abreviatura" placeholder="Ej: AUS.INJ" maxlength="30">
          <mat-hint>Etiqueta corta para reportes</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-descripcion">
          <mat-label>Descripción</mat-label>
          <input matInput formControlName="descripcion" placeholder="Ej: Ausencia Injustificada en Horas" maxlength="200">
          <mat-error *ngIf="form.get('descripcion')?.hasError('required')">La descripción es obligatoria</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-naturaleza">
          <mat-label>Naturaleza</mat-label>
          <mat-select formControlName="naturaleza">
            <mat-option value="DEVENGO">Devengo</mat-option>
            <mat-option value="DEDUCCION">Deducción</mat-option>
            <mat-option value="APORTE_EMPLEADO">Aporte Empleado</mat-option>
            <mat-option value="APORTE_EMPLEADOR">Aporte Empleador</mat-option>
            <mat-option value="PROVISION">Provisión</mat-option>
            <mat-option value="OTRO">Otro</mat-option>
          </mat-select>
          <mat-error *ngIf="form.get('naturaleza')?.hasError('required')">Seleccione la naturaleza</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-unidad">
          <mat-label>Unidad de medida</mat-label>
          <mat-select formControlName="unidad">
            <mat-option value="DIA">
              <mat-icon>today</mat-icon> Día
            </mat-option>
            <mat-option value="HORA">
              <mat-icon>schedule</mat-icon> Hora
            </mat-option>
            <mat-option value="VALOR">
              <mat-icon>attach_money</mat-icon> Valor
            </mat-option>
          </mat-select>
          <mat-error *ngIf="form.get('unidad')?.hasError('required')">Seleccione la unidad</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-agrupador">
          <mat-label>Agrupador</mat-label>
          <mat-select formControlName="agrupador">
            <mat-option *ngFor="let a of AGRUPADORES" [value]="a.value">{{ a.label }}</mat-option>
          </mat-select>
          <mat-hint>Super-categoría de reporte (Ausencias / Incapacidades / Extras y Bonificaciones)</mat-hint>
          <mat-error *ngIf="form.get('agrupador')?.hasError('required')">Seleccione el agrupador</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-categoria">
          <mat-label>Categoría funcional</mat-label>
          <mat-select formControlName="categoria">
            <mat-option [value]="null">— Sin clasificar —</mat-option>
            <mat-option *ngFor="let cat of CATEGORIAS" [value]="cat">{{ cat }}</mat-option>
          </mat-select>
          <mat-hint>Agrupa el concepto para reportes y routing del motor</mat-hint>
        </mat-form-field>

        <mat-divider class="form-divider"></mat-divider>
        <div class="section-title">
          <mat-icon>route</mat-icon>
          Ruta operativa (parametrizador → motor)
        </div>
        <p class="section-hint">
          Cuando esta novedad llega por Excel, el motor la escribe en la tabla
          satélite y campo configurados aquí. El homologador puede
          sobreescribir por cliente para casos excepcionales.
        </p>

        <mat-form-field appearance="outline" class="field-tabla">
          <mat-label>Tabla destino</mat-label>
          <mat-select formControlName="tabla_destino">
            <mat-option [value]="null">— No aplica —</mat-option>
            <mat-option *ngFor="let t of TABLAS_DESTINO" [value]="t">{{ t }}</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="field-campo">
          <mat-label>Campo destino</mat-label>
          <mat-select formControlName="campo_destino" [disabled]="!form.get('tabla_destino')?.value">
            <mat-option [value]="null">— Ninguno —</mat-option>
            <mat-option *ngFor="let f of camposDeTablaSeleccionada()" [value]="f">{{ f }}</mat-option>
          </mat-select>
          <mat-hint *ngIf="!form.get('tabla_destino')?.value">Seleccione una tabla primero</mat-hint>
        </mat-form-field>

        <div class="toggle-row">
          <mat-slide-toggle formControlName="afecta_ibc" color="primary">
            Afecta IBC (Base de Seguridad Social)
          </mat-slide-toggle>
          <mat-slide-toggle formControlName="activo" color="accent">
            Activo
          </mat-slide-toggle>
        </div>

      </form>
    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancelar()" [disabled]="saving">Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="form.invalid || saving">
        <mat-spinner *ngIf="saving" diameter="18" style="display:inline-block;margin-right:6px"></mat-spinner>
        {{ isEditing ? 'Guardar cambios' : 'Crear Novedad' }}
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
    .dialog-icon { font-size: 36px; width: 36px; height: 36px; color: #3f51b5; }
    h2[mat-dialog-title] { margin: 0; font-size: 18px; }
    .dialog-subtitle { margin: 2px 0 0; font-size: 13px; color: #666; }
    mat-dialog-content { padding: 16px 24px !important; }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
    }
    .field-descripcion, .toggle-row, .field-categoria, .field-agrupador,
    .form-divider, .section-title, .section-hint { grid-column: 1 / -1; }
    .form-divider { margin: 8px 0 0; }
    .section-title {
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; font-size: 14px; color: #3f51b5;
      margin-top: 8px;
    }
    .section-title mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .section-hint { margin: 0 0 4px; font-size: 12px; color: #666; }
    .toggle-row {
      display: flex;
      gap: 32px;
      align-items: center;
      padding: 8px 0;
    }
    mat-dialog-actions { padding: 12px 24px 16px !important; }
  `],
})
export class ConceptoFormDialogComponent implements OnInit {
  form!: FormGroup;
  isEditing = false;
  saving = false;

  /** Categorías funcionales seedeadas en V16. Las usamos como hint para
   *  routing (el motor inspecciona categoria al decidir si una novedad
   *  reduce días pagados). */
  readonly CATEGORIAS = [
    'DIA_ASIST', 'DIA_AUSENCIA', 'DIA_DOMINICAL_ING', 'DIA_INCAPACIDAD',
    'DIA_LICENCIA', 'DIA_SANCION', 'DIA_VACACIONES',
    'HORA_DOMINICAL_FEST', 'HORA_EXTRA', 'HORA_PERMISO', 'HORA_RECARGO',
    'VALOR_AJUSTE', 'VALOR_BONIFICACION', 'VALOR_DESCUENTO', 'VALOR_OTRO',
    'VALOR_PRESTACION', 'OTRO',
  ];

  /** Agrupador: super-categoría de reporte con EXACTAMENTE 3 valores (V29).
   *  Al crear una novedad nueva solo se ofrecen estos tres. */
  readonly AGRUPADORES = [
    { value: 'AUSENCIAS', label: 'Ausencias' },
    { value: 'INCAPACIDADES', label: 'Incapacidades' },
    { value: 'EXTRAS_Y_BONIFICACIONES', label: 'Extras y Bonificaciones' },
  ];

  /** Tablas satélite donde el motor puede escribir una novedad importada.
   *  El cliente solo elige una de éstas y luego un campo válido de la
   *  misma tabla. Si una tabla nueva entra al motor, ampliar acá + en
   *  CAMPOS_POR_TABLA. */
  readonly TABLAS_DESTINO = [
    'nomina_ausentismos_dias',
    'nomina_ausentismos_horas',
    'nomina_bonificaciones_auxilios',
    'nomina_descuentos_factura_detalle',
    'nomina_incapacidades_detalle',
    'nomina_ajustes_nomina_detalle',
  ];

  /** Campos válidos por tabla (espejo del schema satélite, hardcoded para
   *  evitar viaje al backend solo para validar). Si cambia el schema,
   *  actualizar aquí. */
  readonly CAMPOS_POR_TABLA: Record<string, string[]> = {
    'nomina_ausentismos_dias': [
      'dias_ausencia_ss_ps', 'dias_ausencia_sln', 'dias_ausencia_8_porc_fandes',
      'dias_ausencia_injust_sagaro', 'dias_sancion_sln', 'dias_sancion_sln_8_porc',
      'dominical_ausencia_8_porc', 'dias_dominical_por_ausencia',
      'dias_licencia_luto', 'dias_licencia_remunerada', 'dias_vacaciones',
      'dias_licencia_no_rem_sln', 'dias_licencia_no_rem_8_porc',
      'dias_no_trabajados_jardines', 'dias_sin_novedad', 'dias_compensados',
    ],
    'nomina_ausentismos_horas': [
      'horas_permiso_remunerado', 'horas_permiso_eps', 'horas_lactancia',
      'horas_permiso_rem_familiar', 'horas_permiso_rem_judicial',
      'horas_ausencia_o_retardo_justificado', 'horas_ausencia_injustificada',
      'horas_permiso_personal_no_rem', 'horas_ausencia_injustif_8_porc',
      'horas_permiso_no_rem_8_porc',
      'horas_he_diurna_ord', 'horas_he_nocturna_ord', 'horas_rec_nocturno_ord',
      'horas_dom_diurna', 'horas_dom_general', 'horas_dom_nocturna',
      'horas_he_dom_diurna', 'horas_he_dom_nocturna', 'horas_rec_nocturno_dom',
      'horas_fest_diurna', 'horas_fest_nocturna', 'horas_he_fest_diurna',
      'horas_he_fest_nocturna', 'horas_rec_nocturno_fest',
    ],
    'nomina_bonificaciones_auxilios': [
      'bonif_1_constitutiva_salario', 'bonif_4_labor', 'bonif_5_extralegal',
      'bonif_6_mera_liberalidad', 'bonif_7_temporada',
      'bonif_8_rodamiento_movilidad', 'bonif_9_aux_vehiculo',
      'bonif_10_alim_manutencion', 'bonif_11_viaticos_ocasionales',
      'bonif_12_aux_casino', 'bonif_13_elite_ss', 'bonif_14_otros',
      'bonif_25_ipanema', 'bonif_26_temporada_ipanema',
    ],
    'nomina_descuentos_factura_detalle': [
      'desc_1_casino', 'desc_2_herramienta', 'desc_3_venta_flor',
      'desc_4_tarjeta_carnet', 'desc_5_bienestar', 'desc_6_jardin',
      'desc_7_estudio', 'desc_9_prestamo_libranza', 'desc_10_kit_escolar',
      'desc_11_faltantes', 'desc_12_vales_mercancia', 'desc_13_cambios',
      'desc_14_ajuste_casino', 'desc_15_otros',
    ],
    'nomina_incapacidades_detalle': [
      'dias_incap_eg_empresa', 'dias_incap_eg_eps', 'dias_incap_eg_90_180',
      'dias_incap_enf_profesional', 'dias_incap_atep_empresa',
      'dias_incap_atep_arl', 'dias_licencia_maternidad', 'dias_licencia_paternidad',
      'ajuste_sueldo_incap_empresa', 'ajuste_dcto_incap_empresa',
    ],
    'nomina_ajustes_nomina_detalle': [
      'ajuste_prestaciones_sociales', 'ajuste_seguridad_social',
      'valor_ajuste_salario', 'valor_ajuste_nomina', 'valor_ajuste_transporte',
      'valor_prima_ajuste_prima',
    ],
  };

  camposDeTablaSeleccionada(): string[] {
    const t = this.form?.get('tabla_destino')?.value;
    return t ? (this.CAMPOS_POR_TABLA[t] ?? []) : [];
  }

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<ConceptoFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { concepto: ConceptoNomina | null },
    private nominaService: NominaService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.isEditing = !!this.data.concepto;
    const c = this.data.concepto;
    this.form = this.fb.group({
      codigo:        [c?.codigo ?? '', [Validators.required, Validators.pattern(/^[A-Z0-9_]+$/i)]],
      descripcion:   [c?.descripcion ?? '', Validators.required],
      abreviatura:   [c?.abreviatura ?? ''],
      naturaleza:    [c?.naturaleza ?? '', Validators.required],
      unidad:        [c?.unidad ?? 'DIA', Validators.required],
      categoria:     [c?.categoria ?? null],
      agrupador:     [c?.agrupador ?? null, Validators.required],
      tabla_destino: [c?.tabla_destino ?? null],
      campo_destino: [c?.campo_destino ?? null],
      afecta_ibc:    [c?.afecta_ibc ?? false],
      activo:        [c?.activo ?? true],
    });

    // Si la tabla cambia, el campo previo deja de ser válido — lo reseteamos
    // para forzar al usuario a elegir uno coherente con la nueva tabla.
    this.form.get('tabla_destino')!.valueChanges.subscribe((nuevaTabla) => {
      const campoActual = this.form.get('campo_destino')!.value;
      const camposValidos = nuevaTabla ? (this.CAMPOS_POR_TABLA[nuevaTabla] ?? []) : [];
      if (!campoActual || !camposValidos.includes(campoActual)) {
        this.form.get('campo_destino')!.setValue(null, { emitEvent: false });
      }
    });
  }

  guardar(): void {
    if (this.form.invalid) return;
    this.saving = true;
    const payload: ConceptoNomina = this.form.value;

    const op$ = this.isEditing
      ? this.nominaService.actualizarConcepto(this.data.concepto!.id_concepto!, payload)
      : this.nominaService.crearConcepto(payload);

    op$.subscribe({
      next: () => {
        this.snackBar.open(
          this.isEditing ? 'Novedad actualizada' : 'Novedad creada',
          'Cerrar',
          { duration: 2500 }
        );
        this.dialogRef.close(true);
      },
      error: (err) => {
        const msg = err?.error?.codigo?.[0] ?? err?.error?.detail ?? 'Error al guardar';
        this.snackBar.open(msg, 'Cerrar', { duration: 4000 });
        this.saving = false;
        this.cdr.markForCheck();
      },
    });
  }

  cancelar(): void {
    this.dialogRef.close(false);
  }
}

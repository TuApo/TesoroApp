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
import { MatTooltipModule } from '@angular/material/tooltip';

import { CorreosService } from '../../services/correos.service';
import {
  CorreoCuenta,
  CorreoCuentaUpsert,
  limiteEfectivo,
  PROVEEDORES_CORREO,
  PROVEEDORES_CON_AUTENTICACION,
  ProveedorCorreo,
  SMTP_POR_DEFECTO,
  UMBRAL_CORTE_PCT,
} from '../../models/correo-cuenta.model';

/**
 * Formulario crear/editar de cuenta remitente (modal). Mismo patrón que el
 * diálogo de Entidades Externas.
 *
 * Reglas de credencial (espejo del backend):
 *  - en creación, la contraseña es obligatoria cuando la configuración autentica
 *    (Gmail/Outlook/Yandex siempre; SMTP propio/Otro solo si hay usuario);
 *  - en edición el campo arranca VACÍO: nunca se precarga el valor almacenado.
 *    Dejarlo vacío conserva la credencial; escribir una nueva la reemplaza;
 *  - cambiar proveedor, host, puerto, usuario o contraseña devuelve la cuenta a
 *    "Pendiente" y hay que volver a verificarla (se advierte en pantalla).
 */
@Component({
  selector: 'app-correo-form-dialog',
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
    MatTooltipModule,
  ],
  template: `
    <div class="dialog-header">
      <mat-icon class="dialog-icon">{{ isEditing ? 'edit_note' : 'mark_email_read' }}</mat-icon>
      <div>
        <h2 mat-dialog-title>{{ isEditing ? 'Editar cuenta remitente' : 'Nueva cuenta remitente' }}</h2>
        <p class="dialog-subtitle">Cuenta desde la cual la plataforma enviará correos</p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <mat-dialog-content>
      <div class="aviso aviso-warn" *ngIf="isEditing && cambioSensible">
        <mat-icon>warning</mat-icon>
        <span>Cambiaste la configuración SMTP: la cuenta quedará <b>Pendiente</b> y
          deberás verificarla de nuevo antes de que vuelva a aportar cuota.</span>
      </div>

      <form [formGroup]="form" class="form-grid">

        <mat-form-field appearance="outline" class="col-2">
          <mat-label>Dirección de correo</mat-label>
          <input matInput formControlName="direccion" placeholder="envios@tuapo.co" maxlength="190">
          <mat-icon matSuffix>alternate_email</mat-icon>
          <mat-error *ngIf="form.get('direccion')?.hasError('required')">La dirección es obligatoria</mat-error>
          <mat-error *ngIf="form.get('direccion')?.hasError('email')">Formato de correo inválido</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Nombre visible del remitente</mat-label>
          <input matInput formControlName="nombre_mostrar" placeholder="Ej: Nómina TuApo" maxlength="120">
          <mat-hint>Opcional</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Propósito</mat-label>
          <input matInput formControlName="proposito" placeholder="Ej: Nómina, Afiliaciones" maxlength="60">
          <mat-hint>Área o proceso dueño (opcional)</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Proveedor</mat-label>
          <mat-select formControlName="proveedor" (selectionChange)="onProveedorChange()">
            <mat-option *ngFor="let p of PROVEEDORES" [value]="p.value">{{ p.label }}</mat-option>
          </mat-select>
          <mat-error *ngIf="form.get('proveedor')?.hasError('required')">El proveedor es obligatorio</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Usuario SMTP</mat-label>
          <input matInput formControlName="smtp_usuario" placeholder="Normalmente el mismo correo" maxlength="190">
          <mat-hint>{{ autenticaSiempre() ? 'Si lo dejas vacío se usa la dirección' : 'Vacío = relay sin autenticación' }}</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Host SMTP</mat-label>
          <input matInput formControlName="smtp_host" placeholder="smtp.dominio.com" maxlength="190">
          <mat-error *ngIf="form.get('smtp_host')?.hasError('required')">El host es obligatorio para este proveedor</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Puerto SMTP</mat-label>
          <input matInput type="number" formControlName="smtp_port" placeholder="465">
          <mat-error *ngIf="form.get('smtp_port')?.hasError('required')">El puerto es obligatorio para este proveedor</mat-error>
          <mat-error *ngIf="form.get('smtp_port')?.hasError('min') || form.get('smtp_port')?.hasError('max')">
            Debe estar entre 1 y 65535
          </mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="col-2">
          <mat-label>{{ isEditing ? 'Nueva contraseña SMTP' : 'Contraseña SMTP' }}</mat-label>
          <input matInput [type]="verPassword ? 'text' : 'password'" formControlName="smtp_password"
                 autocomplete="new-password" placeholder="{{ isEditing ? 'Dejar vacío para conservar la actual' : '' }}">
          <button mat-icon-button matSuffix type="button" (click)="verPassword = !verPassword"
                  [matTooltip]="verPassword ? 'Ocultar' : 'Mostrar'">
            <mat-icon>{{ verPassword ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
          <mat-error *ngIf="form.get('smtp_password')?.hasError('required')">
            La contraseña es obligatoria para esta configuración
          </mat-error>
          <mat-hint *ngIf="isEditing">
            {{ data.cuenta?.credencial_configurada ? 'Credencial configurada.' : 'Sin credencial guardada.' }}
            Escribir una nueva contraseña reemplazará la actual.
          </mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="col-2">
          <mat-label>Disponible de envío</mat-label>
          <input matInput type="number" formControlName="cuota_diaria" placeholder="500">
          <span matSuffix>&nbsp;correos/día</span>
          <mat-hint>
            Corte automático al {{ UMBRAL_CORTE }}%: la cuenta dejará de enviar al llegar a
            <b>{{ limiteEfectivo() | number }}</b> correos.
          </mat-hint>
          <mat-error *ngIf="form.get('cuota_diaria')?.hasError('required')">El disponible es obligatorio</mat-error>
          <mat-error *ngIf="form.get('cuota_diaria')?.hasError('min')">No puede ser negativa</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="col-2">
          <mat-label>Notas</mat-label>
          <input matInput formControlName="notas" maxlength="255" placeholder="Opcional">
        </mat-form-field>

      </form>

    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancelar()" [disabled]="saving">Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="form.invalid || saving">
        <mat-spinner *ngIf="saving" diameter="18" style="display:inline-block;margin-right:6px"></mat-spinner>
        {{ isEditing ? 'Guardar cambios' : 'Crear cuenta' }}
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
    .col-2 { grid-column: 1 / -1; }
    .aviso {
      display: flex; align-items: flex-start; gap: 8px;
      border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 13px; line-height: 1.35;
    }
    .aviso mat-icon { font-size: 18px; width: 18px; height: 18px; margin-top: 1px; }
    .aviso-warn { background: #fff4e5; color: #8a5300; border: 1px solid #ffd8a8; }
    .aviso-info { background: #eef2ff; color: #33408a; border: 1px solid #c7d2fe; margin: 12px 0 0; }
    mat-dialog-actions { padding: 12px 24px 16px !important; }
    @media (max-width: 640px) { .form-grid { grid-template-columns: 1fr; } }
  `],
})
export class CorreoFormDialogComponent implements OnInit {
  readonly PROVEEDORES = PROVEEDORES_CORREO;
  /** Debe coincidir con tuapo.correos.umbral-corte-pct del backend. */
  /** Se toma del backend (data.umbralCortePct); la constante es solo el respaldo. */
  UMBRAL_CORTE = UMBRAL_CORTE_PCT;

  form!: FormGroup;
  isEditing = false;
  saving = false;
  verPassword = false;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CorreoFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { cuenta: CorreoCuenta | null; umbralCortePct?: number },
    private correos: CorreosService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const c = this.data?.cuenta ?? null;
    this.isEditing = !!c;
    this.UMBRAL_CORTE = this.data?.umbralCortePct ?? c?.umbral_corte_pct ?? UMBRAL_CORTE_PCT;

    this.form = this.fb.group({
      direccion: [c?.direccion ?? '', [Validators.required, Validators.email]],
      nombre_mostrar: [c?.nombre_mostrar ?? ''],
      proveedor: [c?.proveedor ?? '', [Validators.required]],
      proposito: [c?.proposito ?? ''],
      smtp_host: [c?.smtp_host ?? ''],
      smtp_port: [c?.smtp_port ?? null, [Validators.min(1), Validators.max(65535)]],
      smtp_usuario: [c?.smtp_usuario ?? ''],
      // Nunca se precarga la credencial almacenada.
      smtp_password: [''],
      cuota_diaria: [c?.cuota_diaria ?? 0, [Validators.required, Validators.min(0)]],
      notas: [c?.notas ?? ''],
    });

    this.aplicarReglasProveedor();
    this.form.get('smtp_usuario')?.valueChanges.subscribe(() => this.aplicarReglasProveedor());
  }

  /** Tope al que se corta el envío con la cuota que hay escrita ahora mismo. */
  limiteEfectivo(): number {
    return limiteEfectivo(Number(this.form?.get('cuota_diaria')?.value ?? 0), this.UMBRAL_CORTE);
  }

  /** true si el proveedor seleccionado autentica siempre (Gmail/Outlook/Yandex). */
  autenticaSiempre(): boolean {
    const p = this.form?.get('proveedor')?.value as ProveedorCorreo | '';
    return !!p && PROVEEDORES_CON_AUTENTICACION.includes(p as ProveedorCorreo);
  }

  /** Configuración que autentica: proveedor obligatorio, o usuario digitado. */
  requiereCredencial(): boolean {
    if (this.autenticaSiempre()) return true;
    return !!(this.form?.get('smtp_usuario')?.value ?? '').toString().trim();
  }

  /** Al cambiar de proveedor se sugieren host/puerto conocidos si están vacíos. */
  onProveedorChange(): void {
    const p = this.form.get('proveedor')?.value as ProveedorCorreo;
    const def = p ? SMTP_POR_DEFECTO[p] : null;
    if (def) {
      this.form.patchValue({ smtp_host: def.host, smtp_port: def.port });
    }
    this.aplicarReglasProveedor();
  }

  /**
   * Host/puerto son obligatorios cuando el proveedor no trae valores por
   * defecto; la contraseña es obligatoria solo al CREAR una configuración que
   * autentica (en edición se puede conservar la existente).
   */
  private aplicarReglasProveedor(): void {
    const p = this.form.get('proveedor')?.value as ProveedorCorreo | '';
    const sinDefaults = !!p && !SMTP_POR_DEFECTO[p as ProveedorCorreo];

    const host = this.form.get('smtp_host')!;
    const port = this.form.get('smtp_port')!;
    host.setValidators(sinDefaults ? [Validators.required] : []);
    port.setValidators(
      sinDefaults
        ? [Validators.required, Validators.min(1), Validators.max(65535)]
        : [Validators.min(1), Validators.max(65535)],
    );
    host.updateValueAndValidity({ emitEvent: false });
    port.updateValueAndValidity({ emitEvent: false });

    const pass = this.form.get('smtp_password')!;
    const obligatoria = !this.isEditing && this.requiereCredencial();
    pass.setValidators(obligatoria ? [Validators.required] : []);
    pass.updateValueAndValidity({ emitEvent: false });
  }

  /** true si el usuario tocó algo que invalida la verificación. */
  get cambioSensible(): boolean {
    const c = this.data?.cuenta;
    if (!c || !this.form) return false;
    const v = this.form.getRawValue();
    return (
      v.proveedor !== c.proveedor ||
      (v.smtp_host || null) !== (c.smtp_host || null) ||
      (v.smtp_port ?? null) !== (c.smtp_port ?? null) ||
      (v.smtp_usuario || null) !== (c.smtp_usuario || null) ||
      !!(v.smtp_password || '').toString().trim()
    );
  }

  /** Arma el payload; `smtp_password` solo viaja si el operador escribió una. */
  construirPayload(): CorreoCuentaUpsert {
    const v = this.form.getRawValue();
    const password = (v.smtp_password ?? '').toString().trim();
    const payload: CorreoCuentaUpsert = {
      direccion: (v.direccion ?? '').trim(),
      nombre_mostrar: (v.nombre_mostrar ?? '').trim() || null,
      proveedor: v.proveedor as ProveedorCorreo,
      proposito: (v.proposito ?? '').trim() || null,
      smtp_host: (v.smtp_host ?? '').trim() || null,
      smtp_port: v.smtp_port === '' || v.smtp_port === null || v.smtp_port === undefined ? null : Number(v.smtp_port),
      smtp_usuario: (v.smtp_usuario ?? '').trim() || null,
      cuota_diaria: Number(v.cuota_diaria ?? 0),
      notas: (v.notas ?? '').trim() || null,
    };
    if (password) payload.smtp_password = password;
    return payload;
  }

  guardar(): void {
    if (this.form.invalid) return;
    this.saving = true;
    const payload = this.construirPayload();

    const op$ = this.isEditing
      ? this.correos.actualizar(this.data.cuenta!.id, payload)
      : this.correos.crear(payload);

    op$.subscribe({
      next: () => {
        this.snackBar.open(
          this.isEditing ? 'Cuenta actualizada correctamente.' : 'Cuenta creada correctamente.',
          'Cerrar', { duration: 2500 },
        );
        this.dialogRef.close(true);
      },
      error: (err) => {
        // El backend responde { error: "mensaje" } para 400/404/409/422.
        const msg = err?.error?.error ?? err?.error?.message ?? 'No se pudo guardar la cuenta de correo';
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

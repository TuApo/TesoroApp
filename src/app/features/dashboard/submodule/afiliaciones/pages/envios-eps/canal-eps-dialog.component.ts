import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';

import { EnviosEpsService } from '../../services/envios-eps.service';
import { CanalEps, CanalEpsConfig, CanalEpsRequest, ETIQUETA_CANAL, ICONO_CANAL } from '../../models/envios-eps.models';

/**
 * Configuración de UNA EPS: si está activa, por qué canal se afilia y con qué datos. Sin
 * `data` crea una EPS nueva (las que no venían en el catálogo inicial).
 */
@Component({
  selector: 'app-canal-eps-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatSlideToggleModule, MatCheckboxModule, MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data ? data.nombre : 'Agregar EPS' }}</h2>
    <mat-dialog-content [formGroup]="form" class="ce">
      <div class="ce-fila">
        <mat-slide-toggle formControlName="activa">
          {{ form.value.activa ? 'Activa: se afilia por este módulo' : 'Inactiva: no aparece en la bandeja' }}
        </mat-slide-toggle>
        @if (data?.tiene_plantilla) {
          <span class="ce-chip"><mat-icon>description</mat-icon> Tiene plantilla de formato</span>
        }
      </div>

      <div class="ce-grid">
        <mat-form-field appearance="outline">
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" maxlength="200">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>NIT</mat-label>
          <input matInput formControlName="nit" maxlength="30">
        </mat-form-field>
      </div>

      <p class="ce-etq">¿Cómo se afilia?</p>
      <mat-button-toggle-group formControlName="canal" class="ce-canal" aria-label="Canal de afiliación">
        @for (c of canales; track c) {
          <mat-button-toggle [value]="c"><mat-icon>{{ icono[c] }}</mat-icon> {{ etiqueta[c] }}</mat-button-toggle>
        }
      </mat-button-toggle-group>

      @switch (form.value.canal) {
        @case ('CORREO') {
          <section class="ce-bloque">
            <div class="ce-grid">
              <mat-form-field appearance="outline">
                <mat-label>Tramitador / responsable</mat-label>
                <input matInput formControlName="tramitador_nombre" maxlength="200">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Personas por correo</mat-label>
                <input matInput type="number" min="1" max="60" formControlName="max_personas_correo">
                <mat-hint>Con la cédula de cada una el correo no puede pasar de 20 MB</mat-hint>
              </mat-form-field>
            </div>
            <mat-form-field appearance="outline" class="ce-ancho">
              <mat-label>Correo de destino</mat-label>
              <input matInput formControlName="correo_destino" placeholder="tramitador@eps.com">
              <mat-hint>Varios separados por coma: el primero va en «Para» y el resto en copia</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline" class="ce-ancho">
              <mat-label>Con copia a</mat-label>
              <input matInput formControlName="correo_cc">
            </mat-form-field>
            <mat-form-field appearance="outline" class="ce-ancho">
              <mat-label>Asunto</mat-label>
              <input matInput formControlName="asunto" maxlength="255" [placeholder]="asuntoPorDefecto">
              <mat-hint>{{ ayudaAsunto }}</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline" class="ce-ancho">
              <mat-label>Texto antes de la tabla de personas</mat-label>
              <textarea matInput formControlName="cuerpo_intro" rows="4"
                        placeholder="Si lo deja vacío se usa un saludo estándar con el empleador y su NIT"></textarea>
            </mat-form-field>
            <div class="ce-checks">
              <mat-checkbox formControlName="adjuntar_cedula">Adjuntar la cédula de cada persona</mat-checkbox>
              <mat-checkbox formControlName="adjuntar_excel">Adjuntar el Excel con los datos</mat-checkbox>
              @if (data?.tiene_plantilla) {
                <mat-checkbox formControlName="adjuntar_formato">Adjuntar el formato de afiliación generado</mat-checkbox>
              } @else {
                <span class="ce-nota">Sin plantilla de formato cargada: el correo no puede llevar el formato generado.</span>
              }
            </div>
          </section>
        }
        @case ('PLATAFORMA') {
          <section class="ce-bloque">
            <mat-form-field appearance="outline" class="ce-ancho">
              <mat-label>Dirección de la plataforma</mat-label>
              <input matInput formControlName="plataforma_url" placeholder="https://…">
            </mat-form-field>
            <mat-form-field appearance="outline" class="ce-ancho">
              <mat-label>Usuario</mat-label>
              <input matInput formControlName="plataforma_usuario" maxlength="200" autocomplete="off">
              <mat-hint>La contraseña NO se guarda aquí</mat-hint>
            </mat-form-field>
          </section>
        }
      }

      <mat-form-field appearance="outline" class="ce-ancho">
        <mat-label>Datos e instrucciones para registrar</mat-label>
        <textarea matInput formControlName="instrucciones" rows="4"
                  placeholder="Pasos, documentos que pide, horario, teléfono de contacto…"></textarea>
      </mat-form-field>

      <mat-checkbox formControlName="confirmacion_directa">
        Esta EPS suele confirmar en el acto (sugerir «confirmación directa» en el seguimiento)
      </mat-checkbox>

      @if (error()) { <p class="ce-error" role="alert"><mat-icon>error</mat-icon> {{ error() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button (click)="guardar()" [disabled]="guardando() || form.invalid">
        {{ guardando() ? 'Guardando…' : 'Guardar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .ce { display: flex; flex-direction: column; gap: 6px; min-width: min(640px, 86vw); }
    .ce-fila { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .ce-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
    .ce-ancho { width: 100%; }
    .ce-etq { margin: 4px 0; font-size: 13px; color: var(--text-2); }
    .ce-canal { margin-bottom: 12px; flex-wrap: wrap; }
    .ce-canal mat-icon { vertical-align: middle; margin-right: 4px; font-size: 18px; width: 18px; height: 18px; }
    .ce-bloque { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; }
    .ce-checks { display: flex; flex-direction: column; gap: 2px; }
    .ce-nota { font-size: 12px; color: var(--text-faint); padding: 6px 0; }
    .ce-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--ok-bg); color: var(--success); }
    .ce-chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ce-error { display: flex; align-items: center; gap: 6px; color: var(--danger); background: var(--danger-bg); padding: 8px 10px; border-radius: 8px; margin: 8px 0 0; }
    @media (max-width: 600px) { .ce-grid { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class CanalEpsDialogComponent {
  readonly data = inject<CanalEpsConfig | null>(MAT_DIALOG_DATA, { optional: true });
  private ref = inject(MatDialogRef<CanalEpsDialogComponent, CanalEpsConfig>);
  private svc = inject(EnviosEpsService);
  private fb = inject(FormBuilder);

  readonly canales: CanalEps[] = ['CORREO', 'PLATAFORMA', 'MANUAL'];
  readonly etiqueta = ETIQUETA_CANAL;
  readonly icono = ICONO_CANAL;
  // Las llaves se arman en TypeScript: en la plantilla Angular las tomaría por interpolación/ICU.
  readonly asuntoPorDefecto = 'Solicitud de afiliación {eps} - {temporal} - {fecha} ({total} personas)';
  readonly ayudaAsunto = 'Puede usar {eps}, {temporal}, {fecha} y {total}';

  guardando = signal(false);
  error = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    nombre: [this.data?.nombre ?? '', Validators.required],
    nit: [this.data?.nit ?? ''],
    activa: [this.data?.activa ?? true],
    canal: [(this.data?.canal ?? 'MANUAL') as CanalEps],
    tramitador_nombre: [this.data?.tramitador_nombre ?? ''],
    correo_destino: [this.data?.correo_destino ?? ''],
    correo_cc: [this.data?.correo_cc ?? ''],
    asunto: [this.data?.asunto ?? ''],
    cuerpo_intro: [this.data?.cuerpo_intro ?? ''],
    adjuntar_cedula: [this.data?.adjuntar_cedula ?? true],
    adjuntar_formato: [this.data?.adjuntar_formato ?? false],
    adjuntar_excel: [this.data?.adjuntar_excel ?? true],
    max_personas_correo: [this.data?.max_personas_correo ?? 20, [Validators.min(1), Validators.max(60)]],
    plataforma_url: [this.data?.plataforma_url ?? ''],
    plataforma_usuario: [this.data?.plataforma_usuario ?? ''],
    instrucciones: [this.data?.instrucciones ?? ''],
    confirmacion_directa: [this.data?.confirmacion_directa ?? false],
  });

  guardar() {
    // Los textos viajan aunque estén vacíos: así se puede BORRAR un correo de copia. El backend
    // trata "" como "quitar" y null como "no tocar".
    const req: CanalEpsRequest = { ...this.form.getRawValue(), max_personas_correo: Number(this.form.value.max_personas_correo) };
    this.guardando.set(true);
    this.error.set(null);
    const op = this.data ? this.svc.guardarCanal(this.data.eps_key, req) : this.svc.crearCanal(req);
    op.subscribe({
      next: c => { this.guardando.set(false); this.ref.close(c); },
      error: (e: HttpErrorResponse) => {
        this.guardando.set(false);
        this.error.set(e.error?.error ?? 'No se pudo guardar la configuración.');
      },
    });
  }
}

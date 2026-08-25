import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { FieldRendererComponent } from '@/app/shared/components/forms/field-renderer/field-renderer.component';
import { DynamicField, FieldValue } from '@/app/shared/components/forms/field.model';

import { DynamicFormService } from '../../services/dynamic-form.service';
import { ProcessControlService } from '../../services/process-control.service';
import { ApiProblem } from '../../models/dynamic-forms.models';
import { FormColumn, ProcessRecord } from '../../models/process.models';

export interface RecordEditData {
  formId: number;
  record: ProcessRecord;
  /** Solo las columnas que el rol puede escribir; el diálogo no muestra ninguna otra. */
  columns: FormColumn[];
}

/** Una columna editable con su campo real, para poder pintarla con su tipo. */
interface CampoEditable {
  column: FormColumn;
  field: DynamicField;
}

/**
 * EDITAR UN REGISTRO por columnas.
 *
 * Solo aparecen las columnas concedidas al rol, y se pintan con el MISMO renderer que el
 * formulario: una fecha se edita como fecha y una lista como lista, con sus opciones
 * reales (incluidas las que vienen de un origen parametrizado). Escribir a mano un
 * "input de texto para todo" habría dejado pasar valores que el validador rechaza después.
 *
 * Se envían al servidor únicamente las columnas que CAMBIARON: el endpoint es un PATCH
 * parcial, así que mandar el resto solo abriría la puerta a pisar algo sin querer.
 */
@Component({
  selector: 'app-record-edit-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, FieldRendererComponent,
    MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressBarModule, MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title class="red-titulo">
      <mat-icon aria-hidden="true">edit_note</mat-icon>
      Editar registro {{ data.record.id }}
      @if (data.record.record_key) {
        <span class="red-llave">· {{ data.record.record_key }}</span>
      }
    </h2>

    @if (cargando()) {
      <mat-progress-bar mode="indeterminate"></mat-progress-bar>
    }

    <mat-dialog-content class="red-contenido">
      @if (error()) {
        <div class="red-error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span>{{ error() }}</span>
        </div>
      }

      @if (campos().length === 0 && !cargando()) {
        <p class="red-vacio">
          No hay columnas habilitadas para editar en esta versión del formulario.
        </p>
      } @else {
        <p class="red-ayuda">
          Se guardan solo las columnas que cambies. Cada cambio queda en el historial del
          registro con tu usuario, la fecha y el valor anterior.
        </p>

        <div class="red-campos">
          @for (c of campos(); track c.column.key) {
            <app-field-renderer
              [field]="c.field"
              mode="preview"
              [value]="valorDe(c.column.key)"
              [formValues]="valoresDeSeccion(c.column.section)"
              (valueChange)="cambiar(c.column.key, $event)" />
          }
        </div>

        <mat-form-field appearance="outline" class="red-nota">
          <mat-label>Motivo del cambio (opcional)</mat-label>
          <input matInput [(ngModel)]="nota" maxlength="512"
                 placeholder="Ej. Corrección reportada por la oficina">
          <mat-hint>Queda guardado en el historial junto al cambio.</mat-hint>
        </mat-form-field>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="cerrar()" [disabled]="guardando()">Cancelar</button>
      <button mat-flat-button class="red-guardar" (click)="guardar()"
              [disabled]="guardando() || cantidadCambios() === 0">
        <mat-icon>save</mat-icon>
        Guardar
        @if (cantidadCambios() > 0) {
          <span>&nbsp;({{ cantidadCambios() }})</span>
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .red-titulo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--navy, #21263c);
    }
    .red-llave { font-weight: 500; color: var(--muted, #64748b); }
    .red-contenido { padding-top: 8px !important; }
    .red-ayuda {
      margin: 0 0 14px;
      font-size: 0.82rem;
      color: var(--muted, #64748b);
    }
    .red-vacio { color: var(--muted, #64748b); }
    .red-campos { display: flex; flex-direction: column; gap: 14px; }
    .red-nota { width: 100%; margin-top: 18px; }
    .red-error {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #fee2e2;
      color: #991b1b;
      font-size: 0.85rem;
    }
    .red-guardar {
      background-color: var(--lime, #8cd50a) !important;
      color: var(--navy, #21263c) !important;
      font-weight: 600 !important;
    }
  `],
})
export class RecordEditDialogComponent {
  readonly data = inject<RecordEditData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<RecordEditDialogComponent>);
  private destroyRef = inject(DestroyRef);
  private formsSvc = inject(DynamicFormService);
  private svc = inject(ProcessControlService);

  readonly campos = signal<CampoEditable[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  /** Valores en edición, por clave "seccion__campo". */
  private readonly valores = signal<Record<string, FieldValue>>({});
  /** Valores originales, para saber qué cambió de verdad. */
  private originales: Record<string, FieldValue> = {};

  nota = '';

  readonly cantidadCambios = computed(() => Object.keys(this.cambios()).length);

  constructor() {
    this.cargarEstructura();
  }

  /**
   * La estructura se pide con la VERSIÓN del registro, no con la vigente: un registro
   * viejo se edita con las preguntas que tenía cuando se respondió, o los valores no
   * cuadrarían con las opciones que se muestran.
   */
  private cargarEstructura(): void {
    const record = this.data.record;
    this.formsSvc.structure(this.data.formId, record.version ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: est => {
          const permitidas = new Set(this.data.columns.map(c => c.key));
          const encontrados: CampoEditable[] = [];
          const valores: Record<string, FieldValue> = {};

          for (const seccion of est.sections ?? []) {
            for (const campo of seccion.fields ?? []) {
              const key = `${seccion.code ?? ''}__${campo.name ?? ''}`;
              if (!permitidas.has(key)) continue;
              const columna = this.data.columns.find(c => c.key === key);
              if (!columna) continue;
              encontrados.push({ column: columna, field: campo });
              valores[key] = (record.values?.[key] ?? null) as FieldValue;
            }
          }
          this.originales = { ...valores };
          this.valores.set(valores);
          this.campos.set(encontrados);
          this.cargando.set(false);
        },
        error: (e: HttpErrorResponse) => {
          this.cargando.set(false);
          this.error.set(this.mensaje(e, 'No se pudo cargar la estructura del formulario.'));
        },
      });
  }

  valorDe(key: string): FieldValue {
    return this.valores()[key] ?? null;
  }

  /** El resto de valores de la misma sección: los orígenes en cascada los necesitan. */
  valoresDeSeccion(section: string): Record<string, FieldValue> {
    const prefijo = section + '__';
    const out: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(this.valores())) {
      if (k.startsWith(prefijo)) out[k.substring(prefijo.length)] = v;
    }
    return out;
  }

  cambiar(key: string, valor: FieldValue): void {
    this.valores.update(v => ({ ...v, [key]: valor }));
  }

  /** Solo lo que difiere del original: el PATCH no debe tocar nada más. */
  private cambios(): Record<string, FieldValue> {
    const out: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(this.valores())) {
      if (JSON.stringify(v ?? null) !== JSON.stringify(this.originales[k] ?? null)) out[k] = v;
    }
    return out;
  }

  guardar(): void {
    const cambios = this.cambios();
    if (Object.keys(cambios).length === 0) return;
    this.guardando.set(true);
    this.error.set(null);
    this.svc.updateRecord(this.data.record.id, cambios, this.nota.trim() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: actualizado => {
          this.guardando.set(false);
          this.ref.close(actualizado);
        },
        error: (e: HttpErrorResponse) => {
          this.guardando.set(false);
          this.error.set(this.mensaje(e, 'No se pudo guardar el cambio.'));
        },
      });
  }

  cerrar(): void {
    this.ref.close();
  }

  private mensaje(e: HttpErrorResponse, porDefecto: string): string {
    const p = e?.error as ApiProblem | undefined;
    return p?.detail || p?.title || porDefecto;
  }
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TareasApiService } from '../../services/tareas-api.service';
import { Plantilla } from '../../models/tareas.models';
import { AREAS_TAREAS, mensajeError } from '../../utils/tareas-ui';

export interface GuardarPlantillaData { tableroId: number; nombre: string; descripcion: string | null }

/** "Guardar como plantilla": columnas, etiquetas y (opcional) tareas con sus plazos relativos. */
@Component({
  selector: 'app-guardar-plantilla-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Guardar como plantilla</h2>
    <mat-dialog-content class="gp">
      <p class="gp-ayuda">Quien cree un tablero podrá partir de esta estructura. Los vencimientos se guardan como «días desde el inicio».</p>
      <mat-form-field appearance="outline"><mat-label>Nombre de la plantilla</mat-label>
        <input matInput [(ngModel)]="nombre" maxlength="150" cdkFocusInitial></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Área</mat-label>
        <mat-select [(value)]="area">@for (a of areas; track a) { <mat-option [value]="a">{{ a }}</mat-option> }</mat-select></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Descripción</mat-label>
        <textarea matInput [(ngModel)]="descripcion" rows="2" maxlength="600"></textarea></mat-form-field>
      <mat-slide-toggle [(ngModel)]="incluirTareas">Incluir las tareas abiertas con su checklist</mat-slide-toggle>
      @if (error()) { <p class="gp-error"><mat-icon>error_outline</mat-icon>{{ error() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button [disabled]="!nombre.trim() || guardando()" (click)="guardar()"><mat-icon>bookmark_add</mat-icon>Guardar plantilla</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .gp { display: flex; flex-direction: column; gap: 4px; min-width: min(460px, 80vw); }
    .gp mat-form-field { width: 100%; }
    .gp-ayuda { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
    .gp-error { display: flex; gap: 6px; align-items: center; color: var(--danger-fg); background: var(--danger-bg); padding: 8px 12px; border-radius: 10px; margin: 8px 0 0; }
  `],
})
export class GuardarPlantillaDialogComponent {
  readonly data = inject<GuardarPlantillaData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<GuardarPlantillaDialogComponent, Plantilla | null>);
  private readonly api = inject(TareasApiService);

  readonly areas = AREAS_TAREAS;
  nombre = this.data.nombre;
  area = 'General';
  descripcion = this.data.descripcion ?? '';
  incluirTareas = true;
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  async guardar(): Promise<void> {
    this.guardando.set(true);
    this.error.set(null);
    try {
      this.ref.close(await this.api.plantillaDesdeTablero({
        board_id: this.data.tableroId, nombre: this.nombre.trim(), area: this.area,
        descripcion: this.descripcion.trim() || null, incluir_tareas: this.incluirTareas,
      }));
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo guardar la plantilla.'));
    } finally {
      this.guardando.set(false);
    }
  }
}

/**
 * Edicion del seguimiento SST de una incapacidad ARL: estado de la investigacion, fecha,
 * responsable y observaciones. Devuelve la fila actualizada o `undefined` si se cancela.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';

import { IncapacidadGestionService } from '../../services/incapacidad-gestion/incapacidad-gestion.service';
import {
  ETIQUETA_ESTADO_INVESTIGACION,
  EstadoInvestigacionSst,
  FilaSst,
} from '../../models/incapacidad-gestion.model';
import { mensajeDeError } from '../informes-incapacidades/informes-incapacidades.component';

@Component({
  selector: 'app-dialogo-investigacion-sst',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="sst-titulo"><mat-icon>fact_check</mat-icon> Seguimiento de la investigacion</h2>
    <mat-dialog-content class="sst-contenido">
      <p class="sst-persona"><strong>{{ fila.nombreCompleto }}</strong> · CC {{ fila.cedula }} · {{ fila.tipoIncapacidadEtiqueta }} · {{ fila.fechaInicio }} → {{ fila.fechaFin }}</p>
      <mat-form-field appearance="outline">
        <mat-label>Estado de la investigacion</mat-label>
        <mat-select [(ngModel)]="estado">
          @for (e of estados; track e[0]) { <mat-option [value]="e[0]">{{ e[1] }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Fecha de la investigacion</mat-label>
        <input matInput type="date" [(ngModel)]="fechaInvestigacion" />
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Responsable (SST)</mat-label>
        <input matInput [(ngModel)]="responsable" maxlength="160" />
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Observaciones</mat-label>
        <textarea matInput [(ngModel)]="observaciones" rows="3" maxlength="2000"></textarea>
      </mat-form-field>
      @if (error()) { <p class="sst-error" role="alert"><mat-icon>error</mat-icon> {{ error() }}</p> }
      @if (guardando()) { <mat-progress-bar mode="indeterminate" /> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close(undefined)">Cancelar</button>
      <button mat-flat-button color="primary" type="button" [disabled]="guardando()" (click)="guardar()"><mat-icon>save</mat-icon> Guardar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .sst-titulo { display: flex; align-items: center; gap: 8px; font-weight: 800; }
    .sst-contenido { display: flex; flex-direction: column; gap: 4px; min-width: min(520px, 90vw); }
    .sst-persona { margin: 0 0 8px; font-size: 13px; color: #475569; }
    .sst-error { display: flex; align-items: center; gap: 6px; color: #c62828; margin: 0; font-size: 13px; }
  `],
})
export class DialogoInvestigacionSstComponent {
  readonly ref = inject(MatDialogRef<DialogoInvestigacionSstComponent, FilaSst | undefined>);
  readonly fila = inject<FilaSst>(MAT_DIALOG_DATA);
  private readonly srv = inject(IncapacidadGestionService);

  readonly estados = Object.entries(ETIQUETA_ESTADO_INVESTIGACION) as [EstadoInvestigacionSst, string][];
  estado: EstadoInvestigacionSst = this.fila.investigacion.estado;
  fechaInvestigacion = this.fila.investigacion.fechaInvestigacion ?? '';
  responsable = this.fila.investigacion.responsable ?? '';
  observaciones = this.fila.investigacion.observaciones ?? '';
  readonly guardando = signal(false);
  readonly error = signal('');

  guardar(): void {
    this.guardando.set(true);
    this.error.set('');
    this.srv
      .sstActualizar(this.fila.incapacidadId, {
        estado: this.estado,
        fechaInvestigacion: this.fechaInvestigacion || null,
        responsable: this.responsable.trim(),
        observaciones: this.observaciones.trim(),
      })
      .subscribe({
        next: (f) => this.ref.close(f),
        error: (e: unknown) => { this.guardando.set(false); this.error.set(mensajeDeError(e, 'No se pudo guardar.')); },
      });
  }
}

/**
 * Homologar a mano la causal de UNA fila de la hoja Negaciones durante la revision de una carga.
 *
 * Solo elige: devuelve `{ causalId, recordar }` y la pantalla de Liquidacion hace la peticion
 * (porque ademas actualiza la tabla y las filas hermanas con el mismo texto). Se muestra la accion
 * de cada causal porque es lo que decide si la incapacidad se finaliza o pasa a recobro.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';

import { CausalNegacion, FilaLiquidacion } from '../../../models/incapacidad-salud.model';
import { claseAccion, etiquetaAccion, fechaCorta } from '../liquidacion.utils';

export interface DatosDialogoHomologarFila {
  fila: FilaLiquidacion;
  /** Causales internas ACTIVAS. */
  causales: CausalNegacion[];
}

export interface ResultadoDialogoHomologarFila {
  causalId: number;
  /** Crear la equivalencia (EPS de la fila, texto) para las proximas cargas. */
  recordar: boolean;
}

@Component({
  selector: 'app-dialogo-homologar-fila',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="hf-titulo"><mat-icon>rule</mat-icon> Homologar causal de negación</h2>
    <mat-dialog-content class="hf-contenido">
      <dl class="hf-datos">
        <div><dt>EPS</dt><dd>{{ datos.fila.eps || '—' }}</dd></div>
        <div><dt>Cédula</dt><dd>{{ datos.fila.cedula || '—' }}</dd></div>
        <div><dt>Fecha de respuesta</dt><dd>{{ fecha(datos.fila.fechaRespuesta) || '—' }}</dd></div>
        <div><dt>Fila del Excel</dt><dd>{{ datos.fila.fila }}</dd></div>
      </dl>
      <p class="hf-etiqueta">Causal que escribió la EPS</p>
      <blockquote class="hf-texto">{{ datos.fila.causalTexto || '(sin texto)' }}</blockquote>

      <mat-form-field appearance="outline" class="hf-ancho">
        <mat-label>Causal interna</mat-label>
        <mat-select [ngModel]="causalId()" (ngModelChange)="causalId.set($event)" required>
          @for (c of datos.causales; track c.id) {
            <mat-option [value]="c.id">{{ c.nombre }} · {{ accion(c.accion) }}</mat-option>
          }
        </mat-select>
        @if (datos.causales.length === 0) {
          <mat-hint>No hay causales activas: créalas en Negaciones › Causales internas.</mat-hint>
        }
      </mat-form-field>

      @if (seleccionada(); as c) {
        <p class="hf-efecto">
          <span [class]="'ges-chip ' + clase(c.accion)">{{ accion(c.accion) }}</span>
          @if (c.accion === 'FINALIZA') {
            La incapacidad quedará finalizada{{ c.terminacion ? ' como «' + c.terminacion + '»' : '' }} al aplicar la carga.
          } @else {
            La incapacidad pasará a Recobro para radicar de nuevo ante la EPS.
          }
        </p>
      }

      <mat-checkbox [ngModel]="recordar()" (ngModelChange)="recordar.set($event)">
        Recordar para esta EPS: las próximas cargas con este mismo texto se homologan solas
      </mat-checkbox>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close(undefined)">Cancelar</button>
      <button mat-flat-button color="primary" type="button" [disabled]="!causalId()" (click)="confirmar()">
        <mat-icon>check</mat-icon> Homologar
      </button>
    </mat-dialog-actions>
  `,
  styleUrls: ['../../gestion-incapacidades.comun.css'],
  styles: [`
    /* El CSS comun da fondo y alto de pagina al :host; en un dialogo sobran. */
    :host { background: transparent !important; min-height: 0 !important; }
    .hf-titulo { display: flex; align-items: center; gap: 8px; font-weight: 800; }
    .hf-contenido { display: flex; flex-direction: column; gap: 6px; min-width: min(560px, 88vw); }
    .hf-datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr)); gap: 8px 14px; margin: 0 0 6px; }
    .hf-datos dt { font-size: 11.5px; color: var(--disab-text-muted); font-weight: 600; }
    .hf-datos dd { margin: 0; font-weight: 600; color: var(--disab-text); word-break: break-word; }
    .hf-etiqueta { margin: 4px 0 0; font-size: 12px; color: var(--disab-text-muted); font-weight: 600; }
    .hf-texto { margin: 0 0 10px; padding: 8px 12px; border-left: 3px solid var(--disab-warn); background: var(--surface-2); border-radius: 6px; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
    .hf-ancho { width: 100%; }
    .hf-efecto { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; font-size: 13px; }
  `],
})
export class DialogoHomologarFilaComponent {
  readonly ref = inject(MatDialogRef<DialogoHomologarFilaComponent, ResultadoDialogoHomologarFila | undefined>);
  readonly datos = inject<DatosDialogoHomologarFila>(MAT_DIALOG_DATA);

  readonly causalId = signal<number | null>(this.datos.fila.causalId ?? null);
  /** Por defecto se recuerda: es la forma de ir armando las equivalencias por EPS sin adivinar. */
  readonly recordar = signal(true);
  readonly seleccionada = computed(() => this.datos.causales.find((c) => c.id === this.causalId()) ?? null);

  readonly fecha = fechaCorta;
  readonly accion = etiquetaAccion;
  readonly clase = claseAccion;

  confirmar(): void {
    const causalId = this.causalId();
    if (!causalId) return;
    this.ref.close({ causalId, recordar: this.recordar() });
  }
}

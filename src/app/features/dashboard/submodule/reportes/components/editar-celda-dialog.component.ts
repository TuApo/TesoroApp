import { ChangeDetectionStrategy, Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ColumnaResultado } from '../models/reportes.models';

/**
 * Editor de una celda desde la tabla de resultados (§10).
 *
 * Muestra explícitamente QUÉ se va a cambiar y de qué valor a qué valor, y exige
 * un motivo cuando el campo es sensible. No es burocracia: esta acción escribe en
 * datos reales de nómina o contratación, y el motivo queda en la auditoría junto
 * al antes y el después.
 *
 * El valor anterior viaja al servidor para que rechace el cambio si alguien más
 * modificó el dato mientras tanto.
 */
@Component({
  selector: 'app-editar-celda-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule],
  template: `
  <h2 mat-dialog-title class="tit"><mat-icon>edit_note</mat-icon> Editar dato</h2>

  <mat-dialog-content class="cuerpo">
    <p class="aviso">
      <mat-icon>info</mat-icon>
      Este cambio modifica el registro real en la base de datos, no solo el reporte.
      Queda registrado en la auditoría con tu usuario.
    </p>

    <mat-form-field appearance="outline" class="w100">
      <mat-label>Campo a editar</mat-label>
      <mat-select [(ngModel)]="columnaId" (ngModelChange)="alCambiarColumna()">
        @for (c of data.columnas; track c.id) {
          <mat-option [value]="c.id">{{ c.alias }}</mat-option>
        }
      </mat-select>
    </mat-form-field>

    <div class="cambio">
      <div class="cambio__lado">
        <span class="cambio__lbl">Valor actual</span>
        <span class="cambio__val cambio__val--antes">{{ textoAnterior() || '(vacío)' }}</span>
      </div>
      <mat-icon class="cambio__flecha">arrow_forward</mat-icon>
      <div class="cambio__lado">
        <span class="cambio__lbl">Nuevo valor</span>
        <mat-form-field appearance="outline" class="w100" subscriptSizing="dynamic">
          <input matInput [(ngModel)]="valorNuevo" [type]="tipoInput()" autofocus>
        </mat-form-field>
      </div>
    </div>

    <mat-form-field appearance="outline" class="w100">
      <mat-label>Motivo del cambio {{ obligatorio() ? '' : '(opcional)' }}</mat-label>
      <input matInput [(ngModel)]="motivo" placeholder="Por qué se corrige">
    </mat-form-field>
  </mat-dialog-content>

  <mat-dialog-actions align="end">
    <button mat-button mat-dialog-close>Cancelar</button>
    <button mat-flat-button color="primary" [disabled]="!puedeGuardar()" (click)="guardar()">
      Guardar cambio
    </button>
  </mat-dialog-actions>
  `,
  styles: [`
    .tit { display: flex; align-items: center; gap: .4rem; }
    .cuerpo { display: flex; flex-direction: column; gap: .2rem; padding-top: .5rem !important; }
    .w100 { width: 100%; }
    .aviso {
      display: flex; align-items: flex-start; gap: .4rem; margin: 0 0 .6rem;
      padding: .5rem .6rem; border-radius: 10px; font-size: .78rem;
      background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
    }
    .aviso mat-icon { font-size: 17px; width: 17px; height: 17px; flex: 0 0 auto; }
    .cambio { display: flex; align-items: center; gap: .6rem; margin-bottom: .6rem; }
    .cambio__lado { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .cambio__lbl { font-size: .68rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; }
    .cambio__val {
      font-size: .9rem; padding: .55rem .6rem; border-radius: 8px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cambio__val--antes { background: #fee2e2; color: #7f1d1d; text-decoration: line-through; }
    .cambio__flecha { color: #94a3b8; }
  `],
})
export class EditarCeldaDialogComponent {

  columnaId: string;
  valorNuevo = '';
  motivo = '';

  constructor(
    private ref: MatDialogRef<EditarCeldaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: {
      fila: Record<string, unknown>;
      columnas: ColumnaResultado[];
      todas: ColumnaResultado[];
    },
  ) {
    this.columnaId = data.columnas[0]?.id ?? '';
    this.valorNuevo = this.textoAnterior();
  }

  columna(): ColumnaResultado | undefined {
    return this.data.columnas.find(c => c.id === this.columnaId);
  }

  textoAnterior(): string {
    const v = this.data.fila[this.columnaId];
    return v === null || v === undefined ? '' : String(v);
  }

  alCambiarColumna(): void { this.valorNuevo = this.textoAnterior(); }

  tipoInput(): string {
    const c = this.columna();
    if (!c) return 'text';
    if (['ENTERO', 'DECIMAL', 'MONEDA'].includes(c.tipo)) return 'number';
    if (c.tipo === 'FECHA') return 'date';
    return 'text';
  }

  /** Un campo sensible exige justificar el cambio. */
  obligatorio(): boolean {
    const c = this.columna();
    return !!c && ['MONEDA', 'DECIMAL'].includes(c.tipo);
  }

  puedeGuardar(): boolean {
    if (!this.columna()) return false;
    if (this.valorNuevo === this.textoAnterior()) return false;
    if (this.obligatorio() && !this.motivo.trim()) return false;
    return true;
  }

  guardar(): void {
    const c = this.columna();
    if (!c || !c.dataset || !c.campo) return;
    // La clave primaria de la fila viene en la columna oculta que agrega el servidor.
    const claveFila = this.data.fila[`__pk__${c.dataset}`];
    if (claveFila === undefined || claveFila === null) {
      this.ref.close(null);
      return;
    }
    this.ref.close({
      dataset: c.dataset,
      campo: c.campo,
      clave_fila: claveFila,
      valor_anterior: this.data.fila[this.columnaId] ?? null,
      valor_nuevo: this.valorNuevo === '' ? null : this.valorNuevo,
      motivo: this.motivo.trim() || undefined,
    });
  }
}

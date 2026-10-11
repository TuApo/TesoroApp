import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TareaDetalleComponent } from './tarea-detalle.component';

/**
 * Panel lateral con el detalle de una tarea. Se abre por encima de la vista actual
 * (Mis tareas, tablero, calendario) para no perder el lugar; al cerrar devuelve si hubo
 * cambios, y la vista de atrás solo recarga en ese caso.
 */
@Component({
  selector: 'app-tarea-detalle-dialog',
  standalone: true,
  imports: [TareaDetalleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sin encapsulación a propósito: la forma del panel (pegado a la derecha, sin radios a
  // ese lado) vive en el overlay del CDK, fuera del alcance de los estilos del componente.
  encapsulation: ViewEncapsulation.None,
  template: `<app-tarea-detalle [tareaId]="data.tareaId" (cambio)="huboCambio = true" (cerrar)="ref.close(huboCambio)" />`,
  styles: [`
    .tt-drawer .mat-mdc-dialog-surface { border-radius: 22px 0 0 22px !important; background: var(--bg) !important; }
    .tt-drawer .mat-mdc-dialog-container { --mat-dialog-container-max-width: 100vw; }
    .tt-drawer.mat-mdc-dialog-panel { max-width: 100vw !important; }
    @media (max-width: 600px) {
      .tt-drawer .mat-mdc-dialog-surface { border-radius: 0 !important; }
    }
  `],
})
export class TareaDetalleDialogComponent {
  readonly data = inject<{ tareaId: number }>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<TareaDetalleDialogComponent, boolean>);
  huboCambio = false;

  constructor() {
    // Cerrar con Esc o clic afuera también debe reportar los cambios hechos.
    this.ref.backdropClick().subscribe(() => this.ref.close(this.huboCambio));
    this.ref.keydownEvents().subscribe(e => { if (e.key === 'Escape') this.ref.close(this.huboCambio); });
  }
}

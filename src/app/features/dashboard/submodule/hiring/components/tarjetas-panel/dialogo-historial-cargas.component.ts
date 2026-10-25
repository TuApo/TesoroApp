import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { HistorialCargasComponent } from '../../pages/tarjetas/historial-cargas/historial-cargas.component';

/**
 * Historial de cargas en un diálogo.
 *
 * <p>Dentro del parametrizador de vacantes no caben pestañas anidadas, así que el historial
 * se abre desde el botón del panel en vez de ocupar una pestaña propia.
 */
@Component({
  selector: 'app-dialogo-historial-cargas',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, HistorialCargasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Historial de cargas de tarjetas</h2>
    <mat-dialog-content>
      <app-historial-cargas-tarjetas></app-historial-cargas-tarjetas>
    </mat-dialog-content>
    <mat-dialog-actions>
      <span style="flex: 1 1 auto;"></span>
      <button mat-raised-button color="primary" (click)="cerrar()">Cerrar</button>
    </mat-dialog-actions>
  `,
})
export class DialogoHistorialCargasComponent {
  private readonly ref = inject<MatDialogRef<DialogoHistorialCargasComponent>>(MatDialogRef);

  cerrar(): void {
    this.ref.close();
  }
}

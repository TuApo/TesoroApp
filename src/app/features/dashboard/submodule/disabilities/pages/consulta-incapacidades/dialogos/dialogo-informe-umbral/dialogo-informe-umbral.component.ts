import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { PanelUmbralesComponent } from '../../../../components/panel-umbrales/panel-umbrales.component';

/** Ancho con el que se abre: la tabla trae fechas de los dias 181 y 541, necesita aire. */
export const ANCHO_DIALOGO_UMBRALES = '1240px';

/**
 * Informe de umbrales 180 / 540 dias (revision funcional 2026-09-28). Envoltorio del
 * `PanelUmbralesComponent`, que es quien carga, proyecta y filtra; el mismo panel vive en las
 * pestañas de Alertas e Informes para que las tres pantallas digan exactamente lo mismo.
 * Solo lectura.
 */
@Component({
  selector: 'app-dialogo-informe-umbral',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatButtonModule, MatTooltipModule, PanelUmbralesComponent],
  templateUrl: './dialogo-informe-umbral.component.html',
  styleUrl: './dialogo-informe-umbral.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoInformeUmbralComponent {
  private readonly ref = inject<MatDialogRef<DialogoInformeUmbralComponent>>(MatDialogRef);

  cerrar(): void {
    this.ref.close();
  }
}

import { ChangeDetectionStrategy, Component } from '@angular/core';

/** PROVISIONAL (base del 2026-10-06): la pantalla real la escribe su agente. */
@Component({
  selector: 'app-recobro',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p>Recobro</p>',
})
export class RecobroComponent {}

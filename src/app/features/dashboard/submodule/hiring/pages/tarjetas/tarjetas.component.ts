import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { TarjetasPanelComponent } from '../../components/tarjetas-panel/tarjetas-panel.component';

/**
 * Pantalla suelta de **Tarjetas** (menú Contratación → «Tarjetas de Contratacion»).
 *
 * <p>Solo pone la cabecera: todo lo que hace está en {@link TarjetasPanelComponent}, que es
 * el mismo que se pinta en la pestaña «Tarjetas» del parametrizador de vacantes. Dos
 * copias del listado y de la carga masiva habrían divergido a la primera corrección.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tarjetas',
  standalone: true,
  imports: [MatIconModule, TarjetasPanelComponent],
  templateUrl: './tarjetas.component.html',
  styleUrls: ['./tarjetas.component.css'],
})
export class TarjetasComponent {}

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';

/**
 * La oficina sobre la que trabaja la pantalla. Es un chip en el encabezado y no un
 * campo de cada formulario, porque casi todo el módulo es "de una oficina" y cambiarla
 * en una página tiene que cambiarla en todas.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-selector-oficina',
  imports: [MatIconModule],
  template: `
    <label class="tn-selector-oficina">
      <mat-icon>storefront</mat-icon>
      <select [value]="ctx.oficinaId() ?? ''" (change)="cambiar($event)" aria-label="Oficina">
        @if (!ctx.oficinas().length) { <option value="">Sin oficinas</option> }
        @for (o of ctx.oficinas(); track o.id) {
          <option [value]="o.id">{{ o.nombre }} · {{ o.codigo }}</option>
        }
      </select>
    </label>
  `,
  styleUrls: ['../../styles/turnos-comun.css'],
})
export class SelectorOficina {
  readonly ctx = inject(ContextoTurnosService);
  cambiar(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.ctx.seleccionarOficina(v || null);
  }
}

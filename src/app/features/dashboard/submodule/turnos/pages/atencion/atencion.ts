import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { PanelAtencion } from '../../components/panel-atencion/panel-atencion';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';

/**
 * El panel de atención a pantalla completa: el mismo componente de la pestaña (modo
 * página), que ya trae la lista de personas por atender en vivo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-atencion',
  imports: [CommonModule, MatIconModule, PanelAtencion, SelectorOficina],
  template: `
    <div class="tn-pagina">
      <header class="tn-encabezado">
        <div>
          <h1 class="tn-titulo"><mat-icon>support_agent</mat-icon> Panel de atención</h1>
          <p class="tn-subtitulo">Abra su puesto, llame a la gente en espera y lleve varios casos a la vez. El mismo panel queda plegado bajo la barra superior en cualquier pantalla.</p>
        </div>
        <app-selector-oficina />
      </header>
      <app-panel-atencion modo="pagina" />
    </div>
  `,
  styleUrls: ['../../styles/turnos-comun.css'],
})
export class Atencion implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  ngOnInit(): void { this.ctx.cargar(); }
}

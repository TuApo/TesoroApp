import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { PedidoDetallado, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EconomiaStore } from '../../economia.store';
import { ESTADO_CUPO, ESTADO_PEDIDO, PASOS_PEDIDO, TIPO_ENTREGA, pesos } from '../../economia.util';

const CERRADOS = ['ENTREGADO', 'CANCELADO', 'RECHAZADO'];

/** Mis pedidos: los que van andando arriba, el historial abajo. */
@Component({
  selector: 'eco-pedidos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, DatePipe],
  templateUrl: './pedidos.html',
  styleUrls: ['../../economiapp.css', './pedidos.css'],
})
export class EconomiaPedidos {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);

  readonly pedidos = signal<PedidoDetallado[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly pestana = signal<'curso' | 'historial'>('curso');

  readonly enCurso = computed(() => this.pedidos().filter(p => !CERRADOS.includes(p.pedido.estado)));
  readonly cerrados = computed(() => this.pedidos().filter(p => CERRADOS.includes(p.pedido.estado)));
  readonly lista = computed(() => this.pestana() === 'curso' ? this.enCurso() : this.cerrados());

  readonly ESTADO = ESTADO_PEDIDO;
  readonly CUPO = ESTADO_CUPO;
  readonly ENTREGA = TIPO_ENTREGA;
  readonly pesos = pesos;

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.misPedidosDetallados().subscribe({
      next: ps => {
        const orden = [...(ps ?? [])].sort((a, b) => (b.pedido.creado_en || '').localeCompare(a.pedido.creado_en || ''));
        this.pedidos.set(orden);
        if (!orden.some(p => !CERRADOS.includes(p.pedido.estado)) && orden.length) this.pestana.set('historial');
        this.cargando.set(false);
      },
      error: () => { this.error.set('No pudimos cargar sus pedidos'); this.cargando.set(false); },
    });
  }

  /** Avance 0–100 para la barrita de la tarjeta. */
  avance(estado: string): number {
    if (estado === 'EN_RUTA') return 85;
    const i = PASOS_PEDIDO.indexOf(estado);
    return i < 0 ? 0 : Math.round((i / (PASOS_PEDIDO.length - 1)) * 100);
  }
}

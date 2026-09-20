import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { Pedido, TiendaService } from '../../service/tienda.service';

/**
 * Bandeja de pedidos de la tienda virtual.
 *
 * <p>El orden es por antigüedad ascendente: lo primero que se ve es lo que lleva más
 * esperando. Un listado por fecha descendente esconde justo lo que hay que atender.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-pedidos',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda],
  templateUrl: './pedidos.html',
  styleUrls: ['../../styles/tienda-comun.css', './pedidos.css'],
})
export class Pedidos implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);

  readonly pedidos = signal<Pedido[]>([]);
  readonly detalle = signal<Record<string, unknown> | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  motivoRechazo = '';

  /** Estados a los que se puede avanzar desde cada estado actual. */
  readonly siguientes: Record<string, Array<{ codigo: string; nombre: string }>> = {
    CONFIRMADO: [{ codigo: 'ALISTANDO', nombre: 'Empezar a alistar' }],
    ALISTANDO: [{ codigo: 'LISTO', nombre: 'Marcar como listo' }],
    LISTO: [
      { codigo: 'EN_RUTA', nombre: 'Salió a domicilio' },
      { codigo: 'ENTREGADO', nombre: 'Entregado' },
    ],
    EN_RUTA: [{ codigo: 'ENTREGADO', nombre: 'Entregado' }],
  };

  constructor() {
    effect(() => { this.ctx.tiendaId(); this.cargar(); });
  }

  ngOnInit(): void {
    this.ctx.cargar();
  }

  cargar(): void {
    const tienda = this.ctx.tiendaId();
    if (!tienda) return;
    this.cargando.set(true);
    this.api.pedidosPendientes(tienda).subscribe({
      next: p => { this.pedidos.set(p); this.cargando.set(false); },
      error: () => { this.error.set('No se pudieron cargar los pedidos'); this.cargando.set(false); },
    });
  }

  ver(p: Pedido): void {
    this.api.detallePedido(p.id).subscribe({
      next: d => this.detalle.set(d), error: e => this.fallo(e),
    });
  }

  confirmar(p: Pedido): void {
    this.api.confirmarPedido(p.id).subscribe({
      next: () => {
        this.aviso.set(`Pedido ${p.numero} confirmado. El stock quedó apartado`
          + (p.bajo_pedido ? ' y se generó el traslado de lo que hay que traer.' : '.'));
        this.cargar();
      },
      error: e => this.fallo(e),
    });
  }

  avanzar(p: Pedido, estado: string): void {
    this.api.cambiarEstadoPedido(p.id, estado).subscribe({
      next: () => {
        this.aviso.set(`Pedido ${p.numero}: ${estado.toLowerCase()}. El comprador lo ve al instante.`);
        this.cargar();
        this.detalle.set(null);
      },
      error: e => this.fallo(e),
    });
  }

  rechazar(p: Pedido): void {
    if (!this.motivoRechazo.trim()) {
      this.error.set('Rechazar un pedido exige decir por qué: el comprador lo va a leer');
      return;
    }
    this.api.rechazarPedido(p.id, this.motivoRechazo).subscribe({
      next: () => {
        this.aviso.set(`Pedido ${p.numero} rechazado. Lo apartado se liberó.`);
        this.motivoRechazo = '';
        this.cargar();
        this.detalle.set(null);
      },
      error: e => this.fallo(e),
    });
  }

  claseEstado(estado: string): string {
    if (estado === 'ENTREGADO') return 'exito';
    if (estado === 'CANCELADO' || estado === 'RECHAZADO') return 'peligro';
    if (estado === 'CREADO') return 'aviso';
    return 'info';
  }

  private fallo(e: unknown): void {
    const cuerpo = (e as { error?: { error?: string } })?.error;
    this.error.set(cuerpo?.error ?? 'No se pudo completar la operación');
    this.aviso.set(null);
  }
}

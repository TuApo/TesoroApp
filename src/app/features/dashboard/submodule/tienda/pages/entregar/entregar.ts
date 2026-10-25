import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ActaEntrega } from '../../components/acta-entrega/acta-entrega';
import { EstadoEntrega, TiendaService } from '../../service/tienda.service';

/** Entregar un pedido en el punto: acta (verificar, documento, papel, firma) y luego ENTREGADO. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-entregar',
  imports: [CommonModule, MatIconModule, RouterLink, ActaEntrega],
  template: `
    <div class="tienda-pagina angosta">
      <div>
        <a class="atras" routerLink="/dashboard/tienda/pedidos"><mat-icon>arrow_back</mat-icon> Pedidos</a>
        <h1 class="tienda-titulo"><mat-icon>how_to_reg</mat-icon> Entregar pedido @if (acta()?.numero) { <span class="num">{{ acta()!.numero }}</span> }</h1>
        <p class="tienda-subtitulo">Verifique a quien recibe, tome la foto de su documento, firme el papel si lleva bono mercado y registre la firma de recibido.</p>
      </div>
      @if (error()) { <div class="tienda-error"><mat-icon>error</mat-icon> {{ error() }}</div> }
      @if (!hecho()) {
        <app-acta-entrega [pedidoId]="id()" canal="PUNTO" (listo)="conActa($event)" (cancelar)="volver()" />
      }
      @if (acta()?.acta && !hecho()) {
        <button type="button" class="boton" [disabled]="ocupado()" (click)="entregar()"><mat-icon>task_alt</mat-icon> Marcar entregado</button>
      }
      @if (hecho()) {
        <div class="tienda-tarjeta ok"><mat-icon>task_alt</mat-icon> Pedido entregado. El papel firmado queda en <a routerLink="/dashboard/tienda/custodia">Custodia</a> por archivar.</div>
      }
    </div>`,
  styles: [`.angosta { max-width: 760px; margin: 0 auto; width: 100%; box-sizing: border-box; }
    .atras { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); text-decoration: none; }
    .num { color: var(--muted); font-size: 16px; }
    .ok { display: flex; gap: 8px; align-items: center; color: #065f46; }`],
  styleUrls: ['../../styles/tienda-comun.css'],
})
export class Entregar {
  private api = inject(TiendaService);
  private router = inject(Router);
  readonly id = input.required<string>();
  readonly acta = signal<EstadoEntrega | null>(null);
  readonly ocupado = signal(false);
  readonly hecho = signal(false);
  readonly error = signal<string | null>(null);

  conActa(e: EstadoEntrega): void { this.acta.set(e); }
  volver(): void { this.router.navigate(['/dashboard/tienda/pedidos']); }

  async entregar(): Promise<void> {
    const efectivo = confirm('¿Recibió el efectivo que faltaba por pagar (si había)?');
    this.ocupado.set(true); this.error.set(null);
    try {
      await firstValueFrom(this.api.cambiarEstadoPedido(this.id(), 'ENTREGADO', 'Entregado con acta', efectivo));
      this.hecho.set(true);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo marcar entregado'); }
    finally { this.ocupado.set(false); }
  }
}

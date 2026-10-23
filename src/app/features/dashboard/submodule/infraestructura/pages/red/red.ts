import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { GraficaSerie } from '../../components/grafica-serie/grafica-serie';
import { DetalleRed, Rango } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { InfraVivoService } from '../../services/infra-vivo.service';
import { bps, bytes, num } from '../../utils/formato';

/**
 * La red: cuánto entra y sale por la tarjeta física, por cada red interna (Docker,
 * pods de K3s), quién mueve más datos, y si los demás equipos de la red responden.
 */
@Component({
  selector: 'app-infra-red',
  standalone: true,
  imports: [MatIconModule, GraficaSerie],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './red.html',
  styleUrls: ['../../styles/infra-comun.css', './red.css'],
})
export class InfraRed {
  private readonly api = inject(InfraService);
  readonly vivo = inject(InfraVivoService);
  readonly f = { bps, bytes, num };
  readonly rangos: Rango[] = ['1h', '6h', '24h', '7d'];
  readonly rango = signal<Rango>('24h');
  readonly datos = signal<DetalleRed | null>(null);

  readonly nicsVivas = computed(() =>
    this.vivo.snapshot()?.hosts.find((h) => h.origen === 'prometheus')?.interfaces ?? []);

  readonly maxCtr = computed(() => Math.max(1, ...(this.datos()?.contenedores ?? []).map((c) => c.rx_bytes + c.tx_bytes)));

  constructor() {
    effect(() => {
      const r = this.rango();
      untracked(() => this.api.red(r).subscribe({ next: (d) => this.datos.set(d) }));
    });
  }

  nombreNic(n: string): string {
    const d = this.datos()?.interfaces.find((x) => x.interfaz === n);
    return d?.nombre ?? n;
  }
}

import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { GraficaSerie } from '../../components/grafica-serie/grafica-serie';
import { DetalleDatos } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { bps, bytes, compacto, duracion, fecha, num, pct } from '../../utils/formato';

/** MySQL, Redis, Kafka (con el retraso de cada consumidor), OCR y los respaldos. */
@Component({
  selector: 'app-infra-datos',
  standalone: true,
  imports: [MatIconModule, GraficaSerie],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './datos.html',
  styleUrls: ['../../styles/infra-comun.css', './datos.css'],
})
export class InfraDatos {
  private readonly api = inject(InfraService);
  readonly f = { bps, bytes, compacto, duracion, fecha, num, pct };
  readonly datos = signal<DetalleDatos | null>(null);
  readonly error = signal(false);

  readonly maxEsquema = computed(() => Math.max(1, ...(this.datos()?.mysql.esquemas ?? []).map((e) => e.bytes)));
  readonly totalEsquemas = computed(() => (this.datos()?.mysql.esquemas ?? []).reduce((a, e) => a + e.bytes, 0));

  constructor() {
    const cargar = () => this.api.datos().subscribe({ next: (d) => { this.datos.set(d); this.error.set(false); }, error: () => this.error.set(true) });
    cargar();
    const t = setInterval(cargar, 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  tonoRespaldo(h?: number): string {
    if (h == null) return 'danger';
    return h > 26 ? 'danger' : h > 20 ? 'warn' : 'ok';
  }

  tonoLag(lag: number, miembros: number): string {
    if (lag > 0 && miembros === 0) return 'danger';
    return lag > 1000 ? 'danger' : lag > 100 ? 'warn' : lag > 0 ? 'info' : 'ok';
  }

  topicos(m: Record<string, number>): string {
    return Object.entries(m).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(' · ') || Object.keys(m).join(', ');
  }
}

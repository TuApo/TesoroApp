import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { DetalleSitios, Rango, Sitio } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { bytes, compacto, fecha, ms, num, pct } from '../../utils/formato';

/**
 * Cada sitio publicado (los bloques del Caddyfile y los externos): si responde, su
 * DNS, cuánto le queda al certificado y su tráfico real leído de los logs de Caddy:
 * peticiones, visitantes, errores, tiempos, qué piden, quién y con qué.
 */
@Component({
  selector: 'app-infra-sitios',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, NgxEchartsDirective],
  providers: [provideEchartsTema()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sitios.html',
  styleUrls: ['../../styles/infra-comun.css', './sitios.css'],
})
export class InfraSitios {
  private readonly api = inject(InfraService);
  readonly f = { bytes, compacto, fecha, ms, num, pct };
  readonly rangos: Rango[] = ['1h', '6h', '24h'];
  readonly rango = signal<Rango>('24h');
  readonly datos = signal<DetalleSitios | null>(null);
  readonly cargando = signal(false);
  readonly abierto = signal<string | null>(null);

  readonly conTrafico = computed(() => (this.datos()?.sitios ?? []).filter((s) => (s.peticiones ?? 0) > 0));

  constructor() {
    effect(() => {
      const r = this.rango();
      untracked(() => this.cargar(r));
    });
  }

  cargar(r: Rango) {
    this.cargando.set(true);
    this.api.sitios(r).subscribe({
      next: (d) => { this.datos.set(d); this.cargando.set(false); if (!this.abierto() && d.sitios[0]) this.abierto.set(d.sitios[0].dominio); },
      error: () => this.cargando.set(false),
    });
  }

  tono(s: Sitio): 'ok' | 'warn' | 'danger' | 'neutro' {
    if (s.estado === 'caido') return 'danger';
    if (s.dns === 'sin DNS') return 'warn';
    if (s.cert_dias != null && s.cert_dias < 20 && !(s.cert_emisor ?? '').includes('Local Authority')) return 'warn';
    return s.estado === 'ok' ? 'ok' : 'neutro';
  }

  textoEstado(s: Sitio): string {
    if (s.estado === 'caido') return 'No responde';
    if (s.dns === 'sin DNS') return 'Sin DNS público';
    if (s.estado === 'sin-sonda') return 'Solo en los logs';
    return `Responde ${s.codigo ?? ''}`;
  }

  certTexto(s: Sitio): string {
    if (!s.cert_emisor) return '—';
    if (s.cert_emisor.includes('Local Authority')) return 'Interno de Caddy (no público)';
    return `${s.cert_emisor} · vence en ${s.cert_dias} días`;
  }

  errPct(s: Sitio, n?: number): string {
    if (!s.peticiones || n == null) return '—';
    return pct((100 * n) / s.peticiones, 1);
  }

  /** Peticiones por minuto de todos los sitios con tráfico, una línea por sitio. */
  readonly grafica = computed<EChartsOption>(() => {
    const sitios = this.conTrafico().slice(0, 5);
    const paleta = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
    return {
      animation: false,
      grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { fontSize: 11 } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Number(v), 1)} /min` },
      xAxis: { type: 'time', axisLabel: { fontSize: 10, hideOverlap: true } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { opacity: 0.5 } } },
      series: sitios.map((s, i) => ({
        name: s.dominio, type: 'line', showSymbol: false, smooth: 0.2,
        lineStyle: { width: 2, color: paleta[i] }, itemStyle: { color: paleta[i] },
        data: (s.serie ?? []).map(([t, v]) => [t * 1000, v]),
      })),
    } as EChartsOption;
  });

  anchoTop(lista: { n: number }[] | undefined, n: number): number {
    const max = Math.max(1, ...(lista ?? []).map((x) => x.n));
    return (100 * n) / max;
  }
}

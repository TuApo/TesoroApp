import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { Grafica, Rango } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { NOMBRE_CHIP, bps, bytes, num } from '../../utils/formato';

/**
 * Una serie de ms-infra pintada como línea. Pide `/serie?clave=…` y se refresca sola
 * cada minuto mientras está en pantalla. Paleta categórica fija (validada para
 * daltonismo) asignada por orden de la serie, nunca reciclada: >4 series = "otras".
 */
const PALETA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];

@Component({
  selector: 'app-infra-grafica',
  standalone: true,
  imports: [NgxEchartsDirective],
  providers: [provideEchartsTema()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="vacio">{{ error() }}</div>
    } @else if (sinDatos()) {
      <div class="vacio">Sin datos en este rango.</div>
    } @else {
      <div echarts [options]="opciones()" [style.height.px]="alto()" class="lienzo" role="img" [attr.aria-label]="titulo() || clave()"></div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .lienzo { width: 100%; }
    .vacio { display: grid; place-items: center; min-height: 120px; color: var(--muted); font-size: 12.5px; }
  `],
})
export class GraficaSerie {
  private readonly api = inject(InfraService);

  readonly clave = input.required<string>();
  readonly objeto = input<string | null>(null);
  readonly rango = input<Rango>('6h');
  readonly titulo = input<string>('');
  readonly alto = input<number>(220);
  /** Área bajo la línea (una sola serie). */
  readonly area = input<boolean>(true);

  readonly datos = signal<Grafica | null>(null);
  readonly error = signal<string | null>(null);
  readonly sinDatos = computed(() => {
    const d = this.datos();
    return !!d && (d.series.length === 0 || d.series.every((s) => s.puntos.length === 0));
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const c = this.clave();
      const o = this.objeto();
      const r = this.rango();
      untracked(() => this.cargar(c, r, o));
    });
    const t = setInterval(() => this.cargar(this.clave(), this.rango(), this.objeto()), 60_000);
    destroyRef.onDestroy(() => clearInterval(t));
  }

  private cargar(clave: string, rango: Rango, objeto: string | null) {
    this.api.serie(clave, rango, objeto).subscribe({
      next: (g) => { this.datos.set(g); this.error.set(null); },
      error: () => this.error.set('No se pudo leer la serie.'),
    });
  }

  readonly opciones = computed<EChartsOption>(() => {
    const g = this.datos();
    if (!g) return {};
    const unidad = g.unidad;
    const fmt = (v: number) =>
      unidad === 'B' ? bytes(v) : unidad === 'B/s' ? bps(v) : unidad === '%' ? `${num(v)} %`
        : unidad === '°C' ? `${num(v, 0)} °C` : unidad === 'ms' ? `${num(v, 0)} ms` : `${num(v, 2)}${unidad ? ' ' + unidad : ''}`;
    const series = g.series.slice(0, PALETA.length);
    const una = series.length === 1;
    return {
      animation: false,
      grid: { left: 8, right: 12, top: una ? 12 : 34, bottom: 6, containLabel: true },
      legend: una ? undefined : { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v) => fmt(Number(v)),
        axisPointer: { type: 'line', lineStyle: { type: 'dashed' } },
      },
      xAxis: { type: 'time', axisLabel: { fontSize: 10, hideOverlap: true }, splitLine: { show: false } },
      yAxis: {
        type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => fmt(v) },
        splitLine: { lineStyle: { opacity: 0.5 } },
        max: unidad === '%' ? (v: { max: number }) => Math.max(100, Math.ceil(v.max)) : undefined,
      },
      series: series.map((s, i) => ({
        name: NOMBRE_CHIP[s.nombre] ?? s.nombre,
        type: 'line',
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { width: 2, color: PALETA[i] },
        itemStyle: { color: PALETA[i] },
        areaStyle: una && this.area() ? { opacity: 0.12, color: PALETA[i] } : undefined,
        data: s.puntos.map(([t, v]) => [t * 1000, v]),
      })),
    } as EChartsOption;
  });
}

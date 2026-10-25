import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { PuntoDia } from '../../models/coordinadores.models';

/**
 * Línea de tiempo compacta (registros por día) para la tarjeta de un formulario.
 * Una sola serie, sin leyenda: el título de la tarjeta ya dice qué es.
 */
@Component({
  selector: 'app-linea-tiempo-mini',
  standalone: true,
  imports: [NgxEchartsDirective],
  providers: [provideEchartsTema()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div echarts [options]="opciones()" class="lienzo" [style.height.px]="alto()"
         role="img" [attr.aria-label]="etiqueta()"></div>
  `,
  styles: [`
    :host { display: block; min-width: 0; contain: inline-size; }
    .lienzo { width: 100%; }
  `],
})
export class LineaTiempoMiniComponent {
  readonly puntos = input.required<PuntoDia[]>();
  readonly alto = input<number>(90);

  readonly etiqueta = computed(() => {
    const total = this.puntos().reduce((s, p) => s + p.total, 0);
    return `Registros por día, últimos ${this.puntos().length} días: ${total}`;
  });

  readonly opciones = computed<EChartsOption>(() => {
    const pts = this.puntos();
    return {
      animation: false,
      grid: { left: 4, right: 6, top: 8, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { type: 'dashed' } },
        valueFormatter: (v) => `${v} registros`,
      },
      xAxis: {
        type: 'category',
        data: pts.map((p) => p.dia.slice(5)),
        axisLabel: { fontSize: 9, hideOverlap: true },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value', minInterval: 1,
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      series: [{
        type: 'line',
        data: pts.map((p) => p.total),
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { width: 2, color: '#2a78d6' },
        itemStyle: { color: '#2a78d6' },
        areaStyle: { opacity: 0.12, color: '#2a78d6' },
      }],
    } as EChartsOption;
  });
}

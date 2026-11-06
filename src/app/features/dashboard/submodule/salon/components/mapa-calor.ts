import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { EChartsOption } from 'echarts';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';

import { DIAS_SEMANA, MapaCalorCelda } from '../models/salon.models';

/**
 * Mapa de calor día × hora de ocupación (§4.6 `mapa_calor`). ECharts pinta en canvas y el
 * CSS del tema no le llega: los textos se toman del tema actual (`html[data-theme]`) al
 * construir las opciones.
 */
@Component({
  selector: 'app-salon-mapa-calor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  template: `<div echarts [options]="opciones()" class="calor" role="img" aria-label="Mapa de calor de ocupación por día y hora"></div>`,
  styles: [`
    :host { display: block; min-width: 0; }
    .calor { width: 100%; height: 340px; contain: inline-size; }
  `],
})
export class SalonMapaCalor {
  readonly celdas = input.required<MapaCalorCelda[]>();
  /** Horas que se muestran (por defecto 6..23). */
  readonly horaDesde = input(6);
  readonly horaHasta = input(23);

  readonly opciones = computed<EChartsOption>(() => {
    const oscuro = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
    const texto = oscuro ? '#CBD5E1' : '#44526A';
    const horas: string[] = [];
    for (let h = this.horaDesde(); h <= this.horaHasta(); h++) horas.push(`${String(h).padStart(2, '0')}h`);
    const datos = this.celdas()
      .filter(c => c.hora >= this.horaDesde() && c.hora <= this.horaHasta())
      .map(c => [c.hora - this.horaDesde(), c.dia_semana - 1, Math.round(c.ocupacion_pct * 10) / 10, c.grupos]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        formatter: (p: unknown) => {
          const v = (p as { value: number[] }).value;
          return `${DIAS_SEMANA[v[1]]} ${horas[v[0]]}<br/>Ocupación ${v[2]} %<br/>${v[3]} grupos`;
        },
      },
      grid: { left: 44, right: 16, top: 12, bottom: 60 },
      xAxis: { type: 'category', data: horas, splitArea: { show: true }, axisLabel: { color: texto, fontSize: 10 } },
      yAxis: { type: 'category', data: [...DIAS_SEMANA], splitArea: { show: true }, axisLabel: { color: texto } },
      visualMap: {
        min: 0, max: 100, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
        text: ['100 %', '0 %'], textStyle: { color: texto },
        inRange: { color: oscuro ? ['#1E2433', '#2563EB', '#F59E0B', '#DC2626'] : ['#EEF2FF', '#60A5FA', '#FBBF24', '#DC2626'] },
      },
      series: [{
        name: 'Ocupación', type: 'heatmap', data: datos,
        label: { show: false },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.35)' } },
      }],
    };
  });
}

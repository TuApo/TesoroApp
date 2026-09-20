import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';

import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { ChartDataPoint } from '../../../models/contratacion-metricas.models';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';

@Component({
    selector: 'app-formularios-por-oficina-chart',
    standalone: true,
    imports: [NgxEchartsDirective, EmptyStateComponent],
    providers: [provideEchartsTema()],
    template: `
    @if (hasData) {
      <div class="chart-container">
        <div echarts
             [options]="chartOption"
             [merge]="chartUpdate"
             (chartClick)="onChartClick($event)"
             class="echarts-wrapper clickable"></div>
        <div class="hint">Click en una oficina para descargar el Excel de esos candidatos.</div>
      </div>
    } @else {
      <app-empty-state
        icon="assignment"
        title="Sin Formularios"
        description="No se encontraron formularios llenados para el rango y criterios especificados.">
      </app-empty-state>
    }
    `,
    styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .chart-container { height: 100%; width: 100%; display: flex; flex-direction: column; }
    .echarts-wrapper { height: 100%; min-height: 350px; width: 100%; flex: 1; }
    .echarts-wrapper.clickable { cursor: pointer; }
    .hint { font-size: 0.72rem; color: var(--text-faint); text-align: right; padding: 4px 6px 0; }
  `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class FormulariosPorOficinaChartComponent implements OnChanges {
    @Input() data: ChartDataPoint[] | null = null;
    @Output() segmentClick = new EventEmitter<{ oficina: string }>();

    hasData = false;

    chartOption: EChartsOption = {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: [], axisTick: { alignWithLabel: true } },
        series: [
            {
                name: 'Formularios Llenados',
                type: 'bar',
                barWidth: '60%',
                data: [],
                itemStyle: { color: '#3b82f6', borderRadius: [0, 4, 4, 0] },
                label: { show: true, position: 'right' }
            }
        ]
    };
    chartUpdate: any;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['data'] && this.data) {
            if (this.data.length > 0) {
                this.hasData = true;
                // Invert for horizontal bar descending
                const sorted = [...this.data].sort((a, b) => a.value - b.value);
                this.chartUpdate = {
                    yAxis: { data: sorted.map(d => d.name) },
                    series: [{ data: sorted.map(d => d.value) }]
                };
            } else {
                this.hasData = false;
            }
        }
    }

    onChartClick(event: any): void {
        const oficina = String(event?.name || '').trim();
        if (!oficina) return;
        this.segmentClick.emit({ oficina });
    }
}

import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';

import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { ChartDataPoint } from '../../../models/contratacion-metricas.models';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';

@Component({
    selector: 'app-celular-confirmado-chart',
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
        <div class="hint">Click en un segmento para descargar el Excel.</div>
      </div>
    } @else {
      <app-empty-state
        icon="smartphone"
        title="Sin Datos de Celular"
        description="No hay información de teléfonos para este rango.">
      </app-empty-state>
    }
    `,
    styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .chart-container { height: 100%; width: 100%; display: flex; flex-direction: column; }
    .echarts-wrapper { height: 100%; min-height: 250px; width: 100%; flex: 1; }
    .echarts-wrapper.clickable { cursor: pointer; }
    .hint { font-size: 0.72rem; color: var(--text-faint); text-align: right; padding: 4px 6px 0; }
  `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CelularConfirmadoChartComponent implements OnChanges {
    @Input() data: ChartDataPoint[] | null = null;
    @Output() segmentClick = new EventEmitter<{ conCelular: boolean }>();

    hasData = false;

    chartOption: EChartsOption = {
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { top: '5%', left: 'center' },
        color: ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6'],
        series: [
            {
                name: 'Celular Confirmado',
                type: 'pie',
                radius: ['40%', '70%'],
                avoidLabelOverlap: false,
                itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
                label: { show: false, position: 'center' },
                emphasis: { label: { show: true, fontSize: 20, fontWeight: 'bold' } },
                labelLine: { show: false },
                data: []
            }
        ]
    };
    chartUpdate: any;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['data'] && this.data) {
            if (this.data.length > 0) {
                this.hasData = true;
                this.chartUpdate = { series: [{ data: this.data }] };
            } else {
                this.hasData = false;
            }
        }
    }

    onChartClick(event: any): void {
        const name = String(event?.name || '').trim();
        if (!name) return;
        this.segmentClick.emit({ conCelular: name === 'Con Celular' });
    }
}

import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';

import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { ChartDataPoint } from '../../../models/tesoreria-metricas.models';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';

@Component({
    selector: 'app-tx-funnel-chart',
    standalone: true,
    imports: [NgxEchartsDirective, EmptyStateComponent],
    providers: [provideEchartsTema()],
    template: `
    @if (hasData) {
      <div class="chart-container">
        <div echarts [options]="chartOption" [merge]="chartUpdate" class="echarts-wrapper"></div>
      </div>
    } @else {
      <app-empty-state
        icon="filter_alt"
        title="Sin Transacciones"
        description="No hay datos de estados (funnel) para este rango de fechas.">
      </app-empty-state>
    }
    `,
    styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .chart-container { height: 100%; width: 100%; }
    .echarts-wrapper { height: 100%; min-height: 250px; width: 100%; }
  `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class TxFunnelChartComponent implements OnChanges {
    @Input() data: ChartDataPoint[] | null = null;

    hasData = false;

    chartOption: EChartsOption = {
        tooltip: {
            trigger: 'item',
            formatter: '{b} : {c}'
        },
        color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
        series: [
            {
                name: 'Embudo de Transacciones',
                type: 'funnel',
                left: '10%',
                width: '80%',
                label: {
                    formatter: '{b}'
                },
                labelLine: {
                    show: true
                },
                itemStyle: {
                    opacity: 0.9,
                    borderColor: '#fff',
                    borderWidth: 2
                },
                data: []
            }
        ]
    };

    chartUpdate: any;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['data'] && this.data) {
            // Filtrar y ordenar el funnel visualmente si queremos un orden real de funnel 
            // (aunque echarts lo ordena automáticamente por valor default 'descending')
            const filtered = this.data.filter(d => d.value > 0);
            this.hasData = filtered.length > 0;

            if (this.hasData) {
                this.chartUpdate = {
                    series: [{
                        data: filtered
                    }]
                };
            }
        }
    }
}

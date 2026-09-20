import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';
import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';
import { TopComprador } from '../../../models/tesoreria-metricas.models';

@Component({
    selector: 'app-top-compradores-chart',
    standalone: true,
    imports: [NgxEchartsDirective, EmptyStateComponent],
    providers: [provideEchartsTema()],
    template: `
    @if (hasData) {
      <div class="chart-container">
        <div echarts [options]="chartOption" [merge]="chartUpdate" class="echarts-wrapper"></div>
      </div>
    } @else {
      <app-empty-state icon="people" title="Sin Compradores" description="No se encontraron transacciones ejecutadas en este rango."></app-empty-state>
    }
    `,
    styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .chart-container { height: 100%; width: 100%; }
    .echarts-wrapper { height: 100%; min-height: 300px; width: 100%; }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class TopCompradoresChartComponent implements OnChanges {
    @Input() data: TopComprador[] | null = null;
    hasData = false;

    chartOption: EChartsOption = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params: any) => {
                const p = Array.isArray(params) ? params[0] : params;
                const d = p.data as any;
                return '<b>' + p.name + '</b><br/>Transacciones: ' + d.txCount + '<br/>Monto: $' + ((d.value || 0).toLocaleString('es-CO'));
            }
        },
        grid: { left: '3%', right: '8%', bottom: '3%', top: '8%', containLabel: true },
        xAxis: { type: 'value', axisLabel: { formatter: '$ {value}' } },
        yAxis: { type: 'category', data: [], axisLabel: { interval: 0, width: 130, overflow: 'truncate', fontSize: 11 } },
        color: ['#3b82f6'],
        series: [{
            name: 'Monto Total',
            type: 'bar',
            barWidth: '55%',
            label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => p.data.txCount + ' tx' },
            itemStyle: { borderRadius: [0, 6, 6, 0] },
            data: []
        }]
    };

    chartUpdate: any;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['data'] && this.data) {
            const items = this.data.slice(0, 10);
            this.hasData = items.length > 0;
            if (!this.hasData) return;

            const sorted = [...items].reverse();
            this.chartUpdate = {
                yAxis: {
                    data: sorted.map(i => {
                        const label = i.nombre || i.numero_documento;
                        return label.length > 22 ? label.substring(0, 20) + '...' : label;
                    })
                },
                series: [{
                    data: sorted.map(i => ({ value: i.monto_total, txCount: i.total_transacciones }))
                }]
            };
        }
    }
}

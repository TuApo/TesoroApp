import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';

import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';

@Component({
    selector: 'app-personas-distribution-chart',
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
        icon="pie_chart"
        title="Sin Saldos Pendientes"
        description="Todas las personas parecen estar a paz y salvo.">
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
export class PersonasDistributionChartComponent implements OnChanges {
    @Input() rawPersonas: any[] | null = null;

    hasData = false;

    chartOption: EChartsOption = {
        tooltip: { trigger: 'item', formatter: '{a} <br/>{b} : {c} ({d}%)' },
        legend: { bottom: 0, left: 'center' },
        color: ['#10b981', '#fcd34d', '#f59e0b', '#ef4444', '#b91c1c'],
        series: [
            {
                name: 'Rango de Deuda',
                type: 'pie',
                radius: ['40%', '70%'],
                avoidLabelOverlap: false,
                itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
                label: { show: false, position: 'center' },
                emphasis: {
                    label: { show: true, fontSize: '14', fontWeight: 'bold' }
                },
                labelLine: { show: false },
                data: []
            }
        ]
    };

    chartUpdate: any;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['rawPersonas'] && this.rawPersonas) {
            if (!this.rawPersonas.length) {
                this.hasData = false; return;
            }

            // Bucketing de deudas
            let zero = 0, low = 0, medium = 0, high = 0, critical = 0;
            let tieneDeuda = false;

            this.rawPersonas.forEach(p => {
                const saldo = Number(p.saldo_pendiente) || 0;
                if (saldo <= 0) zero++;
                else if (saldo <= 50000) low++;
                else if (saldo <= 250000) medium++;
                else if (saldo <= 1000000) high++;
                else critical++;

                if (saldo > 0) tieneDeuda = true;
            });

            this.hasData = tieneDeuda; // Solo mostramos si hay *alguien* con deuda
            if (this.hasData) {
                this.chartUpdate = {
                    series: [{
                        data: [
                            { value: zero, name: 'A paz y salvo' },
                            { value: low, name: 'Hasta 50K' },
                            { value: medium, name: 'De 50K a 250K' },
                            { value: high, name: 'De 250K a 1 Millón' },
                            { value: critical, name: 'Más de 1 Millón' }
                        ].filter(d => d.value > 0)
                    }]
                };
            }
        }
    }
}

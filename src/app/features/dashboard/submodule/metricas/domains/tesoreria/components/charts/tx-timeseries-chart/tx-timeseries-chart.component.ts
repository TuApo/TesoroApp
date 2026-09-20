import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';

import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;

@Component({
    selector: 'app-tx-timeseries-chart',
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
        icon="show_chart"
        title="Sin Datos de Tiempo"
        description="No encontramos transacciones ejecutadas ni autorizadas en este rango.">
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
export class TxTimeseriesChartComponent implements OnChanges {
    // Recibe la data cruda, tabulamos internamente para no ensuciar el facade
    @Input() rawTransactions: any[] | null = null;

    hasData = false;

    chartOption: EChartsOption = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } }
        },
        legend: {
            data: ['Monto Ejecutado', 'Pendiente por Ejecutar'],
            bottom: 0
        },
        grid: {
            left: '3%', right: '4%', bottom: '15%', containLabel: true
        },
        xAxis: [
            {
                type: 'category',
                boundaryGap: false,
                data: []
            }
        ],
        yAxis: [
            {
                type: 'value',
                axisLabel: { formatter: '$ {value}' }
            }
        ],
        color: ['#10b981', '#f59e0b'],
        series: [
            {
                name: 'Monto Ejecutado',
                type: 'line',
                stack: 'Total',
                areaStyle: { opacity: 0.3 },
                smooth: true,
                data: []
            },
            {
                name: 'Pendiente por Ejecutar',
                type: 'line',
                stack: 'Total2',
                areaStyle: { opacity: 0.3 },
                smooth: true,
                data: []
            }
        ]
    };

    chartUpdate: any;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['rawTransactions'] && this.rawTransactions) {
            if (this.rawTransactions.length === 0) {
                this.hasData = false;
                return;
            }
            this.hasData = true;

            // Group by date (YYYY-MM-DD)
            const groups: Record<string, { ejecutado: number, pendiente: number }> = {};

            this.rawTransactions.forEach(tx => {
                if (tx.estado === 'EJECUTADA') {
                    // Dinero real: usar fecha de ejecucion
                    const dateField = tx.ejecutado_en || tx.created_at;
                    if (!dateField) return;
                    const dt = moment(dateField).format('YYYY-MM-DD');
                    if (!groups[dt]) groups[dt] = { ejecutado: 0, pendiente: 0 };
                    groups[dt].ejecutado += Number(tx.ejecucion_monto) || 0;
                } else if (tx.estado === 'PENDIENTE') {
                    // Autorizado sin ejecutar: usar fecha de autorizacion
                    const dateField = tx.autorizado_en || tx.created_at;
                    if (!dateField) return;
                    const dt = moment(dateField).format('YYYY-MM-DD');
                    if (!groups[dt]) groups[dt] = { ejecutado: 0, pendiente: 0 };
                    groups[dt].pendiente += Number(tx.autorizacion_monto) || 0;
                }
                // ANULADA: no se grafica
            });

            // Sort dates
            const dates = Object.keys(groups).sort();
            const execData = dates.map(d => groups[d].ejecutado);
            const pendData = dates.map(d => groups[d].pendiente);

            // Limitar a los que tengan movimientos
            if (execData.every(v => v === 0) && pendData.every(v => v === 0)) {
                this.hasData = false;
                return;
            }

            this.chartUpdate = {
                xAxis: [{ data: dates.map(d => moment(d).format('MMM DD')) }],
                series: [
                    { data: execData },
                    { data: pendData }
                ]
            };
        }
    }
}

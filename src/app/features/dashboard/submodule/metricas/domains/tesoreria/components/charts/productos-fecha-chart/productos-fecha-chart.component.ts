import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';
import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';
import { ProductoFecha } from '../../../models/tesoreria-metricas.models';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;

@Component({
    selector: 'app-productos-fecha-chart',
    standalone: true,
    imports: [NgxEchartsDirective, EmptyStateComponent],
    providers: [provideEchartsTema()],
    template: `
    @if (hasData) {
      <div class="chart-container">
        <div echarts [options]="chartOption" [merge]="chartUpdate" class="echarts-wrapper"></div>
      </div>
    } @else {
      <app-empty-state icon="inventory" title="Sin Ventas" description="No hay movimientos de inventario (salidas) en este periodo."></app-empty-state>
    }
    `,
    styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .chart-container { height: 100%; width: 100%; }
    .echarts-wrapper { height: 100%; min-height: 300px; width: 100%; }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProductosFechaChartComponent implements OnChanges {
    @Input() data: ProductoFecha[] | null = null;
    hasData = false;

    chartOption: EChartsOption = {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { bottom: 0, type: 'scroll' },
        grid: { left: '3%', right: '4%', bottom: '15%', top: '8%', containLabel: true },
        xAxis: { type: 'category', data: [], axisLabel: { rotate: 30, fontSize: 10 } },
        yAxis: { type: 'value', name: 'Cantidad', axisLabel: { fontSize: 10 } },
        color: ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'],
        series: []
    };

    chartUpdate: any;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['data'] && this.data) {
            if (this.data.length === 0) { this.hasData = false; return; }

            const fechasSet = new Set<string>();
            const dataMap: Record<string, Record<string, number>> = {};
            const productoTotals: Record<string, number> = {};

            this.data.forEach(item => {
                fechasSet.add(item.fecha);
                if (!dataMap[item.fecha]) dataMap[item.fecha] = {};
                dataMap[item.fecha][item.producto] = (dataMap[item.fecha][item.producto] || 0) + item.cantidad;
                productoTotals[item.producto] = (productoTotals[item.producto] || 0) + item.cantidad;
            });

            const fechas = Array.from(fechasSet).sort();
            const topProductos = Object.entries(productoTotals)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(e => e[0]);

            this.hasData = fechas.length > 0 && topProductos.length > 0;
            if (!this.hasData) return;

            const series = topProductos.map(prod => ({
                name: prod,
                type: 'bar' as const,
                stack: 'total',
                barWidth: '60%',
                data: fechas.map(f => dataMap[f]?.[prod] || 0),
                itemStyle: { borderRadius: [0, 0, 0, 0] }
            }));

            this.chartUpdate = {
                xAxis: { data: fechas.map(f => moment(f).format('MMM DD')) },
                legend: { data: topProductos },
                series
            };
        }
    }
}

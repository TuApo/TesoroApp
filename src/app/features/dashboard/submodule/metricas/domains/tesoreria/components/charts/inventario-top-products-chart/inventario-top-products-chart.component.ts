import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';

@Component({
    selector: 'app-inventario-top-products-chart',
    standalone: true,
    imports: [NgxEchartsDirective, EmptyStateComponent],
    providers: [provideEchartsTema(), CurrencyPipe],
    template: `
    @if (hasData) {
      <div class="chart-container">
        <div echarts [options]="chartOption" [merge]="chartUpdate" class="echarts-wrapper"></div>
      </div>
    } @else {
      <app-empty-state
        icon="inventory_2"
        title="Sin Top Productos"
        description="No hay transacciones de inventario con salida de productos para el periodo.">
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
export class InventarioTopProductsChartComponent implements OnChanges {
    @Input() rawTransactions: any[] | null = null;

    hasData = false;

    chartOption: EChartsOption = {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: [], axisLabel: { interval: 0, width: 90, overflow: 'truncate' } },
        color: ['#8b5cf6'],
        series: [
            {
                name: 'Valor Solicitado/Salida',
                type: 'bar',
                barWidth: '50%',
                label: { show: true, position: 'right' },
                itemStyle: { borderRadius: [0, 4, 4, 0] },
                data: []
            }
        ]
    };

    chartUpdate: any;

    pipe = new CurrencyPipe('es-CO');

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['rawTransactions'] && this.rawTransactions) {
            // Extraer transacciones de MERCADO ejecutadas
            const prodMap: Record<string, number> = {};

            this.rawTransactions.forEach(tx => {
                const concepto = (tx.autorizacion_concepto || tx.ejecucion_concepto || '').toUpperCase();
                if (concepto.includes('MERCADO') && tx.estado === 'EJECUTADA') {
                    const detalle = tx.detalle || {};
                    const items = detalle.items || detalle.ventas || [];
                    if (Array.isArray(items) && items.length > 0) {
                        items.forEach((item: any) => {
                            let prodName = item.producto_nombre || item.lote_nombre || `Prod #${item.lote_id}`;
                            if (!prodMap[prodName]) prodMap[prodName] = 0;
                            prodMap[prodName] += (item.cantidad || 1);
                        });
                    } else {
                        // Sin detalle de items, contar como 1 salida de mercado
                        const label = tx.ejecucion_concepto || tx.autorizacion_concepto || 'Mercado';
                        if (!prodMap[label]) prodMap[label] = 0;
                        prodMap[label] += 1;
                    }
                }
            });

            const entries = Object.entries(prodMap)
                .sort((a, b) => a[1] - b[1]) // Ascendente para que quede top_1 arriba en YAxis horizontal
                .slice(-6); // top 6

            this.hasData = entries.length > 0;
            if (this.hasData) {
                this.chartUpdate = {
                    yAxis: { data: entries.map(e => e[0]) },
                    series: [{
                        data: entries.map(e => ({ value: e[1] }))
                    }]
                };
            }
        }
    }
}

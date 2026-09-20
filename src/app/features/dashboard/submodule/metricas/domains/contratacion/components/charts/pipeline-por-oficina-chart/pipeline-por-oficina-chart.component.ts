import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';

import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { ChartSeriesPoint } from '../../../models/contratacion-metricas.models';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';

@Component({
    selector: 'app-pipeline-por-oficina-chart',
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
        <div class="hint">Click en un segmento (oficina + etapa) para descargar el Excel.</div>
      </div>
    } @else {
      <app-empty-state
        icon="view_kanban"
        title="Sin Pipeline"
        description="No hay eventos de contratacion para estos filtros.">
      </app-empty-state>
    }
    `,
    styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .chart-container { height: 100%; width: 100%; display: flex; flex-direction: column; }
    .echarts-wrapper { height: 100%; min-height: 400px; width: 100%; flex: 1; }
    .echarts-wrapper.clickable { cursor: pointer; }
    .hint { font-size: 0.72rem; color: var(--text-faint); text-align: right; padding: 4px 6px 0; }
  `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PipelinePorOficinaChartComponent implements OnChanges {
    @Input() seriesData: ChartSeriesPoint[] | null = null;
    @Input() xAxisCategories: string[] = [];
    @Output() segmentClick = new EventEmitter<{ oficina: string; stage: string }>();

    hasData = false;

    chartOption: EChartsOption = {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { top: 10 },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: [] },
        yAxis: { type: 'value' },
        color: ['#6366f1', '#14b8a6', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'],
        series: []
    };

    chartUpdate: any;

    ngOnChanges(changes: SimpleChanges): void {
        if ((changes['seriesData'] || changes['xAxisCategories']) && this.seriesData) {
            const isNotEmpty = this.seriesData.some(s => s.data && s.data.some(v => v > 0));

            if (isNotEmpty && this.xAxisCategories?.length > 0) {
                this.hasData = true;
                this.chartUpdate = {
                    xAxis: { data: this.xAxisCategories },
                    series: this.seriesData
                };
            } else {
                this.hasData = false;
            }
        }
    }

    onChartClick(event: any): void {
        const oficina = String(event?.name || '').trim();
        const stage = String(event?.seriesName || '').trim();
        if (!oficina || !stage) return;
        if (typeof event?.value === 'number' && event.value <= 0) return;
        this.segmentClick.emit({ oficina, stage });
    }
}

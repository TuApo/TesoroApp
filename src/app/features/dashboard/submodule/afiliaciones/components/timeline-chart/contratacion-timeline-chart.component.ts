import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';

import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { EmptyStateComponent } from '../../../metricas/shared/components/empty-state/empty-state.component';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;

import { TimelinePoint } from '../../models/afiliaciones-dashboard.models';

export type TimelineDimension = 'oficina' | 'empresa' | 'usuario_responsable';

/**
 * Gráfica de línea temporal (estilo "timeline") de la contratación.
 *
 * Recibe PUNTOS YA AGREGADOS por el backend ({fecha, label, total}), calculados en SQL
 * sobre todo el conjunto filtrado. Antes recibía filas crudas y las tabulaba en el cliente,
 * pero la respuesta de filas está topada a 5.000 y los meses viejos "desaparecían"; la
 * agregación server-side arregla eso (ver AfiliacionesDashboardService).
 *
 * Cada `label` es una serie (línea). El eje X es el día (`fecha`). Para no saturar la
 * leyenda muestra las top-N series por volumen y agrupa el resto en una línea "Otros".
 */
@Component({
  selector: 'app-contratacion-timeline-chart',
  standalone: true,
  imports: [NgxEchartsDirective, EmptyStateComponent],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  template: `
    @if (hasData) {
      <div class="chart-container">
        <div echarts [options]="chartOption" class="echarts-wrapper"></div>
      </div>
    } @else {
      <app-empty-state
        icon="timeline"
        title="Sin datos en el rango"
        description="No hay contrataciones registradas para los filtros y el rango de fechas seleccionados. Prueba con 'Esta Semana' o 'Este Mes'.">
      </app-empty-state>
    }
  `,
  styles: [`
    :host { display: block; height: 100%; width: 100%; }
    .chart-container { height: 100%; width: 100%; }
    .echarts-wrapper { height: 100%; min-height: 320px; width: 100%; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContratacionTimelineChartComponent implements OnChanges {
  /** Puntos agregados {fecha, label, total} desde el backend. */
  @Input() points: TimelinePoint[] | null = null;

  /** Máximo de series visibles; el resto se agrupa en "Otros". */
  @Input() maxSeries = 8;

  hasData = false;
  chartOption: EChartsOption = {};

  // Paleta de colores distinguibles (líneas de la gráfica).
  private readonly palette = [
    '#3b82f6', '#06b6d4', '#ec4899', '#f59e0b', '#10b981',
    '#8b5cf6', '#ef4444', '#14b8a6', '#6366f1', '#84cc16'
  ];

  ngOnChanges(_changes: SimpleChanges): void {
    this.rebuild();
  }

  private rebuild(): void {
    const points = this.points || [];
    if (points.length === 0) { this.hasData = false; return; }

    // 1. Tabular: label -> (fecha 'YYYY-MM-DD' -> conteo), + totales por label.
    const dateSet = new Set<string>();
    const byLabel = new Map<string, Map<string, number>>();
    const totals = new Map<string, number>();

    for (const p of points) {
      const d = p.fecha;
      if (!d) continue;
      dateSet.add(d);
      const label = (p.label == null ? '' : String(p.label)).trim() || '—';
      let m = byLabel.get(label);
      if (!m) { m = new Map<string, number>(); byLabel.set(label, m); }
      m.set(d, (m.get(d) || 0) + p.total);
      totals.set(label, (totals.get(label) || 0) + p.total);
    }

    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) { this.hasData = false; return; }

    // 2. Top-N labels por volumen; el resto se acumula en "Otros".
    const sortedLabels = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(e => e[0]);
    const topLabels = sortedLabels.slice(0, this.maxSeries);
    const otrosLabels = sortedLabels.slice(this.maxSeries);

    const singlePoint = dates.length <= 1;

    const series: any[] = topLabels.map(label => {
      const m = byLabel.get(label)!;
      return {
        name: label,
        type: 'line',
        smooth: true,
        showSymbol: singlePoint,   // muestra el punto cuando sólo hay un día
        symbolSize: 6,
        lineStyle: { width: 2 },
        emphasis: { focus: 'series' },
        data: dates.map(dt => m.get(dt) || 0)
      };
    });

    if (otrosLabels.length > 0) {
      const otrosData = dates.map(dt =>
        otrosLabels.reduce((sum, label) => sum + (byLabel.get(label)!.get(dt) || 0), 0)
      );
      series.push({
        name: `Otros (${otrosLabels.length})`,
        type: 'line',
        smooth: true,
        showSymbol: singlePoint,
        symbolSize: 6,
        lineStyle: { width: 2, type: 'dashed' },
        itemStyle: { color: '#94a3b8' },
        emphasis: { focus: 'series' },
        data: otrosData
      });
    }

    this.chartOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: '#64748b' } }
      },
      legend: {
        data: series.map(s => s.name),
        top: 0,
        type: 'scroll',
        textStyle: { fontSize: 12 }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: 48, containLabel: true },
      color: this.palette,
      xAxis: [{
        type: 'category',
        boundaryGap: false,
        // Etiqueta según granularidad: 'YYYY-MM' → "Mar 2025" (mes); 'YYYY-MM-DD' → "Mar 15" (día).
        data: dates.map(d => d.length === 7
          ? moment(d, 'YYYY-MM').format('MMM YYYY')
          : moment(d).format('MMM DD'))
      }],
      yAxis: [{ type: 'value', minInterval: 1 }],
      series
    };
    this.hasData = true;
  }
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { ConfigVisualizacion, ResultadoConsulta } from '../models/reportes.models';

/**
 * Gráfica del reporte (§15, §16).
 *
 * Se alimenta del MISMO resultado que la tabla: no hay una segunda consulta ni un
 * formato aparte. El usuario elige dimensión y métrica y la gráfica se arma sola.
 *
 * Usa ECharts porque es lo que ya usa el módulo de Métricas de la plataforma, con
 * el mismo patrón de carga diferida (`provideEchartsCore` + import dinámico), así
 * que no añade peso al bundle inicial.
 */
@Component({
  selector: 'app-grafica-reporte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  template: `
  @if (hayDatos()) {
    <div echarts [options]="opciones()" [merge]="opciones()" class="gr" [style.height.px]="alto()"></div>
  } @else {
    <div class="vacio">
      <mat-icon>insert_chart_outlined</mat-icon>
      <p>{{ motivoVacio() }}</p>
    </div>
  }
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; }
    .gr { width: 100%; min-height: 240px; }
    .vacio { text-align: center; padding: 2.5rem 1rem; color: #94a3b8; }
    .vacio mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .vacio p { font-size: .82rem; margin: .5rem auto 0; max-width: 380px; line-height: 1.4; }
  `],
})
export class GraficaReporteComponent {

  readonly resultado = input<ResultadoConsulta | null>(null);
  readonly config = input<ConfigVisualizacion>({ tipo: 'BARRAS' });
  readonly alto = input(320);
  readonly oscuro = input(false);

  /** Paleta alineada con la del resto de la plataforma (módulo Métricas). */
  private static readonly PALETA = [
    '#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  ];

  readonly hayDatos = computed(() => {
    const r = this.resultado();
    if (!r || !r.filas.length) return false;
    return !!this.dimensionId() && this.metricasIds().length > 0;
  });

  readonly motivoVacio = computed(() => {
    const r = this.resultado();
    if (!r) return 'Ejecuta el reporte para ver la gráfica.';
    if (!r.filas.length) return 'La consulta no devolvió registros con los filtros actuales.';
    if (!this.dimensionId()) {
      return 'Elige una dimensión (por ejemplo, empresa o mes): es lo que se pinta en el eje.';
    }
    if (!this.metricasIds().length) {
      return 'Elige al menos una métrica (por ejemplo, cantidad de contrataciones).';
    }
    return 'No hay datos para graficar.';
  });

  /** Dimensión: la del config, o la primera columna no agregada. */
  private readonly dimensionId = computed(() => {
    const cfg = this.config();
    if (cfg.dimension) return cfg.dimension;
    const r = this.resultado();
    return r?.columnas.find(c => c.visible && !c.es_agregacion)?.id ?? null;
  });

  /** Métricas: las del config, o todas las columnas agregadas. */
  private readonly metricasIds = computed(() => {
    const cfg = this.config();
    if (cfg.metricas?.length) return cfg.metricas;
    const r = this.resultado();
    const agregadas = r?.columnas.filter(c => c.visible && c.es_agregacion).map(c => c.id) ?? [];
    if (agregadas.length) return agregadas;
    // Sin agregaciones se grafica la primera columna numérica que haya.
    const numerica = r?.columnas.find(c =>
      c.visible && ['currency', 'decimal', 'integer', 'percent'].includes(c.formato ?? ''));
    return numerica ? [numerica.id] : [];
  });

  readonly opciones = computed<EChartsOption>(() => {
    const r = this.resultado()!;
    const cfg = this.config();
    const dimId = this.dimensionId()!;
    const metIds = this.metricasIds();
    const dimCol = r.columnas.find(c => c.id === dimId);
    const metCols = metIds.map(id => r.columnas.find(c => c.id === id)).filter(Boolean);

    // Top N y orden: en una gráfica de barras lo útil son los primeros, no todos.
    let filas = [...r.filas];
    const topN = cfg.top_n ?? 0;
    if (topN > 0 && metIds.length) {
      filas.sort((a, b) => Number(b[metIds[0]] ?? 0) - Number(a[metIds[0]] ?? 0));
      filas = filas.slice(0, topN);
    }

    const categorias = filas.map(f => this.texto(f[dimId]));
    const colorTexto = this.oscuro() ? '#cbd5e1' : '#475569';
    const colorLinea = this.oscuro() ? '#334155' : '#e2e8f0';

    const base: EChartsOption = {
      color: GraficaReporteComponent.PALETA,
      title: cfg.titulo ? {
        text: cfg.titulo, subtext: cfg.subtitulo ?? undefined,
        left: 'center', textStyle: { fontSize: 14, color: colorTexto },
        subtextStyle: { fontSize: 11 },
      } : undefined,
      tooltip: { trigger: this.esCircular(cfg.tipo) ? 'item' : 'axis', confine: true },
      legend: (cfg.leyenda ?? true) && (metCols.length > 1 || this.esCircular(cfg.tipo))
        ? { bottom: 0, type: 'scroll', textStyle: { color: colorTexto, fontSize: 11 } }
        : undefined,
      grid: { left: 8, right: 16, bottom: (cfg.leyenda ?? true) ? 34 : 12, top: cfg.titulo ? 48 : 18, containLabel: true },
    };

    if (this.esCircular(cfg.tipo)) {
      const metId = metIds[0];
      return {
        ...base,
        series: [{
          type: 'pie',
          radius: cfg.tipo === 'DONA' ? ['45%', '72%'] : '68%',
          center: ['50%', cfg.titulo ? '54%' : '48%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: this.oscuro() ? '#0f172a' : '#fff', borderWidth: 2 },
          label: { show: cfg.etiquetas ?? true, formatter: '{b}: {d}%', color: colorTexto, fontSize: 11 },
          data: filas.map(f => ({ name: this.texto(f[dimId]), value: Number(f[metId] ?? 0) })),
        }],
      };
    }

    if (cfg.tipo === 'TREEMAP') {
      const metId = metIds[0];
      return {
        ...base,
        tooltip: { trigger: 'item', confine: true },
        series: [{
          type: 'treemap', roam: false, nodeClick: false,
          breadcrumb: { show: false },
          label: { show: true, formatter: '{b}', fontSize: 11 },
          data: filas.map(f => ({ name: this.texto(f[dimId]), value: Number(f[metId] ?? 0) })),
        }],
      };
    }

    if (cfg.tipo === 'FUNNEL') {
      const metId = metIds[0];
      return {
        ...base,
        tooltip: { trigger: 'item', confine: true },
        series: [{
          type: 'funnel', left: '12%', width: '76%', sort: 'descending', gap: 2,
          label: { show: true, position: 'inside', formatter: '{b}: {c}' },
          data: filas.map(f => ({ name: this.texto(f[dimId]), value: Number(f[metId] ?? 0) })),
        }],
      };
    }

    if (cfg.tipo === 'DISPERSION') {
      const [x, y] = [metIds[0], metIds[1] ?? metIds[0]];
      return {
        ...base,
        xAxis: { type: 'value', axisLine: { lineStyle: { color: colorLinea } }, axisLabel: { color: colorTexto } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: colorLinea } }, axisLabel: { color: colorTexto },
                 splitLine: { lineStyle: { color: colorLinea } } },
        series: [{
          type: 'scatter', symbolSize: 10,
          data: filas.map(f => [Number(f[x] ?? 0), Number(f[y] ?? 0), this.texto(f[dimId])]),
          tooltip: { formatter: (p: any) => `${p.value[2]}<br/>${p.value[0]} · ${p.value[1]}` },
        }],
      };
    }

    // Familia de ejes: barras, columnas, línea, área, apiladas e histograma.
    const horizontal = cfg.tipo === 'BARRAS_HORIZONTAL' || cfg.orientacion === 'horizontal';
    const ejeCategoria = {
      type: 'category' as const,
      data: categorias,
      axisLabel: {
        color: colorTexto, fontSize: 11,
        interval: 0 as const,
        rotate: !horizontal && categorias.length > 8 ? 32 : 0,
        formatter: (v: string) => v.length > 18 ? v.slice(0, 17) + '…' : v,
      },
      axisLine: { lineStyle: { color: colorLinea } },
      axisTick: { show: false },
    };
    const ejeValor = {
      type: 'value' as const,
      axisLabel: { color: colorTexto, fontSize: 11, formatter: (v: number) => this.compacto(v) },
      splitLine: { lineStyle: { color: colorLinea } },
    };

    const apilado = cfg.tipo === 'BARRAS_APILADAS';
    const esLinea = cfg.tipo === 'LINEA' || cfg.tipo === 'AREA';

    // ── Desglose por serie: una serie por cada valor distinto de esa columna ──
    // Es el "breakdown" de cualquier herramienta de BI: contrataciones por mes
    // (dimensión) separadas por empresa (serie). Se pivotan las filas; los huecos
    // quedan en null y no en 0, para que una línea no baje a cero donde en realidad
    // no hay dato.
    const serieId = cfg.serie;
    if (serieId && metIds.length) {
      const metId = metIds[0];
      const cats: string[] = [];
      const nombresSerie: string[] = [];
      const celdas = new Map<string, number>();
      for (const f of filas) {
        const cat = this.texto(f[dimId]);
        const ser = this.texto(f[serieId]);
        if (!cats.includes(cat)) cats.push(cat);
        if (!nombresSerie.includes(ser)) nombresSerie.push(ser);
        celdas.set(cat + '\u0000' + ser, Number(f[metId] ?? 0));
      }
      return {
        ...base,
        legend: { bottom: 0, type: 'scroll', textStyle: { color: colorTexto, fontSize: 11 } },
        xAxis: horizontal ? ejeValor : { ...ejeCategoria, data: cats },
        yAxis: horizontal ? { ...ejeCategoria, data: cats } : ejeValor,
        series: nombresSerie.map(ser => ({
          name: ser,
          type: esLinea ? 'line' : 'bar',
          stack: apilado ? 'total' : undefined,
          smooth: esLinea,
          connectNulls: false,
          areaStyle: cfg.tipo === 'AREA' ? { opacity: .22 } : undefined,
          barMaxWidth: 42,
          data: cats.map(c => celdas.has(c + '\u0000' + ser) ? celdas.get(c + '\u0000' + ser)! : null),
        })) as never,
      };
    }

    return {
      ...base,
      xAxis: horizontal ? ejeValor : ejeCategoria,
      yAxis: horizontal ? ejeCategoria : ejeValor,
      dataZoom: categorias.length > 25
        ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 2 }]
        : undefined,
      series: metCols.map((c, i) => ({
        name: c!.alias,
        type: esLinea ? 'line' : 'bar',
        stack: apilado ? 'total' : undefined,
        smooth: esLinea,
        areaStyle: cfg.tipo === 'AREA' ? { opacity: .22 } : undefined,
        barMaxWidth: 42,
        itemStyle: { borderRadius: esLinea ? 0 : (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) },
        label: cfg.etiquetas
          ? { show: true, position: horizontal ? 'right' : 'top', fontSize: 10, color: colorTexto,
              formatter: (p: any) => this.compacto(Number(p.value)) }
          : undefined,
        data: filas.map(f => Number(f[metIds[i]] ?? 0)),
      })) as never,
    };
  });

  private esCircular(tipo: string): boolean {
    return tipo === 'CIRCULAR' || tipo === 'DONA';
  }

  private texto(v: unknown): string {
    return v === null || v === undefined || v === '' ? '(sin dato)' : String(v);
  }

  /** 1 234 567 → "1,2 M". Los ejes con números largos se vuelven ilegibles. */
  private compacto(n: number): string {
    if (!isFinite(n)) return '0';
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} MM`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)} k`;
    return n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
  }
}

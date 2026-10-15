import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule, formatCurrency, getCurrencySymbol } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { KpiDia, ResumenKpi, TiendaService } from '../../service/tienda.service';

/**
 * Tablero de la tienda.
 *
 * <p>Todo lo que se ve aquí viene agregado del servidor. El navegador no suma nada: la
 * lección de manage-workers, que llegó a traerse 35 MB para que el front hiciera cuentas.
 *
 * <p>El orden de las tarjetas no es decorativo. Primero lo que dice si el negocio gana
 * dinero (venta y margen), después lo que dice si tiene con qué operar (cobrado por
 * nómina frente a caja, y valor del inventario). Un tablero que empieza por unidades
 * vendidas se mira una vez.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-indicadores',
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, NgxEchartsDirective, SelectorTienda, ...TABLA_ESTANDAR],
  providers: [provideEchartsTema()],
  templateUrl: './indicadores.html',
  styleUrls: ['../../styles/tienda-comun.css', './indicadores.css'],
})
export class Indicadores implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private readonly locale = inject(LOCALE_ID);

  readonly resumen = signal<ResumenKpi | null>(null);
  readonly serie = signal<KpiDia[]>([]);
  readonly ranking = signal<Array<Record<string, unknown>>>([]);
  readonly rentabilidad = signal<Array<Record<string, unknown>>>([]);
  readonly sinResultado = signal<Array<Record<string, unknown>>>([]);
  readonly cargando = signal(false);

  /** Lo que se suma desde Logis (mismo rango): clientes, unidades, horas, departamentos, lo que más rota. */
  readonly extra = signal<Record<string, any> | null>(null);
  readonly patrones = signal<Record<string, any> | null>(null);
  readonly departamentos = signal<Array<Record<string, any>>>([]);
  readonly topUnidades = signal<Array<Record<string, any>>>([]);

  desde = '';
  hasta = '';

  /** «Qué deja dinero»: pesos como número (ordena y suma bien); el formato es solo lo visible. */
  readonly columnasRentabilidad: ColumnaTabla<Record<string, unknown>>[] = [
    { id: 'producto', header: 'Producto', valor: (p) => p['nombre'] as string, tarjeta: 'titulo' },
    { id: 'vendido', header: 'Vendido', align: 'right', tarjeta: 'meta',
      valor: (p) => p['vendido'] as number,
      formato: (p) => this.pesos(p['vendido']), copiaTexto: (p) => String(p['vendido'] ?? '') },
    { id: 'margen', header: 'Margen', align: 'right', tarjeta: 'subtitulo',
      valor: (p) => p['margen'] as number,
      formato: (p) => this.pesos(p['margen']), copiaTexto: (p) => String(p['margen'] ?? '') },
    { id: 'unidades', header: 'Uds.', align: 'right', tarjeta: 'meta', valor: (p) => p['unidades'] as number },
  ];
  readonly idRentabilidad = (p: Record<string, unknown>) => p['producto_id'];

  /** Comparación entre tiendas (solo aparece si hay más de una en el ranking). */
  readonly columnasRanking: ColumnaTabla<Record<string, unknown>>[] = [
    { id: 'tienda', header: 'Tienda', valor: (t) => this.nombreTienda(t['tienda_id']), tarjeta: 'titulo' },
    { id: 'vendido', header: 'Vendido', align: 'right', tarjeta: 'subtitulo',
      valor: (t) => t['ventas_total'] as number,
      formato: (t) => this.pesos(t['ventas_total']), copiaTexto: (t) => String(t['ventas_total'] ?? '') },
    { id: 'margen', header: 'Margen', align: 'right', tarjeta: 'meta',
      valor: (t) => t['margen_bruto'] as number,
      formato: (t) => this.pesos(t['margen_bruto']), copiaTexto: (t) => String(t['margen_bruto'] ?? '') },
    { id: 'pct', header: '%', align: 'right', tarjeta: 'meta',
      valor: (t) => t['margen_pct'] as number, formato: (t) => `${t['margen_pct']}%` },
    { id: 'transacciones', header: 'Transacciones', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (t) => t['transacciones'] as number },
  ];
  readonly idRanking = (t: Record<string, unknown>) => t['tienda_id'];

  /** Ámbito: una tienda o todas las del alcance. Solo tiene sentido si ve más de una. */
  readonly todasLasTiendas = signal(false);

  constructor() {
    effect(() => {
      this.ctx.tiendaId();
      this.todasLasTiendas();
      this.cargar();
    });
  }

  ngOnInit(): void {
    this.ctx.cargar();
  }

  cargar(): void {
    const tienda = this.todasLasTiendas() ? undefined : (this.ctx.tiendaId() ?? undefined);
    const rango = { tienda, desde: this.desde || undefined, hasta: this.hasta || undefined };
    this.cargando.set(true);

    this.api.resumenKpi(rango).subscribe({
      next: r => { this.resumen.set(r); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
    this.api.serieKpi(rango).subscribe({ next: s => this.serie.set(s), error: () => this.serie.set([]) });
    this.api.rentabilidad(rango).subscribe({
      next: r => this.rentabilidad.set(r), error: () => this.rentabilidad.set([]),
    });
    // Lo de Logis va con el rango explícito: sin fechas, Indicadores mira los últimos 30 días.
    const hoy = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hace29 = new Date(hoy); hace29.setDate(hoy.getDate() - 29);
    const rangoLogis = { tienda, desde: rango.desde ?? iso(hace29), hasta: rango.hasta ?? iso(hoy) };
    this.api.logis('resumen', rangoLogis).subscribe({ next: r => this.extra.set(r), error: () => this.extra.set(null) });
    this.api.logis('patrones', rangoLogis).subscribe({ next: r => this.patrones.set(r), error: () => this.patrones.set(null) });
    this.api.logis('categorias', rangoLogis).subscribe({
      next: r => this.departamentos.set((r?.departamentos ?? []).slice(0, 10)), error: () => this.departamentos.set([]),
    });
    this.api.logis('productos', rangoLogis, { orden: 'unidades', limite: 10 }).subscribe({
      next: r => this.topUnidades.set(r ?? []), error: () => this.topUnidades.set([]),
    });

    this.api.rankingKpi({ desde: rango.desde, hasta: rango.hasta }).subscribe({
      next: r => this.ranking.set(r), error: () => this.ranking.set([]),
    });
    if (tienda) {
      this.api.busquedasSinResultado(tienda).subscribe({
        next: b => this.sinResultado.set(b), error: () => this.sinResultado.set([]),
      });
    } else {
      this.sinResultado.set([]);
    }
  }

  /** Venta y margen día a día. Dos series porque vender mucho y ganar poco es un caso real. */
  readonly grafica = computed<EChartsOption>(() => {
    const datos = this.serie();
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Venta', 'Margen'], bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 56, right: 16, top: 20, bottom: 46 },
      xAxis: {
        type: 'category',
        data: datos.map(d => d.fecha),
        axisLabel: { fontSize: 10, color: '#6b7280' },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          fontSize: 10, color: '#6b7280',
          formatter: (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M`
            : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v),
        },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      series: [
        {
          name: 'Venta', type: 'line', smooth: true, showSymbol: false,
          data: datos.map(d => d.ventas_total),
          itemStyle: { color: '#0b6b58' },
          areaStyle: { color: 'rgba(11,107,88,.10)' },
        },
        {
          name: 'Margen', type: 'line', smooth: true, showSymbol: false,
          data: datos.map(d => d.margen_bruto),
          itemStyle: { color: '#b4720e' },
        },
      ],
    };
  });

  /** Reparto por medio de pago: dice cuánto del negocio entra en caja y cuánto no. */
  readonly graficaPagos = computed<EChartsOption>(() => {
    const pagos = this.resumen()?.pagos_por_metodo ?? {};
    const datos = Object.entries(pagos).map(([nombre, valor]) => ({ name: nombre, value: valor }));
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [{
        type: 'pie', radius: ['48%', '72%'], center: ['50%', '44%'],
        avoidLabelOverlap: true, label: { show: false },
        data: datos,
        color: ['#0b6b58', '#3f9c86', '#b4720e', '#8a5c10', '#6b7280', '#9c3123'],
      }],
    };
  });

  /** Día de la semana × hora: cuándo se concentra la venta (hora de Colombia). */
  readonly graficaCalor = computed<EChartsOption>(() => {
    const c: Array<Record<string, any>> = this.patrones()?.['calor'] ?? [];
    const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const horas: number[] = [];
    for (let h = 7; h <= 20; h++) horas.push(h);
    const datos = c.filter(x => horas.includes(Number(x['hora'])))
      .map(x => [horas.indexOf(Number(x['hora'])), (Number(x['dow']) + 5) % 7, Math.round(x['venta'])]);
    const max = Math.max(1, ...datos.map(d => d[2]));
    return {
      tooltip: { formatter: (p: any) => `${dias[p.value[1]]} ${horas[p.value[0]]}:00<br>${this.pesos(p.value[2])}` },
      grid: { left: 40, right: 10, top: 6, bottom: 24 },
      xAxis: { type: 'category', data: horas.map(h => `${h}h`), axisLabel: { fontSize: 10 }, splitArea: { show: true } },
      yAxis: { type: 'category', data: dias, inverse: true, axisLabel: { fontSize: 10 }, splitArea: { show: true } },
      visualMap: { show: false, min: 0, max, inRange: { color: ['#f1f7f5', '#9fd1c3', '#0b6b58', '#063f34'] } },
      series: [{ type: 'heatmap', data: datos }],
    } as EChartsOption;
  });

  /** Lo que más rota (unidades), que no siempre es lo que más plata mueve. */
  readonly graficaTopUnidades = computed<EChartsOption>(() => {
    const top = [...this.topUnidades()].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 36, top: 6, bottom: 6, containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: '#f3f4f6' } } },
      yAxis: { type: 'category', data: top.map(f => String(f['nombre'] ?? '').slice(0, 30)), axisLabel: { fontSize: 10 } },
      series: [{ type: 'bar', data: top.map(f => Number(f['unidades'])), itemStyle: { color: '#3f9c86', borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: 10 } }],
    };
  });

  readonly graficaDepartamentos = computed<EChartsOption>(() => {
    const d = [...this.departamentos()].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => this.pesos(v) },
      grid: { left: 8, right: 16, top: 6, bottom: 6, containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${Math.round(v / 1000)}k` },
        splitLine: { lineStyle: { color: '#f3f4f6' } } },
      yAxis: { type: 'category', data: d.map(x => String(x['departamento'] ?? '').slice(0, 26)), axisLabel: { fontSize: 10 } },
      series: [{ type: 'bar', data: d.map(x => Math.round(x['venta'])), itemStyle: { color: '#b4720e', borderRadius: [0, 4, 4, 0] } }],
    };
  });

  variacion(clave: string): { texto: string; clase: string } | null {
    const v = this.extra()?.['variacion_pct']?.[clave];
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return { texto: `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toLocaleString(this.locale, { maximumFractionDigits: 1 })} %`, clase: n >= 0 ? 'sube' : 'baja' };
  }

  nombreTienda(id: unknown): string {
    return this.ctx.tiendas().find(t => t.id === id)?.nombre ?? String(id ?? '');
  }

  readonly hayPagos = computed(() =>
    Object.keys(this.resumen()?.pagos_por_metodo ?? {}).length > 0);

  readonly puedeCompararTiendas = computed(() =>
    this.ctx.esSuperAdmin() || this.ctx.tiendas().length > 1);

  /** Lo mismo que el pipe `currency:'COP':'symbol-narrow':'1.0-0'` de la plantilla. */
  private pesos(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    if (isNaN(n)) return '';
    return formatCurrency(n, this.locale, getCurrencySymbol('COP', 'narrow', this.locale), 'COP', '1.0-0');
  }
}

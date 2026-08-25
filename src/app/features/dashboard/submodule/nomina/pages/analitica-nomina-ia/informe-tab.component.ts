import { Component, ChangeDetectionStrategy, OnInit, signal, computed, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

import { NominaService, Client, CostCenter, PeriodoNominaDto, GranularidadTemporal } from '../../service/nomina/nomina.service';
import {
  AnaliticaIaService, AnalisisNomina, Anomalia, KpiComparado, DistribucionItemIA, InformeResp,
} from '../../service/analitica-ia/analitica-ia.service';
import { ChatSeed } from './chat-seed';
import { MarkdownMessageComponent } from './markdown-message.component';

interface BucketPeriodo { clave: string; etiqueta: string; desde: string; hasta: string; }

/**
 * Tab "Informe IA": filtros (empresa usuaria, centros de costo, año/periodo,
 * estado), tarjetas KPI comparadas, lista de anomalías, gráficas de comparación
 * y el informe redactado por la IA. El botón "Conversar este informe" siembra
 * el chat con el resumen.
 */
@Component({
  selector: 'app-informe-tab',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatSelectModule, MatButtonToggleModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
    NgxEchartsDirective, MarkdownMessageComponent,
  ],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './informe-tab.component.html',
  styleUrls: ['./informe-tab.component.css'],
})
export class InformeTabComponent implements OnInit {
  private nomina = inject(NominaService);
  private svc = inject(AnaliticaIaService);

  enviarAChat = output<ChatSeed>();

  // ── Paleta (color = concepto) ────────────────────────────────────────────
  private readonly C = {
    neto: '#1E88E5', devengado: '#43A047', deducido: '#E53935', ibc: '#00ACC1',
    aportes: '#FB8C00', empleados: '#8E24AA', empresa: '#1E88E5', ceco: '#00ACC1',
    factura: '#43A047', costo: '#E53935', margen: '#1E88E5',
  };

  // ── Filtros ──────────────────────────────────────────────────────────────
  empresas = signal<Client[]>([]);
  centrosCosto = signal<CostCenter[]>([]);
  empresaFilter = signal<string>('');
  cecoFilter = signal<string>('');
  empresasFiltradas = computed<Client[]>(() => {
    const q = this.empresaFilter().trim().toLowerCase();
    const list = this.empresas();
    if (!q) return list;
    const sel = this.selectedEmpresa();
    return list.filter((e) => e.id_entidad === sel ||
      (e.nombre_legal || '').toLowerCase().includes(q) || (e.nit || '').toLowerCase().includes(q));
  });
  cecosFiltrados = computed<CostCenter[]>(() => {
    const q = this.cecoFilter().trim().toLowerCase();
    const list = this.centrosCosto();
    if (!q) return list;
    const sel = new Set(this.selectedCecos());
    return list.filter((c) => sel.has(c.id_ceco) ||
      (c.nombre || '').toLowerCase().includes(q) || (c.codigo_interno || '').toLowerCase().includes(q));
  });

  selectedEmpresa = signal<number | null>(null);
  selectedCecos = signal<number[]>([]);
  selectedAnio = signal<number | null>(null);
  selectedEstado = signal<string | null>(null);
  granularidad = signal<GranularidadTemporal>('mes');
  periodosRaw = signal<PeriodoNominaDto[]>([]);
  selectedPeriodoClave = signal<string | null>(null);
  anios = signal<number[]>([]);

  readonly granularidades: { value: GranularidadTemporal; label: string }[] = [
    { value: 'quincena', label: 'Quincena' }, { value: 'mes', label: 'Mes' },
    { value: 'trimestre', label: 'Trimestre' }, { value: 'semestre', label: 'Semestre' },
    { value: 'anio', label: 'Año' },
  ];
  readonly estados = ['PENDIENTE', 'APROBADA', 'PAGADA'];
  private static readonly MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  buckets = computed<BucketPeriodo[]>(() => {
    const g = this.granularidad();
    if (g === 'anio') return [];
    const anio = this.selectedAnio();
    const periodos = this.periodosRaw()
      .filter((p) => !!p.fecha_inicio && (anio == null || p.fecha_inicio.slice(0, 4) === String(anio)))
      .slice().sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
    if (g === 'quincena') {
      return periodos.map((p) => ({
        clave: `q-${p.id_periodo}`, etiqueta: p.descripcion || p.fecha_inicio,
        desde: p.fecha_inicio, hasta: p.fecha_fin || p.fecha_inicio,
      }));
    }
    const M = InformeTabComponent.MESES;
    const map = new Map<string, BucketPeriodo>();
    for (const p of periodos) {
      const y = Number(p.fecha_inicio.slice(0, 4));
      const mes = Number(p.fecha_inicio.slice(5, 7));
      let clave: string, etiqueta: string;
      if (g === 'mes') { clave = `${y}-${String(mes).padStart(2, '0')}`; etiqueta = `${M[mes - 1]} ${y}`; }
      else if (g === 'trimestre') { const t = Math.floor((mes - 1) / 3) + 1; clave = `${y}-T${t}`; etiqueta = `T${t} ${y}`; }
      else { const s = mes <= 6 ? 1 : 2; clave = `${y}-S${s}`; etiqueta = `S${s} ${y}`; }
      const cur = map.get(clave);
      if (!cur) map.set(clave, { clave, etiqueta, desde: p.fecha_inicio, hasta: p.fecha_inicio });
      else { if (p.fecha_inicio < cur.desde) cur.desde = p.fecha_inicio; if (p.fecha_inicio > cur.hasta) cur.hasta = p.fecha_inicio; }
    }
    return Array.from(map.values());
  });
  mostrarPeriodo = computed<boolean>(() => this.granularidad() !== 'anio' && this.buckets().length > 0);
  periodoLabel = computed<string>(() => {
    switch (this.granularidad()) {
      case 'quincena': return 'Quincena'; case 'mes': return 'Mes';
      case 'trimestre': return 'Trimestre'; case 'semestre': return 'Semestre'; default: return 'Periodo';
    }
  });

  // ── Estado ────────────────────────────────────────────────────────────────
  loading = signal<boolean>(false);
  analisis = signal<AnalisisNomina | null>(null);
  loadingInforme = signal<boolean>(false);
  informe = signal<InformeResp | null>(null);
  errorInforme = signal<string | null>(null);

  hayDatos = computed<boolean>(() => (this.analisis()?.serie?.length ?? 0) > 0);
  kpis = computed<KpiComparado[]>(() => this.analisis()?.kpis ?? []);
  anomalias = computed<Anomalia[]>(() => this.analisis()?.anomalias ?? []);

  ngOnInit(): void {
    const y = new Date().getFullYear();
    this.anios.set([y, y - 1, y - 2, y - 3, y - 4]);
    this.selectedAnio.set(y);
    this.nomina.getClientesActivos().subscribe({ next: (cs) => this.empresas.set(cs ?? []), error: () => this.empresas.set([]) });
    this.cargarCecos();
    this.nomina.getPeriodosNomina().subscribe({ next: (ps) => this.periodosRaw.set(ps ?? []), error: () => this.periodosRaw.set([]) });
    this.analizar();
  }

  private cargarCecos(): void {
    const emp = this.selectedEmpresa();
    const req = emp != null ? this.nomina.getCentrosCostos(emp) : this.nomina.getCentrosCostos();
    req.subscribe({ next: (cc) => this.centrosCosto.set(cc ?? []), error: () => this.centrosCosto.set([]) });
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  onEmpresa(id: number | null): void { this.selectedEmpresa.set(id); this.selectedCecos.set([]); this.cargarCecos(); }
  onCecos(ids: number[]): void { this.selectedCecos.set(ids ?? []); }
  onAnio(a: number | null): void { this.selectedAnio.set(a); this.selectedPeriodoClave.set(null); }
  onEstado(e: string | null): void { this.selectedEstado.set(e); }
  onGranularidad(g: GranularidadTemporal): void { this.granularidad.set(g); this.selectedPeriodoClave.set(null); }
  onPeriodo(c: string | null): void { this.selectedPeriodoClave.set(c); }
  onEmpresaPanel(o: boolean): void { if (!o) this.empresaFilter.set(''); }
  onCecoPanel(o: boolean): void { if (!o) this.cecoFilter.set(''); }

  limpiar(): void {
    this.selectedEmpresa.set(null); this.selectedCecos.set([]);
    this.selectedAnio.set(new Date().getFullYear()); this.selectedPeriodoClave.set(null);
    this.selectedEstado.set(null); this.granularidad.set('mes'); this.cargarCecos();
  }

  private baseParams(): any {
    const params: any = { granularidad: this.granularidad() };
    const clave = this.selectedPeriodoClave();
    const bucket = clave ? this.buckets().find((b) => b.clave === clave) : undefined;
    const anio = this.selectedAnio();
    if (bucket) { params.desde = bucket.desde; params.hasta = bucket.hasta; }
    else if (anio != null) { params.desde = `${anio}-01-01`; params.hasta = `${anio}-12-31`; }
    const emp = this.selectedEmpresa();
    if (emp != null) params.cliente_id = emp;
    const cc = this.selectedCecos();
    if (cc.length) params.cecos = cc;
    const est = this.selectedEstado();
    if (est) params.estado = est;
    return params;
  }

  analizar(): void {
    this.loading.set(true);
    this.informe.set(null); this.errorInforme.set(null);
    this.svc.getAnalisis(this.baseParams()).subscribe({
      next: (d) => { this.analisis.set(d); this.loading.set(false); },
      error: () => { this.analisis.set(null); this.loading.set(false); },
    });
  }

  generarInforme(): void {
    const a = this.analisis();
    if (!a) return;
    this.loadingInforme.set(true); this.errorInforme.set(null);
    this.svc.generarInforme({ analisis: a }).subscribe({
      next: (r) => { this.informe.set(r); this.loadingInforme.set(false); },
      error: () => { this.errorInforme.set('No se pudo generar el informe. Verifica que el servicio de IA esté disponible.'); this.loadingInforme.set(false); },
    });
  }

  conversarInforme(): void {
    const inf = this.informe();
    const a = this.analisis();
    const contexto = inf?.resumen?.trim() || this.contextoDesdeAnalisis(a);
    const rango = a?.meta ? `${a.meta.desde ?? ''} a ${a.meta.hasta ?? ''}` : '';
    this.enviarAChat.emit({
      titulo: `Informe de nómina ${rango}`.trim(),
      contexto,
      nonce: Date.now(),
    });
  }

  /** Fallback: arma un contexto de texto compacto si aún no se generó el informe. */
  private contextoDesdeAnalisis(a: AnalisisNomina | null): string {
    if (!a) return 'Análisis de nómina sin datos.';
    const lines: string[] = ['Resumen del análisis de nómina:'];
    for (const k of a.kpis) {
      const v = k.formato === 'MONEDA' ? this.money(k.valorActual) : this.int(k.valorActual);
      const d = k.deltaPct != null ? ` (${k.deltaPct > 0 ? '+' : ''}${k.deltaPct}% vs anterior)` : '';
      lines.push(`- ${k.etiqueta}: ${v}${d}`);
    }
    if (a.anomalias.length) {
      lines.push(`Anomalías detectadas (${a.anomalias.length}):`);
      for (const an of a.anomalias.slice(0, 8)) lines.push(`- [${an.severidad}] ${an.mensaje}`);
    }
    return lines.join('\n');
  }

  // ── Formateo / color ─────────────────────────────────────────────────────
  private readonly fMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  private readonly fInt = new Intl.NumberFormat('es-CO');
  money(v: number | null | undefined): string { return this.fMoney.format(Number(v) || 0); }
  int(v: number | null | undefined): string { return this.fInt.format(Number(v) || 0); }
  private compact(v: number): string {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + 'K';
    return String(n);
  }
  kpiFmt(k: KpiComparado): string { return k.formato === 'MONEDA' ? this.money(k.valorActual) : this.int(k.valorActual); }
  sevClass(s: string): string { return s === 'ALTA' ? 'sev-alta' : s === 'MEDIA' ? 'sev-media' : 'sev-baja'; }
  deltaIcon(k: KpiComparado): string { return k.direccion === 'SUBE' ? 'trending_up' : k.direccion === 'BAJA' ? 'trending_down' : 'trending_flat'; }
  deltaLabel(k: KpiComparado): string { return k.deltaPct == null ? '' : `${k.deltaPct > 0 ? '+' : ''}${k.deltaPct}% vs anterior`; }

  private hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  private tint(hex: string, f: number): string { const [r, g, b] = this.hexToRgb(hex); const m = (c: number) => Math.round(c + (255 - c) * f); return `rgb(${m(r)},${m(g)},${m(b)})`; }
  private alpha(hex: string, a: number): string { const [r, g, b] = this.hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  private gradV(hex: string): any { return { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: this.tint(hex, 0.28) }, { offset: 1, color: hex }] }; }
  private gradH(hex: string): any { return { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: hex }, { offset: 1, color: this.tint(hex, 0.34) }] }; }
  private area(hex: string): any { return { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: this.alpha(hex, 0.26) }, { offset: 1, color: this.alpha(hex, 0.02) }] }; }

  // ── Gráficas ─────────────────────────────────────────────────────────────
  serieOption = computed<EChartsOption>(() => {
    const s = this.analisis()?.serie ?? [];
    const labels = s.map((p) => p.etiqueta);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: any) => this.tipMoney(ps) },
      legend: { bottom: 0, data: ['Devengado', 'Deducido', 'Neto'] },
      grid: { left: 8, right: 8, top: 24, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 8 ? 35 : 0 } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => this.compact(v) } },
      color: [this.C.devengado, this.C.deducido, this.C.neto],
      series: [
        { name: 'Devengado', type: 'bar', data: s.map((p) => p.devengado), barMaxWidth: 26, itemStyle: { color: this.gradV(this.C.devengado), borderRadius: [4, 4, 0, 0] } },
        { name: 'Deducido', type: 'bar', data: s.map((p) => p.deducido), barMaxWidth: 26, itemStyle: { color: this.gradV(this.C.deducido), borderRadius: [4, 4, 0, 0] } },
        { name: 'Neto', type: 'line', data: s.map((p) => p.neto), smooth: true, symbolSize: 8, lineStyle: { width: 3, color: this.C.neto }, itemStyle: { color: this.C.neto }, areaStyle: { color: this.area(this.C.neto) } },
      ],
    };
  });

  ibcAportesOption = computed<EChartsOption>(() => {
    const s = this.analisis()?.serie ?? [];
    const labels = s.map((p) => p.etiqueta);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'line' }, formatter: (ps: any) => this.tipMoney(ps) },
      legend: { bottom: 0, data: ['IBC', 'Aportes'] },
      grid: { left: 8, right: 8, top: 24, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 8 ? 35 : 0 } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => this.compact(v) } },
      color: [this.C.ibc, this.C.aportes],
      series: [
        { name: 'IBC', type: 'line', data: s.map((p) => p.ibc), smooth: true, symbolSize: 7, lineStyle: { width: 3, color: this.C.ibc }, itemStyle: { color: this.C.ibc }, areaStyle: { color: this.area(this.C.ibc) } },
        { name: 'Aportes', type: 'line', data: s.map((p) => p.aportes), smooth: true, symbolSize: 7, lineStyle: { width: 3, color: this.C.aportes }, itemStyle: { color: this.C.aportes } },
      ],
    };
  });

  empleadosOption = computed<EChartsOption>(() => {
    const s = this.analisis()?.serie ?? [];
    const labels = s.map((p) => p.etiqueta);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: any) => this.tipInt(ps) },
      grid: { left: 8, right: 8, top: 16, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 8 ? 35 : 0 } },
      yAxis: { type: 'value' },
      series: [{ name: 'Empleados', type: 'bar', data: s.map((p) => p.empleados), barMaxWidth: 34, itemStyle: { color: this.gradV(this.C.empleados), borderRadius: [6, 6, 0, 0] } }],
    };
  });

  topEmpresasOption = computed<EChartsOption>(() => this.barrasMonto(this.analisis()?.topEmpresas, this.C.empresa));
  topNovedadesOption = computed<EChartsOption>(() => this.barrasMonto(this.analisis()?.topNovedades, this.C.aportes));

  facturacionOption = computed<EChartsOption>(() => {
    const f = this.analisis()?.facturacion;
    const s = f?.serie ?? [];
    const labels = s.map((p) => p.etiqueta);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: any) => this.tipMoney(ps) },
      legend: { bottom: 0, data: ['Factura', 'Costo', 'Margen'] },
      grid: { left: 8, right: 8, top: 24, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 8 ? 35 : 0 } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => this.compact(v) } },
      color: [this.C.factura, this.C.costo, this.C.margen],
      series: [
        { name: 'Factura', type: 'bar', data: s.map((p) => p.factura), barMaxWidth: 24, itemStyle: { color: this.gradV(this.C.factura), borderRadius: [4, 4, 0, 0] } },
        { name: 'Costo', type: 'bar', data: s.map((p) => p.costo), barMaxWidth: 24, itemStyle: { color: this.gradV(this.C.costo), borderRadius: [4, 4, 0, 0] } },
        { name: 'Margen', type: 'line', data: s.map((p) => p.margen), smooth: true, symbolSize: 8, lineStyle: { width: 3, color: this.C.margen }, itemStyle: { color: this.C.margen } },
      ],
    };
  });

  private barrasMonto(items: DistribucionItemIA[] | undefined, color: string): EChartsOption {
    const list = (items ?? []).slice(0, 10).slice().reverse();
    const labels = list.map((i) => i.etiqueta);
    const valores = list.map((i) => Number(i.valor) || 0);
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any) => { const p = Array.isArray(ps) ? ps[0] : ps; return `<b>${p.name}</b><br/>${p.marker} ${this.money(p.value)}`; },
      },
      grid: { left: 8, right: 16, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => this.compact(v) } },
      yAxis: { type: 'category', data: labels, axisLabel: { width: 150, overflow: 'truncate' } },
      series: [{ name: 'Valor', type: 'bar', data: valores, barMaxWidth: 22, itemStyle: { color: this.gradH(color), borderRadius: [0, 6, 6, 0] } }],
    };
  }

  private tipMoney(ps: any): string {
    const arr = Array.isArray(ps) ? ps : [ps];
    let out = `<b>${arr[0]?.axisValue ?? ''}</b>`;
    for (const p of arr) out += `<br/>${p.marker} ${p.seriesName}: <b>${this.money(p.value)}</b>`;
    return out;
  }
  private tipInt(ps: any): string {
    const arr = Array.isArray(ps) ? ps : [ps];
    let out = `<b>${arr[0]?.axisValue ?? ''}</b>`;
    for (const p of arr) out += `<br/>${p.marker} ${p.seriesName}: <b>${this.int(p.value)}</b>`;
    return out;
  }
}

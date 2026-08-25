import { Component, ChangeDetectionStrategy, OnInit, signal, computed, inject } from '@angular/core';
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
import { MatTabsModule } from '@angular/material/tabs';

import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

import {
  NominaService, Client, CostCenter, TipoNovedad, PeriodoNominaDto,
  ReporteNovedadesDashboard, ReporteNominaDashboard, DistribucionItem, GranularidadTemporal,
} from '../../service/nomina/nomina.service';

/** Un bucket de tiempo seleccionable en el sub-selector de periodo. Al elegirlo
 *  se acota el rango desde/hasta del tablero a ese periodo concreto. */
interface BucketPeriodo {
  clave: string;      // identificador estable del bucket
  etiqueta: string;   // texto legible ("2ª Quincena Jun 2026", "Jun 2026", "T2 2026"…)
  desde: string;      // yyyy-MM-dd (min fechaInicio del bucket)
  hasta: string;      // yyyy-MM-dd (max fechaInicio del bucket, filtro inclusivo)
}

/**
 * Submódulo "Reportes y Analítica" de Nómina.
 *
 * Dos pestañas, ambas solo lectura y agregadas en el backend:
 *   • Novedades      → /api/nomina/reportes/novedades/dashboard
 *   • Nómina Pagada  → /api/nomina/reportes/nomina/dashboard
 *
 * Filtros comunes (año, empresa usuaria, centros de costo, granularidad + un
 * sub-selector de periodo concreto); el filtro de estado_pago aplica solo a
 * Nómina Pagada. Gráficas con echarts (combo, dona y barras). El color sigue
 * al CONCEPTO (mismo concepto → mismo color en todo el módulo), no al índice.
 */
@Component({
  selector: 'app-reportes-analitica',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatSelectModule, MatButtonToggleModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, MatTabsModule,
    NgxEchartsDirective,
  ],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  templateUrl: './reportes-analitica.component.html',
  styleUrls: ['./reportes-analitica.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportesAnaliticaComponent implements OnInit {
  private svc = inject(NominaService);

  // ── Sistema de color: COLOR = CONCEPTO ──────────────────────────────────────
  // El mismo concepto usa el mismo color en KPIs, series y pasteles. Tonos
  // Material-600 validados para superficie clara (banda de luminosidad + CVD).
  private readonly C = {
    neto:      '#1E88E5',  // azul   → resultado / neto
    devengado: '#43A047',  // verde  → dinero que entra (devengo)
    deducido:  '#E53935',  // rojo   → dinero que sale (deducción)
    valor:     '#FB8C00',  // ámbar  → monto asociado a las novedades
    novedades: '#8E24AA',  // púrpura→ conteo de novedades
    ibc:       '#00ACC1',  // cyan   → base de cotización
    // Dimensiones (consistentes entre pestañas): empresa siempre azul, ceco
    // siempre cyan, tipo de novedad siempre púrpura.
    empresa:   '#1E88E5',
    ceco:      '#00ACC1',
    tipo:      '#8E24AA',
  };
  // Estado de pago (status): verde / azul / ámbar, siempre el mismo por estado.
  private readonly COLOR_ESTADO: Record<string, string> = {
    PAGADA: '#43A047', APROBADA: '#1E88E5', PENDIENTE: '#FB8C00',
  };
  // Paleta categórica (orden fijo, nunca cíclica) para dimensiones sin color
  // semántico propio, p. ej. la clasificación. Validada CVD en modo claro.
  private readonly CATEGORICA = [
    '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1', '#E53935', '#5E35B1', '#7CB342',
  ];

  // ── Filtros ───────────────────────────────────────────────────────────────
  empresas = signal<Client[]>([]);
  centrosCosto = signal<CostCenter[]>([]);

  // Texto de búsqueda dentro de los desplegables (buscar-mientras-escribes).
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

  // Agrupador (super-categoría, V29): cascadea el selector de tipo de novedad.
  selectedAgrupador = signal<string | null>(null);
  readonly AGRUPADORES: { value: string; label: string }[] = [
    { value: 'AUSENCIAS', label: 'Ausencias' },
    { value: 'INCAPACIDADES', label: 'Incapacidades' },
    { value: 'EXTRAS_Y_BONIFICACIONES', label: 'Extras y Bonificaciones' },
  ];

  // Tipos de novedad (filtro exclusivo de la pestaña Novedades).
  tiposNovedad = signal<TipoNovedad[]>([]);
  codigoFilter = signal<string>('');
  tiposFiltrados = computed<TipoNovedad[]>(() => {
    const q = this.codigoFilter().trim().toLowerCase();
    const g = this.selectedAgrupador();
    const sel = new Set(this.selectedCodigos());
    return this.tiposNovedad().filter((t) => {
      // Si hay agrupador elegido, solo sus novedades (los ya seleccionados quedan visibles).
      if (g && t.agrupador !== g && !sel.has(t.codigo)) return false;
      if (q && !sel.has(t.codigo) &&
          !((t.descripcion || '').toLowerCase().includes(q) || (t.codigo || '').toLowerCase().includes(q))) {
        return false;
      }
      return true;
    });
  });

  selectedEmpresa = signal<number | null>(null);
  selectedCecos = signal<number[]>([]);
  selectedCodigos = signal<string[]>([]);          // tipos de novedad
  selectedAnio = signal<number | null>(null);
  selectedEstado = signal<string | null>(null);   // solo Nómina Pagada
  granularidad = signal<GranularidadTemporal>('mes');

  // Sub-selector de periodo concreto (quincena/mes/trimestre/semestre) dentro
  // del año elegido. null = "Todo el año".
  periodosRaw = signal<PeriodoNominaDto[]>([]);
  selectedPeriodoClave = signal<string | null>(null);

  anios = signal<number[]>([]);
  readonly granularidades: { value: GranularidadTemporal; label: string }[] = [
    { value: 'quincena', label: 'Quincena' },
    { value: 'mes', label: 'Mes' },
    { value: 'trimestre', label: 'Trimestre' },
    { value: 'semestre', label: 'Semestre' },
    { value: 'anio', label: 'Año' },
  ];
  readonly estados = ['PENDIENTE', 'APROBADA', 'PAGADA'];

  private static readonly MESES_ABBR = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
  ];

  /** Buckets disponibles para la granularidad y el año actuales. Se derivan de
   *  los periodos reales de nómina, agrupando por el mes/trimestre/semestre de
   *  su fecha de inicio (idéntico al bucketing del backend). */
  buckets = computed<BucketPeriodo[]>(() => {
    const g = this.granularidad();
    if (g === 'anio') return [];
    const anio = this.selectedAnio();
    const periodos = this.periodosRaw()
      .filter((p) => !!p.fecha_inicio && (anio == null || p.fecha_inicio.slice(0, 4) === String(anio)))
      .slice()
      .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));

    if (g === 'quincena') {
      return periodos.map((p) => ({
        clave: `q-${p.id_periodo}`,
        etiqueta: p.descripcion || p.fecha_inicio,
        desde: p.fecha_inicio,
        hasta: p.fecha_fin || p.fecha_inicio,
      }));
    }

    // mes / trimestre / semestre → agrupar por bucket calendario de fecha_inicio.
    const M = ReportesAnaliticaComponent.MESES_ABBR;
    const map = new Map<string, BucketPeriodo>();
    for (const p of periodos) {
      const y = Number(p.fecha_inicio.slice(0, 4));
      const mes = Number(p.fecha_inicio.slice(5, 7));   // 1..12
      let clave: string, etiqueta: string;
      if (g === 'mes') {
        clave = `${y}-${String(mes).padStart(2, '0')}`;
        etiqueta = `${M[mes - 1]} ${y}`;
      } else if (g === 'trimestre') {
        const t = Math.floor((mes - 1) / 3) + 1;
        clave = `${y}-T${t}`; etiqueta = `T${t} ${y}`;
      } else {
        const s = mes <= 6 ? 1 : 2;
        clave = `${y}-S${s}`; etiqueta = `S${s} ${y}`;
      }
      const cur = map.get(clave);
      if (!cur) {
        map.set(clave, { clave, etiqueta, desde: p.fecha_inicio, hasta: p.fecha_inicio });
      } else {
        // El filtro es fecha_inicio ∈ [desde, hasta] inclusivo, así que basta con
        // encuadrar el mín/máx de fecha_inicio de los periodos del bucket.
        if (p.fecha_inicio < cur.desde) cur.desde = p.fecha_inicio;
        if (p.fecha_inicio > cur.hasta) cur.hasta = p.fecha_inicio;
      }
    }
    return Array.from(map.values());
  });

  /** Muestra el sub-selector de periodo salvo en granularidad "Año" o sin buckets. */
  mostrarPeriodo = computed<boolean>(() => this.granularidad() !== 'anio' && this.buckets().length > 0);

  /** Etiqueta del sub-selector, según la granularidad activa. */
  periodoLabel = computed<string>(() => {
    switch (this.granularidad()) {
      case 'quincena': return 'Quincena';
      case 'mes': return 'Mes';
      case 'trimestre': return 'Trimestre';
      case 'semestre': return 'Semestre';
      default: return 'Periodo';
    }
  });

  // ── Estado ──────────────────────────────────────────────────────────────────
  tab = signal<number>(0);                      // 0 = novedades, 1 = nómina pagada
  loadingNov = signal<boolean>(false);
  loadingNom = signal<boolean>(false);
  dataNov = signal<ReporteNovedadesDashboard | null>(null);
  dataNom = signal<ReporteNominaDashboard | null>(null);

  hayNovedades = computed(() => (this.dataNov()?.resumen?.totalNovedades ?? 0) > 0);
  hayNomina = computed(() => (this.dataNom()?.resumen?.totalNominas ?? 0) > 0);

  ngOnInit(): void {
    const y = new Date().getFullYear();
    this.anios.set([y, y - 1, y - 2, y - 3, y - 4]);
    this.selectedAnio.set(y);

    this.svc.getClientesActivos().subscribe({
      next: (cs) => this.empresas.set(cs ?? []),
      error: () => this.empresas.set([]),
    });
    this.cargarCecos();
    this.cargarPeriodos();
    this.reload();
  }

  private cargarCecos(): void {
    const emp = this.selectedEmpresa();
    const req = emp != null ? this.svc.getCentrosCostos(emp) : this.svc.getCentrosCostos();
    req.subscribe({
      next: (cc) => this.centrosCosto.set(cc ?? []),
      error: () => this.centrosCosto.set([]),
    });
  }

  /** Lista completa de periodos de nómina (para el sub-selector). No depende de
   *  empresa/ceco: los periodos son globales; el filtro por año se hace en el
   *  computed `buckets`. */
  private cargarPeriodos(): void {
    this.svc.getPeriodosNomina().subscribe({
      next: (ps) => this.periodosRaw.set(ps ?? []),
      error: () => this.periodosRaw.set([]),
    });
  }

  /** Tipos de novedad disponibles en el scope actual (año/empresa/cecos), sin
   *  filtrar por código (para no vaciar el propio selector). */
  private cargarTipos(): void {
    const params: any = {};
    const anio = this.selectedAnio();
    if (anio != null) { params.desde = `${anio}-01-01`; params.hasta = `${anio}-12-31`; }
    const emp = this.selectedEmpresa();
    if (emp != null) params.cliente_id = emp;
    const cc = this.selectedCecos();
    if (cc.length) params.cecos = cc;
    this.svc.getTiposNovedad(params).subscribe({
      next: (t) => this.tiposNovedad.set(t ?? []),
      error: () => this.tiposNovedad.set([]),
    });
  }

  // ── Handlers de filtros ─────────────────────────────────────────────────────
  onTab(i: number): void { this.tab.set(i); }
  onEmpresa(id: number | null): void {
    this.selectedEmpresa.set(id);
    this.selectedCecos.set([]);
    this.selectedCodigos.set([]);   // los tipos disponibles dependen de la empresa
    this.cargarCecos();
    this.reload();
  }
  onCecos(ids: number[]): void { this.selectedCecos.set(ids ?? []); this.reload(); }
  onCodigos(codes: string[]): void { this.selectedCodigos.set(codes ?? []); this.reloadNovedades(); }
  onAgrupador(g: string | null): void {
    this.selectedAgrupador.set(g);
    // Al cambiar de agrupador, descarta los tipos ya seleccionados que no pertenezcan.
    if (g) {
      const permitidos = new Set(this.tiposNovedad().filter((t) => t.agrupador === g).map((t) => t.codigo));
      const quedan = this.selectedCodigos().filter((c) => permitidos.has(c));
      if (quedan.length !== this.selectedCodigos().length) this.selectedCodigos.set(quedan);
    }
    this.reloadNovedades();   // el agrupador filtra también las gráficas/KPIs
  }
  onAnio(a: number | null): void {
    this.selectedAnio.set(a);
    this.selectedPeriodoClave.set(null);   // los periodos disponibles cambian con el año
    this.reload();
  }
  onEstado(e: string | null): void { this.selectedEstado.set(e); this.reloadNomina(); }
  onGranularidad(g: GranularidadTemporal): void {
    this.granularidad.set(g);
    this.selectedPeriodoClave.set(null);   // los buckets cambian de forma con la granularidad
    this.reload();
  }
  onPeriodo(clave: string | null): void { this.selectedPeriodoClave.set(clave); this.reload(); }

  /** Limpia el texto de búsqueda al cerrar cada desplegable. */
  onEmpresaPanel(opened: boolean): void { if (!opened) this.empresaFilter.set(''); }
  onCecoPanel(opened: boolean): void { if (!opened) this.cecoFilter.set(''); }
  onCodigoPanel(opened: boolean): void { if (!opened) this.codigoFilter.set(''); }

  limpiarFiltros(): void {
    this.selectedEmpresa.set(null);
    this.selectedCecos.set([]);
    this.selectedAgrupador.set(null);
    this.selectedCodigos.set([]);
    this.selectedAnio.set(new Date().getFullYear());
    this.selectedPeriodoClave.set(null);
    this.selectedEstado.set(null);
    this.granularidad.set('mes');
    this.cargarCecos();
    this.reload();
  }

  /** Params comunes a ambas pestañas. Si hay un periodo concreto elegido, acota
   *  el rango a ese bucket; si no, cubre todo el año seleccionado. */
  private baseParams(): any {
    const params: any = { granularidad: this.granularidad() };
    const clave = this.selectedPeriodoClave();
    const bucket = clave ? this.buckets().find((b) => b.clave === clave) : undefined;
    const anio = this.selectedAnio();
    if (bucket) {
      params.desde = bucket.desde; params.hasta = bucket.hasta;
    } else if (anio != null) {
      params.desde = `${anio}-01-01`; params.hasta = `${anio}-12-31`;
    }
    const emp = this.selectedEmpresa();
    if (emp != null) params.cliente_id = emp;
    const cc = this.selectedCecos();
    if (cc.length) params.cecos = cc;
    return params;
  }

  reload(): void { this.cargarTipos(); this.reloadNovedades(); this.reloadNomina(); }

  reloadNovedades(): void {
    this.loadingNov.set(true);
    const params = this.baseParams();
    const cod = this.selectedCodigos();
    if (cod.length) params.codigos = cod;
    // Sin tipos específicos pero con agrupador, el backend acota a sus códigos.
    const g = this.selectedAgrupador();
    if (g) params.agrupador = g;
    this.svc.getReporteNovedades(params).subscribe({
      next: (d) => { this.dataNov.set(d); this.loadingNov.set(false); },
      error: () => { this.dataNov.set(null); this.loadingNov.set(false); },
    });
  }

  reloadNomina(): void {
    this.loadingNom.set(true);
    const params = this.baseParams();
    const est = this.selectedEstado();
    if (est) params.estado = est;
    this.svc.getReporteNomina(params).subscribe({
      next: (d) => { this.dataNom.set(d); this.loadingNom.set(false); },
      error: () => { this.dataNom.set(null); this.loadingNom.set(false); },
    });
  }

  // ── Formateo ──────────────────────────────────────────────────────────────
  private readonly fmtMoney = new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  });
  private readonly fmtInt = new Intl.NumberFormat('es-CO');

  money(v: number | null | undefined): string { return this.fmtMoney.format(Number(v) || 0); }
  int(v: number | null | undefined): string { return this.fmtInt.format(Number(v) || 0); }

  private compact(v: number): string {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + 'K';
    return String(n);
  }

  // ── Utilidades de color ─────────────────────────────────────────────────────
  private hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  /** Aclara un color mezclándolo con blanco (f=0 base … f=1 blanco). */
  private tint(hex: string, f: number): string {
    const [r, g, b] = this.hexToRgb(hex);
    const m = (c: number) => Math.round(c + (255 - c) * f);
    return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
  }
  private alpha(hex: string, a: number): string {
    const [r, g, b] = this.hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  /** Degradé vertical (arriba claro → abajo base) para barras que crecen hacia arriba. */
  private gradV(hex: string): any {
    return {
      type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [{ offset: 0, color: this.tint(hex, 0.28) }, { offset: 1, color: hex }],
    };
  }
  /** Degradé horizontal (izq base → der claro) para barras horizontales. */
  private gradH(hex: string): any {
    return {
      type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
      colorStops: [{ offset: 0, color: hex }, { offset: 1, color: this.tint(hex, 0.34) }],
    };
  }
  /** Relleno de área bajo una línea (base translúcido → transparente). */
  private area(hex: string): any {
    return {
      type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [{ offset: 0, color: this.alpha(hex, 0.26) }, { offset: 1, color: this.alpha(hex, 0.02) }],
    };
  }

  /** Color semántico para el pastel "por naturaleza": DEVENGO verde, DEDUCCIÓN rojo. */
  private colorNaturaleza = (name: string): string | undefined => {
    const n = (name || '').toUpperCase();
    if (n.includes('DEVENGO')) return this.C.devengado;
    if (n.includes('DEDUC')) return this.C.deducido;
    return undefined;   // otras naturalezas → paleta categórica
  };

  // ══════════════════ GRÁFICAS — NOVEDADES ══════════════════
  serieNovOption = computed<EChartsOption>(() => {
    const s = this.dataNov()?.serieTemporal ?? [];
    const labels = s.map((p) => p.etiqueta);
    const conteos = s.map((p) => p.conteo);
    const valores = s.map((p) => Number(p.valor) || 0);
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const arr = Array.isArray(params) ? params : [params];
          let out = `<b>${arr[0]?.axisValue ?? ''}</b>`;
          for (const p of arr) {
            const val = p.seriesName === 'Valor' ? this.money(p.value) : this.int(p.value);
            out += `<br/>${p.marker} ${p.seriesName}: <b>${val}</b>`;
          }
          return out;
        },
      },
      legend: { bottom: 0, data: ['Novedades', 'Valor'] },
      grid: { left: 8, right: 8, top: 24, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 8 ? 35 : 0 } },
      yAxis: [
        { type: 'value', name: '# Novedades' },
        { type: 'value', name: 'Valor', axisLabel: { formatter: (v: number) => this.compact(v) } },
      ],
      color: [this.C.novedades, this.C.valor],
      series: [
        {
          name: 'Novedades', type: 'bar', data: conteos, barMaxWidth: 42,
          itemStyle: { color: this.gradV(this.C.novedades), borderRadius: [6, 6, 0, 0] },
        },
        {
          name: 'Valor', type: 'line', yAxisIndex: 1, data: valores, smooth: true, symbolSize: 8,
          lineStyle: { width: 3, color: this.C.valor }, itemStyle: { color: this.C.valor },
          areaStyle: { color: this.area(this.C.valor) },
        },
      ],
    };
  });

  porTipoOption = computed<EChartsOption>(() => this.barrasConteo(this.dataNov()?.porTipo, 12, this.C.tipo));
  porNaturalezaOption = computed<EChartsOption>(() =>
    this.donut(this.dataNov()?.porNaturaleza, { colorFor: this.colorNaturaleza }));
  porClasificacionOption = computed<EChartsOption>(() => this.donut(this.dataNov()?.porClasificacion));
  porEmpresaNovOption = computed<EChartsOption>(() => this.barrasConteo(this.dataNov()?.porEmpresa, 10, this.C.empresa));
  porCecoNovOption = computed<EChartsOption>(() => this.barrasConteo(this.dataNov()?.porCeco, 10, this.C.ceco));

  // ══════════════════ GRÁFICAS — NÓMINA PAGADA ══════════════════
  serieNomOption = computed<EChartsOption>(() => {
    const s = this.dataNom()?.serieTemporal ?? [];
    const labels = s.map((p) => p.etiqueta);
    const dev = s.map((p) => Number(p.devengado) || 0);
    const ded = s.map((p) => Number(p.deducido) || 0);
    const neto = s.map((p) => Number(p.neto) || 0);
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const arr = Array.isArray(params) ? params : [params];
          let out = `<b>${arr[0]?.axisValue ?? ''}</b>`;
          for (const p of arr) out += `<br/>${p.marker} ${p.seriesName}: <b>${this.money(p.value)}</b>`;
          return out;
        },
      },
      legend: { bottom: 0, data: ['Devengado', 'Deducido', 'Neto'] },
      grid: { left: 8, right: 8, top: 24, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 8 ? 35 : 0 } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => this.compact(v) } },
      color: [this.C.devengado, this.C.deducido, this.C.neto],
      series: [
        {
          name: 'Devengado', type: 'bar', data: dev, barMaxWidth: 26,
          itemStyle: { color: this.gradV(this.C.devengado), borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Deducido', type: 'bar', data: ded, barMaxWidth: 26,
          itemStyle: { color: this.gradV(this.C.deducido), borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Neto', type: 'line', data: neto, smooth: true, symbolSize: 8,
          lineStyle: { width: 3, color: this.C.neto }, itemStyle: { color: this.C.neto },
          areaStyle: { color: this.area(this.C.neto) },
        },
      ],
    };
  });

  porEmpresaNomOption = computed<EChartsOption>(() => this.barrasMonto(this.dataNom()?.porEmpresa, 10, this.C.empresa));
  porCecoNomOption = computed<EChartsOption>(() => this.barrasMonto(this.dataNom()?.porCeco, 10, this.C.ceco));
  porEstadoOption = computed<EChartsOption>(() =>
    this.donut(this.dataNom()?.porEstado, {
      usarValor: true, money: true, colorFor: (name) => this.COLOR_ESTADO[name],
    }));

  // ── Builders reutilizables ──────────────────────────────────────────────────
  /** Barras horizontales por CONTEO (novedades). */
  private barrasConteo(items: DistribucionItem[] | undefined, topN: number, color: string): EChartsOption {
    const list = (items ?? []).slice(0, topN).slice().reverse();
    const labels = list.map((i) => i.etiqueta);
    const conteos = list.map((i) => i.conteo);
    const valores = list.map((i) => Number(i.valor) || 0);
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = p.dataIndex;
          return `<b>${p.name}</b><br/>${p.marker} Novedades: <b>${this.int(conteos[idx])}</b><br/>Valor: <b>${this.money(valores[idx])}</b>`;
        },
      },
      grid: { left: 8, right: 16, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: labels, axisLabel: { width: 160, overflow: 'truncate' } },
      series: [{
        name: 'Novedades', type: 'bar', data: conteos, barMaxWidth: 24,
        itemStyle: { color: this.gradH(color), borderRadius: [0, 6, 6, 0] },
      }],
    };
  }

  /** Barras horizontales por MONTO neto (nómina). */
  private barrasMonto(items: DistribucionItem[] | undefined, topN: number, color: string): EChartsOption {
    const list = (items ?? []).slice(0, topN).slice().reverse();
    const labels = list.map((i) => i.etiqueta);
    const valores = list.map((i) => Number(i.valor) || 0);
    const conteos = list.map((i) => i.conteo);
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = p.dataIndex;
          return `<b>${p.name}</b><br/>${p.marker} Neto: <b>${this.money(valores[idx])}</b><br/>Nóminas: <b>${this.int(conteos[idx])}</b>`;
        },
      },
      grid: { left: 8, right: 16, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => this.compact(v) } },
      yAxis: { type: 'category', data: labels, axisLabel: { width: 160, overflow: 'truncate' } },
      series: [{
        name: 'Neto', type: 'bar', data: valores, barMaxWidth: 24,
        itemStyle: { color: this.gradH(color), borderRadius: [0, 6, 6, 0] },
      }],
    };
  }

  /**
   * Dona genérica. Colorea por CONCEPTO cuando `colorFor` devuelve un color; si
   * no, cae a la paleta categórica en orden fijo. `usarValor`/`money` deciden si
   * mide montos (nómina) o conteos (novedades).
   */
  private donut(items: DistribucionItem[] | undefined, opts?: {
    usarValor?: boolean;
    money?: boolean;
    colorFor?: (name: string, i: number) => string | undefined;
  }): EChartsOption {
    const usarValor = opts?.usarValor ?? false;
    const money = opts?.money ?? false;
    const data = (items ?? []).map((it, i) => {
      const c = opts?.colorFor?.(it.etiqueta, i);
      return {
        value: usarValor ? (Number(it.valor) || 0) : it.conteo,
        name: it.etiqueta,
        ...(c ? { itemStyle: { color: c } } : {}),
      };
    });
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => money
          ? `${p.name}<br/><b>${this.money(p.value)}</b> (${p.percent}%)`
          : `${p.name}<br/><b>${this.int(p.value)}</b> (${p.percent}%)`,
      },
      legend: { bottom: 0, left: 'center' },
      color: this.CATEGORICA,
      series: [{
        name: '', type: 'pie', radius: ['45%', '72%'], avoidLabelOverlap: true,
        itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
        label: { show: false, position: 'center' },
        emphasis: {
          label: {
            show: true, fontSize: 15, fontWeight: 'bold',
            formatter: (p: any) => money ? this.money(p.value) : this.int(p.value),
          },
        },
        labelLine: { show: false },
        data,
      }],
    };
  }
}

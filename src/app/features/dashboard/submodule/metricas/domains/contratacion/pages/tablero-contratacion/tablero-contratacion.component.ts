import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, switchMap, tap } from 'rxjs/operators';

import { provideEchartsTema } from '@/app/shared/utils/echarts-tema';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { MetricasContratacionService } from '../../services/metricas-contratacion.service';
import {
  CATEGORIA_TEXTO, ESTADOS_EVALUACION, ETAPA_TEXTO, FilaIngreso, FilaOficina, FilaProceso, FiltrosMetricas, Kpis,
  RESULTADOS, TEMPORAL_TEXTO, TableroContratacion, VacanteMetrica,
} from '../../models/metricas-contratacion.models';
import { FichaPersonaContratacionComponent } from '../../components/ficha-persona-contratacion/ficha-persona-contratacion.component';
import { InformeDiarioComponent } from '../../components/informe-diario/informe-diario.component';
import { ResumenIaComponent } from '../../components/resumen-ia/resumen-ia.component';

type Preset = 'hoy' | 'ayer' | '7d' | '30d' | 'mes' | 'mes_ant' | '90d' | 'custom';
type Vista = 'procesos' | 'ingresos' | 'vacantes';

/** Un indicador de la franja superior con su variación contra el periodo anterior. */
interface Tarjeta {
  clave: keyof Kpis;
  titulo: string;
  icono: string;
  valor: number | null;
  sufijo?: string;
  anterior: number | null;
  /** true si subir es malo (no aplica, retiro temprano, días a ingreso). */
  inverso?: boolean;
  detalle?: string;
  serie?: number[];
  tono: string;
}

const PALETA = {
  azul: '#2B59F0', azulSuave: '#93B4FF', verde: '#16A34A', verdeSuave: '#86EFAC', violeta: '#7C3AED',
  ambar: '#F59E0B', rojo: '#DC2626', cian: '#0891B2', gris: '#94A3B8', al: '#2563EB', ta: '#F59E0B',
};
/** Paleta categórica para comparar oficinas (orden fijo: la misma oficina conserva su color). */
const CATEGORICA = ['#2B59F0', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D',
  '#EA580C', '#0F766E', '#9333EA', '#CA8A04', '#4F46E5', '#BE123C', '#0284C7', '#15803D'];

/**
 * Métricas de Contratación (rediseño del 22-oct-2026).
 *
 * Una sola pantalla, de lo general a lo particular: indicadores con su variación, el flujo del
 * proceso (embudo y dónde se quedó cada persona), el día a día, la comparación entre oficinas,
 * fincas y vacantes, motivos, medios de llegada, el equipo, el perfil, y abajo el detalle real con
 * la ficha de cada persona. Todos los filtros viajan al backend; las gráficas filtran al hacer clic.
 */
@Component({
  selector: 'app-tablero-contratacion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, DecimalPipe, FormsModule,
    MatButtonModule, MatIconModule, MatMenuModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatNativeDateModule, MatTooltipModule, MatProgressBarModule,
    NgxEchartsDirective, ...TABLA_ESTANDAR, InformeDiarioComponent, ResumenIaComponent,
  ],
  providers: [provideEchartsTema()],
  templateUrl: './tablero-contratacion.component.html',
  styleUrl: './tablero-contratacion.component.css',
})
export class TableroContratacionComponent {
  private readonly api = inject(MetricasContratacionService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  readonly RESULTADOS = RESULTADOS;

  /** Resumen con IA del análisis: se regenera cuando cambian los filtros. */
  readonly claveResumen = computed(() => JSON.stringify(this.filtros()));
  readonly fuenteResumen = () => this.api.resumenAnalisis(this.filtros());

  /** Informe diario (lo básico, por defecto) o el análisis completo. Se recuerda por navegador. */
  readonly modo = signal<'diario' | 'analisis'>(this.leerModo());

  cambiarModo(m: 'diario' | 'analisis'): void {
    this.modo.set(m);
    try { localStorage.setItem('metricas-contratacion:modo', m); } catch { /* opcional */ }
    if (m === 'analisis' && !this.t()) this.recargar();
  }

  private leerModo(): 'diario' | 'analisis' {
    try { return localStorage.getItem('metricas-contratacion:modo') === 'analisis' ? 'analisis' : 'diario'; } catch { return 'diario'; }
  }
  readonly TEMPORAL_TEXTO = TEMPORAL_TEXTO;

  // ─── Filtros ─────────────────────────────────────────────────────
  readonly presets: { id: Preset; texto: string }[] = [
    { id: 'hoy', texto: 'Hoy' }, { id: 'ayer', texto: 'Ayer' }, { id: '7d', texto: '7 días' },
    { id: '30d', texto: '30 días' }, { id: 'mes', texto: 'Este mes' }, { id: 'mes_ant', texto: 'Mes anterior' },
    { id: '90d', texto: '90 días' },
  ];
  readonly preset = signal<Preset>(this.leerPreset());
  readonly desde = signal<Date>(this.rangoDe(this.preset())[0]);
  readonly hasta = signal<Date>(this.rangoDe(this.preset())[1]);
  readonly temporal = signal<string | null>(null);
  readonly oficinas = signal<string[]>([]);
  readonly fincas = signal<string[]>([]);
  readonly medio = signal<string | null>(null);
  readonly usuarios = signal<string[]>([]);
  readonly cargo = signal<string | null>(null);

  /** Inicio elegido en el calendario mientras falta el fin. */
  rangoInicio: Date | null = null;

  readonly secciones = [
    { id: 'sec-resumen', texto: 'Resumen' }, { id: 'sec-flujo', texto: 'Flujo' }, { id: 'sec-dia', texto: 'Día a día' },
    { id: 'sec-oficinas', texto: 'Oficinas' }, { id: 'sec-fincas', texto: 'Fincas y vacantes' },
    { id: 'sec-motivos', texto: 'Motivos' }, { id: 'sec-medios', texto: 'Medios' }, { id: 'sec-equipo', texto: 'Equipo' },
    { id: 'sec-perfil', texto: 'Perfil' }, { id: 'sec-detalle', texto: 'Detalle' },
  ];

  readonly filtros = computed<FiltrosMetricas>(() => ({
    desde: ymd(this.desde()), hasta: ymd(this.hasta()), oficinas: this.oficinas(), temporal: this.temporal(),
    fincas: this.fincas(), medio: this.medio(), usuarios: this.usuarios(), cargo: this.cargo(),
  }));

  readonly filtrosActivos = computed(() => {
    const out: { id: string; texto: string }[] = [];
    if (this.temporal()) out.push({ id: 'temporal', texto: TEMPORAL_TEXTO[this.temporal()!] ?? this.temporal()! });
    for (const o of this.oficinas()) out.push({ id: 'oficina:' + o, texto: o });
    for (const f of this.fincas()) out.push({ id: 'finca:' + f, texto: 'Finca: ' + f });
    if (this.medio()) out.push({ id: 'medio', texto: 'Medio: ' + this.medio() });
    for (const u of this.usuarios()) out.push({ id: 'usuario:' + u, texto: 'Usuario: ' + u });
    if (this.cargo()) out.push({ id: 'cargo', texto: 'Cargo: ' + this.cargo() });
    return out;
  });

  // ─── Datos ───────────────────────────────────────────────────────
  readonly cargando = signal(false);
  readonly cargandoDetalle = signal(false);
  readonly error = signal<string | null>(null);
  readonly t = signal<TableroContratacion | null>(null);
  readonly procesos = signal<FilaProceso[]>([]);
  readonly ingresos = signal<FilaIngreso[]>([]);
  readonly truncado = signal(false);
  readonly vista = signal<Vista>('procesos');
  readonly filtroResultado = signal<string | null>(null);
  readonly metricaOficinas = signal<'ingresos' | 'presentados'>('ingresos');
  readonly descargando = signal(false);

  private readonly recarga$ = new Subject<void>();

  constructor() {
    this.recarga$.pipe(
      debounceTime(250),
      tap(() => { this.cargando.set(true); this.cargandoDetalle.set(true); this.error.set(null); }),
      switchMap(() => {
        const f = this.filtros();
        return forkJoin({
          t: this.api.tablero(f),
          p: this.api.procesos(f).pipe(catchError(() => of(null))),
          i: this.api.ingresos(f).pipe(catchError(() => of(null))),
        }).pipe(catchError((e) => {
          this.error.set(e?.error?.message || e?.message || 'No se pudo cargar la información.');
          return of(null);
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => {
      this.cargando.set(false);
      this.cargandoDetalle.set(false);
      if (!r) return;
      this.t.set(r.t);
      this.procesos.set(r.p?.filas ?? []);
      this.ingresos.set(r.i?.filas ?? []);
      this.truncado.set(!!(r.p?.truncado || r.i?.truncado));
    });
    // El análisis se carga cuando se abre: el informe diario es la vista por defecto.
    if (this.modo() === 'analisis') this.recargar();
  }

  recargar(): void {
    this.recarga$.next();
  }

  elegirPreset(p: Preset): void {
    this.preset.set(p);
    const [d, h] = this.rangoDe(p);
    this.desde.set(d);
    this.hasta.set(h);
    try { localStorage.setItem('metricas-contratacion:preset', p); } catch { /* opcional */ }
    this.recargar();
  }

  cambioFechas(d: Date | null, h: Date | null): void {
    if (!d || !h) return;
    this.preset.set('custom');
    this.desde.set(d);
    this.hasta.set(h);
    this.rangoInicio = null;
    this.recargar();
  }

  set<K extends 'temporal' | 'medio' | 'cargo'>(k: K, v: string | null): void {
    this[k].set(v || null);
    this.recargar();
  }

  /** Finca / usuario: selección múltiple. */
  setLista(k: 'fincas' | 'usuarios', v: string[]): void {
    this[k].set(v ?? []);
    this.recargar();
  }

  /** Clic en una gráfica o en una fila: deja SOLO ese valor. */
  solo(k: 'fincas' | 'usuarios', v: string): void {
    if (!v) return;
    this[k].set([v]);
    this.recargar();
  }

  /** Opciones de un selector + lo ya elegido (que puede no tener datos con los demás filtros). */
  opcionesCon(lista: string[] | undefined, elegidos: string[]): string[] {
    const s = new Set(lista ?? []);
    return [...elegidos.filter((e) => !s.has(e)), ...(lista ?? [])];
  }

  setOficinas(v: string[]): void {
    this.oficinas.set(v ?? []);
    this.recargar();
  }

  quitarFiltro(id: string): void {
    if (id.startsWith('oficina:')) this.oficinas.update((l) => l.filter((o) => o !== id.slice(8)));
    else if (id.startsWith('finca:')) this.fincas.update((l) => l.filter((o) => o !== id.slice(6)));
    else if (id.startsWith('usuario:')) this.usuarios.update((l) => l.filter((o) => o !== id.slice(8)));
    else (this as any)[id].set(null);
    this.recargar();
  }

  limpiarFiltros(): void {
    this.temporal.set(null); this.oficinas.set([]); this.fincas.set([]);
    this.medio.set(null); this.usuarios.set([]); this.cargo.set(null);
    this.recargar();
  }

  irA(id: string): void {
    this.host.nativeElement.querySelector('#' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── Indicadores ─────────────────────────────────────────────────
  readonly tarjetas = computed<Tarjeta[]>(() => {
    const t = this.t();
    if (!t) return [];
    const k = t.kpis, a = t.kpis_anterior, s = t.serie_diaria;
    return [
      { clave: 'presentados', titulo: 'Se presentaron', icono: 'how_to_reg', valor: k.presentados, anterior: a.presentados,
        detalle: `${fmt(k.personas)} personas distintas`, serie: s.presentados, tono: 'azul' },
      { clave: 'evaluados', titulo: 'Evaluados', icono: 'fact_check', valor: k.evaluados, anterior: a.evaluados,
        detalle: `${pct(k.tasa_evaluacion)} de los presentados · ${fmt(k.sin_evaluar)} sin evaluar`, tono: 'violeta' },
      { clave: 'aplica', titulo: 'Aplican', icono: 'thumb_up', valor: k.aplica, anterior: a.aplica,
        detalle: `${pct(k.tasa_aplica)} de los evaluados`, serie: s.aplica, tono: 'verde' },
      { clave: 'no_aplica', titulo: 'No aplican', icono: 'block', valor: k.no_aplica, anterior: a.no_aplica, inverso: true,
        detalle: `${fmt(k.en_espera)} quedaron en espera`, serie: s.no_aplica, tono: 'rojo' },
      { clave: 'ingresos', titulo: 'Ingresos (contratos)', icono: 'badge', valor: k.ingresos, anterior: a.ingresos,
        detalle: `AL ${fmt(k.ingresos_al)} · TA ${fmt(k.ingresos_ta)}`, serie: s.ingresos, tono: 'verde' },
      { clave: 'tasa_conversion', titulo: 'Presentación → contrato', icono: 'trending_up', valor: k.tasa_conversion,
        sufijo: '%', anterior: a.tasa_conversion, detalle: `${fmt(k.contratados)} de los presentados ya ingresaron`, tono: 'cian' },
      { clave: 'dias_a_ingreso', titulo: 'Días a ingreso', icono: 'timer', valor: k.dias_a_ingreso, anterior: a.dias_a_ingreso,
        inverso: true, detalle: 'Promedio desde que se presenta', tono: 'ambar' },
      { clave: 'personas_solicitadas', titulo: 'Personas solicitadas', icono: 'work', valor: k.personas_solicitadas,
        anterior: a.personas_solicitadas, detalle: `${fmt(k.vacantes)} vacantes · ${fmt(k.vacantes_activas)} activas`, tono: 'azul' },
      { clave: 'retiro_temprano', titulo: 'Retiro antes de 30 días', icono: 'logout', valor: k.retiro_temprano,
        anterior: a.retiro_temprano, inverso: true, detalle: 'De los ingresos del periodo', tono: 'rojo' },
    ];
  });

  variacion(c: Tarjeta): { texto: string; clase: string; icono: string } | null {
    if (c.valor == null || c.anterior == null) return null;
    const dif = c.valor - c.anterior;
    if (Math.abs(dif) < 0.05) return { texto: 'igual', clase: 'neutro', icono: 'trending_flat' };
    const sube = dif > 0;
    const bueno = c.inverso ? !sube : sube;
    const texto = c.sufijo === '%' || c.clave === 'dias_a_ingreso'
      ? `${sube ? '+' : ''}${dif.toFixed(1)}${c.sufijo === '%' ? ' pts' : ' d'}`
      : c.anterior === 0 ? `+${fmt(dif)}` : `${sube ? '+' : ''}${Math.round((dif / c.anterior) * 100)}%`;
    return { texto, clase: bueno ? 'bueno' : 'malo', icono: sube ? 'trending_up' : 'trending_down' };
  }

  /** Línea mínima en SVG (sin una instancia de ECharts por tarjeta). */
  sparkline(serie?: number[]): string {
    if (!serie || serie.length < 2) return '';
    const max = Math.max(...serie, 1);
    const paso = 100 / (serie.length - 1);
    return serie.map((v, i) => `${i ? 'L' : 'M'}${(i * paso).toFixed(1)},${(28 - (v / max) * 26).toFixed(1)}`).join(' ');
  }

  // ─── Embudo y resultados ─────────────────────────────────────────
  readonly embudo = computed(() => {
    const e = this.t()?.embudo ?? [];
    const max = Math.max(1, ...e.map((x) => x.valor));
    return e.map((x) => ({ ...x, ancho: Math.max(4, (x.valor / max) * 100) }));
  });

  readonly resultadosLista = computed(() => {
    const r = this.t()?.resultados ?? [];
    const total = r.reduce((s, x) => s + x.valor, 0) || 1;
    return r.map((x) => ({ ...x, ...(RESULTADOS[x.clave] ?? { texto: x.clave, color: PALETA.gris }), pct: (x.valor / total) * 100 }));
  });

  readonly chartResultados = computed(() => {
    const r = this.resultadosLista();
    if (!r.length) return null;
    return {
      tooltip: { trigger: 'item', formatter: '{b}<br><b>{c}</b> ({d}%)' },
      series: [{
        type: 'pie', radius: ['58%', '86%'], center: ['50%', '50%'], avoidLabelOverlap: true, padAngle: 1,
        itemStyle: { borderRadius: 6 }, label: { show: false },
        data: r.map((x) => ({ name: x.texto, value: x.valor, clave: x.clave, itemStyle: { color: x.color } })),
      }],
    };
  });

  verResultado(clave: string | null): void {
    this.filtroResultado.set(clave);
    this.vista.set('procesos');
    setTimeout(() => this.irA('sec-detalle'), 30);
  }

  // ─── Día a día ───────────────────────────────────────────────────
  readonly chartDiario = computed(() => {
    const s = this.t()?.serie_diaria;
    if (!s || !s.fechas.length) return null;
    const muchos = s.fechas.length > 45;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
      grid: { top: 36, left: 8, right: 12, bottom: muchos ? 56 : 8, containLabel: true },
      dataZoom: muchos ? [{ type: 'slider', height: 18, bottom: 8 }, { type: 'inside' }] : undefined,
      xAxis: { type: 'category', data: s.modo === 'hora' ? s.fechas : s.fechas.map(diaCorto), axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: [
        { name: 'Ingresos', type: 'bar', data: s.ingresos, itemStyle: { color: PALETA.verde, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 22 },
        { name: 'Se presentaron', type: 'line', data: s.presentados, smooth: true, symbol: 'none', lineStyle: { width: 2.5, color: PALETA.azul },
          itemStyle: { color: PALETA.azul }, areaStyle: { color: 'rgba(43,89,240,.08)' } },
        { name: 'Aplican', type: 'line', data: s.aplica, smooth: true, symbol: 'none', lineStyle: { width: 2, color: PALETA.violeta }, itemStyle: { color: PALETA.violeta } },
        { name: 'No aplican', type: 'line', data: s.no_aplica, smooth: true, symbol: 'none', lineStyle: { width: 1.5, type: 'dashed', color: PALETA.rojo }, itemStyle: { color: PALETA.rojo } },
      ],
    };
  });

  readonly chartHoras = computed(() => {
    const h = this.t()?.mapa_calor.por_hora;
    if (!h || !h.some((x) => x > 0)) return null;
    const desde = Math.max(0, h.findIndex((x) => x > 0) - 1);
    const hasta = Math.min(23, 23 - [...h].reverse().findIndex((x) => x > 0) + 1);
    const horas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
    return {
      tooltip: { trigger: 'axis', formatter: (p: any) => `${p[0].name}<br><b>${p[0].value}</b> presentaciones` },
      grid: { top: 10, left: 4, right: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: horas.map((x) => `${x}:00`), axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: [{ type: 'bar', data: horas.map((x) => h[x]), itemStyle: { color: PALETA.azulSuave, borderRadius: [4, 4, 0, 0] } }],
    };
  });

  // ─── Oficinas ────────────────────────────────────────────────────
  readonly oficinasTabla = computed(() => {
    const l = this.t()?.por_oficina ?? [];
    const maxP = Math.max(1, ...l.map((o) => o.presentados));
    const maxI = Math.max(1, ...l.map((o) => o.ingresos));
    return l.map((o) => ({ ...o, barP: (o.presentados / maxP) * 100, barI: (o.ingresos / maxI) * 100 }));
  });

  private colorOficina(o: string, todas: string[]): string {
    return CATEGORICA[todas.indexOf(o) % CATEGORICA.length];
  }

  readonly chartOficinasLineas = computed(() => {
    const s = this.t()?.serie_oficinas;
    if (!s || !s.oficinas.length) return null;
    // Un solo día: la línea va por hora y solo hay llegadas (el ingreso no tiene hora).
    const m = s.modo === 'hora' ? 'presentados' : this.metricaOficinas();
    const todas = s.oficinas.map((o) => o.oficina);
    const visibles = new Set(todas.slice(0, 6));
    const muchos = s.fechas.length > 45;
    return {
      tooltip: { trigger: 'axis', order: 'valueDesc' },
      legend: { type: 'scroll', top: 0, icon: 'circle', itemWidth: 8, selected: Object.fromEntries(todas.map((o) => [o, visibles.has(o)])) },
      grid: { top: 40, left: 8, right: 12, bottom: muchos ? 56 : 8, containLabel: true },
      dataZoom: muchos ? [{ type: 'slider', height: 18, bottom: 8 }, { type: 'inside' }] : undefined,
      xAxis: { type: 'category', data: s.modo === 'hora' ? s.fechas : s.fechas.map(diaCorto), boundaryGap: false, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: s.oficinas.map((o) => ({
        name: o.oficina, type: 'line', smooth: 0.3, symbol: 'circle', symbolSize: 5, showSymbol: s.fechas.length <= 31,
        data: o[m], lineStyle: { width: 2.2 }, itemStyle: { color: this.colorOficina(o.oficina, todas) },
        emphasis: { focus: 'series' },
      })),
    };
  });

  readonly chartOficinasComparativo = computed(() => {
    const l = (this.t()?.por_oficina ?? []).filter((o) => o.presentados + o.ingresos > 0).slice(0, 14);
    if (!l.length) return null;
    const nombres = l.map((o) => o.oficina).reverse();
    const serie = (k: keyof FilaOficina) => l.map((o) => o[k] as number).reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
      grid: { top: 30, left: 8, right: 24, bottom: 4, containLabel: true },
      xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      yAxis: { type: 'category', data: nombres, axisTick: { show: false }, axisLabel: { width: 130, overflow: 'truncate' } },
      series: [
        { name: 'Se presentaron', type: 'bar', data: serie('presentados'), itemStyle: { color: PALETA.azulSuave, borderRadius: [0, 4, 4, 0] }, barGap: '10%', barMaxWidth: 12 },
        { name: 'Aplican', type: 'bar', data: serie('aplica'), itemStyle: { color: PALETA.violeta, borderRadius: [0, 4, 4, 0] }, barMaxWidth: 12 },
        { name: 'Ingresos', type: 'bar', data: serie('ingresos'), itemStyle: { color: PALETA.verde, borderRadius: [0, 4, 4, 0] }, barMaxWidth: 12 },
      ],
    };
  });

  readonly chartCalor = computed(() => {
    const m = this.t()?.mapa_calor;
    if (!m || !m.oficinas.length) return null;
    const max = Math.max(1, ...m.valores.map((v) => v[2]));
    return {
      tooltip: { formatter: (p: any) => `${m.oficinas[p.value[1]]} · ${m.dias[p.value[0]]}<br><b>${p.value[2]}</b> presentaciones` },
      grid: { top: 8, left: 8, right: 8, bottom: 48, containLabel: true },
      xAxis: { type: 'category', data: m.dias, splitArea: { show: true }, axisTick: { show: false } },
      yAxis: { type: 'category', data: m.oficinas, splitArea: { show: true }, axisTick: { show: false } },
      visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120,
        inRange: { color: ['#EEF3FF', '#93B4FF', '#2B59F0', '#1E3A9E'] } },
      series: [{ type: 'heatmap', data: m.valores, label: { show: true, fontSize: 10, formatter: (p: any) => p.value[2] || '' },
        itemStyle: { borderRadius: 4, borderColor: 'rgba(255,255,255,.6)', borderWidth: 2 } }],
    };
  });

  filtrarOficina(o: string): void {
    if (!o) return;
    this.oficinas.set([o]);
    this.recargar();
  }

  // ─── Fincas, temporales y vacantes ───────────────────────────────
  readonly chartFincas = computed(() => {
    const l = (this.t()?.por_finca ?? []).filter((f) => f.ingresos > 0).slice(0, 15);
    if (!l.length) return null;
    const nombres = l.map((f) => f.finca).reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
      grid: { top: 30, left: 8, right: 36, bottom: 4, containLabel: true },
      xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      yAxis: { type: 'category', data: nombres, axisTick: { show: false }, axisLabel: { width: 170, overflow: 'truncate' } },
      series: [
        { name: 'Apoyo Laboral', type: 'bar', stack: 't', data: l.map((f) => f.al).reverse(), itemStyle: { color: PALETA.al }, barMaxWidth: 18 },
        { name: 'Tu Alianza', type: 'bar', stack: 't', data: l.map((f) => f.ta).reverse(), itemStyle: { color: PALETA.ta, borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 18, label: { show: true, position: 'right', fontWeight: 600, formatter: (p: any) => l[l.length - 1 - p.dataIndex].ingresos } },
      ],
    };
  });

  readonly chartTemporal = computed(() => {
    const l = this.t()?.por_temporal ?? [];
    if (!l.some((x) => x.ingresos > 0)) return null;
    const color: Record<string, string> = { AL: PALETA.al, TA: PALETA.ta, SIN: PALETA.gris };
    return {
      tooltip: { trigger: 'item', formatter: '{b}<br><b>{c}</b> ingresos ({d}%)' },
      legend: { bottom: 0, icon: 'circle', itemWidth: 8 },
      series: [{
        type: 'pie', radius: ['52%', '78%'], center: ['50%', '44%'], padAngle: 2, itemStyle: { borderRadius: 6 },
        label: { show: true, position: 'inside', formatter: '{d}%', color: '#fff', fontWeight: 700 },
        data: l.map((x) => ({ name: x.nombre, value: x.ingresos, temporal: x.temporal, itemStyle: { color: color[x.temporal] } })),
      }],
    };
  });

  readonly vacantes = computed(() => this.t()?.vacantes ?? []);

  readonly columnasVacantes: ColumnaTabla<VacanteMetrica>[] = [
    { id: 'fecha', header: 'Publicada', valor: (v) => v.fecha, formato: (v) => fechaCorta(v.fecha), tarjeta: 'meta' },
    { id: 'finca', header: 'Finca', valor: (v) => v.finca, tarjeta: 'titulo' },
    { id: 'cargo', header: 'Cargo', valor: (v) => v.cargo, tarjeta: 'subtitulo', prioridad: 2 },
    { id: 'temporal', header: 'Temporal', valor: (v) => TEMPORAL_TEXTO[v.temporal ?? 'SIN'] ?? v.temporal, prioridad: 2 },
    { id: 'oficinas', header: 'Oficinas', valor: (v) => v.oficinas || 'Todas', prioridad: 3 },
    { id: 'solicitadas', header: 'Solicitadas', align: 'right', valor: (v) => v.solicitadas },
    { id: 'remitidos', header: 'Remitidos', align: 'right', valor: (v) => v.remitidos },
    { id: 'contratados', header: 'Contratados', align: 'right', valor: (v) => v.contratados },
    { id: 'cobertura', header: 'Cobertura', align: 'right', valor: (v) => v.cobertura, formato: (v) => v.cobertura == null ? '—' : v.cobertura + '%' },
    { id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge', valor: (v) => v.activa ? 'Activa' : (v.estado || 'Cerrada'),
      badge: (v) => ({ texto: v.activa ? 'Activa' : (v.estado || 'Cerrada'), tono: v.activa ? 'ok' : 'neutro' }) },
    { id: 'publicada_por', header: 'Publicó', valor: (v) => v.publicada_por, prioridad: 3 },
  ];
  readonly idVacante = (v: VacanteMetrica) => v.id;

  // ─── Motivos y medios ────────────────────────────────────────────
  private barrasH(l: { nombre: string; valor: number }[], color: string, ancho = 190) {
    if (!l.length) return null;
    const d = [...l].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { top: 4, left: 8, right: 40, bottom: 4, containLabel: true },
      xAxis: { type: 'value', minInterval: 1, show: false },
      yAxis: { type: 'category', data: d.map((x) => x.nombre), axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { width: ancho, overflow: 'truncate' } },
      series: [{ type: 'bar', data: d.map((x) => x.valor), barMaxWidth: 16, itemStyle: { color, borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: 'right', fontWeight: 600 }, showBackground: true,
        backgroundStyle: { color: 'rgba(148,163,184,.12)', borderRadius: [0, 6, 6, 0] } }],
    };
  }

  readonly chartNoAplica = computed(() => this.barrasH(this.t()?.motivos.no_aplica ?? [], PALETA.rojo));
  readonly chartEspera = computed(() => this.barrasH(this.t()?.motivos.en_espera ?? [], PALETA.ambar));
  readonly motivosTexto = computed(() => {
    const m = this.t()?.motivos;
    return { noAplica: m?.no_aplica_texto ?? [], espera: m?.en_espera_texto ?? [] };
  });
  readonly etapasCaidas = computed(() => (this.t()?.motivos.etapas ?? []).map((e) => ({ ...e, texto: ETAPA_TEXTO[e.resultado] ?? e.resultado })));

  readonly chartMedios = computed(() => {
    const l = this.t()?.por_medio ?? [];
    if (!l.length) return null;
    const d = [...l].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any) => { const m = d[p[0].dataIndex];
          return `<b>${m.medio}</b><br>Se presentaron: ${m.presentados}<br>Aplican: ${m.aplica} (${pct(m.tasa_aplica)})<br>`
            + `Terminaron contratados: ${m.contratados} (${pct(m.tasa_conversion)})<br>Ingresos del periodo: ${m.ingresos}`; } },
      legend: { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
      grid: { top: 30, left: 8, right: 60, bottom: 4, containLabel: true },
      xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      yAxis: { type: 'category', data: d.map((x) => x.medio), axisTick: { show: false }, axisLabel: { width: 150, overflow: 'truncate' } },
      series: [
        { name: 'Se presentaron', type: 'bar', data: d.map((x) => x.presentados), itemStyle: { color: PALETA.azulSuave, borderRadius: [0, 4, 4, 0] }, barMaxWidth: 14, barGap: '15%' },
        { name: 'Aplican', type: 'bar', data: d.map((x) => x.aplica), itemStyle: { color: PALETA.violeta, borderRadius: [0, 4, 4, 0] }, barMaxWidth: 14 },
        { name: 'Contratados', type: 'bar', data: d.map((x) => x.contratados), itemStyle: { color: PALETA.verde, borderRadius: [0, 4, 4, 0] }, barMaxWidth: 14,
          label: { show: true, position: 'right', formatter: (p: any) => pct(d[p.dataIndex].tasa_conversion), color: PALETA.verde, fontWeight: 700 } },
      ],
    };
  });

  readonly chartCargos = computed(() => this.barrasH(this.t()?.por_cargo ?? [], PALETA.cian, 220));

  // ─── Equipo y perfil ─────────────────────────────────────────────
  readonly contratadores = computed(() => {
    const l = this.t()?.equipo.contratadores ?? [];
    const max = Math.max(1, ...l.map((x) => x.ingresos));
    return l.map((x) => ({ ...x, ancho: (x.ingresos / max) * 100, iniciales: iniciales(x.nombre) }));
  });
  readonly evaluadores = computed(() => this.t()?.equipo.evaluadores ?? []);
  readonly publicadores = computed(() => this.t()?.equipo.publicadores ?? []);

  readonly chartSexo = computed(() => {
    const p = this.t()?.perfil;
    if (!p) return null;
    const nombre: Record<string, string> = { F: 'Mujeres', M: 'Hombres', 'Sin dato': 'Sin dato' };
    const color: Record<string, string> = { F: '#DB2777', M: PALETA.azul, 'Sin dato': PALETA.gris };
    const datos = (l: { clave: string; valor: number }[]) => l.map((x) => ({ name: nombre[x.clave] ?? x.clave, value: x.valor, itemStyle: { color: color[x.clave] } }));
    return {
      tooltip: { trigger: 'item', formatter: '{a}<br>{b}: <b>{c}</b> ({d}%)' },
      legend: { bottom: 0, icon: 'circle', itemWidth: 8, data: ['Mujeres', 'Hombres', 'Sin dato'] },
      series: [
        { name: 'Se presentaron', type: 'pie', radius: ['22%', '42%'], center: ['50%', '45%'], label: { show: false }, data: datos(p.sexo_presentados) },
        { name: 'Ingresaron', type: 'pie', radius: ['50%', '70%'], center: ['50%', '45%'], label: { show: true, formatter: '{d}%', fontSize: 11 },
          itemStyle: { borderRadius: 4, borderColor: 'rgba(255,255,255,.7)', borderWidth: 2 }, data: datos(p.sexo_ingresos) },
      ],
    };
  });

  readonly chartEdad = computed(() => {
    const p = this.t()?.perfil;
    if (!p) return null;
    const tramos = ['18-24', '25-34', '35-44', '45-54', '55+'];
    const v = (l: { clave: string; valor: number }[]) => tramos.map((t) => l.find((x) => x.clave === t)?.valor ?? 0);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
      grid: { top: 30, left: 4, right: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: tramos, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: [
        { name: 'Se presentaron', type: 'bar', data: v(p.edad_presentados), itemStyle: { color: PALETA.azulSuave, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 26 },
        { name: 'Ingresaron', type: 'bar', data: v(p.edad_ingresos), itemStyle: { color: PALETA.verde, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 26 },
      ],
    };
  });

  readonly chartTiempos = computed(() => {
    const l = this.t()?.tiempos.presentacion_a_ingreso ?? [];
    if (!l.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { top: 16, left: 4, right: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: l.map((x) => x.clave), axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: [{ type: 'bar', data: l.map((x) => x.valor), barMaxWidth: 42, label: { show: true, position: 'top', fontWeight: 600 },
        itemStyle: { color: PALETA.ambar, borderRadius: [6, 6, 0, 0] } }],
    };
  });

  readonly experiencia = computed(() => {
    const l = this.t()?.perfil.experiencia ?? [];
    const total = l.reduce((s, x) => s + x.valor, 0) || 1;
    return l.map((x) => ({ ...x, pct: (x.valor / total) * 100 }));
  });

  // ─── Clic en gráficas → filtro ───────────────────────────────────
  clicFinca(e: any): void {
    if (e?.name) this.solo('fincas', e.name);
  }

  clicMedio(e: any): void {
    if (e?.name) { this.medio.set(e.name); this.recargar(); }
  }

  clicTemporal(e: any): void {
    const t = e?.data?.temporal;
    if (t && t !== 'SIN') { this.temporal.set(t); this.recargar(); }
  }

  clicResultado(e: any): void {
    if (e?.data?.clave) this.verResultado(e.data.clave);
  }

  clicOficina(e: any): void {
    if (e?.name) this.filtrarOficina(e.name);
  }

  // ─── Detalle ─────────────────────────────────────────────────────
  readonly procesosFiltrados = computed(() => {
    const r = this.filtroResultado();
    return r ? this.procesos().filter((p) => p.resultado === r) : this.procesos();
  });

  readonly conteoResultados = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.procesos()) m.set(p.resultado, (m.get(p.resultado) ?? 0) + 1);
    return Object.keys(RESULTADOS).filter((k) => m.has(k)).map((k) => ({ clave: k, n: m.get(k)!, ...RESULTADOS[k] }));
  });

  readonly columnasProcesos: ColumnaTabla<FilaProceso>[] = [
    { id: 'fecha', header: 'Se presentó', valor: (p) => p.fecha, formato: (p) => fechaHora(p.fecha), tarjeta: 'meta', minAncho: '120px' },
    { id: 'nombre', header: 'Nombre', valor: (p) => p.nombre, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Cédula', valor: (p) => p.cedula, tarjeta: 'subtitulo' },
    { id: 'oficina', header: 'Oficina', valor: (p) => p.oficina },
    { id: 'resultado', header: 'Dónde se quedó', align: 'center', tarjeta: 'badge', valor: (p) => RESULTADOS[p.resultado]?.texto ?? p.resultado,
      badge: (p) => ({ texto: RESULTADOS[p.resultado]?.texto ?? p.resultado, tono: RESULTADOS[p.resultado]?.tono ?? 'neutro' }) },
    { id: 'estado', header: 'Evaluación', valor: (p) => p.estado ? ESTADOS_EVALUACION[p.estado] ?? p.estado : 'Sin evaluar', prioridad: 2 },
    { id: 'motivo', header: 'Motivo', valor: (p) => p.motivo, formato: (p) => p.motivo ? `${CATEGORIA_TEXTO[p.categoria_motivo ?? ''] ?? ''}${p.categoria_motivo ? ' · ' : ''}${p.motivo}` : '—', prioridad: 3, minAncho: '220px' },
    { id: 'medio', header: 'Medio', valor: (p) => p.medio, prioridad: 2 },
    { id: 'cargo', header: 'Cargo', valor: (p) => p.cargo, prioridad: 3 },
    { id: 'finca', header: 'Finca', valor: (p) => p.finca, prioridad: 3 },
    { id: 'temporal', header: 'Temporal', valor: (p) => p.temporal ? TEMPORAL_TEXTO[p.temporal] : null, prioridad: 3 },
    { id: 'prueba', header: 'Prueba técnica', valor: (p) => p.prueba ? ETAPA_TEXTO[p.prueba] : null, prioridad: 3 },
    { id: 'examen', header: 'Exámenes', valor: (p) => p.examen ? ETAPA_TEXTO[p.examen] : null, prioridad: 3 },
    { id: 'fecha_ingreso', header: 'Ingresó', valor: (p) => p.fecha_ingreso, formato: (p) => fechaCorta(p.fecha_ingreso), prioridad: 2 },
    { id: 'dias_a_ingreso', header: 'Días', align: 'right', valor: (p) => p.dias_a_ingreso, prioridad: 3 },
    { id: 'evaluador', header: 'Evaluador', valor: (p) => p.evaluador, prioridad: 3 },
    { id: 'sexo', header: 'Sexo', valor: (p) => p.sexo, prioridad: 3 },
    { id: 'edad', header: 'Edad', align: 'right', valor: (p) => p.edad, prioridad: 3 },
    { id: 'celular', header: 'Celular', valor: (p) => p.celular, prioridad: 3 },
  ];
  readonly idProceso = (p: FilaProceso) => `${p.proceso_id ?? ''}-${p.cedula}-${p.fecha}`;

  readonly columnasIngresos: ColumnaTabla<FilaIngreso>[] = [
    { id: 'fecha_ingreso', header: 'Ingreso', valor: (i) => i.fecha_ingreso, formato: (i) => fechaCorta(i.fecha_ingreso), tarjeta: 'meta' },
    { id: 'nombre', header: 'Nombre', valor: (i) => i.nombre, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Cédula', valor: (i) => i.cedula, tarjeta: 'subtitulo' },
    { id: 'temporal', header: 'Temporal', align: 'center', tarjeta: 'badge', valor: (i) => TEMPORAL_TEXTO[i.temporal ?? 'SIN'],
      badge: (i) => ({ texto: i.temporal ?? '—', tono: i.temporal === 'AL' ? 'info' : i.temporal === 'TA' ? 'warn' : 'neutro' }) },
    { id: 'codigo', header: 'Código', valor: (i) => i.codigo },
    { id: 'oficina', header: 'Oficina', valor: (i) => i.oficina },
    { id: 'finca', header: 'Finca', valor: (i) => i.finca, prioridad: 2 },
    { id: 'empresa', header: 'Empresa', valor: (i) => i.empresa, prioridad: 3 },
    { id: 'cargo', header: 'Cargo', valor: (i) => i.cargo, prioridad: 3 },
    { id: 'usuario', header: 'Contrató', valor: (i) => i.usuario, prioridad: 2 },
    { id: 'medio', header: 'Medio', valor: (i) => i.medio, prioridad: 3 },
    { id: 'activo', header: 'Estado', align: 'center', valor: (i) => i.fecha_retiro ? 'Retirado' : 'Activo',
      badge: (i) => i.fecha_retiro ? { texto: 'Retiro ' + fechaCorta(i.fecha_retiro), tono: 'danger' } : { texto: 'Activo', tono: 'ok' }, prioridad: 2 },
    { id: 'motivo_retiro', header: 'Motivo retiro', valor: (i) => i.motivo_retiro, prioridad: 3 },
    { id: 'dias_desde_presentacion', header: 'Días desde presentación', align: 'right', valor: (i) => i.dias_desde_presentacion, prioridad: 3 },
    { id: 'sexo', header: 'Sexo', valor: (i) => i.sexo, prioridad: 3 },
    { id: 'edad', header: 'Edad', align: 'right', valor: (i) => i.edad, prioridad: 3 },
  ];
  readonly idIngreso = (i: FilaIngreso) => i.proceso_id;

  abrirFicha(fila: { cedula: string; nombre: string; proceso_id?: number | null; proceso_contrato?: number | null }): void {
    if (!fila?.cedula) return;
    this.dialog.open(FichaPersonaContratacionComponent, {
      data: { cedula: fila.cedula, nombre: fila.nombre, proceso_id: fila.proceso_contrato ?? fila.proceso_id ?? null },
      position: { right: '0' }, height: '100vh', width: '760px', maxWidth: '100vw', panelClass: 'ficha-contratacion-panel',
      autoFocus: false,
    });
  }

  // ─── Exportar ────────────────────────────────────────────────────
  exportar(vista: 'presentaciones' | 'ingresos'): void {
    if (this.descargando()) return;
    this.descargando.set(true);
    this.api.excel(vista, this.filtros(), vista === 'presentaciones' ? this.filtroResultado() : null).subscribe({
      next: (r: HttpResponse<Blob>) => {
        this.descargando.set(false);
        const cd = r.headers.get('Content-Disposition') ?? '';
        const nombre = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? `metricas_contratacion_${vista}.xlsx`;
        const url = URL.createObjectURL(r.body!);
        const a = document.createElement('a');
        a.href = url; a.download = nombre; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
      error: () => {
        this.descargando.set(false);
        this.snack.open('No se pudo generar el Excel.', 'Cerrar', { duration: 4000 });
      },
    });
  }

  imprimir(): void {
    window.print();
  }

  // ─── Utilidades ──────────────────────────────────────────────────
  private leerPreset(): Preset {
    try {
      const p = localStorage.getItem('metricas-contratacion:preset') as Preset | null;
      if (p && p !== 'custom') return p;
    } catch { /* opcional */ }
    return '30d';
  }

  private rangoDe(p: Preset): [Date, Date] {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const menos = (n: number) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return d; };
    switch (p) {
      case 'hoy': return [hoy, hoy];
      case 'ayer': return [menos(1), menos(1)];
      case '7d': return [menos(6), hoy];
      case 'mes': return [new Date(hoy.getFullYear(), hoy.getMonth(), 1), hoy];
      case 'mes_ant': return [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0)];
      case '90d': return [menos(89), hoy];
      default: return [menos(29), hoy];
    }
  }

  readonly fmt = fmt;
  readonly pct = pct;
  readonly fechaCorta = fechaCorta;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('es-CO');
}

function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function diaCorto(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1]}`;
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}

function fechaHora(iso: string): string {
  return `${fechaCorta(iso)} ${iso.slice(11, 16)}`;
}

function iniciales(n: string): string {
  return n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

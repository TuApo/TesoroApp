import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import Swal from 'sweetalert2';

import { provideEchartsTema } from '@/app/shared/utils/echarts-tema';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { MetricasContratacionService } from '../../services/metricas-contratacion.service';
import {
  ConfigInforme, ContratoDia, Contratador, Destinatario, EnvioInforme, FiltrosInforme, InformeDiario, OficinaDia,
  ResultadoEnvio, TEMPORAL_TEXTO, UsuarioPlataforma, VacanteCumplimiento,
} from '../../models/metricas-contratacion.models';
import { FichaPersonaContratacionComponent } from '../ficha-persona-contratacion/ficha-persona-contratacion.component';
import { ResumenIaComponent } from '../resumen-ia/resumen-ia.component';

const DIAS = [
  { id: 'LUN', t: 'L' }, { id: 'MAR', t: 'M' }, { id: 'MIE', t: 'X' }, { id: 'JUE', t: 'J' },
  { id: 'VIE', t: 'V' }, { id: 'SAB', t: 'S' }, { id: 'DOM', t: 'D' },
];

/** Paleta categórica fija por posición: la misma oficina conserva su color en la línea y en la leyenda. */
const CATEGORICA = ['#2B59F0', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D',
  '#EA580C', '#0F766E', '#9333EA', '#CA8A04', '#4F46E5', '#BE123C', '#0284C7', '#15803D'];

type Pestana = 'informe' | 'bases' | 'auto';
type Base = 'oficinas' | 'oficinas_dia' | 'fincas' | 'contrataron' | 'vacantes' | 'detalle' | 'historico';

interface FilaFinca { temporal: string; finca: string; total: number; }
interface FilaHistorico { fecha: string; al: number; ta: number; total: number; }
interface FilaContrataron extends Contratador { periodo: string; }

/**
 * Informe diario de contratación: el cuadro que la operación arma cada noche, con filtros arriba
 * para todo (fecha, histórico, temporal, oficinas, finca, quién contrató) y tres pestañas:
 *  - Informe: indicadores, cuadro por oficina, fincas, histórico, comparación de oficinas en el
 *    tiempo, quién contrató más y cumplimiento de vacantes.
 *  - Bases y tablas: cada hoja del Excel como tabla estándar (filtros por columna, copiar, Excel).
 *  - Automatización: programación, oficinas del cuadro, destinatarios, plantilla y lo ya enviado.
 */
@Component({
  selector: 'app-informe-diario',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressBarModule, MatSlideToggleModule,
    MatSelectModule, MatFormFieldModule, NgxEchartsDirective, ResumenIaComponent, ...TABLA_ESTANDAR],
  providers: [provideEchartsTema()],
  templateUrl: './informe-diario.component.html',
  styleUrl: './informe-diario.component.css',
})
export class InformeDiarioComponent {
  private readonly api = inject(MetricasContratacionService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly sanitizer = inject(DomSanitizer);

  readonly DIAS = DIAS;
  readonly TEMPORAL_TEXTO = TEMPORAL_TEXTO;

  readonly pestana = signal<Pestana>(leer('informe-diario:pestana', 'informe') as Pestana);
  readonly base = signal<Base>('oficinas');

  // ─── Filtros ─────────────────────────────────────────────────────
  /** Fin del periodo (el día del informe). */
  readonly fecha = signal(ymd(new Date()));
  /** Inicio del periodo; igual a `fecha` = solo el día. */
  readonly desde = signal(ymd(new Date()));
  readonly periodo = signal<'dia' | '7d' | 'mes' | 'mes_ant' | 'rango'>('dia');
  readonly periodos = [
    { id: 'dia' as const, t: 'Día' }, { id: '7d' as const, t: '7 días' }, { id: 'mes' as const, t: 'Este mes' },
    { id: 'mes_ant' as const, t: 'Mes anterior' }, { id: 'rango' as const, t: 'Rango' },
  ];
  readonly esDia = computed(() => this.desde() === this.fecha());
  readonly dias = signal(Number(leer('informe-diario:dias', '30')) || 30);
  readonly temporal = signal<string | null>(null);
  readonly oficinas = signal<string[]>([]);
  readonly fincas = signal<string[]>([]);
  readonly usuariosFiltro = signal<string[]>([]);
  readonly opcionesDias = [7, 14, 30, 60, 90];

  readonly filtros = computed<FiltrosInforme>(() => ({
    dias: this.dias(), desde: this.desde(), temporal: this.temporal(), oficinas: this.oficinas(), fincas: this.fincas(), usuarios: this.usuariosFiltro(),
  }));
  readonly hayFiltros = computed(() => !!(this.temporal() || this.oficinas().length || this.fincas().length || this.usuariosFiltro().length));

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly inf = signal<InformeDiario | null>(null);
  readonly ocupado = signal(false);
  private readonly recarga$ = new Subject<void>();

  // ─── Automatización ──────────────────────────────────────────────
  readonly vista = signal<{ asunto: string; html: SafeHtml; whatsapp: string } | null>(null);
  readonly config = signal<ConfigInforme | null>(null);
  readonly puedeGestionar = signal(false);
  readonly destinatarios = signal<Destinatario[]>([]);
  readonly bitacora = signal<EnvioInforme[]>([]);
  readonly resultado = signal<ResultadoEnvio | null>(null);
  readonly busqueda = signal('');
  readonly usuarios = signal<UsuarioPlataforma[]>([]);
  nuevoCanal: 'CORREO' | 'WHATSAPP' = 'CORREO';
  nuevoValor = '';
  nuevoNombre = '';
  nuevaOficina = '';
  private readonly busqueda$ = new Subject<string>();

  readonly modoOficinas = signal<'diario' | 'acumulado'>('diario');

  // ─── Resumen con IA ──────────────────────────────────────────────
  readonly claveResumen = computed(() => this.fecha() + JSON.stringify(this.filtros()));
  readonly fuenteResumen = () => this.api.resumenDiario(this.fecha(), this.filtros());

  // ─── Proceso de selección ────────────────────────────────────────
  readonly metricaLinea = signal<'llegadas' | 'contratos'>('llegadas');
  readonly etapas = [
    { k: 'llegaron', t: 'Llegaron', c: '#2B59F0' }, { k: 'evaluados', t: 'Evaluados', c: '#6366F1' },
    { k: 'aplica', t: 'Aplican', c: '#7C3AED' }, { k: 'remitidos', t: 'Remitidos', c: '#0891B2' },
    { k: 'examenes', t: 'Exámenes', c: '#0D9488' }, { k: 'contratados', t: 'Contratados', c: '#16A34A' },
  ] as const;

  readonly embudoGeneral = computed(() => {
    const g = this.inf()?.proceso?.general;
    if (!g) return [];
    const max = Math.max(1, g.llegaron);
    return this.etapas.map((e, i) => {
      const v = (g as any)[e.k] as number;
      const prev = i === 0 ? null : (g as any)[this.etapas[i - 1].k] as number;
      return { ...e, v, ancho: Math.max(3, (v / max) * 100), pct: prev ? Math.round((v / prev) * 100) : null };
    });
  });

  readonly tarjetasOficina = computed(() => {
    const l = this.inf()?.proceso?.por_oficina ?? [];
    const max = Math.max(1, ...l.map((o) => o.llegaron));
    return l.map((o) => ({
      ...o,
      sin: o.llegaron === 0 && o.ingresos === 0,
      barras: this.etapas.slice(1).map((e) => ({ ...e, v: (o as any)[e.k] as number, ancho: o.llegaron ? ((o as any)[e.k] / o.llegaron) * 100 : 0 })),
      escala: (o.llegaron / max) * 100,
    }));
  });

  /** Línea de tiempo del proceso: una línea por oficina (hora si es un día, día si es un rango). */
  readonly chartLinea = computed(() => {
    const p = this.inf()?.proceso;
    if (!p || !p.cubetas.length) return null;
    const m = this.metricaLinea();
    const ofs = p.por_oficina.filter((o) => (o[m] as number[]).some((x) => x > 0));
    if (!ofs.length) return null;
    const etiquetas = p.modo === 'hora' ? p.cubetas : p.cubetas.map(diaCorto);
    return {
      tooltip: { trigger: 'axis', order: 'valueDesc', confine: true },
      legend: { type: 'scroll', top: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, itemGap: 14 },
      grid: { top: 40, left: 6, right: 16, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: etiquetas, boundaryGap: false, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: [
        { name: 'Total', type: 'bar', data: p[m], barMaxWidth: 26, itemStyle: { color: 'rgba(43,89,240,.12)', borderRadius: [4, 4, 0, 0] },
          z: 1, tooltip: { show: true } },
        ...ofs.map((o, i) => ({
          name: o.oficina, type: 'line', smooth: 0.25, data: o[m], symbol: 'circle', symbolSize: 6, z: 2,
          lineStyle: { width: 2.4 }, emphasis: { focus: 'series' }, itemStyle: { color: CATEGORICA[i % CATEGORICA.length] },
        })),
      ],
    };
  });

  constructor() {
    this.recarga$.pipe(
      debounceTime(150),
      switchMap(() => {
        this.cargando.set(true);
        this.error.set(null);
        return this.api.informeDiario(this.fecha(), this.filtros()).pipe(catchError((e) => {
          this.error.set(e?.error?.message || 'No se pudo cargar el informe.');
          return of(null);
        }));
      }),
    ).subscribe((i) => {
      this.cargando.set(false);
      if (i) this.inf.set(i);
    });
    this.cargar();
    this.api.configInforme().subscribe({
      next: (r) => {
        this.config.set(r.config);
        this.puedeGestionar.set(r.puede_gestionar);
        this.cargarDestinatarios();
      },
      error: () => this.config.set(null),
    });
    this.busqueda$.pipe(debounceTime(300), distinctUntilChanged(),
      switchMap((q) => q.trim().length < 2 ? of([]) : this.api.buscarUsuarios(q).pipe(catchError(() => of([])))))
      .subscribe((u) => this.usuarios.set(u));
  }

  cargar(): void {
    this.recarga$.next();
  }

  irPestana(p: Pestana): void {
    this.pestana.set(p);
    guardar('informe-diario:pestana', p);
    if (p === 'auto' && !this.vista()) this.verCorreo();
  }

  /** Mueve el periodo completo (un día, o tantos días como dure el rango). */
  irDia(delta: number): void {
    const largo = Math.round((Date.parse(this.fecha()) - Date.parse(this.desde())) / 86_400_000) + 1;
    const paso = delta * largo;
    const fin = sumar(this.fecha(), paso);
    if (fin > ymd(new Date())) return;
    this.fecha.set(fin);
    this.desde.set(sumar(this.desde(), paso));
    if (this.periodo() !== 'dia') this.periodo.set('rango');
    this.cargar();
  }

  elegirFecha(v: string): void {
    if (!v) return;
    this.fecha.set(v);
    if (this.esDia() || this.periodo() === 'dia' || this.desde() > v) this.desde.set(v);
    this.cargar();
  }

  elegirDesde(v: string): void {
    if (!v || v > this.fecha()) return;
    this.desde.set(v);
    this.periodo.set(v === this.fecha() ? 'dia' : 'rango');
    this.cargar();
  }

  elegirPeriodo(p: 'dia' | '7d' | 'mes' | 'mes_ant' | 'rango'): void {
    this.periodo.set(p);
    const hoy = ymd(new Date());
    if (p === 'dia') this.desde.set(this.fecha());
    else if (p === '7d') { this.fecha.set(hoy); this.desde.set(sumar(hoy, -6)); }
    else if (p === 'mes') { this.fecha.set(hoy); this.desde.set(hoy.slice(0, 8) + '01'); }
    else if (p === 'mes_ant') {
      const d = new Date(); const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1); const fin = new Date(d.getFullYear(), d.getMonth(), 0);
      this.desde.set(ymd(ini)); this.fecha.set(ymd(fin));
    } else if (this.esDia()) this.desde.set(sumar(this.fecha(), -6));
    this.cargar();
  }

  elegirDias(n: number): void {
    this.dias.set(n);
    guardar('informe-diario:dias', String(n));
    this.cargar();
  }

  set(k: 'temporal', v: string | null): void {
    this[k].set(v || null);
    this.cargar();
  }

  /** Finca / quién contrató: selección múltiple; las opciones se recalculan con los demás filtros. */
  setLista(k: 'fincas' | 'usuariosFiltro', v: string[]): void {
    this[k].set(v ?? []);
    this.cargar();
  }

  /** Lo elegido primero (aunque con los demás filtros ya no tenga datos) y luego las opciones con datos. */
  opcionesCon(lista: string[] | undefined, elegidos: string[]): string[] {
    const s = new Set(lista ?? []);
    return [...elegidos.filter((e) => !s.has(e)), ...(lista ?? [])];
  }

  setOficinas(v: string[]): void {
    this.oficinas.set(v ?? []);
    this.cargar();
  }

  limpiarFiltros(): void {
    this.temporal.set(null); this.oficinas.set([]); this.fincas.set([]); this.usuariosFiltro.set([]);
    this.cargar();
  }

  readonly esHoy = computed(() => this.fecha() === ymd(new Date()));

  // ─── Informe ─────────────────────────────────────────────────────
  readonly tarjetas = computed(() => {
    const i = this.inf();
    if (!i) return [];
    const c = i.comparativo, t = i.totales;
    const dia = i.es_dia !== false;
    const et = i.etiquetas ?? { periodo: 'del día', anterior: 'Día anterior', semana: 'Mismo día semana pasada', hoy: 'Hoy' };
    const vs = (a: number, b: number) => ({ ...varr(a, b), pre: et.hoy });
    const l: { t: string; v: number; d: string; var: string | null; cls: string; i: string; pre?: string }[] = [
      { t: dia ? 'Ingresos del día' : 'Ingresos del periodo', v: t.total, d: `Apoyo ${t.al} · Alianza ${t.ta}`, var: null, cls: 'principal', i: 'badge' },
      { t: et.anterior, v: c.ayer.total, d: c.ayer.desde === c.ayer.hasta ? fechaCorta(c.ayer.desde) : `${fechaCorta(c.ayer.desde)} – ${fechaCorta(c.ayer.hasta)}`, ...vs(t.total, c.ayer.total), i: 'history' },
    ];
    if (c.semana_pasada) {
      l.push({ t: et.semana, v: c.semana_pasada.total, d: fechaCorta(c.semana_pasada.desde), ...vs(t.total, c.semana_pasada.total), i: 'date_range' });
    }
    if (!dia) {
      l.push({ t: 'Promedio diario del periodo', v: t.promedio_dia ?? 0, d: `${t.dias_con_carga ?? 0} días con cargue`, ...vs(t.promedio_dia ?? 0, c.promedio_30.total), i: 'equalizer' });
    } else {
      l.push({ t: 'Promedio diario 30 días', v: c.promedio_30.total, d: `${c.promedio_30.dias} días con cargue`, ...vs(t.total, c.promedio_30.total), i: 'equalizer' });
    }
    l.push({ t: 'Acumulado del mes', v: c.mes.total, d: `Mes anterior al corte: ${c.mes_anterior.total}`, ...varr(c.mes.total, c.mes_anterior.total), pre: '', i: 'calendar_month' });
    l.push({ t: 'Oficinas que cargaron', v: t.oficinas_reportaron, d: t.oficinas_sin_reporte.length ? 'Sin cargue: ' + t.oficinas_sin_reporte.join(', ') : 'Todas cargaron',
      var: null, cls: t.oficinas_sin_reporte.length ? 'malo' : 'bueno', i: 'apartment' });
    return l;
  });

  readonly maxFinca = computed(() => {
    const f = this.inf()?.fincas;
    return Math.max(1, ...(f?.AL ?? []).map((x) => x.total), ...(f?.TA ?? []).map((x) => x.total));
  });

  readonly chartSerie = computed(() => {
    const s = this.inf()?.serie;
    if (!s?.length) return null;
    const ini = this.desde(), fin = this.fecha();
    const dentro = (f: string) => f >= ini && f <= fin;
    const muchos = s.length > 45;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
      grid: { top: 32, left: 6, right: 6, bottom: muchos ? 40 : 4, containLabel: true },
      dataZoom: muchos ? [{ type: 'slider', height: 16, bottom: 6 }, { type: 'inside' }] : undefined,
      xAxis: { type: 'category', data: s.map((x) => diaCorto(x.fecha)), axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: [
        { name: 'Apoyo Laboral', type: 'bar', stack: 't', data: s.map((x) => ({ value: x.al, itemStyle: { opacity: dentro(x.fecha) ? 1 : 0.55 } })),
          itemStyle: { color: '#2563EB' }, barMaxWidth: 22 },
        { name: 'Tu Alianza', type: 'bar', stack: 't', data: s.map((x) => ({ value: x.ta, itemStyle: { opacity: dentro(x.fecha) ? 1 : 0.55 } })),
          itemStyle: { color: '#F59E0B', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 22,
          label: { show: s.length <= 45, position: 'top', fontSize: 10, formatter: (p: any) => s[p.dataIndex].total || '' } },
      ],
    };
  });

  /** Comparación de oficinas en el tiempo: una línea por oficina (diario o acumulado). */
  readonly chartOficinas = computed(() => {
    const so = this.inf()?.serie_oficinas;
    if (!so || !so.oficinas.length) return null;
    const acumulado = this.modoOficinas() === 'acumulado';
    const ofs = so.oficinas.filter((o) => o.total > 0);
    const muchos = so.fechas.length > 45;
    return {
      tooltip: { trigger: 'axis', order: 'valueDesc', confine: true },
      legend: { type: 'scroll', top: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, itemGap: 14 },
      grid: { top: 40, left: 6, right: 16, bottom: muchos ? 40 : 4, containLabel: true },
      dataZoom: muchos ? [{ type: 'slider', height: 16, bottom: 6 }, { type: 'inside' }] : undefined,
      xAxis: { type: 'category', data: so.fechas.map(diaCorto), boundaryGap: false, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: ofs.map((o, i) => {
        let suma = 0;
        const data = acumulado ? o.valores.map((v) => (suma += v)) : o.valores;
        return {
          name: o.oficina, type: 'line', smooth: 0.25, data, symbol: 'circle', symbolSize: 5,
          showSymbol: so.fechas.length <= 31, lineStyle: { width: 2.2 }, emphasis: { focus: 'series' },
          itemStyle: { color: CATEGORICA[i % CATEGORICA.length] },
          endLabel: acumulado ? { show: true, formatter: '{a}', fontSize: 10 } : undefined,
        };
      }),
    };
  });

  /** Resumen de la comparación: total, promedio y mejor día por oficina en la ventana. */
  readonly rankingOficinas = computed(() => {
    const so = this.inf()?.serie_oficinas;
    if (!so) return [];
    const l = [...so.oficinas].filter((o) => o.total > 0).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...l.map((o) => o.total));
    return l.map((o) => ({ ...o, ancho: (o.total / max) * 100, color: CATEGORICA[so.oficinas.filter((x) => x.total > 0).indexOf(o) % CATEGORICA.length] }));
  });

  readonly topDia = computed(() => this.lider(this.inf()?.contratadores?.dia ?? []));
  readonly topPeriodo = computed(() => this.lider(this.inf()?.contratadores?.periodo ?? []));

  private lider(l: Contratador[]) {
    const max = Math.max(1, ...l.map((x) => x.total));
    return l.slice(0, 10).map((x, i) => ({ ...x, pos: i + 1, ancho: (x.total / max) * 100,
      pAl: x.total ? (x.al / x.total) * 100 : 0, iniciales: iniciales(x.nombre) }));
  }

  readonly vacantesPendientes = computed(() =>
    (this.inf()?.vacantes.filas ?? []).filter((v) => v.pendientes > 0 || v.contratados_hoy > 0).slice(0, 8));

  // ─── Bases y tablas (las hojas del Excel) ────────────────────────
  readonly bases: { id: Base; texto: string; icono: string }[] = [
    { id: 'oficinas', texto: 'Por oficina', icono: 'apartment' },
    { id: 'oficinas_dia', texto: 'Oficinas por día', icono: 'stacked_line_chart' },
    { id: 'fincas', texto: 'Por finca', icono: 'agriculture' },
    { id: 'contrataron', texto: 'Quién contrató', icono: 'groups' },
    { id: 'vacantes', texto: 'Vacantes', icono: 'work' },
    { id: 'detalle', texto: 'Contratados', icono: 'badge' },
    { id: 'historico', texto: 'Histórico diario', icono: 'calendar_month' },
  ];

  readonly columnasOficinas: ColumnaTabla<OficinaDia>[] = [
    { id: 'oficina', header: 'Oficina', valor: (o) => o.oficina, tarjeta: 'titulo' },
    { id: 'hora_cargue', header: 'Hora de cargue', valor: (o) => o.hora_cargue },
    { id: 'dias_cargue', header: 'Días con cargue', align: 'right', valor: (o) => o.dias_cargue ?? null, prioridad: 2 },
    { id: 'promedio_dia', header: 'Promedio por día', align: 'right', valor: (o) => o.promedio_dia ?? null, prioridad: 2 },
    { id: 'ta', header: 'Tu Alianza', align: 'right', valor: (o) => o.ta },
    { id: 'al', header: 'Apoyo', align: 'right', valor: (o) => o.al },
    { id: 'total', header: 'Total ingresos', align: 'right', valor: (o) => o.total },
    { id: 'cedulas', header: 'Cédulas', align: 'right', valor: (o) => o.cedulas },
    { id: 'traslados', header: 'Traslados', align: 'right', valor: (o) => o.traslados },
    { id: 'ayer', header: 'Día anterior', align: 'right', valor: (o) => o.ayer },
    { id: 'semana_pasada', header: 'Semana pasada', align: 'right', valor: (o) => o.semana_pasada },
    { id: 'promedio_30', header: 'Promedio 30 d', align: 'right', valor: (o) => o.promedio_30 },
    { id: 'reporto', header: 'Cargó', align: 'center', tarjeta: 'badge', valor: (o) => o.reporto ? 'Sí' : 'No',
      badge: (o) => ({ texto: o.reporto ? 'Cargó' : 'Sin cargue', tono: o.reporto ? 'ok' : 'warn' }) },
  ];
  readonly idOficina = (o: OficinaDia) => o.oficina;

  /** Oficinas × días como tabla: columnas que salen de las fechas de la ventana. */
  readonly tablaOficinasDia = computed(() => {
    const so = this.inf()?.serie_oficinas;
    if (!so) return { filas: [] as any[], columnas: [] as ColumnaTabla<any>[] };
    const columnas: ColumnaTabla<any>[] = [
      { id: 'oficina', header: 'Oficina', valor: (o) => o.oficina, tarjeta: 'titulo', minAncho: '150px' },
      { id: 'total', header: 'Total', align: 'right', valor: (o) => o.total },
      { id: 'promedio', header: 'Promedio', align: 'right', valor: (o) => o.promedio },
      { id: 'maximo', header: 'Mejor día', align: 'right', valor: (o) => o.maximo },
      ...[...so.fechas].reverse().map((f) => ({ id: 'd' + f, header: diaCorto(f), align: 'right' as const, prioridad: 2 as const,
        valor: (o: any) => o['d' + f] })),
    ];
    const filas = so.oficinas.map((o) => {
      const r: any = { oficina: o.oficina, total: o.total, promedio: o.promedio, maximo: o.maximo };
      so.fechas.forEach((f, i) => (r['d' + f] = o.valores[i]));
      return r;
    });
    return { filas, columnas };
  });
  readonly idFilaOficinaDia = (o: any) => o.oficina;

  readonly filasFincas = computed<FilaFinca[]>(() => {
    const f = this.inf()?.fincas;
    if (!f) return [];
    return [...f.TA.map((x) => ({ temporal: 'Tu Alianza', ...x })), ...f.AL.map((x) => ({ temporal: 'Apoyo Laboral', ...x }))];
  });
  readonly columnasFincas: ColumnaTabla<FilaFinca>[] = [
    { id: 'temporal', header: 'Temporal', valor: (f) => f.temporal, tarjeta: 'meta' },
    { id: 'finca', header: 'Finca', valor: (f) => f.finca, tarjeta: 'titulo' },
    { id: 'total', header: 'Ingresos', align: 'right', valor: (f) => f.total },
  ];
  readonly idFinca = (f: FilaFinca) => f.temporal + f.finca;

  readonly filasContrataron = computed<FilaContrataron[]>(() => {
    const c = this.inf()?.contratadores;
    if (!c) return [];
    return [...c.dia.map((x) => ({ ...x, periodo: 'Día' })), ...c.periodo.map((x) => ({ ...x, periodo: `Últimos ${this.inf()?.dias ?? 30} días` }))];
  });
  readonly columnasContrataron: ColumnaTabla<FilaContrataron>[] = [
    { id: 'periodo', header: 'Periodo', valor: (c) => c.periodo, tarjeta: 'meta' },
    { id: 'nombre', header: 'Usuario', valor: (c) => c.nombre, tarjeta: 'titulo' },
    { id: 'total', header: 'Contratos', align: 'right', valor: (c) => c.total },
    { id: 'al', header: 'Apoyo', align: 'right', valor: (c) => c.al },
    { id: 'ta', header: 'Tu Alianza', align: 'right', valor: (c) => c.ta },
    { id: 'dias', header: 'Días con contratos', align: 'right', valor: (c) => c.dias },
    { id: 'oficinas', header: 'Oficinas', valor: (c) => c.oficinas, prioridad: 2 },
  ];
  readonly idContratador = (c: FilaContrataron) => c.periodo + c.nombre;

  readonly columnasVacantes: ColumnaTabla<VacanteCumplimiento>[] = [
    { id: 'fecha', header: 'Publicada', valor: (v) => v.fecha, formato: (v) => fechaCorta(v.fecha), tarjeta: 'meta' },
    { id: 'finca', header: 'Finca', valor: (v) => v.finca, tarjeta: 'titulo' },
    { id: 'temporal', header: 'Temporal', valor: (v) => v.temporal ? TEMPORAL_TEXTO[v.temporal] : '—' },
    { id: 'cargo', header: 'Cargo', valor: (v) => v.cargo, prioridad: 2, tarjeta: 'subtitulo' },
    { id: 'oficinas', header: 'Oficinas', valor: (v) => v.oficinas || 'Todas', prioridad: 3 },
    { id: 'solicitadas', header: 'Solicitadas', align: 'right', valor: (v) => v.solicitadas },
    { id: 'contratados', header: 'Contratados', align: 'right', valor: (v) => v.contratados },
    { id: 'remitidos_periodo', header: 'Remitidos en el periodo', align: 'right', valor: (v) => v.remitidos_periodo ?? 0 },
    { id: 'contratados_hoy', header: 'Contratados en el periodo', align: 'right', valor: (v) => v.contratados_hoy },
    { id: 'pendientes', header: 'Pendientes', align: 'right', valor: (v) => v.pendientes },
    { id: 'cumplimiento', header: 'Cumplimiento', align: 'center', tarjeta: 'badge', valor: (v) => v.cumplimiento,
      badge: (v) => ({ texto: v.cumplimiento == null ? '—' : v.cumplimiento + '%',
        tono: v.cumplimiento == null ? 'neutro' : v.cumplimiento >= 100 ? 'ok' : v.cumplimiento >= 50 ? 'warn' : 'danger' }) },
    { id: 'dias_abierta', header: 'Días abierta', align: 'right', valor: (v) => v.dias_abierta, prioridad: 2 },
  ];
  readonly idVacante = (v: VacanteCumplimiento) => v.id;

  readonly columnasDetalle: ColumnaTabla<ContratoDia>[] = [
    { id: 'fecha_contratacion', header: 'Contratación', valor: (c) => c.fecha_contratacion ?? null, formato: (c) => fechaCorta(c.fecha_contratacion), prioridad: 2 },
    { id: 'oficina', header: 'Oficina', valor: (c) => c.oficina, tarjeta: 'meta' },
    { id: 'nombre', header: 'Nombre', valor: (c) => c.nombre, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'cedula', header: 'Cédula', valor: (c) => c.cedula, tarjeta: 'subtitulo' },
    { id: 'temporal', header: 'Temporal', align: 'center', valor: (c) => c.temporal,
      badge: (c) => ({ texto: c.temporal ?? '—', tono: c.temporal === 'AL' ? 'info' : c.temporal === 'TA' ? 'warn' : 'neutro' }) },
    { id: 'codigo', header: 'Código', valor: (c) => c.codigo },
    { id: 'finca', header: 'Finca', valor: (c) => c.finca },
    { id: 'cargo', header: 'Cargo', valor: (c) => c.cargo, prioridad: 3 },
    { id: 'fecha_ingreso', header: 'Ingreso', valor: (c) => c.fecha_ingreso, formato: (c) => fechaCorta(c.fecha_ingreso), prioridad: 2 },
    { id: 'usuario', header: 'Contrató', valor: (c) => c.usuario, prioridad: 2 },
    { id: 'cedula_cargada', header: 'Cédula', align: 'center', valor: (c) => c.cedula_cargada ? 'Sí' : 'No',
      badge: (c) => ({ texto: c.cedula_cargada ? 'Cargada' : 'Falta', tono: c.cedula_cargada ? 'ok' : 'danger' }), prioridad: 2 },
    { id: 'traslado', header: 'Traslado', align: 'center', valor: (c) => c.traslado ? 'Sí' : 'No', prioridad: 3 },
  ];
  readonly idDetalle = (c: ContratoDia) => c.proceso_id;

  readonly filasHistorico = computed<FilaHistorico[]>(() => [...(this.inf()?.serie ?? [])].reverse());
  readonly columnasHistorico: ColumnaTabla<FilaHistorico>[] = [
    { id: 'fecha', header: 'Fecha', valor: (h) => h.fecha, formato: (h) => fechaCorta(h.fecha), tarjeta: 'titulo' },
    { id: 'al', header: 'Apoyo', align: 'right', valor: (h) => h.al },
    { id: 'ta', header: 'Tu Alianza', align: 'right', valor: (h) => h.ta },
    { id: 'total', header: 'Total', align: 'right', valor: (h) => h.total },
  ];
  readonly idHistorico = (h: FilaHistorico) => h.fecha;

  readonly columnasBitacora: ColumnaTabla<EnvioInforme>[] = [
    { id: 'creado_en', header: 'Enviado', valor: (b) => b.creado_en, formato: (b) => b.creado_en.replace('T', ' '), tarjeta: 'meta' },
    { id: 'fecha_informe', header: 'Informe del', valor: (b) => b.fecha_informe, formato: (b) => fechaCorta(b.fecha_informe) },
    { id: 'canal', header: 'Canal', align: 'center', valor: (b) => b.canal,
      badge: (b) => ({ texto: b.canal === 'CORREO' ? 'Correo' : 'WhatsApp', tono: b.canal === 'CORREO' ? 'info' : 'ok' }) },
    { id: 'destinatario', header: 'Destinatario', valor: (b) => b.destinatario, tarjeta: 'titulo' },
    { id: 'enviado', header: 'Resultado', align: 'center', tarjeta: 'badge', valor: (b) => b.enviado ? 'Enviado' : 'Falló',
      badge: (b) => ({ texto: b.enviado ? 'Enviado' : 'Falló', tono: b.enviado ? 'ok' : 'danger' }) },
    { id: 'disparo', header: 'Disparo', valor: (b) => ({ PROGRAMADO: 'Automático', MANUAL: 'Manual', PRUEBA: 'Prueba' } as Record<string, string>)[b.disparo] ?? b.disparo },
    { id: 'usuario', header: 'Por', valor: (b) => b.usuario, prioridad: 2 },
    { id: 'detalle', header: 'Detalle', valor: (b) => b.detalle, prioridad: 3 },
  ];
  readonly idBitacora = (b: EnvioInforme) => b.id;

  abrirFicha(c: ContratoDia): void {
    this.dialog.open(FichaPersonaContratacionComponent, {
      data: { cedula: c.cedula, nombre: c.nombre, proceso_id: c.proceso_id },
      position: { right: '0' }, height: '100vh', width: '760px', maxWidth: '100vw', panelClass: 'ficha-contratacion-panel', autoFocus: false,
    });
  }

  filtrarOficina(o: string): void {
    this.oficinas.set([o]);
    this.cargar();
  }

  filtrarUsuario(u: string): void {
    if (u === 'Sin registrar') return;
    this.usuariosFiltro.set([u]);
    this.cargar();
  }

  clicOficina(e: any): void {
    if (e?.seriesName) this.filtrarOficina(e.seriesName);
  }

  // ─── Acciones ────────────────────────────────────────────────────
  descargarExcel(): void {
    this.ocupado.set(true);
    this.api.informeDiarioExcel(this.fecha(), this.filtros()).subscribe({
      next: (r: HttpResponse<Blob>) => { this.ocupado.set(false); descargar(r.body!, `informe_contratacion_${this.fecha()}.xlsx`); },
      error: () => { this.ocupado.set(false); this.snack.open('No se pudo generar el Excel.', 'Cerrar', { duration: 4000 }); },
    });
  }

  verCorreo(): void {
    this.ocupado.set(true);
    this.api.vistaCorreo(this.fecha()).subscribe({
      next: (v) => { this.ocupado.set(false); this.vista.set({ asunto: v.asunto, whatsapp: v.whatsapp, html: this.sanitizer.bypassSecurityTrustHtml(v.html) }); },
      error: () => { this.ocupado.set(false); this.snack.open('No se pudo armar la vista previa.', 'Cerrar', { duration: 4000 }); },
    });
  }

  copiarWhatsapp(): void {
    const t = this.vista()?.whatsapp;
    if (t) navigator.clipboard?.writeText(t).then(() => this.snack.open('Texto copiado. Pégalo en WhatsApp.', 'Cerrar', { duration: 2500 }));
  }

  async enviarAhora(): Promise<void> {
    const activos = this.destinatarios().filter((d) => !!d.activo);
    const r = await Swal.fire({
      icon: 'question', title: 'Enviar el informe del ' + fechaCorta(this.fecha()),
      text: `Se enviará a ${activos.length} destinatario(s) activos (${activos.filter((d) => d.canal === 'CORREO').length} por correo, `
        + `${activos.filter((d) => d.canal === 'WHATSAPP').length} por WhatsApp). El correo va sin filtros: todas las oficinas.`,
      showCancelButton: true, confirmButtonText: 'Enviar', cancelButtonText: 'Cancelar', confirmButtonColor: '#2B59F0',
    });
    if (r.isConfirmed) this.enviar(null);
  }

  async enviarPrueba(): Promise<void> {
    const r = await Swal.fire({
      title: 'Enviar una prueba', input: 'text', inputLabel: 'Correo o celular que recibe la prueba', inputPlaceholder: 'nombre@empresa.com o 3101234567',
      showCancelButton: true, confirmButtonText: 'Enviar prueba', cancelButtonText: 'Cancelar', confirmButtonColor: '#2B59F0',
    });
    if (r.isConfirmed && r.value) this.enviar(String(r.value).trim());
  }

  private enviar(prueba: string | null): void {
    this.ocupado.set(true);
    this.api.enviarInforme(this.fecha(), prueba).subscribe({
      next: (res) => {
        this.ocupado.set(false);
        this.resultado.set(res);
        this.snack.open(`${res.enviados} correo(s) enviados${res.fallidos ? `, ${res.fallidos} fallidos` : ''}.`, 'Cerrar', { duration: 5000 });
        this.cargarBitacora();
      },
      error: (e) => { this.ocupado.set(false); this.snack.open(e?.error?.message || 'No se pudo enviar.', 'Cerrar', { duration: 5000 }); },
    });
  }

  // ─── Configuración, oficinas y destinatarios ─────────────────────
  guardarConfig(cambio: Partial<ConfigInforme>): void {
    this.api.guardarConfigInforme(cambio).subscribe({
      next: (c) => { this.config.set(c); this.snack.open('Guardado.', 'Cerrar', { duration: 2000 }); if (cambio.oficinas) this.cargar(); },
      error: (e) => this.snack.open(e?.error?.message || 'No se pudo guardar.', 'Cerrar', { duration: 4000 }),
    });
  }

  alternarDia(id: string): void {
    const c = this.config();
    if (!c) return;
    this.guardarConfig({ dias: c.dias.includes(id) ? c.dias.filter((d) => d !== id) : [...c.dias, id] });
  }

  readonly oficinasSugeridas = computed(() => {
    const ya = new Set(this.config()?.oficinas ?? []);
    return (this.inf()?.opciones?.oficinas ?? []).filter((o) => !ya.has(o));
  });

  quitarOficina(o: string): void {
    this.guardarConfig({ oficinas: (this.config()?.oficinas ?? []).filter((x) => x !== o) });
  }

  agregarOficina(): void {
    const o = this.nuevaOficina.trim().toUpperCase();
    const l = this.config()?.oficinas ?? [];
    if (!o || l.includes(o)) return;
    this.nuevaOficina = '';
    this.guardarConfig({ oficinas: [...l, o] });
  }

  moverOficina(o: string, delta: number): void {
    const l = [...(this.config()?.oficinas ?? [])];
    const i = l.indexOf(o), j = i + delta;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    this.guardarConfig({ oficinas: l });
  }

  private cargarDestinatarios(): void {
    this.api.destinatarios().subscribe({ next: (d) => this.destinatarios.set(d), error: () => undefined });
    this.cargarBitacora();
  }

  private cargarBitacora(): void {
    this.api.bitacoraEnvios().subscribe({ next: (b) => this.bitacora.set(b), error: () => undefined });
  }

  readonly conteoDest = computed(() => {
    const l = this.destinatarios().filter((d) => !!d.activo);
    return { correo: l.filter((d) => d.canal === 'CORREO').length, whatsapp: l.filter((d) => d.canal === 'WHATSAPP').length };
  });

  readonly resumenBitacora = computed(() => {
    const b = this.bitacora();
    return { total: b.length, ok: b.filter((x) => !!x.enviado).length, fallos: b.filter((x) => !x.enviado).length,
      ultimo: b[0]?.creado_en?.replace('T', ' ') ?? null };
  });

  buscar(q: string): void {
    this.busqueda.set(q);
    this.busqueda$.next(q);
  }

  agregarUsuario(u: UsuarioPlataforma, canal: 'CORREO' | 'WHATSAPP'): void {
    const valor = canal === 'CORREO' ? u.correo : u.celular;
    if (!valor) return;
    this.agregar({ canal, valor, nombre: u.nombre || u.correo, usuario_id: u.usuario_id });
  }

  agregarManual(): void {
    if (!this.nuevoValor.trim()) return;
    this.agregar({ canal: this.nuevoCanal, valor: this.nuevoValor.trim(), nombre: this.nuevoNombre.trim() || null });
  }

  private agregar(d: { canal: 'CORREO' | 'WHATSAPP'; valor: string; nombre?: string | null; usuario_id?: string | null }): void {
    this.api.agregarDestinatario(d).subscribe({
      next: (l) => { this.destinatarios.set(l); this.nuevoValor = ''; this.nuevoNombre = ''; this.snack.open('Destinatario agregado.', 'Cerrar', { duration: 2000 }); },
      error: (e) => this.snack.open(e?.error?.message || 'No se pudo agregar.', 'Cerrar', { duration: 4000 }),
    });
  }

  activar(d: Destinatario, activo: boolean): void {
    this.api.activarDestinatario(d.id, activo).subscribe({ next: (l) => this.destinatarios.set(l) });
  }

  async quitar(d: Destinatario): Promise<void> {
    const r = await Swal.fire({ icon: 'warning', title: 'Quitar destinatario', text: `${d.nombre || ''} ${d.valor}`,
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626' });
    if (r.isConfirmed) this.api.quitarDestinatario(d.id).subscribe({ next: (l) => this.destinatarios.set(l) });
  }

  /** ¿Ya está ese correo / celular? (misma normalización que ms-hr). */
  yaEsta(canal: 'CORREO' | 'WHATSAPP', valor: string | null): boolean {
    if (!valor) return false;
    const v = canal === 'CORREO' ? valor.trim().toLowerCase() : valor.replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');
    return this.destinatarios().some((d) => d.canal === canal && d.valor === v);
  }

  readonly fechaCorta = fechaCorta;
}

function sumar(iso: string, dias: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return ymd(d);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}

function diaCorto(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}/${m}`;
}

function varr(hoy: number, ref: number): { var: string | null; cls: string } {
  if (!ref) return { var: hoy ? `+${hoy}` : null, cls: hoy ? 'bueno' : '' };
  const p = Math.round(((hoy - ref) / ref) * 100);
  return { var: `${p > 0 ? '+' : ''}${p}%`, cls: p > 0 ? 'bueno' : p < 0 ? 'malo' : '' };
}

function iniciales(n: string): string {
  return n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function leer(k: string, porDefecto: string): string {
  try { return localStorage.getItem(k) ?? porDefecto; } catch { return porDefecto; }
}

function guardar(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* opcional */ }
}

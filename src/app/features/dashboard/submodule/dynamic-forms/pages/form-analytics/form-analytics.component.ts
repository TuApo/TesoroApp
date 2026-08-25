import {
  ChangeDetectionStrategy, Component, DestroyRef, Input, LOCALE_ID, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule, formatCurrency, formatNumber } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';

import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

import { FormAnalyticsService } from '../../services/form-analytics.service';
import { DynamicFormService } from '../../services/dynamic-form.service';
import {
  AnalyticsGranularity, ApiProblem, FieldStats, FormAnalytics, FormDetail, HourPoint, SeriesPoint,
} from '../../models/dynamic-forms.models';

/** Color de marca (var(--navy)); echarts pinta en canvas y no resuelve variables CSS. */
const NAVY = '#21263C';
/** Gris para la barra agregada "Otros" (fuera de la identidad de marca a propósito). */
const GRIS_OTROS = '#94a3b8';
/** Máximo de barras individuales por campo; el resto se agrupa en "Otros". */
const TOP_BARRAS = 12;
/** Por encima de este número de huecos no se rellenan los tramos sin respuestas. */
const MAX_RELLENO = { day: 400, hour: 1500 } as const;

/** Presentación de cada estado de by_status (etiqueta ES + icono + clase de color). */
const META_ESTADOS: Record<string, { etiqueta: string; icono: string; clase: string; orden: number }> = {
  SUBMITTED: { etiqueta: 'Enviadas',   icono: 'send',         clase: 'kpi--enviadas',   orden: 1 },
  APPROVED:  { etiqueta: 'Aprobadas',  icono: 'check_circle', clase: 'kpi--aprobadas',  orden: 2 },
  REJECTED:  { etiqueta: 'Rechazadas', icono: 'cancel',       clase: 'kpi--rechazadas', orden: 3 },
  DRAFT:     { etiqueta: 'Borradores', icono: 'edit_note',    clase: 'kpi--borradores', orden: 4 },
};

interface KpiEstado {
  estado: string;
  etiqueta: string;
  icono: string;
  clase: string;
  total: number;
  orden: number;
}

interface FilaDistribucion {
  label: string;
  total: number;
}

/** Gráfica de barras de un campo con distribución + sus filas para la tabla accesible. */
interface CampoDistribucion {
  stat: FieldStats;
  option: EChartsOption;
  /** Alto del canvas en px (depende del número de barras). */
  alto: number;
  filas: FilaDistribucion[];
}

/**
 * Analítica de un formulario dinámico (ruta :formId/analitica).
 *
 * Solo lectura: KPIs por estado, serie diaria de respuestas y distribución por campo,
 * todo calculado por el backend (GET /forms/{id}/analytics). El filtro de fechas
 * re-consulta al servidor; no se tabula nada en el cliente salvo dar forma a las
 * opciones de echarts.
 */
@Component({
  selector: 'app-form-analytics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  templateUrl: './form-analytics.component.html',
  styleUrl: './form-analytics.component.css',
})
export class FormAnalyticsComponent implements OnInit {
  /**
   * Id inyectado por el DISPATCHER (form-view-host); reacciona también si el host
   * reutiliza el componente para otro formulario. Sin input, se lee de la ruta
   * clásica :formId/analitica.
   */
  @Input() set formIdInput(id: number | undefined) {
    if (id != null && Number.isFinite(id) && id > 0) {
      this.idPorInput = id;
      this.inicializar(id);
    }
  }
  private idPorInput?: number;

  private analyticsSvc = inject(FormAnalyticsService);
  private formSvc = inject(DynamicFormService);
  private route = inject(ActivatedRoute);
  private snack = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);
  private locale = inject(LOCALE_ID);

  readonly formId = signal<number>(0);

  // ── Estado de la vista ─────────────────────────────────────────────
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly datos = signal<FormAnalytics | null>(null);
  readonly formulario = signal<FormDetail | null>(null);

  // Filtro de rango: lo escrito en los inputs vs. lo realmente aplicado a la consulta.
  // Con granularidad "hour" los inputs son datetime-local (yyyy-MM-ddTHH:mm).
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly filtroAplicado = signal<{ from?: string; to?: string } | null>(null);

  /** Granularidad de la línea de tiempo: por día o por día y hora. */
  readonly granularidad = signal<AnalyticsGranularity>('day');

  ngOnInit(): void {
    // Con id del host, el setter ya inicializó: no se lee la ruta.
    if (this.idPorInput != null) return;
    this.inicializar(Number(this.route.snapshot.paramMap.get('formId')));
  }

  /** Fija el formId, resetea filtros y dispara la carga de contexto + analítica. */
  private inicializar(id: number): void {
    this.formId.set(id);
    this.desde.set('');
    this.hasta.set('');
    this.filtroAplicado.set(null);
    this.granularidad.set('day');
    if (!Number.isFinite(id) || id <= 0) {
      this.cargando.set(false);
      this.error.set('El identificador del formulario en la URL no es válido.');
      return;
    }
    // El nombre del formulario es contexto, no bloquea la analítica si falla.
    this.formSvc.get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: f => this.formulario.set(f),
        error: () => { /* el título cae al fallback "Formulario #id" */ },
      });
    this.cargar();
  }

  // ── Carga ──────────────────────────────────────────────────────────

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.analyticsSvc.analytics(this.formId(),
      { ...(this.filtroAplicado() ?? {}), granularity: this.granularidad() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => {
          this.datos.set(data);
          this.cargando.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.error.set(this.mensajeError(err));
          this.cargando.set(false);
        },
      });
  }

  aplicarFiltro(): void {
    const from = this.desde() || undefined;
    const to = this.hasta() || undefined;
    if (from && to && from > to) {
      this.snack.open('Rango inválido: "Desde" no puede ser posterior a "Hasta".', 'Cerrar', { duration: 4000 });
      return;
    }
    this.filtroAplicado.set(from || to ? { from, to } : null);
    this.cargar();
  }

  limpiarFiltro(): void {
    this.desde.set('');
    this.hasta.set('');
    this.filtroAplicado.set(null);
    this.cargar();
  }

  /**
   * Cambia la granularidad y recarga. Los inputs cambian de tipo (date ↔ datetime-local),
   * así que el valor escrito se adapta: al pasar a hora se completa con las 00:00 y al
   * volver a día se recorta la hora (un datetime-local no muestra "2026-08-19" a secas).
   */
  cambiarGranularidad(gran: AnalyticsGranularity): void {
    if (this.granularidad() === gran) return;
    this.granularidad.set(gran);
    const ajustar = (v: string) => {
      if (!v) return '';
      return gran === 'hour'
        ? (v.length === 10 ? `${v}T00:00` : v)
        : v.slice(0, 10);
    };
    this.desde.update(ajustar);
    this.hasta.update(ajustar);
    const filtro = this.filtroAplicado();
    if (filtro) this.filtroAplicado.set({ from: this.desde() || undefined, to: this.hasta() || undefined });
    this.cargar();
  }

  private mensajeError(err: HttpErrorResponse): string {
    const problema = err.error as ApiProblem | null;
    if (problema && typeof problema.detail === 'string' && problema.detail.trim()) {
      return problema.detail;
    }
    return 'No se pudo cargar la analítica del formulario. Verifica tu conexión e intenta de nuevo.';
  }

  // ── KPIs ───────────────────────────────────────────────────────────

  readonly kpisEstado = computed<KpiEstado[]>(() => {
    const data = this.datos();
    if (!data) return [];
    return Object.entries(data.by_status ?? {})
      .map(([estado, total]) => {
        const meta = META_ESTADOS[estado];
        return {
          estado,
          etiqueta: meta?.etiqueta ?? estado,
          icono: meta?.icono ?? 'help',
          clase: meta?.clase ?? 'kpi--otro',
          total,
          orden: meta?.orden ?? 99,
        };
      })
      .sort((a, b) => a.orden - b.orden || a.estado.localeCompare(b.estado));
  });

  // ── Línea de tiempo (día o día y hora) ─────────────────────────────

  /**
   * Puntos crudos ordenados (también alimentan la tabla accesible bajo la gráfica).
   * Si el backend es anterior a `series`, se reconstruye desde la serie diaria.
   */
  readonly tablaSerie = computed<SeriesPoint[]>(() => {
    const data = this.datos();
    if (!data) return [];
    const serie: SeriesPoint[] = data.series
      ?? (data.daily ?? []).map(d => ({ bucket: `${d.date}T00:00`, total: d.total }));
    return [...serie].sort((a, b) => a.bucket.localeCompare(b.bucket));
  });

  readonly opcionSerie = computed<EChartsOption | null>(() => {
    const crudos = this.tablaSerie();
    if (crudos.length === 0) return null;
    const paso = this.granularidad();
    const puntos = this.rellenarBuckets(crudos, paso);
    // Con un rango que cruza de año, la etiqueta lo dice (si no, "02 ene" es ambiguo).
    const conAnio = puntos[0].bucket.slice(0, 4) !== puntos[puntos.length - 1].bucket.slice(0, 4);
    const unPunto = puntos.length <= 1;
    return {
      tooltip: { trigger: 'axis', confine: true },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: puntos.map(p => this.etiquetaBucket(p.bucket, paso, conAnio)),
        axisLabel: { color: '#64748b', fontSize: 11, hideOverlap: true },
        axisLine: { lineStyle: { color: '#d8e0ea' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: '#64748b', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef2f7' } },
      },
      series: [{
        name: 'Respuestas',
        type: 'line',
        smooth: true,
        showSymbol: unPunto,
        symbolSize: 7,
        data: puntos.map(p => p.total),
        lineStyle: { width: 2, color: NAVY },
        itemStyle: { color: NAVY },
        // Área suave bajo la línea (degradado del navy hacia transparente).
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(33, 38, 60, 0.16)' },
              { offset: 1, color: 'rgba(33, 38, 60, 0)' },
            ],
          },
        },
      }],
    };
  });

  /**
   * Rellena con 0 los tramos sin respuestas entre el primer y el último punto —días con
   * granularidad "day", horas con "hour"— para que la línea no "una" instantes lejanos
   * como si fueran contiguos. En rangos enormes se deja la serie tal cual.
   */
  private rellenarBuckets(orden: SeriesPoint[], paso: AnalyticsGranularity): SeriesPoint[] {
    if (orden.length <= 1) return orden;
    const validos = orden.filter(p => !Number.isNaN(this.aFecha(p.bucket).getTime()));
    if (validos.length <= 1) return orden;
    const porBucket = new Map(validos.map(p => [this.claveBucket(this.aFecha(p.bucket), paso), p.total]));
    const inicio = this.aFecha(validos[0].bucket);
    const fin = this.aFecha(validos[validos.length - 1].bucket);
    const ms = paso === 'hour' ? 3_600_000 : 86_400_000;
    const huecos = Math.round((fin.getTime() - inicio.getTime()) / ms);
    if (huecos <= 0 || huecos > MAX_RELLENO[paso]) return validos;

    const res: SeriesPoint[] = [];
    const cursor = new Date(inicio);
    while (cursor <= fin) {
      const clave = this.claveBucket(cursor, paso);
      res.push({ bucket: clave, total: porBucket.get(clave) ?? 0 });
      if (paso === 'hour') cursor.setHours(cursor.getHours() + 1);
      else cursor.setDate(cursor.getDate() + 1);
    }
    return res;
  }

  /** El bucket viaja como instante local sin zona: se interpreta tal cual, sin UTC. */
  private aFecha(bucket: string): Date {
    return new Date(bucket.length === 10 ? `${bucket}T00:00:00` : bucket);
  }

  private claveBucket(d: Date, paso: AnalyticsGranularity): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    const dia = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    return paso === 'hour' ? `${dia}T${p2(d.getHours())}:00` : `${dia}T00:00`;
  }

  /** Etiqueta corta del eje X: "19 ago" por día, "19 ago 14:00" por hora. */
  private etiquetaBucket(bucket: string, paso: AnalyticsGranularity, conAnio: boolean): string {
    const fecha = this.aFecha(bucket);
    if (Number.isNaN(fecha.getTime())) return bucket;
    const dia = fecha.toLocaleDateString('es-CO', conAnio
      ? { day: '2-digit', month: 'short', year: '2-digit' }
      : { day: '2-digit', month: 'short' });
    return paso === 'hour'
      ? `${dia} ${String(fecha.getHours()).padStart(2, '0')}:00`
      : dia;
  }

  /** Etiqueta completa es-CO para la tabla de datos (con hora si la granularidad la tiene). */
  etiquetaLarga(bucket: string): string {
    const fecha = this.aFecha(bucket);
    if (Number.isNaN(fecha.getTime())) return bucket;
    const dia = fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
    if (this.granularidad() !== 'hour') return dia;
    const h = String(fecha.getHours()).padStart(2, '0');
    return `${dia}, ${h}:00 a ${h}:59`;
  }

  // ── Reparto por hora del día ───────────────────────────────────────

  /** Las 24 franjas tal cual las manda el backend (las vacías en 0). */
  readonly horasDelDia = computed<HourPoint[]>(() => {
    const horas = this.datos()?.hour_of_day ?? [];
    return [...horas].sort((a, b) => a.hour - b.hour);
  });

  readonly opcionHoras = computed<EChartsOption | null>(() => {
    const horas = this.horasDelDia();
    if (horas.length === 0 || horas.every(h => h.total === 0)) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: horas.map(h => `${String(h.hour).padStart(2, '0')}:00`),
        axisLabel: { color: '#64748b', fontSize: 11, hideOverlap: true },
        axisLine: { lineStyle: { color: '#d8e0ea' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: '#64748b', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef2f7' } },
      },
      series: [{
        name: 'Respuestas',
        type: 'bar',
        data: horas.map(h => h.total),
        barMaxWidth: 22,
        itemStyle: { color: NAVY, borderRadius: [4, 4, 0, 0] },
      }],
    };
  });

  /** "14:00 a 14:59": franja horaria legible para la tabla accesible. */
  franjaHoraria(hora: number): string {
    const h = String(hora).padStart(2, '0');
    return `${h}:00 a ${h}:59`;
  }
  // ── Distribución por campo ─────────────────────────────────────────

  readonly camposConDistribucion = computed<CampoDistribucion[]>(() => {
    const data = this.datos();
    if (!data) return [];
    return (data.fields ?? [])
      .filter(f => f.distribution && Object.keys(f.distribution).length > 0)
      .map(f => this.construirBarras(f));
  });

  private construirBarras(stat: FieldStats): CampoDistribucion {
    const entradas: FilaDistribucion[] = Object.entries(stat.distribution ?? {})
      .map(([label, total]) => ({ label: label.trim() || '—', total }))
      .sort((a, b) => b.total - a.total);

    const filas = entradas.slice(0, TOP_BARRAS);
    const resto = entradas.slice(TOP_BARRAS);
    if (resto.length > 0) {
      filas.push({
        label: `Otros (${resto.length})`,
        total: resto.reduce((suma, e) => suma + e.total, 0),
      });
    }

    const valores = filas.map((fila, i) => {
      const esOtros = resto.length > 0 && i === filas.length - 1;
      return {
        value: fila.total,
        itemStyle: {
          color: esOtros ? GRIS_OTROS : NAVY,
          borderRadius: [0, 4, 4, 0],
        },
      };
    });

    const option: EChartsOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
      grid: { left: 8, right: 44, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: '#64748b', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef2f7' } },
      },
      yAxis: {
        type: 'category',
        inverse: true, // mayor conteo arriba
        data: filas.map(f => f.label),
        axisLabel: { color: '#334155', fontSize: 11, width: 140, overflow: 'truncate' },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: [{
        name: stat.label,
        type: 'bar',
        data: valores,
        barMaxWidth: 18,
        label: { show: true, position: 'right', color: '#475569', fontSize: 11 },
      }],
    };

    return {
      stat,
      option,
      alto: Math.max(190, filas.length * 34 + 60),
      filas,
    };
  }

  // ── Campos numéricos sin distribución ──────────────────────────────

  readonly camposNumericos = computed<FieldStats[]>(() => {
    const data = this.datos();
    if (!data) return [];
    return (data.fields ?? []).filter(f =>
      (!f.distribution || Object.keys(f.distribution).length === 0)
      && (f.avg != null || f.min != null || f.max != null));
  });

  /** Formatea avg/min/max en es-CO; CURRENCY en pesos, el resto como número. */
  formatearValor(stat: FieldStats, valor: number | null | undefined): string {
    if (valor == null) return '—';
    return stat.type === 'CURRENCY'
      ? formatCurrency(valor, this.locale, '$', 'COP', '1.0-0')
      : formatNumber(valor, this.locale, '1.0-2');
  }
}

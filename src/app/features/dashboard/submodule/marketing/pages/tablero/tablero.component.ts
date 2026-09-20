import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, formatNumber } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import type { EChartsOption } from 'echarts';
import { forkJoin } from 'rxjs';

import {
  Canales, FilaRanking, FilaVacante, MarketingService, PuntoSerie, ResumenTablero,
} from '../../service/marketing.service';

/**
 * El tablero de referidos.
 *
 * <p><b>Que pregunta responde.</b> No "cuantos clics hubo" —eso no decide nada— sino
 * <b>cuantos de los que trajo alguien terminaron contratados</b>. Por eso el embudo va
 * arriba y el ranking se ordena por contratados, no por difusion.
 *
 * <p><b>Lo que se ve depende de quien mira</b>, y lo decide el backend: un administrador
 * recibe las cifras de la plataforma y el ranking; cualquier otra persona recibe solo lo
 * suyo y el ranking le llega vacio. La pantalla no esconde nada por su cuenta —esconder un
 * boton no protege un endpoint— sino que se adapta a lo que le devuelven.
 */
@Component({
  selector: 'app-mk-tablero',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgxEchartsDirective, ...TABLA_ESTANDAR],
  providers: [provideEchartsTema()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tablero.component.html',
  styleUrl: './tablero.component.css',
})
export class TableroComponent implements OnInit {
  private readonly api = inject(MarketingService);
  private readonly locale = inject(LOCALE_ID);

  readonly cargando = signal(true);
  readonly resumen = signal<ResumenTablero | null>(null);
  readonly serie = signal<PuntoSerie[]>([]);
  readonly ranking = signal<FilaRanking[]>([]);
  readonly canales = signal<Canales | null>(null);
  readonly vacantes = signal<FilaVacante[]>([]);

  /** Atajos de periodo. Un mes es lo que dura una convocatoria de finca. */
  readonly periodos = [
    { dias: 7, etiqueta: '7 días' },
    { dias: 30, etiqueta: '30 días' },
    { dias: 90, etiqueta: '90 días' },
  ];
  readonly periodo = signal(30);

  readonly esGlobal = computed(() => this.resumen()?.es_global ?? false);
  readonly sinDatos = computed(() => !this.cargando() && (this.resumen()?.clics ?? 0) === 0
    && (this.resumen()?.piezas_generadas ?? 0) === 0);

  // ── tablas ────────────────────────────────────────────────────────────

  /** El puesto sale del orden del backend (por contratados): se conserva aunque se reordene. */
  readonly columnasRanking: ColumnaTabla<FilaRanking>[] = [
    { id: 'puesto', header: 'Puesto', valor: (f) => this.ranking().indexOf(f) + 1, align: 'right',
      tarjeta: 'meta' },
    { id: 'codigo', header: 'Código', valor: (f) => f.codigo, tarjeta: 'titulo' },
    { id: 'clics', header: 'Entraron', valor: (f) => f.clics, formato: (f) => this.cifra(f.clics),
      align: 'right', tarjeta: 'meta' },
    { id: 'preregistros', header: 'Se registraron', valor: (f) => f.preregistros,
      formato: (f) => this.cifra(f.preregistros), align: 'right', tarjeta: 'meta' },
    { id: 'contratados', header: 'Contratados', valor: (f) => f.contratados, align: 'right', tarjeta: 'subtitulo' },
    { id: 'conversion', header: 'Conversión', valor: (f) => f.tasa_registro, formato: (f) => `${f.tasa_registro}%`,
      align: 'right', tarjeta: 'meta' },
  ];
  readonly idRanking = (f: FilaRanking) => f.usuario_id;

  readonly columnasVacantes: ColumnaTabla<FilaVacante>[] = [
    { id: 'vacante', header: 'Vacante', valor: (v) => v.vacante_id, formato: (v) => `#${v.vacante_id}`,
      tarjeta: 'titulo' },
    { id: 'clics', header: 'Entraron', valor: (v) => v.clics, formato: (v) => this.cifra(v.clics),
      align: 'right', tarjeta: 'meta' },
    { id: 'difusores', header: 'Difusores', valor: (v) => v.difusores, formato: (v) => this.cifra(v.difusores),
      align: 'right', tarjeta: 'meta' },
    { id: 'preregistros', header: 'Se registraron', valor: (v) => v.preregistros, align: 'right',
      tarjeta: 'subtitulo' },
  ];
  readonly idVacante = (v: FilaVacante) => v.vacante_id;

  /** Mismo resultado que el pipe `number`. */
  private cifra(n: number | null | undefined): string {
    return n === null || n === undefined ? '' : formatNumber(n, this.locale);
  }

  ngOnInit(): void { this.cargar(); }

  cambiarPeriodo(dias: number): void {
    if (this.periodo() === dias) return;
    this.periodo.set(dias);
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - (this.periodo() - 1) * 86400000);
    const d = this.iso(desde);
    const h = this.iso(hasta);

    // Una sola espera y no cinco spinners: el tablero se lee de un vistazo o no se lee.
    forkJoin({
      resumen: this.api.resumenTablero(d, h),
      serie: this.api.serieTablero(d, h),
      ranking: this.api.rankingTablero(d, h),
      canales: this.api.canalesTablero(d, h),
      vacantes: this.api.vacantesTablero(d, h),
    }).subscribe({
      next: (r) => {
        this.resumen.set(r.resumen);
        this.serie.set(r.serie);
        this.ranking.set(r.ranking);
        this.canales.set(r.canales);
        this.vacantes.set(r.vacantes);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  private iso(d: Date): string { return d.toISOString().slice(0, 10); }

  // ── graficas ────────────────────────────────────────────────────────────

  /**
   * Clics, registros y contratados en el mismo eje.
   *
   * <p>Superponerlos es el punto: la distancia entre la linea de arriba y la de abajo ES
   * el embudo. Tres graficas separadas obligarian a comparar escalas de memoria.
   */
  readonly opcionesSerie = computed<EChartsOption>(() => {
    const s = this.serie();
    const dias = s.map((p) => p.fecha.slice(5).replace('-', '/'));
    return {
      grid: { left: 8, right: 12, top: 34, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis' },
      legend: { data: ['Clics', 'Registros', 'Contratados'], top: 0, icon: 'roundRect', itemHeight: 8 },
      xAxis: { type: 'category', data: dias, axisTick: { show: false }, axisLine: { lineStyle: { color: '#e2e8f0' } } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      series: [
        {
          name: 'Clics', type: 'line', smooth: true, showSymbol: false,
          data: s.map((p) => p.clics), itemStyle: { color: '#3b82f6' },
          areaStyle: { color: 'rgba(59,130,246,.10)' },
        },
        {
          name: 'Registros', type: 'line', smooth: true, showSymbol: false,
          data: s.map((p) => p.preregistros), itemStyle: { color: '#f58634' },
        },
        {
          name: 'Contratados', type: 'line', smooth: true, showSymbol: false,
          data: s.map((p) => p.contratados), itemStyle: { color: '#16a34a' },
        },
      ],
    };
  });

  /**
   * Por donde entra la gente. Barras horizontales y no un donut: las etiquetas son
   * nombres largos ("WhatsApp", "Samsung") y en un donut no caben sin leyenda aparte.
   */
  readonly opcionesDispositivo = computed<EChartsOption>(() =>
    this.barras(this.canales()?.dispositivo ?? [], '#3b82f6'));

  readonly opcionesNavegador = computed<EChartsOption>(() =>
    this.barras((this.canales()?.navegador ?? []).slice(0, 6), '#8b5cf6'));

  private barras(datos: { etiqueta: string; clics: number }[], color: string): EChartsOption {
    const orden = [...datos].reverse();
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: 'item' },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f1f5f9' } } },
      yAxis: {
        type: 'category', data: orden.map((d) => d.etiqueta),
        axisTick: { show: false }, axisLine: { show: false },
      },
      series: [{
        type: 'bar', data: orden.map((d) => d.clics), itemStyle: { color, borderRadius: [0, 5, 5, 0] },
        barMaxWidth: 22, label: { show: true, position: 'right', fontSize: 11, color: '#64748b' },
      }],
    };
  }

  /** El embudo en tres cifras. `null` cuando aún no hay de donde calcular una tasa. */
  readonly pasos = computed(() => {
    const r = this.resumen();
    if (!r) return [];
    return [
      { titulo: 'Entraron por un enlace', valor: r.clics_unicos, tasa: null as number | null },
      { titulo: 'Se registraron', valor: r.preregistros, tasa: r.clics_unicos ? r.tasa_registro : null },
      { titulo: 'Quedaron contratados', valor: r.contratados, tasa: r.preregistros ? r.tasa_contratacion : null },
    ];
  });
}

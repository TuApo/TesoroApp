import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, switchMap, catchError, of, tap } from 'rxjs';
import type { EChartsOption } from 'echarts';
import { NgxEchartsDirective } from 'ngx-echarts';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { ChartCardComponent } from '../../../metricas/shared/components/chart-card/chart-card.component';
import {
  ArchivoHistoricoService, DocumentoArchivo, FichaPersona, FiltrosArchivo, PaginaDocumentos, ResumenArchivo,
} from '../../services/archivo-historico.service';
import { VisorArchivoDialogComponent } from '../../components/visor-archivo/visor-archivo-dialog.component';
import {
  ETIQUETA_EMPRESA, ETIQUETA_ESTADO, ETIQUETA_TRAMITE, ETIQUETA_UBICACION, MESES_CORTOS, etiqueta, periodoCorto,
} from './archivo-historico.etiquetas';

/**
 * Pestaña «Archivo histórico» del tablero de Afiliaciones: los certificados de afiliación (EPS, caja,
 * pensión) de Tu Alianza y Apoyo Laboral de jul-2023 a oct-2026, cruzados con la contratación de la
 * plataforma hasta hoy. Todo llega agregado de ms-hr (/gestion_afiliaciones/archivo).
 *
 * Color: paleta categórica validada (claro/oscuro) en orden FIJO por entidad, nunca por rango:
 * Apoyo Laboral siempre es el slot 1 y Tu Alianza el 2, filtre lo que se filtre.
 */
const SERIES_CLARO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const SERIES_OSCURO = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
const SECUENCIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const ORDEN_EMPRESAS = ['APOYO_LABORAL', 'TU_ALIANZA'];
const ORDEN_TRAMITES = ['EPS', 'EPS_EXTEMPORANEAS', 'CAJA', 'PENSION', 'PLANOS_CARGUE', 'BENEFICIARIOS'];
/** Último día que trae el backup (el RAR de 2026 llega al 16-oct). */
const FIN_ARCHIVO = '2026-10';
const DIAS = ['', 'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

@Component({
  selector: 'app-archivo-historico',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe, DatePipe, FormsModule, NgxEchartsDirective, ChartCardComponent, ...TABLA_ESTANDAR,
    MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressBarModule, MatSelectModule, MatTooltipModule,
  ],
  providers: [provideEchartsTema()],
  templateUrl: './archivo-historico.component.html',
  styleUrl: './archivo-historico.component.css',
})
export class ArchivoHistoricoComponent {
  private readonly api = inject(ArchivoHistoricoService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly etiquetaEmpresa = (c: string | null | undefined) => etiqueta(ETIQUETA_EMPRESA, c);
  readonly etiquetaTramite = (c: string | null | undefined) => etiqueta(ETIQUETA_TRAMITE, c);
  readonly meses = MESES_CORTOS;

  // ------------------------------------------------------------------ filtros
  readonly empresa = signal<string | null>(null);
  readonly anio = signal<number | null>(null);
  readonly tramite = signal<string | null>(null);
  readonly entidad = signal<string | null>(null);
  readonly ubicacion = signal<string | null>(null);
  readonly cedulaTabla = signal('');
  readonly anios = [2023, 2024, 2025, 2026];
  readonly empresas = ORDEN_EMPRESAS;
  readonly tramites = ['EPS', 'EPS_EXTEMPORANEAS', 'CAJA', 'CAJA_EXTEMPORANEA', 'PENSION', 'BENEFICIARIOS', 'PLANOS_CARGUE'];
  readonly ubicaciones = ['ARCHIVO', 'COMPARTIDO', 'POR_REVISAR', 'DUPLICADO'];
  readonly filtros = computed<FiltrosArchivo>(() => ({
    empresa: this.empresa(), anio: this.anio(), tramite: this.tramite(), entidad: this.entidad(),
  }));

  // ------------------------------------------------------------------ datos
  readonly resumen = signal<ResumenArchivo | null>(null);
  readonly cargandoResumen = signal(true);
  readonly error = signal<string | null>(null);
  readonly entidades = computed(() => (this.resumen()?.por_entidad ?? []).map(e => e.clave));

  readonly pagina = signal<PaginaDocumentos | null>(null);
  readonly paginaIdx = signal(0);
  readonly porPagina = signal(50);
  readonly cargandoTabla = signal(true);

  readonly ficha = signal<FichaPersona | null>(null);
  readonly cargandoFicha = signal(false);
  readonly errorFicha = signal<string | null>(null);
  cedulaBuscada = '';

  readonly dimSerie = signal<'empresa' | 'tramite'>('empresa');

  private readonly pedirResumen$ = new Subject<FiltrosArchivo>();
  private readonly pedirTabla$ = new Subject<void>();

  constructor() {
    this.pedirResumen$.pipe(
      tap(() => { this.cargandoResumen.set(true); this.error.set(null); }),
      switchMap(f => this.api.resumen(f).pipe(catchError(e => {
        this.error.set(e?.status === 404 ? 'El archivo histórico todavía no está publicado en el servidor.' : 'No se pudo cargar el archivo histórico.');
        return of(null);
      }))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => { this.resumen.set(r); this.cargandoResumen.set(false); });

    this.pedirTabla$.pipe(
      debounceTime(250),
      tap(() => this.cargandoTabla.set(true)),
      switchMap(() => this.api.documentos(
        { ...this.filtros(), ubicacion: this.ubicacion(), cedula: this.cedulaTabla() },
        this.paginaIdx(), this.porPagina()).pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(p => { this.pagina.set(p); this.cargandoTabla.set(false); });

    this.recargar();
  }

  recargar(): void {
    this.paginaIdx.set(0);
    this.pedirResumen$.next(this.filtros());
    this.pedirTabla$.next();
  }

  cambiarFiltro<T>(s: { set(v: T): void }, v: T): void {
    s.set(v);
    this.recargar();
  }

  limpiarFiltros(): void {
    this.empresa.set(null); this.anio.set(null); this.tramite.set(null); this.entidad.set(null);
    this.ubicacion.set(null); this.cedulaTabla.set('');
    this.recargar();
  }

  hayFiltros = computed(() => !!(this.empresa() || this.anio() || this.tramite() || this.entidad()));

  filtrarTabla(): void {
    this.paginaIdx.set(0);
    this.pedirTabla$.next();
  }

  paginar(e: { pagina: number; porPagina: number }): void {
    this.paginaIdx.set(e.pagina);
    this.porPagina.set(e.porPagina);
    this.pedirTabla$.next();
  }

  // ------------------------------------------------------------------ ficha y visor
  buscarPersona(cedula?: string | null): void {
    const c = (cedula ?? this.cedulaBuscada ?? '').replace(/\D/g, '');
    if (!c) return;
    this.cedulaBuscada = c;
    this.cargandoFicha.set(true);
    this.errorFicha.set(null);
    this.api.persona(c).subscribe({
      next: f => { this.ficha.set(f); this.cargandoFicha.set(false); },
      error: () => { this.errorFicha.set('No se pudo consultar la cédula.'); this.cargandoFicha.set(false); },
    });
  }

  cerrarFicha(): void { this.ficha.set(null); }

  ver(doc: DocumentoArchivo): void {
    this.dialog.open(VisorArchivoDialogComponent, {
      data: doc, width: 'min(1100px, 96vw)', maxWidth: '96vw', panelClass: 'visor-archivo-panel',
    });
  }

  /** Contrato sin certificado EPS del archivo entre 30 días antes y 90 después del ingreso. */
  contratoSinSoporte(f: FichaPersona, fechaIngreso: string | null, empresa: string | null): boolean {
    if (!fechaIngreso || fechaIngreso > `${FIN_ARCHIVO}-16` || fechaIngreso < '2023-07-01') return false;
    const ing = new Date(fechaIngreso).getTime();
    return !f.documentos.some(d => {
      if (d.empresa !== empresa || !(d.tramite ?? '').startsWith('EPS')) return false;
      const fd = d.fecha ?? (d.anio && d.mes ? `${d.anio}-${String(d.mes).padStart(2, '0')}-01` : null);
      if (!fd) return false;
      const dias = (new Date(fd).getTime() - ing) / 86_400_000;
      return dias >= -30 && dias <= 90;
    });
  }

  // ------------------------------------------------------------------ indicadores
  readonly kpis = computed(() => this.resumen()?.kpis ?? null);

  /** Cobertura EPS de los contratos con ingreso dentro del periodo del archivo (jul-2023 → sep-2026). */
  readonly coberturaGlobal = computed(() => {
    const filas = (this.resumen()?.cobertura ?? []).filter(c => c.periodo < FIN_ARCHIVO);
    const contratos = filas.reduce((s, c) => s + c.contratos, 0);
    const conEps = filas.reduce((s, c) => s + c.con_eps, 0);
    return { contratos, conEps, pct: contratos ? (100 * conEps) / contratos : null };
  });

  readonly contratosDespues = computed(() =>
    (this.resumen()?.cobertura ?? []).filter(c => c.periodo >= FIN_ARCHIVO).reduce((s, c) => s + c.contratos, 0));

  // ------------------------------------------------------------------ gráficas
  private readonly oscuro = typeof document !== 'undefined' && document.documentElement.dataset['theme'] === 'dark';
  private readonly paleta = this.oscuro ? SERIES_OSCURO : SERIES_CLARO;
  private readonly tinta = this.oscuro ? '#c3c2b7' : '#52514e';
  private readonly superficie = this.oscuro ? '#1a1a19' : '#fcfcfb';

  private colorEmpresa(e: string): string { return this.paleta[Math.max(0, ORDEN_EMPRESAS.indexOf(e))]; }
  private colorTramite(t: string): string {
    const i = ORDEN_TRAMITES.indexOf(t.replace('CAJA_EXTEMPORANEA', 'CAJA'));
    return i >= 0 ? this.paleta[i] : '#8a8984';
  }

  private ejeX(periodos: string[]) {
    return {
      type: 'category' as const, data: periodos.map(periodoCorto),
      axisLabel: { color: this.tinta, hideOverlap: true }, axisTick: { show: false },
    };
  }
  private ejeY(formato?: (v: number) => string) {
    return {
      type: 'value' as const,
      axisLabel: { color: this.tinta, formatter: formato ?? ((v: number) => v.toLocaleString('es-CO')) },
      splitLine: { lineStyle: { color: this.oscuro ? '#2a2a28' : '#ecebe7' } },
    };
  }

  /** Documentos por mes, apilados por empresa o por trámite. */
  readonly opcionSerie = computed<EChartsOption | null>(() => {
    const serie = this.resumen()?.serie_mensual ?? [];
    if (!serie.length) return null;
    const periodos = [...new Set(serie.map(p => p.periodo))].sort();
    const dim = this.dimSerie();
    const claves = dim === 'empresa'
      ? ORDEN_EMPRESAS.filter(e => serie.some(p => p.empresa === e))
      : ORDEN_TRAMITES.filter(t => serie.some(p => (p.tramite ?? '').replace('CAJA_EXTEMPORANEA', 'CAJA') === t));
    const series = claves.map(k => {
      const porPeriodo = new Map<string, number>();
      for (const p of serie) {
        const clave = dim === 'empresa' ? p.empresa : (p.tramite ?? '').replace('CAJA_EXTEMPORANEA', 'CAJA');
        if (clave === k) porPeriodo.set(p.periodo, (porPeriodo.get(p.periodo) ?? 0) + p.documentos);
      }
      return {
        name: dim === 'empresa' ? this.etiquetaEmpresa(k) : this.etiquetaTramite(k),
        type: 'bar' as const, stack: 'total', barMaxWidth: 22,
        itemStyle: { color: dim === 'empresa' ? this.colorEmpresa(k) : this.colorTramite(k), borderColor: this.superficie, borderWidth: 1 },
        emphasis: { focus: 'series' as const },
        data: periodos.map(p => porPeriodo.get(p) ?? 0),
      };
    });
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => Number(v).toLocaleString('es-CO') },
      legend: { top: 0, textStyle: { color: this.tinta } },
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      xAxis: this.ejeX(periodos), yAxis: this.ejeY(), series,
    };
  });

  /** % de contratos (por mes de ingreso) con certificado EPS en el archivo. Un solo eje: porcentaje. */
  readonly opcionCobertura = computed<EChartsOption | null>(() => {
    const cob = (this.resumen()?.cobertura ?? []);
    if (!cob.length) return null;
    const periodos = [...new Set(cob.map(c => c.periodo))].sort();
    const series = ORDEN_EMPRESAS.filter(e => cob.some(c => c.empresa === e)).map(e => {
      const m = new Map(cob.filter(c => c.empresa === e).map(c => [c.periodo, c]));
      return {
        name: this.etiquetaEmpresa(e), type: 'line' as const, smooth: false, symbolSize: 8, showSymbol: false,
        lineStyle: { width: 2, color: this.colorEmpresa(e) }, itemStyle: { color: this.colorEmpresa(e) },
        data: periodos.map(p => {
          const c = m.get(p);
          return c && c.contratos ? { value: Math.round((1000 * c.con_eps) / c.contratos) / 10, contratos: c.contratos, conEps: c.con_eps } : null;
        }),
        markArea: e === ORDEN_EMPRESAS[0] && periodos.includes(FIN_ARCHIVO) ? {
          silent: true, itemStyle: { color: this.oscuro ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' },
          label: { show: true, color: this.tinta, fontSize: 11, position: 'insideTop' as const, formatter: 'Después del backup' },
          data: [[{ xAxis: periodoCorto(FIN_ARCHIVO) }, { xAxis: periodoCorto(periodos[periodos.length - 1]) }]],
        } : undefined,
      };
    });
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (ps: any) => {
          const arr = Array.isArray(ps) ? ps : [ps];
          return `<strong>${arr[0]?.axisValueLabel ?? ''}</strong><br>` + arr.filter(p => p.data).map(p =>
            `${p.marker} ${p.seriesName}: <b>${p.data.value}%</b> · ${p.data.conEps.toLocaleString('es-CO')} de ${p.data.contratos.toLocaleString('es-CO')} contratos`).join('<br>');
        },
      },
      legend: { top: 0, textStyle: { color: this.tinta } },
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      // Los puntos llevan contratos/conEps para el tooltip: ECharts no los tipa, de ahí el cast.
      xAxis: this.ejeX(periodos), yAxis: { ...this.ejeY(v => `${v}%`), max: 100, min: 0 }, series: series as EChartsOption['series'],
    } as EChartsOption;
  });

  /** Contratos de la plataforma por mes de ingreso, hasta hoy (lo que el backup ya no cubre se ve aquí). */
  readonly opcionContratos = computed<EChartsOption | null>(() => {
    const cob = (this.resumen()?.cobertura ?? []);
    if (!cob.length) return null;
    const periodos = [...new Set(cob.map(c => c.periodo))].sort();
    const series = ORDEN_EMPRESAS.filter(e => cob.some(c => c.empresa === e)).map(e => {
      const m = new Map(cob.filter(c => c.empresa === e).map(c => [c.periodo, c.contratos]));
      return {
        name: this.etiquetaEmpresa(e), type: 'bar' as const, stack: 'contratos', barMaxWidth: 22,
        itemStyle: { color: this.colorEmpresa(e), borderColor: this.superficie, borderWidth: 1 },
        data: periodos.map(p => m.get(p) ?? 0),
      };
    });
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => Number(v).toLocaleString('es-CO') },
      legend: { top: 0, textStyle: { color: this.tinta } },
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      xAxis: this.ejeX(periodos), yAxis: this.ejeY(), series,
    };
  });

  private barrasHorizontales(filas: { clave: string; documentos: number }[], nombre: (c: string) => string,
                             color: (c: string) => string): EChartsOption | null {
    if (!filas.length) return null;
    const orden = [...filas].reverse();
    return {
      tooltip: { trigger: 'item', valueFormatter: v => Number(v).toLocaleString('es-CO') },
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...this.ejeY(), splitLine: { show: false }, axisLabel: { show: false } },
      yAxis: { type: 'category', data: orden.map(f => nombre(f.clave)), axisLabel: { color: this.tinta }, axisTick: { show: false } },
      series: [{
        type: 'bar', barMaxWidth: 18, name: 'Documentos',
        data: orden.map(f => ({ value: f.documentos, itemStyle: { color: color(f.clave), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: this.tinta, formatter: (p: any) => Number(p.value).toLocaleString('es-CO') },
      }],
    };
  }

  readonly opcionTramite = computed(() => this.barrasHorizontales(
    (this.resumen()?.por_tramite ?? []).filter(t => t.clave !== 'SIN_DATO'), c => this.etiquetaTramite(c), c => this.colorTramite(c)));

  readonly opcionEntidad = computed(() => this.barrasHorizontales(
    (this.resumen()?.por_entidad ?? []).slice(0, 12), c => c.replace(/_/g, ' '), () => this.paleta[0]));

  readonly opcionEstado = computed(() => this.barrasHorizontales(
    (this.resumen()?.por_estado ?? []).slice(0, 10), c => etiqueta(ETIQUETA_ESTADO, c), () => this.paleta[2]));

  /** Mapa de calor año × mes: magnitud en una sola tonalidad (claro → oscuro). */
  readonly opcionCalor = computed<EChartsOption | null>(() => {
    const serie = this.resumen()?.serie_mensual ?? [];
    if (!serie.length) return null;
    const celdas = new Map<string, number>();
    for (const p of serie) celdas.set(p.periodo, (celdas.get(p.periodo) ?? 0) + p.documentos);
    const anios = [...new Set([...celdas.keys()].map(k => k.slice(0, 4)))].sort();
    const datos = [...celdas.entries()].map(([k, v]) => [Number(k.slice(5, 7)) - 1, anios.indexOf(k.slice(0, 4)), v]);
    const max = Math.max(...datos.map(d => d[2] as number));
    return {
      tooltip: { formatter: (p: any) => `${MESES_CORTOS[p.data[0]]} ${anios[p.data[1]]}: <b>${Number(p.data[2]).toLocaleString('es-CO')}</b> documentos` },
      grid: { left: 8, right: 8, top: 8, bottom: 48, containLabel: true },
      xAxis: { type: 'category', data: MESES_CORTOS, axisLabel: { color: this.tinta }, axisTick: { show: false }, splitArea: { show: false } },
      yAxis: { type: 'category', data: anios, axisLabel: { color: this.tinta }, axisTick: { show: false } },
      visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 140,
                   inRange: { color: this.oscuro ? [...SECUENCIAL].reverse() : SECUENCIAL }, textStyle: { color: this.tinta } },
      series: [{ type: 'heatmap', data: datos, itemStyle: { borderColor: this.superficie, borderWidth: 2, borderRadius: 4 },
                 label: { show: false }, emphasis: { itemStyle: { borderColor: this.tinta } } }],
    };
  });

  readonly opcionDiaSemana = computed<EChartsOption | null>(() => {
    const d = this.resumen()?.por_dia_semana ?? [];
    if (!d.length) return null;
    const orden = [2, 3, 4, 5, 6, 7, 1];   // lunes primero
    const m = new Map(d.map(x => [x.dia_semana, x.documentos]));
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => Number(v).toLocaleString('es-CO') },
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: orden.map(i => DIAS[i].slice(0, 3)), axisLabel: { color: this.tinta }, axisTick: { show: false } },
      yAxis: this.ejeY(),
      series: [{ type: 'bar', name: 'Radicados', barMaxWidth: 28, data: orden.map(i => m.get(i) ?? 0),
                 itemStyle: { color: this.paleta[0], borderRadius: [4, 4, 0, 0] } }],
    };
  });

  // ------------------------------------------------------------------ tabla
  readonly idDocumento = (d: DocumentoArchivo) => d.id;

  readonly columnas: ColumnaTabla<DocumentoArchivo>[] = [
    { id: 'fecha', header: 'Fecha', valor: d => d.fecha ?? (d.anio && d.mes ? `${d.anio}-${String(d.mes).padStart(2, '0')}` : null), ancho: '110px', ordenable: false },
    { id: 'cedula', header: 'Cédula', valor: d => d.cedula, tarjeta: 'titulo', ordenable: false },
    { id: 'empresa', header: 'Empresa', valor: d => this.etiquetaEmpresa(d.empresa), ordenable: false },
    { id: 'tramite', header: 'Trámite', valor: d => this.etiquetaTramite(d.tramite), ordenable: false,
      badge: d => ({ texto: this.etiquetaTramite(d.tramite), tono: (d.tramite ?? '').includes('EXTEMP') ? 'warn' : 'info' }) },
    { id: 'entidad', header: 'Entidad', valor: d => d.entidad?.replace(/_/g, ' ') ?? '', prioridad: 2, ordenable: false },
    { id: 'estado', header: 'Estado', valor: d => d.estado ? etiqueta(ETIQUETA_ESTADO, d.estado) : '', prioridad: 3, ordenable: false },
    { id: 'ubicacion', header: 'Ubicación', valor: d => etiqueta(ETIQUETA_UBICACION, d.ubicacion), prioridad: 2, ordenable: false,
      badge: d => d.ubicacion === 'POR_REVISAR' ? { texto: 'Por revisar', tono: 'danger' }
               : d.ubicacion === 'DUPLICADO' ? { texto: 'Duplicado', tono: 'neutro' } : { texto: etiqueta(ETIQUETA_UBICACION, d.ubicacion), tono: 'ok' } },
    { id: 'tamano', header: 'Tamaño', valor: d => d.tamano_bytes, formato: d => `${(d.tamano_bytes / 1024).toFixed(0)} KB`, align: 'right', prioridad: 3, ordenable: false },
    { id: 'original', header: 'Ruta original', valor: d => d.ruta_original, prioridad: 3, ordenable: false, minAncho: '220px' },
  ];

  gb(bytes: number | null | undefined): string {
    return bytes ? `${(bytes / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 })} GB` : '—';
  }

  pct(a: number | null | undefined, b: number | null | undefined): string {
    return a && b ? `${((100 * a) / b).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%` : '—';
  }
}

/**
 * Submodulo "Informes de incapacidades" (reunion funcional 2026-09-07, lo que la senora Heidy
 * pide cada mes): estadisticas globales por tipo / mes / oficina / finca / EPS, licencias,
 * personas en 180 y 540 dias, recurrencia de incapacidades cortas y top de personas.
 *
 * Solo lectura. Las agregaciones las hace ms-hr; aqui se pintan (ngx-echarts) y se exportan a
 * Excel. Acceso restringido por permisos del menu (V107): solo ADMIN hasta que la senora Heidy
 * defina quien mas.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { forkJoin } from 'rxjs';
import * as XLSX from 'xlsx';

import { IncapacidadGestionService } from '../../services/incapacidad-gestion/incapacidad-gestion.service';
import {
  FilaRecurrencia,
  FilaTopPersona,
  FiltrosInforme,
  GrupoEmpresa,
  InformeGlobal,
  InformeRecurrencia,
  InformeTop,
  SerieInforme,
} from '../../models/incapacidad-gestion.model';
import { DialogoInformeUmbralComponent } from '../consulta-incapacidades/dialogos/dialogo-informe-umbral/dialogo-informe-umbral.component';

/** Paleta categorica fija (misma familia que la analitica de nomina; CVD-safe en claro). */
export const PALETA_INFORMES: readonly string[] = [
  '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1', '#E53935', '#5E35B1', '#7CB342', '#F4511E', '#3949AB',
];

/** Color fijo por tipo de incapacidad: el mismo en el pastel y en las barras por mes. */
export const COLOR_TIPO: Readonly<Record<string, string>> = {
  ENFERMEDAD_GENERAL: '#1E88E5',
  ACCIDENTE_TRABAJO: '#E53935',
  ENFERMEDAD_LABORAL: '#F4511E',
  ACCIDENTE_TRANSITO: '#FB8C00',
  LICENCIA_MATERNIDAD: '#8E24AA',
  LICENCIA_PATERNIDAD: '#5E35B1',
};

/** Primer dia del anio en curso, en ISO corto (default del rango). */
export function inicioDeAnio(hoy = new Date()): string {
  return `${hoy.getFullYear()}-01-01`;
}

export function hoyIso(hoy = new Date()): string {
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${m}-${d}`;
}

@Component({
  selector: 'app-informes-incapacidades',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTabsModule,
    MatTooltipModule,
    NgxEchartsDirective,
  ],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  templateUrl: './informes-incapacidades.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './informes-incapacidades.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InformesIncapacidadesComponent implements OnInit {
  private readonly srv = inject(IncapacidadGestionService);
  private readonly dialogo = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  // ── Filtros ───────────────────────────────────────────────────────────
  desde = inicioDeAnio();
  hasta = hoyIso();
  grupo: GrupoEmpresa | '' = '';
  /** Umbral de "corta" y minimo de eventos del informe de recurrencia. */
  maxDias = 2;
  minEventos = 2;

  readonly tab = signal(0);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly global = signal<InformeGlobal | null>(null);
  readonly recurrencia = signal<InformeRecurrencia | null>(null);
  readonly top = signal<InformeTop | null>(null);

  readonly rutaSst = '/dashboard/disabilities/sst';
  readonly rutaAlertas = '/dashboard/disabilities/alertas';

  ngOnInit(): void {
    this.cargar();
  }

  filtros(): FiltrosInforme {
    return { desde: this.desde, hasta: this.hasta, grupo: this.grupo };
  }

  cargar(): void {
    if (this.desde && this.hasta && this.desde > this.hasta) {
      this.error.set('La fecha inicial no puede ser posterior a la final.');
      return;
    }
    this.cargando.set(true);
    this.error.set('');
    forkJoin({
      global: this.srv.informeGlobal(this.filtros()),
      recurrencia: this.srv.informeRecurrencia(this.filtros(), this.maxDias, this.minEventos),
      top: this.srv.informeTop(this.filtros(), 25),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ global, recurrencia, top }) => {
          this.global.set(global);
          this.recurrencia.set(recurrencia);
          this.top.set(top);
          this.cargando.set(false);
        },
        error: (e: unknown) => {
          this.cargando.set(false);
          this.error.set(mensajeDeError(e, 'No se pudo cargar el informe.'));
        },
      });
  }

  abrirInformeUmbral(): void {
    this.dialogo.open(DialogoInformeUmbralComponent, {
      width: '1000px',
      maxWidth: '95vw',
      maxHeight: '92vh',
      autoFocus: false,
      panelClass: 'disab-dialogo',
    });
  }

  // ── Graficas ──────────────────────────────────────────────────────────

  readonly opcionPorTipo = computed<EChartsOption>(() => pastel(this.global()?.porTipo ?? [], (s) => COLOR_TIPO[s.clave]));
  readonly opcionPorEps = computed<EChartsOption>(() => pastel(top(this.global()?.porEps ?? [], 8)));
  readonly opcionPorResponsable = computed<EChartsOption>(() => pastel(this.global()?.porResponsablePago ?? []));
  readonly opcionPorOficina = computed<EChartsOption>(() => barras(this.global()?.porOficina ?? [], '#1E88E5'));
  readonly opcionPorEmpresa = computed<EChartsOption>(() => barras(top(this.global()?.porEmpresa ?? [], 15), '#00ACC1'));
  readonly opcionPorCentroCosto = computed<EChartsOption>(() => barras(top(this.global()?.porCentroCosto ?? [], 15), '#43A047'));

  /** Serie mensual apilada por tipo (mismo color por tipo que el pastel). */
  readonly opcionPorMes = computed<EChartsOption>(() => {
    const meses = this.global()?.porMes ?? [];
    const tipos = new Map<string, string>();
    for (const m of meses) for (const s of m.porTipo) tipos.set(s.clave, s.etiqueta);
    const series = [...tipos.entries()].map(([clave, etiqueta]) => ({
      name: etiqueta,
      type: 'bar' as const,
      stack: 'total',
      emphasis: { focus: 'series' as const },
      itemStyle: { color: COLOR_TIPO[clave] },
      data: meses.map((m) => m.porTipo.find((s) => s.clave === clave)?.cantidad ?? 0),
    }));
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, type: 'scroll' },
      grid: { left: 40, right: 16, top: 24, bottom: 48 },
      xAxis: { type: 'category', data: meses.map((m) => m.etiqueta) },
      yAxis: { type: 'value', minInterval: 1 },
      series,
    };
  });

  // ── Exportar ──────────────────────────────────────────────────────────

  exportarGlobal(): void {
    const g = this.global();
    if (!g) return;
    const libro = XLSX.utils.book_new();
    const hoja = (nombre: string, filas: SerieInforme[]) => {
      const datos = filas.map((s) => ({ Concepto: s.etiqueta, Incapacidades: s.cantidad, Dias: s.dias }));
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(datos), nombre);
    };
    XLSX.utils.book_append_sheet(
      libro,
      XLSX.utils.json_to_sheet([
        { Indicador: 'Desde', Valor: g.desde },
        { Indicador: 'Hasta', Valor: g.hasta },
        { Indicador: 'Empleador', Valor: g.grupo ?? 'Todos' },
        { Indicador: 'Incapacidades', Valor: g.total },
        { Indicador: 'Dias', Valor: g.totalDias },
        { Indicador: 'Personas', Valor: g.personas },
        { Indicador: 'Licencias de maternidad', Valor: g.licenciasMaternidad },
        { Indicador: 'Licencias de paternidad', Valor: g.licenciasPaternidad },
        { Indicador: 'ARL sin investigacion', Valor: g.arl.sinInvestigacion },
        { Indicador: 'ARL investigacion vencida', Valor: g.arl.vencidas },
        { Indicador: 'Personas que superan 180 dias', Valor: g.umbral180 },
        { Indicador: 'Personas proximas a 180 dias', Valor: g.proximas180 },
        { Indicador: 'Personas que superan 540 dias', Valor: g.umbral540 },
      ]),
      'Resumen',
    );
    hoja('Por tipo', g.porTipo);
    XLSX.utils.book_append_sheet(
      libro,
      XLSX.utils.json_to_sheet(g.porMes.map((m) => ({
        Mes: m.etiqueta, Incapacidades: m.total, Dias: m.dias,
        ...Object.fromEntries(m.porTipo.map((s) => [s.etiqueta, s.cantidad])),
      }))),
      'Por mes',
    );
    hoja('Por oficina', g.porOficina);
    hoja('Por finca', g.porEmpresa);
    hoja('Por centro de costo', g.porCentroCosto);
    hoja('Por EPS', g.porEps);
    hoja('Por responsable', g.porResponsablePago);
    XLSX.writeFile(libro, `informe_incapacidades_${g.desde}_${g.hasta}.xlsx`);
  }

  exportarRecurrencia(): void {
    const r = this.recurrencia();
    if (!r) return;
    const datos = r.filas.map((f) => ({
      Cedula: f.cedula, Nombre: f.nombreCompleto, Empresa: f.empresa ?? '', 'Centro de costo': f.centroCosto ?? '',
      Oficina: f.oficina ?? '', EPS: f.eps ?? '', Mes: f.mesEtiqueta, Eventos: f.eventos, Dias: f.dias,
      Diagnosticos: f.diagnosticos.join(', '), IPS: f.ips.join(', '), Fechas: f.fechas.join(' | '),
    }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(datos), 'Recurrencia');
    XLSX.writeFile(libro, `recurrencia_incapacidades_${r.desde}_${r.hasta}.xlsx`);
  }

  exportarTop(): void {
    const t = this.top();
    if (!t) return;
    const datos = t.filas.map((f, i) => ({
      Puesto: i + 1, Cedula: f.cedula, Nombre: f.nombreCompleto, Empresa: f.empresa ?? '', Oficina: f.oficina ?? '',
      Incapacidades: f.eventos, Dias: f.dias,
    }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(datos), 'Top personas');
    XLSX.writeFile(libro, `top_incapacidades_${t.desde}_${t.hasta}.xlsx`);
  }

  trackRec(_: number, f: FilaRecurrencia): string { return `${f.cedula}-${f.anio}-${f.mes}`; }
  trackTop(_: number, f: FilaTopPersona): string { return f.cedula; }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers puros (probados en el spec)
// ─────────────────────────────────────────────────────────────────────────

/** Las N mayores; el resto se suma en "Otros" para que el grafico no se llene de rebanadas. */
export function top(series: SerieInforme[], n: number): SerieInforme[] {
  if (series.length <= n) return series;
  const ordenadas = [...series].sort((a, b) => b.cantidad - a.cantidad);
  const cabeza = ordenadas.slice(0, n);
  const resto = ordenadas.slice(n);
  cabeza.push({
    clave: 'OTROS',
    etiqueta: 'Otros',
    cantidad: resto.reduce((acc, s) => acc + s.cantidad, 0),
    dias: resto.reduce((acc, s) => acc + s.dias, 0),
  });
  return cabeza;
}

export function pastel(series: SerieInforme[], color?: (s: SerieInforme) => string | undefined): EChartsOption {
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const x = p as { name: string; value: number; percent: number };
        return `${x.name}<br/><b>${x.value}</b> (${x.percent}%)`;
      },
    },
    legend: { bottom: 0, left: 'center', type: 'scroll' },
    color: [...PALETA_INFORMES],
    series: [
      {
        type: 'pie',
        radius: ['42%', '70%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
        labelLine: { show: false },
        data: series.map((s) => ({
          name: s.etiqueta,
          value: s.cantidad,
          ...(color?.(s) ? { itemStyle: { color: color(s) } } : {}),
        })),
      },
    ],
  };
}

export function barras(series: SerieInforme[], color: string): EChartsOption {
  const ordenadas = [...series].sort((a, b) => a.cantidad - b.cantidad);
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (p: unknown) => {
        const filas = p as { name: string; value: number; dataIndex: number }[];
        const s = ordenadas[filas[0]?.dataIndex ?? 0];
        return `${filas[0]?.name}<br/><b>${filas[0]?.value}</b> incapacidades · ${s?.dias ?? 0} dias`;
      },
    },
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: ordenadas.map((s) => s.etiqueta), axisLabel: { width: 150, overflow: 'truncate' } },
    series: [{ type: 'bar', data: ordenadas.map((s) => s.cantidad), itemStyle: { color, borderRadius: [0, 6, 6, 0] }, barMaxWidth: 22 }],
  };
}

export function mensajeDeError(e: unknown, porDefecto: string): string {
  const err = e as { error?: { error?: string; message?: string }; message?: string } | null;
  return err?.error?.error || err?.error?.message || porDefecto;
}

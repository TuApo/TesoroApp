import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

/** Tarjeta de KPI del panel. */
interface KpiTile {
  label: string;
  value: string;
  icon: string;
  color: string;
  accent: string;
  sub: string;
  /** Pinta la tarjeta en tono de alerta cuando el valor no es cero. */
  alerta?: boolean;
  tooltip?: string;
}

/** Fila del ranking "vacantes con más demora". */
interface FilaDemora {
  raw: any;
  cargo: string;
  finca: string;
  oficina: string;
  dias: number | null;
  req: number;
  falt: number;
  cumpl: number;
  candidatos: number;
  ingresoVencido: boolean;
}

const MS_DIA = 86_400_000;

/**
 * Panel de indicadores del módulo de Vacantes.
 *
 * NO pide datos: recibe las filas YA filtradas por la pantalla padre
 * (oficina, fechas, centro de costo…) y deriva todo en memoria, así el panel
 * y la tabla cuentan siempre lo mismo. La métrica central es la DEMORA:
 * días transcurridos desde que se publicó (= se pidió) la vacante y sigue
 * sin cubrirse.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-vacantes-dashboard',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule, MatButtonModule, NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  templateUrl: './vacantes-dashboard.component.html',
  styleUrl: './vacantes-dashboard.component.css',
})
export class VacantesDashboardComponent implements OnChanges {
  /** Filas visibles en la tabla (ya filtradas). */
  @Input() vacantes: any[] = [];
  /** Oficina activa; sólo se usa como rótulo del contexto. */
  @Input() oficina = '';
  @Input() loading = false;

  /** Abrir el detalle de cumplimiento de una vacante del ranking. */
  @Output() verVacante = new EventEmitter<any>();

  kpis: KpiTile[] = [];
  demoras: FilaDemora[] = [];

  antiguedadOpt: EChartsOption = {};
  embudoOpt: EChartsOption = {};
  centroCostoOpt: EChartsOption = {};
  oficinaOpt: EChartsOption = {};
  mensualOpt: EChartsOption = {};

  hayDatos = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['vacantes']) this.recalcular();
  }

  // ==================== Cálculo ====================
  private recalcular(): void {
    const rows = Array.isArray(this.vacantes) ? this.vacantes : [];
    this.hayDatos = rows.length > 0;

    this.construirKpis(rows);
    this.construirDemoras(rows);
    this.construirAntiguedad(rows);
    this.construirEmbudo(rows);
    this.construirCentroCosto(rows);
    this.construirOficina(rows);
    this.construirMensual(rows);
  }

  private construirKpis(rows: any[]): void {
    const req = this.suma(rows, r => this.req(r));
    const firm = this.suma(rows, r => this.firm(r));
    const falt = this.suma(rows, r => this.falt(r));
    const enTramite = this.suma(rows, r => this.entrev(r) + this.prueba(r) + this.auto(r) + this.exm(r));
    const postulados = this.suma(rows, r => this.candidatos(r));

    const activas = rows.filter(r => r.activo !== false).length;
    const inactivas = rows.length - activas;

    const abiertas = rows.filter(r => this.falt(r) > 0 && this.dias(r) !== null);
    const diasAbiertas = abiertas.map(r => this.dias(r) as number);
    const promedio = diasAbiertas.length
      ? Math.round(diasAbiertas.reduce((a, b) => a + b, 0) / diasAbiertas.length)
      : 0;

    const masDemorada = abiertas.reduce<any | null>(
      (peor, r) => (peor === null || (this.dias(r) as number) > (this.dias(peor) as number) ? r : peor),
      null,
    );

    const criticas = abiertas.filter(r => (this.dias(r) as number) > 30).length;
    const sinCandidatos = rows.filter(r => this.falt(r) > 0 && this.candidatos(r) === 0).length;
    const vencidas = rows.filter(r => this.falt(r) > 0 && this.ingresoVencido(r)).length;

    const cobertura = req ? Math.round((firm / req) * 100) : 0;
    const conversion = postulados ? Math.round((firm / postulados) * 100) : 0;

    this.kpis = [
      {
        label: 'Vacantes en la vista',
        value: this.num(rows.length),
        icon: 'work_outline',
        color: '#3b82f6',
        accent: 'rgba(59,130,246,.12)',
        sub: inactivas ? `${this.num(activas)} activas · ${this.num(inactivas)} inactivas` : `${this.num(activas)} activas`,
      },
      {
        label: 'Personas solicitadas',
        value: this.num(req),
        icon: 'groups',
        color: '#6366f1',
        accent: 'rgba(99,102,241,.12)',
        sub: `Promedio ${rows.length ? (req / rows.length).toFixed(1) : '0'} por vacante`,
      },
      {
        label: 'Cubiertas',
        value: this.num(firm),
        icon: 'how_to_reg',
        color: '#10b981',
        accent: 'rgba(16,185,129,.12)',
        sub: `${cobertura}% de cobertura`,
      },
      {
        label: 'Faltantes',
        value: this.num(falt),
        icon: 'person_search',
        color: '#f59e0b',
        accent: 'rgba(245,158,11,.12)',
        sub: `En ${this.num(rows.filter(r => this.falt(r) > 0).length)} vacantes`,
      },
      {
        label: 'Candidatos en trámite',
        value: this.num(enTramite),
        icon: 'autorenew',
        color: '#0ea5e9',
        accent: 'rgba(14,165,233,.12)',
        sub: `${this.num(postulados)} postulados · ${conversion}% firman`,
        tooltip: 'Entrevistados + prueba técnica + contratación inmediata + exámenes médicos',
      },
      {
        label: 'Demora promedio',
        value: `${this.num(promedio)} d`,
        icon: 'hourglass_bottom',
        color: promedio > 30 ? '#ef4444' : promedio > 15 ? '#f59e0b' : '#10b981',
        accent: promedio > 30 ? 'rgba(239,68,68,.12)' : promedio > 15 ? 'rgba(245,158,11,.12)' : 'rgba(16,185,129,.12)',
        sub: `${this.num(abiertas.length)} vacantes sin cubrir`,
        tooltip: 'Días promedio desde que se publicó la vacante, contando sólo las que aún tienen faltantes',
      },
      {
        label: 'Mayor demora',
        value: masDemorada ? `${this.num(this.dias(masDemorada) as number)} d` : '—',
        icon: 'priority_high',
        color: '#ef4444',
        accent: 'rgba(239,68,68,.12)',
        sub: masDemorada
          ? `${this.texto(masDemorada?.cargo) || 'Sin cargo'} · ${this.texto(masDemorada?.finca) || 'Sin centro'}`
          : 'Todo cubierto',
        alerta: !!masDemorada && (this.dias(masDemorada) as number) > 30,
        tooltip: masDemorada
          ? `${this.texto(masDemorada?.cargo)} · ${this.texto(masDemorada?.finca)} · publicada el ${this.texto(masDemorada?.fecha_publicado)}`
          : '',
      },
      {
        label: 'Críticas (+30 días)',
        value: this.num(criticas),
        icon: 'local_fire_department',
        color: '#dc2626',
        accent: 'rgba(220,38,38,.12)',
        sub: 'Abiertas hace más de un mes',
        alerta: criticas > 0,
      },
      {
        label: 'Sin candidatos',
        value: this.num(sinCandidatos),
        icon: 'person_off',
        color: '#8b5cf6',
        accent: 'rgba(139,92,246,.12)',
        sub: 'Faltan personas y no hay postulados',
        alerta: sinCandidatos > 0,
      },
      {
        label: 'Ingreso vencido',
        value: this.num(vencidas),
        icon: 'event_busy',
        color: '#e11d48',
        accent: 'rgba(225,29,72,.12)',
        sub: 'Pasó la fecha de ingreso y falta gente',
        alerta: vencidas > 0,
      },
    ];
  }

  private construirDemoras(rows: any[]): void {
    const conFaltantes = rows.filter(r => this.falt(r) > 0);
    const base = conFaltantes.length ? conFaltantes : rows;

    this.demoras = base
      .map(r => ({
        raw: r,
        cargo: this.texto(r?.cargo) || 'Sin cargo',
        finca: this.texto(r?.finca) || '—',
        oficina: this.oficinasDe(r).join(', ') || 'Sin oficina',
        dias: this.dias(r),
        req: this.req(r),
        falt: this.falt(r),
        cumpl: this.cumpl(r),
        candidatos: this.candidatos(r),
        ingresoVencido: this.ingresoVencido(r),
      }))
      .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))
      .slice(0, 10);
  }

  private construirAntiguedad(rows: any[]): void {
    const rangos = [
      { label: '0 a 7 d', min: 0, max: 7, color: '#10b981' },
      { label: '8 a 15 d', min: 8, max: 15, color: '#84cc16' },
      { label: '16 a 30 d', min: 16, max: 30, color: '#f59e0b' },
      { label: '31 a 60 d', min: 31, max: 60, color: '#f97316' },
      { label: 'Más de 60 d', min: 61, max: Number.POSITIVE_INFINITY, color: '#ef4444' },
    ];

    const abiertas = rows.filter(r => this.falt(r) > 0 && this.dias(r) !== null);
    const vacantes = rangos.map(g => abiertas.filter(r => {
      const d = this.dias(r) as number;
      return d >= g.min && d <= g.max;
    }));

    if (!abiertas.length) { this.antiguedadOpt = {}; return; }

    this.antiguedadOpt = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const i = p?.dataIndex ?? 0;
          const personas = vacantes[i].reduce((a, r) => a + this.falt(r), 0);
          return `<b>${p?.name}</b><br/>${p?.value} vacante(s)<br/>${personas} persona(s) por cubrir`;
        },
      },
      grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: rangos.map(g => g.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, color: '#475569' },
      },
      series: [{
        type: 'bar',
        barMaxWidth: 26,
        data: rangos.map((g, i) => ({
          value: vacantes[i].length,
          itemStyle: { color: g.color, borderRadius: [0, 4, 4, 0] },
        })),
        label: { show: true, position: 'right', formatter: '{c}', fontSize: 11, fontWeight: 'bold', color: '#334155' },
      }],
    };
  }

  private construirEmbudo(rows: any[]): void {
    const etapas: Array<{ label: string; valor: number; color: string }> = [
      { label: 'Solicitados', valor: this.suma(rows, r => this.req(r)), color: '#1e3a8a' },
      { label: 'Postulados', valor: this.suma(rows, r => this.candidatos(r)), color: '#2563eb' },
      { label: 'Entrevistados', valor: this.suma(rows, r => this.entrev(r)), color: '#3b82f6' },
      { label: 'Prueba técnica', valor: this.suma(rows, r => this.prueba(r)), color: '#8b5cf6' },
      { label: 'Contratación inmediata', valor: this.suma(rows, r => this.auto(r)), color: '#a855f7' },
      { label: 'Exámenes médicos', valor: this.suma(rows, r => this.exm(r)), color: '#f59e0b' },
      { label: 'Firmados', valor: this.suma(rows, r => this.firm(r)), color: '#10b981' },
      { label: 'Ingresados', valor: this.suma(rows, r => this.ing(r)), color: '#059669' },
    ];

    if (!etapas.some(e => e.valor > 0)) { this.embudoOpt = {}; return; }

    this.embudoOpt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 32, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: etapas.map(e => e.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, color: '#475569' },
      },
      series: [{
        type: 'bar',
        barMaxWidth: 22,
        data: etapas.map(e => ({ value: e.valor, itemStyle: { color: e.color, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', formatter: '{c}', fontSize: 11, fontWeight: 'bold', color: '#334155' },
      }],
    };
  }

  private construirCentroCosto(rows: any[]): void {
    const mapa = new Map<string, { firm: number; falt: number; req: number }>();
    for (const r of rows) {
      const clave = this.texto(r?.finca) || 'Sin centro de costo';
      const acc = mapa.get(clave) ?? { firm: 0, falt: 0, req: 0 };
      acc.firm += this.firm(r);
      acc.falt += this.falt(r);
      acc.req += this.req(r);
      mapa.set(clave, acc);
    }

    const top = [...mapa.entries()].sort((a, b) => b[1].req - a[1].req).slice(0, 10);
    if (!top.length) { this.centroCostoOpt = {}; return; }

    this.centroCostoOpt = this.barrasCobertura(
      top.map(([nombre]) => nombre),
      top.map(([, v]) => v.firm),
      top.map(([, v]) => v.falt),
    );
  }

  private construirOficina(rows: any[]): void {
    const mapa = new Map<string, { firm: number; falt: number; req: number }>();
    for (const r of rows) {
      const oficinas = this.oficinasDe(r);
      const claves = oficinas.length ? oficinas : ['Sin oficina'];
      for (const clave of claves) {
        const acc = mapa.get(clave) ?? { firm: 0, falt: 0, req: 0 };
        acc.firm += this.firm(r);
        acc.falt += this.falt(r);
        acc.req += this.req(r);
        mapa.set(clave, acc);
      }
    }

    const top = [...mapa.entries()].sort((a, b) => b[1].req - a[1].req).slice(0, 10);
    if (!top.length) { this.oficinaOpt = {}; return; }

    this.oficinaOpt = this.barrasCobertura(
      top.map(([nombre]) => nombre),
      top.map(([, v]) => v.firm),
      top.map(([, v]) => v.falt),
    );
  }

  /** Barras apiladas Cubiertas / Faltantes, que usan centro de costo y oficina. */
  private barrasCobertura(nombres: string[], firmados: number[], faltantes: number[]): EChartsOption {
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, data: ['Cubiertas', 'Faltantes'], textStyle: { fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 8, right: 12, top: 16, bottom: 58, containLabel: true },
      xAxis: {
        type: 'category',
        data: nombres,
        axisLabel: { rotate: 35, fontSize: 9, interval: 0, color: '#475569', width: 90, overflow: 'truncate' },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
        axisLine: { show: false },
        axisLabel: { fontSize: 10 },
      },
      series: [
        { name: 'Cubiertas', type: 'bar', stack: 'total', barMaxWidth: 38, itemStyle: { color: '#10b981' }, data: firmados },
        { name: 'Faltantes', type: 'bar', stack: 'total', barMaxWidth: 38, itemStyle: { color: '#f59e0b' }, data: faltantes },
      ],
    };
  }

  private construirMensual(rows: any[]): void {
    const porMes = new Map<string, { vacantes: number; personas: number }>();
    for (const r of rows) {
      const f = this.fecha(r?.fecha_publicado);
      if (!f) continue;
      const clave = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
      const acc = porMes.get(clave) ?? { vacantes: 0, personas: 0 };
      acc.vacantes += 1;
      acc.personas += this.req(r);
      porMes.set(clave, acc);
    }

    const meses = [...porMes.keys()].sort().slice(-12);
    if (!meses.length) { this.mensualOpt = {}; return; }

    const etiquetas = meses.map(m => {
      const [y, mo] = m.split('-');
      return new Date(+y, +mo - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
    });

    this.mensualOpt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, data: ['Vacantes', 'Personas solicitadas'], textStyle: { fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 8, right: 12, top: 16, bottom: 44, containLabel: true },
      xAxis: {
        type: 'category',
        data: etiquetas,
        axisLabel: { fontSize: 10, color: '#475569' },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
        axisLine: { show: false },
        axisLabel: { fontSize: 10 },
      },
      series: [
        {
          name: 'Vacantes',
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] },
          data: meses.map(m => porMes.get(m)?.vacantes ?? 0),
        },
        {
          name: 'Personas solicitadas',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
          data: meses.map(m => porMes.get(m)?.personas ?? 0),
        },
      ],
    };
  }

  // ==================== Helpers de plantilla ====================
  clasePorDias(dias: number | null): string {
    if (dias === null) return 'dias-pill';
    if (dias > 30) return 'dias-pill dias-critico';
    if (dias > 15) return 'dias-pill dias-alerta';
    return 'dias-pill dias-ok';
  }

  claseCumpl(pct: number): string {
    if (pct >= 100) return 'mini-pill pill-ok';
    if (pct >= 70) return 'mini-pill pill-warn';
    return 'mini-pill pill-error';
  }

  abrir(fila: FilaDemora): void {
    this.verVacante.emit(fila.raw);
  }

  tieneOpciones(opt: EChartsOption): boolean {
    return !!(opt as any)?.series?.length;
  }

  // ==================== Utilidades ====================
  private suma(rows: any[], fn: (r: any) => number): number {
    return rows.reduce((acc, r) => acc + (Number(fn(r)) || 0), 0);
  }

  private ce(v: any): any {
    return v?.conteo_estados ?? {};
  }

  private req(v: any): number { return Number(v?.req ?? v?.personas_solicitadas) || 0; }
  private entrev(v: any): number { return Number(v?.entrev ?? this.ce(v).entrevistado) || 0; }
  private prueba(v: any): number { return Number(v?.prueba ?? this.ce(v).prueba_tecnica) || 0; }
  private auto(v: any): number { return Number(v?.auto ?? this.ce(v).autorizado) || 0; }
  private exm(v: any): number { return Number(v?.exm ?? this.ce(v).examenes_medicos) || 0; }
  private firm(v: any): number { return Number(v?.firm ?? this.ce(v).contratado) || 0; }
  private ing(v: any): number { return Number(v?.ing ?? this.ce(v).ingreso) || 0; }

  private falt(v: any): number {
    const explicit = v?.falt;
    if (explicit !== undefined && explicit !== null) return Math.max(0, Number(explicit) || 0);
    return Math.max(0, this.req(v) - this.firm(v));
  }

  private cumpl(v: any): number {
    const req = this.req(v);
    if (!req) return 0;
    return Math.max(0, Math.min(100, Math.round((this.firm(v) / req) * 100)));
  }

  /** Postulados con registro en el proceso (el `total` que devuelve ms-hr). */
  private candidatos(v: any): number {
    const ce = this.ce(v);
    const total = Number(ce.total ?? ce.total_con_su_ultimo_registro);
    if (Number.isFinite(total) && total > 0) return total;
    return this.entrev(v) + this.prueba(v) + this.auto(v) + this.exm(v) + this.firm(v) + this.ing(v);
  }

  /** Días transcurridos desde que se publicó (pidió) la vacante. */
  private dias(v: any): number | null {
    const f = this.fecha(v?.fecha_publicado);
    if (!f) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((hoy.getTime() - f.getTime()) / MS_DIA));
  }

  private ingresoVencido(v: any): boolean {
    const f = this.fecha(v?.fechadeIngreso ?? v?.fecha_de_ingreso);
    if (!f) return false;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return f.getTime() < hoy.getTime();
  }

  /** 'YYYY-MM-DD' se arma en local para que no se corra un día por UTC. */
  private fecha(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    const s = String(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  private oficinasDe(v: any): string[] {
    const arr = Array.isArray(v?.oficinas_que_contratan) ? v.oficinas_que_contratan : [];
    return arr
      .map((o: any) => this.texto(typeof o === 'string' ? o : o?.nombre))
      .filter((s: string) => !!s);
  }

  private texto(v: any): string {
    return String(v ?? '').trim();
  }

  private num(v: number): string {
    return new Intl.NumberFormat('es-CO').format(Number(v) || 0);
  }
}

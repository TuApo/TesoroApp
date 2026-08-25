import {
  Component, OnInit, ChangeDetectionStrategy,
  ChangeDetectorRef, inject, DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { HomeDashboardService } from '../../service/home-dashboard.service';

interface KpiTile {
  label: string;
  value: number;
  icon: string;
  color: string;
  accent: string;
  sublabel: string;
}

interface QuickLink {
  label: string;
  icon: string;
  route: string;
  color: string;
  desc: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-home-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    NgxEchartsDirective,
  ],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  templateUrl: './home-dashboard.component.html',
  styleUrls: ['./home-dashboard.component.css'],
})
export class HomeDashboardComponent implements OnInit {
  private utilityService = inject(UtilityServiceService);
  private dashService = inject(HomeDashboardService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  isAdmin = false;
  userSede = '';
  selectedSede = '';
  sedes: any[] = [];

  loading = true;
  kpis: KpiTile[] = [];

  quickLinks: QuickLink[] = [
    { label: 'Pipeline', icon: 'account_tree', route: '/dashboard/hiring/recruitment-pipeline', color: '#3b82f6', desc: 'Selección y contratación' },
    { label: 'Métricas', icon: 'bar_chart', route: '/dashboard/metricas', color: '#8b5cf6', desc: 'Dashboards analíticos' },
    { label: 'Afiliaciones', icon: 'people_alt', route: '/dashboard/afiliaciones', color: '#10b981', desc: 'Confirmación de ingresos' },
    { label: 'Vacantes', icon: 'work_outline', route: '/dashboard/vacancies', color: '#f59e0b', desc: 'Publicación de vacantes' },
    { label: 'Tesorería', icon: 'account_balance_wallet', route: '/dashboard/treasury/manage-workers', color: '#ec4899', desc: 'Gestión de pagos' },
    { label: 'Documentos', icon: 'folder_open', route: '/dashboard/document-management', color: '#64748b', desc: 'Gestión documental' },
    { label: 'Notificaciones', icon: 'notifications_active', route: '/dashboard/matder', color: '#0ea5e9', desc: 'Alertas y seguimiento' },
    { label: 'Audit Logs', icon: 'security', route: '/dashboard/audit-logs', color: '#dc2626', desc: 'Historial de cambios' },
  ];

  pipelineOpt: EChartsOption = {};
  oficinasOpt: EChartsOption = {};
  timelineOpt: EChartsOption = {};
  afiliOficinaOpt: EChartsOption = {};

  private readonly STAGE_COLORS: Record<string, string> = {
    'Entrevistado':  '#3b82f6',
    'Prueba/Auto':   '#8b5cf6',
    'Exámenes':      '#f59e0b',
    'Contratado':    '#10b981',
    'Ingresado':     '#059669',
    'Rechazado':     '#ef4444',
  };

  ngOnInit(): void {
    const user = this.utilityService.getUser();
    const rol = user?.rol?.nombre ?? '';
    this.isAdmin = rol === 'ADMIN' || rol === 'GERENCIA';
    this.userSede = user?.sede?.nombre ?? '';

    if (this.isAdmin) {
      this.dashService.loadSedes()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(sedes => { this.sedes = sedes; this.cdr.markForCheck(); });
    }

    this.loadAll();
  }

  onSedeChange(): void {
    this.loadAll();
  }

  private loadAll(): void {
    this.loading = true;
    this.cdr.markForCheck();
    const sede = this.isAdmin ? this.selectedSede : this.userSede;

    forkJoin({
      procesos:   this.dashService.loadProcesos().pipe(catchError(() => of([]))),
      vacantes:   this.dashService.loadVacantes().pipe(catchError(() => of({ activas: 0, total: 0 }))),
      resumen:    this.dashService.loadAfiliacionesResumen(sede || undefined).pipe(catchError(() => of(null))),
      timeline:   this.dashService.loadAfiliacionesTimeline(sede || undefined).pipe(catchError(() => of([]))),
    })
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(({ procesos, vacantes, resumen, timeline }) => {
      const filtered = sede
        ? procesos.filter((p: any) => (p.oficina_creacion || '').toUpperCase() === sede.toUpperCase())
        : procesos;

      this.buildKpis(filtered, vacantes, resumen);
      this.buildPipelineChart(filtered);
      this.buildOficinasChart(procesos);
      this.buildTimelineChart(timeline);
      this.buildAfiliOficinaChart(resumen);

      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  private stage(p: any): string {
    if (p.ingreso_at)                             return 'Ingresado';
    if (p.rechazado_at)                            return 'Rechazado';
    if (p.contratado_at)                           return 'Contratado';
    if (p.examenes_medicos_at)                     return 'Exámenes';
    if (p.autorizado_at || p.prueba_tecnica_at)    return 'Prueba/Auto';
    if (p.entrevistado_at)                         return 'Entrevistado';
    return 'Sin etapa';
  }

  private buildKpis(procesos: any[], vacantes: any, resumen: any): void {
    const ym = new Date().toISOString().slice(0, 7);
    const thisMonth = (d: string | null) => !!d && d.startsWith(ym);

    const enProceso       = procesos.filter(p => !p.rechazado_at && !p.ingreso_at).length;
    const contratados     = procesos.filter(p =>  p.contratado_at && !p.ingreso_at).length;
    const ingresosEsteMes = procesos.filter(p => thisMonth(p.ingreso_at)).length;
    const rechazados      = procesos.filter(p =>  p.rechazado_at).length;

    this.kpis = [
      { label: 'En Proceso',       value: enProceso,       icon: 'autorenew',           color: '#3b82f6', accent: 'rgba(59,130,246,0.12)',  sublabel: 'Sin ingresar' },
      { label: 'Contratados',      value: contratados,     icon: 'how_to_reg',           color: '#10b981', accent: 'rgba(16,185,129,0.12)',  sublabel: 'Pendientes de ingreso' },
      { label: 'Ingresos Mes',     value: ingresosEsteMes, icon: 'login',               color: '#059669', accent: 'rgba(5,150,105,0.12)',   sublabel: 'Este mes' },
      { label: 'Rechazados',       value: rechazados,      icon: 'cancel',              color: '#ef4444', accent: 'rgba(239,68,68,0.12)',   sublabel: 'Total en periodo' },
      { label: 'Vacantes Activas', value: vacantes?.activas ?? 0, icon: 'work',         color: '#f59e0b', accent: 'rgba(245,158,11,0.12)',  sublabel: `de ${vacantes?.total ?? 0} totales` },
      { label: 'Afil. Pendientes', value: resumen?.kpis?.totalPendientes ?? 0, icon: 'pending_actions', color: '#8b5cf6', accent: 'rgba(139,92,246,0.12)', sublabel: `${resumen?.kpis?.totalIngresos ?? 0} ingresos este mes` },
    ];
  }

  private buildPipelineChart(procesos: any[]): void {
    const stages  = ['Entrevistado', 'Prueba/Auto', 'Exámenes', 'Contratado', 'Ingresado', 'Rechazado'];
    const counts: Record<string, number> = {};
    stages.forEach(s => counts[s] = 0);
    procesos.forEach(p => { const s = this.stage(p); if (counts[s] !== undefined) counts[s]++; });

    this.pipelineOpt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'category', data: stages, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 11, color: '#475569' } },
      series: [{
        type: 'bar',
        barMaxWidth: 28,
        data: stages.map(s => ({ value: counts[s], itemStyle: { color: this.STAGE_COLORS[s] || '#94a3b8', borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', formatter: '{c}', fontSize: 11, fontWeight: 'bold', color: '#334155' },
      }],
    };
  }

  private buildOficinasChart(procesos: any[]): void {
    const stages = ['Entrevistado', 'Prueba/Auto', 'Exámenes', 'Contratado', 'Ingresado'];
    const ofMap: Record<string, Record<string, number>> = {};

    procesos.filter(p => !p.rechazado_at).forEach(p => {
      const ofi = p.oficina_creacion || 'Sin Oficina';
      if (!ofMap[ofi]) { ofMap[ofi] = {}; stages.forEach(s => ofMap[ofi][s] = 0); }
      const s = this.stage(p);
      if (stages.includes(s)) ofMap[ofi][s]++;
    });

    const top = Object.entries(ofMap)
      .map(([name, c]) => ({ name, total: Object.values(c).reduce((a, b) => a + b, 0), c }))
      .sort((a, b) => b.total - a.total).slice(0, 8);

    const stageColors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#059669'];

    this.oficinasOpt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, data: stages, textStyle: { fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 10, right: 10, top: 10, bottom: 55, containLabel: true },
      xAxis: { type: 'category', data: top.map(o => o.name), axisLabel: { rotate: 35, fontSize: 9, interval: 0, color: '#475569' }, axisLine: { lineStyle: { color: '#e2e8f0' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, axisLine: { show: false } },
      series: stages.map((stage, i) => ({
        name: stage, type: 'bar', stack: 'total', barMaxWidth: 40,
        itemStyle: { color: stageColors[i] },
        data: top.map(o => o.c[stage] || 0),
      })),
    };
  }

  private buildTimelineChart(timeline: any[]): void {
    if (!timeline?.length) { this.timelineOpt = {}; return; }

    const byMonth: Record<string, number> = {};
    timeline.forEach((p: any) => {
      const m = (p.fecha || '').substring(0, 7);
      if (m) byMonth[m] = (byMonth[m] || 0) + (p.total || 0);
    });

    const months = Object.keys(byMonth).sort().slice(-14);
    const labels = months.map(m => {
      const [y, mo] = m.split('-');
      const d = new Date(+y, +mo - 1, 1);
      return d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
    });

    this.timelineOpt = {
      tooltip: { trigger: 'axis' },
      grid: { left: 10, right: 20, top: 20, bottom: 30, containLabel: true },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { fontSize: 10, color: '#475569' }, axisLine: { lineStyle: { color: '#e2e8f0' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, axisLine: { show: false }, axisLabel: { fontSize: 10 } },
      series: [{
        name: 'Ingresos',
        type: 'line',
        smooth: true,
        data: months.map(m => byMonth[m] || 0),
        lineStyle: { width: 2, color: '#10b981' },
        itemStyle: { color: '#10b981' },
        areaStyle: { color: 'rgba(16,185,129,0.08)' },
        symbol: 'circle', symbolSize: 5,
      }],
    };
  }

  private buildAfiliOficinaChart(resumen: any): void {
    const porOficina: any[] = resumen?.porOficina || [];
    if (!porOficina.length) { this.afiliOficinaOpt = {}; return; }

    const top = [...porOficina].sort((a, b) => b.total - a.total).slice(0, 8);

    this.afiliOficinaOpt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, data: ['Confirmados', 'Pendientes'], textStyle: { fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 10, right: 10, top: 10, bottom: 55, containLabel: true },
      xAxis: { type: 'category', data: top.map(o => o.clave || o.oficina || '?'), axisLabel: { rotate: 35, fontSize: 9, interval: 0, color: '#475569' }, axisLine: { lineStyle: { color: '#e2e8f0' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, axisLine: { show: false } },
      series: [
        { name: 'Confirmados', type: 'bar', stack: 'total', itemStyle: { color: '#10b981' }, data: top.map(o => o.contratados || 0) },
        { name: 'Pendientes',  type: 'bar', stack: 'total', itemStyle: { color: '#f59e0b' }, data: top.map(o => o.pendientes  || 0) },
      ],
    };
  }
}

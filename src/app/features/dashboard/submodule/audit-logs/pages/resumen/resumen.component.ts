import {
  Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, inject, DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ResumenDashboardService } from './resumen-dashboard.service';

function isoDate(d: Date) { return d.toISOString().split('T')[0]; }
function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }

@Component({
  selector: 'app-resumen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, RouterLink, FormsModule,
    MatIconModule, MatSelectModule, MatButtonModule,
    MatTooltipModule, MatProgressSpinnerModule, MatCardModule, MatChipsModule,
    NgxEchartsDirective,
  ],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  templateUrl: './resumen.component.html',
  styleUrl: './resumen.component.css',
})
export class ResumenComponent implements OnInit {
  private svc = inject(ResumenDashboardService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  // Filtros globales
  desde = isoDate(firstOfMonth(new Date()));
  hasta = isoDate(new Date());
  selectedOficina = '';
  sedes: any[] = [];

  // Estado de carga
  loading = false;

  // Datos por sección
  auditStats: any = null;
  contratacion: any = null;
  afiliaciones: any = null;
  tesStats: any = null;
  legalPorTipo: any[] = [];
  legalPorEstado: any[] = [];
  legalVencimientos: any[] = [];
  bugStats: any = null;

  // ECharts options
  pipelineOpt: EChartsOption = {};
  afilOficinaOpt: EChartsOption = {};
  legalOpt: EChartsOption = {};
  ticketOpt: EChartsOption = {};

  ngOnInit() {
    this.svc.getSedes().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(s => { this.sedes = s; this.cdr.markForCheck(); });
    this.cargar();
  }

  cargar() {
    this.loading = true;
    this.cdr.markForCheck();

    forkJoin({
      audit:      this.svc.getAuditStats(),
      contrat:    this.svc.getContratacionMetricas(this.desde, this.hasta),
      afilRes:    this.svc.getAfiliacionesResumen(this.desde, this.hasta, this.selectedOficina || undefined),
      afilTime:   this.svc.getAfiliacionesTimeline(this.desde, this.hasta, this.selectedOficina || undefined),
      tes:        this.svc.getTesoreriaStats(),
      legalTipo:  this.svc.getLegalPorTipo(),
      legalEst:   this.svc.getLegalPorEstado(),
      legalVenc:  this.svc.getLegalVencimientos(),
      bug:        this.svc.getBugStats(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(res => {
      this.auditStats    = res.audit;
      this.contratacion  = res.contrat;
      this.afiliaciones  = res.afilRes;
      this.tesStats      = res.tes;
      this.legalPorTipo  = res.legalTipo;
      this.legalPorEstado = res.legalEst;
      this.legalVencimientos = res.legalVenc;
      this.bugStats      = res.bug;

      this.buildPipelineChart();
      this.buildAfilChart(res.afilTime);
      this.buildLegalChart();
      this.buildTicketChart();

      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  // ─── CHART BUILDERS ───────────────────────────────────────────

  private buildPipelineChart() {
    const k = this.contratacion?.kpis;
    if (!k) { this.pipelineOpt = {}; return; }

    const stages = [
      { name: 'En espera',     v: k.total_espera      ?? k.totalEspera      ?? 0, color: '#94a3b8' },
      { name: 'Entrevistado',  v: k.entrevistado       ?? 0,                        color: '#60a5fa' },
      { name: 'Prueba técnica',v: k.prueba_tecnica     ?? k.pruebaTecnica    ?? 0, color: '#a78bfa' },
      { name: 'Autorizado',    v: k.autorizado         ?? 0,                        color: '#34d399' },
      { name: 'Exámenes',      v: k.examenes_medicos   ?? k.examenesMedicos  ?? 0, color: '#fbbf24' },
      { name: 'Contratados',   v: k.total_contratados  ?? k.totalContratados ?? 0, color: '#10b981' },
      { name: 'Rechazados',    v: k.total_rechazados   ?? k.totalRechazados  ?? 0, color: '#f87171' },
    ];

    this.pipelineOpt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 110, right: 20, top: 10, bottom: 10 },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#e2e8f0' } } },
      yAxis: { type: 'category', data: stages.map(s => s.name), axisLabel: { fontSize: 11 } },
      series: [{
        type: 'bar',
        data: stages.map(s => ({ value: s.v, itemStyle: { color: s.color, borderRadius: 4 } })),
        label: { show: true, position: 'right', formatter: '{c}', fontSize: 11 }
      }]
    };
  }

  private buildAfilChart(timeline: any[]) {
    const raw = this.afiliaciones?.por_oficina ?? this.afiliaciones?.porOficina ?? [];
    const items = [...raw].sort((a, b) => (b.count ?? b.total ?? 0) - (a.count ?? a.total ?? 0)).slice(0, 10);

    if (!items.length) { this.afilOficinaOpt = {}; return; }

    this.afilOficinaOpt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 100, right: 20, top: 10, bottom: 10 },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#e2e8f0' } } },
      yAxis: {
        type: 'category',
        data: items.map((i: any) => i.nombre ?? i.name ?? i.oficina ?? '?'),
        axisLabel: { fontSize: 11 }
      },
      series: [{
        type: 'bar',
        data: items.map((i: any) => ({
          value: i.count ?? i.total ?? i.cantidad ?? 0,
          itemStyle: { color: '#6366f1', borderRadius: 4 }
        })),
        label: { show: true, position: 'right', formatter: '{c}', fontSize: 11 }
      }]
    };
  }

  private buildLegalChart() {
    const data = this.legalPorTipo;
    if (!data?.length) { this.legalOpt = {}; return; }

    const COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899'];

    this.legalOpt = {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { orient: 'vertical', left: 0, top: 'center', textStyle: { fontSize: 11 } },
      series: [{
        type: 'pie',
        radius: ['45%', '72%'],
        center: ['65%', '50%'],
        data: data.map((d: any, i: number) => ({
          name: d.tipo ?? d.nombre ?? d.name ?? '?',
          value: d.total ?? d.count ?? d.cantidad ?? 0,
          itemStyle: { color: COLORS[i % COLORS.length] }
        })),
        label: { show: false },
        labelLine: { show: false },
      }]
    };
  }

  private buildTicketChart() {
    const b = this.bugStats;
    if (!b) { this.ticketOpt = {}; return; }

    const byPrio = b.por_prioridad ?? b.porPrioridad ?? {};
    const entries: [string, number][] = Object.entries(byPrio).map(([k, v]) => [k, Number(v)]);
    const COLORS: Record<string, string> = {
      CRITICA: '#ef4444', ALTA: '#f97316', MEDIA: '#f59e0b', BAJA: '#22c55e',
      critica: '#ef4444', alta: '#f97316', media: '#f59e0b', baja: '#22c55e',
    };

    if (!entries.length) { this.ticketOpt = {}; return; }

    this.ticketOpt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 60, right: 20, top: 10, bottom: 30 },
      xAxis: { type: 'category', data: entries.map(([k]) => k), axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#e2e8f0' } } },
      series: [{
        type: 'bar',
        data: entries.map(([k, v]) => ({
          value: v as number,
          itemStyle: { color: COLORS[k] ?? '#94a3b8', borderRadius: 4 }
        })),
        label: { show: true, position: 'top', fontSize: 11 }
      }]
    };
  }

  // ─── HELPERS ──────────────────────────────────────────────────

  get afilKpis() { return this.afiliaciones?.kpis ?? {}; }
  get contKpis() { return this.contratacion?.kpis ?? {}; }

  n(v: any) { return v != null ? Number(v) : 0; }

  currency(v: any) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(this.n(v));
  }

  formatDate(s: string) {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('es-CO');
  }

  get legalTotal() {
    return this.legalPorEstado.reduce((acc: number, e: any) => acc + this.n(e.total ?? e.count ?? 0), 0);
  }

  get bugCats(): {key: string; value: number}[] {
    const raw = this.bugStats?.por_categoria ?? this.bugStats?.porCategoria;
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw).map(([key, value]) => ({ key, value: Number(value) }));
  }

  ticketColor(estado: string): string {
    const m: Record<string, string> = {
      abierto: '#ef4444', en_progreso: '#f59e0b', enProgreso: '#f59e0b',
      resuelto: '#22c55e', cerrado: '#94a3b8'
    };
    return m[estado] ?? '#94a3b8';
  }

  ticketLabel(estado: string): string {
    const m: Record<string, string> = {
      abierto: 'Abiertos', en_progreso: 'En progreso', enProgreso: 'En progreso',
      resuelto: 'Resueltos', cerrado: 'Cerrados'
    };
    return m[estado] ?? estado;
  }
}

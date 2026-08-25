import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit } from '@angular/core';
import { SharedModule } from '../../../../../../shared/shared.module';
import { TicketsService, TicketEstadisticas, BugTicket } from '../../services/tickets.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-bug-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  templateUrl: './bug-dashboard.component.html',
  styleUrl: './bug-dashboard.component.css',
})
export class BugDashboardComponent implements OnInit {
  stats: TicketEstadisticas | null = null;
  loading = true;
  ticketsRecientes: any[] = [];
  ticketsCriticos: any[] = [];

  // Métricas calculadas
  tasaResolucion = 0;
  ticketsAbiertosHoy = 0;
  tiempoPromedioTexto = '';
  ticketsSinAsignar = 0;

  // Para gráfico donut de estados
  estadoSegmentos: { label: string; valor: number; color: string; porcentaje: number }[] = [];

  // Max value para barras
  maxCategoria = 1;
  maxSede = 1;

  constructor(
    private ticketsService: TicketsService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.cargarEstadisticas();
    this.cargarRecientes();
    this.cargarCriticos();
  }

  cargarEstadisticas(): void {
    this.ticketsService.obtenerEstadisticas().subscribe({
      next: (data) => {
        this.stats = data;
        this.calcularMetricas();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.stats = {
          total: 0, abiertos: 0, en_progreso: 0, resueltos: 0, cerrados: 0,
          por_categoria: {}, por_prioridad: {}, por_sede: {},
        };
        this.calcularMetricas();
        this.cdr.markForCheck();
      },
    });
  }

  calcularMetricas(): void {
    if (!this.stats) return;

    const total      = this.stats.total      || 0;
    const resueltos  = this.stats.resueltos  || 0;
    const cerrados   = this.stats.cerrados   || 0;
    const abiertos   = this.stats.abiertos   || 0;
    const en_progreso = this.stats.en_progreso || 0;
    this.tasaResolucion = total > 0 ? Math.round(((resueltos + cerrados) / total) * 100) : 0;

    // Segmentos para mini donut
    this.estadoSegmentos = [
      { label: 'Abiertos', valor: abiertos, color: '#f59e0b', porcentaje: total > 0 ? (abiertos / total) * 100 : 0 },
      { label: 'En Progreso', valor: en_progreso, color: '#8b5cf6', porcentaje: total > 0 ? (en_progreso / total) * 100 : 0 },
      { label: 'Resueltos', valor: resueltos, color: '#22c55e', porcentaje: total > 0 ? (resueltos / total) * 100 : 0 },
      { label: 'Cerrados', valor: cerrados, color: '#64748b', porcentaje: total > 0 ? (cerrados / total) * 100 : 0 },
    ].filter(s => s.valor > 0);

    // Max para barras proporcionales
    const catValues = this.stats.por_categoria ? Object.values(this.stats.por_categoria) : [];
    this.maxCategoria = catValues.length > 0 ? Math.max(...catValues) : 1;

    const sedeValues = this.stats.por_sede ? Object.values(this.stats.por_sede) : [];
    this.maxSede = sedeValues.length > 0 ? Math.max(...sedeValues) : 1;
  }

  cargarRecientes(): void {
    this.ticketsService.listarTickets({ limit: '8', ordering: '-fecha_reporte' }).subscribe({
      next: (data: any) => {
        const lista = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        this.ticketsRecientes = lista;

        // Calcular tickets sin asignar
        this.ticketsSinAsignar = lista.filter((t: any) => !t.asignado_a).length;
        this.cdr.markForCheck();
      },
      error: () => {
        this.ticketsRecientes = [];
        this.cdr.markForCheck();
      },
    });
  }

  cargarCriticos(): void {
    this.ticketsService.listarTickets({ prioridad: 'Crítica', estado: 'Abierto', ordering: '-fecha_reporte', limit: '5' }).subscribe({
      next: (data: any) => {
        this.ticketsCriticos = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.ticketsCriticos = [];
        this.cdr.markForCheck();
      },
    });
  }

  irATickets(): void {
    this.router.navigate(['/dashboard/bug-tickets/tickets']);
  }

  irATicketsFiltrado(filtro: string, valor: string): void {
    this.router.navigate(['/dashboard/bug-tickets/tickets'], { queryParams: { [filtro]: valor } });
  }

  getPrioridadClass(prioridad: string): string {
    return 'prioridad-' + (prioridad || 'media').toLowerCase();
  }

  getEstadoClass(estado: string): string {
    return 'estado-' + (estado || 'abierto').toLowerCase().replace(/\s+/g, '-');
  }

  getProgressPercent(): number {
    if (!this.stats || this.stats.total === 0) return 0;
    return Math.round(((this.stats.resueltos + this.stats.cerrados) / this.stats.total) * 100);
  }

  getCategoriaKeys(): string[] {
    return this.stats?.por_categoria ? Object.keys(this.stats.por_categoria) : [];
  }

  getPrioridadKeys(): string[] {
    return this.stats?.por_prioridad ? Object.keys(this.stats.por_prioridad) : [];
  }

  getSedeKeys(): string[] {
    return this.stats?.por_sede ? Object.keys(this.stats.por_sede) : [];
  }

  getConicGradient(): string {
    if (this.estadoSegmentos.length === 0) return 'conic-gradient(#e2e8f0 0% 100%)';
    let acum = 0;
    const stops: string[] = [];
    for (const seg of this.estadoSegmentos) {
      stops.push(`${seg.color} ${acum}% ${acum + seg.porcentaje}%`);
      acum += seg.porcentaje;
    }
    return `conic-gradient(${stops.join(', ')})`;
  }

  getTiempoRelativo(fecha: string): string {
    const diff = Date.now() - new Date(fecha).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `Hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Hace ${hrs}h`;
    const dias = Math.floor(hrs / 24);
    return `Hace ${dias}d`;
  }

  getPendientes(): number {
    if (!this.stats) return 0;
    return this.stats.abiertos + this.stats.en_progreso;
  }
}

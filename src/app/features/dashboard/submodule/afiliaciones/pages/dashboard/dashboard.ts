import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import {
  AfiliacionesDashboardService,
  BaseFecha,
  BASE_FECHA_LABEL
} from '../../services/afiliaciones-dashboard.service';
import { AfiliacionesFiltersBarComponent } from '../../components/filters/afiliaciones-filters-bar.component';
import { AfiliacionesKpiStripComponent } from '../../components/kpi-strip/afiliaciones-kpi-strip.component';
import { ContratacionesTableComponent } from '../../components/contrataciones-table/contrataciones-table.component';
import { ContratacionTimelineChartComponent, TimelineDimension } from '../../components/timeline-chart/contratacion-timeline-chart.component';
import { ChartCardComponent } from '../../../metricas/shared/components/chart-card/chart-card.component';
import { ResumenPorOficina, ResumenPorEmpresa } from '../../models/afiliaciones-dashboard.models';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-afiliaciones-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonToggleModule,
    AfiliacionesFiltersBarComponent,
    AfiliacionesKpiStripComponent,
    ContratacionesTableComponent,
    ContratacionTimelineChartComponent,
    ChartCardComponent
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class AfiliacionesDashboard {
  public service = inject(AfiliacionesDashboardService);

  // KPIs + resúmenes: ahora vienen AGREGADOS del backend (no de las 5.000 filas topadas).
  kpiSummary$ = this.service.kpiSummary$;
  resumenOficinas$ = this.service.resumenPorOficina$;
  resumenEmpresas$ = this.service.resumenPorEmpresa$;

  // Tabla consolidada, paginada server-side.
  tablePage$ = this.service.tablePage$;
  page$ = this.service.page$;
  baseFecha$ = this.service.baseFecha$;

  // Etiqueta del anclaje, para que los subtítulos digan por qué fecha está contando el tablero.
  baseFechaLabel$ = this.baseFecha$.pipe(map(b => BASE_FECHA_LABEL[b].toLowerCase()));

  // Catálogos para los selectores de filtro dinámicos.
  oficinas$ = this.service.oficinasDisponibles$;
  responsables$ = this.service.responsablesDisponibles$;

  // Estado de carga por bloque. Sustituye al `[loading]="false"` fijo que dejaba las
  // tarjetas indistinguibles entre "cargando" y "sin datos" durante toda la espera.
  cargandoResumen$ = this.service.cargandoResumen$;
  cargandoTabla$ = this.service.cargandoTabla$;
  cargandoTimelineResp$ = this.service.cargandoTimeline$('usuario_responsable');

  // Dimensión de la primera gráfica temporal: por oficina o por empresa.
  dim1$ = new BehaviorSubject<TimelineDimension>('oficina');

  // Granularidad de las gráficas: 'mes' (histórico) | 'dia' (usa el rango de arriba).
  gran$ = this.service.gran$;

  // Series temporales agregadas (una petición por dimensión, reactiva a los filtros).
  timelinePrincipal$ = this.dim1$.pipe(switchMap(dim => this.service.getTimeline(dim)));
  // La primera gráfica cambia de dimensión en caliente, así que su indicador de carga
  // tiene que seguir a dim1$ y no quedarse mirando la dimensión inicial.
  cargandoTimeline1$ = this.dim1$.pipe(switchMap(dim => this.service.cargandoTimeline$(dim)));
  timelineResponsable$ = this.service.getTimeline('usuario_responsable');

  setDim1(value: TimelineDimension) {
    this.dim1$.next(value);
  }

  setGran(value: 'mes' | 'dia') {
    this.service.updateGran(value);
  }

  onDateRangeChanged(range: { start: Date; end: Date }) {
    this.service.updateDateRange(range.start, range.end);
  }

  onSearchChanged(term: string) {
    this.service.updateSearch(term);
  }

  onEmpresaChanged(empresa: string) {
    this.service.updateEmpresa(empresa);
  }

  onOficinaChanged(oficina: string) {
    this.service.updateOficina(oficina);
  }

  onResponsableChanged(responsable: string) {
    this.service.updateResponsable(responsable);
  }

  onPageChange(e: { page: number; size: number }) {
    this.service.setPage(e.page, e.size);
  }

  onBaseFechaChanged(base: BaseFecha) {
    this.service.updateBaseFecha(base);
  }

  getMaxBar(items: ResumenPorOficina[] | ResumenPorEmpresa[]): number {
    if (!items || items.length === 0) return 1;
    return Math.max(...items.map(i => i.total));
  }
}

import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatderDashboardService } from '../../services/dashboard.service';
import { BoardIndicator, DashboardOverviewResponse, WorkspaceIndicator } from '../../models/dashboard.models';
import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

@Component({
  selector: 'app-analytics-page',
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatProgressBarModule, ...TABLA_ESTANDAR],
  templateUrl: './analytics-page.component.html',
  styleUrls: ['./analytics-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsPageComponent implements OnInit {
  data = signal<DashboardOverviewResponse | null>(null);
  loading = signal(true);

  /** Comparación de workspaces (tabla estándar). */
  readonly columnasWs: ColumnaTabla<WorkspaceIndicator>[] = [
    { id: 'name', header: 'Workspace', valor: (w) => w.name, tarjeta: 'titulo' },
    { id: 'boards', header: 'Boards', valor: (w) => w.board_count, align: 'right', tarjeta: 'meta' },
    { id: 'tasks', header: 'Tareas', valor: (w) => w.task_count, align: 'right', tarjeta: 'meta' },
    { id: 'overdue', header: 'Vencidas', valor: (w) => w.overdue_task_count, align: 'right', tarjeta: 'meta' },
    { id: 'progress', header: 'Progreso', valor: (w) => w.progress_percent, formato: (w) => `${w.progress_percent}%`,
      tarjeta: 'cuerpo', minAncho: '140px' },
  ];
  readonly idWs = (w: WorkspaceIndicator) => w.id;

  /** Rendimiento por tablero (tabla estándar). */
  readonly columnasBoards: ColumnaTabla<BoardIndicator>[] = [
    { id: 'name', header: 'Tablero', valor: (b) => b.name, tarjeta: 'titulo' },
    { id: 'ws', header: 'Workspace', valor: (b) => b.workspace_name, tarjeta: 'subtitulo' },
    { id: 'tasks', header: 'Tareas', valor: (b) => b.task_count, align: 'right', tarjeta: 'meta' },
    { id: 'overdue', header: 'Vencidas', valor: (b) => b.overdue_task_count, align: 'right', tarjeta: 'meta' },
    { id: 'unassigned', header: 'Sin asignar', valor: (b) => b.unassigned_task_count, align: 'right',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'progress', header: 'Progreso', valor: (b) => b.progress_percent, formato: (b) => `${b.progress_percent}%`,
      tarjeta: 'cuerpo', minAncho: '140px' },
  ];
  readonly idBoard = (b: BoardIndicator) => b.id;

  constructor(private ds: MatderDashboardService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.ds.getOverview());
    } catch { /* empty */ }
    finally { this.loading.set(false); }
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }
}

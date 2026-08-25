import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatderDashboardService } from '../../services/dashboard.service';
import { WorkspaceService } from '../../services/workspace.service';
import { MatderHistoryService, MatderHistoryItem } from '../../services/matder-history.service';
import { MatderMobileNavComponent } from '../../components/matder-mobile-nav/matder-mobile-nav.component';
import { DashboardOverviewResponse } from '../../models/dashboard.models';
import { WorkspaceResponse } from '../../models/workspace.models';

@Component({
  selector: 'app-matder-dashboard',
  standalone: true,
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule, MatderMobileNavComponent],
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatderDashboardPageComponent implements OnInit {
  loading = signal(true);
  overview = signal<DashboardOverviewResponse | null>(null);
  workspaces = signal<WorkspaceResponse[]>([]);
  recentItems = signal<MatderHistoryItem[]>([]);

  constructor(
    private dashboardService: MatderDashboardService,
    private workspaceService: WorkspaceService,
    private historyService: MatderHistoryService,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    this.recentItems.set(this.historyService.getRecent(6));
    try {
      const [ov, ws] = await Promise.all([
        this.dashboardService.getOverview(),
        this.workspaceService.list(),
      ]);
      this.overview.set(ov);
      this.workspaces.set(ws);
    } catch {
      // empty state
    } finally {
      this.loading.set(false);
    }
  }

  goRecent(item: MatderHistoryItem): void {
    if (item.type === 'board') {
      this.router.navigate([`/dashboard/matder/boards/${item.id}`]);
    } else {
      this.router.navigate([`/dashboard/matder/workspaces/${item.id}`]);
    }
  }

  recentIcon(item: MatderHistoryItem): string {
    return item.type === 'board' ? 'dashboard_customize' : 'workspaces';
  }

  timeAgo(iso: string): string {
    return this.historyService.timeAgo(iso);
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }
}

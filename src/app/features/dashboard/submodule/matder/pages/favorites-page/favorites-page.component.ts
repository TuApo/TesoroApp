import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatderDashboardService } from '../../services/dashboard.service';
import { BoardResponse } from '../../models/board.models';
import { WorkspaceResponse } from '../../models/workspace.models';
import Swal from 'sweetalert2';
import { MatderMobileNavComponent } from '../../components/matder-mobile-nav/matder-mobile-nav.component';

/**
 * Página de favoritos de MatDer.
 *
 * Muestra dos secciones:
 *   - Workspaces favoritos.
 *   - Tableros favoritos.
 *
 * Se nutre de ``/matder/favorites/workspaces/`` y ``/matder/favorites/boards/``,
 * reemplazando la implementación previa basada en localStorage (que solo
 * servía boards y dependía del navegador).
 */
@Component({
  selector: 'app-favorites-page',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule,
    MatTooltipModule, MatChipsModule,
    MatderMobileNavComponent
  
  
  ],
  templateUrl: './favorites-page.component.html',
  styleUrls: ['./favorites-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FavoritesPageComponent implements OnInit {
  workspaces = signal<WorkspaceResponse[]>([]);
  boards = signal<BoardResponse[]>([]);
  loading = signal(true);
  search = '';

  constructor(
    private dashboardService: MatderDashboardService,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  private async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      const [ws, bds] = await Promise.all([
        this.dashboardService.getFavoriteWorkspaces(),
        this.dashboardService.getFavoriteBoards(),
      ]);
      this.workspaces.set(ws as WorkspaceResponse[]);
      this.boards.set(bds as BoardResponse[]);
    } catch {
      this.workspaces.set([]);
      this.boards.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  get filteredWorkspaces(): WorkspaceResponse[] {
    if (!this.search) return this.workspaces();
    const q = this.search.toLowerCase();
    return this.workspaces().filter(w =>
      w.name.toLowerCase().includes(q) ||
      (w.description ?? '').toLowerCase().includes(q) ||
      (w.owner_name ?? '').toLowerCase().includes(q)
    );
  }

  get filteredBoards(): BoardResponse[] {
    if (!this.search) return this.boards();
    const q = this.search.toLowerCase();
    return this.boards().filter(b =>
      b.name.toLowerCase().includes(q) ||
      b.workspace_name.toLowerCase().includes(q) ||
      (b.description ?? '').toLowerCase().includes(q)
    );
  }

  /** Quita un workspace de favoritos. Actualiza la lista al vuelo. */
  async unfavoriteWorkspace(ws: WorkspaceResponse): Promise<void> {
    const before = this.workspaces();
    this.workspaces.set(before.filter(w => w.id !== ws.id));
    try {
      await this.dashboardService.toggleFavorite('WORKSPACE', ws.id);
    } catch {
      this.workspaces.set(before);
      Swal.fire('Error', 'No se pudo actualizar favorito.', 'error');
    }
  }

  async unfavoriteBoard(b: BoardResponse): Promise<void> {
    const before = this.boards();
    this.boards.set(before.filter(x => x.id !== b.id));
    try {
      await this.dashboardService.toggleFavorite('BOARD', b.id);
    } catch {
      this.boards.set(before);
      Swal.fire('Error', 'No se pudo actualizar favorito.', 'error');
    }
  }

  openWorkspace(ws: WorkspaceResponse): void {
    this.router.navigate([`/dashboard/matder/workspaces/${ws.id}`]);
  }

  openBoard(b: BoardResponse): void {
    this.router.navigate([`/dashboard/matder/boards/${b.id}`]);
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }

  roleLabel(r: string | null | undefined): string {
    if (!r) return '';
    const m: Record<string, string> = { OWNER: 'Owner', MANAGER: 'Manager', MEMBER: 'Miembro', VIEWER: 'Viewer' };
    return m[r] ?? r;
  }
}

import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { BoardService } from '../../services/board.service';
import { WorkspaceService } from '../../services/workspace.service';
import { MatderDashboardService } from '../../services/dashboard.service';
import { MatderHistoryService } from '../../services/matder-history.service';
import { MatderMobileNavComponent } from '../../components/matder-mobile-nav/matder-mobile-nav.component';
import { BoardResponse } from '../../models/board.models';
import { WorkspaceResponse } from '../../models/workspace.models';
import Swal from 'sweetalert2';

const ACCENT_COLORS = [
  '#1976d2', '#0097a7', '#388e3c', '#f57c00', '#d32f2f', '#7b1fa2', '#455a64', '#c2185b',
];

@Component({
  selector: 'app-boards-page',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule, MatderMobileNavComponent,
    MatTooltipModule, MatChipsModule,
  ],
  templateUrl: './boards-page.component.html',
  styleUrls: ['./boards-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardsPageComponent implements OnInit {
  boards = signal<BoardResponse[]>([]);
  workspaces = signal<WorkspaceResponse[]>([]);
  loading = signal(true);
  search = '';
  wsFilter: number | null = null;
  onlyFavorites = false;

  // Create board
  showForm = signal(false);
  formName = '';
  formDesc = '';
  formWs: number | null = null;
  formAccent = '#1976d2';
  accentColors = ACCENT_COLORS;
  saving = false;

  constructor(
    private boardService: BoardService,
    private wsService: WorkspaceService,
    private dashboardService: MatderDashboardService,
    private historyService: MatderHistoryService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  /** Toggle de favorito con optimistic update + rollback en error. */
  async toggleFavorite(b: BoardResponse): Promise<void> {
    const before = !!b.is_favorite;
    this.boards.set(this.boards().map(
      x => x.id === b.id ? { ...x, is_favorite: !before } : x,
    ));
    try {
      await this.dashboardService.toggleFavorite('BOARD', b.id);
    } catch {
      this.boards.set(this.boards().map(
        x => x.id === b.id ? { ...x, is_favorite: before } : x,
      ));
      Swal.fire('Error', 'No se pudo actualizar favorito.', 'error');
    }
  }

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const [boards, wss] = await Promise.all([
        this.boardService.listBoards(),
        this.wsService.list(),
      ]);
      this.boards.set(boards);
      this.workspaces.set(wss);

      const wsParam = this.route.snapshot.queryParamMap.get('workspace');
      if (wsParam) {
        const id = Number(wsParam);
        this.wsFilter = id;
        this.formWs = id;
      } else if (wss.length) {
        this.formWs = wss[0].id;
      }
    } catch { /* empty */ }
    finally { this.loading.set(false); }
  }

  get filtered(): BoardResponse[] {
    let result = this.boards();
    if (this.search) {
      const q = this.search.toLowerCase();
      result = result.filter(b =>
        b.name.toLowerCase().includes(q) ||
        (b.description ?? '').toLowerCase().includes(q) ||
        b.workspace_name.toLowerCase().includes(q)
      );
    }
    if (this.wsFilter) {
      result = result.filter(b => b.workspace === this.wsFilter);
    }
    if (this.onlyFavorites) {
      result = result.filter(b => !!b.is_favorite);
    }
    return result;
  }

  open(id: number): void {
    const b = this.boards().find(x => x.id === id);
    if (b) {
      this.historyService.push({ type: 'board', id, name: b.name, subtitle: b.workspace_name, accent: b.accent });
    }
    this.router.navigate([`/dashboard/matder/boards/${id}`]);
  }

  async create(): Promise<void> {
    if (!this.formName.trim() || !this.formWs || this.saving) return;
    this.saving = true;
    try {
      await this.boardService.createBoard({
        workspace: this.formWs,
        name: this.formName.trim(),
        description: this.formDesc.trim() || undefined,
        accent: this.formAccent,
      });
      this.formName = '';
      this.formDesc = '';
      this.showForm.set(false);
      this.boards.set(await this.boardService.listBoards());
      Swal.fire('Creado', 'Tablero creado exitosamente.', 'success');
    } catch {
      Swal.fire('Error', 'No se pudo crear el tablero.', 'error');
    } finally {
      this.saving = false;
    }
  }

  async del(e: Event, b: BoardResponse): Promise<void> {
    e.stopPropagation();
    const c = await Swal.fire({
      title: `Eliminar "${b.name}"?`,
      text: 'Se eliminaran todas las listas y tareas.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
    });
    if (c.isConfirmed) {
      try {
        await this.boardService.deleteBoard(b.id);
        this.boards.set(this.boards().filter(x => x.id !== b.id));
      } catch {
        Swal.fire('Error', 'No se pudo eliminar.', 'error');
      }
    }
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }
}

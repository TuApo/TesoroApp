import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, switchMap } from 'rxjs';
import { AuthResponse, AuthService } from '../../../core/services/auth/auth.service';
import { BoardResponse, BoardService } from '../../../core/services/board/board.service';
import { DashboardService } from '../../../core/services/dashboard/dashboard.service';
import { FavoritesService } from '../../../core/services/favorites/favorites.service';
import { WorkspaceResponse, WorkspaceService } from '../../../core/services/workspace/workspace.service';
import { BoardModalComponent } from '../../../boards/components/board-modal/board-modal.component';
import { BOARD_COLOR_OPTIONS } from '../../../boards/config/board.config';
import { WorkspaceModalComponent } from '../../../workspaces/components/workspace-modal/workspace-modal.component';
import {
  DashboardBoardIndicator,
  DashboardOverviewResponse,
  DashboardWorkspaceIndicator
} from '../../models/dashboard.models';

@Component({
  standalone: true,
  selector: 'app-dashboard-page',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    WorkspaceModalComponent,
    BoardModalComponent
  ],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css'
})
export class DashboardPageComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private boardService = inject(BoardService);
  private dashboardService = inject(DashboardService);
  private favoritesService = inject(FavoritesService);
  private workspaceService = inject(WorkspaceService);
  private router = inject(Router);

  loading = true;
  user: AuthResponse | null = null;
  uiMessage = 'Bienvenido a tu panel principal de MatDer.';
  todayLabel = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date());

  workspaces: WorkspaceResponse[] = [];
  boards: BoardResponse[] = [];
  overview: DashboardOverviewResponse | null = null;
  isWorkspaceModalOpen = false;
  workspaceSaving = false;
  workspaceError = '';
  deletingWorkspaceId: number | null = null;
  isBoardModalOpen = false;
  boardSaving = false;
  boardError = '';
  editingBoard: BoardResponse | null = null;
  deletingBoardId: number | null = null;
  boardColorOptions = BOARD_COLOR_OPTIONS;

  workspaceForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(80)]],
    description: ['', [Validators.maxLength(280)]]
  });

  boardForm = this.fb.nonNullable.group({
    workspaceId: ['', [Validators.required]],
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(80)]],
    description: ['', [Validators.maxLength(280)]],
    accent: ['#38bdf8', [Validators.required]]
  });

  constructor() {
    this.loadProfile();
  }

  get insightCards(): Array<{ label: string; value: string; caption: string; icon: string; progress: number; tone: string }> {
    if (!this.overview) {
      return [];
    }

    return [
      {
        label: 'Progreso general',
        value: `${this.overview.completionRate}%`,
        caption: `${this.overview.completedTasks} de ${this.overview.totalTasks} tareas ya estan marcadas como hechas.`,
        icon: 'insights',
        progress: this.overview.completionRate,
        tone: 'sky'
      },
      {
        label: 'Workspaces activos',
        value: `${this.overview.activeWorkspaces}/${this.overview.totalWorkspaces}`,
        caption: `${this.overview.activeWorkspaces} workspaces ya tienen tableros creados dentro de la cuenta.`,
        icon: 'workspaces',
        progress: this.overview.workspaceCoverageRate,
        tone: 'emerald'
      },
      {
        label: 'Tableros con carga',
        value: `${this.overview.activeBoards}/${this.overview.totalBoards}`,
        caption: `${this.overview.activeBoards} tableros ya tienen al menos una tarea registrada.`,
        icon: 'dashboard_customize',
        progress: this.overview.boardCoverageRate,
        tone: 'amber'
      },
      {
        label: 'Alertas de entrega',
        value: String(this.overview.overdueTasks + this.overview.dueSoonTasks),
        caption: `${this.overview.overdueTasks} vencidas y ${this.overview.dueSoonTasks} por vencer esta semana.`,
        icon: 'schedule',
        progress: this.overview.totalTasks
          ? Math.min(100, Math.round(((this.overview.overdueTasks + this.overview.dueSoonTasks) * 100) / this.overview.totalTasks))
          : 0,
        tone: 'rose'
      }
    ];
  }

  get workspaceIndicatorsPreview(): DashboardWorkspaceIndicator[] {
    return this.overview?.workspaceIndicators.slice(0, 5) ?? [];
  }

  get boardIndicatorsPreview(): DashboardBoardIndicator[] {
    return this.overview?.boardIndicators.slice(0, 6) ?? [];
  }

  get creatableWorkspaces(): WorkspaceResponse[] {
    return this.workspaces.filter(workspace => workspace.canCreateBoards);
  }

  get userInitials(): string {
    if (!this.user?.username) {
      return 'M';
    }

    return this.user.username.slice(0, 2).toUpperCase();
  }

  get formattedRole(): string {
    const role = this.user?.roles?.[0] ?? 'member';
    return role
      .replace(/^ROLE_/, '')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  goToBoards(): void {
    void this.router.navigate(['/dashboard/madter/boards']);
  }

  goToAnalytics(): void {
    void this.router.navigate(['/dashboard/madter/analytics']);
  }

  openBoardPreview(boardId: number): void {
    void this.router.navigate(['/dashboard/madter/board', boardId]);
  }

  isBoardFavorite(boardId: number): boolean {
    return this.favoritesService.isBoardFavorite(boardId);
  }

  toggleBoardFavorite(board: BoardResponse): void {
    this.favoritesService.toggleBoard(board.id);
    this.uiMessage = this.isBoardFavorite(board.id)
      ? `Tablero "${board.name}" agregado a favoritos.`
      : `Tablero "${board.name}" removido de favoritos.`;
  }

  openWorkspaceModal(): void {
    this.workspaceError = '';
    this.isBoardModalOpen = false;
    this.isWorkspaceModalOpen = true;
  }

  closeWorkspaceModal(): void {
    if (this.workspaceSaving) {
      return;
    }

    this.isWorkspaceModalOpen = false;
    this.workspaceError = '';
    this.workspaceForm.reset({
      name: '',
      description: ''
    });
  }

  submitWorkspace(): void {
    if (this.workspaceForm.invalid || this.workspaceSaving) {
      this.workspaceForm.markAllAsTouched();
      return;
    }

    this.workspaceSaving = true;
    this.workspaceError = '';

    const payload = this.workspaceForm.getRawValue();
    this.authService.initCsrf().pipe(
      switchMap(() => this.workspaceService.create(payload))
    ).subscribe({
      next: workspace => {
        this.workspaces = [workspace, ...this.workspaces];
        this.refreshDashboardOverview();
        this.uiMessage = `Workspace "${workspace.name}" creado correctamente.`;
        this.workspaceSaving = false;
        this.closeWorkspaceModal();
      },
      error: err => {
        this.workspaceSaving = false;
        this.workspaceError = err?.error?.message ?? 'No pudimos crear el workspace. Intenta otra vez.';
      }
    });
  }

  deleteWorkspace(workspace: WorkspaceResponse): void {
    if (!workspace.canDeleteWorkspace) {
      this.uiMessage = `Tu rol actual no permite eliminar el workspace "${workspace.name}".`;
      return;
    }

    if (this.deletingWorkspaceId) {
      return;
    }

    if (!confirm(`Vas a eliminar el workspace "${workspace.name}" con sus tableros, listas y tareas. Quieres continuar?`)) {
      return;
    }

    this.deletingWorkspaceId = workspace.id;
    this.authService.initCsrf().pipe(
      switchMap(() => this.workspaceService.delete(workspace.id))
    ).subscribe({
      next: () => {
        this.workspaces = this.workspaces.filter(item => item.id !== workspace.id);
        this.boards = this.boards.filter(item => item.workspaceId !== workspace.id);
        this.refreshDashboardOverview();
        this.uiMessage = `Workspace "${workspace.name}" eliminado correctamente.`;
        this.deletingWorkspaceId = null;
      },
      error: err => {
        this.deletingWorkspaceId = null;
        this.uiMessage = err?.error?.message ?? 'No pudimos eliminar el workspace. Intenta otra vez.';
      }
    });
  }

  openBoardModal(): void {
    if (!this.creatableWorkspaces.length) {
      this.uiMessage = this.workspaces.length
        ? 'Tu rol actual no permite crear tableros en los workspaces disponibles.'
        : 'Primero crea un workspace para poder guardar tableros dentro de el.';
      return;
    }

    this.boardError = '';
    this.isWorkspaceModalOpen = false;
    this.editingBoard = null;
    this.boardForm.reset({
      workspaceId: String(this.creatableWorkspaces[0].id),
      name: '',
      description: '',
      accent: '#38bdf8'
    });
    this.isBoardModalOpen = true;
  }

  closeBoardModal(): void {
    if (this.boardSaving) {
      return;
    }

    this.isBoardModalOpen = false;
    this.editingBoard = null;
    this.boardError = '';
    this.boardForm.reset({
      workspaceId: this.creatableWorkspaces.length ? String(this.creatableWorkspaces[0].id) : '',
      name: '',
      description: '',
      accent: '#38bdf8'
    });
  }

  setBoardAccent(accent: string): void {
    this.boardForm.controls.accent.setValue(accent);
  }

  openEditBoardModal(board: BoardResponse): void {
    if (!board.canManageContent) {
      this.uiMessage = `Tu rol actual no permite editar el tablero "${board.name}".`;
      return;
    }

    this.boardError = '';
    this.isWorkspaceModalOpen = false;
    this.editingBoard = board;
    this.boardForm.reset({
      workspaceId: String(board.workspaceId),
      name: board.name,
      description: board.description ?? '',
      accent: board.accent
    });
    this.isBoardModalOpen = true;
  }

  submitBoard(): void {
    if (this.boardForm.invalid || this.boardSaving) {
      this.boardForm.markAllAsTouched();
      return;
    }

    this.boardSaving = true;
    this.boardError = '';

    const rawValue = this.boardForm.getRawValue();
    const createPayload = {
      workspaceId: Number(rawValue.workspaceId),
      name: rawValue.name,
      description: rawValue.description,
      accent: rawValue.accent
    };
    const updatePayload = {
      name: rawValue.name,
      description: rawValue.description,
      accent: rawValue.accent
    };

    this.authService.initCsrf().pipe(
      switchMap(() => this.editingBoard
        ? this.boardService.update(this.editingBoard.id, updatePayload)
        : this.boardService.create(createPayload))
    ).subscribe({
      next: board => {
        this.boards = this.sortBoards(
          this.editingBoard
            ? this.boards.map(item => item.id === board.id ? board : item)
            : [board, ...this.boards]
        );
        this.refreshDashboardOverview();
        this.uiMessage = this.editingBoard
          ? `Tablero "${board.name}" actualizado correctamente.`
          : `Tablero "${board.name}" creado dentro de ${board.workspaceName}.`;
        this.boardSaving = false;
        this.closeBoardModal();
      },
      error: err => {
        this.boardSaving = false;
        this.boardError = err?.error?.message ?? 'No pudimos crear el tablero. Intenta otra vez.';
      }
    });
  }

  deleteBoard(board: BoardResponse): void {
    if (!board.canManageContent) {
      this.uiMessage = `Tu rol actual no permite eliminar el tablero "${board.name}".`;
      return;
    }

    if (this.deletingBoardId) {
      return;
    }

    if (!confirm(`Vas a eliminar el tablero "${board.name}" con sus listas y tareas. Quieres continuar?`)) {
      return;
    }

    this.deletingBoardId = board.id;
    this.authService.initCsrf().pipe(
      switchMap(() => this.boardService.delete(board.id))
    ).subscribe({
      next: () => {
        this.boards = this.boards.filter(item => item.id !== board.id);
        if (this.editingBoard?.id === board.id) {
          this.closeBoardModal();
        }
        this.refreshDashboardOverview();
        this.uiMessage = `Tablero "${board.name}" eliminado correctamente.`;
        this.deletingBoardId = null;
      },
      error: err => {
        this.deletingBoardId = null;
        this.uiMessage = err?.error?.message ?? 'No pudimos eliminar el tablero. Intenta otra vez.';
      }
    });
  }

  private loadProfile(): void {
    forkJoin({
      csrf: this.authService.initCsrf(),
      user: this.authService.me(),
      workspaces: this.workspaceService.listMine(),
      boards: this.boardService.listMine(),
      overview: this.dashboardService.getOverview()
    }).subscribe({
      next: ({ user, workspaces, boards, overview }) => {
        this.user = user;
        this.workspaces = workspaces;
        this.boards = this.sortBoards(boards);
        this.overview = overview;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        void this.router.navigate(['/dashboard/madter/dashboard']);
      }
    });
  }

  private refreshDashboardOverview(): void {
    this.dashboardService.getOverview().subscribe({
      next: overview => {
        this.overview = overview;
      }
    });
  }

  private sortBoards(boards: BoardResponse[]): BoardResponse[] {
    return [...boards].sort((left, right) => (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    ));
  }
}

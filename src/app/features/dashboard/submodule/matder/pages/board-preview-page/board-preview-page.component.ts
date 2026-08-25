import { Component, OnInit, OnDestroy, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CommonModule, DatePipe } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { BoardService } from '../../services/board.service';
import { WorkspaceService } from '../../services/workspace.service';
import { MatderDashboardService } from '../../services/dashboard.service';
import { MatderHistoryService } from '../../services/matder-history.service';
import { MatderMobileNavComponent } from '../../components/matder-mobile-nav/matder-mobile-nav.component';
import { BoardResponse, BoardListResponse, CardSummary } from '../../models/board.models';
import { WorkspaceMemberResponse } from '../../models/workspace.models';
import { UserGroupResponse, GroupMemberResponse } from '../../models/dashboard.models';
import { CardDetailDialogComponent } from '../../components/card-detail-dialog/card-detail-dialog.component';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import Swal from 'sweetalert2';

interface CardDraft {
  id: string;
  savedAt: string;
  listId: number;
  listName: string;
  listType: string | null;
  title: string;
  desc: string;
  priority: string;
  status: string;
  dueDate: string | null;
  assignee: string | null;
  assigneeGroup: number | null;
  checklists: { content: string; completed: boolean }[];
  // files viven solo en memoria (no serializables a localStorage)
  files?: File[];
}

@Component({
  selector: 'app-board-preview-page',
  standalone: true,
  imports: [
    CommonModule, DatePipe, FormsModule, DragDropModule, MatButtonModule, MatIconModule,
    MatMenuModule, MatChipsModule, MatDialogModule, MatProgressSpinnerModule,
    MatTooltipModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatDividerModule, MatDatepickerModule, MatNativeDateModule,
    MatAutocompleteModule, MatderMobileNavComponent,
  ],
  templateUrl: './board-preview-page.component.html',
  styleUrls: ['./board-preview-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardPreviewPageComponent implements OnInit, OnDestroy {
  board = signal<BoardResponse | null>(null);
  lists = signal<BoardListResponse[]>([]);
  loading = signal(true);

  // Workspace members & groups
  workspaceMembers = signal<WorkspaceMemberResponse[]>([]);
  workspaceGroups = signal<UserGroupResponse[]>([]);
  platformUsers = signal<any[]>([]);

  // Add card inline
  newCardTitle = '';
  addingToListId: number | null = null;

  // Add list
  newListName = '';
  showNewListInput = false;

  // Edit list
  editingListId: number | null = null;
  editListName = '';

  // Card modal
  showCardModal = false;
  editingCardId: number | null = null;
  editingCardListId: number | null = null;
  editingCardListName = '';
  editingCardListType: string | null = null;
  cardFormTitle = '';
  cardFormDesc = '';
  cardFormPriority = 'MEDIUM';
  cardFormStatus = 'TODO';
  // Datepicker maneja Date; mantenemos string ISO para enviarlo al backend.
  cardFormDueDate: Date | null = null;
  cardFormAssignee: string | null = null;
  cardFormGroup: number | null = null;
  
  // Draft content for new cards
  cardFormChecklists: { content: string; completed: boolean }[] = [];
  cardFormNewChecklist = '';
  cardFormFiles: File[] = [];
  cardSaving = false;

  // Group management modal
  showGroupModal = false;
  newGroupName = '';
  newGroupDesc = '';
  groupSaving = false;
  managingGroup: UserGroupResponse | null = null;
  groupMembers = signal<GroupMemberResponse[]>([]);
  addMemberToGroupId = '';
  groupSearchQuery = '';
  returnToCardForm = false;

  // Panel lateral de grupos del workspace
  groupMembersCache = signal<Record<number, GroupMemberResponse[]>>({});
  expandedGroupIds = signal<Set<number>>(new Set());

  // Borradores
  drafts = signal<CardDraft[]>([]);
  showDraftsPanel = false;
  private draftFilesMap = new Map<string, File[]>();
  private get draftKey(): string { return `matder-drafts-${this.board()?.id ?? 'global'}`; }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private boardService: BoardService,
    private workspaceService: WorkspaceService,
    private dashboardService: MatderDashboardService,
    private historyService: MatderHistoryService,
    private utilityService: UtilityServiceService,
    private dialog: MatDialog,
  ) {}

  async ngOnInit(): Promise<void> {
    const id = Number(this.route.snapshot.paramMap.get('boardId'));
    if (id) await this.loadBoard(id);
    else this.loading.set(false);
  }

  ngOnDestroy(): void {
    this.draftFilesMap.clear();
  }

  async loadBoard(id: number): Promise<void> {
    this.loading.set(true);
    try {
      const [b, ls] = await Promise.all([
        this.boardService.getBoard(id),
        this.boardService.getBoardLists(id),
      ]);
      this.board.set(b);
      this.historyService.push({ type: 'board', id: b.id, name: b.name, subtitle: b.workspace_name, accent: b.accent });
      // Asegurar que las cartas siempre sean un array para evitar problemas al hacer drag and drop (kanban)
      const sanitizedLists = ls.map(l => ({ ...l, cards: l.cards || [] })).sort((a, c) => a.position - c.position);
      this.lists.set(sanitizedLists);

      // Load workspace members and groups in parallel
      await this.loadWorkspaceData(b.workspace);
      this.loadDraftsFromStorage();
    } catch {
      this.board.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadWorkspaceData(workspaceId: number): Promise<void> {
    try {
      const [members, groups, allUsers] = await Promise.all([
        this.workspaceService.listMembers(workspaceId),
        this.dashboardService.getGroupsByWorkspace(workspaceId).catch(() =>
          this.dashboardService.getGroups().catch(() => [] as UserGroupResponse[])
        ),
        firstValueFrom(this.utilityService.getAllUsers()).catch(() => [])
      ]);
      this.workspaceMembers.set(members.filter((m: WorkspaceMemberResponse) => m.active));
      this.workspaceGroups.set(groups);
      this.platformUsers.set(allUsers);
    } catch {
      this.workspaceMembers.set([]);
      this.workspaceGroups.set([]);
      this.platformUsers.set([]);
    }
  }

  get totalCardCount(): number {
    return this.lists().reduce((sum, l) => sum + (l.cards?.length ?? 0), 0);
  }

  get activeMembers(): WorkspaceMemberResponse[] {
    return this.workspaceMembers();
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }

  getListIds(): string[] {
    return this.lists().map(l => 'list-' + l.id);
  }

  // ── Drag & drop ──
  async onCardDrop(event: CdkDragDrop<CardSummary[]>, target: BoardListResponse): Promise<void> {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
    }
    const card = event.container.data[event.currentIndex];
    if (!card) return;

    // Determinar nuevo status segun el list_type de la lista destino
    const newStatus = this.listTypeToStatus(target.list_type);

    try {
      // Mover la card al nuevo list + posicion
      await this.boardService.moveCard(card.id, target.id, event.currentIndex);

      // Actualizar el status si la lista tiene un tipo mapeado
      if (newStatus && card.status !== newStatus) {
        await this.boardService.updateCard(card.id, { status: newStatus });
        card.status = newStatus as any;
      }
    } catch {
      Swal.fire('Error', 'No se pudo mover la tarea.', 'error');
      await this.loadBoard(this.board()!.id);
    }
  }

  // ── Helpers de status según el tipo de lista ──
  private listTypeToStatus(listType: string | null | undefined): string {
    const m: Record<string, string> = {
      TODO: 'TODO',
      IN_PROGRESS: 'IN_PROGRESS',
      BLOCKED: 'BLOCKED',
      DONE: 'DONE',
    };
    return (listType && m[listType]) || 'TODO';
  }

  /**
   * Abre el modal de creación de tarea sobre una lista específica.
   * El status se preconfigura según el tipo de la lista (TODO, IN_PROGRESS,
   * BLOCKED, DONE) para mantener coherencia con la columna destino.
   */
  startAddCard(listOrId: BoardListResponse | number): void {
    const list = typeof listOrId === 'number'
      ? this.lists().find(l => l.id === listOrId) ?? null
      : listOrId;
    if (!list) return;

    this.editingCardId = null;
    this.editingCardListId = list.id;
    this.editingCardListName = list.name;
    this.editingCardListType = list.list_type ?? null;
    this.cardFormTitle = '';
    this.cardFormDesc = '';
    this.cardFormPriority = 'MEDIUM';
    this.cardFormStatus = this.listTypeToStatus(list.list_type);
    this.cardFormDueDate = null;
    this.cardFormAssignee = null;
    this.cardFormGroup = null;
    this.cardFormChecklists = [];
    this.cardFormFiles = [];
    this.cardFormNewChecklist = '';
    this.showCardModal = true;
  }

  async addCard(list: BoardListResponse): Promise<void> {
    // Mantiene compatibilidad con el atajo inline (Enter sobre el input).
    // Hoy delega al modal completo para que el usuario complete los datos.
    this.startAddCard(list);
  }

  cancelAddCard(): void { this.addingToListId = null; }

  // ── List management ──
  async addList(): Promise<void> {
    if (!this.newListName.trim()) return;
    try {
      await this.boardService.createList({
        board: this.board()!.id,
        name: this.newListName.trim(),
        position: this.lists().length,
      });
      this.newListName = '';
      this.showNewListInput = false;
      await this.loadBoard(this.board()!.id);
    } catch {
      Swal.fire('Error', 'No se pudo crear la lista.', 'error');
    }
  }

  startEditList(list: BoardListResponse): void {
    this.editingListId = list.id;
    this.editListName = list.name;
  }

  cancelEditList(): void {
    this.editingListId = null;
    this.editListName = '';
  }

  async submitListEdit(list: BoardListResponse): Promise<void> {
    if (!this.editListName.trim()) return;
    try {
      await this.boardService.updateList(list.id, { name: this.editListName.trim() });
      this.editingListId = null;
      await this.loadBoard(this.board()!.id);
    } catch {
      Swal.fire('Error', 'No se pudo actualizar la lista.', 'error');
    }
  }

  async deleteList(list: BoardListResponse): Promise<void> {
    const c = await Swal.fire({
      title: `Eliminar "${list.name}"?`,
      text: 'Se eliminaran todas las tareas de esta lista.',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar',
    });
    if (c.isConfirmed) {
      try {
        await this.boardService.deleteList(list.id);
        await this.loadBoard(this.board()!.id);
      } catch { Swal.fire('Error', 'No se pudo eliminar.', 'error'); }
    }
  }

  // ── Card detail dialog ──
  openCardDetail(card: CardSummary): void {
    const ref = this.dialog.open(CardDetailDialogComponent, {
      width: '1040px', maxWidth: '96vw', maxHeight: '92vh',
      panelClass: 'matder-card-detail-panel',
      data: { cardId: card.id },
    });
    ref.afterClosed().subscribe(async (changed) => {
      if (changed) await this.loadBoard(this.board()!.id);
    });
  }

  // ── Card modal (create/edit) ──

  openEditCard(card: CardSummary): void {
    const list = this.lists().find(l => l.id === card.board_list) ?? null;
    this.editingCardId = card.id;
    this.editingCardListId = card.board_list;
    this.editingCardListName = list?.name ?? '';
    this.editingCardListType = list?.list_type ?? null;
    this.cardFormTitle = card.title;
    this.cardFormDesc = '';
    this.cardFormPriority = card.priority;
    this.cardFormStatus = card.status ?? this.listTypeToStatus(list?.list_type);
    this.cardFormDueDate = card.due_at ? new Date(card.due_at) : null;
    this.cardFormAssignee = card.assignee;
    this.cardFormGroup = card.assignee_group;
    this.showCardModal = true;
    // Load full detail for description
    this.boardService.getCardDetail(card.id).then(detail => {
      this.cardFormDesc = detail.description ?? '';
    }).catch(() => {});
  }

  closeCardModal(): void {
    // Auto-guardar como borrador si es una nueva tarjeta con título
    if (!this.editingCardId && this.cardFormTitle.trim()) {
      this.persistDraft();
    }
    this.showCardModal = false;
    this.editingCardId = null;
  }

  discardCardAndClose(): void {
    this.showCardModal = false;
    this.editingCardId = null;
    this.cardFormTitle = '';
    this.cardFormDesc = '';
    this.cardFormPriority = 'MEDIUM';
    this.cardFormStatus = 'TODO';
    this.cardFormDueDate = null;
    this.cardFormAssignee = null;
    this.cardFormGroup = null;
    this.cardFormChecklists = [];
    this.cardFormFiles = [];
  }

  // ── Borradores ──

  private loadDraftsFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.draftKey);
      this.drafts.set(raw ? JSON.parse(raw) : []);
    } catch {
      this.drafts.set([]);
    }
  }

  private persistDraft(): void {
    const draft: CardDraft = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: new Date().toISOString(),
      listId: this.editingCardListId!,
      listName: this.editingCardListName,
      listType: this.editingCardListType,
      title: this.cardFormTitle.trim(),
      desc: this.cardFormDesc.trim(),
      priority: this.cardFormPriority,
      status: this.cardFormStatus,
      dueDate: this.cardFormDueDate ? this.cardFormDueDate.toISOString() : null,
      assignee: this.cardFormAssignee,
      assigneeGroup: this.cardFormGroup,
      checklists: [...this.cardFormChecklists],
    };
    if (this.cardFormFiles.length) {
      this.draftFilesMap.set(draft.id, [...this.cardFormFiles]);
    }
    const updated = [...this.drafts(), draft];
    this.drafts.set(updated);
    this.saveDraftsToStorage(updated);
  }

  private saveDraftsToStorage(list: CardDraft[]): void {
    try { localStorage.setItem(this.draftKey, JSON.stringify(list)); } catch { /* cuota llena */ }
  }

  loadDraft(draft: CardDraft): void {
    this.editingCardId = null;
    this.editingCardListId = draft.listId;
    this.editingCardListName = draft.listName;
    this.editingCardListType = draft.listType;
    this.cardFormTitle = draft.title;
    this.cardFormDesc = draft.desc;
    this.cardFormPriority = draft.priority;
    this.cardFormStatus = draft.status;
    this.cardFormDueDate = draft.dueDate ? new Date(draft.dueDate) : null;
    this.cardFormAssignee = draft.assignee;
    this.cardFormGroup = draft.assigneeGroup;
    this.cardFormChecklists = draft.checklists.map(c => ({ ...c }));
    this.cardFormFiles = this.draftFilesMap.get(draft.id) ?? [];
    this.cardFormNewChecklist = '';
    this.cardSaving = false;
    // Quitar el borrador de la lista (se cargó al form)
    this.deleteDraftById(draft.id);
    this.showDraftsPanel = false;
    this.showCardModal = true;
  }

  deleteDraftById(id: string): void {
    this.draftFilesMap.delete(id);
    const updated = this.drafts().filter(d => d.id !== id);
    this.drafts.set(updated);
    this.saveDraftsToStorage(updated);
  }

  draftPriorityLabel(p: string): string {
    return ({ LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente' } as Record<string, string>)[p] ?? p;
  }

  draftAge(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'Hace un momento';
    if (m < 60) return `Hace ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `Hace ${h} h`;
    return `Hace ${Math.floor(h / 24)} día(s)`;
  }

  /** Convierte la fecha del datepicker a ISO (yyyy-mm-ddT00:00:00) o null. */
  private formatDueDate(d: Date | null): string | null {
    if (!d) return null;
    // Mantenemos hora local 23:59 para que el "vence hoy" no quede como vencido.
    // Mediodía local para que la fecha en UTC coincida con la local (evita el off-by-one
    // del calendario: a las 23:59 en UTC-5 la fecha ISO caía al día siguiente).
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    return local.toISOString();
  }

  async submitCardForm(): Promise<void> {
    if (!this.cardFormTitle.trim() || this.cardSaving) return;
    this.cardSaving = true;
    try {
      const payload: Record<string, any> = {
        title: this.cardFormTitle.trim(),
        description: this.cardFormDesc.trim(),
        priority: this.cardFormPriority,
        status: this.cardFormStatus,
        due_at: this.formatDueDate(this.cardFormDueDate),
        assignee: this.cardFormAssignee || null,
        // Nombre ya resuelto del asignado: el backend lo usa SOLO para el texto de la
        // notificación de confirmación al que asigna ("Asignaste una tarea a X"); no se
        // persiste en la tarjeta. Si falta, el backend cae a un título sin nombre.
        assignee_name: this.cardFormAssignee ? (this.selectedAssigneeLabel() || null) : null,
        assignee_group: this.cardFormGroup || null,
      };

      let newCardId: number | null = null;

      if (this.editingCardId) {
        await this.boardService.updateCard(this.editingCardId, payload);
      } else {
        payload['board_list'] = this.editingCardListId;
        payload['position'] = 0;
        const newCard = await this.boardService.createCard(payload as any);
        newCardId = newCard.id;

        if (newCardId) {
          // Send drafted checklists
          for (const item of this.cardFormChecklists) {
            const chk = await this.boardService.createChecklistItem(newCardId, item.content);
            if (item.completed) {
              await this.boardService.updateChecklistItem(chk.id, { completed: true });
            }
          }
          // Send drafted files
          for (const file of this.cardFormFiles) {
            await this.boardService.uploadFile(newCardId, file);
          }
        }
      }
      this.closeCardModal();
      await this.loadBoard(this.board()!.id);
    } catch {
      Swal.fire('Error', 'No se pudo guardar la tarea.', 'error');
    } finally {
      this.cardSaving = false;
    }
  }

  // When a group is selected as assignee, show info
  onGroupSelected(groupId: number | null): void {
    this.cardFormGroup = groupId;
    // Optionally clear individual assignee when group is selected
    if (groupId) {
      this.cardFormAssignee = null;
    }
  }

  onAssigneeSelected(userId: string | null): void {
    this.cardFormAssignee = userId;
    // Persona y grupo son excluyentes: elegir una persona limpia el grupo (y viceversa
    // en onGroupSelected), para que la tarjeta tenga un único responsable coherente.
    if (userId) {
      this.cardFormGroup = null;
    }
  }

  getMemberLabel(m: WorkspaceMemberResponse): string {
    // Resolver el nombre real desde la lista de usuarios de la compañía; nunca el UUID crudo.
    const name = this.getAssigneeName(m.user);
    if (name) return name;
    if (m.full_name) return m.full_name;
    if (m.username) return m.username;
    return 'Usuario';
  }

  getMemberInitials(m: WorkspaceMemberResponse): string {
    return this.getMemberLabel(m).slice(0, 2).toUpperCase();
  }

  /** Texto del select cerrado: SOLO el nombre del responsable elegido (no iniciales ni rol). */
  selectedAssigneeLabel(): string {
    if (!this.cardFormAssignee) return '';
    const m = this.activeMembers.find(x => x.user === this.cardFormAssignee);
    return m ? this.getMemberLabel(m) : (this.getAssigneeName(this.cardFormAssignee) || '');
  }

  /** Texto del select cerrado de grupo: SOLO el nombre del grupo. */
  selectedGroupLabel(): string {
    if (!this.cardFormGroup) return '';
    const g = this.workspaceGroups().find(x => x.id === this.cardFormGroup);
    return g ? g.name : '';
  }

  // ── Group management ──
  openGroupModal(fromCardForm = false): void {
    this.returnToCardForm = fromCardForm;
    if (fromCardForm) {
      this.showCardModal = false;
    }
    this.showGroupModal = true;
    this.managingGroup = null;
    this.newGroupName = '';
    this.newGroupDesc = '';
    this.groupMembers.set([]);
    this.clearGroupSearch();
  }

  closeGroupModal(): void {
    this.showGroupModal = false;
    this.managingGroup = null;
    if (this.returnToCardForm) {
      this.returnToCardForm = false;
      this.showCardModal = true;
    }
  }

  // ── Panel lateral de grupos ──
  async toggleGroupPanel(groupId: number): Promise<void> {
    const current = new Set(this.expandedGroupIds());
    if (current.has(groupId)) {
      current.delete(groupId);
      this.expandedGroupIds.set(new Set(current));
      return;
    }
    current.add(groupId);
    this.expandedGroupIds.set(new Set(current));
    const cache = this.groupMembersCache();
    if (!cache[groupId]) {
      try {
        const members = await this.dashboardService.getGroupMembers(groupId);
        this.groupMembersCache.set({ ...this.groupMembersCache(), [groupId]: members });
      } catch {
        this.groupMembersCache.set({ ...this.groupMembersCache(), [groupId]: [] });
      }
    }
  }

  isGroupExpanded(groupId: number): boolean {
    return this.expandedGroupIds().has(groupId);
  }

  getGroupMemberName(m: GroupMemberResponse): string {
    if (m.full_name) return m.full_name;
    const u: any = this.platformUsers().find((x: any) => x.id === m.user);
    if (u) {
      const full = `${u.datos_basicos?.nombres ?? ''} ${u.datos_basicos?.apellidos ?? ''}`.trim();
      if (full) return full;
      if (u.correo_electronico) return u.correo_electronico;
    }
    return m.username || 'Usuario';
  }

  getGroupMemberInitials(m: GroupMemberResponse): string {
    return this.getGroupMemberName(m).slice(0, 2).toUpperCase();
  }

  /** Asigna el grupo a la tarea que se está creando/editando desde el panel lateral */
  assignGroupFromPanel(groupId: number): void {
    this.cardFormGroup = groupId;
    this.cardFormAssignee = null;
    if (!this.showCardModal) {
      // Si no hay modal abierto, abre uno nuevo — el usuario tendrá que elegir la lista
      Swal.fire('Grupo seleccionado', 'Abre una lista y crea una tarea; el grupo ya quedará preseleccionado.', 'info');
    }
  }

  async createGroup(): Promise<void> {
    if (!this.newGroupName.trim() || this.groupSaving) return;
    this.groupSaving = true;
    try {
      const group = await this.dashboardService.createGroup({
        name: this.newGroupName.trim(),
        description: this.newGroupDesc.trim() || undefined,
        workspace: this.board()!.workspace,
      });
      this.newGroupName = '';
      this.newGroupDesc = '';
      await this.loadWorkspaceData(this.board()!.workspace);
      // Auto-select the created group for management
      this.managingGroup = group;
      await this.loadGroupMembers(group.id);
      Swal.fire('Creado', `Grupo "${group.name}" creado. Ahora agrega miembros.`, 'success');
    } catch {
      Swal.fire('Error', 'No se pudo crear el grupo.', 'error');
    } finally {
      this.groupSaving = false;
    }
  }

  async selectGroupToManage(group: UserGroupResponse): Promise<void> {
    this.managingGroup = group;
    await this.loadGroupMembers(group.id);
  }

  async loadGroupMembers(groupId: number): Promise<void> {
    try {
      this.groupMembers.set(await this.dashboardService.getGroupMembers(groupId));
    } catch {
      this.groupMembers.set([]);
    }
  }

  async addMemberToGroup(): Promise<void> {
    if (!this.addMemberToGroupId.trim() || !this.managingGroup) return;
    try {
      await this.dashboardService.addGroupMember(this.managingGroup.id, this.addMemberToGroupId.trim());
      this.addMemberToGroupId = '';
      this.clearGroupSearch();
      await this.loadGroupMembers(this.managingGroup.id);
      await this.loadWorkspaceData(this.board()!.workspace);
    } catch {
      Swal.fire('Error', 'No se pudo agregar el miembro al grupo.', 'error');
    }
  }

  // ── Buscador inteligente de usuarios ──

  get filteredPlatformUsers(): any[] {
    const q = this.groupSearchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return this.platformUsers().filter((u: any) => {
      const nombres = (u.datos_basicos?.nombres ?? '').toLowerCase();
      const apellidos = (u.datos_basicos?.apellidos ?? '').toLowerCase();
      const fullName = `${nombres} ${apellidos}`;
      const email = (u.correo_electronico ?? '').toLowerCase();
      const doc = (u.numero_de_documento ?? '').toString().toLowerCase();
      return fullName.includes(q) || email.includes(q) || doc.includes(q);
    }).slice(0, 12);
  }

  displayGroupUser = (u: any): string => {
    if (!u || typeof u !== 'object') return '';
    return this.getUserFullName(u);
  };

  getUserFullName(u: any): string {
    const name = `${u.datos_basicos?.nombres ?? ''} ${u.datos_basicos?.apellidos ?? ''}`.trim();
    return name || u.correo_electronico || 'Usuario';
  }

  getUserInitials(u: any): string {
    return this.getUserFullName(u).slice(0, 2).toUpperCase();
  }

  onGroupUserSelected(event: any): void {
    const u = event.option.value;
    this.addMemberToGroupId = u?.id ?? '';
    this.groupSearchQuery = this.getUserFullName(u);
  }

  onGroupSearchChange(): void {
    if (!this.groupSearchQuery.trim()) {
      this.addMemberToGroupId = '';
    }
  }

  clearGroupSearch(): void {
    this.groupSearchQuery = '';
    this.addMemberToGroupId = '';
  }

  async removeMemberFromGroup(memberId: number): Promise<void> {
    if (!this.managingGroup) return;
    try {
      await this.dashboardService.removeGroupMember(this.managingGroup.id, memberId);
      await this.loadGroupMembers(this.managingGroup.id);
      await this.loadWorkspaceData(this.board()!.workspace);
    } catch {
      Swal.fire('Error', 'No se pudo remover el miembro.', 'error');
    }
  }

  async deleteGroup(group: UserGroupResponse): Promise<void> {
    const c = await Swal.fire({
      title: `Eliminar grupo "${group.name}"?`,
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar',
    });
    if (c.isConfirmed) {
      try {
        await this.dashboardService.deleteGroup(group.id);
        if (this.managingGroup?.id === group.id) this.managingGroup = null;
        if (this.cardFormGroup === group.id) this.cardFormGroup = null;
        await this.loadWorkspaceData(this.board()!.workspace);
      } catch { Swal.fire('Error', 'No se pudo eliminar.', 'error'); }
    }
  }

  // --- Draft Checklists & Uploads ---
  addDraftChecklist(): void {
    if (this.cardFormNewChecklist.trim()) {
      this.cardFormChecklists.push({ content: this.cardFormNewChecklist.trim(), completed: false });
      this.cardFormNewChecklist = '';
    }
  }
  removeDraftChecklist(idx: number): void {
    this.cardFormChecklists.splice(idx, 1);
  }
  toggleDraftChecklist(idx: number): void {
    this.cardFormChecklists[idx].completed = !this.cardFormChecklists[idx].completed;
  }
  addDraftFiles(event: Event): void {
    const files = (event.target as HTMLInputElement).files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        this.cardFormFiles.push(files[i]);
      }
    }
  }
  removeDraftFile(idx: number): void {
    this.cardFormFiles.splice(idx, 1);
  }
  isImageFile(file: File): boolean {
    return file.type.startsWith('image/');
  }
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ── Delete card ──
  async deleteCard(_list: BoardListResponse, card: CardSummary): Promise<void> {
    const c = await Swal.fire({
      title: `Eliminar "${card.title}"?`,
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar',
    });
    if (c.isConfirmed) {
      try {
        await this.boardService.deleteCard(card.id);
        await this.loadBoard(this.board()!.id);
      } catch { Swal.fire('Error', 'No se pudo eliminar.', 'error'); }
    }
  }

  // ── Helpers ──
  priorityLabel(p: string): string {
    return ({ LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente' } as Record<string, string>)[p] ?? p;
  }

  statusLabel(s: string): string {
    return ({ TODO: 'Por hacer', IN_PROGRESS: 'En progreso', BLOCKED: 'Bloqueado', DONE: 'Hecho' } as Record<string, string>)[s] ?? s;
  }

  statusTone(s: string): string {
    return s.toLowerCase().replace(/_/g, '-');
  }

  listTypeLabel(lt: string): string {
    return ({ TODO: 'Por hacer', IN_PROGRESS: 'En curso', BLOCKED: 'Bloqueadas', DONE: 'Hechas', UNASSIGNED: 'Sin asignar' } as Record<string, string>)[lt] ?? lt;
  }

  getGroupName(groupId: number | null): string {
    if (!groupId) return '';
    return this.workspaceGroups().find(g => g.id === groupId)?.name ?? '';
  }

  getAssigneeName(userId: string | null | undefined): string {
    if (!userId) return '';
    // Resolver desde la lista de usuarios de la compañía (tiene datos_basicos).
    const u: any = this.platformUsers().find((x: any) => x.id === userId);
    if (u) {
      const full = `${u.datos_basicos?.nombres ?? ''} ${u.datos_basicos?.apellidos ?? ''}`.trim();
      if (full) return full;
      if (u.correo_electronico) return u.correo_electronico;
    }
    // Fallback: nombre guardado en la membresía (si el backend lo trae). Nunca el UUID crudo.
    const m = this.workspaceMembers().find(m => m.user === userId);
    if (m && (m.full_name || m.username)) return (m.full_name || m.username) as string;
    return '';
  }

  /**
   * Correo (o cédula) del usuario, para distinguir cuentas homónimas/duplicadas en el
   * selector de asignación. Sin esto, dos personas con el mismo nombre —o la misma
   * persona con dos cuentas— son indistinguibles y se asigna (y notifica) a la equivocada.
   */
  getAssigneeEmail(userId: string | null | undefined): string {
    if (!userId) return '';
    const u: any = this.platformUsers().find((x: any) => x.id === userId);
    if (!u) return '';
    return u.correo_electronico || u.numero_de_documento || '';
  }
}

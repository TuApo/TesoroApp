import { Component, Inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { BoardService } from '../../services/board.service';
import { WorkspaceService } from '../../services/workspace.service';
import { MatderDashboardService } from '../../services/dashboard.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { firstValueFrom } from 'rxjs';
import { CardDetailResponse, CardStatus, CardPriority, LabelResponse, UploadResponse, BoardListResponse } from '../../models/board.models';
import { WorkspaceMemberResponse } from '../../models/workspace.models';
import { UserGroupResponse } from '../../models/dashboard.models';
import Swal from 'sweetalert2';
import { environment } from '@/environments/environment';

@Component({
  selector: 'app-card-detail-dialog',
  standalone: true,
  imports: [
    FormsModule, DatePipe, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatCheckboxModule, MatChipsModule,
    MatSelectModule, MatDividerModule, MatProgressSpinnerModule, MatProgressBarModule,
    MatTooltipModule, MatDatepickerModule, MatNativeDateModule,
  ],
  templateUrl: './card-detail-dialog.component.html',
  styleUrls: ['./card-detail-dialog.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailDialogComponent implements OnInit {
  card = signal<CardDetailResponse | null>(null);
  loading = signal(true);
  changed = false;
  newComment = '';
  newChecklistItem = '';
  availableLabels = signal<LabelResponse[]>([]);
  users = signal<any[]>([]);
  // Listas del tablero y miembros del workspace: para editar Estado (mover de columna) y Responsable.
  boardLists = signal<BoardListResponse[]>([]);
  members = signal<WorkspaceMemberResponse[]>([]);
  // Grupos disponibles: el responsable puede ser una persona O un grupo.
  groups = signal<UserGroupResponse[]>([]);

  statuses: CardStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'];
  priorities: CardPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

  constructor(
    public dialogRef: MatDialogRef<CardDetailDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { cardId: number },
    private boardService: BoardService,
    private workspaceService: WorkspaceService,
    private dashboardService: MatderDashboardService,
    private utilityService: UtilityServiceService,
  ) {}

  async ngOnInit(): Promise<void> {
    // Usuarios de la compañía para resolver el nombre del autor de los comentarios.
    firstValueFrom(this.utilityService.getAllUsers()).then(u => this.users.set(u || [])).catch(() => {});
    await this.loadCard();
  }

  /** Nombre del responsable de la tarjeta resuelto desde la lista de usuarios (no el UUID). */
  assigneeName(): string {
    const c = this.card();
    if (!c) return '';
    const u: any = this.users().find((x: any) => x.id === c.assignee);
    if (u) {
      const full = `${u.datos_basicos?.nombres ?? ''} ${u.datos_basicos?.apellidos ?? ''}`.trim();
      if (full) return full;
      if (u.correo_electronico) return u.correo_electronico;
    }
    return c.assignee_name || '';
  }

  /** Nombre del autor de un comentario resuelto desde la lista de usuarios (no el UUID). */
  authorName(comment: any): string {
    const u: any = this.users().find((x: any) => x.id === comment?.author);
    if (u) {
      const full = `${u.datos_basicos?.nombres ?? ''} ${u.datos_basicos?.apellidos ?? ''}`.trim();
      if (full) return full;
      if (u.correo_electronico) return u.correo_electronico;
    }
    return comment?.author_name || 'Usuario';
  }

  /**
   * Carga inicial: muestra spinner y reemplaza el contenido.
   * Para refrescos posteriores (después de editar campos), usa
   * ``refreshCard()`` que no toca el flag ``loading`` — así el header
   * con el botón de cerrar permanece siempre clickeable y no parpadea
   * la UI con cada update.
   */
  async loadCard(silent: boolean = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      const detail = await this.boardService.getCardDetail(this.data.cardId);
      if (detail) {
        detail.checklist_items = detail.checklist_items ?? [];
        detail.comments = detail.comments ?? [];
        detail.card_labels = detail.card_labels ?? [];
        detail.uploads = detail.uploads ?? [];
      }
      this.card.set(detail);
      if (detail) {
        try {
          const labels = await this.boardService.getLabels(detail.board_id);
          // Filter out already assigned labels
          const assignedIds = new Set((detail.card_labels ?? []).map(cl => cl.label));
          this.availableLabels.set(labels.filter(l => !assignedIds.has(l.id)));
        } catch { /* ignore */ }
        // Datos para editar Estado (listas del tablero) y Responsable (miembros del workspace).
        // Solo la primera vez; los refrescos silenciosos tras editar no vuelven a pedirlos.
        if (this.boardLists().length === 0) this.loadAux(detail.board_id);
      }
    } catch {
      if (!silent) Swal.fire('Error', 'No se pudo cargar el detalle.', 'error');
    } finally {
      if (!silent) this.loading.set(false);
    }
  }

  /** Carga listas del tablero, miembros activos del workspace y grupos (para los selectores). */
  private async loadAux(boardId: number): Promise<void> {
    try {
      const [board, lists] = await Promise.all([
        this.boardService.getBoard(boardId),
        this.boardService.getBoardLists(boardId),
      ]);
      this.boardLists.set(lists ?? []);
      if (board?.workspace) {
        const members = await this.workspaceService.listMembers(board.workspace);
        this.members.set((members ?? []).filter(m => m.active));
        // Grupos del workspace (con fallback a todos los grupos) para asignar por grupo.
        const groups = await this.dashboardService.getGroupsByWorkspace(board.workspace)
          .catch(() => this.dashboardService.getGroups().catch(() => [] as UserGroupResponse[]));
        this.groups.set(groups ?? []);
      }
    } catch { /* selectores quedan vacíos, no bloquea el resto del diálogo */ }
  }

  /** PATCH parcial de la tarjeta + refresco silencioso. Base de todas las ediciones. */
  private async patchCard(payload: Record<string, any>): Promise<void> {
    try {
      await this.boardService.updateCard(this.data.cardId, payload);
      this.changed = true;
      await this.loadCard(true);  // refresh silencioso: no parpadea el header
    } catch {
      Swal.fire('Error', 'No se pudo actualizar.', 'error');
    }
  }

  async updateField(field: string, value: any): Promise<void> {
    await this.patchCard({ [field]: value });
  }

  /**
   * Cambia el estado de la tarjeta. Para no desincronizar tablero y estado, mueve la tarjeta
   * a una columna del mismo tipo si existe (Por hacer/En progreso/Bloqueadas/Completadas).
   */
  async changeStatus(status: CardStatus): Promise<void> {
    const c = this.card();
    if (!c || c.status === status) return;
    const payload: Record<string, any> = { status };
    const target = this.boardLists().find(l => l.list_type === status);
    if (target && target.id !== c.board_list) payload['board_list'] = target.id;
    await this.patchCard(payload);
  }

  /**
   * Token que representa el responsable actual para el selector combinado:
   * ``u:<uuid>`` una persona, ``g:<id>`` un grupo, o ``null`` sin asignar.
   */
  responsibleToken(): string | null {
    const c = this.card();
    if (!c) return null;
    if (c.assignee) return 'u:' + c.assignee;
    if (c.assignee_group) return 'g:' + c.assignee_group;
    return null;
  }

  /**
   * Asigna/reasigna el responsable a una PERSONA o a un GRUPO (excluyentes) según el token
   * elegido en el selector. Al elegir uno se limpia el otro para que la tarjeta tenga un
   * único responsable coherente con lo que se muestra.
   */
  async onResponsibleChange(token: string | null): Promise<void> {
    if (!token) {
      await this.patchCard({ assignee: null, assignee_name: null, assignee_group: null });
      return;
    }
    if (token.startsWith('u:')) {
      const uid = token.slice(2);
      await this.patchCard({ assignee: uid, assignee_name: this.userDisplay(uid) || null, assignee_group: null });
    } else if (token.startsWith('g:')) {
      const gid = Number(token.slice(2));
      await this.patchCard({ assignee: null, assignee_name: null, assignee_group: gid });
    }
  }

  /** Etiqueta visible de un miembro para el selector. */
  memberLabel(m: WorkspaceMemberResponse): string {
    return this.userDisplay(m.user) || m.full_name || m.username || 'Usuario';
  }

  /** Resuelve el nombre de un usuario desde la lista de usuarios de la compañía (no el UUID). */
  private userDisplay(userId: string | null): string {
    const u: any = this.users().find((x: any) => x.id === userId);
    if (u) {
      const full = `${u.datos_basicos?.nombres ?? ''} ${u.datos_basicos?.apellidos ?? ''}`.trim();
      if (full) return full;
      if (u.correo_electronico) return u.correo_electronico;
    }
    return '';
  }

  // --- Comments ---
  async addComment(): Promise<void> {
    if (!this.newComment.trim()) return;
    try {
      await this.boardService.createComment(this.data.cardId, this.newComment.trim());
      this.newComment = '';
      this.changed = true;
      await this.loadCard(true);
    } catch {
      Swal.fire('Error', 'No se pudo comentar.', 'error');
    }
  }

  async deleteComment(commentId: number): Promise<void> {
    const c = await Swal.fire({
      title: 'Eliminar comentario?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
    });
    if (c.isConfirmed) {
      try {
        await this.boardService.deleteComment(commentId);
        this.changed = true;
        await this.loadCard(true);
      } catch {
        Swal.fire('Error', 'No se pudo eliminar.', 'error');
      }
    }
  }

  // --- Checklist (optimistic updates) ---
  async addChecklistItem(): Promise<void> {
    const text = this.newChecklistItem.trim();
    if (!text) return;
    this.newChecklistItem = '';
    try {
      const item = await this.boardService.createChecklistItem(this.data.cardId, text);
      this.changed = true;
      // Insert in-place sin recargar.
      const c = this.card();
      if (c) this.card.set({ ...c, checklist_items: [...c.checklist_items, item] });
    } catch {
      this.newChecklistItem = text;  // restore on failure
      Swal.fire('Error', 'No se pudo agregar.', 'error');
    }
  }

  async toggleChecklistItem(itemId: number, current: boolean): Promise<void> {
    // Flip local primero (responsive UI), luego PATCH.
    const c = this.card();
    if (!c) return;
    const before = c.checklist_items;
    const next = before.map(i => i.id === itemId ? { ...i, completed: !current } : i);
    this.card.set({ ...c, checklist_items: next });
    try {
      await this.boardService.updateChecklistItem(itemId, { completed: !current });
      this.changed = true;
    } catch {
      // Rollback en caso de error.
      this.card.set({ ...c, checklist_items: before });
    }
  }

  async deleteChecklistItem(itemId: number): Promise<void> {
    const c = this.card();
    if (!c) return;
    const before = c.checklist_items;
    this.card.set({ ...c, checklist_items: before.filter(i => i.id !== itemId) });
    try {
      await this.boardService.deleteChecklistItem(itemId);
      this.changed = true;
    } catch {
      this.card.set({ ...c, checklist_items: before });
    }
  }

  checklistProgress(c: CardDetailResponse): number {
    if (!c.checklist_items.length) return 0;
    return Math.round((this.checklistDone(c) / c.checklist_items.length) * 100);
  }

  checklistDone(c: CardDetailResponse): number {
    return c.checklist_items.filter(i => i.completed).length;
  }

  // --- Labels ---
  async addLabel(labelId: number): Promise<void> {
    try {
      await this.boardService.addCardLabel(this.data.cardId, labelId);
      this.changed = true;
      await this.loadCard(true);
    } catch {
      Swal.fire('Error', 'No se pudo agregar la etiqueta.', 'error');
    }
  }

  async removeLabel(labelId: number): Promise<void> {
    try {
      await this.boardService.removeCardLabel(this.data.cardId, labelId);
      this.changed = true;
      await this.loadCard(true);
    } catch {
      Swal.fire('Error', 'No se pudo quitar la etiqueta.', 'error');
    }
  }

  // --- Uploads ---
  async uploadFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await this.boardService.uploadFile(this.data.cardId, file);
      this.changed = true;
      await this.loadCard(true);
    } catch {
      Swal.fire('Error', 'No se pudo subir el archivo.', 'error');
    }
  }

  async deleteUpload(uploadUuid: string): Promise<void> {
    try {
      await this.boardService.deleteUpload(uploadUuid);
      this.changed = true;
      await this.loadCard(true);
    } catch { /* ignore */ }
  }

  /**
   * Descarga un adjunto. Baja el binario por HttpClient (el AuthInterceptor agrega el token)
   * y dispara la descarga en el navegador con un object URL temporal, conservando el nombre
   * original del archivo.
   */
  downloadingUuid: string | null = null;
  async downloadFile(u: UploadResponse): Promise<void> {
    if (this.downloadingUuid) return;
    this.downloadingUuid = u.uuid;
    try {
      const blob = await this.boardService.downloadUpload(u.uuid);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = u.original_name || 'archivo';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      Swal.fire('Error', 'No se pudo descargar el archivo.', 'error');
    } finally {
      this.downloadingUuid = null;
    }
  }

  /** Build the full download URL for an upload file */
  downloadUrl(fileUrl: string): string {
    if (!fileUrl) return '';
    // If the file URL is already absolute, use it directly
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      return fileUrl;
    }
    // Otherwise prefix with backend base URL
    const base = environment.apiUrl.replace(/\/+$/, '');
    return `${base}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
  }

  isImage(mime: string | null): boolean {
    return !!mime && mime.startsWith('image/');
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  mimeIcon(mime: string | null): string {
    if (!mime) return 'insert_drive_file';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'picture_as_pdf';
    if (mime.includes('spreadsheet') || mime.includes('excel')) return 'table_chart';
    if (mime.includes('word') || mime.includes('document')) return 'description';
    if (mime.startsWith('video/')) return 'videocam';
    if (mime.startsWith('audio/')) return 'audiotrack';
    return 'insert_drive_file';
  }

  // --- Delete card ---
  async deleteCard(): Promise<void> {
    const c = await Swal.fire({
      title: 'Eliminar tarjeta?',
      text: 'Esta accion no se puede deshacer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
    });
    if (c.isConfirmed) {
      try {
        await this.boardService.deleteCard(this.data.cardId);
        this.dialogRef.close(true);
      } catch {
        Swal.fire('Error', 'No se pudo eliminar.', 'error');
      }
    }
  }

  close(): void {
    this.dialogRef.close(this.changed);
  }

  // --- Due date (datepicker) ---
  /** Convierte ``due_at`` (ISO string) del backend a Date para el datepicker. */
  dueDateValue(): Date | null {
    const c = this.card();
    return c?.due_at ? new Date(c.due_at) : null;
  }

  /** El datepicker emite Date; lo serializamos a ISO y disparamos updateField. */
  async onDueDateChange(d: Date | null): Promise<void> {
    if (!d) {
      await this.updateField('due_at', null);
      return;
    }
    // Mediodía local → la fecha en UTC coincide con la local (evita el off-by-one del calendario).
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    await this.updateField('due_at', local.toISOString());
  }

  // --- Helpers ---
  isOverdue(dueAt: string): boolean {
    return new Date(dueAt) < new Date();
  }

  statusLabel(s: string): string {
    const m: Record<string, string> = { TODO: 'Por hacer', IN_PROGRESS: 'En progreso', BLOCKED: 'Bloqueado', DONE: 'Hecho' };
    return m[s] ?? s;
  }

  statusTone(s: string): string {
    return s.toLowerCase().replace(/_/g, '-');
  }

  priorityLabel(p: string): string {
    const m: Record<string, string> = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente' };
    return m[p] ?? p;
  }

  priorityColor(p: string): string {
    const m: Record<string, string> = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444', URGENT: '#7c3aed' };
    return m[p] ?? '#9e9e9e';
  }
}

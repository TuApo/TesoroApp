import { Component, OnInit, signal, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { WorkspaceService } from '../../services/workspace.service';
import { MatderDashboardService } from '../../services/dashboard.service';
import { MatderHistoryService } from '../../services/matder-history.service';
import { MatderMobileNavComponent } from '../../components/matder-mobile-nav/matder-mobile-nav.component';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { WorkspaceResponse, WorkspaceMemberResponse } from '../../models/workspace.models';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-workspaces-page',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule,
    MatProgressSpinnerModule, MatTooltipModule, MatAutocompleteModule, MatderMobileNavComponent
  ],
  templateUrl: './workspaces-page.component.html',
  styleUrls: ['./workspaces-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspacesPageComponent implements OnInit {
  workspaces = signal<WorkspaceResponse[]>([]);
  loading = signal(true);
  showForm = signal(false);
  formName = '';
  formDesc = '';
  searchQuery = '';
  filterState = 'all';

  // Detail mode
  detailMode = false;
  selectedWs: WorkspaceResponse | null = null;
  members = signal<WorkspaceMemberResponse[]>([]);
  membersLoading = signal(false);
  showAddMember = false;
  newMemberUser = '';
  newMemberRole = 'MEMBER';
  
  // Company users for autocomplete
  companyUsers: any[] = [];
  filteredCompanyUsers: any[] = [];

  constructor(
    private wsService: WorkspaceService,
    private dashboardService: MatderDashboardService,
    private historyService: MatderHistoryService,
    private utilityService: UtilityServiceService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.load();
    // Check if we have an ID in the route (detail mode)
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      const ws = this.workspaces().find(w => w.id === Number(id));
      if (ws) {
        this.openDetail(ws);
      } else {
        try {
          const detail = await this.wsService.get(Number(id));
          this.openDetail(detail);
        } catch { /* fallback to list */ }
      }
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.workspaces.set(await this.wsService.list());
      this.utilityService.getAllUsers().subscribe({
        next: (users: any[]) => {
          this.companyUsers = users;
          this.filteredCompanyUsers = users;
          this.cdr.markForCheck(); // refresca nombres de propietario (OnPush)
        }
      });
    } catch {
      this.workspaces.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  get filteredWorkspaces(): WorkspaceResponse[] {
    let result = this.workspaces();
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(w =>
        w.name.toLowerCase().includes(q) ||
        (w.description ?? '').toLowerCase().includes(q) ||
        (w.owner_name ?? '').toLowerCase().includes(q)
      );
    }
    if (this.filterState === 'with_boards') {
      result = result.filter(w => w.board_count > 0);
    } else if (this.filterState === 'empty') {
      result = result.filter(w => w.board_count === 0);
    } else if (this.filterState === 'favorites') {
      result = result.filter(w => !!w.is_favorite);
    }
    return result;
  }

  /**
   * Marca/desmarca el workspace como favorito. Optimistic update:
   * cambiamos el estado local antes de la respuesta del servidor para
   * que la UI se sienta instantánea.
   */
  async toggleFavorite(ws: WorkspaceResponse): Promise<void> {
    const before = !!ws.is_favorite;
    this.workspaces.set(this.workspaces().map(
      w => w.id === ws.id ? { ...w, is_favorite: !before } : w,
    ));
    try {
      await this.dashboardService.toggleFavorite('WORKSPACE', ws.id);
    } catch {
      // Rollback en caso de fallo.
      this.workspaces.set(this.workspaces().map(
        w => w.id === ws.id ? { ...w, is_favorite: before } : w,
      ));
      Swal.fire('Error', 'No se pudo actualizar favorito.', 'error');
    }
  }

  // Campos reales del usuario de gestion_admin: id (UUID), numero_de_documento,
  // correo_electronico y datos_basicos.{nombres,apellidos}. (Antes se leían
  // u.nombres / u.identificacion, que NO existen → autocompletado vacío/roto.)
  private uNombres(u: any): string { return (u?.datos_basicos?.nombres ?? u?.nombres ?? '').toString(); }
  private uApellidos(u: any): string { return (u?.datos_basicos?.apellidos ?? u?.apellidos ?? '').toString(); }
  private uDoc(u: any): string { return (u?.numero_de_documento ?? u?.identificacion ?? '').toString(); }
  private uCorreo(u: any): string { return (u?.correo_electronico ?? u?.correo ?? '').toString(); }

  /** displayWith del autocomplete: el modelo guarda el UUID, pero el input muestra el nombre. */
  displayMember = (val: string): string => {
    if (!val) return '';
    const u = this.companyUsers.find(x => x.id === val);
    return u ? this.getUserDisplayName(u) : val;
  };

  filterUsers(): void {
    if (!this.newMemberUser) {
      this.filteredCompanyUsers = this.companyUsers;
      return;
    }
    const q = this.newMemberUser.toLowerCase();
    this.filteredCompanyUsers = this.companyUsers.filter(u =>
      this.uNombres(u).toLowerCase().includes(q) ||
      this.uApellidos(u).toLowerCase().includes(q) ||
      this.uCorreo(u).toLowerCase().includes(q) ||
      this.uDoc(u).toLowerCase().includes(q)
    );
  }

  getUserDisplayName(user: any): string {
    if (!user) return '';
    return `${this.uNombres(user)} ${this.uApellidos(user)} - ${this.uCorreo(user)}`.trim();
  }

  /** Nombre legible de un miembro: resuelve desde companyUsers por UUID; cae al doc/UUID. */
  memberName(m: any): string {
    const u = this.companyUsers.find(x => x.id === m?.user);
    if (u) {
      const full = `${this.uNombres(u)} ${this.uApellidos(u)}`.trim();
      if (full) return full;
      if (this.uCorreo(u)) return this.uCorreo(u);
    }
    return m?.full_name || m?.username || m?.user || 'Usuario';
  }

  /** Nombre legible del propietario del workspace; cae a '—' si no se puede resolver (evita mostrar el UUID). */
  ownerName(ws: any): string {
    if (ws?.owner_name) return ws.owner_name;
    const u = this.companyUsers.find(x => x.id === ws?.owner);
    if (u) {
      const full = `${this.uNombres(u)} ${this.uApellidos(u)}`.trim();
      if (full) return full;
      if (this.uCorreo(u)) return this.uCorreo(u);
    }
    return '—';
  }

  async create(): Promise<void> {
    if (!this.formName.trim()) return;
    try {
      await this.wsService.create({ name: this.formName.trim(), description: this.formDesc.trim() || undefined });
      this.formName = '';
      this.formDesc = '';
      this.showForm.set(false);
      await this.load();
      Swal.fire('Creado', 'Workspace creado exitosamente.', 'success');
    } catch {
      Swal.fire('Error', 'No se pudo crear.', 'error');
    }
  }

  async remove(ws: WorkspaceResponse): Promise<void> {
    if (!ws.can_delete_workspace) {
      Swal.fire('Sin permiso', 'Solo el owner puede eliminar.', 'info');
      return;
    }
    const c = await Swal.fire({
      title: `Eliminar "${ws.name}"?`,
      text: 'Se borran boards, listas y tareas.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
    });
    if (!c.isConfirmed) return;
    try {
      await this.wsService.delete(ws.id);
      if (this.detailMode) this.backToList();
      await this.load();
    } catch {
      Swal.fire('Error', 'No se pudo eliminar.', 'error');
    }
  }

  open(ws: WorkspaceResponse): void {
    this.historyService.push({ type: 'workspace', id: ws.id, name: ws.name, subtitle: `${ws.member_count} miembros` });
    this.router.navigate([`/dashboard/matder/workspaces/${ws.id}`]);
    this.openDetail(ws);
  }

  openDetail(ws: WorkspaceResponse): void {
    this.detailMode = true;
    this.selectedWs = ws;
    this.loadMembers(ws.id);
  }

  backToList(): void {
    this.detailMode = false;
    this.selectedWs = null;
    this.members.set([]);
    this.router.navigate(['/dashboard/matder/workspaces']);
  }

  async loadMembers(wsId: number): Promise<void> {
    this.membersLoading.set(true);
    try {
      this.members.set(await this.wsService.listMembers(wsId));
    } catch {
      this.members.set([]);
    } finally {
      this.membersLoading.set(false);
    }
  }

  async addMember(): Promise<void> {
    if (!this.newMemberUser.trim() || !this.selectedWs) return;
    try {
      await this.wsService.addMember(this.selectedWs.id, this.newMemberUser.trim(), this.newMemberRole);
      this.newMemberUser = '';
      this.showAddMember = false;
      await this.loadMembers(this.selectedWs.id);
      Swal.fire('Agregado', 'Miembro agregado correctamente.', 'success');
    } catch {
      Swal.fire('Error', 'No se pudo agregar el miembro.', 'error');
    }
  }

  async updateMemberRole(member: WorkspaceMemberResponse, role: string): Promise<void> {
    if (!this.selectedWs) return;
    try {
      await this.wsService.updateMember(this.selectedWs.id, member.id, { role });
      await this.loadMembers(this.selectedWs.id);
    } catch {
      Swal.fire('Error', 'No se pudo actualizar el rol.', 'error');
    }
  }

  async toggleMemberActive(member: WorkspaceMemberResponse): Promise<void> {
    if (!this.selectedWs) return;
    try {
      await this.wsService.updateMember(this.selectedWs.id, member.id, { active: !member.active });
      await this.loadMembers(this.selectedWs.id);
    } catch {
      Swal.fire('Error', 'No se pudo actualizar.', 'error');
    }
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }

  goToBoards(wsId: number): void {
    this.router.navigate(['/dashboard/matder/boards'], { queryParams: { workspace: wsId } });
  }

  roleLabel(r: string | null): string {
    if (!r) return '';
    const m: Record<string, string> = { OWNER: 'Owner', MANAGER: 'Manager', MEMBER: 'Miembro', VIEWER: 'Viewer' };
    return m[r] ?? r.charAt(0) + r.slice(1).toLowerCase();
  }

  /** Descripción de qué puede hacer cada rol en el workspace. */
  rolePerms(r: string | null): string {
    switch ((r || '').toUpperCase()) {
      case 'OWNER':   return 'Control total: gestiona miembros, crea y edita tableros y puede eliminar el workspace.';
      case 'MANAGER': return 'Gestiona miembros y contenido (tableros y tareas). No puede eliminar el workspace.';
      case 'MEMBER':  return 'Crea y edita tableros y tareas. No gestiona miembros.';
      case 'VIEWER':  return 'Solo lectura: ve tableros y tareas, sin editar.';
      default:        return '';
    }
  }

  /** Ícono representativo del rol. */
  roleIcon(r: string | null): string {
    switch ((r || '').toUpperCase()) {
      case 'OWNER':   return 'workspace_premium';
      case 'MANAGER': return 'manage_accounts';
      case 'MEMBER':  return 'edit';
      case 'VIEWER':  return 'visibility';
      default:        return 'person';
    }
  }
}

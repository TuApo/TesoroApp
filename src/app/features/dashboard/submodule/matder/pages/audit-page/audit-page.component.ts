import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatderDashboardService } from '../../services/dashboard.service';
import { AuditLogResponse } from '../../models/dashboard.models';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './audit-page.component.html',
  styleUrls: ['./audit-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditPageComponent implements OnInit {
  logs = signal<AuditLogResponse[]>([]);
  platformUsers = signal<any[]>([]);
  loading = signal(true);
  search = '';
  entityFilter = '';
  userFilter = '';
  fromDate = '';
  toDate = '';

  constructor(
    private ds: MatderDashboardService,
    private utility: UtilityServiceService,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const [logs, users] = await Promise.all([
        this.ds.getAuditLogs(),
        firstValueFrom(this.utility.getAllUsers()).catch(() => []),
      ]);
      this.logs.set(logs);
      this.platformUsers.set(users || []);
    } catch { /* empty */ }
    finally { this.loading.set(false); }
  }

  // ── Filtro ───────────────────────────────────────────────────────────────
  get filtered(): AuditLogResponse[] {
    let result = this.logs();
    if (this.search) {
      const q = this.search.toLowerCase();
      result = result.filter(l =>
        this.actionLabel(l.action).toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        this.entityLabel(l.entity_type).toLowerCase().includes(q) ||
        l.entity_type.toLowerCase().includes(q) ||
        this.actorName(l.user).toLowerCase().includes(q) ||
        this.actorEmail(l.user).toLowerCase().includes(q) ||
        (l.entity_id ?? '').toLowerCase().includes(q) ||
        this.detailText(l).toLowerCase().includes(q)
      );
    }
    if (this.entityFilter) result = result.filter(l => l.entity_type === this.entityFilter);
    if (this.userFilter)  result = result.filter(l => (l.user ?? '__none__') === this.userFilter);
    if (this.fromDate) {
      const from = new Date(this.fromDate).getTime();
      result = result.filter(l => new Date(l.created_at).getTime() >= from);
    }
    if (this.toDate) {
      // Incluir todo el día 'hasta' (hasta 23:59:59).
      const to = new Date(this.toDate).getTime() + 86_400_000 - 1;
      result = result.filter(l => new Date(l.created_at).getTime() <= to);
    }
    // Del más reciente al más antiguo (defensivo: el backend ya ordena DESC, pero
    // así el orden es correcto pase lo que pase con la fuente).
    return [...result].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  get hasFilters(): boolean {
    return !!(this.search || this.entityFilter || this.userFilter || this.fromDate || this.toDate);
  }

  clearFilters(): void {
    this.search = ''; this.entityFilter = ''; this.userFilter = '';
    this.fromDate = ''; this.toDate = '';
  }

  get entityTypes(): string[] {
    return [...new Set(this.logs().map(l => l.entity_type))].sort();
  }

  /** Actores distintos presentes en el log (para el filtro "Usuario"). */
  get actors(): { id: string; label: string }[] {
    const ids = [...new Set(this.logs().map(l => l.user ?? '__none__'))];
    return ids
      .map(id => ({ id, label: id === '__none__' ? 'Sistema' : this.actorName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // ── Resolución de identidad (quién) ────────────────────────────────────────
  actorName(userId: string | null | undefined): string {
    if (!userId) return 'Sistema';
    const u: any = this.platformUsers().find((x: any) => x.id === userId);
    if (u) {
      const full = `${u.datos_basicos?.nombres ?? ''} ${u.datos_basicos?.apellidos ?? ''}`.trim();
      if (full) return full;
      if (u.correo_electronico) return u.correo_electronico;
    }
    // Nunca el UUID crudo entero: recorta para que sea legible.
    return userId.length > 8 ? userId.slice(0, 8) + '…' : userId;
  }

  actorEmail(userId: string | null | undefined): string {
    if (!userId) return '';
    const u: any = this.platformUsers().find((x: any) => x.id === userId);
    return u?.correo_electronico || u?.numero_de_documento || '';
  }

  actorInitials(userId: string | null | undefined): string {
    const n = this.actorName(userId);
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }

  // ── Qué (acción + entidad en lenguaje claro) ───────────────────────────────
  actionLabel(action: string): string {
    return ({
      create: 'Creó', add: 'Agregó', remove: 'Quitó', delete: 'Eliminó',
      update: 'Actualizó', edit: 'Editó', move: 'Movió',
      import_boards: 'Importó tableros', attach: 'Vinculó', detach: 'Desvinculó',
      login: 'Inició sesión', assign: 'Asignó', unassign: 'Quitó la asignación de',
    } as Record<string, string>)[action.toLowerCase()]
      ?? (action ? action.charAt(0).toUpperCase() + action.slice(1) : action);
  }

  /** Submódulo de Matder afectado (tipo de entidad, en español). */
  entityLabel(entity: string): string {
    return ({
      upload: 'Adjunto', favorite: 'Favorito', import: 'Importación',
      board: 'Tablero', card: 'Tarjeta', list: 'Lista',
      workspace: 'Espacio de trabajo', label: 'Etiqueta', comment: 'Comentario',
      checklist_item: 'Ítem de checklist', group: 'Grupo',
      card_assignment: 'Asignación de tarjeta', group_membership: 'Miembro de grupo',
      admin_user: 'Usuario (admin)', admin_user_group: 'Grupo de usuarios',
      admin_user_group_member: 'Miembro de grupo', admin_group_workspace: 'Grupo ↔ Espacio',
      admin_workspace_group: 'Espacio ↔ Grupo',
    } as Record<string, string>)[entity?.toLowerCase()] ?? (entity || '—');
  }

  /** Artículo (el/la) del tipo de entidad, para armar frases naturales. */
  private entityArticle(entity: string): string {
    return ({
      card: 'la', list: 'la', label: 'la', import: 'la',
      workspace: 'el', board: 'el', comment: 'el', upload: 'el', favorite: 'el',
      checklist_item: 'el', group: 'el', card_assignment: 'la',
    } as Record<string, string>)[entity?.toLowerCase()] ?? 'el';
  }

  /** Nombre/título del objeto afectado (workspace, tablero, lista, tarjeta, archivo…). */
  subjectName(l: AuditLogResponse): string {
    const m = (l.metadata ?? {}) as Record<string, unknown>;
    return String(m['name'] ?? m['title'] ?? m['filename'] ?? '').trim();
  }

  /** Frase del objeto: "la tarjeta", "el tablero"… ('' si la acción ya es autodescriptiva). */
  objectPhrase(l: AuditLogResponse): string {
    if (l.action?.toLowerCase() === 'import_boards') return '';  // "Importó tableros" ya lo dice
    return `${this.entityArticle(l.entity_type)} ${this.entityLabel(l.entity_type).toLowerCase()}`;
  }

  /** Ubicación jerárquica: Espacio › Tablero › Lista (los presentes en el metadata). */
  locationParts(l: AuditLogResponse): { label: string; value: string }[] {
    const m = (l.metadata ?? {}) as Record<string, unknown>;
    const out: { label: string; value: string }[] = [];
    if (m['workspace']) out.push({ label: 'Espacio', value: String(m['workspace']) });
    if (m['board'])     out.push({ label: 'Tablero', value: String(m['board']) });
    // La lista contenedora se muestra solo si la entidad NO es la lista misma (evita duplicar).
    if (m['list'] && l.entity_type?.toLowerCase() !== 'list') {
      out.push({ label: 'Lista', value: String(m['list']) });
    }
    return out;
  }

  /** Detalles adicionales humanizados (estado, prioridad, responsable, movimiento, cambios…). */
  extraParts(l: AuditLogResponse): string[] {
    const m = (l.metadata ?? {}) as Record<string, unknown>;
    const out: string[] = [];
    if (m['status'])   out.push(`Estado: ${this.statusLabel(String(m['status']))}`);
    if (m['priority']) out.push(`Prioridad: ${this.priorityLabel(String(m['priority']))}`);
    if (m['assignee']) out.push(`Responsable: ${String(m['assignee'])}`);
    if (m['from_list'] || m['to_list']) {
      if (m['from_list'] && m['to_list'] && m['from_list'] === m['to_list']) {
        out.push(`Reordenó en «${String(m['to_list'])}»`);
      } else {
        out.push(`De «${String(m['from_list'] ?? '—')}» a «${String(m['to_list'] ?? '—')}»`);
      }
    }
    if (m['changed']) out.push(`Cambió: ${String(m['changed'])}`);
    if (m['boards'] !== undefined || m['cards'] !== undefined) {
      out.push(`${Number(m['boards'] ?? 0)} tablero(s), ${Number(m['cards'] ?? 0)} tarjeta(s)`);
    }
    if (m['role'])     out.push(`Rol: ${String(m['role'])}`);
    if (m['group_id']) out.push(`Grupo: ${String(m['group_id'])}`);
    return out;
  }

  private statusLabel(s: string): string {
    return ({
      TODO: 'Por hacer', IN_PROGRESS: 'En progreso', BLOCKED: 'Bloqueada', DONE: 'Completada',
      COMPLETED: 'Completada', FAILED: 'Fallida', PENDING: 'Pendiente', PROCESSING: 'En proceso',
    } as Record<string, string>)[s] ?? s;
  }

  private priorityLabel(p: string): string {
    return ({ LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente' } as Record<string, string>)[p] ?? p;
  }

  /** Detalles legibles a partir del metadata (payload) del evento. */
  detailText(l: AuditLogResponse): string {
    const m = l.metadata;
    if (!m || typeof m !== 'object') return '';
    const label: Record<string, string> = {
      filename: 'Archivo', card: 'Tarjeta', cards: 'Tarjetas', boards: 'Tableros',
      workspace: 'Espacio', name: 'Nombre', group_id: 'Grupo', status: 'Estado',
      board: 'Tablero', list: 'Lista', title: 'Título', role: 'Rol',
    };
    const parts: string[] = [];
    for (const [k, v] of Object.entries(m)) {
      if (v === null || v === undefined || v === '' || typeof v === 'object') continue;
      parts.push(`${label[k] ?? k}: ${String(v)}`);
    }
    return parts.join('  ·  ');
  }

  // ── Presentación ───────────────────────────────────────────────────────────
  actionIcon(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add') || a.includes('import')) return 'add_circle';
    if (a.includes('delete') || a.includes('remove') || a.includes('detach')) return 'remove_circle';
    if (a.includes('update') || a.includes('edit') || a.includes('move')) return 'edit';
    if (a.includes('login') || a.includes('auth')) return 'login';
    if (a.includes('attach') || a.includes('assign')) return 'link';
    return 'info';
  }

  actionColor(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add') || a.includes('import')) return '#16a34a';
    if (a.includes('delete') || a.includes('remove') || a.includes('detach')) return '#dc2626';
    if (a.includes('update') || a.includes('edit') || a.includes('move')) return '#2563eb';
    if (a.includes('attach') || a.includes('assign')) return '#7c3aed';
    return '#6b7280';
  }

  /** Tiempo relativo ("hace 5 min") para lectura rápida en auditoría. */
  timeAgo(iso: string): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const s = Math.floor((Date.now() - then) / 1000);
    if (s < 60) return 'hace un momento';
    const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24); if (d < 30) return `hace ${d} d`;
    const mo = Math.floor(d / 30); if (mo < 12) return `hace ${mo} mes${mo > 1 ? 'es' : ''}`;
    return `hace ${Math.floor(mo / 12)} año(s)`;
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }
}

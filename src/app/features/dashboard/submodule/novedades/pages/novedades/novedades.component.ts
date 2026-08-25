import { Component, OnInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import {
  NotificationCenterService,
  NotificationItem,
  NotificationType,
} from '../../../../../../core/services/notification-center.service';
import { NotificationTargetService } from '../../../../../../core/services/notification-target.service';

const PAGE_SIZE = 30;

/** Filtro activo: los dos transversales, o la clave de un tipo del catálogo. */
type Filtro = 'todas' | 'no-leidas' | string;

@Component({
  selector: 'app-novedades',
  standalone: true,
  imports: [
    DatePipe, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatTooltipModule,
  ],
  templateUrl: './novedades.component.html',
  styleUrls: ['./novedades.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NovedadesComponent implements OnInit {

  items = signal<NotificationItem[]>([]);
  /**
   * Chips construidos desde el catálogo del backend, no desde una constante.
   * Ese era el tercer sitio donde estaba duplicado el catálogo de tipos; ahora
   * un tipo nuevo aparece en los filtros sin recompilar el front.
   */
  tipos = signal<NotificationType[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  hasMore = signal(false);
  unread = signal(0);
  filtro = signal<Filtro>('todas');
  page = signal(0);
  archivando = signal<Set<string>>(new Set());

  leidas = computed(() => this.items().filter(n => n.leida).length);

  constructor(
    private notifSvc: NotificationCenterService,
    private target: NotificationTargetService,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    // El catálogo no bloquea la bandeja: si falla, se listan las novedades
    // igual y solo se pierden los chips por tipo.
    firstValueFrom(this.notifSvc.catalogo())
      .then(t => this.tipos.set(t || []))
      .catch(() => this.tipos.set([]));
    await this.cargar(true);
  }

  private async cargar(reset: boolean): Promise<void> {
    if (reset) { this.loading.set(true); this.page.set(0); }
    else this.loadingMore.set(true);

    const f = this.filtro();
    try {
      const [lista, contador] = await Promise.all([
        firstValueFrom(this.notifSvc.list({
          tipo: f !== 'todas' && f !== 'no-leidas' ? f : undefined,
          soloNoLeidas: f === 'no-leidas',
          page: this.page(),
          size: PAGE_SIZE,
        })),
        reset ? firstValueFrom(this.notifSvc.unreadCount()) : Promise.resolve(null),
      ]);
      const recibidas = lista || [];
      if (reset) this.items.set(recibidas);
      else this.items.update(prev => [...prev, ...recibidas]);
      this.hasMore.set(recibidas.length === PAGE_SIZE);
      if (contador) this.unread.set(contador.count);
    } catch { /* la vista ya muestra el estado vacío */ }
    finally { this.loading.set(false); this.loadingMore.set(false); }
  }

  async setFiltro(f: Filtro): Promise<void> {
    if (this.filtro() === f) return;
    this.filtro.set(f);
    await this.cargar(true);
  }

  async cargarMas(): Promise<void> {
    this.page.update(p => p + 1);
    await this.cargar(false);
  }

  esNavegable(n: NotificationItem): boolean {
    return this.target.esNavegable(n.destino_tipo, n.destino_valor);
  }

  destacada(n: NotificationItem): boolean {
    return n.urgencia === 'URGENTE' || n.urgencia === 'CRITICA';
  }

  async abrir(n: NotificationItem): Promise<void> {
    await this.marcarLeida(n);
    await this.target.abrir(n.destino_tipo, n.destino_valor);
  }

  async marcarLeida(n: NotificationItem): Promise<void> {
    if (n.leida) return;
    try {
      await firstValueFrom(this.notifSvc.markRead(n.id));
      this.items.update(l => l.map(i => i.id === n.id ? { ...i, leida: true } : i));
      this.unread.update(v => Math.max(0, v - 1));
    } catch { /* reintenta al recargar */ }
  }

  async leerTodas(): Promise<void> {
    try {
      await firstValueFrom(this.notifSvc.markAllRead());
      this.items.update(l => l.map(n => ({ ...n, leida: true })));
      this.unread.set(0);
    } catch { /* */ }
  }

  /**
   * Archiva (no borra). La notificación sale de la bandeja pero permanece en el
   * histórico: por eso el botón dice "Archivar" y no "Eliminar".
   */
  async archivar(ev: Event, n: NotificationItem): Promise<void> {
    ev.stopPropagation();
    this.archivando.update(s => new Set(s).add(n.id));
    try {
      await firstValueFrom(this.notifSvc.archive(n.id));
      this.items.update(l => l.filter(i => i.id !== n.id));
      if (!n.leida) this.unread.update(v => Math.max(0, v - 1));
    } catch { /* */ }
    finally {
      this.archivando.update(s => { const c = new Set(s); c.delete(n.id); return c; });
    }
  }

  async archivarLeidas(): Promise<void> {
    try {
      await firstValueFrom(this.notifSvc.archiveRead());
      this.items.update(l => l.filter(n => !n.leida));
    } catch { /* */ }
  }

  estaArchivando(id: string): boolean {
    return this.archivando().has(id);
  }

  volver(): void {
    this.router.navigate(['/dashboard']);
  }
}

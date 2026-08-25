import {
  Component,
  EventEmitter,
  OnInit,
  OnDestroy,
  Output,
  Inject,
  PLATFORM_ID,
  HostListener,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

import { HttpClient } from '@angular/common/http';
import { environment } from '@/environments/environment';

import { MatIconModule } from '@angular/material/icon';
import { SharedModule } from '../../../../shared/shared.module';
import { NetworkStatusService } from '../../../../core/services/network-status.service';
import { OfflineSyncService } from '../../../../core/services/offline-sync.service';
import { getLocalStorageItem, setLocalStorageItem, clearLocalStorage } from '../../../../core/utils/safe-storage';
import { QuickAccessService } from '../../../../core/security/quick-access.service';

export interface PermNode {
  id: string;
  nombre: string;
  ruta?: string;
  icono?: string;
  orden?: number;
  acciones?: string[];
  permiso_ids?: Record<string, string>;
  hijos?: PermNode[];

  // Campos pre-calculados durante decorate(). El template los lee directo
  // para no recomputar string-ops y recorridos en cada change-detection.
  __route?: string;
  __icon?: string;
  __canRead?: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-navbar',
  standalone: true,
  imports: [SharedModule, RouterModule, MatIconModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
})
export class NavbarComponent implements OnInit, OnDestroy {
  @Output() public menuToggle = new EventEmitter<boolean>();

  public isSidebarHidden = false;
  public isMobile = false;
  public pinOpen = false;
  public isMobileCompact = false;
  public currentRoute?: string;
  public isOnline = true;
  public pendingCount = 0;
  public syncProgress: { current: number; total: number; phase: string } | null = null;

  // Lo que el template realmente renderiza: árbol decorado y filtrado por permiso.
  public visibleRoots: PermNode[] = [];
  public activeRoot: PermNode | null = null;

  // Set de root.id activos por la ruta actual. Lookup O(1) desde el template
  // en lugar del DFS-por-render que hacía `isTreeActive` antes.
  private activeRootIds = new Set<string>();

  private expanded: Record<string, boolean> = {};
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly CLOSE_DELAY = 500;
  private readonly MOBILE_BREAKPOINT = 900;
  private readonly READ_KEYS = new Set(['VER', 'LEER', 'READ', 'VIEW']);

  // Roles autorizados a ver los nodos de modulo "ADMINISTRATIVO" / "ADMINISTRATIVOS".
  // Cualquier otro rol los oculta del sidebar via stripAdministrativeNodes().
  private readonly PRIVILEGED_ROLES = new Set(['ADMIN', 'GERENCIA']);

  // Nombres exactos (case/acentos-insensitive) de nodos a esconder cuando el
  // usuario NO tiene rol privilegiado. Coincide con como llegan del backend.
  private readonly ADMINISTRATIVE_NODE_NAMES = new Set([
    'ADMINISTRATIVO',
    'ADMINISTRATIVOS',
  ]);

  private routerSubscription?: Subscription;
  private offlineSubs: Subscription[] = [];
  private onQueueUpdated?: () => void;
  private onRequestFailed?: (ev: Event) => void;
  private onWriteQueued?: (ev: Event) => void;
  // Acumulador para agrupar en UN solo toast los envíos encolados en ráfaga
  // (ej: subir 30 PDFs offline) en vez de disparar 30 toasts.
  private queuedToastCount = 0;
  private queuedToastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly isBrowser: boolean;

  constructor(
    @Inject(PLATFORM_ID) platformId: object,
    private router: Router,
    private http: HttpClient,
    private networkStatus: NetworkStatusService,
    private offlineSync: OfflineSyncService,
    private cdr: ChangeDetectorRef,
    private quickAccess: QuickAccessService,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    if (this.isBrowser) {
      // Subs guardadas para teardown en ngOnDestroy. Antes el navbar dejaba
      // 3 subs y 2 listeners abiertos en cada reinstancia (HMR, login/logout
      // repetido) → toasts duplicados y leak.
      this.offlineSubs.push(
        this.networkStatus.isOnline$.subscribe(status => { this.isOnline = status; }),
        this.offlineSync.pendingCount$.subscribe(count => { this.pendingCount = count; }),
        this.offlineSync.syncProgress$.subscribe(progress => {
          this.syncProgress = progress;
          this.cdr.markForCheck();
        }),
      );

      this.onQueueUpdated = () => this.offlineSync.updatePendingCount();
      window.addEventListener('offline-queue-updated', this.onQueueUpdated);

      // Toast no-bloqueante cuando una request encolada falla en replay.
      // Antes el fallo era silencioso: la fila se marcaba 'failed' y los
      // archivos se borraban sin avisar al usuario.
      this.onRequestFailed = (ev: Event) => {
        const detail = (ev as CustomEvent).detail || {};
        const url: string = detail.url || '';
        const reason: string = detail.reason || 'Error desconocido';
        const shortPath = (() => {
          try { return new URL(url, environment.apiUrl).pathname; } catch { return url; }
        })();
        Swal.fire({
          toast: true,
          position: 'bottom-end',
          icon: 'error',
          title: 'Envío offline falló',
          text: `${shortPath} → ${reason}`,
          timer: 6000,
          showConfirmButton: false,
        });
      };
      window.addEventListener('offline-request-failed', this.onRequestFailed);

      // Feedback positivo: cuando un envío se guarda en cola offline (porque no
      // hay red), avisamos al usuario de forma NO bloqueante. Antes el
      // interceptor devolvía un 200 "mock" y los componentes mostraban "subido
      // correctamente" — el usuario creía que el archivo ya estaba en el
      // servidor. Este toast (agrupado por ráfaga) deja claro que quedó local
      // y se subirá al reconectar. Cubre los 5 módulos de subida sin tocarlos.
      this.onWriteQueued = () => {
        this.queuedToastCount += 1;
        if (this.queuedToastTimer) clearTimeout(this.queuedToastTimer);
        this.queuedToastTimer = setTimeout(() => this.flushQueuedToast(), 700);
      };
      window.addEventListener('offline-write-queued', this.onWriteQueued);
    }
  }

  /** Muestra UN toast resumiendo los envíos encolados durante la última ráfaga. */
  private flushQueuedToast(): void {
    const n = this.queuedToastCount;
    this.queuedToastCount = 0;
    this.queuedToastTimer = null;
    if (n <= 0) return;

    const total = this.pendingCount || n;
    Swal.fire({
      toast: true,
      position: 'bottom-end',
      icon: 'info',
      iconColor: '#d97706',
      title: 'Guardado sin conexión',
      html:
        `${n === 1 ? 'Un envío quedó' : `${n} envíos quedaron`} en cola local.` +
        `<br><small style="color:#64748b;">Se subirá automáticamente al reconectar` +
        ` · ${total} pendiente(s).</small>`,
      timer: 5000,
      timerProgressBar: true,
      showConfirmButton: false,
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.isBrowser) {
      this.loadPermTreeFromStorage();
      this.refreshPermisos();
      this.loadUIState();
      this.checkMobile();
      window.addEventListener('resize', this.onResize);
    }

    this.routerSubscription = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.currentRoute = e.urlAfterRedirects;
        this.recomputeActiveRoots();

        if (!this.pinOpen) this.activeRoot = null;
        if (this.isMobile) this.isSidebarHidden = true;

        this.saveUIState();
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.cancelClose();
    for (const s of this.offlineSubs) {
      try { s.unsubscribe(); } catch { /* noop */ }
    }
    this.offlineSubs = [];
    if (this.isBrowser) {
      window.removeEventListener('resize', this.onResize);
      if (this.onQueueUpdated) {
        window.removeEventListener('offline-queue-updated', this.onQueueUpdated);
        this.onQueueUpdated = undefined;
      }
      if (this.onRequestFailed) {
        window.removeEventListener('offline-request-failed', this.onRequestFailed);
        this.onRequestFailed = undefined;
      }
      if (this.onWriteQueued) {
        window.removeEventListener('offline-write-queued', this.onWriteQueued);
        this.onWriteQueued = undefined;
      }
      if (this.queuedToastTimer) {
        clearTimeout(this.queuedToastTimer);
        this.queuedToastTimer = null;
      }
    }
  }

  // ===== localStorage SSR-safe =====
  private lsGet(key: string): string | null {
    if (!this.isBrowser) return null;
    try { return getLocalStorageItem(key); } catch { return null; }
  }
  private lsSet(key: string, val: string): void {
    if (!this.isBrowser) return;
    try { setLocalStorageItem(key, val); } catch { /* noop */ }
  }
  private lsClear(): void {
    if (!this.isBrowser) return;
    try { clearLocalStorage(); } catch { /* noop */ }
  }

  private loadUIState(): void {
    this.isSidebarHidden = this.lsGet('sidebarHidden') === 'true';
    this.pinOpen = this.lsGet('sidebarPin') === 'true';
  }

  private saveUIState(): void {
    this.lsSet('sidebarHidden', String(this.isSidebarHidden));
    this.lsSet('sidebarPin', String(this.pinOpen));
  }

  // ===== cierre por hover =====
  cancelClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  public scheduleClose(ev?: MouseEvent | PointerEvent): void {
    if (!this.isBrowser) return;
    if (this.pinOpen || this.isMobile) return;

    const to = (ev?.relatedTarget ?? null) as Node | null;
    if (to) {
      const sidebar = document.getElementById('app-sidebar');
      if (sidebar && sidebar.contains(to)) return;
    }

    this.cancelClose();
    this.closeTimer = setTimeout(() => {
      this.activeRoot = null;
      this.cdr.markForCheck();
    }, this.CLOSE_DELAY);
  }

  onLeafClick(): void {
    this.cancelClose();
    this.activeRoot = null;

    if (this.isBrowser && typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches) {
      this.isSidebarHidden = true;
    }
    this.saveUIState();
  }

  // ===== permisos =====
  private loadPermTreeFromStorage(): void {
    try {
      const rawUser = this.lsGet('user');
      const rawTree = this.lsGet('permisos_tree');

      let tree: unknown = null;
      if (rawUser) {
        const user = JSON.parse(rawUser);
        tree = user?.permisos_tree ?? null;
      }
      if (!Array.isArray(tree) && rawTree) {
        tree = JSON.parse(rawTree);
      }
      if (!Array.isArray(tree)) return;

      this.setTree(tree as PermNode[]);
    } catch {
      if (this.isBrowser) {
        Swal.fire({
          icon: 'error',
          title: 'Error de permisos',
          text: 'No se pudo cargar el árbol de permisos.',
        });
      }
    }
  }

  /**
   * Punto único donde el árbol entrante se normaliza, decora y filtra. El
   * template lee `visibleRoots` y nunca recalcula nada por nodo en render.
   */
  private setTree(raw: PermNode[]): void {
    const decorated = raw.map(n => this.decorate(n));
    const withPerms = decorated.filter(n => n.__canRead);
    this.visibleRoots = this.applyRoleVisibility(withPerms);
    this.purgeStaleExpanded(decorated);
    this.recomputeActiveRoots();
    this.cdr.markForCheck();
  }

  /**
   * Si el rol del usuario logueado NO es admin/gerencia, oculta los nodos
   * llamados "ADMINISTRATIVO" / "ADMINISTRATIVOS" en cualquier nivel del
   * arbol. El backend ya filtra por permisos finos, esto es un layer extra
   * a nivel de modulo para ocultar el rotulo completo a roles operativos.
   */
  private applyRoleVisibility(nodes: PermNode[]): PermNode[] {
    if (this.isPrivilegedRole()) return nodes;
    return this.stripAdministrativeNodes(nodes);
  }

  private isPrivilegedRole(): boolean {
    try {
      const rawUser = this.lsGet('user');
      if (!rawUser) return false;
      const user = JSON.parse(rawUser);
      const role = this.normalizeRoleName(user?.rol?.nombre);
      return this.PRIVILEGED_ROLES.has(role);
    } catch {
      return false;
    }
  }

  private normalizeRoleName(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toUpperCase();
  }

  private isAdministrativeNodeName(name: string): boolean {
    return this.ADMINISTRATIVE_NODE_NAMES.has(this.normalizeRoleName(name));
  }

  private stripAdministrativeNodes(nodes: PermNode[]): PermNode[] {
    const out: PermNode[] = [];
    for (const n of nodes) {
      if (this.isAdministrativeNodeName(n.nombre)) continue;
      if (n.hijos?.length) {
        out.push({ ...n, hijos: this.stripAdministrativeNodes(n.hijos) });
      } else {
        out.push(n);
      }
    }
    return out;
  }

  /**
   * Pre-computa ruta, ícono y permiso por nodo. Una sola vez por carga de
   * árbol. El template lee `node.__route` / `node.__icon` directamente.
   */
  private decorate(n: PermNode): PermNode {
    const hijos = (n.hijos ?? []).map(h => this.decorate(h));
    // Los hijos sin permiso de lectura se podan aquí: el template recorre
    // node.hijos sin re-evaluar permisos, así que dejar un hijo no legible
    // en la lista lo pintaría (p. ej. todo el subárbol de Tesorería para un
    // rol que solo puede leer una de sus hojas).
    return {
      ...n,
      acciones: n.acciones ?? [],
      permiso_ids: n.permiso_ids ?? {},
      hijos: hijos.filter(h => h.__canRead),
      __route: this.computeRoute(n),
      __icon: this.computeIcon(n),
      __canRead: this.computeCanRead(n, hijos),
    };
  }

  private computeRoute(node: PermNode): string {
    const base = '/dashboard';
    if (!node.ruta) return base;
    // Módulo que vive en OTRA aplicación. Se devuelve tal cual: concatenarla a /dashboard
    // producía '/dashboard/https://…' y el nodo no llevaba a ningún lado.
    //
    // Hoy NINGÚN nodo del menú es externo: Capacitaciones lo era hasta la V55 de
    // ms-auth-admin y sus pantallas ya viven aquí (submodule/training). El caso se conserva
    // porque la ruta la decide la base de datos, no este código.
    if (NavbarComponent.esExterna(node.ruta)) return node.ruta;
    if (node.ruta.startsWith('/')) return node.ruta;
    return `${base}/${node.ruta}`;
  }

  /** Una ruta con esquema http(s) apunta fuera de esta aplicación. */
  public static esExterna(ruta: string | undefined): boolean {
    return !!ruta && /^https?:\/\//i.test(ruta);
  }

  /**
   * Fallback de icono por ruta (espejo de la migración V20 de ms-auth-admin).
   * Solo se aplica cuando la BD trae el placeholder 'widgets' o viene vacío, así
   * un icono real editado desde Gestión de Módulos siempre gana. Cubre las
   * variantes de ruta que aliasa nomina.routes.ts (typo 'emepresa' incluido).
   */
  private readonly ICON_BY_RUTA: Record<string, string> = {
    '/dashboard/nomina/emepresa-usuaria': 'business',
    '/dashboard/nomina/empresas-usuarias': 'business',
    '/dashboard/nomina/entidades-externas': 'business',
    '/dashboard/nomina/centros-costo': 'account_balance_wallet',
  };

  private computeIcon(node: PermNode): string {
    const icono = (node?.icono ?? '').trim();
    if (icono && icono !== 'widgets') return icono;
    return this.ICON_BY_RUTA[this.computeRoute(node)] || icono;
  }

  private computeCanRead(node: PermNode, decoratedChildren: PermNode[]): boolean {
    const acc = (node.acciones ?? []).map(a => (a || '').toUpperCase());
    if (acc.some(a => this.READ_KEYS.has(a))) return true;
    const permKeys = Object.keys(node.permiso_ids ?? {}).map(k => k.toUpperCase());
    if (permKeys.some(k => this.READ_KEYS.has(k))) return true;
    return decoratedChildren.some(c => c.__canRead === true);
  }

  private purgeStaleExpanded(roots: PermNode[]): void {
    const live = new Set<string>();
    const walk = (ns: PermNode[]) => ns.forEach(n => { live.add(n.id); walk(n.hijos ?? []); });
    walk(roots);
    for (const k of Object.keys(this.expanded)) {
      if (!live.has(k)) delete this.expanded[k];
    }
  }

  public refreshPermisos(): void {
    const rawUser = this.lsGet('user');
    if (!rawUser) return;
    try {
      const user = JSON.parse(rawUser);
      if (!user?.id) return;

      const apiUrl = environment.apiUrl.replace(/\/$/, '');
      this.http.get<any>(`${apiUrl}/gestion_admin/usuarios/${user.id}/`).subscribe({
        next: (resp) => {
          this.lsSet('user', JSON.stringify(resp));
          this.loadPermTreeFromStorage();
        },
        error: (err) => console.error('Error fetching dynamic perms', err),
      });
    } catch (e) {
      console.error('Error loading user perms', e);
    }
  }

  // ===== template helpers =====
  public hasChildren(n: PermNode | null | undefined): boolean {
    return !!n?.hijos?.length;
  }

  public onRootClick(root: PermNode | null): void {
    if (!root) {
      this.activeRoot = null;
      if (this.isMobile) this.isSidebarHidden = true;
      this.saveUIState();
      return;
    }
    this.cancelClose();

    // Mobile: tocar el módulo activo de nuevo oculta la tira (toggle)
    if (this.isMobile && this.activeRoot?.id === root.id) {
      this.activeRoot = null;
      this.cdr.markForCheck();
      this.saveUIState();
      return;
    }

    const isNewRoot = this.activeRoot?.id !== root.id;
    this.activeRoot = root;
    (root.hijos ?? []).forEach(h => (this.expanded[h.id] = true));
    if (this.isMobile) {
      this.isSidebarHidden = false;
      if (isNewRoot) this.isMobileCompact = false;
    }
    this.saveUIState();
  }

  public toggleMobileCompact(): void {
    this.isMobileCompact = !this.isMobileCompact;
    this.cdr.markForCheck();
  }

  public onNodeClick(node: PermNode): void {
    // Un módulo de otra aplicación no se navega con el router: se abre. En pestaña nueva
    // para no sacar a la persona de lo que estuviera haciendo aquí.
    const destino = this.getNodeRoute(node);
    if (NavbarComponent.esExterna(destino)) {
      window.open(destino, '_blank', 'noopener');
      this.onLeafClick();
      return;
    }
    if (this.hasChildren(node)) {
      this.toggleNode(node.id);
      // Un nodo CON hijos que además tiene pantalla propia (p. ej. "Novedades" con un
      // formulario dinámico colgado debajo) debe SEGUIR navegando a su pantalla, no solo
      // expandir. Los contenedores puros (sin ruta propia) solo expanden.
      if (this.hasOwnScreen(node)) {
        this.router.navigateByUrl(this.getNodeRoute(node));
        this.onLeafClick();
      }
      return;
    }
    this.router.navigateByUrl(this.getNodeRoute(node));
    this.onLeafClick();
  }

  /** ¿El nodo tiene pantalla propia navegable (no es un contenedor puro sin ruta)? */
  public hasOwnScreen(node: PermNode): boolean {
    const route = this.getNodeRoute(node);
    return !!node.ruta && route !== '/dashboard' && route !== '/dashboard/';
  }

  // ===== expand/collapse =====
  public isExpanded(id: string): boolean {
    return !!this.expanded[id];
  }

  public toggleNode(id: string): void {
    this.expanded[id] = !this.expanded[id];
  }

  // ===== rutas / íconos (lectura cacheada) =====
  public getNodeRoute(node: PermNode): string {
    return node.__route ?? this.computeRoute(node);
  }

  public getNodeIcon(node: PermNode): string {
    return node.__icon || 'radio_button_unchecked';
  }

  public getModuleIcon(node: PermNode): string {
    return node.__icon || 'widgets';
  }

  public isRouteActive(route: string): boolean {
    return (this.currentRoute ?? this.router.url) === route;
  }

  public isTreeActive(root: PermNode): boolean {
    return this.activeRootIds.has(root.id);
  }

  /**
   * Recorre el árbol decorado una sola vez por cambio de ruta y guarda los
   * root.id cuya descendencia contiene la ruta actual. El template solo hace
   * `.has()` después.
   */
  private recomputeActiveRoots(): void {
    const current = this.currentRoute ?? this.router.url;
    const next = new Set<string>();
    for (const root of this.visibleRoots) {
      if (this.subtreeMatchesRoute(root, current)) next.add(root.id);
    }
    this.activeRootIds = next;
  }

  private subtreeMatchesRoute(node: PermNode, current: string): boolean {
    if (!this.hasChildren(node)) return node.__route === current;
    return (node.hijos ?? []).some(h => this.subtreeMatchesRoute(h, current));
  }

  // ===== responsive =====
  private onResize = () => this.checkMobile();

  private checkMobile(): void {
    if (!this.isBrowser) return;
    this.isMobile = window.innerWidth <= this.MOBILE_BREAKPOINT;
    this.isSidebarHidden = this.isMobile;
    this.saveUIState();
  }

  public toggleSidebar(): void {
    this.isSidebarHidden = !this.isSidebarHidden;
    this.saveUIState();
  }

  public closeAll(_source: 'backdrop' | 'outside' | 'esc' | 'api' = 'api'): void {
    if (this.pinOpen) return;
    this.activeRoot = null;
    if (this.isMobile) this.isSidebarHidden = true;
    this.saveUIState();
  }

  public togglePin(): void {
    this.pinOpen = !this.pinOpen;
    this.saveUIState();
  }

  // ===== click fuera / ESC =====
  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent): void {
    if (!this.isBrowser || this.pinOpen) return;
    if (this.isMobile) return;

    const sidebar = document.getElementById('app-sidebar');
    const target = e.target as Node;
    if (sidebar && !sidebar.contains(target)) {
      this.closeAll('outside');
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.isBrowser) return;
    this.closeAll('esc');
  }

  // ===== auth =====
  public async cerrarSesion(): Promise<void> {
    // Si el usuario tiene mutaciones encoladas sin sincronizar, AVISAR antes
    // de borrar. Antes el logout silencioso evaporaba 30 PDFs encolados sin
    // forma de recuperarlos. Ahora la cola sobrevive a logout normal y solo
    // se borra si el usuario lo confirma.
    let pendingNow = 0;
    try { pendingNow = this.pendingCount || 0; } catch { /* noop */ }

    const electronApi = (typeof window !== 'undefined' ? (window as any).electron : null);

    if (pendingNow > 0) {
      const result = await Swal.fire({
        icon: 'warning',
        title: `Tienes ${pendingNow} envío(s) pendiente(s)`,
        html:
          'Hay datos / archivos esperando subir cuando vuelvas a tener red.<br><br>' +
          '<b>Mantener pendientes:</b> se reproducirán cuando vuelvas a entrar con tu usuario.<br>' +
          '<b>Borrar y salir:</b> se perderán definitivamente.',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Mantener pendientes y salir',
        denyButtonText: 'Borrar y salir',
        cancelButtonText: 'Cancelar',
        reverseButtons: true,
      });

      if (result.isDismissed) return;

      if (result.isDenied) {
        this.lsClear();
        // "Borrar y salir" significa dejar el equipo limpio: eso incluye el
        // acceso rápido guardado. El logout normal NO lo toca, porque su razón
        // de ser es sobrevivir al cierre de sesión.
        await this.quickAccess.olvidar().catch(() => null);
        const wipePromise: Promise<any> = electronApi?.db?.clearUserData
          ? electronApi.db.clearUserData().catch(() => null)
          : Promise.resolve();
        wipePromise.finally(() => this.router.navigate(['']));
        return;
      }

      // result.isConfirmed: mantener cola, borrar SOLO el cache de GETs.
      this.lsClear();
      const cachePromise: Promise<any> = electronApi?.db?.clearCache
        ? electronApi.db.clearCache().catch(() => null)
        : Promise.resolve();
      cachePromise.finally(() => this.router.navigate(['']));
      return;
    }

    // Sin pendientes: solo borramos cache (la cola está vacía).
    this.lsClear();
    const cachePromise: Promise<any> = electronApi?.db?.clearCache
      ? electronApi.db.clearCache().catch(() => null)
      : (electronApi?.db?.clearUserData
          ? electronApi.db.clearUserData().catch(() => null)
          : Promise.resolve());
    cachePromise.finally(() => this.router.navigate(['']));
  }

  public trackByNodeId = (_: number, n: PermNode) => n.id;
}

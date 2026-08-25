import {  Component, Inject, OnDestroy, PLATFORM_ID , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { SharedModule } from '../../../../shared/shared.module';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { UtilityServiceService } from '../../../../shared/services/utilityService/utility-service.service';
import { ConsoleLoggerService } from '../../../../shared/services/console-logger/console-logger.service';
import { NetworkStatusService } from '../../../../core/services/network-status.service';
import { OfflineSyncService } from '../../../../core/services/offline-sync.service';
import { AppInfoService, PlatformInfo } from '../../../../core/services/app-info.service';
import { NotificationCenterService, NotificationItem } from '../../../../core/services/notification-center.service';
import { NotificationTargetService } from '../../../../core/services/notification-target.service';
import { Subscription, timer, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { BugReportService } from '../../../../shared/services/bug-report/bug-report.service';
import { ProfilePhotoService } from '../../../../shared/services/profile-photo/profile-photo.service';
import { getLocalStorageItem } from '../../../../core/utils/safe-storage';
import { SmartMenuComponent } from '../smart-menu/smart-menu.component';
import { LoadingOrbComponent } from '../../../../core/components/loading-orb/loading-orb.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-sidebar',
  imports: [
    SharedModule,
    SmartMenuComponent,
    LoadingOrbComponent
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css'
} )
export class SidebarComponent implements OnDestroy {
  role: string = '';
  username: string = '';
  documento: string = '';
  appVersion: string = '';

  /** Plataforma de ejecución (Web / Android / Escritorio) para el chip de versión. */
  platform: PlatformInfo = { key: 'web', label: 'Web', icon: 'public' };

  // Nombre visible de la sede actual del usuario
  sede: string = '';

  /** Foto de perfil (data-URL) para el avatar del menú, o null si no hay. */
  fotoPerfil: string | null = null;

  /**
   * Si se muestra el atajo "Identificar personal" en el menú de perfil.
   *
   * Manda el árbol de permisos (db_admin), que es el mecanismo con el que esta plataforma
   * reparte accesos y el que permite dárselo a administrativos, portería o cualquier otra
   * área sin tocar código. ADMIN/GERENCIA lo ven igual aunque el módulo aún no esté sembrado
   * en la BD: si no, quien tiene que registrarlo no podría ni entrar a probarlo.
   */
  puedeIdentificar = false;

  /** Roles que ven el panel de identificación sin depender del árbol. */
  private readonly ROLES_IDENTIFICACION = new Set(['ADMIN', 'GERENCIA']);

  /** Estado de red + cola offline (movidos desde el navbar). */
  isOnline = true;
  pendingCount = 0;
  syncProgress: { current: number; total: number; phase: string } | null = null;

  /** Centro de notificaciones (campana del top bar). */
  notifications: NotificationItem[] = [];
  unreadCount = 0;
  loadingNotifs = false;

  private netSubs: Subscription[] = [];

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private adminService: UtilityServiceService,
    private router: Router,
    private dialog: MatDialog,
    private consoleLogger: ConsoleLoggerService,
    private networkStatus: NetworkStatusService,
    private offlineSync: OfflineSyncService,
    private appInfo: AppInfoService,
    private notifCenter: NotificationCenterService,
    private notifTarget: NotificationTargetService,
    private cdr: ChangeDetectorRef,
    private bugReportService: BugReportService,
    private profilePhotos: ProfilePhotoService,
  ) {
    if (isPlatformBrowser(this.platformId)) {
      this.consoleLogger.init();

      // Versión + plataforma. Antes la versión sólo resolvía en Electron y
      // quedaba vacía en Web/Android; AppInfoService la resuelve en los tres.
      this.platform = this.appInfo.getPlatform();
      this.appInfo.getVersion().then(v => {
        this.appVersion = v;
        this.cdr.markForCheck();
      });

      // Suscripciones al estado de red — alimentan el chip del header.
      this.netSubs.push(
        this.networkStatus.isOnline$.subscribe(status => {
          this.isOnline = status;
          this.cdr.markForCheck();
        }),
        this.offlineSync.pendingCount$.subscribe(count => {
          this.pendingCount = count;
          this.cdr.markForCheck();
        }),
        this.offlineSync.syncProgress$.subscribe(progress => {
          this.syncProgress = progress;
          this.cdr.markForCheck();
        }),
        // Campana: polling del contador de no-leídas cada 45s. Tolerante a fallos
        // (un error de red conserva el último valor y no detiene el timer).
        timer(0, 45000).pipe(
          switchMap(() => this.notifCenter.unreadCount().pipe(
            catchError(() => of({ count: this.unreadCount })))),
        ).subscribe(r => { this.unreadCount = r?.count ?? 0; this.cdr.markForCheck(); }),
      );
    }
  }

  // ===== Notificaciones (campana) =====
  /** Carga las notificaciones recientes al abrir el desplegable. */
  loadNotifs(): void {
    this.loadingNotifs = true;
    this.cdr.markForCheck();
    this.notifCenter.list().pipe(catchError(() => of([] as NotificationItem[]))).subscribe(list => {
      this.notifications = (list || []).slice(0, 12);
      this.loadingNotifs = false;
      this.cdr.markForCheck();
    });
  }

  /**
   * Clic en una notificación: la marca leída y abre su destino.
   *
   * El destino ya no se construye aquí. Antes esto hacía
   * `navigate('/dashboard/matder/' + n.link)`, que ataba la campana a Matder:
   * una notificación de nómina o jurídico habría navegado a una ruta inexistente.
   * Ahora el backend guarda un destino tipado y lo resuelve NotificationTargetService.
   */
  onNotifClick(n: NotificationItem): void {
    if (!n.leida) {
      this.notifCenter.markRead(n.id).subscribe({ next: () => {}, error: () => {} });
      n.leida = true;
      this.unreadCount = Math.max(0, this.unreadCount - 1);
    }
    this.notifTarget.abrir(n.destino_tipo, n.destino_valor);
    this.cdr.markForCheck();
  }

  markAllNotifs(ev: Event): void {
    ev.stopPropagation();
    this.notifCenter.markAllRead().subscribe({ next: () => {}, error: () => {} });
    this.notifications = this.notifications.map(n => ({ ...n, leida: true }));
    this.unreadCount = 0;
    this.cdr.markForCheck();
  }

  goToNotifications(): void { this.router.navigate(['/dashboard/novedades']); }

  /**
   * Icono y color ya NO se calculan aquí. Venían de dos mapas hardcodeados que
   * duplicaban (mal) el catálogo del backend: agregar un tipo obligaba a tocar
   * este archivo, la página de notificaciones y el Java del productor. Ahora
   * cada mensaje trae los suyos desde `notif_tipo` y el fallback es del backend.
   */

  /** Realce de las urgentes: la campana debe distinguirlas de un vistazo. */
  notifDestacada(n: NotificationItem): boolean {
    return n.urgencia === 'URGENTE' || n.urgencia === 'CRITICA';
  }

  notifTimeAgo(iso: string): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const s = Math.floor((Date.now() - then) / 1000);
    if (s < 60) return 'hace un momento';
    const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24); if (d < 7) return `hace ${d} d`;
    return new Date(iso).toLocaleDateString();
  }

  ngOnDestroy(): void {
    this.netSubs.forEach(s => s.unsubscribe());
    this.netSubs = [];
  }

  /** Texto humano del estado de red para el tooltip y aria-label. */
  get netStatusTitle(): string {
    if (this.syncProgress) {
      const verb = this.syncProgress.phase === 'sync' ? 'Sincronizando' : 'Actualizando caché';
      return `${verb} ${this.syncProgress.current}/${this.syncProgress.total}`;
    }
    if (!this.isOnline) {
      return this.pendingCount > 0
        ? `Sin conexión · ${this.pendingCount} pendiente(s)`
        : 'Sin conexión';
    }
    return this.pendingCount > 0
      ? `En línea · ${this.pendingCount} pendiente(s) por sincronizar`
      : 'En línea';
  }

  /** Etiqueta corta del chip. */
  get netStatusLabel(): string {
    if (this.syncProgress) return 'Sincronizando';
    return this.isOnline ? 'En línea' : 'Sin conexión';
  }

  /** Icono Material adecuado al estado actual. */
  get netStatusIcon(): string {
    if (this.syncProgress) return 'sync';
    return this.isOnline ? 'cloud_done' : 'cloud_off';
  }

  /** Texto del chip de versión para tooltip / accesibilidad. */
  get versionTitle(): string {
    const v = this.appVersion ? `Versión ${this.appVersion}` : 'Versión no disponible';
    return `${v} · ${this.platform.label}`;
  }

  ngOnInit(): void {
    const user: any = this.adminService.getUser?.();
    if (!user) return;

    this.sede = user?.sede?.nombre ?? '';
    this.role = user?.rol?.nombre ?? '';
    this.documento = user?.numero_de_documento ?? '';
    this.username = [user?.datos_basicos?.nombres, user?.datos_basicos?.apellidos].filter(Boolean).join(' ');

    this.puedeIdentificar = this.resolverAccesoIdentificacion(user);

    // Avatar del menú de perfil: re-lee para el usuario vigente y se mantiene
    // sincronizado con la página de Cuenta.
    this.profilePhotos.reload();
    this.netSubs.push(
      this.profilePhotos.photo$.subscribe(p => {
        this.fotoPerfil = p;
        this.cdr.markForCheck();
      }),
    );
  }

  /** Iniciales para el avatar cuando no hay foto. */
  get iniciales(): string {
    const parts = this.username.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  /**
   * ¿Este usuario puede identificar a otros? Se busca la ruta del panel en el árbol de
   * permisos que el backend ya entrega en el login; si no está, sólo pasan ADMIN/GERENCIA.
   */
  private resolverAccesoIdentificacion(user: any): boolean {
    const rol = String(user?.rol?.nombre ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
    if (this.ROLES_IDENTIFICACION.has(rol)) return true;

    try {
      let arbol: unknown = user?.permisos_tree ?? null;
      if (!Array.isArray(arbol)) {
        const crudo = getLocalStorageItem('permisos_tree');
        arbol = crudo ? JSON.parse(crudo) : null;
      }
      return Array.isArray(arbol) && this.arbolTieneCarnet(arbol as any[]);
    } catch {
      return false;
    }
  }

  /** Recorre el árbol buscando un nodo cuya ruta apunte al panel de identificación. */
  private arbolTieneCarnet(nodos: any[]): boolean {
    for (const n of nodos) {
      const ruta = String(n?.ruta ?? '').toLowerCase();
      if (ruta.includes('carnet/identificar') || ruta.includes('carnet/verificar')) return true;
      if (Array.isArray(n?.hijos) && this.arbolTieneCarnet(n.hijos)) return true;
    }
    return false;
  }

  /** Acciones del menú de perfil. */
  irAConfiguracion(): void {
    this.router.navigate(['/dashboard/configuracion/cuenta']);
  }

  /** Abre el carné en un diálogo — dos toques desde cualquier pantalla. */
  abrirCarnet(): void {
    import('../../submodule/carnet/components/carnet-dialog/carnet-dialog.component').then(m => {
      this.dialog.open(m.CarnetDialogComponent, {
        width: '440px',
        maxWidth: '95vw',
        maxHeight: '95vh',
        autoFocus: false,
        panelClass: 'carnet-dialog-panel',
      });
    });
  }

  irAIdentificar(): void {
    this.router.navigate(['/dashboard/carnet/identificar']);
  }

  irACambiarContrasena(): void {
    this.router.navigate(['/dashboard/users/change-password']);
  }

  abrirReporteBug(): void {
    // Capturar pantalla ANTES de abrir el dialog para no capturar el overlay
    this.bugReportService.captureScreenshot().then(screenshot => {
      import('../../../../shared/components/bug-report-dialog/bug-report-dialog.component').then(
        (m) => {
          this.dialog.open(m.BugReportDialogComponent, {
            width: '600px',
            maxHeight: '90vh',
            disableClose: true,
            data: { screenshot },
          });
        }
      );
    }).catch(() => {
      import('../../../../shared/components/bug-report-dialog/bug-report-dialog.component').then(
        (m) => {
          this.dialog.open(m.BugReportDialogComponent, {
            width: '600px',
            maxHeight: '90vh',
            disableClose: true,
            data: { screenshot: null },
          });
        }
      );
    });
  }

  /**
   * Abre el diálogo de "Envíos pendientes" — qué archivos / datos quedaron en
   * cola local sin subir (el número del chip). Disponible online y offline.
   */
  abrirEstadoConexion(): void {
    import('../../../../shared/components/offline-queue-dialog/offline-queue-dialog.component').then(
      (m) => {
        this.dialog.open(m.OfflineQueueDialogComponent, {
          width: '600px',
          maxHeight: '90vh',
          autoFocus: false,
        });
      }
    );
  }
}

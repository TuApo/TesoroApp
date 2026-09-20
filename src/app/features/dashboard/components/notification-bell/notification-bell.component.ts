import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { OverlayModule } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { of, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import {
  NotificationCenterService, NotificationItem, NotificationType,
} from '../../../../core/services/notification-center.service';
import {
  NIVELES, Prioridad, etiquetaDestino, prioridadDe,
} from '../../../../core/services/notification-priority';
import { NotificationTargetService } from '../../../../core/services/notification-target.service';

/** Una notificación con lo ya calculado para pintarla: nivel y módulo. */
interface Fila extends NotificationItem {
  prioridad: Prioridad;
  modulo: string;
  cuando: string;
  navegable: boolean;
}

/** Un grupo de la lista: un nivel de prioridad con sus filas. */
interface Grupo {
  clave: Prioridad;
  largo: string;
  ayuda: string;
  filas: Fila[];
}

/**
 * Campana del top bar y su panel.
 *
 * <p>Vivía dentro del sidebar como un <code>mat-menu</code>, y eso tenía un
 * defecto que se veía: Material renderiza el menú en un overlay FUERA del
 * componente, así que el CSS encapsulado del sidebar no le llegaba y el panel
 * salía sin estilos — el «Estás al día» y su explicación aparecían pegados, sin
 * jerarquía ni espaciado. Aquí el panel es un <code>cdkConnectedOverlay</code>
 * declarado en ESTE componente, de modo que sus estilos sí aplican.</p>
 *
 * <p>El panel ordena por lo único que importa cuando llegan veinte avisos: qué
 * hay que atender YA. La prioridad manda sobre la fecha, y el módulo es el
 * segundo filtro. Un clic lleva al registro concreto, no a una lista.</p>
 */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [OverlayModule, MatIconModule, MatTooltipModule],
  templateUrl: './notification-bell.component.html',
  styleUrl: './notification-bell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent implements OnInit {

  private readonly centro = inject(NotificationCenterService);
  private readonly destino = inject(NotificationTargetService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly niveles = NIVELES;

  readonly abierto = signal(false);
  readonly cargando = signal(false);
  readonly sinLeer = signal(0);

  /** Filtros del panel. `null` = sin filtrar. */
  readonly filtroPrioridad = signal<Prioridad | null>(null);
  readonly filtroModulo = signal<string | null>(null);

  private readonly items = signal<NotificationItem[]>([]);
  /** Catálogo de tipos: de ahí sale a qué módulo pertenece cada notificación. */
  private readonly catalogo = signal<NotificationType[]>([]);

  /** Nombre de módulo por clave de tipo, resuelto una vez por catálogo. */
  private readonly moduloPorTipo = computed(() => {
    const mapa = new Map<string, string>();
    for (const t of this.catalogo()) {
      mapa.set(t.clave, t.modulo_nombre || t.nombre);
    }
    return mapa;
  });

  /** Todas las filas, ya clasificadas. */
  private readonly filas = computed<Fila[]>(() => {
    const modulos = this.moduloPorTipo();
    return this.items().map(n => ({
      ...n,
      prioridad: prioridadDe(n.urgencia),
      modulo: (n.tipo_clave && modulos.get(n.tipo_clave)) || n.tipo_nombre || 'General',
      cuando: this.hace(n.creada_en),
      navegable: this.destino.esNavegable(n.destino_tipo, n.destino_valor),
    }));
  });

  /** Cuántas hay de cada nivel. Alimenta el semáforo de la cabecera. */
  readonly conteos = computed<Record<Prioridad, number>>(() => {
    const c: Record<Prioridad, number> = { INMEDIATA: 0, MEDIA: 0, LEVE: 0 };
    for (const f of this.filas()) c[f.prioridad]++;
    return c;
  });

  /** Módulos presentes en la bandeja, para los chips. Solo los que hay. */
  readonly modulos = computed<string[]>(() =>
    [...new Set(this.filas().map(f => f.modulo))].sort((a, b) => a.localeCompare(b, 'es')));

  private readonly visibles = computed<Fila[]>(() => {
    const p = this.filtroPrioridad();
    const m = this.filtroModulo();
    return this.filas().filter(f => (!p || f.prioridad === p) && (!m || f.modulo === m));
  });

  /**
   * La lista agrupada por nivel. Se agrupa siempre, también con un filtro
   * activo: la cabecera del grupo es lo que dice de un vistazo con qué se está
   * tratando, y sin ella una lista filtrada no se distingue de otra.
   */
  readonly grupos = computed<Grupo[]>(() => {
    const filas = this.visibles();
    return NIVELES
      .map(n => ({
        clave: n.clave,
        largo: n.largo,
        ayuda: n.ayuda,
        filas: filas.filter(f => f.prioridad === n.clave),
      }))
      .filter(g => g.filas.length > 0);
  });

  readonly hayFiltro = computed(() => this.filtroPrioridad() !== null || this.filtroModulo() !== null);
  readonly vacioPorFiltro = computed(() => this.visibles().length === 0 && this.filas().length > 0);
  readonly bandejaVacia = computed(() => this.filas().length === 0);

  ngOnInit(): void {
    // Sondeo del contador. La URL está en la lista de peticiones silenciosas del
    // interceptor: si no, la barra de carga reaparecería sola cada 45 segundos.
    timer(0, 45_000).pipe(
      switchMap(() => this.centro.unreadCount().pipe(catchError(() => of({ count: this.sinLeer() })))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => this.sinLeer.set(r?.count ?? 0));
  }

  alternar(): void {
    this.abierto() ? this.cerrar() : this.abrir();
  }

  abrir(): void {
    this.abierto.set(true);
    this.cargar();
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  private cargar(): void {
    this.cargando.set(true);
    this.centro.catalogo().pipe(
      catchError(() => of([] as NotificationType[])),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(c => this.catalogo.set(c || []));

    this.centro.list({ size: 30 }).pipe(
      catchError(() => of([] as NotificationItem[])),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(lista => {
      this.items.set(lista || []);
      this.cargando.set(false);
    });
  }

  /** Pulsar el nivel ya activo lo suelta: el filtro es un interruptor. */
  filtrarPrioridad(p: Prioridad): void {
    this.filtroPrioridad.update(actual => (actual === p ? null : p));
  }

  filtrarModulo(m: string | null): void {
    this.filtroModulo.update(actual => (actual === m ? null : m));
  }

  limpiarFiltros(): void {
    this.filtroPrioridad.set(null);
    this.filtroModulo.set(null);
  }

  /**
   * Abre la notificación: la marca leída y navega a su destino.
   *
   * <p>El destino es un par tipado (tipo, valor) que resuelve
   * {@link NotificationTargetService}: una ruta, un módulo del menú, un
   * formulario dinámico o un enlace externo. Si no resuelve — por ejemplo,
   * porque el usuario no tiene permiso sobre ese módulo — se marca leída pero
   * no se le manda a una pantalla que el guard va a rebotar.</p>
   */
  async abrirNotificacion(f: Fila): Promise<void> {
    if (!f.leida) {
      this.items.update(lista => lista.map(n => (n.id === f.id ? { ...n, leida: true } : n)));
      this.sinLeer.update(n => Math.max(0, n - 1));
      this.centro.markRead(f.id).subscribe({ next: () => {}, error: () => {} });
    }
    if (f.navegable) {
      this.cerrar();
      await this.destino.abrir(f.destino_tipo, f.destino_valor);
    }
  }

  marcarTodas(event: Event): void {
    event.stopPropagation();
    this.centro.markAllRead().subscribe({ next: () => {}, error: () => {} });
    this.items.update(lista => lista.map(n => ({ ...n, leida: true })));
    this.sinLeer.set(0);
  }

  verTodas(): void {
    this.cerrar();
    this.router.navigate(['/dashboard/novedades']);
  }

  /** Etiqueta de la acción, según a dónde lleve. Se lee antes de hacer clic. */
  accion(f: Fila): string {
    return etiquetaDestino(f.destino_tipo);
  }

  /** Tiempo relativo corto. Una notificación se lee por lo reciente que es. */
  private hace(iso: string): string {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const seg = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (seg < 60) return 'ahora';
    const min = Math.floor(seg / 60);
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'ayer';
    if (d < 7) return `hace ${d} días`;
    return new Date(t).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  }
}

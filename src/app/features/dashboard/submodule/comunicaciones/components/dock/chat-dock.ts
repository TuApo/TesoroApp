import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter, map } from 'rxjs';
import { PermissionsService } from '../../../../../../core/services/permissions.service';
import { OperadorService } from '../../../../../../core/services/operador/operador.service';
import { ChatStoreService } from '../../service/chat-store.service';
import { LlamadaService } from '../../service/llamada.service';
import { DockService, VentanaDock } from '../../service/dock.service';
import { desbloquear } from '../../service/sonidos';
import { Conversacion } from '../../modelos';
import { iconoConversacion, primerNombre } from '../../utiles';
import { ComAvatar } from '../avatar/avatar';
import { ComCabecera } from '../cabecera/cabecera';
import { ComConversacion } from '../conversacion/conversacion';
import { ComListaChats } from '../lista-chats/lista-chats';
import { ComLlamadaEntrante } from '../llamada/llamada-entrante';
import { ComLlamadaPanel } from '../llamada/llamada-panel';
import { NuevoChatDialog } from '../nuevo-chat/nuevo-chat';

/** Una ventana del dock: cabecera siempre visible; la conversación solo si está desplegada. */
@Component({
  selector: 'app-com-ventana',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComCabecera, ComConversacion],
  template: `
    @if (conv(); as c) {
      <div class="ventana" [class.min]="v().minimizada" [class.foco]="dock.enfocada() === c.id" (focusin)="dock.enfocar(c.id)"
           (click)="dock.enfocar(c.id)">
        <app-com-cabecera [c]="c" modo="ventana" [minimizada]="v().minimizada" [resaltada]="v().resaltada"
          (alternar)="dock.alternar(c.id)" (cerrar)="dock.cerrar(c.id)" (maximizar)="pantallaCompleta(c.id)" (info)="pantallaCompleta(c.id, true)" />
        @if (!v().minimizada) {
          <div class="cuerpo"><app-com-conversacion [conversacionId]="c.id" /></div>
        }
      </div>
    }`,
  styles: [`
    :host { display: block; align-self: flex-end; }
    .ventana { width: 370px; height: min(580px, calc(100vh - 90px)); display: flex; flex-direction: column; background: var(--surface); border-radius: 12px 12px 0 0;
      box-shadow: 0 -2px 24px rgba(15, 23, 42, .22); overflow: hidden; border: 1px solid var(--border); border-bottom: 0; }
    .ventana.min { height: auto; width: 280px; }
    .ventana.foco { box-shadow: 0 -4px 30px rgba(15, 23, 42, .32); }
    .cuerpo { flex: 1; min-height: 0; }
  `],
})
export class ComVentana {
  readonly dock = inject(DockService);
  private readonly store = inject(ChatStoreService);
  private readonly router = inject(Router);
  readonly v = input.required<VentanaDock>();
  readonly conv = computed(() => this.store.conversacion(this.v().conversacionId));

  pantallaCompleta(id: string, info = false): void {
    this.dock.cerrar(id);
    // "Maximizar": aquí sí se entra al módulo (el guard de los avisos lo deja pasar).
    void this.router.navigate(['/dashboard/comunicaciones/chats'], { queryParams: { c: id, ...(info ? { info: 1 } : {}) }, state: { maximizar: true } });
  }
}

/**
 * El dock global de chat (montado en el shell del dashboard). En escritorio es una
 * columna de pestañas delgadas en el borde derecho —la de Chat y una por cada
 * conversación abierta, con el primer nombre—, semitransparentes mientras no se usan
 * y resaltadas cuando llega algo; al desplegarlas, la lista y las ventanas aparecen
 * abajo a la derecha. También el aviso de llamada entrante y la llamada en curso.
 */
@Component({
  selector: 'app-chat-dock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule, MatTooltipModule, ComAvatar, ComVentana, ComListaChats, ComLlamadaEntrante, ComLlamadaPanel],
  templateUrl: './chat-dock.html',
  styleUrl: './chat-dock.css',
})
export class ChatDock implements OnInit, OnDestroy {
  readonly store = inject(ChatStoreService);
  readonly dock = inject(DockService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly permisos = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly llamadas = inject(LlamadaService);
  /** Asistente IA (operador): su pestaña va junto a la de Chat. */
  readonly operador = inject(OperadorService);

  readonly habilitado = signal(false);
  /**
   * Ancho de la barra de desplazamiento de la página (la del contenedor del dashboard, que
   * llega al borde derecho): las pestañas y los paneles se corren para quedar AL LADO de
   * ella y no encima. 0 si no hay barra o el sistema usa barras superpuestas (Mac, móvil).
   */
  readonly barraDer = signal(0);
  private readonly url = toSignal(this.router.events.pipe(
    filter(e => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  /** En la página de Comunicaciones las ventanas sobran: la conversación ya está a pantalla completa. */
  readonly enPaginaChat = computed(() => this.url().startsWith('/dashboard/comunicaciones'));
  /** La pestaña «IA» se pinta aquí si el operador cargó para esta persona y el dock está a la vista. */
  readonly conPestanaIa = computed(() => this.habilitado() && !this.enPaginaChat() && !!this.operador.perfil());

  constructor() {
    // Mientras esté la pestaña, el asistente no pinta su orbe aparte.
    effect(() => this.operador.anclaEnDock.set(this.conPestanaIa()));
    inject(DestroyRef).onDestroy(() => this.operador.anclaEnDock.set(false));
  }

  readonly ocultasConNoLeidos = computed(() =>
    this.dock.pestanasOcultas().filter(v => (this.store.conversacion(v.conversacionId)?.no_leidos ?? 0) > 0).length);

  ngOnInit(): void {
    if (!this.permisos.canReadRoute('/dashboard/comunicaciones')) return;
    this.habilitado.set(true);
    this.store.iniciar();
    this.dock.restaurar();
    this.vigilarBarra();

    // Mensaje nuevo: se abre minimizado y resaltado (o se resalta si ya estaba), como Google Chat.
    this.store.mensajeEntrante$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ conversacion, mensaje }) => {
      if (conversacion.silenciada || this.dock.compacto() || this.enPaginaChat()) return;
      const v = this.dock.abierta(conversacion.id);
      if (!v) {
        this.dock.abrir(conversacion.id, { minimizada: true, enfocar: false });
        this.dock.resaltar(conversacion.id);
      } else if (v.minimizada || this.dock.enfocada() !== conversacion.id || !this.store.estaVisible(conversacion.id)) {
        this.dock.resaltar(conversacion.id);
      }
      void mensaje;
    });
    this.store.eventos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ nombre, datos }) => {
      if (nombre === 'abrir-conversacion' && datos?.conversacion_id && !this.enPaginaChat()) this.dock.abrir(datos.conversacion_id);
      if (nombre === 'conversacion-salida' && datos?.conversacion_id) this.dock.cerrar(datos.conversacion_id);
    });
    // Primer gesto de la sesión: habilita el sonido (política de autoplay de los navegadores).
    document.addEventListener('pointerdown', desbloquear, { once: true });
  }

  private vigilarBarra(): void {
    if (typeof window === 'undefined') return;
    const medir = () => {
      const w = document.querySelector<HTMLElement>('app-dashboard .dashboard-page-wrapper');
      if (!w) { this.barraDer.set(0); return; }
      const r = w.getBoundingClientRect();
      const alBorde = Math.abs(window.innerWidth - r.right) < 2;
      this.barraDer.set(alBorde ? Math.max(0, w.offsetWidth - w.clientWidth) : 0);
    };
    // La barra aparece o desaparece cuando el contenido crece o se achica: el ancho útil
    // del contenedor cambia y lo detecta el ResizeObserver.
    const ro = new ResizeObserver(() => medir());
    const conectar = () => {
      const w = document.querySelector('app-dashboard .dashboard-page-wrapper');
      ro.disconnect();
      if (w) { ro.observe(w); if (w.firstElementChild) ro.observe(w.firstElementChild); }
      medir();
    };
    conectar();
    window.addEventListener('resize', medir, { passive: true });
    const sub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => requestAnimationFrame(conectar));
    this.destroyRef.onDestroy(() => { ro.disconnect(); window.removeEventListener('resize', medir); sub.unsubscribe(); });
  }

  /** Se sale del dashboard (cierre de sesión): se corta el canal y se cuelga, no queda nada del usuario anterior. */
  ngOnDestroy(): void {
    if (!this.habilitado()) return;
    void this.llamadas.colgar();
    this.store.detener();
  }

  alternarLista(): void {
    this.dock.listaAbierta.update(v => !v);
    if (this.dock.listaAbierta()) this.dock.hacerEspacio();
    if (this.dock.listaAbierta() && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }
  }

  abrir(id: string): void {
    this.dock.abrir(id);
    this.dock.listaAbierta.set(false);
  }

  nuevo(): void {
    const ref = this.dialog.open(NuevoChatDialog, { autoFocus: 'input', panelClass: 'com-dialogo' });
    ref.afterClosed().subscribe(id => { if (typeof id === 'string') this.abrir(id); });
  }

  async soporte(): Promise<void> {
    try { this.abrir((await this.store.abrirSoporte()).id); } catch { /* soporte apagado */ }
  }

  irAPagina(): void {
    this.dock.listaAbierta.set(false);
    void this.router.navigate(['/dashboard/comunicaciones/chats']);
  }

  /** Móvil: no hay ventanas acopladas; el chat elegido se abre a pantalla completa. */
  abrirEnMovil(id: string): void {
    this.dock.listaAbierta.set(false);
    void this.router.navigate(['/dashboard/comunicaciones/chats'], { queryParams: { c: id } });
  }

  alternarIa(): void {
    if (this.operador.abierto()) this.operador.minimizar();
    else this.operador.abrir();
  }

  tooltipIa(): string {
    const n = this.operador.noLeidos();
    const base = this.operador.abierto() ? 'Minimizar el asistente IA' : 'Asistente IA: habla o escribe (Alt+A)';
    return n ? `${base} · ${n} ${n === 1 ? 'resultado nuevo' : 'resultados nuevos'}` : base;
  }

  tooltipChat(): string {
    const n = this.store.chatsSinLeer();
    const base = this.dock.listaAbierta() ? 'Minimizar el chat' : 'Abrir el chat';
    return n ? `${base} · ${n} ${n === 1 ? 'chat sin leer' : 'chats sin leer'}` : base;
  }

  nombre(id: string): string { return this.store.conversacion(id)?.nombre ?? 'Chat'; }
  conv(id: string): Conversacion | undefined { return this.store.conversacion(id); }
  icono(c: Conversacion): string | null { return iconoConversacion(c); }
  private otro(c: Conversacion) { return c.participantes.find(p => p.usuario_id === c.otro_usuario_id); }
  foto(c: Conversacion): boolean { return this.otro(c)?.tiene_foto ?? false; }
  enLinea(c: Conversacion): boolean { return this.otro(c)?.en_linea ?? false; }
  /** Lo que cabe en la pestaña: el primer nombre de la persona o el comienzo del nombre del grupo. */
  corto(c: Conversacion): string {
    const n = (c.nombre ?? '').trim() || 'Chat';
    if (c.tipo === 'DIRECTA') {
      const primero = primerNombre(n);
      return primero.length > 12 ? primero.slice(0, 11) + '…' : primero;
    }
    return n.length > 13 ? n.slice(0, 12).trim() + '…' : n;
  }
  noLeidos(id: string): number { return this.store.conversacion(id)?.no_leidos ?? 0; }
}

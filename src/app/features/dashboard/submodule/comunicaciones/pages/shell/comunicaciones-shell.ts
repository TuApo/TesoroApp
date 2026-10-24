import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, afterNextRender, inject, signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { filter } from 'rxjs';
import { ChatStoreService } from '../../service/chat-store.service';

/**
 * Contenedor de Comunicaciones: Chats · Llamadas · Personas · Compromisos · Buscar
 * (y Contactos para la administración).
 *
 * En escritorio ocupa exactamente el alto que queda debajo de las barras del dashboard
 * (se mide: la barra de turnos no siempre está). En el celular es una app aparte: toma
 * toda la pantalla hasta la barra de abajo, y una conversación abierta la tapa también.
 */
@Component({
  selector: 'app-comunicaciones-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule],
  template: `
    <div class="shell" [class.enfoque]="store.enfoqueMovil()" [style.height.px]="alto()">
      <nav class="pestanas" aria-label="Comunicaciones">
        <a routerLink="chats" routerLinkActive="on"><mat-icon>chat</mat-icon><span>Chats</span>
          @if (store.totalNoLeidos() > 0) { <b>{{ store.totalNoLeidos() > 99 ? '99+' : store.totalNoLeidos() }}</b> }</a>
        <a routerLink="llamadas" routerLinkActive="on"><mat-icon>call</mat-icon><span>Llamadas</span>
          @if (store.perdidasSinVer() > 0) { <b class="rojo">{{ store.perdidasSinVer() }}</b> }</a>
        <a routerLink="personas" routerLinkActive="on"><mat-icon>groups</mat-icon><span>Personas</span></a>
        <a routerLink="compromisos" routerLinkActive="on"><mat-icon>task_alt</mat-icon><span>Compromisos</span></a>
        <a routerLink="buscar" routerLinkActive="on"><mat-icon>manage_search</mat-icon><span>Buscar</span></a>
        @if (store.administraContactos()) {
          <a routerLink="contactos" routerLinkActive="on" class="admin"><mat-icon>support_agent</mat-icon><span>Contactos</span></a>
        }
      </nav>
      <div class="cuerpo"><router-outlet /></div>
    </div>`,
  styles: [`
    :host { display: block; }
    .shell { display: flex; flex-direction: column; min-height: 480px; background: var(--surface);
      border: 1px solid var(--border); border-radius: var(--r-lg, 16px); overflow: hidden; box-shadow: var(--shadow-sm); }
    .pestanas { display: flex; gap: .15rem; padding: .35rem .5rem 0; border-bottom: 1px solid var(--border); background: var(--surface-2);
      flex: none; overflow-x: auto; scrollbar-width: none; }
    .pestanas a { position: relative; display: inline-flex; align-items: center; gap: .35rem; padding: .5rem .85rem; color: var(--text-2);
      text-decoration: none; font-weight: 600; font-size: .86rem; border-radius: 10px 10px 0 0; border-bottom: 2px solid transparent; white-space: nowrap; }
    .pestanas a:hover { background: var(--surface-3); }
    .pestanas a.on { color: var(--primary); border-bottom-color: var(--primary); background: var(--surface); }
    .pestanas a.admin { margin-left: auto; }
    .pestanas mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .pestanas b { background: var(--brand-blue, #2B59F0); color: #fff; border-radius: 999px; font-size: .66rem; padding: 0 .38rem; line-height: 1.5; }
    .pestanas b.rojo { background: #DC2626; }
    .cuerpo { flex: 1; min-height: 0; }
    @media (max-width: 900px) {
      /* Como app: de arriba hasta la barra de navegación del celular. */
      .shell { position: fixed; inset: 0 0 calc(var(--mobile-bottombar-h, 68px) + env(safe-area-inset-bottom)) 0; height: auto !important;
        min-height: 0; z-index: 140; border: 0; border-radius: 0; box-shadow: none; padding-top: env(safe-area-inset-top); }
      /* Una conversación abierta tapa también la barra de abajo (vuelve con la flecha). */
      .shell.enfoque { bottom: 0; z-index: 160; padding-bottom: env(safe-area-inset-bottom); }
      .shell.enfoque .pestanas { display: none; }
      .pestanas { padding: 0; gap: 0; background: var(--surface); }
      .pestanas a { flex: 1 1 0; min-width: 0; flex-direction: column; gap: .05rem; justify-content: center; padding: .4rem 0 .3rem;
        font-size: .6rem; letter-spacing: -.01em; border-radius: 0; }
      .pestanas a span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
      .pestanas a.admin { margin-left: 0; }
      .pestanas b { position: absolute; top: 3px; left: calc(50% + 6px); }
    }
  `],
})
export class ComunicacionesShell implements OnInit {
  readonly store = inject(ChatStoreService);
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly alto = signal<number | null>(null);

  constructor() {
    afterNextRender(() => {
      this.medir();
      const alCambiar = () => this.medir();
      window.addEventListener('resize', alCambiar);
      // La barra de turnos aparece o desaparece: se vuelve a medir.
      const ro = new ResizeObserver(alCambiar);
      ro.observe(document.body);
      this.destroyRef.onDestroy(() => { window.removeEventListener('resize', alCambiar); ro.disconnect(); });
    });
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => requestAnimationFrame(() => this.medir()));
    this.destroyRef.onDestroy(() => this.store.enfoqueMovil.set(false));
  }

  ngOnInit(): void { this.store.iniciar(); }

  /** Lo que queda de pantalla debajo del borde superior del módulo (en escritorio). */
  private medir(): void {
    if (window.innerWidth <= 900) { this.alto.set(null); return; }
    const arriba = this.el.nativeElement.getBoundingClientRect().top + window.scrollY;
    const alto = Math.round(window.innerHeight - arriba - 16);
    if (alto !== this.alto()) this.alto.set(Math.max(480, alto));
  }
}

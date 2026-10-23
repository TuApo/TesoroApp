import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map } from 'rxjs';
import { ChatStoreService } from '../../service/chat-store.service';
import { DockService } from '../../service/dock.service';
import { ComCabecera } from '../../components/cabecera/cabecera';
import { ComConversacion } from '../../components/conversacion/conversacion';
import { ComDetalles } from '../../components/detalles/detalles';
import { ComListaChats } from '../../components/lista-chats/lista-chats';
import { NuevoChatDialog } from '../../components/nuevo-chat/nuevo-chat';

/** Chats a pantalla completa: lista, conversación y el panel de detalles. */
@Component({
  selector: 'app-com-chats-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, ComListaChats, ComCabecera, ComConversacion, ComDetalles],
  template: `
    <div class="chats" [class.con-conv]="!!actual()" [class.con-info]="info() && !!actual()">
      <aside class="izq">
        <div class="izq-cab">
          <h2>Chats</h2>
          <button type="button" class="nuevo" (click)="nuevo()" matTooltip="Nuevo chat o grupo"><mat-icon>edit_square</mat-icon> Nuevo</button>
        </div>
        <app-com-lista-chats [activa]="actual()?.id ?? null" [conFiltros]="true" (elegir)="elegir($event)" />
      </aside>
      <main class="centro">
        @if (actual(); as c) {
          <button type="button" class="volver" (click)="elegir(null)" aria-label="Volver a la lista"><mat-icon>arrow_back</mat-icon></button>
          <app-com-cabecera [c]="c" modo="pagina" (info)="alternarInfo()" (alternar)="c.tipo !== 'SOPORTE' && alternarInfo()" />
          <!-- Una instancia por conversación: al cambiar de chat se arma de nuevo (scroll, raya de no leídos). -->
          @for (id of [c.id]; track id) { <app-com-conversacion [conversacionId]="id" /> }
        } @else {
          <div class="vacio">
            <mat-icon>forum</mat-icon>
            <h3>Comunicaciones</h3>
            <p>Chatea con tu equipo, llama por voz o video y deja que la plataforma guarde el acta: lo que se dijo,
              lo que se decidió y quién quedó de hacer qué.</p>
            <div class="botones">
              <button type="button" class="nuevo" (click)="nuevo()"><mat-icon>add</mat-icon> Empezar un chat</button>
              <button type="button" class="nuevo sec" (click)="soporte()"><mat-icon>support_agent</mat-icon> Pedir ayuda al asistente</button>
            </div>
          </div>
        }
      </main>
      @if (info() && actual(); as c) {
        @if (c.tipo !== 'SOPORTE') {
          <aside class="der">
            <button type="button" class="cerrar-info" (click)="alternarInfo()" aria-label="Cerrar detalles"><mat-icon>arrow_back</mat-icon> Volver al chat</button>
            <app-com-detalles [conversacionId]="c.id" />
          </aside>
        }
      }
    </div>`,
  styles: [`
    :host { display: block; height: 100%; }
    .chats { display: grid; grid-template-columns: 330px minmax(0, 1fr); height: 100%; }
    .chats.con-info { grid-template-columns: 330px minmax(0, 1fr) 340px; }
    .izq { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
    .izq-cab { display: flex; align-items: center; justify-content: space-between; padding: .7rem .8rem .2rem; }
    .izq-cab h2 { margin: 0; font-size: 1.1rem; }
    .nuevo { display: inline-flex; align-items: center; gap: .3rem; border: 0; background: var(--primary); color: #fff; border-radius: 999px;
      padding: .4rem .9rem; font: inherit; font-weight: 700; font-size: .82rem; cursor: pointer; }
    .nuevo mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .nuevo.sec { background: var(--surface); color: var(--com-verde-txt); border: 1px solid var(--com-verde-txt); }
    .botones { display: flex; gap: .5rem; flex-wrap: wrap; justify-content: center; }
    app-com-lista-chats { flex: 1; min-height: 0; }
    .centro { position: relative; display: flex; flex-direction: column; min-height: 0; background: var(--surface); }
    .centro app-com-conversacion { flex: 1; min-height: 0; }
    .der { min-height: 0; }
    .volver, .cerrar-info { display: none; }
    .der { display: flex; flex-direction: column; border-left: 1px solid var(--border); }
    .der app-com-detalles { flex: 1; min-height: 0; }
    .vacio { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem;
      color: var(--muted); gap: .3rem; background: radial-gradient(circle at 50% 35%, var(--surface-2), var(--surface) 70%); }
    .vacio > mat-icon { font-size: 64px; width: 64px; height: 64px; color: var(--primary); opacity: .75; }
    .vacio h3 { margin: .3rem 0 0; color: var(--text); font-size: 1.3rem; }
    .vacio p { max-width: 460px; line-height: 1.55; margin: .2rem 0 .8rem; }
    @media (max-width: 1200px) { .chats.con-info { grid-template-columns: 290px minmax(0, 1fr) 320px; } }
    @media (max-width: 900px) {
      .chats, .chats.con-info { grid-template-columns: minmax(0, 1fr); }
      .chats.con-conv .izq { display: none; }
      .chats:not(.con-conv) .centro { display: none; }
      .chats.con-info .centro { display: none; }
      .izq { border-right: 0; }
      .izq-cab { padding: .5rem .7rem 0; }
      .izq-cab h2 { font-size: 1.05rem; }
      .izq-cab .nuevo { padding: .35rem .8rem; font-size: .8rem; }
      .volver { display: inline-flex; position: absolute; top: 10px; left: 2px; z-index: 2; border: 0; background: transparent; width: 36px; height: 36px;
        align-items: center; justify-content: center; cursor: pointer; color: var(--text-2); }
      .centro app-com-cabecera { padding-left: 34px; }
      .der { border-left: 0; }
      .cerrar-info { display: inline-flex; align-items: center; gap: .3rem; border: 0; border-bottom: 1px solid var(--border); background: var(--surface);
        color: var(--primary); font: inherit; font-weight: 600; padding: .65rem .8rem; cursor: pointer; }
    }
  `],
})
export class ChatsPage {
  private readonly store = inject(ChatStoreService);
  private readonly dock = inject(DockService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  private readonly params = toSignal(this.route.queryParamMap.pipe(map(p => ({ c: p.get('c'), info: p.get('info') === '1' }))),
    { initialValue: { c: null as string | null, info: false } });
  readonly info = signal(false);
  readonly actual = computed(() => this.store.conversacion(this.params().c));

  constructor() {
    this.info.set(this.params().info);
    // En el celular, con una conversación abierta, el chat toma toda la pantalla.
    effect(() => {
      const abierta = !!this.actual();
      untracked(() => this.store.enfoqueMovil.set(abierta && typeof window !== 'undefined' && window.innerWidth <= 900));
    });
    this.destroyRef.onDestroy(() => this.store.enfoqueMovil.set(false));
    this.store.eventos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ nombre, datos }) => {
      if (nombre === 'abrir-conversacion' && datos?.conversacion_id) this.elegir(datos.conversacion_id);
    });
  }

  async soporte(): Promise<void> {
    try { this.elegir((await this.store.abrirSoporte()).id); } catch { /* soporte apagado */ }
  }

  elegir(id: string | null): void {
    // Si estaba abierta en el dock, se cierra allá: aquí se ve completa.
    if (id) this.dock.cerrar(id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { c: id }, replaceUrl: true });
  }

  alternarInfo(): void { this.info.update(v => !v); }

  nuevo(): void {
    const ref = this.dialog.open(NuevoChatDialog, { autoFocus: 'input', panelClass: 'com-dialogo' });
    ref.afterClosed().subscribe(id => { if (typeof id === 'string') this.elegir(id); });
  }
}

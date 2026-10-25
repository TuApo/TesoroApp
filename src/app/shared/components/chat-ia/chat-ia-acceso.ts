import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ContextoChatIa } from './chat-ia.modelos';
import { ChatIa } from './chat-ia';
import { AvatarAgente } from '../avatar-agente/avatar-agente';
import { AvatarAgenteService } from '../avatar-agente/avatar-agente.service';
import { ChatIaService } from './chat-ia.service';

/**
 * Acceso rápido al chat de IA desde cualquier módulo: un botón (flotante o dentro de una barra)
 * que abre el chat en un panel lateral (pantalla completa en el celular) con el contexto del
 * módulo. Recuerda la última conversación de ese módulo y tienda mientras dure la sesión.
 *
 * Uso: `<app-chat-ia-acceso [contexto]="contextoChat()" />` donde contextoChat es un computed
 * con el módulo, la tienda, los parámetros de consulta y un resumen de lo que se ve.
 */
@Component({
  selector: 'app-chat-ia-acceso',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, ChatIa, AvatarAgente],
  template: `
    <!-- El botón flotante del robot («Preguntar a la IA») se retiró el 22-oct-2026: duplicaba la
         pestaña IA del chat lateral y confundía. Solo queda la variante 'boton' dentro de una barra. -->
    @if (servicio() && variante() === 'boton') {
      <button type="button" class="ciaa-boton" (click)="abrir()" [attr.aria-expanded]="abierto()" aria-haspopup="dialog">
        <app-avatar-agente [personaje]="director()" [tam]="24" [animado]="false" [conTitulo]="false" /><span>{{ etiqueta() }}</span>
      </button>
    }
    @if (abierto()) {
      <div class="ciaa-fondo" (click)="cerrarPanel()" aria-hidden="true"></div>
      <aside class="ciaa-panel" [class.ciaa-panel--ancho]="ancho()" role="dialog" aria-label="Chat de Tu Apo IA">
        <button type="button" class="ciaa-ancho" (click)="ancho.set(!ancho())" [attr.aria-label]="ancho() ? 'Panel angosto' : 'Panel ancho'"
                [matTooltip]="ancho() ? 'Angostar' : 'Ensanchar'" matTooltipPosition="left">
          <mat-icon>{{ ancho() ? 'close_fullscreen' : 'open_in_full' }}</mat-icon>
        </button>
        <app-chat-ia [contexto]="contexto()" [(conversacionId)]="conversacionId" [mostrarCerrar]="true" (cerrar)="cerrarPanel()" />
      </aside>
    }
  `,
  styles: [`
    :host { display: contents; }
    .ciaa-boton { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px 5px 6px; border-radius: 999px; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--brand-blue) 35%, var(--border)); background: color-mix(in srgb, var(--brand-blue) 7%, var(--surface));
      color: var(--brand-blue); font: 600 .84rem var(--font-sans); white-space: nowrap; }
    .ciaa-boton:hover { background: color-mix(in srgb, var(--brand-blue) 13%, var(--surface)); }
    .ciaa-fondo { position: fixed; inset: 0; z-index: 1290; background: rgb(15 27 45 / .28); animation: ciaa-aparecer .15s ease-out; }
    .ciaa-panel { position: fixed; z-index: 1300; top: 0; right: 0; bottom: 0; width: min(460px, 100vw); display: flex; flex-direction: column;
      background: var(--surface); box-shadow: -12px 0 32px rgb(15 27 45 / .22); animation: ciaa-entrar .2s ease-out; }
    .ciaa-panel--ancho { width: min(860px, 100vw); }
    .ciaa-panel app-chat-ia { flex: 1; min-height: 0; }
    .ciaa-ancho { position: absolute; left: -36px; top: 66px; width: 32px; height: 32px; border-radius: 10px 0 0 10px; border: 0; cursor: pointer;
      background: var(--surface); color: var(--text-2); box-shadow: -4px 2px 10px rgb(15 27 45 / .15); display: grid; place-items: center; }
    .ciaa-ancho mat-icon { font-size: 18px; width: 18px; height: 18px; }
    @keyframes ciaa-entrar { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes ciaa-aparecer { from { opacity: 0; } }
    @media (max-width: 900px) { .ciaa-ancho { display: none; } .ciaa-panel--ancho { width: 100vw; } }
    @media (max-width: 600px) {
      .ciaa-panel { width: 100vw; top: env(safe-area-inset-top); }
    }
    @media (prefers-reduced-motion: reduce) { .ciaa-panel, .ciaa-fondo { animation: none; } }
  `],
})
export class ChatIaAcceso {
  readonly contexto = input.required<ContextoChatIa>();
  readonly variante = input<'flotante' | 'boton'>('flotante');
  readonly texto = input<string | null>(null);

  readonly abierto = signal(false);
  /** El servicio de chat respondió: solo entonces se ofrece el botón. */
  readonly servicio = signal(false);
  readonly ancho = signal(false);
  readonly conversacionId = signal<number | null>(null);
  private avatares = inject(AvatarAgenteService);
  /** Avatar Agent: el director del módulo (el presidente si no tiene). */
  readonly director = computed(() => this.avatares.deModulo(this.contexto().modulo));
  readonly etiqueta = computed(() => this.texto() ?? `Preguntar a ${this.director().nombreCorto}`);

  private readonly clave = computed(() => `tuapo.chatia.conv.${this.contexto().modulo}.${this.contexto().tiendaId ?? 'todas'}`);

  constructor() {
    this.avatares.cargar();
    inject(ChatIaService).estado().subscribe({ next: () => this.servicio.set(true), error: () => this.servicio.set(false) });
    // Al cambiar de módulo o de tienda se retoma la última conversación de ESE contexto.
    effect(() => {
      const k = this.clave();
      untracked(() => {
        let id: number | null = null;
        try { id = Number(sessionStorage.getItem(k)) || null; } catch { /* sin almacenamiento */ }
        this.conversacionId.set(id);
      });
    });
    effect(() => {
      const id = this.conversacionId();
      const k = untracked(() => this.clave());
      try { if (id) sessionStorage.setItem(k, String(id)); else sessionStorage.removeItem(k); } catch { /* opcional */ }
    });
  }

  abrir(): void {
    this.abierto.set(true);
  }

  cerrarPanel(): void {
    this.abierto.set(false);
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    // Con la vista previa de un archivo abierta, Escape cierra solo esa vista.
    if (this.abierto() && !document.querySelector('.cdk-overlay-container .mat-mdc-dialog-container')) this.cerrarPanel();
  }
}

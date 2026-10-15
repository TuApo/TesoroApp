import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ContextoChatIa } from './chat-ia.modelos';
import { ChatIa } from './chat-ia';
import { ChatIaRobot } from './chat-ia-robot';
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
  imports: [MatIconModule, MatTooltipModule, ChatIa, ChatIaRobot],
  template: `
    @if (!servicio()) {
      <!-- Sin el servicio de chat (p. ej. ms-ai sin desplegar) no se pinta nada. -->
    } @else if (variante() === 'boton') {
      <button type="button" class="ciaa-boton" (click)="abrir()" [attr.aria-expanded]="abierto()" aria-haspopup="dialog">
        <app-chat-ia-robot [tam]="22" /><span>{{ etiqueta() }}</span>
      </button>
    } @else if (!abierto()) {
      <button type="button" class="ciaa-flotante" (click)="abrir()" [matTooltip]="'Pregúntale a la IA sobre ' + contexto().moduloNombre"
              matTooltipPosition="left" aria-haspopup="dialog" [attr.aria-label]="etiqueta()">
        <app-chat-ia-robot [tam]="30" /><span class="ciaa-flotante-txt">{{ etiqueta() }}</span>
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
    .ciaa-flotante { position: fixed; z-index: 1140; right: calc(var(--com-barra, 0px) + 64px); bottom: 18px; display: flex; align-items: center; gap: 8px;
      padding: 6px 16px 6px 8px; border: 0; border-radius: 999px; cursor: pointer; font: 600 .86rem var(--font-sans); color: #fff;
      background: linear-gradient(135deg, #2B59F0, #1E3A9E); box-shadow: 0 6px 18px rgb(30 58 158 / .35); transition: transform .15s, box-shadow .15s; }
    .ciaa-flotante:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgb(30 58 158 / .42); }
    .ciaa-flotante:focus-visible { outline: 3px solid #7DD3FC; outline-offset: 2px; }
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
      .ciaa-flotante { right: auto; left: 12px; bottom: calc(var(--mobile-bottombar-h, 68px) + env(safe-area-inset-bottom) + 12px); padding: 6px; }
      .ciaa-flotante-txt { display: none; }
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
  readonly etiqueta = computed(() => this.texto() ?? 'Preguntar a la IA');

  private readonly clave = computed(() => `tuapo.chatia.conv.${this.contexto().modulo}.${this.contexto().tiendaId ?? 'todas'}`);

  constructor() {
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

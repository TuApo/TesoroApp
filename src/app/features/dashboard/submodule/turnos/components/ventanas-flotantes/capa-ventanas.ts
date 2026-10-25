import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { GestorVentanas } from './gestor-ventanas';
import { VentanaFlotante } from './ventana-flotante';

/**
 * Todas las ventanas flotantes más su barra de pestañas (abajo a la izquierda: a la derecha
 * vive el dock del chat). Una pestaña resaltada es una sugerencia de la IA que aún nadie abrió.
 */
@Component({
  selector: 'app-capa-ventanas',
  standalone: true,
  imports: [MatIconModule, VentanaFlotante],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="capa" [class.capa--arrastrando]="gestor.arrastrando()">
      @for (v of gestor.ventanas(); track v.id) {
        <app-ventana-flotante [ventana]="v" [cedula]="cedula()" />
      }
      @if (verBarra()) {
        <nav class="barra" aria-label="Módulos abiertos en ventana">
          @for (v of gestor.ventanas(); track v.id) {
            <div class="pestana" [class.pestana--frente]="gestor.alFrente() === v.id" [class.pestana--min]="v.estado === 'minimizada'" [class.pestana--nueva]="v.nueva">
              <button type="button" class="pestana__abrir" (click)="gestor.alternarDesdePestana(v.id)"
                      [attr.aria-pressed]="v.estado !== 'minimizada'"
                      [title]="(v.estado === 'minimizada' ? 'Abrir ' : gestor.alFrente() === v.id ? 'Minimizar ' : 'Traer al frente ') + v.titulo + (v.subtitulo ? ' · ' + v.subtitulo : '')">
                <mat-icon>{{ v.icono }}</mat-icon>
                <span class="pestana__txt"><b>{{ v.titulo }}</b>@if (v.subtitulo) { <small>{{ v.subtitulo }}</small> }</span>
                @if (v.nueva) { <span class="pestana__punto" aria-label="Sugerida"></span> }
              </button>
              <button type="button" class="pestana__cerrar" (click)="gestor.cerrar(v.id)" [attr.aria-label]="'Cerrar ' + v.titulo" title="Cerrar"><mat-icon>close</mat-icon></button>
            </div>
          }
        </nav>
      }
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .capa--arrastrando ::ng-deep iframe { pointer-events: none; }
    .capa button { min-height: 0 !important; font-family: inherit; }
    .barra {
      position: fixed; z-index: 995; left: calc(var(--app-menu-w, 0px) + 16px); bottom: 12px;
      max-width: calc(100vw - var(--app-menu-w, 0px) - 100px); display: flex; gap: 6px; padding: 5px;
      border-radius: 14px; background: rgb(var(--surface-rgb) / .92); border: 1px solid var(--border);
      box-shadow: var(--shadow-md); backdrop-filter: blur(8px); overflow-x: auto; scrollbar-width: none;
    }
    .pestana { display: flex; align-items: stretch; flex: none; max-width: 240px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); overflow: hidden; }
    .pestana--frente { border-color: color-mix(in srgb, var(--navy) 70%, var(--border)); box-shadow: inset 0 -2px 0 var(--lime); }
    .pestana--min { background: var(--surface-2); }
    .pestana--nueva { border-color: color-mix(in srgb, var(--lime-2) 70%, var(--border)); background: color-mix(in srgb, var(--lime) 12%, var(--surface)); }
    .pestana__abrir { display: flex; align-items: center; gap: 7px; min-width: 0; height: 40px; padding: 0 8px 0 9px; border: 0; background: transparent; color: var(--text); cursor: pointer; text-align: left; }
    .pestana__abrir mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--link); flex: none; }
    .pestana__txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
    .pestana__txt b { font-size: 12px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pestana__txt small { font-size: 10.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pestana__punto { width: 8px; height: 8px; border-radius: 50%; background: var(--lime-2); flex: none; animation: capa-pulso 1.8s ease-in-out infinite; }
    @keyframes capa-pulso { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--lime) 30%, transparent); } }
    .pestana__cerrar { display: inline-flex; align-items: center; justify-content: center; width: 30px; border: 0; border-left: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer; }
    .pestana__cerrar mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pestana__cerrar:hover { color: var(--danger-fg); background: var(--danger-bg); }
    .pestana__abrir:hover { background: var(--surface-3); }
    .pestana button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--brand-blue); }
    @media (max-width: 900px) {
      .barra { left: 8px; right: 8px; max-width: none; bottom: calc(var(--mobile-bottombar-h, 68px) + env(safe-area-inset-bottom) + 8px); }
    }
    @media (pointer: coarse) {
      .pestana__abrir { height: 44px; }
      .pestana__cerrar { width: 44px; }
    }
    @media (prefers-reduced-motion: reduce) { .pestana__punto { animation: none; } }
  `],
})
export class CapaVentanas {
  readonly cedula = input<string | null>(null);

  readonly gestor = inject(GestorVentanas);

  /** En móvil una ventana abierta ocupa toda la pantalla: la barra se esconde hasta minimizarla. */
  readonly verBarra = computed(() => this.gestor.ventanas().length > 0 && !(this.gestor.movil() && this.gestor.visibles().length > 0));

  @HostListener('window:resize')
  alRedimensionar(): void {
    this.gestor.alCambiarViewport(window.innerWidth, window.innerHeight);
  }
}

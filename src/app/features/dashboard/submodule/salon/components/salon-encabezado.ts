import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { SALON_RUTA_BASE } from '../services/salon-api.token';
import { SALON_CONTEXTO, permisosDeContexto } from '../services/salon-contexto.token';
import { SalonStreamService } from '../services/salon-stream.service';
import { SalonSelectorSede } from './selector-sede';

/** Título, selector de sede, indicador de visión/canal y pestañas del submódulo. */
@Component({
  selector: 'app-salon-encabezado',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, RouterLinkActive, SalonSelectorSede],
  template: `
    <header class="enc">
      <div class="enc-titulo">
        <span class="enc-logo" aria-hidden="true"><mat-icon>table_restaurant</mat-icon></span>
        <div class="enc-texto">
          <h1>{{ titulo() }}</h1>
          @if (subtitulo()) { <p>{{ subtitulo() }}</p> }
        </div>
        <span class="sl-esp"></span>
        <app-salon-selector-sede />
        @if (mostrarVision()) {
          <span class="sl-chip" [class]="'sl-chip ' + vision().tono" aria-live="polite" [title]="vision().detalle">
            <mat-icon>{{ vision().icono }}</mat-icon>{{ vision().texto }}
          </span>
        }
      </div>
      <nav class="enc-tabs" aria-label="Salón inteligente">
        <a [routerLink]="base" routerLinkActive="enc-activo" [routerLinkActiveOptions]="{ exact: true }"><mat-icon>grid_view</mat-icon>Plano</a>
        <a [routerLink]="base + '/anfitrion'" routerLinkActive="enc-activo"><mat-icon>groups</mat-icon>Anfitrión</a>
        <a [routerLink]="base + '/alertas'" routerLinkActive="enc-activo"><mat-icon>notifications_active</mat-icon>Alertas</a>
        <a [routerLink]="base + '/analitica'" routerLinkActive="enc-activo"><mat-icon>insights</mat-icon>Analítica</a>
        @if (permisos.puedeAdministrar()) {
          <a [routerLink]="base + '/calibracion'" routerLinkActive="enc-activo"><mat-icon>center_focus_strong</mat-icon>Calibración</a>
          <a [routerLink]="base + '/configuracion'" routerLinkActive="enc-activo"><mat-icon>settings</mat-icon>Configuración</a>
        }
      </nav>
    </header>
  `,
  styles: [`
    :host { display: block; }
    .enc { display: flex; flex-direction: column; gap: 10px; }
    .enc-titulo { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .enc-logo { width: 44px; height: 44px; border-radius: var(--r-md); background: var(--blue-soft); color: var(--primary);
      display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .enc-logo mat-icon { font-size: 26px; width: 26px; height: 26px; }
    .enc-texto { min-width: 0; }
    .enc-texto h1 { margin: 0; font-size: 1.3rem; font-weight: 800; color: var(--navy-ink); line-height: 1.15; }
    .enc-texto p { margin: 2px 0 0; color: var(--muted); font-size: .88rem; }
    .enc-tabs { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
    .enc-tabs a { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 42px; padding: 0 14px; border-radius: 999px;
      border: 2px solid var(--border); background: var(--surface); color: var(--text-2); font-weight: 700; text-decoration: none; white-space: nowrap; }
    .enc-tabs a mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .enc-tabs a.enc-activo { background: var(--primary); border-color: var(--primary); color: #fff; }
  `],
})
export class SalonEncabezado {
  readonly permisos = permisosDeContexto(inject(SALON_CONTEXTO));
  readonly stream = inject(SalonStreamService);
  readonly base = inject(SALON_RUTA_BASE);

  readonly titulo = input('Salón inteligente');
  readonly subtitulo = input<string>('');
  /** Pinta el chip «visión OK / modo manual / sin visión» (solo donde hay plano en vivo). */
  readonly mostrarVision = input(false);

  readonly vision = computed(() => {
    const p = this.stream.plano();
    const canal = this.stream.estado();
    if (!p) {
      return canal === 'conectando' || canal === 'reconectando'
        ? { tono: 'sl-tono-neutro', icono: 'sync', texto: 'Conectando…', detalle: 'Abriendo el canal en vivo' }
        : { tono: 'sl-tono-neutro', icono: 'visibility_off', texto: 'Sin datos', detalle: 'Aún no llega el plano' };
    }
    if (p.modo_manual) return { tono: 'sl-tono-warn', icono: 'pan_tool', texto: 'Modo manual', detalle: 'La visión no cambia estados; se operan a mano' };
    if (!p.vision_ok) return { tono: 'sl-tono-danger', icono: 'videocam_off', texto: 'Sin visión', detalle: 'El worker o las cámaras no responden' };
    const sufijo = canal === 'sondeo' ? ' · sondeo' : canal === 'reconectando' ? ' · reconectando' : '';
    return { tono: 'sl-tono-ok', icono: 'visibility', texto: `Visión OK${sufijo}`, detalle: 'Worker y cámaras con latido reciente' };
  });
}

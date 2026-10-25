import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { TemporadaService } from '../../../core/services/temporada.service';

/**
 * Adornos animados de la temporada, encima de toda la plataforma y sin estorbar: la capa no
 * recibe clics (pointer-events: none) salvo la calabaza, que al tocarla oculta los adornos
 * para esa persona (la paleta de colores se queda). Con «reducir movimiento» del sistema no
 * se anima nada. Hoy trae Halloween; cada temporada nueva agrega su bloque aquí.
 */
@Component({
  selector: 'app-adornos-temporada',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (halloween()) {
      <div class="capa" aria-hidden="true">
        <svg class="murcielago m1" viewBox="0 0 64 30"><path d="M32 9c-1.6-3.2-3.4-5-5.2-5.6.7 2.3.2 4.1-1.2 5C22.4 5.6 15.6 4 8 6.6c3.7 1.5 6.1 4.8 6.4 8.6 2.8-1.7 6.5-1.8 9.4.1.8-2.2 2.6-3.6 4.6-4 .8 1.3 2.2 2.1 3.6 2.1s2.8-.8 3.6-2.1c2 .4 3.8 1.8 4.6 4 2.9-1.9 6.6-1.8 9.4-.1.3-3.8 2.7-7.1 6.4-8.6-7.6-2.6-14.4-1-17.6 2.4-1.4-.9-1.9-2.7-1.2-5C35.4 4 33.6 5.8 32 9z"/></svg>
        <svg class="murcielago m2" viewBox="0 0 64 30"><path d="M32 9c-1.6-3.2-3.4-5-5.2-5.6.7 2.3.2 4.1-1.2 5C22.4 5.6 15.6 4 8 6.6c3.7 1.5 6.1 4.8 6.4 8.6 2.8-1.7 6.5-1.8 9.4.1.8-2.2 2.6-3.6 4.6-4 .8 1.3 2.2 2.1 3.6 2.1s2.8-.8 3.6-2.1c2 .4 3.8 1.8 4.6 4 2.9-1.9 6.6-1.8 9.4-.1.3-3.8 2.7-7.1 6.4-8.6-7.6-2.6-14.4-1-17.6 2.4-1.4-.9-1.9-2.7-1.2-5C35.4 4 33.6 5.8 32 9z"/></svg>
        <svg class="murcielago m3" viewBox="0 0 64 30"><path d="M32 9c-1.6-3.2-3.4-5-5.2-5.6.7 2.3.2 4.1-1.2 5C22.4 5.6 15.6 4 8 6.6c3.7 1.5 6.1 4.8 6.4 8.6 2.8-1.7 6.5-1.8 9.4.1.8-2.2 2.6-3.6 4.6-4 .8 1.3 2.2 2.1 3.6 2.1s2.8-.8 3.6-2.1c2 .4 3.8 1.8 4.6 4 2.9-1.9 6.6-1.8 9.4-.1.3-3.8 2.7-7.1 6.4-8.6-7.6-2.6-14.4-1-17.6 2.4-1.4-.9-1.9-2.7-1.2-5C35.4 4 33.6 5.8 32 9z"/></svg>

        <svg class="telarana" viewBox="0 0 120 120">
          <g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">
            <path d="M120 0 L0 0 M120 0 L0 40 M120 0 L18 92 M120 0 L60 118 M120 0 L104 120"/>
            <path d="M96 0 Q100 12 108 20 Q112 10 120 6"/>
            <path d="M72 0 Q78 20 94 36 Q104 22 120 14"/>
            <path d="M46 0 Q56 30 80 52 Q96 34 120 24"/>
            <path d="M22 0 Q34 40 66 68 Q88 46 120 34"/>
          </g>
        </svg>
        <span class="hilo"><span class="arana">
          <svg viewBox="0 0 40 40"><g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">
            <path d="M14 16 L4 10 M14 20 L2 20 M14 24 L4 30 M16 27 L10 36 M26 16 L36 10 M26 20 L38 20 M26 24 L36 30 M24 27 L30 36"/></g>
            <ellipse cx="20" cy="21" rx="7" ry="8" fill="currentColor"/><circle cx="20" cy="12" r="5" fill="currentColor"/>
            <circle cx="18" cy="11" r="1.2" fill="#F97316"/><circle cx="22" cy="11" r="1.2" fill="#F97316"/></svg>
        </span></span>

        <svg class="fantasma" viewBox="0 0 60 70">
          <path d="M30 4C16 4 8 15 8 28v34l7-6 7 6 8-6 8 6 7-6 7 6V28C52 15 44 4 30 4z" fill="#F8FAFC"/>
          <ellipse cx="22" cy="28" rx="4" ry="6" fill="#1E1B4B"/><ellipse cx="38" cy="28" rx="4" ry="6" fill="#1E1B4B"/>
          <ellipse cx="30" cy="42" rx="4" ry="3" fill="#1E1B4B" opacity=".7"/>
        </svg>
      </div>
      <button type="button" class="calabaza" (click)="ocultar()" title="Ocultar adornos de Halloween" aria-label="Ocultar adornos de Halloween">
        <svg viewBox="0 0 64 60">
          <path d="M30 6c0-3 2-5 5-5 1 2 0 4-2 6" fill="none" stroke="#4D7C0F" stroke-width="4" stroke-linecap="round"/>
          <ellipse cx="20" cy="34" rx="15" ry="22" fill="#EA580C"/><ellipse cx="44" cy="34" rx="15" ry="22" fill="#EA580C"/>
          <ellipse cx="32" cy="34" rx="16" ry="24" fill="#F97316"/>
          <path class="cara" d="M18 28l7-7 4 7zM35 28l4-7 7 7zM16 40c5 6 27 6 32 0l-4 2-3-3-3 4-3-3-3 3-3-4-3 3z" fill="#FDE047"/>
        </svg>
      </button>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* Por encima de las barras fijas (z 40) para que nada quede cortado; por debajo de diálogos. */
    .capa { position: fixed; inset: 0; pointer-events: none; z-index: 45; overflow: hidden; }
    .murcielago { position: absolute; left: -80px; width: 34px; height: 16px; fill: #1E0B3B; opacity: .75;
      animation: volar 26s linear infinite, aletear .35s ease-in-out infinite alternate; transform-origin: center;
      filter: drop-shadow(0 2px 3px rgba(30, 11, 59, .25)); }
    :host-context(html[data-theme='dark']) .murcielago { fill: #C4B5FD; opacity: .6; }
    .m1 { top: 9%; animation-delay: 0s, 0s; }
    .m2 { top: 18%; width: 24px; height: 12px; animation-duration: 33s, .3s; animation-delay: -12s, 0s; }
    .m3 { top: 4%; width: 28px; height: 13px; animation-duration: 41s, .4s; animation-delay: -27s, 0s; }
    @keyframes volar {
      0% { transform: translate(0, 0); } 25% { transform: translate(28vw, 26px); } 50% { transform: translate(56vw, -10px); }
      75% { transform: translate(84vw, 22px); } 100% { transform: translate(calc(100vw + 160px), 0); }
    }
    @keyframes aletear { from { scale: 1 1; } to { scale: 1 .45; } }
    .telarana { position: absolute; top: 0; right: 0; width: 96px; height: 96px; color: #7C3AED; opacity: .26; }
    :host-context(html[data-theme='dark']) .telarana { color: #DDD6FE; opacity: .2; }
    /* La araña cuelga en el borde derecho, en el margen: no tapa el carrito ni el avatar. */
    .hilo { position: absolute; top: 0; right: 10px; width: 1px; height: 70px; background: rgba(124, 58, 237, .45);
      transform-origin: top center; animation: colgar 7s ease-in-out infinite; }
    .arana { position: absolute; bottom: -16px; left: -10px; width: 20px; height: 20px; color: #1E0B3B; }
    :host-context(html[data-theme='dark']) .arana { color: #E9D5FF; }
    .arana svg { width: 100%; height: 100%; }
    @keyframes colgar { 0%, 100% { height: 74px; rotate: -3deg; } 50% { height: 128px; rotate: 3deg; } }
    .fantasma { position: absolute; right: 6%; bottom: -90px; width: 44px; height: 52px; opacity: 0; filter: drop-shadow(0 6px 12px rgba(30, 11, 59, .25));
      animation: flotar 44s ease-in-out infinite; animation-delay: 6s; }
    @keyframes flotar {
      0%, 70% { transform: translate(0, 0); opacity: 0; } 74% { opacity: .9; }
      86% { transform: translate(-40px, -46vh); opacity: .85; } 100% { transform: translate(-10px, -80vh); opacity: 0; }
    }
    .calabaza { position: fixed; left: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); z-index: 46; width: 46px; height: 46px;
      min-height: 46px !important; padding: 0; margin: 0 !important; border: 0; background: none; cursor: pointer;
      filter: drop-shadow(0 4px 10px rgba(234, 88, 12, .45)); animation: rebotar 3.2s ease-in-out infinite;
      transition: left .25s ease, opacity .25s ease; }
    .calabaza svg { width: 100%; height: 100%; }
    .calabaza .cara { animation: brillar 2.4s ease-in-out infinite; }
    .calabaza:hover { scale: 1.08; }
    @keyframes rebotar { 0%, 100% { translate: 0 0; } 50% { translate: 0 -4px; } }
    @keyframes brillar { 0%, 100% { fill: #FDE047; } 50% { fill: #FEF9C3; } 60% { fill: #FACC15; } }

    /* Celular: menos es más. Dos murciélagos pequeños cruzando arriba; la telaraña y la araña
       se quitan (arriba a la derecha están los botones) y la calabaza asoma del borde
       izquierdo, a media altura, sin tapar tarjetas. */
    @media (max-width: 700px) {
      .m3, .fantasma, .telarana, .hilo { display: none; }
      .m1 { top: 3%; width: 26px; height: 12px; animation-duration: 30s, .35s; }
      .m2 { top: 12%; width: 18px; height: 9px; animation-duration: 38s, .3s; }
      .calabaza { width: 36px; height: 36px; min-height: 36px !important; left: -12px; opacity: .9;
        bottom: auto; top: 58%; animation: asomar 5s ease-in-out infinite; }
      .calabaza:active { left: 4px; opacity: 1; }
      /* En EconomiAPP los adornos se apagan desde «Mi cuenta»; los banderines de la barra hacen la fiesta. */
      :host-context(html[data-app='economiapp']) .calabaza { display: none; }
    }
    @keyframes asomar { 0%, 100% { rotate: 12deg; } 50% { rotate: 22deg; translate: 3px 0; } }
    @media (prefers-reduced-motion: reduce) {
      .murcielago, .fantasma { display: none; }
      .hilo, .calabaza, .calabaza .cara { animation: none; }
    }
    @media print { .capa, .calabaza { display: none; } }
  `],
})
export class AdornosTemporadaComponent {
  private readonly temporada = inject(TemporadaService);
  readonly halloween = computed(() => this.temporada.clave() === 'halloween' && this.temporada.adornos());

  ocultar(): void { this.temporada.ponerAdornos(false); }
}

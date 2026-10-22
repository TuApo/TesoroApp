import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * El robot de Tu Apo IA. Parpadea solo, la antena titila mientras piensa y la boca se abre con
 * el volumen de la voz mientras habla (el nivel viene del reproductor). Es un SVG: escala sin
 * perder nitidez y respeta el tema claro/oscuro.
 */
@Component({
  selector: 'app-chat-ia-robot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="tam()" [attr.height]="tam()" viewBox="0 0 64 64" role="img"
         [attr.aria-label]="hablando() ? 'Tu Apo IA está hablando' : pensando() ? 'Tu Apo IA está pensando' : 'Tu Apo IA'"
         [class.pensando]="pensando()" [class.hablando]="hablando()">
      <defs>
        <linearGradient id="cia-cabeza" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3B6BFF" />
          <stop offset="1" stop-color="#1E3A9E" />
        </linearGradient>
      </defs>
      <line x1="32" y1="6" x2="32" y2="14" stroke="#1E3A9E" stroke-width="3" stroke-linecap="round" />
      <circle class="antena" cx="32" cy="6" r="4.2" />
      <rect x="8" y="14" width="48" height="40" rx="14" fill="url(#cia-cabeza)" />
      <rect x="4" y="28" width="6" height="12" rx="3" fill="#1E3A9E" />
      <rect x="54" y="28" width="6" height="12" rx="3" fill="#1E3A9E" />
      <rect x="14" y="21" width="36" height="26" rx="10" fill="#0B1330" />
      <g class="ojos">
        <ellipse cx="24.5" cy="31" rx="4" ry="4.4" fill="#7DF9FF" />
        <ellipse cx="39.5" cy="31" rx="4" ry="4.4" fill="#7DF9FF" />
      </g>
      <rect class="boca" [attr.x]="32 - bocaAncho() / 2" [attr.y]="41 - bocaAlto() / 2" [attr.width]="bocaAncho()"
            [attr.height]="bocaAlto()" rx="2.2" fill="#7DF9FF" />
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; line-height: 0; }
    svg { overflow: visible; filter: drop-shadow(0 2px 4px rgb(30 58 158 / .25)); }
    .antena { fill: #7DD3FC; transition: fill .2s; }
    .pensando .antena { animation: cia-titilar 1s ease-in-out infinite; }
    .ojos { transform-origin: 32px 31px; animation: cia-parpadeo 5s infinite; }
    .pensando .ojos { animation: cia-mirar 1.6s ease-in-out infinite; }
    @keyframes cia-parpadeo { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
    @keyframes cia-mirar { 0%, 100% { transform: translateX(-2px); } 50% { transform: translateX(2px); } }
    @keyframes cia-titilar { 0%, 100% { fill: #7DD3FC; } 50% { fill: #FDE047; } }
    @media (prefers-reduced-motion: reduce) { .ojos, .pensando .antena, .pensando .ojos { animation: none; } }
  `],
})
export class ChatIaRobot {
  readonly tam = input(40);
  readonly hablando = input(false);
  readonly pensando = input(false);
  /** Volumen de la voz (0..1) mientras habla. */
  readonly nivel = input(0);

  readonly bocaAlto = computed(() => this.hablando() ? 2 + Math.round(this.nivel() * 9) : 2.6);
  readonly bocaAncho = computed(() => this.hablando() ? 14 - Math.round(this.nivel() * 3) : 14);
}

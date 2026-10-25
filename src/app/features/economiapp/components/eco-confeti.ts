import { ChangeDetectionStrategy, Component, input } from '@angular/core';

interface Pieza { x: number; d: number; r: number; c: string; w: number; h: number; s: number; }

const COLORES = ['#F97316', '#A855F7', '#FACC15', '#22C55E', '#38BDF8', '#F43F5E', '#FFFFFF'];

/**
 * Lluvia de confeti para festejar (puntos ganados, premio canjeado). Solo CSS: unas decenas
 * de piezas con posición, giro y demora al azar; se pinta encima de lo que la contenga y no
 * recibe clics. Con «reducir movimiento» no se muestra.
 */
@Component({
  selector: 'eco-confeti',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of piezas; track $index) {
      <i [style.left.%]="p.x" [style.animation-delay.ms]="p.d" [style.--r]="p.r + 'deg'" [style.background]="p.c"
         [style.width.px]="p.w" [style.height.px]="p.h" [style.animation-duration.ms]="p.s"></i>
    }
  `,
  styles: [`
    :host { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 2; }
    i { position: absolute; top: -20px; border-radius: 2px; opacity: 0; animation: caer linear forwards; }
    @keyframes caer {
      0% { transform: translate3d(0, 0, 0) rotate(0); opacity: 1; }
      100% { transform: translate3d(calc(var(--r) / 4), 110vh, 0) rotate(var(--r)); opacity: .9; }
    }
    @media (prefers-reduced-motion: reduce) { :host { display: none; } }
  `],
})
export class EcoConfeti {
  readonly cantidad = input(70);
  readonly piezas: Pieza[] = Array.from({ length: 70 }, () => ({
    x: Math.random() * 100,
    d: Math.random() * 700,
    r: (Math.random() * 900 - 450) | 0,
    c: COLORES[(Math.random() * COLORES.length) | 0],
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 10,
    s: 1800 + Math.random() * 1600,
  }));
}

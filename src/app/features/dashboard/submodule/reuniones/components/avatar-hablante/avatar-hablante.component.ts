import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { colorVar } from '../../utils/hablantes';
import { iniciales } from '../../utils/texto';

/**
 * Círculo con las iniciales de quien habló, en su color de hablante. Es decorativo
 * (`aria-hidden`): el nombre siempre va escrito al lado.
 */
@Component({
  selector: 'app-reu-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="av" aria-hidden="true"
          [style.--hc]="color()"
          [style.width.px]="tam()" [style.height.px]="tam()"
          [style.font-size.px]="tam() * 0.38">{{ letras() }}</span>`,
  styles: [`
    :host { display: inline-flex; flex: none; }
    .av {
      display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
      background: var(--hc); color: var(--hc-on, #fff); font-weight: 750; letter-spacing: .01em;
      line-height: 1; user-select: none; box-shadow: 0 0 0 2px var(--surface);
      font-variant-numeric: tabular-nums;
    }
  `],
})
export class AvatarHablanteComponent {
  readonly nombre = input<string | null | undefined>('');
  readonly colorIdx = input<number | null | undefined>(null);
  readonly tam = input(32);

  readonly letras = computed(() => iniciales(this.nombre()));
  readonly color = computed(() => colorVar(this.colorIdx()));
}

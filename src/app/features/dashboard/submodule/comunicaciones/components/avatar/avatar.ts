import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AvataresService } from '../../service/avatares.service';
import { colorDe, iniciales } from '../../utiles';

/** Foto (o iniciales) con el punto verde de "conectado" y el ícono de grupo. */
@Component({
  selector: 'app-com-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="av" [style.width.px]="tam()" [style.height.px]="tam()" [style.fontSize.px]="tam() * 0.4"
          [style.background]="foto() ? 'transparent' : (color() || fondo())" [attr.aria-label]="nombre()">
      @if (icono(); as i) { <span class="material-icons" [style.fontSize.px]="tam() * 0.55">{{ i }}</span> }
      @else if (foto(); as f) { <img [src]="f" alt="" /> }
      @else if (grupo()) { <span class="material-icons" [style.fontSize.px]="tam() * 0.55">groups</span> }
      @else { {{ letras() }} }
      @if (presencia() !== null) {
        <i class="punto" [class.on]="presencia()" [style.width.px]="tam() * 0.3" [style.height.px]="tam() * 0.3"></i>
      }
      @if (coordinador()) {
        <i class="coord material-icons" title="Coordinador" [style.fontSize.px]="tam() * 0.3 + 3">star</i>
      }
    </span>`,
  styles: [`
    :host { display: inline-flex; flex: none; }
    .av { position: relative; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; letter-spacing: .02em; user-select: none; }
    img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .punto { position: absolute; right: -1px; bottom: -1px; border-radius: 50%; background: var(--text-faint, #94a3b8);
      border: 2px solid var(--surface, #fff); box-sizing: border-box; min-width: 9px; min-height: 9px; }
    .punto.on { background: #22C55E; }
    .coord { position: absolute; right: -4px; top: -4px; border-radius: 50%; background: #F59E0B; color: #fff; line-height: 1;
      padding: 1px; border: 2px solid var(--surface, #fff); font-style: normal; }
  `],
})
export class ComAvatar {
  private readonly avatares = inject(AvataresService);
  readonly usuarioId = input<string | null>(null);
  readonly nombre = input<string | null>('');
  readonly tieneFoto = input(false);
  readonly tam = input(36);
  readonly grupo = input(false);
  readonly color = input<string | null>(null);
  /** Ícono en lugar de foto o iniciales (grupos por rango, soporte). */
  readonly icono = input<string | null>(null);
  /** Estrella de coordinador. */
  readonly coordinador = input(false);
  /** null = no mostrar punto. */
  readonly presencia = input<boolean | null>(null);

  readonly letras = computed(() => iniciales(this.nombre()));
  readonly fondo = computed(() => colorDe(this.usuarioId() ?? this.nombre()));
  readonly foto = computed(() => this.avatares.foto(this.usuarioId(), this.tieneFoto())());
}

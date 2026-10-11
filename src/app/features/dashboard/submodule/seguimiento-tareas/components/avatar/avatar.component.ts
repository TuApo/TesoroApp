import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { DirectorioService, colorDe, iniciales } from '../../services/directorio.service';

/**
 * Círculo con las iniciales de una persona (o el ícono de grupo). El nombre completo va
 * en el tooltip y en aria-label: el avatar nunca es la única forma de saber quién es.
 */
@Component({
  selector: 'app-tarea-avatar',
  standalone: true,
  imports: [MatTooltipModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (grupo()) {
      <span class="av av--grupo" [style.width.px]="tam()" [style.height.px]="tam()"
            [matTooltip]="'Grupo ' + grupo()" [attr.aria-label]="'Grupo ' + grupo()">
        <mat-icon [style.font-size.px]="tam() * .55" [style.width.px]="tam() * .55" [style.height.px]="tam() * .55">groups</mat-icon>
      </span>
    } @else if (usuario()) {
      <span class="av" [style.background]="color()" [style.width.px]="tam()" [style.height.px]="tam()"
            [style.font-size.px]="tam() * .4" [matTooltip]="nombre()" [attr.aria-label]="nombre()">{{ ini() }}</span>
    } @else {
      <span class="av av--vacio" [style.width.px]="tam()" [style.height.px]="tam()"
            matTooltip="Sin responsable" aria-label="Sin responsable">
        <mat-icon [style.font-size.px]="tam() * .55" [style.width.px]="tam() * .55" [style.height.px]="tam() * .55">person_outline</mat-icon>
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; flex: none; }
    .av { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
          color: #fff; font-weight: 800; letter-spacing: .02em; line-height: 1; user-select: none;
          box-shadow: 0 0 0 2px var(--surface); }
    .av--grupo { background: var(--violet-bg); color: var(--violet-fg); }
    .av--vacio { background: var(--surface-3); color: var(--text-faint); border: 1px dashed var(--border-strong); box-shadow: none; }
    mat-icon { line-height: 1; }
  `],
})
export class TareaAvatarComponent {
  private readonly dir = inject(DirectorioService);
  readonly usuario = input<string | null | undefined>(null);
  readonly grupo = input<string | null | undefined>(null);
  readonly tam = input(28);
  /** Nombre ya conocido (p.ej. de un miembro) cuando el directorio aún no cargó. */
  readonly nombreConocido = input<string | null | undefined>(null);

  readonly nombre = computed(() => {
    this.dir.personas();
    const n = this.dir.persona(this.usuario())?.nombre;
    return n ?? this.nombreConocido() ?? this.dir.nombre(this.usuario());
  });
  readonly ini = computed(() => {
    this.dir.personas();
    return this.dir.persona(this.usuario()) ? this.dir.iniciales(this.usuario()) : iniciales(this.nombre());
  });
  readonly color = computed(() => colorDe(this.usuario() ?? ''));
}

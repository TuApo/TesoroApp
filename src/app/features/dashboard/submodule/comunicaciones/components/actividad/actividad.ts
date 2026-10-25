import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { actividad } from '../../utiles';

/**
 * Si alguien está activo en la plataforma: punto de color + "En línea", "Activo hace
 * 2 h", "Activo ayer" o "No ha entrado a la plataforma".
 */
@Component({
  selector: 'app-com-actividad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="act" [attr.data-nivel]="a().nivel" [attr.title]="a().texto"><i></i>{{ corto() ? a().corto : a().texto }}</span>`,
  styles: [`
    :host { display: inline-flex; min-width: 0; max-width: 100%; }
    .act { display: inline-flex; align-items: center; gap: .3rem; font-size: .72rem; color: var(--muted); white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    i { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--text-faint, #94a3b8); }
    [data-nivel='en-linea'] { color: var(--com-ok-txt); font-weight: 700; }
    [data-nivel='en-linea'] i { background: #22C55E; box-shadow: 0 0 0 3px rgba(34, 197, 94, .18); }
    [data-nivel='hoy'] i { background: #86EFAC; }
    [data-nivel='semana'] i { background: #FCD34D; }
    [data-nivel='nunca'] { font-style: italic; opacity: .85; }
    [data-nivel='nunca'] i { background: transparent; border: 1.5px solid var(--text-faint, #94a3b8); box-sizing: border-box; }
  `],
})
export class ComActividad {
  readonly enLinea = input<boolean | null | undefined>(false);
  readonly ultimaVezMs = input<number | null | undefined>(null);
  /** Texto corto ("Hace 2 h") para listas estrechas. */
  readonly corto = input(false);
  readonly a = computed(() => actividad(this.enLinea(), this.ultimaVezMs()));
}

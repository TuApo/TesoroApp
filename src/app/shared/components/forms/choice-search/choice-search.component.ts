import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender,
  computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { FieldOption } from '../field.model';
import {
  CHOICE_OPTIONS_RESOLVER, ChoiceOptionsSource, choiceRestrictionMessage,
} from '../choice-options';
import { OptionMatch, searchOptions } from './option-search';

/** Contador módulo-nivel: ids únicos por instancia (mismo patrón que los campos). */
let nextUid = 0;

/**
 * BUSCADOR de opciones: el control que usan los tres campos de selección
 * (SINGLE_CHOICE, DROPDOWN y MULTIPLE_CHOICE) en lugar de radios/checkboxes/`<select>`.
 *
 * Se escribe y la lista se filtra en vivo con `searchOptions` (sin tildes, sin
 * mayúsculas, por trozo de palabra o hasta por letras salteadas), ordenada de más
 * a menos parecida y con lo coincidente resaltado. El botón del final despliega
 * TODAS las opciones tal cual están configuradas: limpia lo escrito y abre la lista.
 *
 * CONTRATO: `selected` y `selectedChange` hablan LABELS de opción, nunca los values
 * internos — es lo que guarda el backend y lo que pinta el detalle de la respuesta.
 * En múltiple, la selección se emite SIEMPRE en el orden de las opciones.
 *
 * Las opciones pueden ser ESTÁTICAS (input `options`) o venir de un ORIGEN DE DATOS
 * (`optionsSource`): en ese caso se piden al resolver registrado en
 * CHOICE_OPTIONS_RESOLVER, que aplica en servidor las reglas del origen y, si hay
 * cascada, filtra por `parentValue`. Cuando el origen no devuelve nada se explica por
 * qué (falta elegir el campo padre, sin permiso…) en vez de dejar un control mudo.
 *
 * La lista se despliega en flujo (no flotante): dentro del teléfono de la vista previa
 * y del WebView de Android una capa absoluta se recortaría contra el contenedor con
 * scroll. Máximo 240px de alto y scroll propio.
 */
@Component({
  selector: 'app-choice-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="df-cs" #wrap [class.df-cs--disabled]="disabled()" (focusout)="onFocusOut($event, wrap)">

      <div class="df-cs__box"
           [class.df-cs__box--open]="open()"
           [class.df-cs__box--invalid]="invalid()"
           (click)="focusInput()">

        @if (multiple()) {
          @for (label of selected(); track label) {
            <span class="df-cs__chip">
              <span class="df-cs__chip-txt">{{ label }}</span>
              @if (!disabled()) {
                <button type="button" class="df-cs__chip-x" tabindex="-1"
                        [attr.aria-label]="'Quitar ' + label"
                        (click)="remove(label)">
                  <span class="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              }
            </span>
          }
        }

        <input #box class="df-cs__input" type="text" role="combobox"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               aria-autocomplete="list"
               [id]="inputId() || base"
               [value]="query()"
               [disabled]="unavailable()"
               [placeholder]="hint()"
               [attr.aria-expanded]="open()"
               [attr.aria-controls]="base + '-list'"
               [attr.aria-required]="required()"
               [attr.aria-invalid]="invalid()"
               [attr.aria-activedescendant]="activeId()"
               (focus)="onFocus()"
               (input)="onInput($event)"
               (keydown)="onKeydown($event)" />

        @if (showClear()) {
          <button type="button" class="df-cs__btn" tabindex="-1"
                  aria-label="Limpiar selección" (click)="clear()">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        }

        <button type="button" class="df-cs__btn" tabindex="-1"
                [disabled]="unavailable()"
                [attr.aria-label]="open() ? 'Ocultar opciones' : 'Ver todas las opciones'"
                [attr.aria-expanded]="open()"
                [attr.aria-controls]="base + '-list'"
                (click)="toggleAll()">
          <span class="material-symbols-outlined df-cs__chev"
                [class.df-cs__chev--up]="open()" aria-hidden="true">expand_more</span>
        </button>
      </div>

      @if (open()) {
        <!-- mousedown cancelado: el foco NO sale del input, así el clic en una opción
             llega antes de que el focusout cierre la lista. -->
        <ul class="df-cs__list" role="listbox"
            [id]="base + '-list'"
            [attr.aria-multiselectable]="multiple() || null"
            (mousedown)="$event.preventDefault()">
          @for (m of matches(); track $index) {
            <li class="df-cs__opt" role="option"
                [id]="base + '-opt-' + $index"
                [class.df-cs__opt--active]="active() === $index"
                [class.df-cs__opt--on]="isOn(m.option.label)"
                [class.df-cs__opt--off]="blocked(m.option.label)"
                [attr.aria-selected]="isOn(m.option.label)"
                [attr.aria-disabled]="blocked(m.option.label) || null"
                (mouseenter)="active.set($index)"
                (click)="pick(m.option)">
              <span class="df-cs__tick material-symbols-outlined" aria-hidden="true">{{ tick(m.option.label) }}</span>
              <span class="df-cs__txt">
                @for (s of m.segments; track $index) {
                  @if (s.hit) { <mark class="df-cs__hit">{{ s.text }}</mark> } @else { {{ s.text }} }
                }
              </span>
            </li>
          } @empty {
            <li class="df-cs__none" role="presentation">{{ emptyText() }}</li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .df-cs { position: relative; }

    .df-cs__box {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      box-sizing: border-box;
      min-height: 40px;
      padding: 4px 4px 4px 10px;
      border: 1px solid var(--slate-300, #cbd5e1);
      border-radius: var(--r-sm, 10px);
      background: var(--surface, #fff);
      cursor: text;
    }
    .df-cs__box--open {
      border-color: var(--navy, #21263c);
      box-shadow: 0 0 0 2px rgba(140, 213, 10, 0.35);
    }
    .df-cs__box--invalid { border-color: #c0392b; }
    .df-cs--disabled .df-cs__box { background: var(--slate-50, #f8fafc); cursor: default; }

    .df-cs__input {
      flex: 1 1 90px;
      min-width: 0;
      padding: 4px 0;
      border: none;
      outline: none;
      background: transparent;
      font: inherit;
      color: var(--navy-deep, #0f172a);
    }
    .df-cs__input:disabled { color: var(--slate-500, #64748b); }

    .df-cs__btn {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--slate-500, #64748b);
      cursor: pointer;
    }
    .df-cs__btn:hover:not(:disabled) { background: var(--slate-100, #f1f5f9); color: var(--navy, #21263c); }
    .df-cs__btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .df-cs__btn .material-symbols-outlined { font-size: 20px; }
    .df-cs__chev { transition: transform 0.15s ease; }
    .df-cs__chev--up { transform: rotate(180deg); }

    .df-cs__chip {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      max-width: 100%;
      padding: 2px 2px 2px 10px;
      border: 1px solid var(--slate-200, #e2e8f0);
      border-radius: 999px;
      background: var(--slate-100, #f1f5f9);
      font-size: 0.84rem;
      color: var(--navy-deep, #0f172a);
    }
    .df-cs__chip-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .df-cs__chip-x {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--slate-500, #64748b);
      cursor: pointer;
    }
    .df-cs__chip-x:hover { background: var(--slate-200, #e2e8f0); color: #c0392b; }
    .df-cs__chip-x .material-symbols-outlined { font-size: 15px; }

    .df-cs__list {
      list-style: none;
      margin: 6px 0 0;
      padding: 4px;
      max-height: 240px;
      overflow-y: auto;
      border: 1px solid var(--slate-200, #e2e8f0);
      border-radius: var(--r-sm, 10px);
      background: var(--surface, #fff);
      box-shadow: var(--shadow-sm, 0 6px 16px rgba(17, 24, 39, 0.08));
    }
    .df-cs__opt {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 8px;
      border-radius: 8px;
      font-size: 0.9rem;
      color: var(--navy-deep, #0f172a);
      cursor: pointer;
    }
    .df-cs__opt--active { background: var(--slate-100, #f1f5f9); }
    .df-cs__opt--on { font-weight: 600; }
    .df-cs__opt--off { opacity: 0.45; cursor: not-allowed; }
    .df-cs__tick { flex: 0 0 auto; font-size: 18px; color: var(--slate-500, #64748b); }
    .df-cs__opt--on .df-cs__tick { color: var(--navy, #21263c); }
    .df-cs__txt { min-width: 0; word-break: break-word; }
    .df-cs__hit {
      padding: 0 1px;
      border-radius: 3px;
      background: rgba(140, 213, 10, 0.38);
      color: inherit;
      font-weight: 700;
    }
    .df-cs__none {
      padding: 8px;
      font-size: 0.85rem;
      color: var(--slate-500, #64748b);
    }
  `],
})
export class ChoiceSearchComponent {
  /** Opciones configuradas en el campo, en su orden. */
  options = input<FieldOption[]>([]);
  /** Selección actual, en LABELS. */
  selected = input<string[]>([]);
  multiple = input(false);
  placeholder = input('');
  disabled = input(false);
  invalid = input(false);
  required = input(false);
  /** Tope de selección (solo múltiple): al alcanzarlo, el resto se bloquea. */
  maxSelected = input<number | null>(null);
  /** Id del input, para que el `<label for>` del campo lo enfoque. */
  inputId = input('');
  /** Origen de datos del que salen las opciones (null = usar `options`). */
  optionsSource = input<ChoiceOptionsSource | null>(null);
  /** Valor actual del campo padre cuando el origen encadena en cascada. */
  parentValue = input<string | null>(null);

  selectedChange = output<string[]>();

  private readonly uid = nextUid++;
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resolver = inject(CHOICE_OPTIONS_RESOLVER, { optional: true });
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  private pending: Subscription | null = null;

  /** Prefijo de ids de esta instancia (lista y opciones, para aria-activedescendant). */
  readonly base = `df-cs-${this.uid}`;

  readonly query = signal('');
  readonly open = signal(false);
  /** Índice resaltado por teclado dentro de `matches()`; -1 = ninguno. */
  readonly active = signal(-1);

  /** Opciones traídas del origen (null mientras no se haya resuelto ninguna vez). */
  private readonly remote = signal<FieldOption[] | null>(null);
  readonly loading = signal(false);
  private readonly restriction = signal<string | null>(null);

  /** Las que manda: las del origen si hay, si no las estáticas. */
  readonly opts = computed<FieldOption[]>(() =>
    this.optionsSource()?.source ? (this.remote() ?? []) : this.options());

  readonly matches = computed<OptionMatch[]>(() => searchOptions(this.opts(), this.query()));
  private readonly selectedSet = computed(() => new Set(this.selected()));
  private readonly maxReached = computed(() => {
    const max = this.maxSelected();
    return max != null && this.selected().length >= max;
  });

  constructor() {
    // Origen de datos: se resuelve al montar y cada vez que cambia el valor del padre
    // (cascada). Una petición en vuelo se cancela antes de lanzar la siguiente para que
    // no gane la respuesta vieja si el usuario cambia el padre dos veces seguidas.
    effect(() => {
      const src = this.optionsSource();
      const parent = this.parentValue();
      this.pending?.unsubscribe();
      this.pending = null;
      if (!src?.source) {
        this.remote.set(null);
        this.restriction.set(null);
        this.loading.set(false);
        return;
      }
      if (!this.resolver) {
        this.remote.set([]);
        this.restriction.set('Sin resolver de orígenes disponible');
        return;
      }
      this.loading.set(true);
      this.pending = this.resolver.resolveOptions(src.source, parent ?? null).subscribe({
        next: res => {
          this.remote.set(res.options ?? []);
          this.restriction.set(res.restricted ? choiceRestrictionMessage(res.reason) : null);
          this.loading.set(false);
          if (!res.restricted) this.dropStaleSelection(res.options ?? []);
        },
        error: () => {
          this.remote.set([]);
          this.restriction.set(choiceRestrictionMessage('catalogo_no_disponible'));
          this.loading.set(false);
        },
      });
    });
    this.destroyRef.onDestroy(() => this.pending?.unsubscribe());

    // Con la lista cerrada el input muestra la selección (modo simple) o queda limpio
    // para seguir buscando (múltiple): lo escrito nunca sobrevive al cierre.
    effect(() => {
      const reposo = this.multiple() ? '' : (this.selected()[0] ?? '');
      if (!this.open()) this.query.set(reposo);
    });
  }

  hint(): string {
    if (this.loading()) return 'Cargando opciones…';
    const restriction = this.restriction();
    if (restriction) return restriction;
    if (!this.opts().length) return 'Sin opciones configuradas';
    return this.placeholder() || 'Escribe para buscar…';
  }

  /** Ni buscar ni desplegar tiene sentido sin opciones que mostrar. */
  unavailable(): boolean {
    return this.disabled() || this.loading() || !this.opts().length;
  }

  /** Texto del panel cuando no hay nada que listar. */
  emptyText(): string {
    if (this.loading()) return 'Cargando opciones…';
    const restriction = this.restriction();
    if (restriction) return restriction;
    if (!this.opts().length) return 'Sin opciones configuradas';
    return `Sin coincidencias para «${this.query()}»`;
  }

  activeId(): string | null {
    const i = this.active();
    return this.open() && i >= 0 && i < this.matches().length ? `${this.base}-opt-${i}` : null;
  }

  showClear(): boolean {
    return !this.multiple() && !this.disabled() && this.selected().length > 0;
  }

  isOn(label: string): boolean {
    return this.selectedSet().has(label);
  }

  /** Opción no marcable por haberse alcanzado el máximo. */
  blocked(label: string): boolean {
    return this.multiple() && this.maxReached() && !this.isOn(label);
  }

  tick(label: string): string {
    if (this.multiple()) return this.isOn(label) ? 'check_box' : 'check_box_outline_blank';
    return this.isOn(label) ? 'radio_button_checked' : 'radio_button_unchecked';
  }

  /**
   * Descarta lo seleccionado que ya no está en la lista recién resuelta: al cambiar el
   * campo padre de una cascada, la elección anterior deja de tener sentido (y el servidor
   * la rechazaría al enviar). Solo cuando la resolución trajo lista de verdad — si vino
   * restringida (catálogo caído, falta el padre) NO se toca lo que el usuario ya tenía.
   */
  private dropStaleSelection(options: FieldOption[]): void {
    const current = this.selected();
    if (!current.length) return;
    const valid = new Set(options.map(o => o.label));
    const kept = current.filter(l => valid.has(l));
    if (kept.length !== current.length) {
      this.selectedChange.emit(kept);
    }
  }

  /** Clic en cualquier zona del recuadro: el cursor va al buscador. */
  focusInput(): void {
    if (!this.disabled()) this.box()?.nativeElement.focus();
  }

  onFocus(): void {
    if (this.disabled()) return;
    this.open.set(true);
    this.active.set(this.firstActive());
    // Modo simple: el texto en reposo es la opción elegida; seleccionarlo deja que
    // escribir la reemplace en vez de tener que borrarla a mano.
    if (!this.multiple() && this.query()) this.box()?.nativeElement.select();
  }

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.open.set(true);
    this.active.set(this.firstActive());
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Enter': {
        // El runtime pinta los campos dentro de un <form>: Enter aquí elige opción,
        // jamás envía el formulario.
        event.preventDefault();
        const m = this.open() ? this.matches()[this.active()] : undefined;
        if (m) this.pick(m.option);
        else if (!this.open()) this.toggleAll();
        break;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        break;
      case 'Backspace':
        if (this.multiple() && !this.query() && this.selected().length) {
          event.preventDefault();
          this.remove(this.selected()[this.selected().length - 1]);
        }
        break;
      case 'Tab':
        this.close();
        break;
      default:
        break;
    }
  }

  onFocusOut(event: FocusEvent, wrap: HTMLElement): void {
    const to = event.relatedTarget as Node | null;
    if (to && wrap.contains(to)) return;
    // Diferido: en táctil el foco puede rebotar dentro del propio control.
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) this.close();
    }, 0);
  }

  /** Botón del final: despliega TODAS las opciones (limpia el filtro) o cierra. */
  toggleAll(): void {
    if (this.unavailable()) return;
    if (this.open() && !this.query()) {
      this.close();
      return;
    }
    this.query.set('');
    this.open.set(true);
    this.active.set(this.firstActive());
    this.box()?.nativeElement.focus();
    this.scrollActive();
  }

  pick(option: FieldOption): void {
    const label = option.label;
    if (this.disabled() || this.blocked(label)) return;

    if (this.multiple()) {
      // Se emite en el orden de las opciones, no en el de marcado.
      const next = this.isOn(label)
        ? this.selected().filter(l => l !== label)
        : this.opts().map(o => o.label).filter(l => l === label || this.isOn(l));
      this.selectedChange.emit(next);
      return; // la lista sigue abierta: se pueden marcar varias seguidas
    }

    this.query.set(label);
    this.selectedChange.emit([label]);
    this.close();
  }

  remove(label: string): void {
    if (this.disabled()) return;
    this.selectedChange.emit(this.selected().filter(l => l !== label));
  }

  clear(): void {
    if (this.disabled()) return;
    this.query.set('');
    this.selectedChange.emit([]);
  }

  private close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  private firstActive(): number {
    return this.matches().findIndex(m => !this.blocked(m.option.label));
  }

  private move(delta: number): void {
    if (!this.open()) {
      this.open.set(true);
      this.active.set(this.firstActive());
      this.scrollActive();
      return;
    }
    const list = this.matches();
    if (!list.length) return;
    let i = this.active();
    if (i < 0) i = delta > 0 ? -1 : 0;
    for (let n = 0; n < list.length; n++) {
      i = (i + delta + list.length) % list.length;
      if (!this.blocked(list[i].option.label)) {
        this.active.set(i);
        this.scrollActive();
        return;
      }
    }
  }

  /** Mantiene visible la opción resaltada cuando la lista tiene scroll propio. */
  private scrollActive(): void {
    const i = this.active();
    if (i < 0) return;
    afterNextRender(
      () => document.getElementById(`${this.base}-opt-${i}`)?.scrollIntoView({ block: 'nearest' }),
      { injector: this.injector },
    );
  }
}

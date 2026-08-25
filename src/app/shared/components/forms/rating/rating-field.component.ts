import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DynamicField, FieldMode, FieldValue, RatingConfig, validateFieldValue } from '../field.model';

/**
 * Campo RATING — fila de botones 0..scale_max (contrato uniforme de campos).
 * Modo NUMERIC: cada botón muestra su número; modo STARS: estrellas rellenas
 * hasta el valor elegido (el botón 0 conserva el número como "sin calificación").
 * El valor emitido es SIEMPRE un number entero. Accesible como radiogroup con
 * roving tabindex y navegación por flechas / Home / End.
 */
@Component({
  selector: 'app-rating-field',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="df-field" [class.df-field--error]="showErrors && !!error">
      <label class="df-field__label" [attr.id]="labelId">
        {{ field.label }}
        @if (field.required) { <span class="df-field__req" aria-hidden="true">*</span> }
      </label>
      @if (field.schema.description) {
        <p class="df-field__desc">{{ field.schema.description }}</p>
      }

      @switch (mode) {
        @case ('readonly') {
          @if (asNumber !== null) {
            <p class="df-field__value">
              {{ asNumber }} / {{ scaleMax }}
              @if (labelFor(asNumber); as etiqueta) {
                <span class="df-rating__selected"> — {{ etiqueta }}</span>
              }
            </p>
          } @else {
            <p class="df-field__value">—</p>
          }
        }
        @case ('config') {
          <!-- Mini-vista inerte para la tarjeta del builder -->
          <div class="df-rating" aria-hidden="true">
            @for (n of scaleButtons; track n) {
              <button type="button" class="df-rating__btn" disabled tabindex="-1">
                @if (isStars && n > 0) {
                  <span class="material-symbols-outlined">star</span>
                } @else {
                  {{ n }}
                }
              </button>
            }
          </div>
        }
        @default {
          <div class="df-rating"
               role="radiogroup"
               [attr.id]="inputId"
               [attr.aria-labelledby]="labelId"
               [attr.aria-required]="field.required"
               [attr.aria-invalid]="showErrors && !!error"
               (keydown)="onKeydown($event)">
            @for (n of scaleButtons; track n) {
              <button type="button" class="df-rating__btn"
                      role="radio"
                      [attr.data-n]="n"
                      [class.df-rating__btn--active]="asNumber === n"
                      [class.df-rating__btn--fill]="isStars && asNumber !== null && n > 0 && n <= asNumber"
                      [attr.aria-checked]="asNumber === n"
                      [attr.aria-label]="ariaLabelFor(n)"
                      [tabindex]="tabIndexFor(n)"
                      (click)="select(n)">
                @if (isStars && n > 0) {
                  <span class="material-symbols-outlined" aria-hidden="true">star</span>
                } @else {
                  {{ n }}
                }
              </button>
            }
          </div>
          @if (selectedLabel) {
            <p class="df-rating__selected">{{ selectedLabel }}</p>
          }
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styleUrls: ['../field-shared.css'],
  styles: [`
    .df-rating {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .df-rating__btn {
      min-width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      border: 1px solid var(--slate-300, #cbd5e1);
      border-radius: var(--r-sm, 10px);
      background: var(--surface, #fff);
      color: var(--navy, #21263c);
      font: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
    }
    .df-rating__btn:hover:not(:disabled) {
      border-color: var(--navy, #21263c);
    }
    .df-rating__btn:focus-visible {
      outline: 2px solid var(--lime, #8cd50a);
      outline-offset: 1px;
      border-color: var(--navy, #21263c);
    }
    .df-rating__btn:disabled {
      background: var(--slate-50, #f8fafc);
      color: var(--slate-500, #64748b);
      cursor: not-allowed;
    }
    .df-rating__btn--active {
      background: var(--navy, #21263c);
      border-color: var(--navy, #21263c);
      color: #fff;
    }
    .df-rating__btn .material-symbols-outlined {
      font-size: 20px;
    }
    /* Estrellas rellenas hasta el valor seleccionado (modo STARS) */
    .df-rating__btn--fill .material-symbols-outlined,
    .df-rating__btn--active .material-symbols-outlined {
      font-variation-settings: 'FILL' 1;
    }
    .df-rating__selected {
      margin: 0;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--slate-700, #334155);
    }
  `],
})
export class RatingFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Output() valueChange = new EventEmitter<FieldValue>();

  private readonly host = inject(ElementRef<HTMLElement>);

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  get labelId(): string {
    return `${this.inputId}-label`;
  }

  private get cfg(): RatingConfig | undefined {
    return this.field.schema.rating_config;
  }

  get scaleMax(): number {
    return this.cfg?.scale_max ?? 5;
  }

  get isStars(): boolean {
    return this.cfg?.mode === 'STARS';
  }

  /** Botones 0..scale_max (0 = "sin calificación"). */
  get scaleButtons(): number[] {
    return Array.from({ length: this.scaleMax + 1 }, (_, i) => i);
  }

  get asNumber(): number | null {
    return typeof this.value === 'number' && Number.isFinite(this.value) ? this.value : null;
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  /** Etiqueta cruda del catálogo labels para un número (o null). */
  labelFor(n: number | null): string | null {
    if (n === null) return null;
    return this.cfg?.labels?.[String(n)] ?? null;
  }

  /** Etiqueta de la opción seleccionada, solo si show_labels está activo. */
  get selectedLabel(): string | null {
    if (!this.cfg?.show_labels || this.asNumber === null) return null;
    return this.labelFor(this.asNumber);
  }

  ariaLabelFor(n: number): string {
    const base = `${n} de ${this.scaleMax}`;
    const etiqueta = this.labelFor(n);
    return etiqueta ? `${base}: ${etiqueta}` : base;
  }

  /** Roving tabindex: solo el seleccionado (o el 0 si no hay valor) entra por Tab. */
  tabIndexFor(n: number): number {
    const actual = this.asNumber;
    if (actual !== null) return n === actual ? 0 : -1;
    return n === 0 ? 0 : -1;
  }

  select(n: number): void {
    this.value = n;
    this.valueChange.emit(this.value);
  }

  /** Navegación de radiogroup: flechas mueven y seleccionan; Home/End a extremos. */
  onKeydown(ev: KeyboardEvent): void {
    const actual = this.asNumber ?? -1;
    let destino: number;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        destino = Math.min(actual + 1, this.scaleMax);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        destino = Math.max(actual - 1, 0);
        break;
      case 'Home':
        destino = 0;
        break;
      case 'End':
        destino = this.scaleMax;
        break;
      default:
        return;
    }
    ev.preventDefault();
    this.select(destino);
    const btn = (this.host.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>(`button[data-n="${destino}"]`);
    btn?.focus();
  }
}

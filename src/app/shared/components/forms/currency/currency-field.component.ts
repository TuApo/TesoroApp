import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DynamicField, FieldMode, FieldValue, validateFieldValue } from '../field.model';

/** Formateador COP es-CO sin decimales (min=0 explícito para evitar RangeError en motores viejos). */
const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Campo CURRENCY — sigue el contrato uniforme de componentes de campo
 * (ver ejemplar text-short-field.component.ts):
 *   @Input field / mode ('config' | 'preview' | 'readonly') / value / showErrors
 *   @Output valueChange
 * Input numérico con prefijo "$" y ayuda visual con el valor formateado COP debajo.
 * El valor emitido es SIEMPRE number puro o null (nunca NaN ni string formateado);
 * 'readonly' pinta el valor ya formateado en COP.
 */
@Component({
  selector: 'app-currency-field',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="df-field" [class.df-field--error]="showErrors && error">
      <label class="df-field__label" [attr.for]="inputId">
        {{ field.label }}
        @if (field.required) { <span class="df-field__req" aria-hidden="true">*</span> }
      </label>
      @if (field.schema.description) {
        <p class="df-field__desc">{{ field.schema.description }}</p>
      }

      @switch (mode) {
        @case ('readonly') {
          <p class="df-field__value">{{ readonlyText }}</p>
        }
        @case ('config') {
          <div class="df-currency">
            <span class="df-currency__prefix" aria-hidden="true">$</span>
            <input class="df-field__input df-currency__input" type="number" disabled
                   [placeholder]="field.schema.placeholder || '0'" />
          </div>
        }
        @default {
          <div class="df-currency">
            <span class="df-currency__prefix" aria-hidden="true">$</span>
            <input class="df-field__input df-currency__input" type="number" step="any"
                   [id]="inputId"
                   [ngModel]="asNumber"
                   (ngModelChange)="onInput($event)"
                   [placeholder]="field.schema.placeholder || '0'"
                   [min]="field.schema.validation?.min_value ?? null"
                   [max]="field.schema.validation?.max_value ?? null"
                   [attr.aria-required]="field.required"
                   [attr.aria-invalid]="showErrors && !!error"
                   [attr.aria-describedby]="asNumber !== null ? hintId : null" />
          </div>
          @if (asNumber !== null) {
            <p class="df-currency__hint" [id]="hintId">Equivale a {{ formatted }}</p>
          }
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styleUrls: ['../field-shared.css'],
  // Estilos propios del prefijo "$" y de la ayuda formateada (lo demás sale de field-shared.css).
  styles: [`
    .df-currency { position: relative; }
    .df-currency__prefix {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--slate-500, #64748b);
      font-weight: 600;
      pointer-events: none;
    }
    .df-currency__input { padding-left: 26px; }
    .df-currency__hint {
      margin: 0;
      font-size: 0.8rem;
      color: var(--slate-500, #64748b);
    }
  `],
})
export class CurrencyFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Output() valueChange = new EventEmitter<FieldValue>();

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  get hintId(): string {
    return `${this.inputId}-cop`;
  }

  /** Valor normalizado a number finito o null (descarta NaN/Infinity/strings). */
  get asNumber(): number | null {
    return typeof this.value === 'number' && Number.isFinite(this.value) ? this.value : null;
  }

  /** Valor formateado COP es-CO (cadena vacía si no hay valor). */
  get formatted(): string {
    const n = this.asNumber;
    return n === null ? '' : COP.format(n);
  }

  get readonlyText(): string {
    const n = this.asNumber;
    return n === null ? '—' : COP.format(n);
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  /** El NumberValueAccessor de Angular entrega number | null; se blinda NaN igualmente. */
  onInput(v: number | null): void {
    this.value = typeof v === 'number' && Number.isFinite(v) ? v : null;
    this.valueChange.emit(this.value);
  }
}

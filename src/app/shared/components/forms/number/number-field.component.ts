import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DynamicField, FieldMode, FieldValue, validateFieldValue } from '../field.model';

/** Formateador es-CO para pintar el valor en readonly (hasta 6 decimales, sin redondeo visual agresivo). */
const NUM_CO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 });

/**
 * Campo NUMBER — sigue el contrato uniforme de componentes de campo
 * (ver ejemplar text-short-field.component.ts):
 *   @Input field / mode ('config' | 'preview' | 'readonly') / value / showErrors
 *   @Output valueChange
 * El valor emitido es SIEMPRE number puro o null (nunca NaN ni string).
 */
@Component({
  selector: 'app-number-field',
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
          <input class="df-field__input" type="number" disabled
                 [placeholder]="field.schema.placeholder || '0'" />
        }
        @default {
          <input class="df-field__input" type="number" step="any"
                 [id]="inputId"
                 [ngModel]="asNumber"
                 (ngModelChange)="onInput($event)"
                 [placeholder]="field.schema.placeholder || ''"
                 [min]="field.schema.validation?.min_value ?? null"
                 [max]="field.schema.validation?.max_value ?? null"
                 [attr.aria-required]="field.required"
                 [attr.aria-invalid]="showErrors && !!error" />
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styleUrls: ['../field-shared.css'],
})
export class NumberFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Output() valueChange = new EventEmitter<FieldValue>();

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  /** Valor normalizado a number finito o null (descarta NaN/Infinity/strings). */
  get asNumber(): number | null {
    return typeof this.value === 'number' && Number.isFinite(this.value) ? this.value : null;
  }

  get readonlyText(): string {
    const n = this.asNumber;
    return n === null ? '—' : NUM_CO.format(n);
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

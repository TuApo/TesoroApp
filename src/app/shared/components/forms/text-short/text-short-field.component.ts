import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DynamicField, FieldMode, FieldValue, validateFieldValue } from '../field.model';

/**
 * Campo TEXT_SHORT — COMPONENTE EJEMPLAR del contrato uniforme de campos:
 *   @Input field / mode ('config' | 'preview' | 'readonly') / value / showErrors
 *   @Output valueChange
 * 'preview' es el control interactivo (builder-preview y llenado real); 'readonly'
 * pinta el valor en el detalle de una respuesta (por TIPO real, sin heurísticas);
 * 'config' muestra una mini-vista inerte dentro de la tarjeta del builder.
 */
@Component({
  selector: 'app-text-short-field',
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
          <p class="df-field__value">{{ value || '—' }}</p>
        }
        @case ('config') {
          <input class="df-field__input" type="text" disabled
                 [placeholder]="field.schema.placeholder || 'Texto corto'" />
        }
        @default {
          <input class="df-field__input" type="text"
                 [id]="inputId"
                 [ngModel]="asText"
                 (ngModelChange)="onInput($event)"
                 [placeholder]="field.schema.placeholder || ''"
                 [maxlength]="field.schema.validation?.max_length ?? 255"
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
export class TextShortFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Output() valueChange = new EventEmitter<FieldValue>();

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  get asText(): string {
    return typeof this.value === 'string' ? this.value : '';
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  onInput(v: string): void {
    this.value = v?.trim() ? v : null;
    this.valueChange.emit(this.value);
  }
}

import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DynamicField, FieldMode, FieldValue, validateFieldValue } from '../field.model';

/**
 * Campo TEXT_LONG — texto multilínea (textarea). Sigue el contrato uniforme de
 * campos (ver text-short como ejemplar): 'preview' = control interactivo,
 * 'readonly' = valor pintado, 'config' = mini-vista inerte del builder.
 * El ancho completo lo decide el contenedor; aquí solo va el control.
 */
@Component({
  selector: 'app-text-long-field',
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
          <textarea class="df-field__textarea" rows="4" disabled
                    [placeholder]="field.schema.placeholder || 'Texto largo'"></textarea>
        }
        @default {
          <textarea class="df-field__textarea" rows="4"
                    [id]="inputId"
                    [ngModel]="asText"
                    (ngModelChange)="onInput($event)"
                    [placeholder]="field.schema.placeholder || ''"
                    [maxlength]="field.schema.validation?.max_length ?? 4000"
                    [attr.aria-required]="field.required"
                    [attr.aria-invalid]="showErrors && !!error"></textarea>
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styleUrls: ['../field-shared.css'],
})
export class TextLongFieldComponent {
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

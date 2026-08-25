import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DynamicField, FieldMode, FieldValue, validateFieldValue } from '../field.model';

/**
 * Campo TIME — hora con <input type="time">. Sigue el contrato uniforme de
 * campos (ver text-short como ejemplar). El valor viaja SIEMPRE como string
 * 'HH:mm' (wire format del API), que es también lo que se pinta en 'readonly'.
 */
@Component({
  selector: 'app-time-field',
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
          <input class="df-field__input" type="time" disabled />
        }
        @default {
          <input class="df-field__input" type="time"
                 [id]="inputId"
                 [ngModel]="asTime"
                 (ngModelChange)="onInput($event)"
                 [attr.min]="field.schema.validation?.min_time || null"
                 [attr.max]="field.schema.validation?.max_time || null"
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
export class TimeFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Output() valueChange = new EventEmitter<FieldValue>();

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  get asTime(): string {
    return typeof this.value === 'string' ? this.value : '';
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  onInput(v: string): void {
    this.value = v ? v : null;
    this.valueChange.emit(this.value);
  }
}

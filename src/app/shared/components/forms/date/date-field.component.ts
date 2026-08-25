import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DynamicField, FieldMode, FieldValue, validateFieldValue } from '../field.model';

/**
 * Campo DATE — fecha con <input type="date">. Sigue el contrato uniforme de
 * campos (ver text-short como ejemplar). El valor viaja SIEMPRE como string
 * 'YYYY-MM-DD' (wire format del API); en 'readonly' se pinta en formato es-CO.
 */
@Component({
  selector: 'app-date-field',
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
          <p class="df-field__value">{{ displayDate }}</p>
        }
        @case ('config') {
          <input class="df-field__input" type="date" disabled />
        }
        @default {
          <input class="df-field__input" type="date"
                 [id]="inputId"
                 [ngModel]="asDate"
                 (ngModelChange)="onInput($event)"
                 [attr.min]="field.schema.validation?.min_date || null"
                 [attr.max]="field.schema.validation?.max_date || null"
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
export class DateFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Output() valueChange = new EventEmitter<FieldValue>();

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  get asDate(): string {
    return typeof this.value === 'string' ? this.value : '';
  }

  /** Fecha en formato es-CO para 'readonly'; el T00:00:00 fija la zona local. */
  get displayDate(): string {
    const s = this.asDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
    return new Date(s + 'T00:00:00').toLocaleDateString('es-CO', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  onInput(v: string): void {
    this.value = v ? v : null;
    this.valueChange.emit(this.value);
  }
}

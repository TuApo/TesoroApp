import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DynamicField, FieldMode, FieldOption, FieldValue, validateFieldValue } from '../field.model';
import { ChoiceSearchComponent } from '../choice-search/choice-search.component';
import { ChoiceOptionsSource } from '../choice-options';

/** Contador módulo-nivel para ids únicos por instancia. */
let nextUid = 0;

/**
 * Campo SINGLE_CHOICE — BUSCADOR de opciones (app-choice-search) en vez de radios:
 * se escribe y la lista se filtra en vivo por parecido, y el botón del final
 * despliega todas las opciones configuradas. Sigue el contrato uniforme de campos
 * (ver text-short-field.component.ts). REGLA DE ORO: el valor guardado/emitido
 * es el LABEL de la opción (string), nunca el value interno.
 */
@Component({
  selector: 'app-single-choice-field',
  standalone: true,
  imports: [ChoiceSearchComponent],
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
          <p class="df-field__value">{{ asText || '—' }}</p>
        }
        @default {
          <app-choice-search
              [options]="options"
              [selected]="asSelection"
              [placeholder]="field.schema.placeholder || ''"
              [disabled]="mode === 'config'"
              [invalid]="showErrors && !!error"
              [required]="field.required"
              [inputId]="inputId"
              [optionsSource]="optionsSource"
              [parentValue]="parentValue"
              (selectedChange)="onPick($event)" />
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styleUrls: ['../field-shared.css'],
})
export class SingleChoiceFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  /** Valores del resto de campos de la sección: de aquí sale el padre de una cascada. */
  @Input() formValues: Record<string, FieldValue> | null = null;
  @Output() valueChange = new EventEmitter<FieldValue>();

  /** Sufijo único por instancia: evita colisión de ids si el campo se pinta dos veces. */
  private readonly uid = nextUid++;

  get options(): FieldOption[] {
    return this.field.schema?.options ?? [];
  }

  /** Origen de datos del campo (null = opciones estáticas). */
  get optionsSource(): ChoiceOptionsSource | null {
    return this.field.schema?.options_source ?? null;
  }

  /** Valor actual del campo del que depende la cascada, si lo hay. */
  get parentValue(): string | null {
    const parentField = this.optionsSource?.parent_field;
    if (!parentField || !this.formValues) return null;
    const v = this.formValues[parentField];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  }

  /** Id válido en HTML: el label puede traer espacios/tildes y rompería `for`. */
  get inputId(): string {
    const slug = String(this.field.name ?? this.field.label).replace(/[^a-zA-Z0-9_-]/g, '-');
    return `df-sc-${slug}-${this.uid}`;
  }

  get asText(): string {
    return typeof this.value === 'string' ? this.value : '';
  }

  /** El buscador habla en listas de labels; en simple es 0 o 1 elemento. */
  get asSelection(): string[] {
    return this.asText ? [this.asText] : [];
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  onPick(labels: string[]): void {
    // Se emite el LABEL de la opción: el detalle pinta el valor tal cual, sin re-mapear.
    this.value = labels.length ? labels[0] : null;
    this.valueChange.emit(this.value);
  }
}

import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DynamicField, FieldMode, FieldOption, FieldValue, validateFieldValue } from '../field.model';
import { ChoiceSearchComponent } from '../choice-search/choice-search.component';
import { ChoiceOptionsSource } from '../choice-options';

/** Contador módulo-nivel para ids únicos por instancia. */
let nextUid = 0;

/**
 * Campo MULTIPLE_CHOICE — BUSCADOR de opciones (app-choice-search) en vez de
 * checkboxes: se escribe y la lista se filtra en vivo por parecido, lo elegido queda
 * en chips y el botón del final despliega todas las opciones. Sigue el contrato
 * uniforme de campos (ver text-short-field.component.ts). REGLA DE ORO: el valor
 * guardado/emitido es string[] de LABELS, nunca los values internos. Si ya se alcanzó
 * max_selected, las opciones NO marcadas quedan bloqueadas.
 */
@Component({
  selector: 'app-multiple-choice-field',
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
          <p class="df-field__value">{{ asLabels.length ? asLabels.join(', ') : '—' }}</p>
        }
        @default {
          <app-choice-search
              [options]="options"
              [selected]="asLabels"
              [multiple]="true"
              [placeholder]="field.schema.placeholder || ''"
              [disabled]="mode === 'config'"
              [invalid]="showErrors && !!error"
              [required]="field.required"
              [maxSelected]="maxSelected"
              [inputId]="inputId"
              [optionsSource]="optionsSource"
              [parentValue]="parentValue"
              (selectedChange)="onPick($event)" />
          @if (maxSelected != null) {
            <p class="df-field__desc">Máximo {{ maxSelected }} opciones</p>
          }
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styleUrls: ['../field-shared.css'],
})
export class MultipleChoiceFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  /** Valores del resto de campos de la sección: de aquí sale el padre de una cascada. */
  @Input() formValues: Record<string, FieldValue> | null = null;
  @Output() valueChange = new EventEmitter<FieldValue>();

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
    return `df-mc-${slug}-${this.uid}`;
  }

  /** Valor normalizado: solo strings (labels) del array actual. */
  get asLabels(): string[] {
    return Array.isArray(this.value)
      ? (this.value as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
  }

  get maxSelected(): number | null {
    return this.field.schema?.validation?.max_selected ?? null;
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  onPick(labels: string[]): void {
    // El buscador ya devuelve los LABELS en el orden de las opciones.
    this.value = labels.length ? labels : null;
    this.valueChange.emit(this.value);
  }
}

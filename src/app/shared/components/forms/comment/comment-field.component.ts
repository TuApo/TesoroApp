import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DynamicField, FieldMode } from '../field.model';

/**
 * Campo COMMENT — texto informativo fijo. NO produce valor (se omite del payload),
 * por eso no tiene valueChange y en 'readonly' no se pinta (el detalle lo salta).
 */
@Component({
  selector: 'app-comment-field',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mode !== 'readonly') {
      <div class="df-field">
        <div class="df-field__info">{{ field.schema.text || field.label }}</div>
      </div>
    }
  `,
  styleUrls: ['../field-shared.css'],
})
export class CommentFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
}

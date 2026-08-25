import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { DocumentRef, DynamicField, FieldMode, FieldValue } from '../field.model';
import { TextShortFieldComponent } from '../text-short/text-short-field.component';
import { TextLongFieldComponent } from '../text-long/text-long-field.component';
import { DateFieldComponent } from '../date/date-field.component';
import { TimeFieldComponent } from '../time/time-field.component';
import { NumberFieldComponent } from '../number/number-field.component';
import { CurrencyFieldComponent } from '../currency/currency-field.component';
import { RatingFieldComponent } from '../rating/rating-field.component';
import { SingleChoiceFieldComponent } from '../single-choice/single-choice-field.component';
import { DropdownFieldComponent } from '../dropdown/dropdown-field.component';
import { MultipleChoiceFieldComponent } from '../multiple-choice/multiple-choice-field.component';
import { PhotoFieldComponent } from '../photo/photo-field.component';
import { VideoFieldComponent } from '../video/video-field.component';
import { FileFieldComponent } from '../file/file-field.component';
import { SignatureFieldComponent } from '../signature/signature-field.component';
import { LocationFieldComponent } from '../location/location-field.component';
import { CommentFieldComponent } from '../comment/comment-field.component';
import { ScanFieldComponent } from '../scan/scan-field.component';

/**
 * MOTOR DE RENDER de campos: despacha por `field.type` REAL al componente del tipo
 * (nunca por heurísticas sobre el nombre de la clave — la trampa PHOTO del origen).
 * SECTION se renderiza aquí mismo (título + hijos recursivos, un nivel).
 *
 * uploadFn: los campos de media (PHOTO/VIDEO/FILE/SIGNATURE y los de escaneo
 * SCAN_DOC/SCAN_ID) suben PRIMERO el archivo y emiten la referencia; la página decide
 * el destino (ms-documents autenticado o endpoint público) inyectando esta función.
 */
@Component({
  selector: 'app-field-renderer',
  standalone: true,
  imports: [
    CommonModule,
    TextShortFieldComponent, TextLongFieldComponent, DateFieldComponent, TimeFieldComponent,
    NumberFieldComponent, CurrencyFieldComponent, RatingFieldComponent,
    SingleChoiceFieldComponent, DropdownFieldComponent, MultipleChoiceFieldComponent,
    PhotoFieldComponent, VideoFieldComponent, FileFieldComponent,
    SignatureFieldComponent, LocationFieldComponent, CommentFieldComponent,
    ScanFieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (field.type) {
      @case ('TEXT_SHORT') {
        <app-text-short-field [field]="field" [mode]="mode" [value]="value"
                              [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('TEXT_LONG') {
        <app-text-long-field [field]="field" [mode]="mode" [value]="value"
                             [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('DATE') {
        <app-date-field [field]="field" [mode]="mode" [value]="value"
                        [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('TIME') {
        <app-time-field [field]="field" [mode]="mode" [value]="value"
                        [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('NUMBER') {
        <app-number-field [field]="field" [mode]="mode" [value]="value"
                          [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('CURRENCY') {
        <app-currency-field [field]="field" [mode]="mode" [value]="value"
                            [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('RATING') {
        <app-rating-field [field]="field" [mode]="mode" [value]="value"
                          [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('SINGLE_CHOICE') {
        <app-single-choice-field [field]="field" [mode]="mode" [value]="value" [formValues]="formValues"
                                 [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('DROPDOWN') {
        <app-dropdown-field [field]="field" [mode]="mode" [value]="value" [formValues]="formValues"
                            [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('MULTIPLE_CHOICE') {
        <app-multiple-choice-field [field]="field" [mode]="mode" [value]="value" [formValues]="formValues"
                                   [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('PHOTO') {
        <app-photo-field [field]="field" [mode]="mode" [value]="value" [showErrors]="showErrors"
                         [uploadFn]="uploadFn" [downloadUrlFn]="downloadUrlFn"
                         (valueChange)="valueChange.emit($event)" />
      }
      @case ('VIDEO') {
        <app-video-field [field]="field" [mode]="mode" [value]="value" [showErrors]="showErrors"
                         [uploadFn]="uploadFn" [downloadUrlFn]="downloadUrlFn"
                         (valueChange)="valueChange.emit($event)" />
      }
      @case ('FILE') {
        <app-file-field [field]="field" [mode]="mode" [value]="value" [showErrors]="showErrors"
                        [uploadFn]="uploadFn" [downloadUrlFn]="downloadUrlFn"
                        (valueChange)="valueChange.emit($event)" />
      }
      @case ('SCAN_DOC') {
        <app-scan-field [field]="field" [mode]="mode" [value]="value" [showErrors]="showErrors"
                        [uploadFn]="uploadFn" [downloadUrlFn]="downloadUrlFn"
                        (valueChange)="valueChange.emit($event)" />
      }
      @case ('SCAN_ID') {
        <app-scan-field [field]="field" [mode]="mode" [value]="value" [showErrors]="showErrors"
                        [uploadFn]="uploadFn" [downloadUrlFn]="downloadUrlFn"
                        (valueChange)="valueChange.emit($event)" />
      }
      @case ('SIGNATURE') {
        <app-signature-field [field]="field" [mode]="mode" [value]="value" [showErrors]="showErrors"
                             [uploadFn]="uploadFn" [downloadUrlFn]="downloadUrlFn"
                             (valueChange)="valueChange.emit($event)" />
      }
      @case ('LOCATION') {
        <app-location-field [field]="field" [mode]="mode" [value]="value"
                            [showErrors]="showErrors" (valueChange)="valueChange.emit($event)" />
      }
      @case ('COMMENT') {
        <app-comment-field [field]="field" [mode]="mode" />
      }
      @case ('SECTION') {
        <fieldset class="df-group">
          @if (field.label) { <legend class="df-group__title">{{ field.label }}</legend> }
          <div class="df-group__grid">
            @for (child of field.children ?? []; track child.name ?? child.label) {
              <app-field-renderer
                  [class.df-span-2]="isFullWidth(child)"
                  [field]="child" [mode]="mode"
                  [value]="childValue(child)" [showErrors]="showErrors"
                  [formValues]="sectionValues ?? formValues"
                  [uploadFn]="uploadFn" [downloadUrlFn]="downloadUrlFn"
                  (valueChange)="childChange.emit({ field: child, value: $event })" />
            }
          </div>
        </fieldset>
      }
      @default {
        <div class="df-field__info">Tipo de campo no soportado: {{ field.type }}</div>
      }
    }
  `,
  styles: [`
    .df-group {
      border: 1px solid var(--slate-200, #e2e8f0);
      border-radius: var(--r-md, 14px);
      padding: 14px;
      margin: 0;
    }
    .df-group__title {
      font-weight: 700;
      color: var(--navy, #21263c);
      padding: 0 6px;
      font-size: 0.95rem;
    }
    .df-group__grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .df-span-2 { grid-column: span 2; }
    @media (max-width: 700px) {
      .df-group__grid { grid-template-columns: 1fr; }
      .df-span-2 { grid-column: span 1; }
    }
    .df-field__info {
      padding: 10px 12px;
      border-left: 3px solid var(--navy, #21263c);
      background: var(--slate-50, #f8fafc);
      border-radius: 0 var(--r-sm, 10px) var(--r-sm, 10px) 0;
      color: var(--slate-700, #334155);
      font-size: 0.9rem;
    }
  `],
})
export class FieldRendererComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  /** Valores de los hijos cuando field es SECTION ({ [childName]: valor }). */
  @Input() sectionValues: Record<string, FieldValue> | null = null;
  /**
   * Valores del resto de campos de la sección. Los campos de selección con ORIGEN en
   * cascada lo necesitan para saber qué eligió el usuario en el campo del que dependen.
   */
  @Input() formValues: Record<string, FieldValue> | null = null;
  @Input() uploadFn: ((file: File) => Observable<DocumentRef>) | null = null;
  @Input() downloadUrlFn: ((ref: DocumentRef) => string) | null = null;

  @Output() valueChange = new EventEmitter<FieldValue>();
  /** Cambios de los hijos de una SECTION (la página los coloca en el payload plano). */
  @Output() childChange = new EventEmitter<{ field: DynamicField; value: FieldValue }>();

  childValue(child: DynamicField): FieldValue {
    if (!this.sectionValues || !child.name) return null;
    return this.sectionValues[child.name] ?? null;
  }

  isFullWidth(f: DynamicField): boolean {
    return f.type === 'TEXT_LONG' || f.type === 'SECTION'
      || f.schema?.ui?.full_width === true
      || (f.type === 'MULTIPLE_CHOICE' && (f.schema?.options?.length ?? 0) > 6);
  }
}

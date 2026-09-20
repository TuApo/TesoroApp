import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormRendererComponent } from '../form-renderer/form-renderer.component';
import { FormFieldDef } from '../../models/office-forms.models';

/** Marco de teléfono para la "Vista Previa" en vivo del constructor. */
@Component({
  selector: 'app-phone-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormRendererComponent],
  template: `
  <div class="pp">
    <div class="pp__title">Vista Previa</div>
    <div class="pp__phone">
      <div class="pp__notch"></div>
      <div class="pp__statusbar"><span>9:41</span><span>5G</span></div>
      <div class="pp__screen">
        <div class="pp__header">
          <div class="pp__ftitle">{{ title || 'Nuevo Formulario' }}</div>
          @if (description) { <div class="pp__fdesc">{{ description }}</div> }
        </div>
        <div class="pp__body">
          <app-form-renderer [fields]="fields"></app-form-renderer>
        </div>
      </div>
    </div>
  </div>
  `,
  styles: [`
    .pp { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .pp__title { font-size: 13px; font-weight: 600; color: var(--text-2); }
    .pp__phone {
      width: 300px; max-width: 100%; background: #0f172a; border-radius: 38px; padding: 12px;
      box-shadow: 0 20px 45px rgba(15,23,42,.28); position: relative;
    }
    .pp__notch { position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      width: 120px; height: 22px; background: #0f172a; border-radius: 0 0 14px 14px; z-index: 2; }
    .pp__statusbar { display: flex; justify-content: space-between; color: #e2e8f0; font-size: 11px;
      padding: 4px 18px 8px; }
    .pp__screen { background: var(--surface); border-radius: 28px; height: 520px; overflow-y: auto;
      padding: 18px 16px 28px; }
    .pp__header { margin-bottom: 14px; }
    .pp__ftitle { font-size: 17px; font-weight: 700; color: var(--text); }
    .pp__fdesc { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .pp__body { }
  `],
})
export class PhonePreviewComponent {
  @Input() title = '';
  @Input() description = '';
  @Input() fields: FormFieldDef[] = [];
}

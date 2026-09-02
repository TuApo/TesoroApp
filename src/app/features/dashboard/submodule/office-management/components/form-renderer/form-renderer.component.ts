import {
  ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FieldValue, FormFieldDef } from '../../models/office-forms.models';

/**
 * Render dinámico de un formulario a partir de su esquema (FormFieldDef[]).
 * Reusado por: preview en vivo del constructor, llenado interno y página pública.
 * Tipos soportados en el slice: texto_corto, texto_largo, numero, seleccion_unica, foto, archivo.
 */
@Component({
  selector: 'app-form-renderer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatRadioModule, MatButtonModule, MatIconModule],
  template: `
  <form [formGroup]="form" class="ofr">
    @if (!fields.length) {
      <p class="ofr__empty">Sin campos.</p>
    }
    @for (f of fields; track key(f, $index); let i = $index) {
      <div class="ofr__field">
        <label class="ofr__label">
          {{ f.label || '(sin título)' }}
          @if (f.required) { <span class="ofr__req">*</span> }
        </label>
        @if (f.help_text) { <div class="ofr__help">{{ f.help_text }}</div> }

        @switch (f.field_type) {
          @case ('texto_largo') {
            <mat-form-field appearance="outline" class="ofr__ff">
              <textarea matInput rows="3" [formControlName]="key(f, i)" [placeholder]="f.placeholder || ''"></textarea>
            </mat-form-field>
          }
          @case ('numero') {
            <mat-form-field appearance="outline" class="ofr__ff">
              <input matInput type="number" [formControlName]="key(f, i)" [placeholder]="f.placeholder || ''">
            </mat-form-field>
          }
          @case ('seleccion_unica') {
            <mat-radio-group [formControlName]="key(f, i)" class="ofr__radio">
              @for (opt of options(f); track opt.value) {
                <mat-radio-button [value]="opt.value">{{ opt.label }}</mat-radio-button>
              }
              @if (!options(f).length) { <span class="ofr__hint">Sin opciones configuradas</span> }
            </mat-radio-group>
          }
          @case ('foto') {
            <div class="ofr__file">
              <input #photo type="file" accept="image/*" capture="environment" hidden
                     (change)="onFile(key(f, i), photo.files)">
              <button type="button" mat-stroked-button (click)="photo.click()">
                <mat-icon>photo_camera</mat-icon> Tomar / elegir foto
              </button>
              @if (fileName(key(f, i))) { <span class="ofr__filename">{{ fileName(key(f, i)) }}</span> }
            </div>
          }
          @case ('archivo') {
            <div class="ofr__file">
              <input #file type="file" hidden (change)="onFile(key(f, i), file.files)">
              <button type="button" mat-stroked-button (click)="file.click()">
                <mat-icon>upload_file</mat-icon> Subir archivo
              </button>
              @if (fileName(key(f, i))) { <span class="ofr__filename">{{ fileName(key(f, i)) }}</span> }
            </div>
          }
          @default {
            <mat-form-field appearance="outline" class="ofr__ff">
              <input matInput type="text" [formControlName]="key(f, i)" [placeholder]="f.placeholder || ''">
            </mat-form-field>
          }
        }
      </div>
    }
  </form>
  `,
  styles: [`
    .ofr { display: flex; flex-direction: column; gap: 14px; }
    .ofr__empty { color: #94a3b8; text-align: center; padding: 24px 0; }
    .ofr__field { display: flex; flex-direction: column; gap: 4px; }
    .ofr__label { font-weight: 600; font-size: 13px; color: #1e293b; }
    .ofr__req { color: #dc2626; }
    .ofr__help { font-size: 12px; color: #64748b; margin-bottom: 2px; }
    .ofr__ff { width: 100%; }
    .ofr__radio { display: flex; flex-direction: column; gap: 6px; }
    .ofr__file { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ofr__filename { font-size: 12px; color: #334155; }
    .ofr__hint { font-size: 12px; color: #94a3b8; }
  `],
})
export class FormRendererComponent implements OnChanges {
  @Input() fields: FormFieldDef[] = [];

  form = new FormGroup({});
  private files = new Map<string, File>();
  private fileNames = signal<Record<string, string>>({});

  ngOnChanges(_: SimpleChanges): void {
    this.buildForm();
  }

  key(f: FormFieldDef, i: number): string {
    return String(f.id ?? 'i' + i);
  }

  options(f: FormFieldDef) {
    return f.config_json?.options ?? [];
  }

  fileName(key: string): string | undefined {
    return this.fileNames()[key];
  }

  onFile(key: string, list: FileList | null): void {
    const file = list && list.length ? list[0] : null;
    if (file) {
      this.files.set(key, file);
      this.fileNames.update(m => ({ ...m, [key]: file.name }));
    } else {
      this.files.delete(key);
      this.fileNames.update(m => { const c = { ...m }; delete c[key]; return c; });
    }
  }

  /** Recolecta los valores actuales para enviar (escalar o archivo por campo). */
  getValues(): FieldValue[] {
    const out: FieldValue[] = [];
    this.fields.forEach((f, i) => {
      if (f.id == null) return; // en preview los campos aún no tienen id: no se envían
      const k = this.key(f, i);
      if (f.field_type === 'foto' || f.field_type === 'archivo') {
        out.push({ field_id: f.id, file: this.files.get(k) ?? null });
      } else {
        const raw = (this.form.get(k)?.value ?? null);
        out.push({ field_id: f.id, value: raw == null ? null : String(raw) });
      }
    });
    return out;
  }

  isValid(): boolean {
    return this.form.valid;
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  private buildForm(): void {
    const group: Record<string, FormControl> = {};
    (this.fields ?? []).forEach((f, i) => {
      if (f.field_type === 'foto' || f.field_type === 'archivo') return; // van por archivo, no por control
      const validators = f.required ? [Validators.required] : [];
      if (f.config_json?.max_length) validators.push(Validators.maxLength(f.config_json.max_length));
      if (typeof f.config_json?.min === 'number') validators.push(Validators.min(f.config_json.min));
      if (typeof f.config_json?.max === 'number') validators.push(Validators.max(f.config_json.max));
      group[this.key(f, i)] = new FormControl(null, validators);
    });
    this.form = new FormGroup(group);
    this.files.clear();
    this.fileNames.set({});
  }
}

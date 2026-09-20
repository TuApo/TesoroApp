import {  Component, Inject , ChangeDetectionStrategy } from '@angular/core';

import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { StandardFilterTable } from '../standard-filter-table/standard-filter-table';

export type FieldType =
  | 'text'
  | 'number'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'password'
  | 'date';

export interface FieldOption {
  label: string;
  value: any;
}

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string | null;
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string | RegExp;
  options?: FieldOption[];         // para 'select'
  multiple?: boolean;              // para 'select' múltiple (opcional)
  /**
   * Buscador dentro del panel del `select`. Sin declararlo aparece solo cuando la lista
   * pasa de `UMBRAL_BUSCADOR` opciones, que es donde el desplegable deja de servir para
   * encontrar algo. Ponlo en `false` para quitarlo de una lista larga, o en `true` para
   * forzarlo en una corta.
   */
  searchable?: boolean;
  disabled?: boolean;
  step?: number;                   // para number
  prefix?: string;
  suffix?: string;
  hint?: string;
  inputMode?: 'text' | 'search' | 'numeric' | 'decimal';
  parse?: (raw: any) => any;       // transformación antes de cerrar
}

export interface DynamicDialogData {
  title: string;
  submitText?: string;
  cancelText?: string;
  fields: FieldConfig[];
  value?: Record<string, any>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-dynamic-form-dialog',
  standalone: true,
  templateUrl: './dynamic-form-dialog.component.html',
  styleUrl: './dynamic-form-dialog.component.css',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule
]
} )
export class DynamicFormDialogComponent {
  /** A partir de aquí un desplegable deja de servir para encontrar algo. */
  private static readonly UMBRAL_BUSCADOR = 10;

  form!: FormGroup;

  /** control de visibilidad por campo password */
  showPwd: Record<string, boolean> = {};

  /** Lo escrito en el buscador de cada select. */
  busqueda: Record<string, string> = {};

  /**
   * Último filtrado por campo. El template llama a `opcionesVisibles` en cada ciclo de
   * detección y normalizar 200 etiquetas cada vez no hace falta: mientras el texto no
   * cambie se devuelve el mismo array —que además mantiene estable el `track` de `@for`.
   */
  private cacheFiltro: Record<string, { q: string; res: FieldOption[] }> = {};

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DynamicDialogData,
    private ref: MatDialogRef<DynamicFormDialogComponent, any>
  ) {
    this.buildForm();
  }

  private buildForm(): void {
    const group: Record<string, FormControl> = {};
    const initial = this.data.value ?? {};

    for (const f of this.data.fields) {
      const validators = [];
      if (f.required) validators.push(Validators.required);
      if (typeof f.min === 'number') validators.push(Validators.min(f.min));
      if (typeof f.max === 'number') validators.push(Validators.max(f.max));
      if (typeof f.minLength === 'number') validators.push(Validators.minLength(f.minLength));
      if (typeof f.maxLength === 'number') validators.push(Validators.maxLength(f.maxLength));
      if (f.pattern) validators.push(Validators.pattern(f.pattern as any));

      let initialValue = initial[f.name] ?? this.defaultValueFor(f);

      // Normalizar fechas iniciales a Date
      if (f.type === 'date' && typeof initialValue === 'string') {
        const d = new Date(initialValue);
        initialValue = isNaN(d.getTime()) ? null : d;
      }

      group[f.name] = new FormControl(
        { value: initialValue, disabled: !!f.disabled },
        { nonNullable: false, validators }
      );

      if (f.type === 'password') {
        this.showPwd[f.name] = false;
      }
    }
    this.form = new FormGroup(group);
  }

  private defaultValueFor(f: FieldConfig) {
    switch (f.type) {
      case 'checkbox': return false;
      case 'select': return f.multiple ? [] : null;
      default: return null;
    }
  }

  cancel(): void {
    this.ref.close(undefined);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = { ...this.form.getRawValue() };
    const out: Record<string, any> = {};

    // aplica parsers por campo y normaliza números/fechas
    for (const f of this.data.fields) {
      let v = raw[f.name];

      if (f.parse) {
        v = f.parse(v);
      } else {
        // number: aceptar coma o punto
        if (f.type === 'number') {
          if (typeof v === 'string') {
            const cleaned = v.trim().replace(',', '.');
            const n = cleaned === '' ? null : Number(cleaned);
            v = Number.isFinite(n as number) ? n : v;
          }
        }
        // date: devolver ISO si es Date (útil si quieres mandar al backend tal cual)
        if (f.type === 'date' && v instanceof Date) {
          // Si prefieres regresar Date y serializar en el contenedor, comenta la línea siguiente
          v = isNaN(v.getTime()) ? null : v.toISOString();
        }
      }

      out[f.name] = v;
    }

    this.ref.close(out);
  }

  // helpers de mensajes
  showError(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  errorMsg(name: string, f: FieldConfig): string {
    const c = this.form.get(name);
    if (!c || !c.errors) return '';
    if (c.errors['required']) return 'Este campo es obligatorio';
    if (c.errors['min']) return `El valor mínimo es ${f.min}`;
    if (c.errors['max']) return `El valor máximo es ${f.max}`;
    if (c.errors['minlength']) return `Mínimo ${f.minLength} caracteres`;
    if (c.errors['maxlength']) return `Máximo ${f.maxLength} caracteres`;
    if (c.errors['pattern']) return 'Formato inválido';
    return 'Valor inválido';
  }

  togglePwd(name: string) {
    this.showPwd[name] = !this.showPwd[name];
  }

  // ── Buscador de los select ────────────────────────────────────────────────

  tieneBuscador(f: FieldConfig): boolean {
    if (f.type !== 'select') return false;
    if (typeof f.searchable === 'boolean') return f.searchable;
    return (f.options?.length ?? 0) >= DynamicFormDialogComponent.UMBRAL_BUSCADOR;
  }

  buscar(f: FieldConfig, texto: string): void {
    this.busqueda[f.name] = texto;
  }

  /** El panel se cierra: se limpia para que al reabrirlo esté la lista completa. */
  panelCerrado(f: FieldConfig, abierto: boolean): void {
    if (!abierto) this.busqueda[f.name] = '';
  }

  /**
   * Las teclas se quedan en el input. Sin esto, mat-select las lee como navegación
   * —escribir "a" salta a la primera opción con "a" y el cursor se va del buscador—.
   * Escape y Tab sí pasan: son las dos formas de salir del panel.
   */
  teclaBuscador(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' && ev.key !== 'Tab') ev.stopPropagation();
  }

  /**
   * Opciones que se ven. Coincidencia por PALABRAS y en cualquier orden, sin acentos ni
   * puntuación: "petalia alejo" encuentra "SAN ALEJO (PETALIA S.A.S.)". Buscar la cadena
   * entera habría obligado a escribir la etiqueta tal cual, que es justo lo que se
   * quiere evitar.
   *
   * Lo ya seleccionado NUNCA se filtra: si desapareciera de la lista, mat-select se
   * quedaría sin la opción de su propio valor y el campo se vería vacío.
   */
  opcionesVisibles(f: FieldConfig): FieldOption[] {
    const todas = f.options ?? [];
    const q = this.normalizar(this.busqueda[f.name] ?? '');

    const cache = this.cacheFiltro[f.name];
    if (cache && cache.q === q) return cache.res;

    let res = todas;
    if (q) {
      const palabras = q.split(' ');
      const sel = this.form?.get(f.name)?.value;
      const elegidos = new Set(Array.isArray(sel) ? sel : sel != null ? [sel] : []);
      res = todas.filter(o => {
        if (elegidos.has(o.value)) return true;
        const heno = this.normalizar(o.label);
        return palabras.every(p => heno.includes(p));
      });
    }

    this.cacheFiltro[f.name] = { q, res };
    return res;
  }

  /** Mayúsculas, sin tildes y sin puntuación: compara lo que se lee, no cómo se escribió. */
  private normalizar(v: string): string {
    return (v ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

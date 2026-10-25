import { Directive, Injectable, inject, signal } from '@angular/core';
import { AbstractControl, FormGroup } from '@angular/forms';
import { MatFormField } from '@angular/material/form-field';
import type { LecturaCedula } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';

/**
 * Entrevista ↔ cédula: los campos vacíos se pintan en amarillo y los que no
 * cuadran con lo que la IA leyó en la cédula cargada, en rojo.
 *
 * Solo AVISA: no toca validadores ni bloquea el guardado. La lectura la hace
 * ms-hr (`/cedula-lectura`); aquí solo se compara.
 */

/** Un campo de la entrevista que no cuadra con la cédula. */
export interface DiferenciaCedula {
  control: string;
  etiqueta: string;
  /** Lo que dice la cédula, tal como se muestra. */
  cedula: string;
  /** Valor listo para `setValue` si se acepta el de la cédula. */
  valor: unknown;
}

type Campos = NonNullable<LecturaCedula['campos']>;

/** Mayúsculas sin tildes ni puntuación y con espacios simples. */
export function normalizarTexto(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toUpperCase().replace(/[^A-Z0-9+\- ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** YYYY-MM-DD de un Date, un Moment o un texto; '' si no hay fecha. */
export function aYmd(v: any): string {
  if (!v) return '';
  if (typeof v?.format === 'function' && typeof v?.isValid === 'function') {
    return v.isValid() ? v.format('YYYY-MM-DD') : '';
  }
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v).trim());
  return m ? m[1] : '';
}

export function estaVacio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function ddMmmYyyy(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function fechaLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Municipio: igual, o uno contenido en el otro ("BOGOTA" ↔ "BOGOTA D C"). */
function mismoMunicipio(a: string, b: string): boolean {
  const x = normalizarTexto(a), y = normalizarTexto(b);
  return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
}

/**
 * Campos que tienen valor en el formulario y no coinciden con la cédula.
 * Un campo vacío no se compara (ya sale en amarillo) ni uno que la cédula no
 * deja leer (null).
 */
export function compararConCedula(form: FormGroup, campos: Campos): DiferenciaCedula[] {
  const out: DiferenciaCedula[] = [];
  const val = (c: string) => form.get(c)?.value;
  const dif = (control: string, etiqueta: string, cedula: string, valor: unknown = cedula) =>
    out.push({ control, etiqueta, cedula, valor });

  // Número: solo dígitos de ambos lados.
  const num = String(campos.numero_documento ?? '').replace(/\D/g, '');
  const numForm = String(val('numero_documento') ?? '').replace(/\D/g, '');
  if (num && numForm && num !== numForm) dif('numero_documento', 'Número de documento', num);

  // Apellidos y nombres: si el nombre completo coincide, no se mira cómo se
  // repartió (la amarilla trae "PUSHAINA MONTIEL" en una línea y un apellido
  // compuesto se puede partir de dos maneras).
  const pares: ReadonlyArray<readonly [string, string, string, string, string]> = [
    ['apellidos', 'primer_apellido', 'segundo_apellido', 'Primer apellido', 'Segundo apellido'],
    ['nombres', 'primer_nombre', 'segundo_nombre', 'Primer nombre', 'Segundo nombre'],
  ];
  for (const [junto, c1, c2, e1, e2] of pares) {
    const p1 = (campos as any)[c1] as string | null | undefined;
    if (!p1) continue;
    const p2 = ((campos as any)[c2] as string | null | undefined) ?? '';
    const completoCedula = normalizarTexto((campos as any)[junto] || `${p1} ${p2}`);
    const f1 = val(c1), f2 = val(c2);
    if (normalizarTexto(`${f1 ?? ''} ${f2 ?? ''}`) === completoCedula) continue;
    if (!estaVacio(f1) && normalizarTexto(f1) !== normalizarTexto(p1)) dif(c1, e1, p1);
    if (normalizarTexto(f2) !== normalizarTexto(p2)) {
      // La cédula no trae segundo: sobra el del formulario. Vacío en los dos: nada.
      if (!estaVacio(f2)) dif(c2, e2, p2 || '(no tiene)', p2);
    }
  }

  const fechas: ReadonlyArray<readonly [keyof Campos, string, string]> = [
    ['fecha_nacimiento', 'fecha_nacimiento', 'Fecha de nacimiento'],
    ['fecha_expedicion', 'fecha_expedicion', 'Fecha de expedición'],
  ];
  for (const [k, control, etiqueta] of fechas) {
    const c = campos[k];
    const f = aYmd(val(control));
    if (c && f && c !== f) dif(control, etiqueta, ddMmmYyyy(c), fechaLocal(c));
  }

  const lugares: ReadonlyArray<readonly [keyof Campos, keyof Campos, string, string]> = [
    ['municipio_nacimiento', 'departamento_nacimiento', 'mpio_nacimiento', 'Lugar de nacimiento'],
    ['municipio_expedicion', 'departamento_expedicion', 'mpio_expedicion', 'Municipio de expedición'],
  ];
  for (const [k, depto, control, etiqueta] of lugares) {
    const c = campos[k];
    const f = val(control);
    if (c && !estaVacio(f) && !mismoMunicipio(c, f)) {
      dif(control, etiqueta, campos[depto] ? `${c} (${campos[depto]})` : c, c);
    }
  }

  const sexo = campos.sexo;
  const sexoForm = normalizarTexto(val('sexo')).charAt(0);
  if (sexo && sexoForm && sexo !== sexoForm) {
    dif('sexo', 'Sexo', sexo === 'F' ? 'Femenino' : 'Masculino', sexo);
  }
  return out;
}

/**
 * Lo que la ficha necesita saber para pintar: el formulario de la entrevista y
 * qué controles no cuadran. Lo provee `FormEntrevistaComponent`; fuera de la
 * entrevista no existe y la directiva no hace nada.
 */
@Injectable()
export class CotejoCedulaEstado {
  form: FormGroup | null = null;
  readonly diferencias = signal<Readonly<Record<string, DiferenciaCedula>>>({});
  /**
   * Se incrementa cuando el formulario se rellena por código: `patchValue` con
   * `emitEvent: false` no avisa, y la ficha es OnPush.
   */
  readonly version = signal(0);

  refrescar(): void { this.version.update((v) => v + 1); }
}

/**
 * Pinta cada `mat-form-field` de la entrevista: amarillo si su control está
 * vacío, rojo si no cuadra con la cédula. Se aplica a TODOS los campos del
 * componente que la importa, sin marcar uno por uno.
 */
@Directive({
  selector: 'mat-form-field',
  standalone: true,
  host: {
    '[class.fe-vacio]': 'vacio()',
    '[class.fe-difiere]': 'diferencia() !== null',
    '[attr.title]': 'titulo()',
  },
})
export class CampoCotejoCedulaDirective {
  private readonly estado = inject(CotejoCedulaEstado, { optional: true });
  private readonly campo = inject(MatFormField);

  private control(): { ctrl: AbstractControl; nombre: string | null } | null {
    const nc: any = (this.campo as any)._control?.ngControl;
    const ctrl: AbstractControl | null = nc?.control ?? null;
    if (!ctrl) return null;
    const nombre = nc?.name != null ? String(nc.name) : null;
    return { ctrl, nombre };
  }

  vacio(): boolean {
    if (!this.estado) return false;
    this.estado.version();
    const c = this.control();
    if (!c || c.ctrl.disabled) return false;
    return estaVacio(c.ctrl.value) && this.diferencia() === null;
  }

  diferencia(): DiferenciaCedula | null {
    if (!this.estado) return null;
    const c = this.control();
    if (!c?.nombre) return null;
    const d = this.estado.diferencias()[c.nombre];
    // El mismo nombre puede repetirse dentro de un FormArray (hijos, experiencias):
    // solo cuenta el control de primer nivel del formulario de la entrevista.
    if (!d || this.estado.form?.get(c.nombre) !== c.ctrl) return null;
    return d;
  }

  titulo(): string | null {
    const d = this.diferencia();
    return d ? `No coincide con la cédula. En la cédula: ${d.cedula}` : null;
  }
}

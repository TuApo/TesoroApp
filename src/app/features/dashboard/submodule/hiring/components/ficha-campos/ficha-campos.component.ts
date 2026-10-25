import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, Output, signal } from '@angular/core';
import {
  ControlContainer,
  AbstractControl,
  FormArray,
  FormGroup,
  FormGroupDirective,
  ReactiveFormsModule,
} from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { MomentDateAdapter, MatMomentDateModule } from '@angular/material-moment-adapter';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { Observable, of } from 'rxjs';

import { SharedModule } from '@/app/shared/shared.module';
import { CatalogValue } from '../../../users/services/gestion-parametrizacion/gestion-parametrizacion.service';
import { SaludAdres, detalleExcepcion } from '../../shared/salud-adres.util';
import { CampoCotejoCedulaDirective } from '../form-entrevista/cotejo-cedula';

/**
 * Las secciones en las que se agrupan los datos de la persona.
 *
 * Reproducen el SECCIONAMIENTO del formulario de la vacante (form-vacancies-v2:
 * pasos `pareja`, `padres`, `hijos`, referencias, `emergencia`, `tallas`) y solo
 * traen lo que es dato de CONTRATACIÓN. Lo del paso "Su hogar" —tenencia, tipo
 * de vivienda, servicios, hermanos— y la evaluación ocupacional quedan fuera a
 * propósito: son perfil socioeconómico, no hacen falta para contratar.
 */
export type SeccionFicha =
  | 'identificacion' | 'personales' | 'contacto'
  | 'pareja' | 'padres' | 'hijos' | 'referencias' | 'emergencia' | 'dotacion';

/**
 * Las secciones que la ENTREVISTA pinta de entrada.
 *
 * Es la hoja de entrevista, no la ficha completa: pareja, padres, contacto de
 * emergencia y tallas se piden en el formulario de la vacante y no se preguntan
 * aquí. Sus campos siguen existiendo en el formulario (se cargan y se guardan
 * igual) y sus secciones siguen en esta plantilla: aparecen cuando alguien las
 * pide con el lápiz de la ficha del pipeline — ver `SECCIONES_FICHA_EXTRA`.
 */
export const SECCIONES_FICHA: ReadonlyArray<{ id: SeccionFicha; label: string; icon: string }> = [
  { id: 'identificacion', label: 'Identificación', icon: 'badge' },
  { id: 'personales', label: 'Datos personales', icon: 'person' },
  { id: 'contacto', label: 'Contacto', icon: 'call' },
  { id: 'hijos', label: 'Familia e hijos', icon: 'child_care' },
  { id: 'referencias', label: 'Referencias', icon: 'groups' },
];

/**
 * Las que NO se pintan de entrada, pero se pueden abrir a demanda.
 *
 * Se dejan fuera de la vista por defecto —la entrevista solo muestra lo que se
 * pregunta— sin quitarle a nadie la única pantalla donde estos datos se pueden
 * corregir.
 */
export const SECCIONES_FICHA_EXTRA: ReadonlyArray<SeccionFicha> = [
  'pareja', 'padres', 'emergencia', 'dotacion',
];

/** El id del ancla de una sección. Lo comparten quien pinta y quien navega. */
export function anclaSeccion(id: string): string {
  return `ficha-sec-${id}`;
}

const FORMATO_FECHA = {
  parse: { dateInput: 'DD/MM/YYYY' },
  display: {
    dateInput: 'DD/MM/YYYY',
    monthYearLabel: 'MMMM YYYY',
    dateA11yLabel: 'LL',
    monthYearA11yLabel: 'MMMM YYYY',
  },
};

/**
 * Los campos de la persona, EN LÍNEA dentro del panel de Entrevista.
 *
 * Trabaja sobre el FormGroup REAL de `form-entrevista`, no sobre una copia: el
 * guardado, los validadores y los catálogos siguen siendo los de siempre y no
 * hay dos verdades que sincronizar. Lo que se escribe aquí se guarda con el
 * "Enviar" del formulario, como el resto de la entrevista.
 */
@Component({
  selector: 'app-ficha-campos',
  standalone: true,
  imports: [
    // Amarillo/rojo de la entrevista; sin CotejoCedulaEstado (fuera de ella) no pinta nada.
    CampoCotejoCedulaDirective,
    SharedModule, ReactiveFormsModule,
    MatDatepickerModule, MatMomentDateModule, MatIconModule,
  ],
  templateUrl: './ficha-campos.component.html',
  styleUrls: ['./ficha-campos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  /**
   * El formulario es el del PADRE: este componente se pinta dentro del
   * `<form [formGroup]="formVacante">` del panel de Entrevista.
   *
   * Sin esto habría que abrir aquí un `<form [formGroup]>` propio, y eso son DOS
   * `FormGroupDirective` sobre los mismos controles: se pisan el registro de los
   * value accessors y los campos salen EN BLANCO aunque el formulario tenga los
   * datos. Es exactamente lo que pasaba.
   */
  viewProviders: [{ provide: ControlContainer, useExisting: FormGroupDirective }],
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'es-CO' },
    { provide: DateAdapter, useClass: MomentDateAdapter, deps: [MAT_DATE_LOCALE] },
    { provide: MAT_DATE_FORMATS, useValue: FORMATO_FECHA },
  ],
})
export class FichaCamposComponent {
  /**
   * El formulario real, tomado del contenedor del padre.
   *
   * No es un `@Input`: si se pasara por binding habría dos referencias que
   * mantener iguales, y basta con que una se quede atrás para que la sección
   * escriba en un formulario y el guardado lea otro.
   */
  private readonly contenedor = inject(ControlContainer);

  get form(): FormGroup {
    return this.contenedor.control as FormGroup;
  }

  @Input() ciudades: readonly string[] = [];

  /**
   * Afiliación a salud según ADRES (pedido #6): chip "Régimen especial/excepción" o el
   * aviso suave de "ADRES sin registro". Lo resuelve `form-entrevista` con el mismo dato
   * del aviso ámbar del pipeline (`/Robots/resultados-antecedentes`); `null` = nada.
   */
  @Input() saludAdres: SaludAdres | null = null;
  readonly detalleExcepcion = detalleExcepcion;
  /** Qué secciones se pintan. Por defecto, las de la hoja de entrevista. */
  @Input() secciones: readonly SeccionFicha[] = SECCIONES_FICHA.map((s) => s.id);

  /**
   * Nombre y edad de cada hijo, ya resueltos por el formulario.
   *
   * Llegan calculados y no se leen del FormArray aquí a propósito: este
   * componente es OnPush y los hijos entran por `patchValue` sin emitir, así
   * que sin un binding que cambie la lista se quedaría con la del candidato
   * anterior.
   */
  @Input() hijos: ReadonlyArray<{ nombre: string; edad: string }> = [];

  @Input() tipoDoc$: Observable<CatalogValue[]> = of([]);
  @Input() conQuienVive$: Observable<CatalogValue[]> = of([]);
  @Input() estadoCivil$: Observable<CatalogValue[]> = of([]);
  @Input() parentescos$: Observable<CatalogValue[]> = of([]);
  @Input() ocupaciones$: Observable<CatalogValue[]> = of([]);
  /** Catálogos del bloque de hijos (los del formulario de la vacante). */
  @Input() sexo$: Observable<CatalogValue[]> = of([]);
  @Input() tipoDocHijo$: Observable<CatalogValue[]> = of([]);
  @Input() custodiaHijo$: Observable<CatalogValue[]> = of([]);

  /**
   * Agregar y quitar hijos los resuelve el formulario dueño del FormArray: es
   * él quien arma el grupo de cada hijo y lleva el conteo de "Cuántos hijos".
   */
  @Output() agregarHijo = new EventEmitter<void>();
  @Output() quitarHijo = new EventEmitter<number>();

  get hijosFA(): FormArray | null {
    return (this.form?.get('hijos') as FormArray) ?? null;
  }

  /**
   * Tarjetas de hijo desplegadas. Cerradas por defecto: con varios hijos, los
   * diecisiete campos de cada uno tapaban el resto de la ficha. Se guarda el
   * control (no el índice) para que quitar un hijo no abra el siguiente.
   */
  private readonly hijosAbiertos = new WeakSet<AbstractControl>();

  hijoAbierto(g: AbstractControl): boolean {
    return this.hijosAbiertos.has(g);
  }

  alternarHijo(g: AbstractControl): void {
    if (this.hijosAbiertos.has(g)) this.hijosAbiertos.delete(g);
    else this.hijosAbiertos.add(g);
  }

  /** El hijo recién agregado llega abierto: es para llenarlo. */
  onAgregarHijo(): void {
    this.agregarHijo.emit();
    const fa = this.hijosFA;
    if (fa?.length) this.hijosAbiertos.add(fa.at(fa.length - 1));
  }

  /** Lo que se ve con la tarjeta cerrada: documento, o lo que le falta para guardarse. */
  resumenHijo(i: number): string {
    const h = this.hijosFA?.at(i)?.value ?? {};
    const doc = String(h.numero_de_documento ?? '').trim();
    if (!doc) return 'sin documento: no se guarda';
    if (!h.fecha_nac) return 'sin fecha de nacimiento: no se guarda';
    return `${h.tipo_documento || 'Doc.'} ${doc}`;
  }

  /** "Juan Pérez" o "Hijo 2" mientras no tenga nombre. */
  tituloHijo(i: number): string {
    const h = this.hijosFA?.at(i)?.value ?? {};
    const n = [h.primer_nombre, h.segundo_nombre, h.primer_apellido, h.segundo_apellido]
      .map((x: any) => String(x ?? '').trim()).filter(Boolean).join(' ');
    return n || `Hijo ${i + 1}`;
  }

  /** Años cumplidos del hijo de la fila, o null sin fecha válida. */
  private aniosHijo(i: number): number | null {
    const f = this.aFecha(this.hijosFA?.at(i)?.get('fecha_nac')?.value);
    if (!f) return null;
    const hoy = new Date();
    let a = hoy.getFullYear() - f.getFullYear();
    if (hoy.getMonth() < f.getMonth() || (hoy.getMonth() === f.getMonth() && hoy.getDate() < f.getDate())) a--;
    return a < 0 ? null : a;
  }

  /** La edad como se dice en la entrevista: meses por debajo del año. */
  edadHijo(i: number): string {
    const f = this.aFecha(this.hijosFA?.at(i)?.get('fecha_nac')?.value);
    if (!f) return 'sin fecha de nacimiento';
    const hoy = new Date();
    let meses = (hoy.getFullYear() - f.getFullYear()) * 12 + (hoy.getMonth() - f.getMonth());
    if (hoy.getDate() < f.getDate()) meses--;
    if (meses < 0) return 'sin fecha de nacimiento';
    if (meses === 0) return 'menos de un mes';
    if (meses < 12) return meses === 1 ? '1 mes' : `${meses} meses`;
    const anios = Math.floor(meses / 12);
    return anios === 1 ? '1 año' : `${anios} años`;
  }

  /**
   * Nivel educativo del hijo (ficha técnica, req. 13). Distinto de "Curso" (TERCERO, 5B…).
   * Sin tildes: el guardado las quita (`uppercaseDeepExcept`) y el valor no volvería a casar.
   */
  readonly nivelesEducativosHijo = ['PREESCOLAR', 'PRIMARIA', 'SECUNDARIA', 'TECNICO O TECNOLOGO', 'UNIVERSITARIO', 'NINGUNO'];

  /**
   * RF-047, igual que en el formulario de la vacante: la ocupación se recorta por
   * la edad (`edad_minima` / `edad_maxima` del catálogo). Sin fecha, todas.
   */
  ocupacionesHijo(ops: CatalogValue[] | null, i: number): CatalogValue[] {
    const base = ops ?? [];
    const edad = this.aniosHijo(i);
    if (edad === null) return base;
    const num = (x: any) => (x === null || x === undefined || x === '' ? null : Number(x));
    return base.filter((o: any) => {
      const min = num(o['edad_minima']), max = num(o['edad_maxima']);
      if (min !== null && Number.isFinite(min) && edad < min) return false;
      if (max !== null && Number.isFinite(max) && edad > max) return false;
      return true;
    });
  }

  /** Date, Moment o 'YYYY-MM-DD' → Date (o null). */
  private aFecha(v: any): Date | null {
    if (!v) return null;
    const d = v instanceof Date ? v : typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  /** Municipios filtrados por lo que se va escribiendo. */
  readonly ciudadesExpedicion = signal<readonly string[]>([]);
  readonly ciudadesNacimiento = signal<readonly string[]>([]);

  ngOnChanges(): void {
    this.filtrarCiudades('mpio_expedicion');
    this.filtrarCiudades('mpio_nacimiento');
  }

  tiene(seccion: SeccionFicha): boolean {
    return this.secciones.includes(seccion);
  }

  ancla(seccion: string): string {
    return anclaSeccion(seccion);
  }

  filtrarCiudades(campo: 'mpio_expedicion' | 'mpio_nacimiento'): void {
    const q = String(this.form?.get(campo)?.value ?? '');
    const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const t = norm(q);
    const lista = t
      ? this.ciudades.filter((c) => norm(c).includes(t)).slice(0, 50)
      : this.ciudades.slice(0, 50);
    (campo === 'mpio_expedicion' ? this.ciudadesExpedicion : this.ciudadesNacimiento).set(lista);
  }
}

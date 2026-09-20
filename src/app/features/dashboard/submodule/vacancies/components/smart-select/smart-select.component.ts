import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  Optional,
  Output,
  Self,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormsModule, NgControl } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  coincidenTodas,
  normalizarBusqueda,
  tokensDeConsulta,
} from '../../../hiring/shared/busqueda-vacantes.util';

/** Trozo de etiqueta, marcando si casa con lo que se está buscando. */
interface Fragmento {
  t: string;
  m: boolean;
}

/**
 * Desplegable con búsqueda por palabras sueltas.
 *
 * QUÉ PROBLEMA RESUELVE
 * ---------------------
 * Un `mat-select` normal solo salta por la primera letra, y sus listas aquí no
 * son cortas: 273 centros de costo, 74 cargos, más de mil municipios. Y el dato
 * de esta plataforma se repite: hay tres ADMINISTRACIÓN CENTRAL, dos SAGARO,
 * fincas homónimas en empresas distintas que son sitios distintos.
 *
 * Así que la búsqueda parte la consulta en palabras y exige que estén TODAS, en
 * cualquier orden y en cualquiera de los datos de la opción —es lo que la gente
 * ya hace sin pensarlo, teclear tres pedazos de lo que recuerda—, y cada fila
 * muestra DEBAJO del nombre el dato que la distingue de su homónima, con los
 * fragmentos que casaron resaltados. Se ve por qué salió cada resultado.
 *
 * La lógica de tokens no se reimplementa: es la misma
 * `busqueda-vacantes.util.ts` que ya usa el selector de Remisión, para que las
 * dos búsquedas de vacantes no puedan divergir.
 */
@Component({
  selector: 'app-smart-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatIconModule, MatSelectModule, MatTooltipModule],
  templateUrl: './smart-select.component.html',
  styleUrl: './smart-select.component.css',
})
export class SmartSelectComponent implements ControlValueAccessor {
  @Input() label = '';
  @Input() opciones: readonly any[] = [];
  @Input() multiple = false;
  @Input() requerido = false;
  @Input() icono?: string;
  /** Texto bajo el campo cuando no hay error. */
  @Input() ayuda?: string;
  /** Mensaje al no haber ninguna opción que ofrecer. */
  @Input() vacio = 'Sin opciones';
  @Input() placeholderBuscar = 'Buscar…';
  /**
   * Compacto: el espacio del mensaje de ayuda solo se ocupa cuando hay mensaje.
   *
   * Por defecto va en `false` —espacio siempre reservado— para que TODOS los
   * campos de un formulario midan lo mismo y las filas de la rejilla queden
   * alineadas. Mezclar los dos modos era una de las cosas que hacía que el
   * formulario se viera desencajado. La barra de filtros sí lo activa: ahí
   * mandan la altura y no hay rejilla que cuadrar.
   */
  @Input() compacto = false;
  /**
   * A partir de cuántas opciones aparece el buscador. Con cuatro opciones a la
   * vista, un campo de búsqueda estorba más de lo que ayuda.
   */
  @Input() umbralBuscador = 7;

  /** Cómo sacar de la opción el valor que se guarda. */
  @Input() valor: (o: any) => any = (o) => o;
  /** Cómo sacar el texto principal de la fila. */
  @Input() etiqueta: (o: any) => string = (o) => String(o ?? '');
  /** Segunda línea: el dato que distingue esta opción de su homónima. */
  @Input() detalle?: (o: any) => string | null | undefined;
  /**
   * Texto sobre el que se busca. Por defecto, etiqueta + detalle; se puede
   * ampliar para buscar por datos que no se pintan (un código, un NIT).
   */
  @Input() buscarEn?: (o: any) => string;

  @Output() cambio = new EventEmitter<any>();

  consulta = '';
  seleccion: any = null;
  deshabilitado = false;

  private alCambiar: (v: any) => void = () => { };
  private alTocar: () => void = () => { };
  private readonly cdr = inject(ChangeDetectorRef);

  constructor(@Self() @Optional() public ngControl: NgControl | null) {
    // Se registra a mano en vez de por NG_VALUE_ACCESSOR: así el componente
    // puede LEER el control (errores, touched) y pintar el mensaje él mismo, en
    // vez de obligar a repetir el `mat-error` en cada sitio donde se usa.
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  // ── ControlValueAccessor ────────────────────────────────────────────────
  // `markForCheck` porque el componente es OnPush y estas dos llamadas vienen de
  // FUERA de su plantilla (un `patchValue` del formulario, un `disable()`): sin
  // ellas el campo seguía mostrando el valor anterior.
  writeValue(v: any): void {
    this.seleccion = v;
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (v: any) => void): void { this.alCambiar = fn; }
  registerOnTouched(fn: () => void): void { this.alTocar = fn; }
  setDisabledState(dis: boolean): void {
    this.deshabilitado = dis;
    this.cdr.markForCheck();
  }

  onSelection(v: any): void {
    this.seleccion = v;
    this.alCambiar(v);
    this.cambio.emit(v);
  }

  onTouched(): void { this.alTocar(); }

  /** El buscador arranca limpio cada vez que se abre el panel. */
  onOpen(abierto: boolean): void {
    if (abierto) this.consulta = '';
    else this.alTocar();
  }

  // ── Estado visible ──────────────────────────────────────────────────────
  get mostrarBuscador(): boolean {
    return (this.opciones?.length ?? 0) >= this.umbralBuscador;
  }

  get invalido(): boolean {
    const c = this.ngControl?.control;
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  /** Mensaje de error propio; sin `errors` reconocidos no se pinta nada. */
  get mensajeError(): string | null {
    const errs = this.ngControl?.control?.errors;
    if (!errs) return null;
    if (errs['required']) return `${this.label || 'Este campo'} es obligatorio.`;
    return 'Revisa este campo.';
  }

  /**
   * Opciones que se pintan.
   *
   * Lo SELECCIONADO se incluye siempre, case o no con la búsqueda: `mat-select`
   * saca el texto del campo de la opción elegida, así que al filtrarla fuera el
   * campo se quedaba en blanco y parecía que se hubiera borrado el dato.
   */
  get filtradas(): any[] {
    const lista = this.opciones ?? [];
    const tokens = tokensDeConsulta(this.consulta);
    if (!tokens.length) return [...lista];

    const elegidos = this.valoresElegidos();
    return lista.filter(
      (o) => elegidos.has(this.valor(o)) || coincidenTodas(this.textoDe(o), tokens),
    );
  }

  private valoresElegidos(): Set<any> {
    const v = this.seleccion;
    if (v === null || v === undefined || v === '') return new Set();
    return new Set(Array.isArray(v) ? v : [v]);
  }

  private textoDe(o: any): string {
    if (this.buscarEn) return normalizarBusqueda(this.buscarEn(o));
    const det = this.detalle ? this.detalle(o) : '';
    return normalizarBusqueda(`${this.etiqueta(o)} ${det ?? ''}`);
  }

  /**
   * Parte la etiqueta en fragmentos, marcando los que casan con la búsqueda.
   *
   * Se resalta sobre el texto ORIGINAL (con sus tildes y mayúsculas) usando
   * posiciones calculadas sobre el texto normalizado: buscar "ipanema" tiene que
   * iluminar "IPANEMÁ" tal y como está escrito, no una versión sin acentos.
   */
  resaltar(texto: string): Fragmento[] {
    const original = String(texto ?? '');
    const tokens = tokensDeConsulta(this.consulta);
    if (!tokens.length || !original) return [{ t: original, m: false }];

    const plano = normalizarBusqueda(original);
    // La normalización quita diacríticos pero conserva un carácter por letra,
    // así que los índices siguen valiendo sobre el original.
    if (plano.length !== original.length) return [{ t: original, m: false }];

    const rangos: Array<[number, number]> = [];
    for (const t of tokens) {
      let desde = plano.indexOf(t);
      while (desde !== -1) {
        rangos.push([desde, desde + t.length]);
        desde = plano.indexOf(t, desde + t.length);
      }
    }
    if (!rangos.length) return [{ t: original, m: false }];

    rangos.sort((a, b) => a[0] - b[0]);
    const unidos: Array<[number, number]> = [];
    for (const r of rangos) {
      const ult = unidos[unidos.length - 1];
      if (ult && r[0] <= ult[1]) ult[1] = Math.max(ult[1], r[1]);
      else unidos.push([r[0], r[1]]);
    }

    const out: Fragmento[] = [];
    let pos = 0;
    for (const [a, b] of unidos) {
      if (a > pos) out.push({ t: original.slice(pos, a), m: false });
      out.push({ t: original.slice(a, b), m: true });
      pos = b;
    }
    if (pos < original.length) out.push({ t: original.slice(pos), m: false });
    return out;
  }

  /**
   * Lo elegido, en texto. Va al `title` del campo: el valor se recorta a una
   * línea para no descuadrar la rejilla, así que el nombre completo tiene que
   * seguir estando a un puntero de distancia.
   */
  get textoSeleccion(): string {
    const v = this.seleccion;
    if (v === null || v === undefined || v === '') return '';
    const elegidos = Array.isArray(v) ? v : [v];
    return elegidos
      .map((val) => {
        const o = (this.opciones ?? []).find((x) => this.valor(x) === val);
        return o ? this.etiqueta(o) : String(val);
      })
      .join(', ');
  }

  /** `track` estable de la lista. */
  claveDe = (_: number, o: any): any => this.valor(o);

  detalleDe(o: any): string {
    return this.detalle ? String(this.detalle(o) ?? '') : '';
  }
}

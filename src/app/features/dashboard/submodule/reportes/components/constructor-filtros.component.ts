import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { CampoCatalogo, FilterNode, OperadorMeta } from '../models/reportes.models';
import { ReportesApiService } from '../services/reportes-api.service';

/**
 * Constructor visual de filtros (§11).
 *
 * Es recursivo: un GRUPO contiene condiciones y otros grupos, unidos por AND u OR.
 * Eso es lo que permite expresar sin escribir nada cosas como
 * {@code (empresa = X O empresa = Y) Y estado = activo}, que es literalmente el
 * ejemplo del brief.
 *
 * El componente NO construye SQL ni sabe qué es un LIKE: elige un campo del
 * catálogo, un operador de la lista que ese tipo admite, y unos valores. La
 * traducción ocurre en el servidor.
 */
@Component({
  selector: 'app-constructor-filtros',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatMenuModule,
    MatTooltipModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatNativeDateModule, MatChipsModule, MatAutocompleteModule],
  template: `
  <div class="grupo" [class.grupo--raiz]="esRaiz()">
    <div class="grupo__cab">
      <div class="union" role="group" [attr.aria-label]="'Unir condiciones con'">
        <button type="button" [class.union--on]="union() === 'AND'" (click)="cambiarUnion('AND')">Y</button>
        <button type="button" [class.union--on]="union() === 'OR'" (click)="cambiarUnion('OR')">O</button>
      </div>
      <span class="grupo__desc">
        {{ union() === 'AND' ? 'Se deben cumplir todas' : 'Basta con que se cumpla una' }}
      </span>
      <span class="grupo__sp"></span>
      <button mat-button type="button" [matMenuTriggerFor]="menuCampos" class="btn-mini">
        <mat-icon>add</mat-icon> Condición
      </button>
      <button mat-button type="button" class="btn-mini" (click)="agregarGrupo()"
              matTooltip="Un grupo permite mezclar Y con O">
        <mat-icon>data_array</mat-icon> Grupo
      </button>
      @if (!esRaiz()) {
        <button mat-icon-button type="button" class="btn-mini" (click)="eliminar.emit()"
                matTooltip="Quitar este grupo">
          <mat-icon>delete_outline</mat-icon>
        </button>
      }

      <mat-menu #menuCampos="matMenu" class="menu-campos">
        @for (c of camposFiltrables(); track c.clave) {
          <button mat-menu-item type="button" (click)="agregarCondicion(c)">
            <mat-icon>{{ iconoTipo(c) }}</mat-icon>
            <span>{{ c.nombre }}</span>
          </button>
        }
        @if (!camposFiltrables().length) {
          <button mat-menu-item disabled>Primero agrega tablas al reporte</button>
        }
      </mat-menu>
    </div>

    <div class="grupo__hijos">
      @for (hijo of hijos(); track $index; let i = $index) {
        @if (hijo.tipo === 'GRUPO') {
          <app-constructor-filtros
            [nodo]="hijo" [campos]="campos()" [operadores]="operadores()" [esRaiz]="false"
            (cambio)="reemplazarHijo(i, $event)" (eliminar)="quitarHijo(i)">
          </app-constructor-filtros>
        } @else {
          <div class="cond">
            <span class="cond__campo" [matTooltip]="descripcionCampo(hijo.campo)">
              <mat-icon>{{ iconoDeClave(hijo.campo) }}</mat-icon>
              {{ nombreCampo(hijo.campo) }}
            </span>

            <mat-form-field appearance="outline" class="cond__op" subscriptSizing="dynamic">
              <mat-select [value]="hijo.operador" (valueChange)="cambiarOperador(i, $event)">
                @for (op of operadoresDe(hijo.campo); track op.nombre) {
                  <mat-option [value]="op.nombre">{{ op.etiqueta }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            @if (aridadDe(hijo.operador) !== 0) {
              @switch (tipoEntrada(hijo)) {
                @case ('fecha') {
                  <mat-form-field appearance="outline" class="cond__val" subscriptSizing="dynamic">
                    <input matInput [matDatepicker]="dp1" [value]="fecha(hijo, 0)"
                           (dateChange)="fijarValor(i, 0, isoDe($event.value))" placeholder="Fecha">
                    <mat-datepicker-toggle matIconSuffix [for]="dp1"></mat-datepicker-toggle>
                    <mat-datepicker #dp1></mat-datepicker>
                  </mat-form-field>
                  @if (aridadDe(hijo.operador) === 2) {
                    <span class="cond__y">y</span>
                    <mat-form-field appearance="outline" class="cond__val" subscriptSizing="dynamic">
                      <input matInput [matDatepicker]="dp2" [value]="fecha(hijo, 1)"
                             (dateChange)="fijarValor(i, 1, isoDe($event.value))" placeholder="Fecha">
                      <mat-datepicker-toggle matIconSuffix [for]="dp2"></mat-datepicker-toggle>
                      <mat-datepicker #dp2></mat-datepicker>
                    </mat-form-field>
                  }
                }
                @case ('numero') {
                  <mat-form-field appearance="outline" class="cond__val" subscriptSizing="dynamic">
                    <input matInput type="number" [value]="valor(hijo, 0)"
                           (input)="fijarValor(i, 0, $any($event.target).value)" placeholder="Valor">
                  </mat-form-field>
                  @if (aridadDe(hijo.operador) === 2) {
                    <span class="cond__y">y</span>
                    <mat-form-field appearance="outline" class="cond__val" subscriptSizing="dynamic">
                      <input matInput type="number" [value]="valor(hijo, 1)"
                             (input)="fijarValor(i, 1, $any($event.target).value)" placeholder="Valor">
                    </mat-form-field>
                  }
                }
                @case ('lista') {
                  <div class="cond__lista">
                    <mat-chip-set>
                      @for (v of (hijo.valores ?? []); track $index; let vi = $index) {
                        <mat-chip (removed)="quitarValor(i, vi)">
                          {{ v }}
                          <button matChipRemove type="button" aria-label="Quitar valor">
                            <mat-icon>cancel</mat-icon>
                          </button>
                        </mat-chip>
                      }
                    </mat-chip-set>
                    <input class="cond__lista-input" type="text"
                           [placeholder]="cargandoValores() === hijo.campo ? 'Buscando…' : 'Escribe y Enter'"
                           [matAutocomplete]="auto"
                           (focus)="pedirSugerencias(hijo.campo)"
                           (input)="pedirSugerencias(hijo.campo, $any($event.target).value)"
                           (keydown.enter)="agregarValorLibre(i, $any($event.target))">
                    <mat-autocomplete #auto="matAutocomplete"
                                      (optionSelected)="agregarValor(i, $event.option.value)">
                      @for (s of sugerencias(); track $index) {
                        <mat-option [value]="s">{{ s }}</mat-option>
                      }
                    </mat-autocomplete>
                  </div>
                }
                @default {
                  <mat-form-field appearance="outline" class="cond__val" subscriptSizing="dynamic">
                    <input matInput type="text" [value]="valor(hijo, 0)"
                           (input)="fijarValor(i, 0, $any($event.target).value)"
                           [matAutocomplete]="autoTexto"
                           (focus)="pedirSugerencias(hijo.campo)"
                           placeholder="Valor">
                    <mat-autocomplete #autoTexto="matAutocomplete">
                      @for (s of sugerencias(); track $index) {
                        <mat-option [value]="s">{{ s }}</mat-option>
                      }
                    </mat-autocomplete>
                  </mat-form-field>
                }
              }
            }

            <button mat-icon-button type="button" class="cond__del" (click)="quitarHijo(i)"
                    matTooltip="Quitar condición">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
      }

      @if (!hijos().length) {
        <p class="grupo__vacio">
          Sin filtros: el reporte trae todos los registros.
          Agrega una condición para acotarlo.
        </p>
      }
    </div>
  </div>
  `,
  styles: [`
    :host { display: block; }
    .grupo {
      border: 1px dashed var(--rp-borde, #cbd5e1); border-radius: 12px;
      padding: .5rem; background: var(--rp-fondo-grupo, #fbfdff);
    }
    .grupo--raiz { border-style: solid; background: transparent; padding: 0; border: 0; }
    .grupo + .grupo { margin-top: .4rem; }

    .grupo__cab { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; margin-bottom: .4rem; }
    .grupo__desc { font-size: .72rem; color: #94a3b8; }
    .grupo__sp { flex: 1; }

    .union { display: inline-flex; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
    .union button {
      border: 0; background: transparent; padding: .15rem .6rem; cursor: pointer;
      font-size: .74rem; font-weight: 700; color: #64748b;
    }
    .union--on { background: #0284c7; color: #fff !important; }

    .btn-mini { font-size: .74rem !important; min-width: 0 !important; padding: 0 .5rem !important; }
    .btn-mini mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 2px; }

    .grupo__hijos { display: flex; flex-direction: column; gap: .35rem; }

    .cond {
      display: flex; align-items: center; gap: .4rem; flex-wrap: wrap;
      padding: .3rem .4rem; border-radius: 10px;
      background: var(--rp-fondo-cond, #fff); border: 1px solid var(--rp-borde, #e2e8f0);
    }
    .cond__campo {
      display: inline-flex; align-items: center; gap: .25rem;
      font-size: .8rem; font-weight: 600; color: #0f172a;
      max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cond__campo mat-icon { font-size: 15px; width: 15px; height: 15px; color: #94a3b8; }
    .cond__op { width: 168px; font-size: .8rem; }
    .cond__val { width: 150px; font-size: .8rem; }
    .cond__y { font-size: .74rem; color: #94a3b8; }
    .cond__del { width: 28px; height: 28px; line-height: 28px; margin-left: auto; }
    .cond__del mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .cond__lista { display: flex; align-items: center; gap: .3rem; flex-wrap: wrap; flex: 1; min-width: 200px; }
    .cond__lista-input {
      border: 0; outline: 0; background: transparent; font-size: .8rem; min-width: 120px; flex: 1;
    }

    .grupo__vacio { margin: .2rem 0; font-size: .78rem; color: #94a3b8; }

    :host-context(.dark-theme) {
      --rp-borde: #334155; --rp-fondo-grupo: #16202f; --rp-fondo-cond: #1e293b;
    }
    :host-context(.dark-theme) .cond__campo { color: #e2e8f0; }
  `],
})
export class ConstructorFiltrosComponent {

  private api = inject(ReportesApiService);

  readonly nodo = input<FilterNode | null>(null);
  readonly campos = input<CampoCatalogo[]>([]);
  readonly operadores = input<OperadorMeta[]>([]);
  readonly esRaiz = input(true);

  readonly cambio = output<FilterNode | null>();
  readonly eliminar = output<void>();

  readonly sugerencias = signal<string[]>([]);
  readonly cargandoValores = signal<string | null>(null);

  readonly union = computed<'AND' | 'OR'>(() => (this.nodo()?.union as 'AND' | 'OR') ?? 'AND');
  readonly hijos = computed<FilterNode[]>(() => this.nodo()?.hijos ?? []);

  readonly camposFiltrables = computed(() => this.campos().filter(c => c.filtrable));

  // ─────────────────────────────── edición ───────────────────────────────

  cambiarUnion(u: 'AND' | 'OR'): void {
    this.emitir({ ...this.base(), union: u });
  }

  agregarCondicion(c: CampoCatalogo): void {
    const op = c.operadores[0] ?? 'IGUAL';
    const nueva: FilterNode = { tipo: 'CONDICION', campo: c.clave, operador: op, valores: [] };
    this.emitir({ ...this.base(), hijos: [...this.hijos(), nueva] });
  }

  agregarGrupo(): void {
    const nuevo: FilterNode = { tipo: 'GRUPO', union: 'OR', hijos: [] };
    this.emitir({ ...this.base(), hijos: [...this.hijos(), nuevo] });
  }

  quitarHijo(i: number): void {
    const hijos = this.hijos().filter((_, idx) => idx !== i);
    // Un grupo raíz sin condiciones equivale a "sin filtros": se emite null para que
    // el reporte no arrastre un nodo vacío que el backend tendría que ignorar.
    this.emitir({ ...this.base(), hijos });
  }

  reemplazarHijo(i: number, nuevo: FilterNode | null): void {
    if (!nuevo) { this.quitarHijo(i); return; }
    const hijos = this.hijos().map((h, idx) => idx === i ? nuevo : h);
    this.emitir({ ...this.base(), hijos });
  }

  cambiarOperador(i: number, op: string): void {
    const aridad = this.aridadDe(op);
    const hijos = this.hijos().map((h, idx) => {
      if (idx !== i) return h;
      // Al cambiar de operador los valores viejos pueden sobrar o faltar: se recortan.
      const valores = aridad === 0 ? [] : (h.valores ?? []).slice(0, aridad === -1 ? undefined : aridad);
      return { ...h, operador: op, valores };
    });
    this.emitir({ ...this.base(), hijos });
  }

  fijarValor(i: number, pos: number, v: unknown): void {
    const hijos = this.hijos().map((h, idx) => {
      if (idx !== i) return h;
      const valores = [...(h.valores ?? [])];
      while (valores.length <= pos) valores.push(null);
      valores[pos] = v === '' ? null : v;
      return { ...h, valores };
    });
    this.emitir({ ...this.base(), hijos });
  }

  agregarValor(i: number, v: unknown): void {
    if (v === null || v === undefined || v === '') return;
    const hijos = this.hijos().map((h, idx) => {
      if (idx !== i) return h;
      const valores = [...(h.valores ?? [])];
      if (!valores.includes(v)) valores.push(v);
      return { ...h, valores };
    });
    this.emitir({ ...this.base(), hijos });
  }

  agregarValorLibre(i: number, input: HTMLInputElement): void {
    const v = input.value.trim();
    if (!v) return;
    this.agregarValor(i, v);
    input.value = '';
  }

  quitarValor(i: number, pos: number): void {
    const hijos = this.hijos().map((h, idx) => {
      if (idx !== i) return h;
      return { ...h, valores: (h.valores ?? []).filter((_, k) => k !== pos) };
    });
    this.emitir({ ...this.base(), hijos });
  }

  // ─────────────────────── sugerencias de valores ───────────────────────

  /**
   * Pide al servidor los valores distintos del campo. Es un desplegable acotado,
   * no una consulta de reporte: el backend lo limita a 500 y solo lo permite sobre
   * campos que el usuario puede ver.
   */
  pedirSugerencias(clave: string | null | undefined, texto?: string): void {
    if (!clave) return;
    this.cargandoValores.set(clave);
    this.api.valoresDeCampo(clave, texto, 50).subscribe({
      next: v => {
        this.sugerencias.set(v.map(x => String(x)));
        this.cargandoValores.set(null);
      },
      error: () => { this.sugerencias.set([]); this.cargandoValores.set(null); },
    });
  }

  // ─────────────────────────────── consultas ───────────────────────────────

  nombreCampo(clave: string | null | undefined): string {
    if (!clave) return '(campo)';
    return this.api.camposPorClave().get(clave)?.nombre ?? clave;
  }

  descripcionCampo(clave: string | null | undefined): string {
    if (!clave) return '';
    const c = this.api.camposPorClave().get(clave);
    if (!c) return clave;
    const tabla = this.api.datasetsPorClave().get(c.clave.split('.').slice(0, -1).join('.'));
    return `${tabla?.nombre ?? ''} · ${c.columna}`;
  }

  operadoresDe(clave: string | null | undefined): OperadorMeta[] {
    const c = clave ? this.api.camposPorClave().get(clave) : null;
    if (!c) return this.operadores();
    const permitidos = new Set(c.operadores);
    return this.operadores().filter(o => permitidos.has(o.nombre));
  }

  aridadDe(op: string | null | undefined): number {
    return this.operadores().find(o => o.nombre === op)?.aridad ?? 1;
  }

  /** Qué control pintar para los valores de la condición. */
  tipoEntrada(nodo: FilterNode): 'fecha' | 'numero' | 'lista' | 'texto' {
    if (this.aridadDe(nodo.operador) === -1) return 'lista';
    const c = nodo.campo ? this.api.camposPorClave().get(nodo.campo) : null;
    if (!c) return 'texto';
    if (c.tipo === 'FECHA' || c.tipo === 'FECHA_HORA') return 'fecha';
    if (c.tipo === 'ENTERO' || c.tipo === 'DECIMAL' || c.tipo === 'MONEDA') return 'numero';
    return 'texto';
  }

  valor(nodo: FilterNode, pos: number): unknown {
    return (nodo.valores ?? [])[pos] ?? '';
  }

  fecha(nodo: FilterNode, pos: number): Date | null {
    const v = this.valor(nodo, pos);
    if (!v) return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  }

  /** Se envía la fecha como YYYY-MM-DD para que no la corra la zona horaria. */
  isoDe(d: Date | null): string | null {
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  iconoTipo(c: CampoCatalogo): string {
    switch (c.tipo) {
      case 'ENTERO': case 'DECIMAL': return 'tag';
      case 'MONEDA': return 'payments';
      case 'FECHA': case 'FECHA_HORA': return 'event';
      case 'BOOLEANO': return 'toggle_on';
      default: return 'text_fields';
    }
  }

  iconoDeClave(clave: string | null | undefined): string {
    const c = clave ? this.api.camposPorClave().get(clave) : null;
    return c ? this.iconoTipo(c) : 'filter_alt';
  }

  private base(): FilterNode {
    return this.nodo() ?? { tipo: 'GRUPO', union: 'AND', hijos: [] };
  }

  private emitir(n: FilterNode): void {
    const vacio = n.tipo === 'GRUPO' && !(n.hijos ?? []).length;
    this.cambio.emit(vacio && this.esRaiz() ? null : n);
  }
}

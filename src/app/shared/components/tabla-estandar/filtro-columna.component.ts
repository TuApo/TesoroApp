import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';

import type { DireccionOrden, FiltroColumna, FormatoFecha, TipoFecha } from './tabla.tipos';
import { paraInput } from './tabla.fechas';

const VACIO = '(Vacías)';
const TOPE_LISTA = 500;

/**
 * Embudo de cada encabezado: orden A→Z / Z→A, filtro «contiene» y lista de
 * valores con casillas (estilo Excel).
 *
 * Va en un overlay del CDK y no dentro de la celda: así no lo recorta el
 * `overflow-x: auto` de la tabla. Se cierra con clic fuera, Esc o scroll.
 *
 * Los valores se piden con `obtenerValores()` SOLO al abrir: recorrer todas
 * las filas por cada columna en cada detección de cambios sería carísimo con
 * miles de registros.
 */
@Component({
  selector: 'app-tabla-filtro-columna',
  standalone: true,
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filtro-columna.component.html',
  styleUrl: './filtro-columna.component.css',
})
export class FiltroColumnaComponent {
  readonly titulo = input.required<string>();
  /** Valores distintos de la columna, ya filtrados por las demás columnas. */
  readonly obtenerValores = input.required<() => string[]>();
  readonly filtro = input<FiltroColumna>({ texto: '', valores: null });
  readonly orden = input<DireccionOrden | null>(null);
  readonly ordenable = input(true);
  /** Modo servidor: solo se ofrece ordenar (los valores de una página engañan). */
  readonly soloOrden = input(false);

  /** Columna de fechas: se ofrece un rango con calendario en vez de solo la lista. */
  readonly tipoFecha = input<TipoFecha | null>(null);
  readonly formatoFecha = input<FormatoFecha>('dd/mm/aaaa');

  readonly ordenCambio = output<DireccionOrden | null>();
  readonly filtroCambio = output<FiltroColumna>();
  readonly formatoFechaCambio = output<FormatoFecha>();

  readonly abierto = signal(false);
  readonly buscar = signal('');
  private readonly valoresUnicos = signal<string[]>([]);

  readonly VACIO = VACIO;
  readonly TOPE = TOPE_LISTA;

  readonly posiciones: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
  ];

  readonly activo = computed(() => {
    const f = this.filtro();
    return f.texto.trim() !== '' || f.valores !== null;
  });

  readonly totalValores = computed(() => this.valoresUnicos().length);

  readonly listado = computed(() => {
    const q = this.buscar().trim().toLowerCase();
    const base = this.valoresUnicos().map((v) => (v === '' ? VACIO : v));
    const filtrados = q ? base.filter((v) => v.toLowerCase().includes(q)) : base;
    return filtrados.slice(0, TOPE_LISTA);
  });

  private readonly marcados = computed(() => {
    const v = this.filtro().valores;
    return v === null ? null : new Set(v);
  });

  alternarMenu(ev: Event): void {
    ev.stopPropagation();
    if (this.abierto()) {
      this.cerrar();
      return;
    }
    if (!this.soloOrden()) this.valoresUnicos.set(this.obtenerValores()());
    this.buscar.set('');
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  estaMarcado(valor: string): boolean {
    const m = this.marcados();
    return m === null || m.has(valor === VACIO ? '' : valor);
  }

  alternar(valor: string): void {
    const real = valor === VACIO ? '' : valor;
    const todos = this.valoresUnicos();
    const actuales = new Set(this.marcados() ?? todos);
    if (actuales.has(real)) actuales.delete(real);
    else actuales.add(real);
    const lista = todos.filter((v) => actuales.has(v));
    this.filtroCambio.emit({ ...this.filtro(), valores: lista.length === todos.length ? null : lista });
  }

  marcarTodos(): void {
    this.filtroCambio.emit({ ...this.filtro(), valores: null });
  }

  /** Marca únicamente lo que coincide con el buscador interno. */
  marcarSoloVisibles(): void {
    this.filtroCambio.emit({ ...this.filtro(), valores: this.listado().map((v) => (v === VACIO ? '' : v)) });
  }

  cambiarTexto(texto: string): void {
    this.filtroCambio.emit({ ...this.filtro(), texto });
  }

  // ── Rango de fechas ────────────────────────────────────────────────────────

  readonly tipoInput = computed(() => (this.tipoFecha() === 'fecha-hora' ? 'datetime-local' : 'date'));

  readonly formatos: { valor: FormatoFecha; etiqueta: string }[] = [
    { valor: 'dd/mm/aaaa', etiqueta: 'día/mes/año' },
    { valor: 'mm/dd/aaaa', etiqueta: 'mes/día/año' },
    { valor: 'aaaa-mm-dd', etiqueta: 'año-mes-día' },
  ];

  cambiarRango(extremo: 'desde' | 'hasta', valor: string): void {
    this.filtroCambio.emit({ ...this.filtro(), [extremo]: valor || null });
  }

  /** Atajos: hoy, los últimos N días y el mes en curso. */
  rangoRapido(clave: 'hoy' | '7' | '30' | 'mes'): void {
    const tipo = this.tipoFecha() ?? 'fecha';
    const hoy = new Date();
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59);
    let ini = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0);
    if (clave === '7') ini = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6, 0, 0);
    if (clave === '30') ini = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 29, 0, 0);
    if (clave === 'mes') ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1, 0, 0);
    this.filtroCambio.emit({ ...this.filtro(), desde: paraInput(ini, tipo), hasta: paraInput(fin, tipo) });
  }

  limpiarRango(): void {
    this.filtroCambio.emit({ ...this.filtro(), desde: null, hasta: null });
  }

  ordenar(dir: DireccionOrden): void {
    this.ordenCambio.emit(this.orden() === dir ? null : dir);
  }

  limpiar(): void {
    this.filtroCambio.emit({ texto: '', valores: null });
    this.ordenCambio.emit(null);
  }

  onTecla(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.cerrar();
    }
  }
}

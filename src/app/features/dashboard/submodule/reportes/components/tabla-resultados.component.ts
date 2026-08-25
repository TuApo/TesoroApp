import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import Swal from 'sweetalert2';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { ColumnaResultado, ResultadoConsulta, SortSpec } from '../models/reportes.models';
import { ReportesApiService } from '../services/reportes-api.service';
import { EditarCeldaDialogComponent } from './editar-celda-dialog.component';

/**
 * Tabla de resultados del reporte (§9).
 *
 * Se apoya en {@link StandardFilterTable}, la tabla de la plataforma: ya trae
 * ordenamiento, filtros por columna, buscador, paginación, columnas
 * redimensionables y reordenables, mostrar/ocultar, fijar columnas, selección de
 * rangos, encabezado fijo y densidad. Reimplementar todo eso aquí habría dado una
 * tabla peor y, sobre todo, distinta del resto de la aplicación.
 *
 * Lo que sí es propio de este módulo:
 *  · COLUMNAS DINÁMICAS — se derivan del resultado, no están escritas a mano;
 *  · MODO SERVIDOR — paginar y ordenar se le piden al backend (§24), porque el
 *    conjunto real puede tener cientos de miles de filas;
 *  · TOTALES — pie de tabla con la suma de las columnas numéricas;
 *  · EDICIÓN EN LÍNEA (§10) — solo en las celdas que el servidor marcó editables.
 */
@Component({
  selector: 'app-tabla-resultados',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule, StandardFilterTable],
  template: `
  <div class="res">
    @if (resultado(); as r) {
      @if (r.advertencias.length) {
        <div class="avisos">
          @for (a of r.advertencias; track $index) {
            <div class="aviso"><mat-icon>warning_amber</mat-icon><span>{{ a }}</span></div>
          }
        </div>
      }

      @if (r.truncado) {
        <div class="aviso aviso--corte">
          <mat-icon>content_cut</mat-icon>
          <span>
            Se están mostrando {{ r.filas.length | number }} filas de un conjunto mayor.
            Agrega filtros para acotarlo, o exporta el reporte completo.
          </span>
        </div>
      }

      <app-standard-filter-table
        [data]="filas()"
        [columnDefinitions]="columnas()"
        [tableTitle]="titulo()"
        [totalCount]="r.total"
        [isLoading]="cargando()"
        [serverSide]="servidor()"
        [defaultPageSize]="tamPagina()"
        [pageSizeOptions]="[25, 50, 100, 200]"
        [enableRowClick]="editable()"
        [storageKey]="clavePersistencia()"
        (pageChange)="paginaCambio.emit($event)"
        (searchChange)="busquedaCambio.emit($event)"
        (sortChange)="alOrdenar($event)"
        (rowClicked)="alClicFila($event)">
      </app-standard-filter-table>

      @if (totales().length) {
        <div class="totales">
          <mat-icon>functions</mat-icon>
          @for (t of totales(); track t.id) {
            <span class="total">
              <em>{{ t.alias }}</em>
              <b>{{ t.texto }}</b>
            </span>
          }
          <span class="totales__nota" matTooltip="Los totales se calculan sobre las filas cargadas en pantalla">
            sobre {{ filas().length | number }} filas
          </span>
        </div>
      }

      <div class="pie">
        <span><mat-icon>timer</mat-icon> {{ r.duracion_ms }} ms</span>
        @if (r.total !== null) { <span><mat-icon>tag</mat-icon> {{ r.total | number }} registros</span> }
        @if (r.agregado) { <span><mat-icon>workspaces</mat-icon> resultado agrupado</span> }
        @if (editable()) {
          <span class="pie__edit">
            <mat-icon>edit</mat-icon> doble clic en una celda editable para modificarla
          </span>
        }
      </div>
    } @else if (cargando()) {
      <div class="skeleton">
        @for (i of [1,2,3,4,5,6]; track i) { <div class="skeleton__fila"></div> }
      </div>
    } @else {
      <div class="vacio">
        <mat-icon>table_chart</mat-icon>
        <p>{{ mensajeVacio() }}</p>
      </div>
    }
  </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .res { display: flex; flex-direction: column; gap: .5rem; min-width: 0; }

    .avisos { display: flex; flex-direction: column; gap: .3rem; }
    .aviso {
      display: flex; align-items: flex-start; gap: .4rem;
      padding: .45rem .6rem; border-radius: 10px; font-size: .78rem;
      background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
    }
    .aviso mat-icon { font-size: 17px; width: 17px; height: 17px; flex: 0 0 auto; }
    .aviso--corte { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }

    .totales {
      display: flex; align-items: center; gap: .9rem; flex-wrap: wrap;
      padding: .5rem .8rem; border-radius: 12px;
      background: var(--rp-totales, #f8fafc); border: 1px solid var(--rp-borde, #e2e8f0);
    }
    .totales > mat-icon { color: #64748b; font-size: 18px; width: 18px; height: 18px; }
    .total { display: flex; flex-direction: column; line-height: 1.15; }
    .total em { font-style: normal; font-size: .68rem; color: #94a3b8; }
    .total b { font-size: .95rem; font-variant-numeric: tabular-nums; color: #0f172a; }
    .totales__nota { margin-left: auto; font-size: .7rem; color: #94a3b8; }

    .pie {
      display: flex; gap: 1rem; flex-wrap: wrap; font-size: .72rem; color: #94a3b8;
      padding: 0 .2rem;
    }
    .pie span { display: inline-flex; align-items: center; gap: .2rem; }
    .pie mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .pie__edit { color: #0284c7; }

    .skeleton { display: flex; flex-direction: column; gap: .4rem; padding: .5rem 0; }
    .skeleton__fila {
      height: 34px; border-radius: 8px;
      background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%);
      background-size: 400% 100%; animation: brillo 1.3s ease-in-out infinite;
    }
    @keyframes brillo { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
    @media (prefers-reduced-motion: reduce) { .skeleton__fila { animation: none; } }

    .vacio { text-align: center; padding: 3rem 1rem; color: #94a3b8; }
    .vacio mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .5; }
    .vacio p { font-size: .86rem; margin: .6rem 0 0; }

    :host-context(.dark-theme) { --rp-totales: #1e293b; --rp-borde: #334155; }
    :host-context(.dark-theme) .total b { color: #e2e8f0; }
  `],
})
export class TablaResultadosComponent {

  private api = inject(ReportesApiService);
  private dialog = inject(MatDialog);

  readonly resultado = input<ResultadoConsulta | null>(null);
  readonly cargando = input(false);
  readonly titulo = input('Resultados');
  readonly servidor = input(true);
  readonly tamPagina = input(50);
  readonly clavePersistencia = input<string | undefined>(undefined);
  readonly mensajeVacio = input('Elige una tabla y algunas columnas para ver la vista previa.');
  readonly columnasTotalizadas = input<string[]>([]);

  readonly paginaCambio = output<{ page: number; size: number }>();
  readonly busquedaCambio = output<string>();
  readonly ordenCambio = output<SortSpec[]>();
  readonly datoEditado = output<void>();

  /** ¿Hay al menos una celda editable? Decide si se ofrece la edición en línea. */
  readonly editable = computed(() =>
    (this.resultado()?.columnas ?? []).some(c => c.editable && c.visible));

  /**
   * Traduce las columnas del resultado al contrato de la tabla de la plataforma.
   * Las ocultas (incluida la clave primaria que el servidor añade para poder
   * editar) no se pintan, pero sí viajan en las filas.
   */
  readonly columnas = computed<ColumnDefinition[]>(() => {
    const r = this.resultado();
    if (!r) return [];
    return r.columnas.filter(c => c.visible).map(c => ({
      name: c.id,
      header: c.alias,
      type: this.tipoTabla(c),
      format: this.formatoTabla(c),
      dateFormat: c.formato === 'datetime' ? 'dd/MM/yyyy HH:mm' : undefined,
      width: c.ancho ? `${c.ancho}px` : undefined,
      align: (c.alineacion as never) ?? undefined,
      filterable: true,
      sortable: true,
      statusConfig: c.formato === 'badge' ? this.coloresBadge(r, c) : undefined,
    }));
  });

  readonly filas = computed(() => this.resultado()?.filas ?? []);

  /** Totales del pie: suma de las columnas numéricas visibles (§9). */
  readonly totales = computed(() => {
    const r = this.resultado();
    if (!r) return [];
    const pedidas = new Set(this.columnasTotalizadas());
    const candidatas = r.columnas.filter(c =>
      c.visible
      && ['currency', 'decimal', 'integer', 'percent'].includes(c.formato ?? '')
      && (pedidas.size === 0 ? c.es_agregacion : pedidas.has(c.id)));
    return candidatas.map(c => {
      let suma = 0;
      for (const fila of r.filas) {
        const v = Number(fila[c.id]);
        if (!isNaN(v)) suma += v;
      }
      return { id: c.id, alias: c.alias, texto: this.formatearNumero(suma, c.formato) };
    });
  });

  alOrdenar(ev: { active: string; direction: 'asc' | 'desc' | '' }): void {
    if (!ev.direction) { this.ordenCambio.emit([]); return; }
    this.ordenCambio.emit([{ ref: ev.active, direccion: ev.direction === 'desc' ? 'DESC' : 'ASC' }]);
  }

  /**
   * Edición en línea (§10). Antes de abrir el editor se comprueba que la celda sea
   * editable de verdad: el servidor ya lo decidió al compilar, aquí solo se respeta.
   */
  alClicFila(fila: Record<string, unknown>): void {
    if (!this.editable()) return;
    const r = this.resultado();
    if (!r) return;
    const editables = r.columnas.filter(c => c.editable && c.visible);
    if (!editables.length) return;

    this.dialog.open(EditarCeldaDialogComponent, {
      width: '460px',
      maxWidth: '95vw',
      data: { fila, columnas: editables, todas: r.columnas },
    }).afterClosed().subscribe((cambio) => {
      if (!cambio) return;
      this.api.editarCelda(cambio).subscribe({
        next: () => {
          Swal.fire({
            icon: 'success', title: 'Cambio guardado',
            timer: 1600, showConfirmButton: false, toast: true, position: 'top-end',
          });
          this.datoEditado.emit();
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo guardar',
            text: err?.error?.message ?? err?.error?.detail ?? 'Intenta de nuevo.',
          });
        },
      });
    });
  }

  // ─────────────────────────────── formato ───────────────────────────────

  private tipoTabla(c: ColumnaResultado): ColumnDefinition['type'] {
    if (c.formato === 'badge') return 'status';
    if (c.formato === 'date' || c.formato === 'datetime') return 'date';
    if (['currency', 'decimal', 'integer', 'percent'].includes(c.formato ?? '')) return 'number';
    return 'text';
  }

  private formatoTabla(c: ColumnaResultado): ColumnDefinition['format'] {
    switch (c.formato) {
      case 'currency': return 'currency';
      case 'percent': return 'percent';
      case 'decimal': return 'decimal';
      default: return undefined;
    }
  }

  /**
   * Colores de los badges. Se derivan de los valores presentes para que un estado
   * nuevo en la base no salga sin color; los valores conocidos (activo/retirado,
   * sí/no) sí llevan color con significado.
   */
  private coloresBadge(r: ResultadoConsulta, c: ColumnaResultado): Record<string, { color: string; background: string }> {
    const positivos = ['activo', 'si', 'sí', 'true', '1', 'aprobado', 'ok', 'contratado', 'ejecutada', 'publicado'];
    const negativos = ['inactivo', 'no', 'false', '0', 'retirado', 'rechazado', 'anulada', 'archivado'];
    const neutros = ['pendiente', 'borrador', 'en proceso', 'espera'];
    const paleta = ['#6366f1', '#0891b2', '#7c3aed', '#c026d3', '#0d9488', '#ea580c'];

    const salida: Record<string, { color: string; background: string }> = {};
    let i = 0;
    for (const fila of r.filas) {
      const v = fila[c.id];
      if (v === null || v === undefined) continue;
      const clave = String(v);
      if (salida[clave]) continue;
      const norm = clave.trim().toLowerCase();
      if (positivos.includes(norm)) salida[clave] = { color: '#047857', background: '#d1fae5' };
      else if (negativos.includes(norm)) salida[clave] = { color: '#b91c1c', background: '#fee2e2' };
      else if (neutros.includes(norm)) salida[clave] = { color: '#b45309', background: '#fef3c7' };
      else {
        const c0 = paleta[i % paleta.length]; i += 1;
        salida[clave] = { color: c0, background: c0 + '1a' };
      }
    }
    return salida;
  }

  private formatearNumero(n: number, formato: string | null): string {
    if (formato === 'currency') {
      return n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    }
    if (formato === 'percent') return `${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })} %`;
    if (formato === 'integer') return n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
    return n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
  }
}

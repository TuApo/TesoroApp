import { SelectionModel } from '@angular/cdk/collections';
import { CdkTableModule } from '@angular/cdk/table';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule, isPlatformBrowser, formatCurrency, formatDate, formatNumber } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ContentChild,
  DoCheck,
  EventEmitter,
  Inject,
  Input,
  IterableDiffer,
  IterableDiffers,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  TemplateRef,
  ViewChild,
  ContentChildren,
  QueryList,
  AfterContentInit,
  inject,
} from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSidenavModule, MatDrawer } from '@angular/material/sidenav';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTable, MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

import { merge, Subscription } from 'rxjs';
import { debounceTime, startWith } from 'rxjs/operators';

import { ActiveFilter, ColumnDefinition, FilterOperator } from '../../models/advanced-table-interface';
import { ColumnCellTemplateDirective } from '../../directives/column-cell-template.directive';
import { GridSelection, aTsv } from './grid-selection';
import {
  TableTemplateService, ConfigPlantilla, ColumnaPlantilla, PlantillaTabla, VisibilidadPlantilla,
} from '../../services/table-template.service';
import { getLocalStorageItem, setLocalStorageItem } from '../../../core/utils/safe-storage';

type DateRangeGroup = FormGroup<{
  start: FormControl<Date | null>;
  end: FormControl<Date | null>;
}>;

type StatusStyle = { color: string; background: string };
type ViewMode = 'table' | 'cards';

@Component({
  selector: 'app-standard-filter-table',
  standalone: true,
  templateUrl: './standard-filter-table.html',
  styleUrls: ['./standard-filter-table.css'],
  imports: [
    CommonModule,
    CdkTableModule,
    MatTableModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    ReactiveFormsModule,
    MatMenuModule,
    MatPaginatorModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatSortModule,
    MatButtonModule,
    MatCheckboxModule,
    MatSidenavModule,
    MatSlideToggleModule,
    MatDividerModule,
    DragDropModule,
    RouterModule,
  ],
  changeDetection: ChangeDetectionStrategy.Default,
})
export class StandardFilterTable implements OnInit, OnChanges, AfterViewInit, DoCheck, OnDestroy, AfterContentInit {
  readonly Array = Array;
  readonly String = String;

  // =========================
  // differs: detecta mutación de arrays (push/splice) sin cambiar la referencia
  // =========================
  private dataDiffer: IterableDiffer<any>;
  private colsDiffer: IterableDiffer<ColumnDefinition>;

  // =========================
  // Toggle vista (tabla / tarjetas)
  // =========================
  viewMode: ViewMode = 'table';
  private breakpointObserver = inject(BreakpointObserver);

  setViewMode(ev: MatSlideToggleChange): void {
    this.viewMode = ev.checked ? 'cards' : 'table';
    this.saveState();
  }

  // Templates proyectados
  @ContentChild('actionsTemplate') actionsTemplate?: TemplateRef<unknown>;
  @ContentChild('attachmentTemplate') attachmentTemplate?: TemplateRef<unknown>;
  @ContentChild('semaforoTemplate') semaforoTemplate?: TemplateRef<unknown>;

  // Generic column templates
  @ContentChildren(ColumnCellTemplateDirective) cellTemplatesQuery!: QueryList<ColumnCellTemplateDirective>;
  customTemplates: Record<string, TemplateRef<any>> = {};

  /**
   * ✅ estadoTemplate ahora puede recibir:
   * - $implicit: row
   * - col: ColumnDefinition
   */
  @ContentChild('estadoTemplate') estadoTemplate?: TemplateRef<{ $implicit: any; col?: ColumnDefinition }>;
  @ContentChild('headerActionTemplate') headerActionTemplate?: TemplateRef<{ $implicit: ColumnDefinition }>;

  // Drawer
  @ViewChild('drawer') drawer?: MatDrawer;

  // Tabla (para recalcular sticky header/body en columnas dinámicas)
  @ViewChild(MatTable) matTable?: MatTable<any>;

  // Inputs
  @Input() data: any[] = [];
  @Input() columnDefinitions: ColumnDefinition[] = [];
  @Input() pageSizeOptions: number[] = [10, 20, 50];
  @Input() defaultPageSize = 10;
  @Input() tableTitle = 'Tabla de datos';
  @Input() totalCount: number | null = null;

  @Input() customPdfExport?: () => void;
  @Input() isLoading = false;
  @Input() createRoute?: string[] | null;

  @Input() useSwalLoading = false;
  @Input() enableRowClick = false;

  @Input() enableSelection = false;

  // Persistencia
  @Input() storageKey?: string;

  @Output() rowClicked = new EventEmitter<any>();

  /**
   * Modo servidor. Por defecto false: las 21 páginas que ya usan esta tabla
   * siguen paginando y filtrando en cliente, exactamente igual que antes.
   *
   * Con serverSide=true la tabla deja de recortar y ordenar por su cuenta:
   * asume que `data` YA es la página pedida, usa `totalCount` para el largo del
   * paginador, y avisa al padre con (pageChange)/(searchChange) para que sea él
   * quien pida los datos. Existe porque manage-workers tenía que descargar
   * 50.190 filas (37 MB) para mostrar 10.
   */
  @Input() serverSide = false;
  @Output() pageChange = new EventEmitter<{ page: number; size: number }>();
  @Output() searchChange = new EventEmitter<string>();
  /**
   * Ordenamiento en SERVIDOR. Solo emite con serverSide=true: en modo cliente la
   * tabla sigue ordenando ella misma sobre el dataSource, como siempre.
   *
   * Sin esto, una tabla en modo servidor solo podía ordenar la página que tenía a
   * la vista, que es justo lo que no sirve cuando el conjunto tiene 50.000 filas y
   * lo que se busca es "el mayor de todos".
   */
  @Output() sortChange = new EventEmitter<{ active: string; direction: 'asc' | 'desc' | '' }>();

  // Tabla
  displayedColumns: string[] = [];
  dataSource = new MatTableDataSource<any>([]);

  // Advanced Filters: Record<colName, FormGroup>
  // Estructura del FG: { operator, value, min, max }
  filterForms: Record<string, FormGroup> = {};

  // Estado de filtrabilidad por columna (usuario puede apagar filtros)
  // por defecto true, salvo que definition diga false.
  filterEnabledByCol: Record<string, boolean> = {};

  @ViewChild(MatSort) sort?: MatSort;
  @ViewChild(MatPaginator) paginator?: MatPaginator;

  // Búsqueda global
  globalSearch = new FormControl<string>('', { nonNullable: true });

  // Densidad
  density: 'compact' | 'comfortable' = 'compact';

  // Rango fechas global
  dateRange: DateRangeGroup = new FormGroup({
    start: new FormControl<Date | null>(null),
    end: new FormControl<Date | null>(null),
  });

  // Target para el rango de fechas: 'ALL' o el nombre de una columna date
  dateTargetColumn = new FormControl<string>('ALL', { nonNullable: true });

  // Helper options
  readonly yesNoOptions: string[] = ['Activo', 'Inactivo'];

  // Operadores disponibles
  readonly textOperators: { val: FilterOperator, label: string }[] = [
    { val: 'contains', label: 'Contiene' },
    { val: 'equals', label: 'Igual a' },
    { val: 'startsWith', label: 'Empieza con' },
  ];
  readonly numberOperators: { val: FilterOperator, label: string }[] = [
    { val: 'equals', label: 'Igual a' },
    { val: 'range', label: 'Rango' },
    { val: 'gte', label: 'Mayor o igual' },
    { val: 'lte', label: 'Menor o igual' },
  ];

  // Columnas visibles
  visibleColumns: ColumnDefinition[] = [];
  private visibleColumnNames = new Set<string>();

  // Selección
  selection = new SelectionModel<any>(true, []);

  // Subs separadas
  private filterSubs = new Subscription();
  private uiSubs = new Subscription();

  // caches
  private colByName = new Map<string, ColumnDefinition>();
  private statusConfigByCol = new Map<string, Record<string, StatusStyle>>();
  private customConfigByCol = new Map<string, Record<string, StatusStyle>>();

  // Select Search Caches
  selectSearchControls: Record<string, FormControl<string>> = {};

  // ═══════════════════════════════════════════════════════════════════════════
  // REJILLA TIPO HOJA DE CÁLCULO
  // Selección por rango, copiado al portapapeles, reordenar y añadir columnas,
  // y plantillas de disposición compartibles.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Capacidades de rejilla. Encendidas por defecto: son aditivas (no cambian lo que se
   * pinta si nadie las usa) y la decisión fue que salgan en todas las tablas a la vez.
   * Una tabla que necesite el comportamiento anterior las apaga con [enableGrid]="false".
   */
  @Input() enableGrid = true;

  /**
   * Plantillas de disposición. Requieren `storageKey` (es el table_key con el que se
   * guardan): sin él no hay forma de saber a qué tabla pertenece una plantilla, así que
   * quedan apagadas aunque enableGrid esté activo.
   */
  @Input() enableTemplates = true;

  /**
   * "Consulta extensa": la tabla pagina SIEMPRE, y este botón es la vía explícita para
   * pedir el conjunto completo. Se declara desde el padre porque sólo él sabe cómo
   * traerlo (y cuánto cuesta). Sin (extendedQuery) suscrito, el botón no aparece.
   */
  @Output() extendedQuery = new EventEmitter<void>();
  @Input() extendedQueryLabel = 'Consulta extensa';
  /** Lo pone el padre mientras trae el conjunto completo. */
  @Input() extendedQueryLoading = false;
  /** El padre lo enciende cuando el listado ya es el conjunto completo. */
  @Input() extendedQueryDone = false;

  private readonly templates = inject(TableTemplateService);

  readonly sel = new GridSelection();

  /**
   * Orden de columnas elegido por el usuario. Vacío = el orden en que llegaron en
   * columnDefinitions (comportamiento de siempre). Se guarda por nombre y no por índice
   * para que sobreviva a que el padre añada o quite columnas entre visitas.
   */
  columnOrder: string[] = [];

  /**
   * Columnas VACÍAS añadidas por el usuario: no existen en los datos, se pintan en blanco
   * y sirven para dejar huecos al armar un formato (imprimir y rellenar a mano, o pegar
   * en Excel con las casillas ya puestas).
   */
  emptyColumns: ColumnDefinition[] = [];
  private emptySeq = 0;

  /** Prefijo reservado. Permite distinguir una columna vacía sin llevar un registro aparte. */
  private static readonly PREFIJO_VACIA = '__vacia_';

  esColumnaVacia(name: string): boolean {
    return name.startsWith(StandardFilterTable.PREFIJO_VACIA);
  }

  // ── Plantillas ────────────────────────────────────────────────────────────

  plantillas: PlantillaTabla[] = [];
  plantillaAplicada: string | null = null;
  cargandoPlantillas = false;

  private get puedeUsarPlantillas(): boolean {
    return this.enableGrid && this.enableTemplates && !!this.storageKey;
  }

  private cargarPlantillas(): void {
    if (!this.puedeUsarPlantillas) return;
    this.cargandoPlantillas = true;
    this.uiSubs.add(this.templates.listar(this.storageKey!).subscribe(ps => {
      this.plantillas = ps;
      this.cargandoPlantillas = false;
      // La base se aplica sola, pero sólo si el usuario no ha tocado nada todavía:
      // pisarle una disposición que acaba de armar sería peor que no tener plantillas.
      const base = ps.find(x => x.es_base);
      if (base && !this.plantillaAplicada && this.columnOrder.length === 0 && this.emptyColumns.length === 0) {
        this.aplicarPlantilla(base);
      }
      this.cdr.markForCheck();
    }));
  }

  aplicarPlantilla(p: PlantillaTabla): void {
    const cfg = this.templates.parseConfig(p);
    if (!cfg) {
      Swal.fire({ icon: 'warning', title: 'Plantilla ilegible',
        text: 'Se guardó con un formato que esta versión no entiende.' });
      return;
    }

    // Las columnas vacías de la plantilla se recrean; las reales sólo se reordenan y se
    // muestran u ocultan. Una plantilla NUNCA inventa columnas de datos: si se guardó con
    // una columna que el padre ya no envía, simplemente no aparece.
    this.emptyColumns = cfg.columnas
      .filter(c => c.vacia)
      .map(c => ({ name: c.name, header: c.header || '', type: 'text',
                   width: c.width, filterable: false, sortable: false } as ColumnDefinition));
    this.emptySeq = this.emptyColumns.length;

    const conocidas = new Set([
      ...(this.columnDefinitions || []).map(c => c.name),
      ...this.emptyColumns.map(c => c.name),
    ]);

    this.columnOrder = cfg.columnas.map(c => c.name).filter(n => conocidas.has(n));

    this.visibleColumnNames = new Set(
      cfg.columnas.filter(c => c.visible && conocidas.has(c.name)).map(c => c.name));
    // 'actions' no es del usuario: si la tabla la tiene, va siempre.
    if ((this.columnDefinitions || []).some(c => c.name === 'actions')) {
      this.visibleColumnNames.add('actions');
    }

    for (const c of cfg.columnas) {
      if (!c.width) continue;
      const def = this.colByName.get(c.name) || this.emptyColumns.find(e => e.name === c.name);
      if (def) def.width = c.width;
    }

    this.plantillaAplicada = p.id;
    this.recomputeVisibleColumns();
    this.sel.limpiar();
    this.cdr.markForCheck();
  }

  /** Disposición actual, lista para guardarse. */
  private configActual(): ConfigPlantilla {
    const columnas: ColumnaPlantilla[] = this.todasLasColumnas().map(c => ({
      name: c.name,
      visible: this.visibleColumnNames.has(c.name),
      width: c.width,
      vacia: this.esColumnaVacia(c.name) || undefined,
      header: this.esColumnaVacia(c.name) ? c.header : undefined,
    }));
    return { v: 1, columnas };
  }

  async guardarPlantilla(): Promise<void> {
    if (!this.puedeUsarPlantillas) return;

    const { value: form } = await Swal.fire<{ nombre: string; visibilidad: VisibilidadPlantilla; base: boolean }>({
      title: 'Guardar plantilla',
      html:
        '<input id="plt-nombre" class="swal2-input" placeholder="Nombre de la plantilla" maxlength="120">' +
        '<select id="plt-vis" class="swal2-select">' +
        '<option value="PRIVADA">Privada (solo yo)</option>' +
        '<option value="PUBLICA">Pública (todo el equipo)</option>' +
        '</select>' +
        '<label style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:8px">' +
        '<input type="checkbox" id="plt-base"> Aplicar automáticamente al abrir</label>',
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('plt-nombre') as HTMLInputElement)?.value?.trim();
        if (!nombre) { Swal.showValidationMessage('Ponle un nombre'); return false as any; }
        return {
          nombre,
          visibilidad: (document.getElementById('plt-vis') as HTMLSelectElement)?.value as VisibilidadPlantilla,
          base: (document.getElementById('plt-base') as HTMLInputElement)?.checked,
        };
      },
    });

    if (!form) return;

    this.templates.guardar({
      tableKey: this.storageKey!,
      nombre: form.nombre,
      config: this.configActual(),
      visibilidad: form.visibilidad,
      esBase: form.base,
    }).subscribe({
      next: (p) => {
        this.plantillaAplicada = p.id;
        this.cargarPlantillas();
        Swal.fire({ icon: 'success', title: 'Plantilla guardada', timer: 1400, showConfirmButton: false });
      },
      error: (e) => Swal.fire({ icon: 'error', title: 'No se pudo guardar',
        text: e?.error?.message || 'Revisa tu conexión e inténtalo de nuevo.' }),
    });
  }

  eliminarPlantilla(p: PlantillaTabla, ev?: Event): void {
    ev?.stopPropagation();
    if (!p.editable) return;
    Swal.fire({
      icon: 'warning', title: `¿Eliminar "${p.nombre}"?`,
      text: p.visibilidad === 'PUBLICA' ? 'Es pública: dejará de estar disponible para el equipo.' : '',
      showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    }).then(r => {
      if (!r.isConfirmed) return;
      this.templates.eliminar(this.storageKey!, p.id).subscribe({
        next: () => {
          if (this.plantillaAplicada === p.id) this.plantillaAplicada = null;
          this.cargarPlantillas();
        },
        error: () => Swal.fire({ icon: 'error', title: 'No se pudo eliminar' }),
      });
    });
  }

  restablecerDisposicion(): void {
    this.columnOrder = [];
    this.emptyColumns = [];
    this.emptySeq = 0;
    this.plantillaAplicada = null;
    this.visibleColumnNames = new Set((this.columnDefinitions || []).map(c => c.name));
    this.recomputeVisibleColumns();
    this.sel.limpiar();
    this.cdr.markForCheck();
  }

  // ── Columnas: orden y columnas vacías ─────────────────────────────────────

  /** Reales + vacías, en el orden elegido por el usuario. Fuente única del orden. */
  todasLasColumnas(): ColumnDefinition[] {
    const reales = this.columnDefinitions || [];
    const todas = [...reales, ...this.emptyColumns];
    if (this.columnOrder.length === 0) return todas;

    const pos = new Map(this.columnOrder.map((n, i) => [n, i]));
    // Las que no están en el orden guardado (columna nueva del padre) van al final,
    // conservando su orden relativo: aparecer es mejor que desaparecer.
    return [...todas].sort((a, b) =>
      (pos.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.name) ?? Number.MAX_SAFE_INTEGER));
  }

  agregarColumnaVacia(): void {
    const name = `${StandardFilterTable.PREFIJO_VACIA}${++this.emptySeq}`;
    this.emptyColumns.push({
      name, header: 'Nueva columna', type: 'text',
      filterable: false, sortable: false, width: '160px',
    } as ColumnDefinition);

    // Se inserta al final del orden actual para que aparezca donde el usuario la ve nacer.
    this.columnOrder = this.todasLasColumnas().map(c => c.name);
    this.visibleColumnNames.add(name);
    this.recomputeVisibleColumns();
    this.cdr.markForCheck();
  }

  async renombrarColumnaVacia(col: ColumnDefinition, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    const { value } = await Swal.fire({
      title: 'Nombre de la columna', input: 'text', inputValue: col.header || '',
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
    });
    if (value === undefined || value === null) return;
    col.header = String(value).trim() || 'Nueva columna';
    this.cdr.markForCheck();
  }

  quitarColumnaVacia(col: ColumnDefinition, ev?: Event): void {
    ev?.stopPropagation();
    this.emptyColumns = this.emptyColumns.filter(c => c.name !== col.name);
    this.columnOrder = this.columnOrder.filter(n => n !== col.name);
    this.visibleColumnNames.delete(col.name);
    this.recomputeVisibleColumns();
    this.sel.limpiar();
    this.cdr.markForCheck();
  }

  /** Arrastrar un encabezado. El índice que llega es sobre `visibleColumns`. */
  reordenarColumnas(ev: CdkDragDrop<ColumnDefinition[]>): void {
    if (ev.previousIndex === ev.currentIndex) return;

    // Se reordena sobre la lista VISIBLE y luego se reconstruye el orden completo
    // intercalando las ocultas donde estaban: mover una visible no debe barajar las
    // que el usuario tiene apagadas.
    const visibles = [...this.visibleColumns];
    moveItemInArray(visibles, ev.previousIndex, ev.currentIndex);

    const nuevoOrdenVisible = visibles.map(c => c.name);
    let i = 0;
    this.columnOrder = this.todasLasColumnas().map(c =>
      this.visibleColumnNames.has(c.name) ? nuevoOrdenVisible[i++] : c.name);

    this.recomputeVisibleColumns();
    this.sel.limpiar();
    this.cdr.markForCheck();
  }

  // ── Selección de celdas ───────────────────────────────────────────────────

  /**
   * Filas que la tabla está pintando AHORA, en su orden real.
   *
   * Las alimenta `dataSource.connect()`, que emite exactamente lo que mat-table renderiza
   * (filtrado → ordenado → paginado). Derivarlas a mano de `filteredData` recortando por
   * el paginador da filas equivocadas en cuanto hay un orden activo: `filteredData` está
   * filtrado pero NO ordenado, así que copiar una selección sobre una tabla ordenada
   * devolvía los datos de otras filas.
   */
  private filasRenderizadas: any[] = [];

  private get filasVisibles(): any[] {
    return this.filasRenderizadas;
  }

  /** Mantiene `filasRenderizadas` al día y recorta la selección si la rejilla encoge. */
  private escucharFilasRenderizadas(): void {
    this.uiSubs.add(this.dataSource.connect().subscribe(rows => {
      this.filasRenderizadas = rows ?? [];
      this.sincronizarTamanoSeleccion();
    }));
  }

  private sincronizarTamanoSeleccion(): void {
    this.sel.redimensionar(this.filasVisibles.length, this.visibleColumns.length);
  }

  onCeldaMouseDown(fila: number, col: number, ev: MouseEvent): void {
    if (!this.enableGrid || ev.button !== 0) return;
    this.sincronizarTamanoSeleccion();
    this.sel.iniciarEn(fila, col, ev.shiftKey);
    this.cdr.markForCheck();
  }

  onCeldaMouseEnter(fila: number, col: number): void {
    if (!this.enableGrid) return;
    this.sel.arrastrarHasta(fila, col);
    this.cdr.markForCheck();
  }

  onSeleccionarFila(fila: number, ev: MouseEvent): void {
    if (!this.enableGrid) return;
    this.sincronizarTamanoSeleccion();
    this.sel.seleccionarFila(fila, ev.shiftKey);
    this.cdr.markForCheck();
  }

  onSeleccionarColumna(col: number, ev: MouseEvent): void {
    if (!this.enableGrid) return;
    ev.stopPropagation(); // no disparar el ordenamiento del encabezado
    this.sincronizarTamanoSeleccion();
    this.sel.seleccionarColumna(col, ev.shiftKey);
    this.cdr.markForCheck();
  }

  /**
   * Teclado de la rejilla. Se escucha en el contenedor (no en window) para no secuestrar
   * las flechas ni Ctrl+C del resto de la página: sólo actúa cuando el foco está dentro
   * de la tabla y no en un campo de texto.
   */
  onGridKeyDown(ev: KeyboardEvent): void {
    if (!this.enableGrid) return;

    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
      return;
    }

    this.sincronizarTamanoSeleccion();
    const ctrl = ev.ctrlKey || ev.metaKey;

    if (ctrl && (ev.key === 'c' || ev.key === 'C')) {
      if (this.sel.hayseleccion) { ev.preventDefault(); this.copiarSeleccion(); }
      return;
    }
    if (ctrl && (ev.key === 'a' || ev.key === 'A')) {
      ev.preventDefault(); this.sel.seleccionarTodo(); this.cdr.markForCheck(); return;
    }
    if (ev.key === 'Escape') { this.sel.limpiar(); this.cdr.markForCheck(); return; }

    const saltos: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      Enter: [1, 0], Tab: [0, 1],
    };

    if (ctrl && (ev.key === 'Home' || ev.key === 'End')) {
      ev.preventDefault();
      this.sel.irABorde(ev.key === 'Home' ? 'inicio' : 'fin', ev.shiftKey);
      this.cdr.markForCheck();
      return;
    }

    const salto = saltos[ev.key];
    if (!salto) return;

    // Tab sin selección debe seguir tabulando por la página, no quedar atrapado.
    if (ev.key === 'Tab' && !this.sel.hayseleccion) return;

    ev.preventDefault();
    this.sel.mover(salto[0], salto[1], ev.shiftKey);
    this.cdr.markForCheck();
  }

  /** Suelta el arrastre aunque el botón se levante fuera de la tabla. */
  onGridMouseUp(): void {
    this.sel.terminarArrastre();
  }

  /**
   * Texto de una celda TAL COMO SE VE. Copiar tiene que dar lo mismo que la pantalla:
   * por eso replica el formato de la plantilla (fecha corta, etiqueta de estado, moneda)
   * en vez de volcar el valor crudo del objeto.
   */
  textoCelda(row: any, col: ColumnDefinition): string {
    if (this.esColumnaVacia(col.name)) return '';

    const v = row?.[col.name];
    if (v === null || v === undefined) return '';

    switch (col.type) {
      case 'date': {
        const d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return String(v);
        // Mismo patrón que la plantilla (incluida la hora si la columna la pide).
        return formatDate(d, col.dateFormat ?? 'dd/MM/yyyy', 'es-CO');
      }
      case 'status':
        return this.getStatusLabel(col.name, v);
      case 'custom':
        return String(v);
      default:
        return this.formatCell(v, col);
    }
  }

  /** Matriz de textos del rango seleccionado. */
  private matrizSeleccionada(): string[][] {
    const r = this.sel.rango();
    if (!r) return [];
    const filas = this.filasVisibles;
    const cols = this.visibleColumns;

    const out: string[][] = [];
    for (let f = r.filaIni; f <= r.filaFin && f < filas.length; f++) {
      const linea: string[] = [];
      for (let c = r.colIni; c <= r.colFin && c < cols.length; c++) {
        linea.push(this.textoCelda(filas[f], cols[c]));
      }
      out.push(linea);
    }
    return out;
  }

  /** Títulos de las columnas que abarca el rango, en el orden en que se ven. */
  private encabezadosSeleccionados(): string[] {
    const r = this.sel.rango();
    if (!r) return [];
    const out: string[] = [];
    for (let c = r.colIni; c <= r.colFin && c < this.visibleColumns.length; c++) {
      out.push(this.visibleColumns[c].header ?? this.visibleColumns[c].name);
    }
    return out;
  }

  /**
   * Copia el rango como TSV: se pega directo en Excel, Sheets o Calc.
   *
   * Si la selección toma las columnas ENTERAS (seleccionar todo, clic en el encabezado de
   * una columna, o un arrastre de la primera a la última fila) la cabecera va sola, sin
   * pedirla: pegar un bloque de columnas sin sus títulos obliga a adivinar qué es cada una.
   * Para un trozo suelto de celdas no se añade — ahí estorbaría.
   */
  async copiarSeleccion(conEncabezados = false): Promise<void> {
    const matriz = this.matrizSeleccionada();
    if (!matriz.length) return;

    const conCabecera = conEncabezados || this.sel.cubreTodasLasFilas();
    if (conCabecera) matriz.unshift(this.encabezadosSeleccionados());

    const texto = aTsv(matriz);
    const celdas = this.sel.conteo();

    try {
      await navigator.clipboard.writeText(texto);
      this.avisoCopiado(celdas, conCabecera);
    } catch {
      // navigator.clipboard exige contexto seguro y permiso; en el APK y en HTTP plano
      // puede no estar. El textarea + execCommand sigue funcionando ahí.
      if (this.copiarFallback(texto)) this.avisoCopiado(celdas, conCabecera);
      else Swal.fire({ icon: 'error', title: 'No se pudo copiar',
        text: 'El navegador bloqueó el acceso al portapapeles.' });
    }
  }

  private copiarFallback(texto: string): boolean {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  private avisoCopiado(celdas: number, conCabecera = false): void {
    Swal.fire({
      toast: true, position: 'bottom-end', icon: 'success',
      title: `${celdas} ${celdas === 1 ? 'celda copiada' : 'celdas copiadas'}`,
      text: conCabecera ? 'Con los encabezados de columna' : undefined,
      showConfirmButton: false, timer: 1200,
    });
  }

  /** Número de fila que se pinta en la columna índice (1-based sobre la página). */
  numeroFila(indice: number): number {
    if (this.serverSide || !this.paginator) return indice + 1;
    return this.paginator.pageIndex * this.paginator.pageSize + indice + 1;
  }

  pedirConsultaExtensa(): void {
    this.extendedQuery.emit();
  }

  /**
   * ¿Esta columna tiene filtro puesto? Pinta el icono del encabezado en estado activo,
   * para que se vea DÓNDE se está filtrando sin abrir menú por menú.
   *
   * Un array vacío (multi-select sin nada elegido) no cuenta como filtro; 0 y false sí,
   * porque son valores legítimos que el usuario pudo escribir.
   */
  tieneFiltroActivo(name: string): boolean {
    const fg = this.filterForms[name];
    if (!fg) return false;
    const { value, min, max } = fg.value ?? {};
    const puesto = (v: any) =>
      v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
    return puesto(value) || puesto(min) || puesto(max);
  }

  // ── Organizador de columnas ───────────────────────────────────────────────

  /**
   * Panel para reordenar y mostrar/ocultar columnas.
   *
   * Se arrastra en una lista VERTICAL, no sobre los encabezados de la tabla. Dos razones:
   * arrastrar un <th> de mat-table pelea con el sticky y con el ordenamiento del propio
   * encabezado, y sobre todo esta app corre también como APK Android, donde arrastrar una
   * cabecera estrecha con el dedo es inservible. Una lista vertical se maneja igual con
   * ratón que con el dedo.
   */
  organizadorAbierto = false;
  columnasOrganizables: ColumnDefinition[] = [];

  abrirOrganizador(): void {
    this.columnasOrganizables = this.todasLasColumnas().filter(c => c.name !== 'actions');
    this.organizadorAbierto = true;
    this.cdr.markForCheck();
  }

  cerrarOrganizador(): void {
    this.organizadorAbierto = false;
    this.cdr.markForCheck();
  }

  organizadorDrop(ev: CdkDragDrop<ColumnDefinition[]>): void {
    moveItemInArray(this.columnasOrganizables, ev.previousIndex, ev.currentIndex);
  }

  aplicarOrganizador(): void {
    // 'actions' se excluyó de la lista editable, así que se vuelve a añadir al final
    // para no perderla del orden.
    const orden = this.columnasOrganizables.map(c => c.name);
    if ((this.columnDefinitions || []).some(c => c.name === 'actions')) orden.push('actions');

    this.columnOrder = orden;
    this.recomputeVisibleColumns();
    this.sel.limpiar();
    this.organizadorAbierto = false;
    this.cdr.markForCheck();
  }

  /** Mover una posición sin arrastrar: accesible por teclado y cómodo en móvil. */
  moverEnOrganizador(i: number, delta: number): void {
    const j = i + delta;
    if (j < 0 || j >= this.columnasOrganizables.length) return;
    moveItemInArray(this.columnasOrganizables, i, j);
    this.cdr.markForCheck();
  }

  constructor(
    private cdr: ChangeDetectorRef,
    private differs: IterableDiffers,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // ✅ trackBy estable para detectar cambios con fiabilidad
    this.dataDiffer = this.differs.find([]).create<any>((i, row) => this.trackByRow(i, row));
    this.colsDiffer = this.differs.find([]).create<ColumnDefinition>((i, c) => c?.name ?? i);
  }

  // trackBy
  trackByCol = (_: number, c: ColumnDefinition) => c?.name;
  trackByRow = (i: number, row: any) => row?.id ?? row?.uuid ?? row?.code ?? row?._id ?? i;

  // =========================
  // ✅ sticky refresher (header + body)
  // =========================
  private refreshSticky(): void {
    queueMicrotask(() => this.matTable?.updateStickyColumnStyles());
  }

  // =========================
  // lifecycle
  // =========================
  ngOnInit(): void {
    // Restaurar estado si existe key
    if (this.storageKey) {
      this.loadState();
    }

    // Auto-switch a cards en mobile, tabla en desktop
    this.uiSubs.add(
      this.breakpointObserver.observe('(max-width: 900px)').subscribe(result => {
        this.viewMode = result.matches ? 'cards' : 'table';
        this.cdr.detectChanges();
      })
    );

    this.initializeTable();
    this.applyFilters();

    // Después de initializeTable: cargarPlantillas puede aplicar una disposición y
    // necesita que colByName y las columnas visibles ya existan.
    this.escucharFilasRenderizadas();
    this.cargarPlantillas();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.useSwalLoading && changes['isLoading']) {
      if (this.isLoading) {
        Swal.fire({
          title: 'Cargando...',
          allowOutsideClick: false,
          allowEscapeKey: false,
          didOpen: () => Swal.showLoading(),
        });
      } else if (Swal.isVisible()) {
        Swal.close();
      }
    }

    // Si columnDefinitions llega como referencia nueva
    if (changes['columnDefinitions'] && !changes['columnDefinitions'].firstChange) {
      this.rebuildColumnsAndFilters();
      return;
    }

    if (changes['enableSelection'] && !changes['enableSelection'].firstChange) {
      if (!this.enableSelection) this.selection.clear();
      this.recomputeVisibleColumns();
    }

    // Si data llega como referencia nueva
    if (changes['data'] && !changes['data'].firstChange) {
      this.dataSource.data = (this.data || []).slice();

      if (this.paginator) this.dataSource.paginator = this.paginator;
      if (this.sort) this.dataSource.sort = this.sort;

      this.syncPaginatorLength();
      this.applyFilters();
    }

    if (changes['defaultPageSize'] && !changes['defaultPageSize'].firstChange) {
      if (this.paginator) {
        this.paginator.pageSize = this.defaultPageSize;
        this.paginator.firstPage();
        this.syncPaginatorLength();
      }
    }
  }

  // ✅ esto detecta push/splice sin cambiar referencia (y sin necesidad de click)
  ngDoCheck(): void {
    const colsChanged = this.colsDiffer.diff(this.columnDefinitions || []);
    if (colsChanged) {
      this.rebuildColumnsAndFilters();
      return;
    }

    const dataChanged = this.dataDiffer.diff(this.data || []);
    if (dataChanged) {
      this.applyFilters();
      this.syncPaginatorLength();
    }
  }

  ngAfterViewInit(): void {
    if (this.sort) {
      this.dataSource.sort = this.sort;

      // Modo servidor: el clic en la cabecera no ordena aquí, se lo pide al padre.
      this.uiSubs.add(this.sort.sortChange.subscribe(ev => {
        if (!this.serverSide) return;
        this.sortChange.emit({
          active: ev.active,
          direction: ev.direction as 'asc' | 'desc' | '',
        });
      }));

      this.dataSource.sortingDataAccessor = (item: any, property: string) => {
        const col = this.colByName.get(property);
        const raw = item?.[property];
        if (!col) return raw;

        if (col.type === 'date') {
          if (raw instanceof Date) return raw.getTime();
          const d = raw ? new Date(raw) : null;
          return d && !isNaN(d.getTime()) ? d.getTime() : -Infinity;
        }

        if (col.type === 'number') {
          if (raw === null || raw === undefined || raw === '') return -Infinity;
          const n = typeof raw === 'number' ? raw : Number(raw);
          return isNaN(n) ? -Infinity : n;
        }

        return (raw ?? '').toString().toLowerCase();
      };
    }

    if (this.paginator) {
      // En modo servidor NO se ata el paginador al dataSource: si se atara,
      // recortaría OTRA VEZ la página que ya viene recortada del backend
      // (mostraría 10 de las 50 que llegaron).
      if (!this.serverSide) {
        this.dataSource.paginator = this.paginator;
      }
      this.paginator.pageSize = this.defaultPageSize;

      this.syncPaginatorLength();
      this.uiSubs.add(this.paginator.page.subscribe(e => {
        if (this.serverSide) {
          this.pageChange.emit({ page: e.pageIndex, size: e.pageSize });
        }
        this.cdr.detectChanges();
      }));
    }

    // primer render con data actual
    this.dataSource.data = (this.data || []).slice();
    this.applyFilters();

    this.refreshSticky();
    this.cdr.detectChanges();
  }



  ngAfterContentInit() {
    this.updateCustomTemplates();
    this.cellTemplatesQuery.changes.subscribe(() => {
      this.updateCustomTemplates();
      this.cdr.markForCheck();
    });
  }

  private updateCustomTemplates() {
    this.customTemplates = {};
    this.cellTemplatesQuery.forEach((item) => {
      this.customTemplates[item.column] = item.template;
    });
  }

  ngOnDestroy(): void {
    this.filterSubs.unsubscribe();
    this.uiSubs.unsubscribe();

    if (this.useSwalLoading && Swal.isVisible()) Swal.close();
  }

  emitRowClick(row: any, event?: Event): void {
    if (!this.enableRowClick) return;

    const target = event?.target as HTMLElement | null;
    if (target?.closest('button, a, mat-checkbox, [data-row-click-ignore="true"]')) return;

    this.rowClicked.emit(row);
  }

  // =========================
  // Drawer & UI
  // =========================
  toggleDrawer(): void {
    this.drawer?.toggle();
  }

  closeDrawer(): void {
    this.drawer?.close();
  }

  // =========================
  // init / rebuild
  // =========================
  private initializeTable(): void {
    this.buildColumnCaches();
    this.ensureVisibleColumnsInitialized();
    this.recomputeVisibleColumns();

    this.dataSource.data = (this.data || []).slice();

    this.filterSubs.unsubscribe();
    this.filterSubs = new Subscription();

    // Rebuild controls preserving values if possible, or init new ones
    // We clean old controls that probably don't match anymore
    const oldForms = this.filterForms;
    this.filterForms = {};
    this.selectSearchControls = {};

    (this.columnDefinitions || []).forEach((col) => {
      // Init filterEnabledByCol default
      if (this.filterEnabledByCol[col.name] === undefined) {
        this.filterEnabledByCol[col.name] = col.filterable !== false;
      }

      if (col.filterable === false) return;
      if (col.type === 'date') return; // Date handled globally or specifically separate

      const existing = oldForms[col.name];
      const isMulti = col.type === 'select' || col.type === 'status';

      // Default operators
      let defaultOp: FilterOperator = 'contains';
      if (col.type === 'number') defaultOp = 'equals';
      if (isMulti) defaultOp = 'in'; // not really used but consistency

      this.filterForms[col.name] = new FormGroup({
        operator: new FormControl<FilterOperator>(existing?.value.operator ?? defaultOp),
        value: new FormControl<any>(existing?.value.value ?? (isMulti ? [] : '')),
        min: new FormControl<number | null>(existing?.value.min ?? null),
        max: new FormControl<number | null>(existing?.value.max ?? null),
      });

      if (isMulti) {
        this.selectSearchControls[col.name] = new FormControl('', { nonNullable: true });
      }
    });

    const streams = [
      this.globalSearch.valueChanges.pipe(startWith(this.globalSearch.value)),
      this.dateRange.valueChanges.pipe(startWith(this.dateRange.value)),
      this.dateTargetColumn.valueChanges.pipe(startWith(this.dateTargetColumn.value)),
      ...Object.values(this.filterForms).map(g => g.valueChanges.pipe(startWith(g.value)))
    ];

    // En modo servidor la búsqueda global la resuelve el backend: se avisa al
    // padre en vez de filtrar en cliente (filtrar aquí solo miraría la página
    // actual, así que "buscar" devolvería resultados falsos: los 50 de esta
    // página en vez de los 50.190 del universo).
    if (this.serverSide) {
      this.filterSubs.add(
        this.globalSearch.valueChanges.pipe(debounceTime(400)).subscribe(v => {
          this.searchChange.emit((v ?? '').toString().trim());
        })
      );
    }

    this.filterSubs.add(
      merge(...streams).pipe(debounceTime(120)).subscribe(() => {
        if (!this.serverSide) this.applyFilters();
        this.refreshSticky();
        this.cdr.detectChanges();
      }),
    );

    this.syncPaginatorLength();
    this.refreshSticky();
  }

  private rebuildColumnsAndFilters(): void {
    // Reset filters? Maybe keep if column name matches?
    // User requested persistence, so try to keep.

    // We update the visible columns set based on definitions
    this.visibleColumnNames = new Set((this.columnDefinitions || []).map((c) => c.name));
    if (this.columnDefinitions.some((c) => c.name === 'actions')) this.visibleColumnNames.add('actions');

    this.initializeTable();
    this.applyFilters();
    this.refreshSticky();
    this.cdr.detectChanges();
  }

  private buildColumnCaches(): void {
    this.colByName.clear();
    this.statusConfigByCol.clear();
    this.customConfigByCol.clear();

    (this.columnDefinitions || []).forEach((c) => {
      if (!c?.name) return;
      this.colByName.set(c.name, c);
      if (c.statusConfig) this.statusConfigByCol.set(c.name, c.statusConfig);
      if (c.customClassConfig) this.customConfigByCol.set(c.name, c.customClassConfig);
    });
  }

  private ensureVisibleColumnsInitialized(): void {
    const names = (this.columnDefinitions || []).map((c) => c.name);

    if (this.visibleColumnNames.size === 0) {
      names.forEach((n) => this.visibleColumnNames.add(n));
    } else {
      // Clean up names that no longer exist
      const now = new Set(names);
      [...this.visibleColumnNames].forEach((n) => {
        if (!now.has(n)) this.visibleColumnNames.delete(n);
      });
      // Add new ones (default visible behavior, or check preference?)
      // If we are rebuilding, we might ideally respect user pref.
      names.forEach((n) => {
        if (!this.visibleColumnNames.has(n) && this.colByName.get(n)?.name) {
          // If it's a new column, add it? Or leave hidden? 
          // Behavior: if it wasn't there before, add it.
          this.visibleColumnNames.add(n);
        }
      });
    }

    if (names.includes('actions')) this.visibleColumnNames.add('actions');
  }

  private recomputeVisibleColumns(): void {
    // todasLasColumnas() aplica el orden del usuario y suma las columnas vacías; antes
    // esto filtraba columnDefinitions directamente, así que el orden lo imponía el padre
    // y no había forma de reubicar nada.
    this.visibleColumns = this.todasLasColumnas().filter((c) => this.visibleColumnNames.has(c.name));

    const cols = this.visibleColumns.map((c) => c.name);
    // La columna del número de fila va primero y es el asidero para seleccionar la fila
    // entera, igual que en una hoja de cálculo.
    const previas = [
      ...(this.enableGrid ? ['__indice'] : []),
      ...(this.enableSelection ? ['select'] : []),
    ];
    this.displayedColumns = [...previas, ...cols];

    this.sincronizarTamanoSeleccion();
    this.refreshSticky();
    this.saveState();
  }

  private syncPaginatorLength(): void {
    if (!this.paginator) return;
    const len = this.totalCount ?? (this.dataSource.data?.length ?? 0);
    this.paginator.length = len;
  }

  // =========================
  // Columnas visibles (menu)
  // =========================
  isColumnVisible(name: string): boolean {
    return this.visibleColumnNames.has(name);
  }

  toggleColumn(name: string, checked: boolean): void {
    if (name === 'actions') return;
    if (checked) this.visibleColumnNames.add(name);
    else this.visibleColumnNames.delete(name);

    this.recomputeVisibleColumns();
    this.applyFilters();
    this.refreshSticky();
    this.cdr.detectChanges();
  }

  // Toggle filterability
  isFilterEnabled(name: string): boolean {
    return this.filterEnabledByCol[name] ?? true;
  }

  toggleFilterability(name: string, checked: boolean): void {
    this.filterEnabledByCol[name] = checked;
    this.applyFilters();
    this.saveState();
  }

  // =========================
  // Toolbar helpers
  // =========================
  clearGlobalSearch(): void {
    this.globalSearch.setValue('', { emitEvent: false });
    this.applyFilters();
    this.refreshSticky();
    // this.cdr.detectChanges(); // applyFilters triggers this likely via sync
  }

  hasAnyActiveFilters(): boolean {
    return this.String(this.globalSearch.value ?? '').trim().length > 0 || this.getActiveFilters().length > 0;
  }

  // =========================
  // Filters
  // =========================
  applyFilters(): void {
    const sourceData = this.data || [];

    const globalNeedle = this.String(this.globalSearch.value ?? '').trim().toLowerCase();

    // Dates
    const start: Date | null = this.dateRange.get('start')?.value ?? null;
    const end: Date | null = this.dateRange.get('end')?.value ?? null;
    let inclusiveEnd: Date | null = null;
    if (end) {
      inclusiveEnd = new Date(end);
      inclusiveEnd.setHours(23, 59, 59, 999);
    }
    const dateTarget = this.dateTargetColumn.value; // 'ALL' or colName

    // Active Forms
    const activeColFilters: Array<{
      name: string;
      op: FilterOperator;
      val: any;
      min: number | null;
      max: number | null;
      isStatus: boolean;
      colType: string;
    }> = [];

    for (const col of this.columnDefinitions) {
      if (col.filterable === false) continue;
      if (!this.filterEnabledByCol[col.name]) continue; // User disabled
      if (col.type === 'date') continue; // Handled separate

      const form = this.filterForms[col.name];
      if (!form) continue;

      const { operator, value, min, max } = form.value;
      const op = operator ?? 'contains';

      // Check if filter is active
      let isActive = false;

      if (col.type === 'text') {
        if (typeof value === 'string' && value.trim() !== '') isActive = true;
      } else if (col.type === 'number') {
        if (operator === 'range') {
          if (min !== null || max !== null) isActive = true;
        } else {
          if (value !== null && value !== '' && value !== undefined) isActive = true;
        }
      } else if (col.type === 'select' || col.type === 'status') {
        if (Array.isArray(value) && value.length > 0) isActive = true;
      }

      if (isActive) {
        activeColFilters.push({
          name: col.name,
          op: operator,
          val: value,
          min: min ?? null,
          max: max ?? null,
          isStatus: col.type === 'status',
          colType: col.type,
        });
      }
    }

    const hasDateFilter = !!(start || end);
    // Determine which columns to check for date
    const dateColsToCheck = this.columnDefinitions.filter(c => c.type === 'date' && c.filterable !== false);

    const hasAnyFilter = !!globalNeedle || activeColFilters.length > 0 || hasDateFilter;

    if (!hasAnyFilter) {
      this.dataSource.data = sourceData.slice();
      this.syncPaginatorLength();
      this.pruneSelection();
      this.refreshSticky();
      return;
    }

    const searchCols = this.visibleColumns.filter((c) => !['actions', 'attachment', 'semaforo'].includes(c.name));
    const out: any[] = [];

    for (let i = 0; i < sourceData.length; i++) {
      const item = sourceData[i];
      let ok = true;

      // 1. Global Search
      if (globalNeedle) {
        let hit = false;
        for (const c of searchCols) {
          const raw = item?.[c.name];
          let v: string;
          if (c.type === 'status') v = this.getStatusLabel(c.name, raw);
          else if (c.type === 'date') {
            const d = raw instanceof Date ? raw : raw ? new Date(raw) : null;
            v = d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-CO') : '';
          } else {
            v = (raw ?? '').toString();
          }
          if (v.toLowerCase().includes(globalNeedle)) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          ok = false;
        }
      }

      if (!ok) continue;

      // 2. Column Filters
      for (const f of activeColFilters) {
        const raw = item?.[f.name];

        // Select/Status
        if (f.colType === 'select' || f.colType === 'status') {
          // Usually strict match for options. Multi-select acts as OR/IN
          const set = new Set(f.val as any[]);
          let vToCheck = raw;
          if (f.isStatus) vToCheck = this.getStatusLabel(f.name, raw);

          if (!set.has(vToCheck)) {
            ok = false;
            break;
          }
          continue;
        }

        // Number
        if (f.colType === 'number') {
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (isNaN(n)) {
            ok = false;
            break;
          }

          if (f.op === 'range') {
            if (f.min !== null && n < f.min) { ok = false; break; }
            if (f.max !== null && n > f.max) { ok = false; break; }
          } else if (f.op === 'equals') {
            if (n !== Number(f.val)) { ok = false; break; }
          } else if (f.op === 'gte') {
            if (n < Number(f.val)) { ok = false; break; }
          } else if (f.op === 'lte') {
            if (n > Number(f.val)) { ok = false; break; }
          }
          continue;
        }

        // Text
        const s = (raw ?? '').toString().toLowerCase();
        const needle = (f.val ?? '').toString().toLowerCase();

        if (f.op === 'equals') {
          if (s !== needle) { ok = false; break; }
        } else if (f.op === 'startsWith') {
          if (!s.startsWith(needle)) { ok = false; break; }
        } else {
          // Default contains
          if (!s.includes(needle)) { ok = false; break; }
        }
      }

      if (!ok) continue;

      // 3. Date Range
      if (hasDateFilter && dateColsToCheck.length > 0) {
        // Rule: 
        // If dateTarget === 'ALL', then ANY date column match (OR logic? or AND? usually checks against relevant dates)
        // "Todas las fechas" implies filtering records where the dates fall in range.
        // If I choose 1 col, check that col.

        const relevantCols = dateTarget === 'ALL'
          ? dateColsToCheck
          : dateColsToCheck.filter(c => c.name === dateTarget);

        // Implementation detail: If ALL, should it be:
        // A) Record is valid if ALL date columns are in range? (Restrictive)
        // B) Record is valid if AT LEAST ONE date column is in range? (Permissive)
        // C) Record is valid if data within specific columns are in range. Typically "Date Range" filters by "Created Date" or similar.
        // Let's assume ALL targeted columns must be satisfied? Or just one?
        // Usually strict filter: if I say "Date between X and Y", I want records where that date is X-Y.
        // If I select "All dates", it's ambiguous. But let's assume valid: 
        // Check each relevant column. If a column has a value, it MUST be in range.

        for (const col of relevantCols) {
          const raw = item?.[col.name];
          const d: Date | null = raw instanceof Date ? raw : raw ? new Date(raw) : null;

          if (!d || isNaN(d.getTime())) {
            // If date is missing/invalid, strict filter excludes it? Or ignores?
            // Usually standard table excludes rows with null date if filtering by date.
            ok = false;
            break;
          }
          if (start && d < start) { ok = false; break; }
          if (inclusiveEnd && d > inclusiveEnd) { ok = false; break; }
        }
      }

      if (ok) out.push(item);
    }

    this.dataSource.data = out;
    this.syncPaginatorLength();

    if (this.paginator && this.paginator.pageIndex !== 0) {
      this.paginator.firstPage();
    }

    this.pruneSelection();
    this.refreshSticky();
  }

  clearFilters(): void {
    Object.values(this.filterForms).forEach((fg) => {
      // Reset values but keep operators? Or reset everything?
      // Resetting values is safer.
      fg.patchValue({
        value: Array.isArray(fg.value.value) ? [] : '',
        min: null,
        max: null
      }, { emitEvent: false });
    });

    this.globalSearch.setValue('', { emitEvent: false });
    this.dateRange.reset({ start: null, end: null }, { emitEvent: false });
    this.dateTargetColumn.setValue('ALL', { emitEvent: false });

    this.applyFilters();
  }

  clearSingleFilter(name: string): void {
    if (name === '__dateRange__') {
      this.dateRange.reset();
      return;
    }

    const fg = this.filterForms[name];
    if (fg) {
      fg.patchValue({ value: Array.isArray(fg.value.value) ? [] : '', min: null, max: null });
    }
  }

  getActiveFilters(): ActiveFilter[] {
    const filters: ActiveFilter[] = [];

    // global date range
    const start = this.dateRange.get('start')?.value;
    const end = this.dateRange.get('end')?.value;
    if (start || end) {
      filters.push({
        name: '__dateRange__',
        header: 'Fecha (' + (this.dateTargetColumn.value === 'ALL' ? 'Todas' : this.colByName.get(this.dateTargetColumn.value)?.header) + ')',
        type: 'date',
        value: { from: start, to: end },
        operator: 'range'
      });
    }

    Object.keys(this.filterForms).forEach((colName) => {
      const col = this.colByName.get(colName);
      if (!col || !this.filterEnabledByCol[colName]) return;

      const form = this.filterForms[colName];
      if (!form) return;

      const { value, min, max, operator } = form.value;
      const colType = col.type;

      let hasVal = false;
      let displayVal = value;

      if (colType === 'number') {
        if (operator === 'range') {
          if (min !== null || max !== null) {
            hasVal = true;
            displayVal = `${min ?? '...'} - ${max ?? '...'}`;
          }
        } else {
          if (value !== null && value !== '' && value !== undefined) hasVal = true;
        }
      } else if (colType === 'select' || colType === 'status') {
        if (Array.isArray(value) && value.length > 0) hasVal = true;
      } else {
        if (typeof value === 'string' && value.trim().length > 0) hasVal = true;
      }

      if (hasVal) {
        filters.push({
          name: colName,
          header: col.header,
          type: col.type,
          value: displayVal,
          operator: operator
        });
      }
    });

    return filters;
  }

  toggleFilters(): void {
    // Mobile toggle
    this.toggleDrawer();
  }

  // =========================
  // status/custom
  // =========================
  private getStatusConfig(columnName: string): Record<string, StatusStyle> {
    return this.statusConfigByCol.get(columnName) || {};
  }

  private getCustomClassConfig(columnName: string): Record<string, StatusStyle> {
    return this.customConfigByCol.get(columnName) || {};
  }

  getStatusStyles(columnName: string, value: any): { color?: string; background?: string } {
    const config = this.getStatusConfig(columnName);
    return config?.[value] || {};
  }

  getCustomStyles(columnName: string, value: any): { color?: string; background?: string } {
    const config = this.getCustomClassConfig(columnName);
    return config?.[value] || {};
  }

  getStatusLabel(_columnName: string, value: any): string {
    if (value === true || value === 'true' || value === 1 || value === '1') return 'Activo';
    if (value === false || value === 'false' || value === 0 || value === '0') return 'Inactivo';
    if (value === null || value === undefined || value === '') return '-';
    return String(value);
  }

  isSortable(col: ColumnDefinition): boolean {
    if (col.sortable === false) return false;
    if (col.name === 'actions' || col.name === 'attachment') return false;
    return true;
  }

  // =========================
  // export
  // =========================
  exportTable(format: 'pdf' | 'xml' | 'excel'): void {
    switch (format) {
      case 'pdf':
        if (this.customPdfExport) this.customPdfExport();
        else {
          Swal.fire({
            icon: 'info',
            title: 'Funcionalidad no disponible',
            text: 'La exportación a PDF aún no está implementada.',
            timer: 2500,
            showConfirmButton: false,
          });
        }
        break;

      case 'xml':
        Swal.fire({
          icon: 'info',
          title: 'Funcionalidad no disponible',
          text: 'La exportación a XML aún no está implementada.',
          timer: 2500,
          showConfirmButton: false,
        });
        break;

      case 'excel':
        this.exportToExcel();
        break;
    }
  }

  /** Columnas que no llevan dato exportable (botones y adornos de la fila). */
  private static readonly COLUMNAS_SIN_DATO = ['actions', 'attachment', 'semaforo'];

  /**
   * Excel de LO QUE SE VE: las columnas VISIBLES, con su encabezado y en el orden en
   * pantalla, y cada celda con el mismo texto que pinta la tabla.
   *
   * Antes se volcaba `json_to_sheet(filas)` crudo, así que la hoja salía con la CLAVE
   * INTERNA del objeto como título —«c_sec_1__nombre_completo», «_s»— en vez de la
   * pregunta, y arrastraba campos que ni siquiera están en la tabla. Números y fechas
   * viajan como número y fecha (no como texto) para que la hoja se pueda ordenar y sumar.
   */
  private exportToExcel(): void {
    const cols = this.visibleColumns.filter(
      (c) => !StandardFilterTable.COLUMNAS_SIN_DATO.includes(c.name),
    );
    const filas = this.filasParaExportar();

    if (!cols.length || !filas.length) {
      Swal.fire({
        icon: 'info',
        title: 'Nada que exportar',
        text: 'No hay filas visibles con los filtros aplicados.',
        timer: 2500,
        showConfirmButton: false,
      });
      return;
    }

    const aoa: (string | number | Date)[][] = [cols.map((c) => c.header ?? c.name)];
    for (const fila of filas) aoa.push(cols.map((c) => this.celdaParaExcel(fila, c)));

    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(aoa);
    this.aplicarFormatosExcel(ws, cols, filas.length);
    ws['!cols'] = cols.map((c, i) => ({ wch: this.anchoColumnaExcel(aoa, i, c) }));

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    XLSX.writeFile(wb, this.nombreArchivoExcel());
  }

  /**
   * Lo filtrado ENTERO (no solo la página a la vista) y en el orden que impone el
   * encabezado, que es lo que espera quien exporta después de filtrar y ordenar.
   * Si el filtro no deja nada, no quedan filas: antes se caía al `data` original y la
   * hoja salía con TODO, justo lo contrario de lo que se pidió.
   */
  private filasParaExportar(): any[] {
    const base = this.dataSource.filteredData ?? this.dataSource.data ?? this.data ?? [];
    const sort = this.dataSource.sort;
    return sort?.active ? this.dataSource.sortData(base.slice(), sort) : base;
  }

  /** Valor de una celda para la hoja: número, fecha o el texto tal como se ve. */
  private celdaParaExcel(row: any, col: ColumnDefinition): string | number | Date {
    const crudo = row?.[col.name];
    const vacio = crudo === null || crudo === undefined || crudo === '';

    if (col.type === 'number' && !vacio) {
      const n = typeof crudo === 'number' ? crudo : Number(crudo);
      if (Number.isFinite(n)) return n;
    }
    if (col.type === 'date' && !vacio) {
      const d = crudo instanceof Date ? crudo : new Date(crudo);
      if (!isNaN(d.getTime())) return d;
    }
    return this.textoCelda(row, col);
  }

  /** Pinta cada columna con el formato de Excel equivalente al de la pantalla. */
  private aplicarFormatosExcel(ws: XLSX.WorkSheet, cols: ColumnDefinition[], filas: number): void {
    for (let c = 0; c < cols.length; c++) {
      const z = this.formatoExcel(cols[c]);
      if (!z) continue;
      for (let r = 1; r <= filas; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && (cell.t === 'n' || cell.t === 'd')) cell.z = z;
      }
    }
  }

  /** Formato de celda de Excel para la columna, o null si es texto plano. */
  private formatoExcel(col: ColumnDefinition): string | null {
    // El patrón del DatePipe sirve tal cual en minúsculas: 'dd/MM/yyyy HH:mm' → 'dd/mm/yyyy hh:mm'
    // (en Excel los 'mm' que siguen a 'hh' son minutos, igual que allá).
    if (col.type === 'date') return (col.dateFormat ?? 'dd/MM/yyyy').toLowerCase();
    if (col.type !== 'number') return null;
    switch (col.format) {
      case 'currency':
        return '"$"#,##0';
      case 'percent':
        return '#,##0.## "%"';
      default:
        return null;
    }
  }

  /** Ancho de columna a ojo, mirando el encabezado y las primeras filas. */
  private anchoColumnaExcel(aoa: (string | number | Date)[][], col: number, def: ColumnDefinition): number {
    let max = String(def.header ?? def.name).length;
    for (let r = 1; r < aoa.length && r <= 200; r++) {
      const v = aoa[r][col];
      const largo = v instanceof Date ? 16 : String(v ?? '').length;
      if (largo > max) max = largo;
    }
    return Math.min(60, Math.max(10, max + 2));
  }

  /** «Respuestas · Encuesta 2026-08-19.xlsx» en vez del anónimo «export.xlsx». */
  private nombreArchivoExcel(): string {
    const base = (this.tableTitle || 'Tabla').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60);
    return `${base || 'Tabla'} ${formatDate(new Date(), 'yyyy-MM-dd', 'es-CO')}.xlsx`;
  }

  // =========================
  // Selection
  // =========================
  isAllSelected(): boolean {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected()
      ? this.selection.clear()
      : this.dataSource.data.forEach((row) => this.selection.select(row));
  }

  toggleRow(row: any): void {
    this.selection.toggle(row);
  }

  private pruneSelection(): void {
    // Si la data cambió, quitar de selection los que ya no existen?
    // O mantenerlos? Usually keep unless we re-fetch.
    // Here we just keep standard selection behavior.
  }

  getPagedData(): any[] {
    // Helper for cards view to respect pagination
    if (!this.paginator) return this.dataSource.data;
    const startIndex = this.paginator.pageIndex * this.paginator.pageSize;
    return this.dataSource.data.slice(startIndex, startIndex + this.paginator.pageSize);
  }

  // =========================
  // Persistence
  // =========================
  private saveState(): void {
    if (!this.storageKey) return;
    if (!isPlatformBrowser(this.platformId)) return;

    const state = {
      visibleColumnNames: Array.from(this.visibleColumnNames),
      filterEnabledByCol: this.filterEnabledByCol,
      viewMode: this.viewMode,
      density: this.density,
      // El orden y las columnas vacías también se guardan en local: es la disposición
      // "de trabajo" del usuario en ESTE equipo. Las plantillas del servidor son otra
      // cosa —disposiciones con nombre, y compartibles— y no se pisan entre sí.
      columnOrder: this.columnOrder,
      emptyColumns: this.emptyColumns.map(c => ({ name: c.name, header: c.header, width: c.width })),
    };

    try {
      setLocalStorageItem(this.storageKey, JSON.stringify(state));
    } catch (e) {
      console.error('Error saving table state', e);
    }
  }

  private loadState(): void {
    if (!this.storageKey) return;
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const raw = getLocalStorageItem(this.storageKey);
      if (!raw) return;
      const state = JSON.parse(raw);

      if (state.visibleColumnNames) {
        this.visibleColumnNames = new Set(state.visibleColumnNames);
      }
      if (state.filterEnabledByCol) {
        this.filterEnabledByCol = state.filterEnabledByCol;
      }
      if (state.viewMode) this.viewMode = state.viewMode;
      if (state.density) this.density = state.density;

      if (Array.isArray(state.emptyColumns)) {
        this.emptyColumns = state.emptyColumns
          .filter((c: any) => c && typeof c.name === 'string' && this.esColumnaVacia(c.name))
          .map((c: any) => ({
            name: c.name, header: c.header || 'Nueva columna', type: 'text',
            width: c.width || '160px', filterable: false, sortable: false,
          } as ColumnDefinition));
        // El contador se reanuda por encima del mayor sufijo guardado, o dos columnas
        // creadas en sesiones distintas chocarían de nombre.
        this.emptySeq = this.emptyColumns.reduce((max, c) => {
          const n = parseInt(c.name.slice(StandardFilterTable.PREFIJO_VACIA.length), 10);
          return isNaN(n) ? max : Math.max(max, n);
        }, 0);
      }

      if (Array.isArray(state.columnOrder)) {
        this.columnOrder = state.columnOrder.filter((n: any) => typeof n === 'string');
      }

    } catch (e) {
      console.error('Error loading table state', e);
    }
  }

  // Get date cols for dropdown
  getDateColumns(): ColumnDefinition[] {
    return this.columnDefinitions?.filter(c => c.type === 'date') || [];
  }

  /**
   * Presentación de la celda. Sin esto una columna `type:'number'` pintaba el
   * valor crudo: 1300000 en vez de $1.300.000, o 12.5 en vez de 12,5 %.
   *
   * Se formatea SOLO si la columna declara `format`, así que las 22 páginas que
   * usan esta tabla siguen viendo exactamente lo mismo hasta que lo pidan.
   *
   * Se fuerza es-CO en vez de heredar LOCALE_ID: main.ts registra el locale
   * es-CO pero nunca lo provee, así que los pipes de la app caen en en-US y
   * pintarían $1,300,000 (formato gringo) en una app colombiana.
   */
  formatCell(value: any, col: ColumnDefinition): string {
    // Sin `format` se replica EXACTAMENTE lo de antes (`row[col.name] ?? '-'`).
    // Ojo: `??` no atrapa cadena vacía ni 0, y así debe seguir siendo — hay 49
    // columnas numéricas en la app que dependen de este comportamiento.
    if (!col.format) return String(value ?? '-');

    if (value === null || value === undefined || value === '') return '-';

    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n)) return String(value);

    switch (col.format) {
      case 'currency':
        return formatCurrency(n, 'es-CO', '$', 'COP', '1.0-0');
      case 'percent':
        // No se usa el pipe percent: multiplicaría por 100 y aquí el valor ya
        // viene como porcentaje (12.5 significa 12,5 %).
        return `${formatNumber(n, 'es-CO', '1.0-2')} %`;
      case 'decimal':
        return formatNumber(n, 'es-CO', '1.0-2');
      default:
        return String(value);
    }
  }
}

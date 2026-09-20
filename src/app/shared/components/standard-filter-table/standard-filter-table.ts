import { SelectionModel } from '@angular/cdk/collections';
import { NgTemplateOutlet, formatCurrency, formatDate, formatNumber } from '@angular/common';
import {
  AfterContentInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ContentChild,
  ContentChildren,
  DoCheck,
  EventEmitter,
  Input,
  IterableDiffer,
  IterableDiffers,
  OnChanges,
  Output,
  QueryList,
  TemplateRef,
  inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { Sort } from '@angular/material/sort';

import { ColumnDefinition } from '../../models/advanced-table-interface';
import { ColumnCellTemplateDirective } from '../../directives/column-cell-template.directive';
import {
  BadgeCelda,
  ColumnaTabla,
  OrdenTabla,
  TablaAccionesDirective,
  TablaCeldaDirective,
  TablaEncabezadoDirective,
  TablaEstandarComponent,
  TonoBadge,
} from '../tabla-estandar';

type StatusStyle = { color: string; background: string };

interface PlantillaColumna {
  columna: string;
  tpl: TemplateRef<unknown>;
  def: ColumnDefinition;
}

const COLUMNAS_SIN_DATO = new Set(['actions', 'attachment', 'semaforo']);

/**
 * `<app-standard-filter-table>` convertido en ADAPTADOR de la tabla estándar
 * (`<app-tabla-estandar>`).
 *
 * Las ~27 pantallas que ya lo usan siguen igual por fuera: mismas entradas,
 * salidas y plantillas (`#actionsTemplate`, `#estadoTemplate`,
 * `appCellTemplate`…). Por dentro, cada `ColumnDefinition` se traduce a una
 * `ColumnaTabla` y se pinta con la tabla estándar, así todas comparten la
 * misma barra, filtros por columna, vista de tarjetas, copiado y Excel.
 *
 * Lo que cambia para quien la usa: el detalle de la fila (`enableRowClick`)
 * se abre con el botón «Ver» o con doble clic, porque el clic simple ahora
 * selecciona celdas como en una hoja de cálculo; y la columna de acciones va
 * al inicio de la fila.
 */
@Component({
  selector: 'app-standard-filter-table',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    MatIconModule,
    TablaEstandarComponent,
    TablaAccionesDirective,
    TablaCeldaDirective,
    TablaEncabezadoDirective,
  ],
  changeDetection: ChangeDetectionStrategy.Default,
  templateUrl: './standard-filter-table.html',
  styleUrls: ['./standard-filter-table.css'],
})
export class StandardFilterTable implements OnChanges, DoCheck, AfterContentInit {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly dataDiffer: IterableDiffer<any>;
  private readonly colsDiffer: IterableDiffer<ColumnDefinition>;

  // ── Plantillas proyectadas (mismos nombres que antes) ───────────────────────
  @ContentChild('actionsTemplate') actionsTemplate?: TemplateRef<unknown>;
  @ContentChild('attachmentTemplate') attachmentTemplate?: TemplateRef<unknown>;
  @ContentChild('semaforoTemplate') semaforoTemplate?: TemplateRef<unknown>;
  @ContentChild('estadoTemplate') estadoTemplate?: TemplateRef<{ $implicit: any; col?: ColumnDefinition }>;
  @ContentChild('headerActionTemplate') headerActionTemplate?: TemplateRef<{ $implicit: ColumnDefinition }>;
  @ContentChildren(ColumnCellTemplateDirective) cellTemplatesQuery!: QueryList<ColumnCellTemplateDirective>;

  // ── Entradas (compatibles) ──────────────────────────────────────────────────
  @Input() data: any[] = [];
  @Input() columnDefinitions: ColumnDefinition[] = [];
  /** Solo en modo servidor: en cliente manda el paginador estándar (25/50/100/250/Todas). */
  @Input() pageSizeOptions: number[] = [10, 20, 50];
  @Input() defaultPageSize = 10;
  @Input() tableTitle = 'Tabla de datos';
  @Input() totalCount: number | null = null;
  @Input() isLoading = false;
  @Input() enableRowClick = false;
  @Input() enableSelection = false;
  /** Clave de las preferencias (vista tabla/tarjetas) de esta pantalla. */
  @Input() storageKey?: string;
  /**
   * Modo servidor: `data` ya es la página pedida, `totalCount` el total, y la
   * pantalla consulta al backend con (pageChange)/(searchChange)/(sortChange).
   */
  @Input() serverSide = false;
  /** Se conservan para no romper plantillas que aún los pasan; ya no se usan. */
  @Input() customPdfExport?: () => void;
  @Input() createRoute?: string[] | null;
  @Input() useSwalLoading = false;

  @Output() rowClicked = new EventEmitter<any>();
  @Output() pageChange = new EventEmitter<{ page: number; size: number }>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() sortChange = new EventEmitter<{ active: string; direction: 'asc' | 'desc' | '' }>();

  /** Filas marcadas con casilla (`enableSelection`). Público: lo leen las pantallas. */
  readonly selection = new SelectionModel<any>(true, []);

  /**
   * Orden actual con la forma de `MatSort` (`active`, `direction`, `sortChange`),
   * que es lo que algunas pantallas leían de la tabla anterior para reordenar
   * en el servidor.
   */
  readonly sort = {
    active: '',
    direction: '' as 'asc' | 'desc' | '',
    sortChange: new EventEmitter<Sort>(),
  };

  // ── Estado derivado ─────────────────────────────────────────────────────────
  datosVista: any[] = [];
  columnas: ColumnaTabla<any>[] = [];
  plantillas: PlantillaColumna[] = [];
  columnasConEncabezado: ColumnDefinition[] = [];
  hayColumnaAcciones = false;

  private statusConfigByCol = new Map<string, Record<string, StatusStyle>>();
  private customConfigByCol = new Map<string, Record<string, StatusStyle>>();

  constructor(differs: IterableDiffers) {
    this.dataDiffer = differs.find([]).create();
    this.colsDiffer = differs.find([]).create();
  }

  ngOnChanges(): void {
    this.reconstruir();
  }

  /** Detecta arrays mutados en sitio (push/splice) sin cambio de referencia, como antes. */
  ngDoCheck(): void {
    let cambio = false;
    if (this.dataDiffer.diff(this.data || [])) {
      this.datosVista = [...(this.data || [])];
      cambio = true;
    }
    if (this.colsDiffer.diff(this.columnDefinitions || [])) {
      this.construirColumnas();
      cambio = true;
    }
    if (cambio) this.cdr.markForCheck();
  }

  ngAfterContentInit(): void {
    this.construirColumnas();
    this.cellTemplatesQuery.changes.subscribe(() => {
      this.construirColumnas();
      this.cdr.markForCheck();
    });
  }

  get idTabla(): string {
    if (this.storageKey) return this.storageKey;
    const base = (this.tableTitle || 'tabla').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return 'sft-' + base.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  /** El título se pinta solo si la pantalla puso uno propio. */
  get mostrarTitulo(): boolean {
    return !!this.tableTitle && this.tableTitle !== 'Tabla de datos';
  }

  get porPagina(): number {
    return this.serverSide ? this.defaultPageSize || 25 : 50;
  }

  private reconstruir(): void {
    this.datosVista = [...(this.data || [])];
    this.construirColumnas();
  }

  // ── Traducción ColumnDefinition → ColumnaTabla ──────────────────────────────
  private construirColumnas(): void {
    const defs = this.columnDefinitions || [];
    this.statusConfigByCol.clear();
    this.customConfigByCol.clear();
    for (const c of defs) {
      if (c.statusConfig) this.statusConfigByCol.set(c.name, c.statusConfig);
      if (c.customClassConfig) this.customConfigByCol.set(c.name, c.customClassConfig);
    }

    const custom = new Map<string, TemplateRef<unknown>>();
    this.cellTemplatesQuery?.forEach((d) => custom.set(d.column, d.template));

    this.hayColumnaAcciones = defs.some((c) => c.name === 'actions');
    this.plantillas = [];
    this.columnas = [];

    for (const def of defs) {
      if (def.name === 'actions') continue;
      const tpl = this.plantillaDe(def, custom);
      if (tpl) this.plantillas.push({ columna: def.name, tpl, def });
      else if (def.name === 'attachment' || def.name === 'semaforo') continue; // sin plantilla no pintan nada
      this.columnas.push(this.aColumna(def, !!tpl));
    }
    this.asignarRolesDeTarjeta();
    this.columnasConEncabezado = this.headerActionTemplate ? defs.filter((d) => d.name !== 'actions') : [];
  }

  /**
   * En móvil la tabla se pinta como tarjetas. Sin roles declarados saldría de
   * título la primera columna, que muchas veces es una foto o un estado; aquí
   * se elige algo que identifique la fila: un nombre de título, un documento,
   * código o correo de subtítulo, los estados como chip y el resto en líneas.
   */
  private asignarRolesDeTarjeta(): void {
    const defs = new Map((this.columnDefinitions || []).map((d) => [d.name, d]));
    const esTexto = (c: ColumnaTabla<any>) => {
      const t = defs.get(c.id)?.type;
      return t === 'text' || t === 'number' || t === 'select' || t === 'date' || t === undefined;
    };
    const buscar = (rx: RegExp, usadas: Set<string>) =>
      this.columnas.find((c) => !usadas.has(c.id) && esTexto(c) && (rx.test(c.id) || rx.test(c.header.toLowerCase())));
    const usadas = new Set<string>();
    for (const c of this.columnas) {
      const t = defs.get(c.id)?.type;
      if (/^(foto|avatar|imagen)/i.test(c.id)) { c.tarjeta = 'oculto'; usadas.add(c.id); }
      else if (t === 'status' || c.id === 'estado') { c.tarjeta = 'badge'; usadas.add(c.id); }
    }
    const titulo = buscar(/nombre|name|titulo|raz[oó]n|descripci|empresa|asunto/i, usadas)
      ?? this.columnas.find((c) => !usadas.has(c.id) && esTexto(c));
    if (titulo) { titulo.tarjeta = 'titulo'; usadas.add(titulo.id); }
    const subtitulo = buscar(/c[eé]dula|documento|identificaci|c[oó]digo|correo|email|nit\b|placa/i, usadas)
      ?? this.columnas.find((c) => !usadas.has(c.id) && esTexto(c));
    if (subtitulo) { subtitulo.tarjeta = 'subtitulo'; usadas.add(subtitulo.id); }
    for (const c of this.columnas) if (!usadas.has(c.id)) c.tarjeta = 'cuerpo';
  }

  private plantillaDe(def: ColumnDefinition, custom: Map<string, TemplateRef<unknown>>): TemplateRef<unknown> | null {
    if (def.name === 'attachment' && this.attachmentTemplate) return this.attachmentTemplate;
    if (def.name === 'semaforo' && this.semaforoTemplate) return this.semaforoTemplate;
    if ((def.name === 'estado' || def.name.startsWith('type_')) && this.estadoTemplate) return this.estadoTemplate as TemplateRef<unknown>;
    return custom.get(def.name) ?? null;
  }

  private aColumna(def: ColumnDefinition, conPlantilla: boolean): ColumnaTabla<any> {
    const nombre = def.name;
    const esPdf = nombre.startsWith('PDF_');
    return {
      id: nombre,
      header: def.header,
      valor: (row) => this.valorPlano(row?.[nombre], def),
      formato: (row) => this.formatear(row?.[nombre], def),
      badge: conPlantilla || esPdf ? undefined : (row) => this.badge(row?.[nombre], def),
      align: def.align ?? (def.type === 'number' ? 'right' : undefined),
      ancho: def.width,
      minAncho: def.width,
      ordenable: def.sortable !== false && !COLUMNAS_SIN_DATO.has(nombre),
      filtrable: def.filterable !== false && !COLUMNAS_SIN_DATO.has(nombre),
      // Una plantilla puede traer controles (inputs, botones): que el clic sea suyo.
      interactiva: conPlantilla || esPdf,
      copiable: !COLUMNAS_SIN_DATO.has(nombre) && !esPdf,
    };
  }

  /** Valor plano para buscar, filtrar, ordenar y copiar. */
  private valorPlano(v: any, def: ColumnDefinition): any {
    if (v === null || v === undefined) return v;
    if (def.type === 'date') {
      const d = v instanceof Date ? v : new Date(v);
      return isNaN(d.getTime()) ? String(v) : d;
    }
    if (def.type === 'number' && typeof v !== 'number') {
      const n = Number(String(v).replace(',', '.'));
      return v !== '' && Number.isFinite(n) ? n : v;
    }
    if (def.type === 'status' && typeof v !== 'string') return this.etiquetaEstado(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }

  /**
   * Presentación: se conserva lo de la tabla anterior (fecha dd/MM/yyyy, número
   * crudo salvo que la columna declare `format`, '-' cuando no hay dato).
   */
  private formatear(v: any, def: ColumnDefinition): string {
    if (def.type === 'date') {
      if (v === null || v === undefined || v === '') return '-';
      try {
        return formatDate(v, def.dateFormat || 'dd/MM/yyyy', 'es-CO');
      } catch {
        return String(v);
      }
    }
    if (def.type === 'status') return this.etiquetaEstado(v);
    if (def.type === 'number' && def.format) {
      if (v === null || v === undefined || v === '') return '-';
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) return String(v);
      switch (def.format) {
        case 'currency':
          return formatCurrency(n, 'es-CO', '$', 'COP', '1.0-0');
        case 'percent':
          return `${formatNumber(n, 'es-CO', '1.0-2')} %`;
        case 'decimal':
          return formatNumber(n, 'es-CO', '1.0-2');
      }
    }
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
    return String(v ?? '-');
  }

  private etiquetaEstado(v: any): string {
    if (v === true || v === 'true' || v === 1 || v === '1') return 'Activo';
    if (v === false || v === 'false' || v === 0 || v === '0') return 'Inactivo';
    if (v === null || v === undefined || v === '') return '-';
    return String(v);
  }

  /** Estados y `custom` salen como chip. El color configurado se traduce a un
   *  tono del tema para que el chip también se lea en modo oscuro. */
  private badge(v: any, def: ColumnDefinition): BadgeCelda | null {
    if (def.type !== 'status' && def.type !== 'custom') return null;
    const texto = def.type === 'status' ? this.etiquetaEstado(v) : String(v ?? '-');
    if (texto === '-' || texto === '') return null;
    const config = (def.type === 'status' ? this.statusConfigByCol : this.customConfigByCol).get(def.name);
    const estilo = config?.[v as string] ?? config?.[texto];
    let tono: TonoBadge = 'neutro';
    // El color del texto es el que lleva el matiz; el fondo suele ser un pastel casi gris.
    if (estilo) tono = tonoDeColor(estilo.color) !== 'neutro' ? tonoDeColor(estilo.color) : tonoDeColor(estilo.background);
    else if (def.type === 'status' && texto === 'Activo') tono = 'ok';
    else if (def.type === 'status' && texto === 'Inactivo') tono = 'danger';
    return { texto, tono };
  }

  // ── Eventos ─────────────────────────────────────────────────────────────────
  onFila(row: any): void {
    this.rowClicked.emit(row);
  }

  onPagina(e: { pagina: number; porPagina: number }): void {
    this.pageChange.emit({ page: e.pagina, size: e.porPagina });
  }

  onOrden(o: OrdenTabla | null): void {
    this.sort.active = o?.columna ?? '';
    this.sort.direction = o?.direccion ?? '';
    this.sort.sortChange.emit({ active: this.sort.active, direction: this.sort.direction });
    if (this.serverSide) this.sortChange.emit({ active: this.sort.active, direction: this.sort.direction });
  }
}

/** Tono del tema más cercano a un color configurado (por su matiz). */
function tonoDeColor(color: string | undefined): TonoBadge {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec((color || '').trim());
  if (!m) return 'neutro';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return 'neutro';
  let hue = 0;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return 'danger';
  if (hue < 60) return 'warn';
  if (hue < 175) return 'ok';
  if (hue < 250) return 'info';
  return 'violet';
}

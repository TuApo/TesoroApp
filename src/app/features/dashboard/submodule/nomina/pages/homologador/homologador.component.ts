import { AfterViewInit, ChangeDetectorRef, Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  Client,
  ConceptoNomina,
  HomologadorExterno,
  EstadoHomologacion,
  NominaService,
} from '../../service/nomina/nomina.service';
import { HomologadorFormDialogComponent } from './homologador-form-dialog.component';

interface HomologadorCatalogRow extends HomologadorExterno {
  concepto_unidad?: string;
  concepto_activo: boolean;
  tiene_homologacion: boolean;
  /** Total de mapeos externos que comparten este concepto interno (>1 => la fila
   *  es colapsable y despliega todos los mapeos al hacer clic). */
  mapeos_grupo: number;
  /** Todas las homologaciones (mapeos externos) del concepto interno. El principal
   *  es mapeos[0] y es el que resume la fila; el panel colapsable lista todos. */
  mapeos: HomologadorExterno[];
  /** Clave estable para rastrear el estado expandido/colapsado entre reordenamientos. */
  clave: string;
}

@Component({
  selector: 'app-homologador',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatSortModule,
    MatSlideToggleModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './homologador.component.html',
  styleUrls: ['./homologador.component.css'],
})
export class HomologadorComponent implements OnInit, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  displayedColumns = [
    'concepto_codigo',
    'concepto_descripcion',
    'codigo_externo',
    'concepto_externo',
    'clasificacion_externa',
    'estado_homologacion',
    'activo',
    'acciones',
  ];
  dataSource = new MatTableDataSource<HomologadorCatalogRow>([]);
  isLoading = false;

  clientes: Client[] = [];
  clienteControl = new FormControl<string | Client>('');
  filteredClientes$!: Observable<Client[]>;
  selectedCliente: Client | null = null;

  conceptos: ConceptoNomina[] = [];
  conceptoControl = new FormControl<string | ConceptoNomina>('');
  filteredConceptos$!: Observable<ConceptoNomina[]>;
  selectedConcepto: ConceptoNomina | null = null;

  homologacionesEmpresa: HomologadorExterno[] = [];
  catalogoConceptos: HomologadorCatalogRow[] = [];

  filterEstado = '';
  filterActivo = '';
  filterSearch = '';

  readonly ESTADO_LABELS: Record<string, { label: string; color: string; icon: string }> = {
    HOMOLOGADO: { label: 'Homologado', color: 'estado-ok', icon: 'check_circle' },
    HOMOLOGADO_CON_OBSERVACION: { label: 'Con observacion', color: 'estado-warn', icon: 'info' },
    REVISAR: { label: 'Revisar', color: 'estado-review', icon: 'rate_review' },
    SIN_HOMOLOGACION: { label: 'Sin homologacion', color: 'estado-none', icon: 'help_outline' },
  };

  constructor(
    private nominaService: NominaService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargarClientes();
    this.cargarConceptos();

    this.filteredClientes$ = this.clienteControl.valueChanges.pipe(
      startWith(''),
      map((value) => typeof value === 'string' ? value : value?.nombre_legal || ''),
      map((nombre) => nombre ? this._filterClientes(nombre) : this.clientes.slice()),
    );

    this.filteredConceptos$ = this.conceptoControl.valueChanges.pipe(
      startWith(''),
      map((value) => typeof value === 'string' ? value : (value ? `[${value.codigo}] ${value.descripcion}` : '')),
      map((term) => term ? this._filterConceptos(term) : this.conceptos.slice()),
    );
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  cargarClientes(): void {
    this.nominaService.getClientesActivos().subscribe({
      next: (data) => {
        this.clientes = data;
        this.clienteControl.setValue(this.clienteControl.value);
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al cargar empresas', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  cargarConceptos(): void {
    this.nominaService.getConceptos().subscribe({
      next: (data) => {
        this.conceptos = data;
        this.conceptoControl.setValue(this.conceptoControl.value);
        this.reconstruirCatalogo();
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al cargar conceptos', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  private _filterClientes(term: string): Client[] {
    const lower = term.toLowerCase();
    return this.clientes.filter((cliente) =>
      cliente.nombre_legal.toLowerCase().includes(lower) ||
      (cliente.nit ?? '').toLowerCase().includes(lower)
    );
  }

  private _filterConceptos(term: string): ConceptoNomina[] {
    const lower = term.toLowerCase();
    return this.conceptos.filter((concepto) =>
      concepto.codigo.toLowerCase().includes(lower) ||
      concepto.descripcion.toLowerCase().includes(lower) ||
      (concepto.abreviatura ?? '').toLowerCase().includes(lower)
    );
  }

  displayCliente(cliente: Client): string {
    return cliente ? `${cliente.nombre_legal}${cliente.nit ? ' (' + cliente.nit + ')' : ''}` : '';
  }

  displayConcepto(concepto: ConceptoNomina): string {
    return concepto ? `[${concepto.codigo}] ${concepto.descripcion}` : '';
  }

  onClienteSelected(cliente: Client): void {
    this.selectedCliente = cliente;
    this.cargarHomologaciones();
  }

  onClienteCleared(): void {
    this.selectedCliente = null;
    this.clienteControl.setValue('');
    this.homologacionesEmpresa = [];
    this.catalogoConceptos = [];
    this.dataSource.data = [];
  }

  onConceptoSelected(concepto: ConceptoNomina): void {
    this.selectedConcepto = concepto;
    this.aplicarFiltros();
  }

  onConceptoCleared(): void {
    this.selectedConcepto = null;
    this.conceptoControl.setValue('');
    this.aplicarFiltros();
  }

  cargarHomologaciones(): void {
    if (!this.selectedCliente) {
      this.dataSource.data = [];
      return;
    }

    this.isLoading = true;
    this.cdr.markForCheck();
    this.nominaService.getHomologaciones({ entidad_externa: this.selectedCliente.id_entidad }).subscribe({
      next: (data) => {
        this.homologacionesEmpresa = data;
        this.reconstruirCatalogo();
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al cargar homologaciones', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  abrirDialogoCrear(): void {
    if (!this.selectedCliente) {
      this.snackBar.open('Seleccione primero una empresa usuaria', 'Cerrar', { duration: 3000 });
      return;
    }

    const ref = this.dialog.open(HomologadorFormDialogComponent, {
      width: '680px',
      data: {
        homologacion: null,
        entidadId: this.selectedCliente.id_entidad,
        conceptoSugerido: this.selectedConcepto,
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (ok) this.cargarHomologaciones();
    });
  }

  abrirDialogoEditar(item: HomologadorCatalogRow): void {
    const ref = this.dialog.open(HomologadorFormDialogComponent, {
      width: '680px',
      data: {
        homologacion: item.tiene_homologacion ? this.toHomologacion(item) : null,
        entidadId: item.entidad_externa,
        conceptoSugerido: this.conceptos.find((concepto) => concepto.id_concepto === item.concepto) ?? null,
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (ok) this.cargarHomologaciones();
    });
  }

  toggleActivo(item: HomologadorCatalogRow): void {
    if (!item.id_homologacion) {
      this.abrirDialogoEditar(item);
      return;
    }

    const nuevoEstado = !item.activo;
    this.nominaService.actualizarHomologacion(item.id_homologacion, { activo: nuevoEstado }).subscribe({
      next: () => {
        item.activo = nuevoEstado;
        this.snackBar.open(
          `Homologacion ${nuevoEstado ? 'activada' : 'desactivada'}`,
          'Cerrar',
          { duration: 2000 },
        );
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al actualizar estado', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  limpiarFiltros(): void {
    this.filterEstado = '';
    this.filterActivo = '';
    this.filterSearch = '';
    this.selectedConcepto = null;
    this.conceptoControl.setValue('');
    this.aplicarFiltros();
  }

  totalCatalogo(): number {
    return this.catalogoConceptos.length;
  }

  contarHomologados(): number {
    return this.catalogoConceptos.filter(r => r.tiene_homologacion).length;
  }

  contarPendientes(): number {
    return this.catalogoConceptos.filter(r => !r.tiene_homologacion).length;
  }

  getNaturalezaClass(naturaleza: string | undefined): string {
    if (!naturaleza) return 'nat-otro';
    const n = naturaleza.toUpperCase();
    if (n.includes('DEVENGO')) return 'nat-devengo';
    if (n.includes('DEDUCC')) return 'nat-deduccion';
    if (n.includes('APORTE')) return 'nat-aporte';
    if (n.includes('PROVIS')) return 'nat-provision';
    return 'nat-otro';
  }

  private reconstruirCatalogo(): void {
    if (!this.selectedCliente) {
      this.catalogoConceptos = [];
      this.dataSource.data = [];
      return;
    }

    const porConcepto = new Map<number, HomologadorExterno[]>();
    for (const homologacion of this.homologacionesEmpresa) {
      const actuales = porConcepto.get(homologacion.concepto) ?? [];
      actuales.push(homologacion);
      porConcepto.set(homologacion.concepto, actuales);
    }

    // Ordena los mapeos de un mismo concepto por codigo externo (natural) para que
    // las filas del mismo concepto queden contiguas y en orden estable.
    const ordenarPorCodigo = (lista: HomologadorExterno[]): HomologadorExterno[] =>
      lista.slice().sort((a, b) =>
        (a.codigo_externo ?? '').localeCompare(b.codigo_externo ?? '', undefined, { numeric: true }));

    // UNA FILA POR CONCEPTO INTERNO. Si tiene varios mapeos externos (mismo codigo con
    // distinto concepto_externo, o varios codigos), se adjuntan todos en `mapeos` y la
    // fila se vuelve colapsable: al hacer clic despliega un panel con todos, cada uno
    // editable/activable por separado. Los conceptos sin homologar quedan "pendientes".
    const filasConcepto: HomologadorCatalogRow[] = this.conceptos.map((concepto) =>
      this.filaCatalogo(concepto, ordenarPorCodigo(porConcepto.get(concepto.id_concepto!) ?? [])));

    // Filas huerfanas: homologaciones cuyo concepto interno no esta en this.conceptos
    // (concepto inexistente o inactivo no devuelto por /conceptos?activo=true). Sin
    // esto la homologacion existe en BD pero nunca se dibuja. Se agrupan igual y son
    // colapsables por concepto (o por id de homologacion cuando el concepto es null).
    const idsConcepto = new Set(this.conceptos.map((concepto) => concepto.id_concepto));
    const porHuerfana = new Map<string, HomologadorExterno[]>();
    for (const h of this.homologacionesEmpresa) {
      if (h.concepto != null && idsConcepto.has(h.concepto)) continue;
      const clave = h.concepto != null ? `c${h.concepto}` : `h${h.id_homologacion}`;
      const actuales = porHuerfana.get(clave) ?? [];
      actuales.push(h);
      porHuerfana.set(clave, actuales);
    }
    const filasHuerfanas: HomologadorCatalogRow[] = [];
    for (const grupo of porHuerfana.values()) {
      filasHuerfanas.push(this.filaHuerfana(ordenarPorCodigo(grupo)));
    }

    this.catalogoConceptos = [...filasConcepto, ...filasHuerfanas];

    this.aplicarFiltros();
  }

  /** Construye la fila de un concepto interno con TODOS sus mapeos externos adjuntos.
   *  El principal (mapeos[0]) resume la fila; el panel colapsable lista todos. Lista
   *  vacia => fila "pendiente". */
  private filaCatalogo(concepto: ConceptoNomina, mapeos: HomologadorExterno[]): HomologadorCatalogRow {
    const principal = mapeos[0];
    return {
      id_homologacion: principal?.id_homologacion,
      concepto: concepto.id_concepto!,
      concepto_codigo: concepto.codigo,
      concepto_descripcion: concepto.descripcion,
      concepto_naturaleza: concepto.naturaleza_display ?? concepto.naturaleza,
      concepto_unidad: concepto.unidad_display ?? concepto.unidad,
      entidad_externa: this.selectedCliente!.id_entidad,
      entidad_nombre: this.selectedCliente!.nombre_legal,
      entidad_nit: this.selectedCliente!.nit,
      codigo_externo: principal?.codigo_externo ?? '',
      concepto_externo: principal?.concepto_externo ?? '',
      clasificacion_externa: principal?.clasificacion_externa ?? '',
      tabla_operativa_destino: principal?.tabla_operativa_destino ?? '',
      campo_operativo_destino: principal?.campo_operativo_destino ?? '',
      estado_homologacion: principal?.estado_homologacion ?? 'SIN_HOMOLOGACION',
      estado_display: principal?.estado_display,
      observacion: principal?.observacion ?? '',
      activo: principal?.activo ?? false,
      creado_at: principal?.creado_at,
      actualizado_at: principal?.actualizado_at,
      concepto_activo: concepto.activo,
      tiene_homologacion: !!principal,
      mapeos_grupo: mapeos.length,
      mapeos,
      clave: `c${concepto.id_concepto}`,
    };
  }

  /** Fila huerfana: el concepto interno no esta en el catalogo activo; se usan los
   *  campos denormalizados de la homologacion principal. */
  private filaHuerfana(mapeos: HomologadorExterno[]): HomologadorCatalogRow {
    const principal = mapeos[0];
    return {
      id_homologacion: principal.id_homologacion,
      concepto: principal.concepto,
      concepto_codigo: principal.concepto_codigo ?? '',
      concepto_descripcion: principal.concepto_descripcion
        ?? `(Concepto interno ${principal.concepto ?? 'N/D'} no disponible)`,
      concepto_naturaleza: principal.concepto_naturaleza,
      concepto_unidad: undefined,
      entidad_externa: this.selectedCliente!.id_entidad,
      entidad_nombre: this.selectedCliente!.nombre_legal,
      entidad_nit: this.selectedCliente!.nit,
      codigo_externo: principal.codigo_externo ?? '',
      concepto_externo: principal.concepto_externo ?? '',
      clasificacion_externa: principal.clasificacion_externa ?? '',
      tabla_operativa_destino: principal.tabla_operativa_destino ?? '',
      campo_operativo_destino: principal.campo_operativo_destino ?? '',
      estado_homologacion: principal.estado_homologacion ?? 'SIN_HOMOLOGACION',
      estado_display: principal.estado_display,
      observacion: principal.observacion ?? '',
      activo: principal.activo ?? false,
      creado_at: principal.creado_at,
      actualizado_at: principal.actualizado_at,
      concepto_activo: false,
      tiene_homologacion: true,
      mapeos_grupo: mapeos.length,
      mapeos,
      clave: principal.concepto != null ? `c${principal.concepto}` : `h${principal.id_homologacion}`,
    };
  }

  // ── Expansion (panel colapsable de mapeos) ───────────────────────────────
  expandidas = new Set<string>();

  esExpandible(row: HomologadorCatalogRow): boolean {
    return (row.mapeos_grupo ?? 0) > 1;
  }

  estaExpandida(row: HomologadorCatalogRow): boolean {
    return this.expandidas.has(row.clave);
  }

  toggleExpand(row: HomologadorCatalogRow): void {
    if (!this.esExpandible(row)) return;
    if (this.expandidas.has(row.clave)) this.expandidas.delete(row.clave);
    else this.expandidas.add(row.clave);
    this.cdr.markForCheck();
  }

  /** Editar un mapeo concreto desde el panel colapsable. */
  abrirDialogoEditarMapeo(mapeo: HomologadorExterno): void {
    const ref = this.dialog.open(HomologadorFormDialogComponent, {
      width: '680px',
      data: {
        homologacion: mapeo,
        entidadId: mapeo.entidad_externa ?? this.selectedCliente?.id_entidad,
        conceptoSugerido: this.conceptos.find((concepto) => concepto.id_concepto === mapeo.concepto) ?? null,
      },
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.cargarHomologaciones();
    });
  }

  /** Activar/desactivar un mapeo concreto desde el panel colapsable. */
  toggleActivoMapeo(mapeo: HomologadorExterno): void {
    if (!mapeo.id_homologacion) return;
    const nuevoEstado = !mapeo.activo;
    this.nominaService.actualizarHomologacion(mapeo.id_homologacion, { activo: nuevoEstado }).subscribe({
      next: () => {
        mapeo.activo = nuevoEstado;
        this.snackBar.open(`Homologacion ${nuevoEstado ? 'activada' : 'desactivada'}`, 'Cerrar', { duration: 2000 });
        this.cdr.markForCheck();
      },
      error: () => {
        this.snackBar.open('Error al actualizar estado', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  aplicarFiltros(): void {
    if (!this.selectedCliente) {
      this.dataSource.data = [];
      return;
    }

    const search = this.filterSearch.trim().toLowerCase();
    const conceptoId = this.selectedConcepto?.id_concepto;

    this.dataSource.data = this.catalogoConceptos.filter((item) => {
      if (conceptoId && item.concepto !== conceptoId) return false;
      if (this.filterEstado && item.estado_homologacion !== this.filterEstado) return false;
      if (this.filterActivo !== '' && String(item.activo) !== this.filterActivo) return false;
      if (!search) return true;

      const camposFila = [
        item.concepto_codigo,
        item.concepto_descripcion,
        item.concepto_naturaleza,
        item.concepto_unidad,
      ];
      // Incluye TODOS los mapeos (no solo el principal) para que buscar un codigo o
      // concepto externo escondido en el panel colapsable encuentre igual la fila.
      const camposMapeos = (item.mapeos ?? []).flatMap((m) => [
        m.codigo_externo,
        m.concepto_externo,
        m.clasificacion_externa,
        m.observacion,
      ]);
      return [...camposFila, ...camposMapeos].some((value) => (value ?? '').toLowerCase().includes(search));
    });

    this.paginator?.firstPage();
  }

  private toHomologacion(item: HomologadorCatalogRow): HomologadorExterno {
    return {
      id_homologacion: item.id_homologacion,
      concepto: item.concepto,
      concepto_codigo: item.concepto_codigo,
      concepto_descripcion: item.concepto_descripcion,
      concepto_naturaleza: item.concepto_naturaleza,
      entidad_externa: item.entidad_externa,
      entidad_nombre: item.entidad_nombre,
      entidad_nit: item.entidad_nit,
      codigo_externo: item.codigo_externo,
      concepto_externo: item.concepto_externo,
      clasificacion_externa: item.clasificacion_externa,
      tabla_operativa_destino: item.tabla_operativa_destino,
      campo_operativo_destino: item.campo_operativo_destino,
      estado_homologacion: item.estado_homologacion as EstadoHomologacion,
      estado_display: item.estado_display,
      observacion: item.observacion,
      activo: item.activo,
      creado_at: item.creado_at,
      actualizado_at: item.actualizado_at,
    };
  }
}

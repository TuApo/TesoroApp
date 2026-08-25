import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Observable, forkJoin, map, of, startWith } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';

import {
  Client, HistoricoNovedadesKpis, NominaService, NovedadComun, NovedadPeriodo,
  PeriodoNominaDto, TnlImportacionResponse,
} from '../../service/nomina/nomina.service';
import { NovedadFormDialogComponent } from './novedad-form-dialog.component';

type FiltroNaturaleza = 'TODAS' | 'DEVENGO' | 'DEDUCCION' | 'OTRO';

/**
 * Submódulo "Novedades" — HISTÓRICO COMÚN del periodo (V36): muestra en un solo
 * modelo las novedades del TNL (importadas por archivo) y las registradas
 * manualmente, conservando el ORIGEN y el ESTADO de cada una. Desde aquí se
 * registra manual, se importa el TNL y se genera el Excel operacional IPANEMA
 * (salida desde BD — el motor nunca lo lee).
 */
@Component({
  selector: 'app-novedades',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    MatTooltipModule,
    MatDialogModule,
  ],
  templateUrl: './novedades.component.html',
  styleUrls: ['./novedades.component.css'],
})
export class NovedadesComponent implements OnInit {

  // ── Contexto: empresa usuaria + periodo ─────────────────────────────────
  clientControl = new FormControl<Client | string | null>(null);
  periodoControl = new FormControl<PeriodoNominaDto | string | null>(null);

  clientes: Client[] = [];
  periodos: PeriodoNominaDto[] = [];
  filteredClientes$!: Observable<Client[]>;
  filteredPeriodos$!: Observable<PeriodoNominaDto[]>;

  // ── Tabla / filtros locales ─────────────────────────────────────────────
  queryControl = new FormControl('');
  filtroNaturaleza: FiltroNaturaleza = 'TODAS';
  filtroOrigen: 'TODOS' | 'TNL' | 'MANUAL' = 'TODOS';

  /** Histórico común: TNL + MANUAL con origen y estado. */
  novedades: NovedadComun[] = [];
  /** Registros manuales completos (para edición: la común no trae observación). */
  private manualesPorId = new Map<number, NovedadPeriodo>();

  dataSource = new MatTableDataSource<NovedadComun>([]);
  displayedColumns = [
    'origen', 'empleado', 'concepto', 'naturaleza', 'cantidad',
    'fechas', 'valor', 'estado', 'acciones',
  ];

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild('tnlFileInput') tnlFileInput!: ElementRef<HTMLInputElement>;

  isLoading = false;
  importandoTnl = false;
  generandoIpanema = false;

  // ── KPIs por estado (§37) ───────────────────────────────────────────────
  kpis: HistoricoNovedadesKpis = {
    total: 0, pendientes: 0, parcialmente_aplicadas: 0, aplicadas: 0,
    sin_homologacion: 0, rechazadas: 0, bloqueadas: 0, anuladas: 0,
    origen_tnl: 0, origen_manual: 0,
  };

  constructor(
    private nominaService: NominaService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.nominaService.getClientesActivos().subscribe(res => {
      this.clientes = res || [];
      this.clientControl.updateValueAndValidity({ emitEvent: true });
      this.cdr.markForCheck();
    });
    this.nominaService.getPeriodosNomina().subscribe(res => {
      // Más recientes primero: es lo que se está registrando ahora.
      this.periodos = (res || []).slice().sort(
        (a, b) => (b.fecha_inicio || '').localeCompare(a.fecha_inicio || ''),
      );
      this.periodoControl.updateValueAndValidity({ emitEvent: true });
      this.cdr.markForCheck();
    });

    this.filteredClientes$ = this.clientControl.valueChanges.pipe(
      startWith(''),
      map(v => typeof v === 'string' ? v : v?.nombre_legal || ''),
      map(nombre => nombre
        ? this.clientes.filter(c => c.nombre_legal.toLowerCase().includes(nombre.toLowerCase()))
        : this.clientes.slice()),
    );
    this.filteredPeriodos$ = this.periodoControl.valueChanges.pipe(
      startWith(''),
      map(v => typeof v === 'string' ? v : v?.descripcion || ''),
      map(desc => desc
        ? this.periodos.filter(p => (p.descripcion || '').toLowerCase().includes(desc.toLowerCase()))
        : this.periodos.slice()),
    );

    // Al cambiar el contexto (empresa u periodo objeto) se recarga la lista.
    this.clientControl.valueChanges.subscribe(v => {
      if (v && typeof v === 'object') this.cargarNovedades();
    });
    this.periodoControl.valueChanges.subscribe(v => {
      if (v && typeof v === 'object') this.cargarNovedades();
    });

    this.queryControl.valueChanges.subscribe(() => this.aplicarFiltros());

    // Filtro/orden client-side coherente con las columnas visibles.
    this.dataSource.sortingDataAccessor = (row, col) => {
      switch (col) {
        case 'origen': return row.origen || '';
        case 'empleado': return (row.nombre_empleado || row.documento || '').toLowerCase();
        case 'concepto': return (row.codigo_concepto || '').toLowerCase();
        case 'naturaleza': return row.naturaleza || '';
        case 'cantidad': return row.horas ?? row.dias ?? -1;
        case 'fechas': return row.fecha_inicio || '';
        case 'valor': return row.valor ?? -1;
        case 'estado': return row.estado || '';
        default: return (row as any)[col] ?? '';
      }
    };
  }

  // ── Contexto ─────────────────────────────────────────────────────────────
  get clienteSel(): Client | null {
    const v = this.clientControl.value;
    return v && typeof v === 'object' ? v : null;
  }

  get periodoSel(): PeriodoNominaDto | null {
    const v = this.periodoControl.value;
    return v && typeof v === 'object' ? v : null;
  }

  get contextoListo(): boolean {
    return !!(this.clienteSel && this.periodoSel);
  }

  displayClient(c: Client | null): string { return c ? c.nombre_legal : ''; }
  displayPeriodo(p: PeriodoNominaDto | null): string { return p ? p.descripcion : ''; }

  limpiarEmpresa(ev?: Event): void { ev?.stopPropagation(); this.clientControl.setValue(null); this.resetLista(); }
  limpiarPeriodo(ev?: Event): void { ev?.stopPropagation(); this.periodoControl.setValue(null); this.resetLista(); }

  private resetLista(): void {
    this.novedades = [];
    this.manualesPorId.clear();
    this.dataSource.data = [];
    this.kpis = { total: 0, pendientes: 0, parcialmente_aplicadas: 0, aplicadas: 0,
      sin_homologacion: 0, rechazadas: 0, bloqueadas: 0, anuladas: 0,
      origen_tnl: 0, origen_manual: 0 };
    this.cdr.markForCheck();
  }

  // ── Datos ────────────────────────────────────────────────────────────────
  cargarNovedades(): void {
    if (!this.contextoListo) return;
    this.isLoading = true;
    this.cdr.markForCheck();
    const clienteId = this.clienteSel!.id_entidad;
    const periodoId = this.periodoSel!.id_periodo;
    forkJoin({
      historico: this.nominaService.getHistoricoNovedadesComun({ clienteId, periodoId }),
      // Manuales completos: la vista común no trae observación (para editar).
      manuales: this.nominaService.getNovedadesPeriodo({ clienteId, periodoId })
        .pipe(catchError(() => of([] as NovedadPeriodo[]))),
    }).subscribe({
      next: ({ historico, manuales }) => {
        // Las ANULADAS no se listan por defecto (siguen en el histórico del backend).
        this.novedades = (historico.items || []).filter(i => i.estado !== 'ANULADA');
        this.kpis = historico.kpis;
        this.manualesPorId.clear();
        (manuales || []).forEach(m => { if (m.id != null) this.manualesPorId.set(m.id, m); });
        this.aplicarFiltros();
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.novedades = [];
        this.aplicarFiltros();
        Swal.fire('Error', 'No se pudo cargar el histórico de novedades del periodo.', 'error');
        this.cdr.markForCheck();
      },
    });
  }

  aplicarFiltros(): void {
    const q = (this.queryControl.value || '').trim().toLowerCase();
    let rows = this.novedades;
    if (this.filtroOrigen !== 'TODOS') {
      rows = rows.filter(r => r.origen === this.filtroOrigen);
    }
    if (this.filtroNaturaleza !== 'TODAS') {
      rows = rows.filter(r => {
        const nat = (r.naturaleza || 'OTRO').toUpperCase();
        if (this.filtroNaturaleza === 'OTRO') return nat !== 'DEVENGO' && nat !== 'DEDUCCION';
        return nat === this.filtroNaturaleza;
      });
    }
    if (q) {
      rows = rows.filter(r =>
        (r.nombre_empleado || '').toLowerCase().includes(q) ||
        (r.documento || '').toLowerCase().includes(q) ||
        (r.codigo_concepto || '').toLowerCase().includes(q) ||
        (r.descripcion_concepto || '').toLowerCase().includes(q));
    }
    this.dataSource.data = rows;
    if (!this.dataSource.paginator && this.paginator) this.dataSource.paginator = this.paginator;
    if (!this.dataSource.sort && this.sort) this.dataSource.sort = this.sort;
  }

  cambiarFiltroNaturaleza(f: FiltroNaturaleza): void {
    this.filtroNaturaleza = f;
    this.aplicarFiltros();
  }

  cambiarFiltroOrigen(f: 'TODOS' | 'TNL' | 'MANUAL'): void {
    this.filtroOrigen = f;
    this.aplicarFiltros();
  }

  badgeNaturaleza(n?: string | null): string {
    const nat = (n || '').toUpperCase();
    if (nat === 'DEVENGO') return 'devengo';
    if (nat === 'DEDUCCION') return 'deduccion';
    return 'otro';
  }

  badgeEstado(e?: string | null): string {
    switch ((e || '').toUpperCase()) {
      case 'PENDIENTE': return 'estado-pendiente';
      case 'PARCIALMENTE_APLICADA': return 'estado-parcial';
      case 'APLICADA': return 'estado-aplicada';
      case 'SIN_HOMOLOGACION': return 'estado-sinhom';
      case 'RECHAZADA': return 'estado-rechazada';
      case 'BLOQUEADA': return 'estado-bloqueada';
      default: return 'estado-otra';
    }
  }

  etiquetaEstado(e?: string | null): string {
    return (e || '').replace(/_/g, ' ');
  }

  /** Solo las MANUALES sin aplicar se pueden editar/anular desde aquí. */
  esEditable(row: NovedadComun): boolean {
    return row.origen === 'MANUAL'
        && (row.estado === 'PENDIENTE' || row.estado === 'SIN_HOMOLOGACION');
  }

  // ── Acciones: registro manual ────────────────────────────────────────────
  nuevaNovedad(): void {
    if (!this.contextoListo) return;
    const ref = this.dialog.open(NovedadFormDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      disableClose: true,
      data: {
        cliente: this.clienteSel!,
        periodo: this.periodoSel!,
      },
    });
    ref.afterClosed().subscribe(res => { if (res) this.cargarNovedades(); });
  }

  editarNovedad(row: NovedadComun): void {
    const manual = this.manualesPorId.get(row.id);
    if (!manual) return;
    const ref = this.dialog.open(NovedadFormDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      disableClose: true,
      data: {
        cliente: this.clienteSel!,
        periodo: this.periodoSel!,
        novedad: manual,
      },
    });
    ref.afterClosed().subscribe(res => { if (res) this.cargarNovedades(); });
  }

  anularNovedad(row: NovedadComun): void {
    Swal.fire({
      title: '¿Anular novedad?',
      html: `Se anulará <b>${row.codigo_concepto} — ${row.descripcion_concepto || ''}</b>` +
            `<br>de <b>${row.nombre_empleado || row.documento}</b>.` +
            `<br><small>La novedad deja de ser candidata al cálculo; queda conservada en el histórico.</small>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, anular',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    }).then(r => {
      if (!r.isConfirmed || row.id == null) return;
      this.nominaService.anularNovedadPeriodo(row.id, this.clienteSel!.id_entidad).subscribe({
        next: () => {
          Swal.fire({ title: 'Novedad anulada', icon: 'success', timer: 1400, showConfirmButton: false });
          this.cargarNovedades();
        },
        error: () => Swal.fire('Error', 'No se pudo anular la novedad.', 'error'),
      });
    });
  }

  // ── Acciones: importar TNL ───────────────────────────────────────────────
  abrirSelectorTnl(): void {
    if (!this.contextoListo || this.importandoTnl) return;
    this.tnlFileInput.nativeElement.value = '';
    this.tnlFileInput.nativeElement.click();
  }

  onArchivoTnl(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file || !this.contextoListo) return;
    this.importandoTnl = true;
    this.cdr.markForCheck();
    this.nominaService.importarTnl(file, this.clienteSel!.id_entidad, {
      periodoId: this.periodoSel!.id_periodo,
    }).subscribe({
      next: resp => {
        this.importandoTnl = false;
        this.mostrarResumenImportacion(resp);
        this.cargarNovedades();
      },
      error: err => {
        this.importandoTnl = false;
        this.cdr.markForCheck();
        Swal.fire('Error', err?.error?.error || 'No se pudo importar el archivo TNL.', 'error');
      },
    });
  }

  private mostrarResumenImportacion(r: TnlImportacionResponse): void {
    const filas = [
      ['Recibidas', r.filas_recibidas],
      ['Insertadas', r.filas_insertadas],
      ['Duplicadas (idempotencia)', r.filas_duplicadas],
      ['Rechazadas (conservadas)', r.filas_rechazadas],
      ['Bloqueadas', r.filas_bloqueadas],
      ['Sin homologación', r.filas_sin_homologacion ?? 0],
      ['Reactivadas', r.filas_desbloqueadas],
    ].map(([k, v]) => `<tr><td style="text-align:left;padding:2px 12px 2px 0">${k}</td>` +
                      `<td style="text-align:right"><b>${v}</b></td></tr>`).join('');
    const warns = (r.warnings || []).slice(0, 5)
      .map(w => `<li style="text-align:left">${w}</li>`).join('');
    Swal.fire({
      title: r.conciliacion_correcta ? 'TNL importado' : 'TNL importado con avisos',
      icon: r.conciliacion_correcta ? 'success' : 'warning',
      html: `<table style="margin:0 auto">${filas}</table>` +
            (warns ? `<ul style="margin-top:10px;font-size:12px">${warns}</ul>` : ''),
      width: 560,
      confirmButtonText: 'Entendido',
    });
  }

  // ── Acciones: Excel operacional IPANEMA (salida desde BD) ───────────────
  generarIpanema(): void {
    if (!this.contextoListo || this.generandoIpanema) return;
    this.generandoIpanema = true;
    this.cdr.markForCheck();
    const periodo = (this.periodoSel?.descripcion || 'periodo').replace(/[\\/:*?"<>|]/g, '-');
    this.nominaService.exportIpanemaXlsx(
      this.clienteSel!.id_entidad, this.periodoSel!.id_periodo,
    ).subscribe({
      next: blob => {
        this.generandoIpanema = false;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Novedades Flores Ipanema ${periodo}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.cdr.markForCheck();
      },
      error: () => {
        this.generandoIpanema = false;
        this.cdr.markForCheck();
        Swal.fire('Error', 'No se pudo generar el Excel IPANEMA.', 'error');
      },
    });
  }

  // ── Export simple de lo listado (client-side) ───────────────────────────
  exportarExcel(): void {
    if (!this.dataSource.data.length) return;
    const data = this.dataSource.data.map(r => ({
      'Origen': r.origen,
      'Documento': r.documento,
      'Empleado': r.nombre_empleado || '',
      'Código': r.codigo_concepto,
      'Concepto': r.descripcion_concepto || '',
      'Naturaleza': r.naturaleza || '',
      'Unidad': r.unidad || '',
      'Horas': r.horas ?? '',
      'Días': r.dias ?? '',
      'Fecha Inicio': r.fecha_inicio || '',
      'Fecha Fin': r.fecha_fin || '',
      'Valor': r.valor ?? '',
      'Estado': r.estado || '',
      'Importación': r.importacion_id ?? '',
      'Archivo': r.archivo_origen || '',
      'Fila': r.fila_origen ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Novedades');
    const periodo = (this.periodoSel?.descripcion || 'periodo').replace(/[\\/:*?"<>|]/g, '-');
    XLSX.writeFile(wb, `Novedades_${periodo}.xlsx`);
  }
}

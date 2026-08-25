import { ChangeDetectorRef, Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '../../../../../../shared/shared.module';
import { FormControl, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Observable, startWith, map } from 'rxjs';
import {
  NominaService,
  Client,
  CostCenter,
  EstadoPagoNomina,
  ESTADOS_PAGO_NOMINA,
  HistoricoResumen,
} from '../../service/nomina/nomina.service';
import {
  DesprendiblePreviewComponent,
  DesprendiblePreviewData,
} from '../../components/desprendible-preview/desprendible-preview.component';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-historico-nomina',
  standalone: true,
  imports: [
    CommonModule, 
    SharedModule, 
    FormsModule,
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    MatDividerModule,
    MatCheckboxModule,
    MatDialogModule
  ],
  templateUrl: './historico-nomina.component.html',
  styleUrls: ['./historico-nomina.component.css']
})
export class HistoricoNominaComponent implements OnInit {
  
  // Controles de filtrado
  periodoControl = new FormControl<any>(null);
  periodoFilterCtrl = new FormControl('');
  
  clientControl = new FormControl<any>(null);
  cecoFilterCtrl = new FormControl('');
  
  queryControl = new FormControl('');

  periodos: any[] = [];
  clientes: Client[] = [];
  cecos: CostCenter[] = [];
  selectedCecoIds: number[] = [];
  
  filteredPeriodos$!: Observable<any[]>;
  filteredClientes$!: Observable<Client[]>;
  filteredCecos$!: Observable<CostCenter[]>;
  
  historicoDataSource = new MatTableDataSource<any>([]);
  displayedColumns: string[] = [
    'select',
    'identificacion', 'nombre_completo', 'ceco_nombre',
    'total_devengado', 'total_deducido', 'neto_pagar',
    'estado_pago', 'liquidado_at'
  ];

  /** IDs (id_nomina_emp) seleccionados para acción masiva. */
  selectedIds = new Set<number>();
  /** Estados permitidos para el cambio de estado_pago. */
  readonly estadosPermitidos: EstadoPagoNomina[] = ESTADOS_PAGO_NOMINA;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  isLoading = false;

  /**
   * Resumen "de módulo" del histórico: total y desglose por estado de TODAS
   * las nóminas del filtro actual (empresa + periodo + centros + búsqueda).
   * Se llena tras "BUSCAR EN HISTÓRICO" y queda fijo encima de la tabla. El
   * conteo lo hace el backend, no solo lo cargado en pantalla. `null` antes
   * de la primera búsqueda.
   */
  resumen: HistoricoResumen | null = null;
  resumenLoading = false;
  /** Texto descriptivo del filtro (empresa · periodo) para la cabecera. */
  resumenContexto = '';
  /**
   * Filtro exacto de la última búsqueda. Se reutiliza para recargar el
   * resumen tras un cambio de estado (sin refrescar la página) usando los
   * MISMOS params que la tabla mostrada, no el estado actual del formulario.
   */
  private ultimoFiltroResumen: any = null;

  constructor(
    private nominaService: NominaService,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog,
  ) {}

  /**
   * Click sobre una fila del histórico → abre el preview del desprendible.
   * El click en el checkbox de selección masiva se maneja aparte para que
   * marcar una fila no dispare la apertura del dialog.
   */
  abrirDesprendible(row: any): void {
    if (row?.id_nomina_emp == null) return;
    this.dialog.open<DesprendiblePreviewComponent, DesprendiblePreviewData>(
      DesprendiblePreviewComponent,
      {
        data: { idNominaEmp: row.id_nomina_emp },
        panelClass: 'desprendible-preview-dialog',
        maxWidth: '95vw',
        width: '900px',
        maxHeight: '95vh',
        autoFocus: false,
      },
    );
  }

  /**
   * Carga el resumen "de módulo" (total / pendientes / aprobadas / pagadas)
   * del filtro actual. Usa los mismos params que la búsqueda para que los
   * conteos casen con la tabla. Solo lectura: no afecta histórico, cálculo
   * ni desprendible. En error deja el resumen anterior oculto sin romper el
   * flujo.
   */
  private cargarResumen(params: any): void {
    this.resumenLoading = true;
    this.cdr.markForCheck();
    this.nominaService.getResumenHistorico(params).subscribe({
      next: (res) => {
        this.resumen = res;
        this.resumenLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.resumen = null;
        this.resumenLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnInit(): void {
    this.cargarDatosMaestros();
    
    this.filteredPeriodos$ = this.periodoFilterCtrl.valueChanges.pipe(
      startWith(''),
      map(val => this._filterPeriodos(val || ''))
    );

    this.filteredClientes$ = this.clientControl.valueChanges.pipe(
      startWith(''),
      map(value => typeof value === 'string' ? value : value?.nombre_legal || ''),
      map(nombre => nombre ? this._filterClients(nombre) : this.clientes.slice())
    );

    this.filteredCecos$ = this.cecoFilterCtrl.valueChanges.pipe(
      startWith(''),
      map(val => this._filterCecos(val || ''))
    );

    // Al cambiar cliente, cargar sus CECOs
    this.clientControl.valueChanges.subscribe(client => {
      if (client && typeof client === 'object' && client.id_entidad) {
        this.cargarCecos(client.id_entidad);
      } else {
        this.cecos = [];
        this.selectedCecoIds = [];
      }
    });
  }

  cargarDatosMaestros(): void {
    this.nominaService.getPeriodos().subscribe({
      next: (res: any) => {
        const data = res.results || res || [];
        this.periodos = Array.isArray(data) ? data : [];
        this.periodoFilterCtrl.setValue('');
        this.cdr.markForCheck();
      }
    });

    this.nominaService.getClientes().subscribe({
      next: (res: any) => {
        this.clientes = res.results || res || [];
        this.clientControl.updateValueAndValidity();
        this.cdr.markForCheck();
      }
    });
  }

  cargarCecos(clienteId: number): void {
    this.nominaService.getCentrosCostos(clienteId).subscribe({
      next: (res: any) => {
        this.cecos = res.results || res || [];
        this.cecoFilterCtrl.setValue('');
        this.cdr.markForCheck();
      }
    });
  }

  private _filterPeriodos(val: string): any[] {
    if (typeof val !== 'string') return [];
    const filterValue = val.toLowerCase();
    return this.periodos.filter(p => p.descripcion.toLowerCase().includes(filterValue));
  }

  private _filterClients(name: string): Client[] {
    const filterValue = name.toLowerCase();
    return this.clientes.filter(c => c.nombre_legal.toLowerCase().includes(filterValue));
  }

  private _filterCecos(val: string): CostCenter[] {
    const filterValue = val.toLowerCase();
    return this.cecos.filter(c => c.nombre.toLowerCase().includes(filterValue));
  }

  displayPeriodo(periodo: any): string {
    return periodo ? periodo.descripcion : '';
  }

  displayClient(client: Client): string {
    return client ? client.nombre_legal : '';
  }

  toggleAllCecos(selected: boolean): void {
    if (selected) {
      this.selectedCecoIds = this.cecos.map(c => c.id_ceco);
    } else {
      this.selectedCecoIds = [];
    }
  }

  isAllCecosSelected(): boolean {
    return this.cecos.length > 0 && this.selectedCecoIds.length === this.cecos.length;
  }

  buscarHistorico(): void {
    const periodo = this.periodoControl.value;
    if (!periodo || typeof periodo !== 'object') {
      Swal.fire('Atención', 'Seleccione un periodo de nómina', 'warning');
      return;
    }

    const params: any = {
      periodo_id: periodo.id_periodo
    };

    if (this.clientControl.value?.id_entidad) {
      params.cliente_id = this.clientControl.value.id_entidad;
    }

    if (this.selectedCecoIds.length > 0 && !this.isAllCecosSelected()) {
      params.cecos = this.selectedCecoIds;
    }

    const q = this.queryControl.value?.trim();
    if (q) {
      params.query = q;
    }

    this.isLoading = true;
    this.selectedIds.clear();
    this.resumen = null; // el resumen anterior queda obsoleto al re-buscar
    // Contexto para la cabecera del resumen (empresa · periodo).
    const empresaTxt = this.clientControl.value?.nombre_legal || 'Todas las empresas';
    this.resumenContexto = `${empresaTxt} · ${periodo.descripcion}`;
    this.cdr.markForCheck();
    // Resumen de módulo: conteo en backend sobre TODO el filtro (en paralelo).
    this.ultimoFiltroResumen = { ...params };
    this.cargarResumen(params);
    this.nominaService.getHistorico(params).subscribe({
      next: (data) => {
        this.historicoDataSource.data = data;
        this.historicoDataSource.paginator = this.paginator;
        this.historicoDataSource.sort = this.sort;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.markForCheck();
        Swal.fire('Error', 'No se pudo cargar el histórico', 'error');
      }
    });
  }

  // ── Selección masiva ────────────────────────────────────────────────────
  isRowSelected(row: any): boolean {
    return this.selectedIds.has(row.id_nomina_emp);
  }

  toggleRow(row: any, checked: boolean): void {
    if (checked) this.selectedIds.add(row.id_nomina_emp);
    else this.selectedIds.delete(row.id_nomina_emp);
  }

  isAllRowsSelected(): boolean {
    const data = this.historicoDataSource.data;
    return data.length > 0 && data.every(r => this.selectedIds.has(r.id_nomina_emp));
  }

  isSomeRowsSelected(): boolean {
    return this.selectedIds.size > 0 && !this.isAllRowsSelected();
  }

  toggleAllRows(checked: boolean): void {
    if (checked) {
      this.historicoDataSource.data.forEach(r => this.selectedIds.add(r.id_nomina_emp));
    } else {
      this.historicoDataSource.data.forEach(r => this.selectedIds.delete(r.id_nomina_emp));
    }
  }

  /**
   * Abre un diálogo para elegir el nuevo estado y aplica el cambio a los
   * registros seleccionados. Funciona igual para uno solo o varios.
   */
  cambiarEstadoSeleccion(): void {
    const ids = Array.from(this.selectedIds);
    if (ids.length === 0) {
      Swal.fire('Atención', 'Seleccione al menos una nómina para cambiar el estado.', 'info');
      return;
    }

    const opciones = this.estadosPermitidos
      .map(e => `<option value="${e}">${e}</option>`)
      .join('');

    Swal.fire({
      title: `Cambiar estado de ${ids.length} nómina${ids.length === 1 ? '' : 's'}`,
      html: `
        <p style="margin-top:0">Selecciona el nuevo estado a aplicar:</p>
        <select id="swal-estado-select" class="swal2-select" style="display:flex;margin:0 auto;">
          ${opciones}
        </select>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Aplicar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const sel = document.getElementById('swal-estado-select') as HTMLSelectElement | null;
        const val = sel?.value as EstadoPagoNomina | undefined;
        if (!val) {
          Swal.showValidationMessage('Debe seleccionar un estado');
          return false;
        }
        return val;
      },
    }).then(result => {
      if (!result.isConfirmed || !result.value) return;
      const nuevoEstado = result.value as EstadoPagoNomina;
      this.aplicarCambioEstado(ids, nuevoEstado);
    });
  }

  private aplicarCambioEstado(ids: number[], estado: EstadoPagoNomina): void {
    this.isLoading = true;
    this.cdr.markForCheck();
    this.nominaService.cambiarEstadoNomina(ids, estado).subscribe({
      next: (resp) => {
        // Refleja el cambio localmente sin recargar
        this.historicoDataSource.data = this.historicoDataSource.data.map(r =>
          this.selectedIds.has(r.id_nomina_emp) ? { ...r, estado_pago: resp.estado || estado } : r
        );
        this.selectedIds.clear();
        this.isLoading = false;
        this.cdr.markForCheck();
        // Actualiza el tablero de resumen con el estado ya persistido en BD,
        // sin refrescar la página. Reusa el filtro de la última búsqueda para
        // que los conteos sigan casando con la tabla.
        if (this.ultimoFiltroResumen) {
          this.cargarResumen(this.ultimoFiltroResumen);
        }
        Swal.fire(
          'Estado actualizado',
          `${resp.actualizados} de ${resp.solicitados} nómina(s) cambiadas a ${resp.estado}.`,
          'success',
        );
      },
      error: (err) => {
        this.isLoading = false;
        this.cdr.markForCheck();
        const msg = err?.error?.error || 'No se pudo cambiar el estado.';
        Swal.fire('Error', msg, 'error');
      },
    });
  }

  exportarExcel(): void {
    if (this.historicoDataSource.data.length === 0) return;
    
    const p = this.periodoControl.value;
    const desc = p?.descripcion || 'Historico';

    const dataToExport = this.historicoDataSource.data.map(item => ({
      'Identificación': item.identificacion,
      'Nombre Completo': item.nombre_completo,
      'Centro de Costo': item.ceco_nombre,
      'Total Devengado': item.total_devengado,
      'Total Deducido': item.total_deducido,
      'Neto a Pagar': item.neto_pagar,
      'Estado': item.estado_pago,
      'Fecha Liquidación': new Date(item.liquidado_at).toLocaleString()
    }));

    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(dataToExport);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Histórico');
    
    XLSX.writeFile(wb, `Historico_Nomina_${desc}.xlsx`);
  }
}

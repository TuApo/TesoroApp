import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '../../../../../../shared/shared.module';
import { FormControl, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, startWith, map } from 'rxjs';
import { ColumnaTabla, TABLA_ESTANDAR, TonoBadge } from '../../../../../../shared/components/tabla-estandar';
import { NominaService, Client, CostCenter, HistoricoNovedadRow } from '../../service/nomina/nomina.service';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-historico-novedades',
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatAutocompleteModule,
    MatDividerModule,
    MatCheckboxModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './historico-novedades.component.html',
  styleUrls: ['./historico-novedades.component.css'],
})
export class HistoricoNovedadesComponent implements OnInit {

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

  /** Resultado de la última búsqueda (filtros de negocio aplicados en el backend). */
  novedades: HistoricoNovedadRow[] = [];

  readonly columnas: ColumnaTabla<HistoricoNovedadRow>[] = [
    { id: 'identificacion', header: 'Identificación', valor: (r) => r.identificacion, tarjeta: 'subtitulo' },
    { id: 'nombre_completo', header: 'Empleado', valor: (r) => r.nombre_completo, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'cliente_nombre', header: 'Empresa Usuaria', valor: (r) => r.cliente_nombre ?? '', prioridad: 2, tarjeta: 'cuerpo' },
    { id: 'ceco_nombre', header: 'Centro de Costo', valor: (r) => r.ceco_nombre ?? '', prioridad: 2, tarjeta: 'cuerpo' },
    { id: 'codigo', header: 'Código', valor: (r) => r.codigo, tarjeta: 'meta' },
    { id: 'descripcion', header: 'Descripción', valor: (r) => r.descripcion, minAncho: '160px', tarjeta: 'cuerpo' },
    { id: 'naturaleza', header: 'Naturaleza', valor: (r) => r.naturaleza, tarjeta: 'badge',
      badge: (r) => (r.naturaleza ? { texto: r.naturaleza, tono: this.tonoNaturaleza(r.naturaleza) } : null) },
    { id: 'clasificacion', header: 'Clasificación', valor: (r) => r.clasificacion, prioridad: 3, tarjeta: 'meta' },
    { id: 'cantidad', header: 'Cantidad', valor: (r) => r.cantidad, align: 'right', prioridad: 2, tarjeta: 'meta' },
    { id: 'unidad', header: 'Unidad', valor: (r) => r.unidad, prioridad: 3, tarjeta: 'meta' },
    { id: 'valor_total', header: 'Valor', valor: (r) => r.valor_total, align: 'right', tarjeta: 'meta' },
    { id: 'liquidado_at', header: 'Fecha', prioridad: 2, tarjeta: 'meta',
      valor: (r) => (r.liquidado_at ? new Date(r.liquidado_at) : null) },
  ];

  readonly idNovedad = (r: HistoricoNovedadRow) => r.id_historico;

  isLoading = false;

  /** Tono del chip de naturaleza (antes clases .devengo / .deduccion / .otro). */
  private tonoNaturaleza(naturaleza: string): TonoBadge {
    const n = naturaleza.toLowerCase();
    if (n === 'devengo') return 'ok';
    if (n === 'deduccion') return 'danger';
    return 'neutro';
  }

  constructor(
    private nominaService: NominaService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargarDatosMaestros();

    this.filteredPeriodos$ = this.periodoFilterCtrl.valueChanges.pipe(
      startWith(''),
      map(val => this._filterPeriodos(val || '')),
    );

    this.filteredClientes$ = this.clientControl.valueChanges.pipe(
      startWith(''),
      map(value => typeof value === 'string' ? value : value?.nombre_legal || ''),
      map(nombre => nombre ? this._filterClients(nombre) : this.clientes.slice()),
    );

    this.filteredCecos$ = this.cecoFilterCtrl.valueChanges.pipe(
      startWith(''),
      map(val => this._filterCecos(val || '')),
    );

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
      },
    });

    this.nominaService.getClientes().subscribe({
      next: (res: any) => {
        this.clientes = res.results || res || [];
        this.clientControl.updateValueAndValidity();
        this.cdr.markForCheck();
      },
    });
  }

  cargarCecos(clienteId: number): void {
    this.nominaService.getCentrosCostos(clienteId).subscribe({
      next: (res: any) => {
        this.cecos = res.results || res || [];
        this.cecoFilterCtrl.setValue('');
        this.cdr.markForCheck();
      },
    });
  }

  private _filterPeriodos(val: string): any[] {
    if (typeof val !== 'string') return [];
    const filterValue = val.toLowerCase();
    return this.periodos.filter(p => (p.descripcion || '').toLowerCase().includes(filterValue));
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
    this.selectedCecoIds = selected ? this.cecos.map(c => c.id_ceco) : [];
  }

  isAllCecosSelected(): boolean {
    return this.cecos.length > 0 && this.selectedCecoIds.length === this.cecos.length;
  }

  buscar(): void {
    const params: any = {};
    const periodo = this.periodoControl.value;
    if (periodo && typeof periodo === 'object') {
      params.periodo_id = periodo.id_periodo;
    }
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
    this.cdr.markForCheck();
    this.nominaService.getHistoricoNovedades(params).subscribe({
      next: data => {
        this.novedades = data || [];
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.markForCheck();
        Swal.fire('Error', 'No se pudo cargar el histórico de novedades', 'error');
      },
    });
  }

  exportarExcel(): void {
    if (this.novedades.length === 0) return;

    const p = this.periodoControl.value;
    const desc = p?.descripcion || 'Todos';

    const dataToExport = this.novedades.map(item => ({
      'Identificación': item.identificacion,
      'Empleado': item.nombre_completo,
      'Empresa Usuaria': item.cliente_nombre || '',
      'Centro de Costo': item.ceco_nombre || '',
      'Código': item.codigo,
      'Descripción': item.descripcion,
      'Naturaleza': item.naturaleza,
      'Clasificación': item.clasificacion,
      'Cantidad': item.cantidad,
      'Unidad': item.unidad,
      'Valor Unitario': item.valor_unitario,
      'Valor Total': item.valor_total,
      'Hace Base IBC': item.hace_base_ibc ? 'Sí' : 'No',
      'Disminuye IBC': item.disminuye_ibc ? 'Sí' : 'No',
      'Origen': item.origen_tabla,
      'Observación': item.observacion,
      'Fecha Liquidación': item.liquidado_at ? new Date(item.liquidado_at).toLocaleString() : '',
    }));

    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(dataToExport);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Novedades');
    XLSX.writeFile(wb, `Historico_Novedades_${desc}.xlsx`);
  }
}

import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { SharedModule } from '../../../../../../shared/shared.module';
import { HttpErrorResponse } from '@angular/common/http';
import {
  NominaService, Client, CostCenter,
  ConciliacionNovedades, DiagnosticoNovedad, GuardarLiquidacionPayload,
  EmpleadoExcluido,
} from '../../service/nomina/nomina.service';
import Swal from 'sweetalert2';
import { map, startWith } from 'rxjs/operators';
import { Observable } from 'rxjs';

// Importaciones Material
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PeriodoDialogComponent } from './periodo-dialog/periodo-dialog.component';
import { CalcularConNovedadesDialogComponent } from '../../components/calcular-con-novedades-dialog/calcular-con-novedades-dialog.component';

import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

@Component({
  selector: 'app-calculo-nomina',
  standalone: true,
  providers: [provideNativeDateAdapter()],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatAutocompleteModule,
    MatCheckboxModule,
    MatDividerModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatDialogModule,
    MatTooltipModule
  ],
  templateUrl: './calculo-nomina.component.html',
  styleUrl: './calculo-nomina.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalculoNominaComponent implements OnInit {
  // Datos maestros
  clientes: Client[] = [];
  cecos: CostCenter[] = [];
  periodos: any[] = [];
  
  // Controles de búsqueda
  clientControl = new FormControl<string | Client>('', Validators.required);
  periodoControl = new FormControl<any>(null, Validators.required);
  
  // Filtros internos para los selects
  cecoFilterCtrl = new FormControl('');
  periodoFilterCtrl = new FormControl('');

  // Rango de Fechas
  startDate = new FormControl<Date | null>(null, Validators.required);
  endDate = new FormControl<Date | null>(null, Validators.required);
  diasCalculados: number = 0;

  filteredClientes$!: Observable<Client[]>;
  filteredCecos$!: Observable<CostCenter[]>;
  filteredPeriodos$!: Observable<any[]>;
  
  // Selecciones
  selectedCliente: Client | null = null;
  selectedCecoIds: number[] = [];
  
  // Resultados
  contratos: any[] = [];
  contratosFiltrados: any[] = [];
  // Snapshot crudo del último cálculo del backend, indexado por id_contrato.
  // Se usa para exportar la plantilla sin re-pegarle al backend (evita drift
  // entre lo que ve el usuario y lo que se baja).
  private _empleadosCalculados: Map<number, any> = new Map();
  filtroBusqueda: string = '';
  displayedColumns: string[] = ['empleado', 'num_doc', 'salario', 'dias', 'devengado', 'aux_trans', 'salud', 'pension', 'neto'];
  loading: boolean = false;
  guardando: boolean = false;
  // Flag separado del de "descargando plantilla" para no inhabilitar ambos
  // botones cuando solo está corriendo uno.
  guardandoNomina: boolean = false;
  // Guardado parcial en curso (cierra solo los empleados sin bloqueantes).
  guardandoParcial: boolean = false;

  // ── Incremento 2.6: snapshot server-side ───────────────────────────────
  // calculationId del último preview con novedades. El cierre envía SOLO esto.
  // Se invalida ante cualquier cambio de insumo (cliente/periodo/contratos/archivo).
  calculationIdActivo: string | null = null;
  puedeCerrarActivo: boolean = false;
  conciliacionActiva: ConciliacionNovedades | null = null;
  bloqueantesActivos: DiagnosticoNovedad[] = [];
  diagnosticoActivo: DiagnosticoNovedad[] = [];
  snapshotExpiraAt: string | null = null;

  /** ¿Se puede guardar? Defensa visual; el backend revalida server-side.
   *  - Flujo con novedades (hay calculationId): exige snapshot vigente, sin
   *    bloqueantes y conciliación correcta.
   *  - Flujo plano legacy (sin calculationId): permitido mientras exista cálculo. */
  get puedeGuardar(): boolean {
    if (this.guardandoNomina || this._empleadosCalculados.size === 0) return false;
    // Inc.2.7: el cierre exige snapshot verificado. Sin calculationId (cierre legacy
    // eliminado) no se puede guardar; hay que generar la vista previa primero.
    if (!this.calculationIdActivo) return false;
    if (!this.puedeCerrarActivo) return false;
    if (this.conciliacionActiva && this.conciliacionActiva.conciliacion_correcta === false) return false;
    if (this.snapshotExpiraAt && new Date(this.snapshotExpiraAt).getTime() < Date.now()) return false;
    return true;
  }

  /** ¿Se puede DESCARGAR el preview? Independiente de `puedeCerrar`: el cálculo parcial
   *  se descarga aunque existan bloqueantes (sin contrato, config incompleta, etc.). Solo
   *  exige un calculationId válido y que no haya una descarga/cálculo en curso. NO reutiliza
   *  `puedeGuardar` ni `puedeCerrarActivo`. */
  get puedeDescargarPreview(): boolean {
    return !!this.calculationIdActivo && !this.guardando && !this.loading;
  }

  /** ¿Se puede GUARDAR PARCIAL? Solo tiene sentido cuando el cierre total está
   *  bloqueado (`puedeCerrarActivo=false`) pero hay un snapshot válido y vigente:
   *  persiste los empleados sin bloqueantes y reporta los excluidos. Si el cierre
   *  total ya es posible, se usa "GUARDAR NÓMINA" y este botón no aplica. */
  get puedeGuardarParcial(): boolean {
    if (this.guardandoNomina || this.guardandoParcial) return false;
    if (this._empleadosCalculados.size === 0) return false;
    if (!this.calculationIdActivo) return false;
    if (this.puedeCerrarActivo) return false;   // si ya cierra completo, no es parcial
    if (this.snapshotExpiraAt && new Date(this.snapshotExpiraAt).getTime() < Date.now()) return false;
    return true;
  }

  /** Incremento 2.7: tras un cálculo PLANO, conserva el snapshot devuelto por
   *  /payroll/calcular (calculation_id + conciliación). aplicarPreviewBackend ya
   *  invalidó el snapshot previo; aquí se fija el nuevo. */
  private aplicarSnapshotPlano(resp: { calculation_id?: string; puede_cerrar?: boolean;
                                       conciliacion?: any; fecha_expiracion?: string }): void {
    this.calculationIdActivo = resp.calculation_id ?? null;
    this.puedeCerrarActivo = resp.puede_cerrar ?? !!resp.conciliacion?.puede_cerrar;
    this.conciliacionActiva = resp.conciliacion ?? null;
    this.snapshotExpiraAt = resp.fecha_expiracion ?? null;
    this.bloqueantesActivos = [];
    this.diagnosticoActivo = [];
  }

  /** Invalida el preview/snapshot. Llamar ante cualquier cambio de insumo. */
  private invalidarCalculo(): void {
    this.calculationIdActivo = null;
    this.puedeCerrarActivo = false;
    this.conciliacionActiva = null;
    this.bloqueantesActivos = [];
    this.diagnosticoActivo = [];
    this.snapshotExpiraAt = null;
  }

  // Constantes de Ley / Negocio
  readonly SALARIO_MINIMO_2026 = 1500000; 
  // Jornada Ley 2101: 210 h/mes desde el 1-jul-2026 (antes 220 → 7,33).
  // La fuente de verdad es el motor (CalcConstants.horasLaboralesMes); esta
  // constante es solo de referencia y no debe usarse para calcular dinero.
  readonly HORAS_DIARIAS = 7.0;
  
  constructor(
    private nominaService: NominaService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargarClientes();
    this.cargarPeriodos();
    
    this.filteredClientes$ = this.clientControl.valueChanges.pipe(
      startWith(''),
      map(value => typeof value === 'string' ? value : value?.nombre_legal || ''),
      map(nombre => nombre ? this._filterClients(nombre) : this.clientes.slice())
    );

    // Filtro reactivo para Centros de Costo
    this.filteredCecos$ = this.cecoFilterCtrl.valueChanges.pipe(
      startWith(''),
      map(val => this._filterCecos(val || ''))
    );

    // Filtro reactivo para Periodos
    this.filteredPeriodos$ = this.periodoFilterCtrl.valueChanges.pipe(
      startWith(''),
      map(val => this._filterPeriodos(val || ''))
    );

    // Al cambiar el periodo, auto-setear las fechas
    this.periodoControl.valueChanges.subscribe(p => {
      this.invalidarCalculo();   // cambio de periodo invalida el snapshot
      if (p && p.fecha_inicio && p.fecha_fin) {
        this.startDate.setValue(new Date(p.fecha_inicio + 'T00:00:00'));
        this.endDate.setValue(new Date(p.fecha_fin + 'T00:00:00'));
        this.actualizarDiasYNomina();
      }
    });

    // Cambios en fechas recalculan días
    this.startDate.valueChanges.subscribe(() => this.actualizarDiasYNomina());
    this.endDate.valueChanges.subscribe(() => this.actualizarDiasYNomina());
  }

  private _filterCecos(val: string): CostCenter[] {
    const filterValue = val.toLowerCase();
    return this.cecos.filter(c => c.nombre.toLowerCase().includes(filterValue));
  }

  abrirCalcularConPlantilla(): void {
    const periodo = this.periodoControl.value;
    if (!periodo?.id_periodo) {
      Swal.fire('Atención', 'Seleccione un periodo antes de cargar la plantilla.', 'warning');
      return;
    }
    if (!this.selectedCliente?.id_entidad) {
      Swal.fire('Atención', 'Seleccione un cliente: el homologador depende del cliente.', 'warning');
      return;
    }
    const ref = this.dialog.open(CalcularConNovedadesDialogComponent, {
      width: '90vw', maxWidth: '1100px', maxHeight: '90vh',
      disableClose: true,
      data: {
        periodo_id: periodo.id_periodo,
        periodo_descripcion: periodo.descripcion,
        cliente_id: this.selectedCliente.id_entidad,
        cliente_nombre: this.selectedCliente.nombre_legal,
        contrato_ids: this.contratos.map(c => c.id_contrato),
        cecos: this.selectedCecoIds,
      },
    });
    ref.afterClosed().subscribe((result) => {
      if (!result?.empleados?.length) return;

      // Garantiza que la tabla tenga filas para los contratos calculados:
      // si la pantalla estaba vacía o los IDs no coinciden, agregamos los
      // contratos faltantes desde contratos_data (mismo shape que el endpoint
      // de "Buscar Empleados").
      const idsCalculados = new Set<number>(
        (result.empleados as any[]).map(e => e.id_contrato),
      );
      const idsEnTabla = new Set<number>(this.contratos.map(c => c.id_contrato));
      const faltantes: any[] = (result.contratos_data || []).filter(
        (c: any) => idsCalculados.has(c.id_contrato) && !idsEnTabla.has(c.id_contrato),
      );
      if (faltantes.length) {
        const enriquecidos = faltantes.map(c => ({
          ...c,
          dias_laborados: 0,
          _devengado_basico: 0, _aux_trans: 0,
          _salud: 0, _pension: 0, _neto: 0,
        }));
        this.contratos = [...this.contratos, ...enriquecidos];
        this.aplicarFiltroEmpleados();
      }

      this.aplicarPreviewBackend(result.empleados);
      // Incremento 2.6: conserva el snapshot del preview con novedades.
      this.calculationIdActivo = result.calculation_id ?? null;
      this.puedeCerrarActivo = !!result.puede_cerrar;
      this.conciliacionActiva = result.conciliacion ?? null;
      this.bloqueantesActivos = result.bloqueantes ?? [];
      this.diagnosticoActivo = result.diagnostico_novedades ?? [];
      this.snapshotExpiraAt = result.fecha_expiracion ?? null;
      if (!this.calculationIdActivo) {
        Swal.fire('Atención', 'El preview no devolvió calculationId; deberá recalcular antes de guardar.', 'warning');
      } else if (!this.puedeCerrarActivo) {
        const n = this.bloqueantesActivos.length;
        Swal.fire('Cálculo con bloqueantes',
          `Hay ${n} novedad(es) económica(s) no procesada(s). Revise el diagnóstico; no se podrá guardar hasta corregir y recalcular.`,
          'warning');
      }
      this.cdr.markForCheck();
    });
  }

  private _filterPeriodos(val: string): any[] {
    const filterValue = val.toLowerCase();
    return this.periodos.filter(p => p.descripcion.toLowerCase().includes(filterValue));
  }

  abrirDialogoPeriodo(periodo?: any): void {
    const dialogRef = this.dialog.open(PeriodoDialogComponent, {
      width: '550px',
      data: { periodo }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.cargarPeriodos();
      }
    });
  }

  private _filterClients(name: string): Client[] {
    const filterValue = name.toLowerCase();
    return this.clientes.filter(c => c.nombre_legal.toLowerCase().includes(filterValue));
  }

  displayClient(client: Client): string {
    return client ? client.nombre_legal : '';
  }

  displayPeriodo(periodo: any): string {
    return periodo ? periodo.descripcion : '';
  }

  cargarClientes(): void {
    // tipo=EMPRESA_USUARIA: la tabla nomina_entidades_externas guarda
    // empresas usuarias/EPS/AFP/CCF/banco en el mismo lugar; sin el filtro el
    // dropdown mezcla las categorías.
    this.nominaService.getClientes({ tipo: 'EMPRESA_USUARIA', activo: 'true' }).subscribe({
      next: (res: any) => {
        this.clientes = res.results || res || [];
        this.clientControl.updateValueAndValidity(); // Disparar filtro
      },
      error: () => Swal.fire('Error', 'No se pudieron cargar los clientes', 'error')
    });
  }

  comparePeriodos(p1: any, p2: any): boolean {
    return p1 && p2 ? p1.id_periodo === p2.id_periodo : p1 === p2;
  }

  cargarPeriodos(): void {
    this.nominaService.getPeriodos().subscribe({
      next: (res: any) => {
        const data = res.results || res || [];
        // Ocultamos solo los periodos cerrados/finalizados — el resto
        // (ABIERTO / CALCULADA / VALIDADA) es elegible para recalcular o
        // re-guardar. Mantenemos compat con el legacy 'CERRADO'.
        this.periodos = Array.isArray(data)
          ? data.filter((p: any) => !['FINALIZADA', 'CERRADO'].includes(p.estado))
          : [];
        this.periodoFilterCtrl.setValue(''); // Disparar filtro
      },
      error: (err) => {
        console.error('Error cargando periodos:', err);
        this.periodos = [];
      }
    });
  }

  onClienteSelected(client: Client): void {
    if (!client || typeof client === 'string') return;

    this.invalidarCalculo();   // cambio de cliente invalida el snapshot
    this.selectedCliente = client;
    this.cecos = [];
    this.selectedCecoIds = [];
    this.contratos = [];
    this.aplicarFiltroEmpleados();
    
    this.nominaService.getCentrosCostos(client.id_entidad).subscribe({
      next: (res: any) => {
        this.cecos = res.results || res || [];
        this.cecoFilterCtrl.setValue(''); // Disparar filtro para mostrar nuevos cecos
      },
      error: () => Swal.fire('Error', 'No se pudieron cargar los centros de costo', 'error')
    });
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

  actualizarDiasYNomina(): void {
    const periodo = this.periodoControl.value;
    
    // Priorizamos los días teóricos del periodo seleccionado
    if (periodo && periodo.dias_teoricos) {
      this.diasCalculados = Number(periodo.dias_teoricos);
    } else {
      // Fallback a cálculo por fechas si no hay periodo o días teóricos
      const start = this.startDate.value;
      const end = this.endDate.value;
      if (start && end) {
        const diffTime = Math.abs(end.getTime() - start.getTime());
        this.diasCalculados = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      } else {
        this.diasCalculados = 0;
      }
    }

    // Actualizar en caliente los contratos ya cargados
    this.contratos.forEach(c => {
      c.dias_laborados = this.diasCalculados;
    });
  }

  buscarEmpleados(): void {
    if (!this.selectedCliente) {
      Swal.fire('Atención', 'Debe seleccionar un cliente', 'warning');
      return;
    }
    if (!this.periodoControl.value) {
      Swal.fire('Atención', 'Seleccione el periodo de nómina', 'warning');
      return;
    }

    this.actualizarDiasYNomina();
    this.loading = true;

    // 1) Trae contratos filtrados (UI/listado).
    this.nominaService.getContratosFiltrados({
      cliente_id: this.selectedCliente.id_entidad,
      cecos: this.selectedCecoIds
    }).subscribe({
      next: (res: any) => {
        const data = res.data || res.results || res || [];
        this.contratos = data.map((c: any) => ({
          ...c,
          dias_laborados: this.diasCalculados,
          // placeholders mientras llega el preview oficial del backend
          _devengado_basico: 0, _aux_trans: 0,
          _salud: 0, _pension: 0, _neto: 0,
        }));
        this.aplicarFiltroEmpleados();

        if (this.contratos.length === 0) {
          this.loading = false;
          Swal.fire('Info', 'No hay empleados activos para esta selección', 'info');
          return;
        }

        // 2) Pide al backend el cálculo oficial (no persiste).
        this.nominaService.calcularLiquidacion({
          periodo_id: this.periodoControl.value.id_periodo,
          cliente_id: this.selectedCliente!.id_entidad,
          cecos: this.selectedCecoIds,
          contrato_ids: this.contratos.map(c => c.id_contrato),
        }).subscribe({
          next: (preview) => {
            this.aplicarPreviewBackend(preview.empleados || []);
            this.aplicarSnapshotPlano(preview);
            this.loading = false;
          },
          error: () => {
            this.loading = false;
            Swal.fire('Error', 'No se pudo calcular la nómina en el servidor', 'error');
          }
        });
      },
      error: () => {
        this.loading = false;
        Swal.fire('Error', 'Fallo al cargar empleados', 'error');
      }
    });
  }

  /**
   * Mapea el desglose oficial calculado en backend sobre los contratos en pantalla.
   * Las fórmulas viven en el backend; aquí solo presentamos.
   */
  private aplicarPreviewBackend(empleados: any[]): void {
    // Cualquier preview invalida el snapshot previo. El flujo con novedades vuelve
    // a fijar el calculationId DESPUÉS de llamar a este método; el cálculo plano
    // (sin novedades) lo deja en null → cierre por flujo legacy.
    this.invalidarCalculo();
    this.mapearEmpleadosEnContratos(empleados);

    // Candidatos a rechazo: contratos que no intersectan el periodo (ej. retirados).
    // OJO: usamos _dias_periodo (intersección contrato↔período), NO dias_laborados,
    // porque un empleado en incapacidad total tiene dias_laborados=0 pero SÍ debe
    // entrar a la nómina (recibe incapacidad).
    const rechazables = this.contratos.filter(c => Number(c._dias_periodo ?? c.dias_laborados ?? 0) === 0);
    if (rechazables.length) {
      // Fire-and-forget: no bloquea el render. La tabla ya se ve con todos.
      this.preguntarInclusionRechazables(rechazables);
    }
  }

  /**
   * Mapeo puro del payload del backend a los contratos en pantalla.
   * No dispara el prompt de rechazables — pensado para re-consultas
   * posteriores a que el usuario ya eligió qué hacer con ellos.
   */
  private mapearEmpleadosEnContratos(empleados: any[]): void {
    const byContrato = new Map<number, any>();
    empleados.forEach(e => byContrato.set(e.id_contrato, e));
    // Guardamos el snapshot crudo para que "Exportar Soporte" pueda
    // bajar exactamente lo que el usuario vio sin recalcular.
    this._empleadosCalculados = byContrato;

    this.contratos = this.contratos.map(c => {
      const calc = byContrato.get(c.id_contrato);
      if (!calc) {
        return { ...c, dias_laborados: 0, _devengado_basico: 0, _aux_trans: 0,
          _salud: 0, _pension: 0, _total_devengado: 0, _total_deducido: 0,
          _neto: 0, _conceptos: [],
          _dias_periodo: 0, _dias_efectivos: 0, _dias_no_rem: 0,
          _dias_ausencia: 0,
          _dias_incapacidad: 0, _dias_con_derecho_aux: 0, _dias_pagados: 0,
          _dias_pagados_salario: 0, _sueldo_causado: 0,
          _ibc: 0,
          _dev_sal: 0, _dev_nosal: 0, _ded_sal_ibc: 0, _observaciones: [] };
      }
      const find = (codigo: string) =>
        Number((calc.conceptos || []).find((x: any) => x.codigo === codigo)?.valor_total || 0);
      // dias_laborados: usa el campo nuevo que excluye incapacidades y no remunerados.
      // Fallback a calc.dias por compatibilidad con respuestas antiguas del backend.
      const diasLaboradosReales = calc.dias_laborados != null
        ? Number(calc.dias_laborados)
        : Number(calc.dias || 0);
      // Sueldo Q debe reflejar el sueldo causado real (salario_dia × dias
      // pagados de salario). El backend lo expone vía calc.sueldo_causado y
      // ya descuenta ausencia/sanción/licencia NR/días no trabajados. En LEGACY
      // coincide con find('SUELDO'); en CORRECTO `find('SUELDO')` es bruto y
      // hay líneas de deducción aparte — por eso preferimos sueldo_causado.
      const sueldoCausado = calc.sueldo_causado != null
        ? Number(calc.sueldo_causado)
        : find('SUELDO');
      return {
        ...c,
        dias_laborados: diasLaboradosReales,
        _devengado_basico: sueldoCausado,
        _aux_trans: find('AUX_TRANS'),
        _salud: find('SALUD_EMP'),
        _pension: find('PENSION_EMP'),
        _total_devengado: Number(calc.total_devengado || 0),
        _total_deducido: Number(calc.total_deducido || 0),
        _neto: Number(calc.neto || 0),
        _conceptos: calc.conceptos || [],
        _dias_periodo: Number(calc.dias || 0),
        _dias_efectivos: Number(calc.dias_efectivos || 0),
        _dias_no_rem: Number(calc.dias_no_remunerados || 0),
        _dias_ausencia: Number(calc.dias_ausencia || 0),
        _dias_incapacidad: Number(calc.dias_incapacidad || 0),
        _dias_con_derecho_aux: Number(calc.dias_con_derecho_auxilio ?? diasLaboradosReales),
        _dias_pagados: Number(calc.dias_pagados ?? calc.dias ?? 0),
        _dias_pagados_salario: Number(
          calc.dias_pagados_salario ?? Math.max(Number(calc.dias || 0) - Number(calc.dias_no_remunerados || 0), 0),
        ),
        _sueldo_causado: sueldoCausado,
        _ibc: Number(calc.ibc || 0),
        _dev_sal: Number(calc.devengos_salariales || 0),
        _dev_nosal: Number(calc.devengos_no_salariales || 0),
        _ded_sal_ibc: Number(calc.deducciones_salariales_que_disminuyen_ibc || 0),
        _observaciones: Array.isArray(calc.observaciones_validacion)
          ? calc.observaciones_validacion : [],
      };
    });
    this.aplicarFiltroEmpleados();

    // Forzar re-render: OnPush + callbacks async no lo disparan por sí solos.
    this.cdr.markForCheck();
  }

  private async preguntarInclusionRechazables(rechazables: any[]): Promise<void> {
    const res = await Swal.fire({
      icon: 'question',
      title: `${rechazables.length} empleado(s) no laboraron en este periodo`,
      text: '¿Desea realizar el cálculo para todos? En cualquier caso se descargará el Excel con los no elegibles.',
      showCancelButton: true,
      confirmButtonText: 'Sí, calcular para todos',
      cancelButtonText: 'No, excluirlos',
    });
    // Ambas opciones descargan el Excel de rechazables.
    await this.exportarExcluidosExcel(rechazables);

    if (res.isConfirmed) {
      // Re-pedir al backend el cálculo forzando días completos para TODOS.
      this.loading = true;
      this.cdr.markForCheck();
      this.nominaService.calcularLiquidacion({
        periodo_id: this.periodoControl.value.id_periodo,
        cliente_id: this.selectedCliente!.id_entidad,
        cecos: this.selectedCecoIds,
        contrato_ids: this.contratos.map(c => c.id_contrato),
        forzar_dias_completos: true,
      }).subscribe({
        next: (preview) => {
          this.mapearEmpleadosEnContratos(preview.empleados || []);
          this.aplicarSnapshotPlano(preview);   // nuevo snapshot del recálculo
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.cdr.markForCheck();
          Swal.fire('Error', 'No se pudo recalcular con días completos', 'error');
        }
      });
    } else {
      // "No, excluirlos": los elegibles ya tienen sus calculos correctos desde
      // la primera llamada al backend (aplicarPreviewBackend). Solo filtramos
      // la tabla y forzamos re-render. No hace falta re-pedir al backend, lo
      // cual ahorra varios segundos en listas grandes.
      //
      // Usamos detectChanges() en vez de markForCheck() porque en modo zoneless
      // markForCheck() puede postergarse hasta el proximo evento DOM (clic),
      // dando la falsa sensacion de "no pasa nada" hasta que el usuario toca la
      // pantalla. detectChanges() dispara el render inmediato.
      const ids = new Set(rechazables.map(c => c.id_contrato));
      this.contratos = [...this.contratos.filter(c => !ids.has(c.id_contrato))];
      this.aplicarFiltroEmpleados();
      this.cdr.detectChanges();
    }
  }

  private async exportarExcluidosExcel(descartados: any[]): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Excluidos');
    sheet.columns = [
      { header: 'Contrato', key: 'codigo_contrato', width: 15 },
      { header: 'Tipo Doc', key: 'tipo_documento', width: 10 },
      { header: 'Documento', key: 'numero_documento', width: 15 },
      { header: 'Primer Nombre', key: 'primer_nombre', width: 18 },
      { header: 'Segundo Nombre', key: 'segundo_nombre', width: 18 },
      { header: 'Primer Apellido', key: 'primer_apellido', width: 18 },
      { header: 'Segundo Apellido', key: 'segundo_apellido', width: 18 },
      { header: 'Cliente', key: 'cliente', width: 28 },
      { header: 'Centro de Costo', key: 'centro_de_costo', width: 22 },
      { header: 'CECO Código', key: 'ceco_codigo', width: 14 },
      { header: 'Sede', key: 'ceco_sede', width: 14 },
      { header: 'Fecha Ingreso', key: 'fecha_ingreso', width: 14 },
      { header: 'Fecha Retiro', key: 'fecha_retiro', width: 14 },
      { header: 'Salario Mes', key: 'salario', width: 14 },
      { header: 'Aux. Transporte', key: 'auxilio_transporte', width: 14 },
      { header: 'Motivo', key: 'motivo', width: 40 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    const periodoDesc = this.periodoControl.value?.descripcion || 'Periodo';
    descartados.forEach(c => {
      sheet.addRow({
        codigo_contrato: c.codigo_contrato,
        tipo_documento: c.tipo_documento,
        numero_documento: c.numero_documento,
        primer_nombre: c.primer_nombre,
        segundo_nombre: c.segundo_nombre,
        primer_apellido: c.primer_apellido,
        segundo_apellido: c.segundo_apellido,
        cliente: c.cliente,
        centro_de_costo: c.centro_de_costo,
        ceco_codigo: c.ceco_codigo,
        ceco_sede: c.ceco_sede,
        fecha_ingreso: c.fecha_ingreso,
        fecha_retiro: c.fecha_retiro,
        salario: Number(c.salario) || 0,
        auxilio_transporte: Number(c.auxilio_transporte) || 0,
        motivo: 'Vigencia del contrato no intersecta el periodo',
      });
    });
    ['N', 'O'].forEach(k => sheet.getColumn(k).numFmt = '#,##0');

    const buffer = await workbook.xlsx.writeBuffer();
    const nombre = `Excluidos_${this.selectedCliente?.nombre_legal || 'Cliente'}_${periodoDesc}.xlsx`
      .replace(/[\/\\?*\[\]:]/g, '_');
    saveAs(new Blob([buffer]), nombre);
  }

  /**
   * Filtra la tabla en vivo conforme el usuario escribe o pega texto.
   * Matchea contra nombre completo, documento y centro de costo (case-insensitive).
   */
  aplicarFiltroEmpleados(): void {
    const term = (this.filtroBusqueda || '').trim().toLowerCase();
    if (!term) {
      this.contratosFiltrados = [...this.contratos];
    } else {
      this.contratosFiltrados = this.contratos.filter(c => {
        const nombre = `${c.primer_nombre || ''} ${c.segundo_nombre || ''} ${c.primer_apellido || ''} ${c.segundo_apellido || ''}`.toLowerCase();
        const doc = String(c.numero_documento || '').toLowerCase();
        const ceco = String(c.centro_de_costo || '').toLowerCase();
        const codigo = String(c.codigo_contrato || '').toLowerCase();
        return nombre.includes(term) || doc.includes(term) || ceco.includes(term) || codigo.includes(term);
      });
    }
    this.cdr.markForCheck();
  }

  limpiarFiltroEmpleados(): void {
    this.filtroBusqueda = '';
    this.aplicarFiltroEmpleados();
  }

  // Lecturas de presentación (NO calculan: solo leen el preview oficial del backend)
  getDevengadoBasico(c: any): number { return Number(c?._devengado_basico || 0); }
  getAuxilioTransporte(c: any): number { return Number(c?._aux_trans || 0); }
  getDeduccionSalud(c: any): number { return Number(c?._salud || 0); }
  getDeduccionPension(c: any): number { return Number(c?._pension || 0); }
  getNetoQuincena(c: any): number { return Number(c?._neto || 0); }

  /** Tooltip multi-línea con el desglose de días por categoría.
   *  Visible al hacer hover sobre la pill de "Días lab." */
  diasDesglose(c: any): string {
    const periodo = Number(c?._dias_periodo ?? c?.dias_laborados ?? 0);
    const incap = Number(c?._dias_incapacidad ?? 0);
    const noRem = Number(c?._dias_no_rem ?? 0);
    const ausencia = Number(c?._dias_ausencia ?? 0);
    const otrosNoRem = Math.max(noRem - ausencia, 0);
    const lab = Number(c?.dias_laborados ?? 0);
    const aux = Number(c?._dias_con_derecho_aux ?? lab);
    const pagados = Number(c?._dias_pagados ?? periodo);
    const pagadosSalario = Number(c?._dias_pagados_salario ?? Math.max(periodo - noRem, 0));
    const filas = [
      `Días período: ${periodo}`,
      `Días laborados: ${lab}`,
      `Días pagados salario: ${pagadosSalario}`,
    ];
    if (incap > 0) filas.push(`Incapacidad: ${incap}`);
    if (ausencia > 0) filas.push(`Ausencia: ${ausencia}`);
    if (otrosNoRem > 0) filas.push(`Otros no remunerados: ${otrosNoRem}`);
    filas.push(`Con derecho a auxilio: ${aux}`);
    filas.push(`Días pagados: ${pagados}`);
    return filas.join('\n');
  }

  descargarPlantilla(): void {
    // Incremento 5: el soporte se genera SERVER-SIDE desde el snapshot (calculationId).
    // NO se envían empleados ni valores económicos. Descargable aunque esté bloqueado.
    if (!this.calculationIdActivo) {
      Swal.fire('Genere la vista previa',
        'Calcule la vista previa para obtener el soporte verificable (se genera desde el snapshot).', 'warning');
      return;
    }
    this.guardando = true;
    this.cdr.markForCheck();

    this.nominaService.descargarSoportePreview(
      this.calculationIdActivo,
      this.selectedCliente?.id_entidad ?? null,
      this.periodoControl.value?.id_periodo ?? null,
    ).subscribe({
      next: (resp) => {
        const blob = resp.body!;
        const cd = resp.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
        const filename = m ? decodeURIComponent(m[1]) : 'Soporte_PREVIEW.xlsx';
        saveAs(blob, filename);
        this.guardando = false;
        this.cdr.markForCheck();
      },
      error: async (err) => {
        this.guardando = false;
        this.cdr.markForCheck();
        const status = err?.status;
        let msg = 'No se pudo descargar el soporte.';
        if (status === 404) msg = 'Soporte no encontrado o sin acceso. Vuelva a generar la vista previa.';
        else if (status === 410) msg = 'El soporte preview venció su retención de descarga; genere uno nuevo.';
        else if (status === 422) msg = 'El snapshot es anterior a esta versión; genere una nueva vista previa.';
        else if (err?.error instanceof Blob) {
          try { msg = JSON.parse(await err.error.text())?.mensaje || msg; } catch {}
        }
        Swal.fire('Error', msg, 'error');
      },
    });
  }

  /**
   * Persiste la nómina calculada en backend. Envía el snapshot oficial
   * (`_empleadosCalculados`) que devolvió /payroll/calcular o el flujo de
   * novedades — así lo guardado coincide exactamente con lo que el usuario
   * vio. El periodo queda en estado CALCULADA y admite re-guardar mientras
   * no pase a VALIDADA / FINALIZADA.
   */
  async guardarNomina(): Promise<void> {
    if (!this.periodoControl.value) {
      Swal.fire('Atención', 'Seleccione el periodo de nómina.', 'warning'); return;
    }
    if (this._empleadosCalculados.size === 0) {
      Swal.fire('Atención', 'Primero calcule la nómina antes de guardarla.', 'warning'); return;
    }

    if (this.guardandoNomina) return; // guard anti-doble-clic (defensa adicional al server-side)

    const periodo = this.periodoControl.value;

    // Flujo con novedades (hay calculationId): no se puede guardar con bloqueantes,
    // conciliación incorrecta o preview vencido.
    if (this.calculationIdActivo && !this.puedeGuardar) {
      Swal.fire('No se puede guardar',
        'El cálculo tiene novedades económicas bloqueantes, la conciliación no cierra o el preview venció. '
        + 'Corrija el Excel/homologación y genere nuevamente el cálculo.', 'warning');
      return;
    }

    // Inc.2.7: el cierre legacy quedó ELIMINADO. SIEMPRE se cierra contra un snapshot;
    // ambos flujos (plano y con novedades) generan calculationId en la vista previa.
    // El backend recupera el resultado verificado del snapshot e ignora cualquier detalle.
    if (!this.calculationIdActivo) {
      Swal.fire('Genere la vista previa',
        'Debe calcular la vista previa antes de guardar para obtener un cálculo verificable.', 'warning');
      return;
    }
    const payload: GuardarLiquidacionPayload = {
      periodo_id: periodo.id_periodo,
      cliente_id: this.selectedCliente?.id_entidad ?? null,
      calculation_id: this.calculationIdActivo,
    };

    const estadoActual = String(periodo.estado || '').toUpperCase();
    if (estadoActual === 'CALCULADA') {
      const conf = await Swal.fire({
        icon: 'warning',
        title: 'Periodo ya estaba en CALCULADA',
        text: '¿Sobreescribir los registros existentes con los datos actuales?',
        showCancelButton: true,
        confirmButtonText: 'Sí, sobreescribir',
        cancelButtonText: 'Cancelar',
      });
      if (!conf.isConfirmed) return;
    }

    this.guardandoNomina = true;
    this.cdr.markForCheck();

    this.nominaService.guardarLiquidacion(payload).subscribe({
      next: (resp) => {
        this.guardandoNomina = false;
        if (periodo) periodo.estado = resp.estado_periodo;
        this.cargarPeriodos();
        this.invalidarCalculo();   // snapshot consumido: evita re-cierre del mismo
        this.cdr.markForCheck();
        if (resp.idempotent_replay) {
          Swal.fire('Liquidación ya guardada',
            'Esta liquidación ya había sido creada (replay idempotente); no se duplicó.', 'info');
        } else {
          Swal.fire('Nómina guardada',
            `${resp.creados_nomina} empleados y ${resp.creados_conceptos} conceptos persistidos.` +
              (resp.recalculado ? ' Se sobreescribieron los registros previos.' : ''),
            'success');
        }
      },
      error: (err: HttpErrorResponse) => {
        this.guardandoNomina = false;
        const body = err?.error || {};
        if (err.status === 409) {
          // Cálculo desactualizado / vencido / consumido / no autorizado → recalcular.
          this.invalidarCalculo();
          const cambios = (body.cambiosDetectados || []).join(', ');
          Swal.fire('Cálculo desactualizado',
            (body.mensaje || 'Los datos cambiaron desde la vista previa.')
              + (cambios ? ` Cambios: ${cambios}.` : '') + ' Genere nuevamente el cálculo.', 'warning');
        } else if (err.status === 422) {
          if (body.codigo === 'CALCULATION_ID_REQUERIDO') {
            this.invalidarCalculo();
            Swal.fire('Recalcular requerido',
              body.mensaje || 'Debe generar nuevamente la vista previa antes de guardar.', 'warning');
          } else {
            const n = body.empleados_bloqueados ?? this.bloqueantesActivos.length;
            Swal.fire('No se puede guardar',
              (body.mensaje || 'La liquidación no puede guardarse porque existen novedades económicas '
                + 'que no fueron procesadas correctamente.')
                + ` (${n} bloqueante[s]). Revise el detalle y genere nuevamente el cálculo.`, 'error');
          }
        } else {
          const msg = body.error || body.message || body.mensaje || 'No se pudo guardar la nómina.';
          Swal.fire('Error', msg, 'error');
        }
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Guardado PARCIAL: cierra la nómina SOLO para los empleados sin novedades
   * bloqueantes y descarga un Excel con los excluidos (empleado + concepto +
   * motivo) para su corrección. Se usa cuando el cierre total está bloqueado
   * (`puedeCerrarActivo=false`). El backend re-valida el snapshot y persiste
   * únicamente los limpios; los excluidos NO se guardan.
   */
  async guardarNominaParcial(): Promise<void> {
    if (!this.periodoControl.value) {
      Swal.fire('Atención', 'Seleccione el periodo de nómina.', 'warning'); return;
    }
    if (this._empleadosCalculados.size === 0) {
      Swal.fire('Atención', 'Primero calcule la nómina antes de guardarla.', 'warning'); return;
    }
    if (!this.calculationIdActivo) {
      Swal.fire('Genere la vista previa',
        'Debe calcular la vista previa antes de guardar (cálculo verificable).', 'warning'); return;
    }
    if (this.guardandoParcial || this.guardandoNomina) return; // guard anti-doble-clic

    const periodo = this.periodoControl.value;
    const nBloq = this.conciliacionActiva?.total_bloqueantes ?? this.bloqueantesActivos.length;
    const yaCalculada = String(periodo.estado || '').toUpperCase() === 'CALCULADA';

    const conf = await Swal.fire({
      icon: 'warning',
      title: 'Guardar solo los que sí liquidan',
      html: 'Se cerrará la nómina <strong>solo para los empleados sin novedades bloqueantes</strong>. '
        + `Los empleados con novedades no procesables${nBloq ? ` (${nBloq} bloqueante[s])` : ''} `
        + '<strong>NO se guardarán</strong> y se descargarán en un Excel para corregirlos.'
        + (yaCalculada
            ? '<br><br>El periodo ya está en CALCULADA: se sobreescribirán los registros existentes.' : ''),
      showCancelButton: true,
      confirmButtonText: 'Sí, guardar parcial',
      cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;

    const payload: GuardarLiquidacionPayload = {
      periodo_id: periodo.id_periodo,
      cliente_id: this.selectedCliente?.id_entidad ?? null,
      calculation_id: this.calculationIdActivo,
      parcial: true,
    };

    this.guardandoParcial = true;
    this.cdr.markForCheck();

    this.nominaService.guardarLiquidacion(payload).subscribe({
      next: async (resp) => {
        this.guardandoParcial = false;
        if (periodo) periodo.estado = resp.estado_periodo;
        // Exporta el reporte de excluidos ANTES de invalidar (usa datos en pantalla).
        const excluidos = resp.excluidos || [];
        if (excluidos.length) {
          try { await this.exportarExcluidosBloqueantesExcel(excluidos); } catch { /* no bloquear el flujo */ }
        }
        this.cargarPeriodos();
        this.invalidarCalculo();   // snapshot consumido
        this.cdr.markForCheck();
        if (resp.idempotent_replay) {
          Swal.fire('Liquidación ya guardada',
            'Esta liquidación ya había sido creada (replay idempotente); no se duplicó.', 'info');
        } else {
          Swal.fire('Nómina guardada (parcial)',
            `${resp.creados_nomina} empleado(s) liquidado(s) y guardado(s). `
            + `${resp.empleados_excluidos ?? excluidos.length} empleado(s) EXCLUIDO(S) por novedades `
            + 'bloqueantes (descargados en Excel para corregir).',
            'success');
        }
      },
      error: (err: HttpErrorResponse) => {
        this.guardandoParcial = false;
        const body = err?.error || {};
        if (err.status === 409) {
          this.invalidarCalculo();
          const cambios = (body.cambiosDetectados || []).join(', ');
          Swal.fire('Cálculo desactualizado',
            (body.mensaje || 'Los datos cambiaron desde la vista previa.')
              + (cambios ? ` Cambios: ${cambios}.` : '') + ' Genere nuevamente el cálculo.', 'warning');
        } else if (err.status === 422 && body.codigo === 'SIN_EMPLEADOS_LIQUIDABLES') {
          Swal.fire('No hay nada que guardar',
            body.mensaje || 'Todos los empleados tienen novedades bloqueantes; no hay empleados liquidables.',
            'error');
        } else if (err.status === 422 && body.codigo === 'CALCULATION_ID_REQUERIDO') {
          this.invalidarCalculo();
          Swal.fire('Recalcular requerido',
            body.mensaje || 'Debe generar nuevamente la vista previa antes de guardar.', 'warning');
        } else {
          const msg = body.error || body.message || body.mensaje || 'No se pudo guardar la nómina parcial.';
          Swal.fire('Error', msg, 'error');
        }
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Excel con los empleados excluidos del guardado parcial: una fila por cada
   * novedad bloqueante (empleado + concepto + motivo). Une la respuesta del
   * backend (id_contrato + conceptos) con los datos en pantalla (nombre/doc/CECO).
   */
  private async exportarExcluidosBloqueantesExcel(excluidos: EmpleadoExcluido[]): Promise<void> {
    const byContrato = new Map<number, any>();
    this.contratos.forEach(c => byContrato.set(c.id_contrato, c));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Excluidos por bloqueante');
    sheet.columns = [
      { header: 'Contrato', key: 'codigo_contrato', width: 15 },
      { header: 'Documento', key: 'numero_documento', width: 15 },
      { header: 'Empleado', key: 'empleado', width: 30 },
      { header: 'Centro de Costo', key: 'centro_de_costo', width: 24 },
      { header: 'Código Novedad', key: 'codigo', width: 16 },
      { header: 'Descripción', key: 'descripcion', width: 34 },
      { header: 'Clasificación', key: 'clasificacion', width: 18 },
      { header: 'Valor', key: 'valor_total', width: 14 },
      { header: 'Motivo', key: 'observacion', width: 48 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'B71C1C' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    excluidos.forEach(e => {
      const c = byContrato.get(e.id_contrato) || {};
      const empleado = `${c.primer_nombre || ''} ${c.segundo_nombre || ''} ${c.primer_apellido || ''} ${c.segundo_apellido || ''}`
        .replace(/\s+/g, ' ').trim();
      const conceptos = (e.conceptos_bloqueantes && e.conceptos_bloqueantes.length)
        ? e.conceptos_bloqueantes
        : [{ codigo: '', descripcion: '', naturaleza: '', clasificacion: '', valor_total: 0,
             observacion: 'Bloqueante sin detalle' }];
      conceptos.forEach(cb => {
        sheet.addRow({
          codigo_contrato: c.codigo_contrato,
          numero_documento: c.numero_documento,
          empleado,
          centro_de_costo: c.centro_de_costo,
          codigo: cb.codigo,
          descripcion: cb.descripcion,
          clasificacion: cb.clasificacion,
          valor_total: Number(cb.valor_total) || 0,
          observacion: cb.observacion,
        });
      });
    });
    sheet.getColumn('H').numFmt = '#,##0';   // columna Valor

    const periodoDesc = this.periodoControl.value?.descripcion || 'Periodo';
    const buffer = await workbook.xlsx.writeBuffer();
    const nombre = `Excluidos_bloqueantes_${this.selectedCliente?.nombre_legal || 'Cliente'}_${periodoDesc}.xlsx`
      .replace(/[\/\\?*\[\]:]/g, '_');
    saveAs(new Blob([buffer]), nombre);
  }

}

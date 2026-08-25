
import { Component, OnInit, signal, inject, ChangeDetectionStrategy, computed } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';

import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { TesoreriaService, PersonaTesoreriaItem } from '../../service/teroreria/tesoreria.service';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import { EditWorkerDialogComponent } from './components/edit-worker-dialog/edit-worker-dialog.component';

// Use the service interface directly
export type Worker = PersonaTesoreriaItem;

@Component({
  selector: 'app-manage-workers',
  standalone: true,
  imports: [
    FormsModule,
    MatSlideToggleModule,
    MatMenuModule,
    MatIconModule,
    MatButtonModule,
    MatToolbarModule,
    MatCardModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatInputModule,
    MatFormFieldModule,
    StandardFilterTable,
    ColumnCellTemplateDirective
],
  templateUrl: './manage-workers.component.html',
  styleUrls: ['./manage-workers.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ManageWorkersComponent implements OnInit {
  private tesoreriaService = inject(TesoreriaService);
  private dialog = inject(MatDialog);

  // --- State Signals ---
  rows = signal<Worker[]>([]);
  loading = signal<boolean>(true);
  showInactive = signal(false);
  totalActivos = signal<number>(0);

  /** Estado de la paginación server-side. */
  pageIndex = signal<number>(0);
  pageSize = signal<number>(50);
  totalRegistros = signal<number>(0);

  // Search State
  searchCedula = signal<string>('');

  // Computed metric
  numeroActivo = computed(() => this.totalActivos());

  /** Definición de columnas para StandardFilterTable */
  readonly columns: ColumnDefinition[] = [
    /** ======= Acciones ======= */
    { name: 'acciones', header: 'Acciones', type: 'custom', width: '8ch', stickyStart: true, filterable: false },

    /** ======= Estados (sticky) ======= */
    { name: 'bloqueado', header: 'Bloqueado', type: 'custom', width: '12ch', stickyStart: true, filterable: false },
    { name: 'fecha_bloqueo', header: 'Fecha Bloqueo', type: 'date', width: '18ch' },
    { name: 'activo', header: 'Activo', type: 'custom', width: '12ch', stickyStart: true, filterable: false },

    /** ======= Identificación ======= */
    { name: 'codigo', header: 'Código', type: 'text', width: '10ch', filterable: false },
    { name: 'numero_documento', header: 'Número Documento', type: 'text', width: '14ch', stickyStart: true },
    { name: 'nombre', header: 'Nombre', type: 'text', width: '26ch' },
    { name: 'ingreso', header: 'Ingreso', type: 'text', width: '15ch' },
    { name: 'temporal', header: 'Temporal', type: 'text', width: '20ch' },
    { name: 'finca', header: 'Finca', type: 'text', width: '12ch' },

    /** ======= Dinero (format currency) y conteos (cuotas, sin format) ======= */
    { name: 'salario', header: 'Salario', type: 'number', format: 'currency', width: '12ch', filterable: false },
    { name: 'saldo_pendiente', header: 'Saldo Pendiente', type: 'number', format: 'currency', width: '14ch', filterable: false },
    { name: 'saldos', header: 'Saldos', type: 'number', format: 'currency', width: '12ch', filterable: false },
    { name: 'fondos', header: 'Fondos', type: 'number', format: 'currency', width: '12ch', filterable: false },
    { name: 'mercados', header: 'Mercados', type: 'number', format: 'currency', width: '12ch', filterable: false },
    { name: 'cuotas_mercados', header: 'Cuotas Mercados', type: 'number', width: '12ch', filterable: false },

    { name: 'prestamo_para_descontar', header: 'Préstamo p/Descontar', type: 'number', format: 'currency', width: '16ch', filterable: false },
    { name: 'cuotas_prestamos_para_descontar', header: 'Cuotas Préstamo', type: 'number', width: '12ch', filterable: false },

    { name: 'casino', header: 'Casino', type: 'number', format: 'currency', width: '10ch', filterable: false },
    { name: 'valor_anchetas', header: 'Valor Anchetas', type: 'number', format: 'currency', width: '14ch', filterable: false },
    { name: 'cuotas_anchetas', header: 'Cuotas Anchetas', type: 'number', width: '12ch', filterable: false },

    { name: 'fondo', header: 'Fondo', type: 'number', format: 'currency', width: '10ch', filterable: false },
    { name: 'carnet', header: 'Carnet', type: 'number', format: 'currency', width: '10ch', filterable: false },
    { name: 'seguro_funerario', header: 'Seguro Funerario', type: 'number', format: 'currency', width: '14ch', filterable: false },

    { name: 'prestamo_para_hacer', header: 'Préstamo p/Hacer', type: 'number', format: 'currency', width: '14ch', filterable: false },
    { name: 'cuotas_prestamo_para_hacer', header: 'Cuotas p/Hacer', type: 'number', width: '12ch', filterable: false },

    { name: 'anticipo_liquidacion', header: 'Anticipo Liquidación', type: 'number', format: 'currency', width: '16ch', filterable: false },
    { name: 'cuentas', header: 'Cuentas', type: 'number', format: 'currency', width: '10ch', filterable: false },
  ];

  ngOnInit(): void {
    this.getWorkers();
    this.cargarResumen();
  }

  /**
   * El contador de activos venía de contar el array completo en cliente, cosa
   * que ya no existe: ahora solo llega una página. Lo resuelve el backend con
   * un COUNT, que es lo que siempre debió hacer.
   */
  private async cargarResumen() {
    try {
      const r = await this.tesoreriaService.traerResumenPersonas();
      this.totalActivos.set(r.activos);
    } catch {
      this.totalActivos.set(0);
    }
  }

  /** =================== Carga de datos =================== */
  async getWorkers() {
    this.loading.set(true);

    try {
      // Paginación REAL contra el servidor: antes se descargaban 50.190 filas
      // (37,3 MB) —o 6.662 (4,9 MB) filtrando por activo— para pintar 10.
      // Ahora viaja solo la página pedida: ~38 KB.
      const soloActivos = !this.showInactive();
      const response = await this.tesoreriaService.traerDatosbasePaginado(
        this.pageIndex(), this.pageSize(), this.searchCedula().trim(), soloActivos
      );

      this.rows.set(response.results ?? []);
      this.totalRegistros.set(response.count ?? 0);
    } catch (error) {
      this.mostrarErrorCarga();
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /** =================== Buscar por Cédula =================== */
  async buscarPorCedula() {
    const cedula = this.searchCedula().trim();
    if (!cedula) {
      this.getWorkers();
      return;
    }

    this.loading.set(true);
    try {
      // Intenta usar el search endpoint para tolerar búsquedas parciales (opcional),
      // pero usar el endpoint exacto (por ID) es más rápido para consultas por cédula directa
      const worker = await this.tesoreriaService.traerDatosbasePorDocumento(cedula);
      if (worker) {
        this.rows.set([worker]); // Mostrar solo el encontrado
      } else {
        this.rows.set([]);
        Swal.fire({
          icon: 'info',
          title: 'No encontrado',
          text: `No se encontró ningún trabajador con el documento ${cedula}`,
          timer: 2000
        });
      }
    } catch (error) {
      this.mostrarErrorCarga();
    } finally {
      this.loading.set(false);
    }
  }

  limpiarBusqueda() {
    this.searchCedula.set('');
    this.getWorkers();
  }

  private mostrarErrorCarga() {
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudo obtener la información.',
    });
  }

  /** =================== Edicion =================== */
  openEditDialog(worker: Worker) {
    const dialogRef = this.dialog.open(EditWorkerDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { worker }
    });

    dialogRef.afterClosed().subscribe(async (result: Worker | undefined) => {
      if (!result) return; // Cancelado

      this.loading.set(true);
      try {
        await this.tesoreriaService.actualizarDatosbaseCompleto(result.numero_documento, result);

        // Optimistic Update
        this.rows.update(current =>
          current.map(w => w.numero_documento === result.numero_documento ? result : w)
        );

        Swal.fire({
          icon: 'success',
          title: 'Actualizado',
          text: 'El trabajador ha sido actualizado correctamente.',
          timer: 2000,
          showConfirmButton: false
        });

      } catch (error) {
        console.error(error);
        Swal.fire('Error', 'No se pudo actualizar el trabajador. Verifique que todos los campos sean válidos.', 'error');
      } finally {
        this.loading.set(false);
      }
    });
  }

  /** =================== Lógica de switches =================== */
  async toggleEstado(worker: Worker, tipo: 'bloqueado' | 'activo'): Promise<void> {
    const nuevoEstado = !worker[tipo];
    let observacion = '';

    if (tipo === 'bloqueado') {
      const { value: comentario } = await Swal.fire({
        title: nuevoEstado ? 'Motivo del bloqueo' : 'Motivo del desbloqueo',
        input: 'textarea',
        inputPlaceholder: 'Escribe una observación...',
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => (!value ? 'Debes escribir una observación' : null as any),
      });
      if (comentario === undefined) return;
      observacion = comentario;
    }

    const cambios: any = { [tipo]: nuevoEstado };

    if (tipo === 'bloqueado') {
      if (nuevoEstado) {
        cambios.fecha_bloqueo = new Date().toISOString();
        cambios.observacion_bloqueo = observacion || undefined;
      } else {
        cambios.fecha_bloqueo = null;
        cambios.fecha_desbloqueo = new Date().toISOString();
        cambios.observacion_desbloqueo = observacion || undefined;
      }
    }

    try {
      await this.tesoreriaService.actualizarEstado(String(worker.numero_documento), cambios);

      // Optimistic update via Signals
      this.rows.update(current =>
        current.map(w => {
          if (w.numero_documento === worker.numero_documento) {
            return { ...w, ...cambios };
          }
          return w;
        })
      );

      Swal.fire('Estado actualizado', `El estado de ${tipo} se ha actualizado correctamente`, 'success');
    } catch (error) {
      Swal.fire('Error', `No se pudo actualizar el estado de ${tipo}`, 'error');
    }
  }

  toggleShowInactive(event: any) {
    this.showInactive.set(event.checked);
    // Ya no hace falta avisar de nada: incluir inactivos solo cambia el filtro
    // de la consulta paginada, sigue viajando una página (~38 KB).
    this.pageIndex.set(0);
    this.getWorkers();
  }

  /** El paginador de la tabla pide otra página al servidor. */
  onPageChange(e: { page: number; size: number }) {
    this.pageIndex.set(e.page);
    this.pageSize.set(e.size);
    this.getWorkers();
  }

  /** La búsqueda la resuelve el backend sobre TODO el universo, no sobre la página. */
  onServerSearch(term: string) {
    this.searchCedula.set(term);
    this.pageIndex.set(0);
    this.getWorkers();
  }

  /** =================== Utilidades existentes =================== */
  resetearValores() {
    this.tesoreriaService.resetearValoresQuincena()
      .then(() => {
        Swal.fire('Valores reseteados', 'Los valores de la quincena han sido reseteados correctamente.', 'success');
        this.getWorkers();
      })
      .catch(() => Swal.fire('Error', 'Error al resetear los valores', 'error'));
  }

  async generarExcelDatosBase() {
    Swal.fire({
      title: 'Generando Excel',
      text: 'Descargando todos los registros, por favor espera…',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const rows = await this.tesoreriaService.traerTodosLosDatos();

      if (!Array.isArray(rows) || rows.length === 0) {
        Swal.fire('Aviso', 'No se encontraron datos base.', 'info');
        return;
      }

      const toNum = (v: any) => {
        const n = Number(String(v ?? '').toString().replace(/[, ]/g, ''));
        return Number.isFinite(n) ? n : 0;
      };

      const HEADERS = [
        'CODIGO', 'CEDULA', 'NOMBRE', 'INGRESO', 'TEMPORAL', 'FINCA',
        'ACTIVO', 'BLOQUEADO', 'FECHA BLOQUEO', 'FECHA DESBLOQUEO',
        'OBS. BLOQUEO', 'OBS. DESBLOQUEO',
        'SALARIO', 'SALDO PENDIENTE', 'SALDOS', 'FONDOS', 'MERCADOS',
        'CUOTAS MERCADOS', 'PRESTAMO P/DESCONTAR', 'CUOTAS PREST. P/DESCONTAR',
        'CASINO', 'ANCHETAS', 'CUOTAS ANCHETAS', 'FONDO',
        'CARNET', 'SEGURO FUNERARIO',
        'PRESTAMO P/HACER', 'CUOTAS PREST. P/HACER',
        'ANTICIPO LIQUIDACION', 'CUENTAS',
        'FECHA CREACION', 'FECHA ACTUALIZACION',
      ];

      const data = rows.map((r) => {
        const cedula = r?.numero_documento ?? '';
        const cedulaStr = typeof cedula === 'string' ? cedula : String(cedula);

        return {
          'CODIGO': r?.codigo ?? '',
          'CEDULA': cedulaStr,
          'NOMBRE': r?.nombre ?? '',
          'INGRESO': r?.ingreso ?? '',
          'TEMPORAL': r?.temporal ?? '',
          'FINCA': r?.finca ?? '',
          'ACTIVO': r?.activo ? 'SI' : 'NO',
          'BLOQUEADO': r?.bloqueado ? 'SI' : 'NO',
          'FECHA BLOQUEO': r?.fecha_bloqueo ?? '',
          'FECHA DESBLOQUEO': r?.fecha_desbloqueo ?? '',
          'OBS. BLOQUEO': r?.observacion_bloqueo ?? '',
          'OBS. DESBLOQUEO': r?.observacion_desbloqueo ?? '',
          'SALARIO': toNum(r?.salario),
          'SALDO PENDIENTE': toNum(r?.saldo_pendiente),
          'SALDOS': toNum(r?.saldos),
          'FONDOS': toNum(r?.fondos),
          'MERCADOS': toNum(r?.mercados),
          'CUOTAS MERCADOS': toNum(r?.cuotas_mercados),
          'PRESTAMO P/DESCONTAR': toNum(r?.prestamo_para_descontar),
          'CUOTAS PREST. P/DESCONTAR': toNum(r?.cuotas_prestamos_para_descontar),
          'CASINO': toNum(r?.casino),
          'ANCHETAS': toNum(r?.valor_anchetas),
          'CUOTAS ANCHETAS': toNum(r?.cuotas_anchetas),
          'FONDO': toNum(r?.fondo),
          'CARNET': toNum(r?.carnet),
          'SEGURO FUNERARIO': toNum(r?.seguro_funerario),
          'PRESTAMO P/HACER': toNum(r?.prestamo_para_hacer),
          'CUOTAS PREST. P/HACER': toNum(r?.cuotas_prestamo_para_hacer),
          'ANTICIPO LIQUIDACION': toNum(r?.anticipo_liquidacion),
          'CUENTAS': toNum(r?.cuentas),
          'FECHA CREACION': r?.created_at ?? '',
          'FECHA ACTUALIZACION': r?.updated_at ?? '',
        };
      });

      const ws = XLSX.utils.json_to_sheet(data, { header: HEADERS });

      // Forzar cédula como texto para preservar ceros a la izquierda
      if (ws['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r + 1; R <= range.e.r; R++) {
          const addr = XLSX.utils.encode_cell({ c: 1, r: R }); // columna B = CEDULA
          if (ws[addr]) ws[addr].t = 's';
        }
      }

      ws['!cols'] = [
        { wch: 10 },  // CODIGO
        { wch: 16 },  // CEDULA
        { wch: 30 },  // NOMBRE
        { wch: 12 },  // INGRESO
        { wch: 12 },  // TEMPORAL
        { wch: 16 },  // FINCA
        { wch: 8 },   // ACTIVO
        { wch: 10 },  // BLOQUEADO
        { wch: 14 },  // FECHA BLOQUEO
        { wch: 16 },  // FECHA DESBLOQUEO
        { wch: 25 },  // OBS. BLOQUEO
        { wch: 25 },  // OBS. DESBLOQUEO
        { wch: 12 },  // SALARIO
        { wch: 14 },  // SALDO PENDIENTE
        { wch: 12 },  // SALDOS
        { wch: 10 },  // FONDOS
        { wch: 12 },  // MERCADOS
        { wch: 16 },  // CUOTAS MERCADOS
        { wch: 20 },  // PRESTAMO P/DESCONTAR
        { wch: 24 },  // CUOTAS PREST. P/DESCONTAR
        { wch: 10 },  // CASINO
        { wch: 12 },  // ANCHETAS
        { wch: 16 },  // CUOTAS ANCHETAS
        { wch: 10 },  // FONDO
        { wch: 10 },  // CARNET
        { wch: 18 },  // SEGURO FUNERARIO
        { wch: 18 },  // PRESTAMO P/HACER
        { wch: 22 },  // CUOTAS PREST. P/HACER
        { wch: 20 },  // ANTICIPO LIQUIDACION
        { wch: 12 },  // CUENTAS
        { wch: 18 },  // FECHA CREACION
        { wch: 20 },  // FECHA ACTUALIZACION
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Datos base');

      const d = new Date();
      const fname = `datos_base_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.xlsx`;

      Swal.close();
      XLSX.writeFile(wb, fname);

      Swal.fire({
        icon: 'success',
        title: 'Excel generado',
        text: `Se exportaron ${rows.length} registros correctamente.`,
        timer: 2500,
        showConfirmButton: false,
      });
    } catch (e) {
      Swal.fire('Error', 'Error al extraer los datos base', 'error');
    }
  }
}

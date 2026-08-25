import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import Swal from 'sweetalert2';
import { SharedModule } from '../../../../../../shared/shared.module';
import { AutorizacionesService } from '../../../authorizations/services/autorizaciones/autorizaciones.service';
import { HistorialService } from '../../../history/service/historial/historial.service';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { MatDialog } from '@angular/material/dialog';
import { HistorialDialogComponent } from '../../../authorizations/pages/autorizacion-dinamica/historial-dialog/historial-dialog.component';

/** SweetAlert2 pinta sobre <body>, fuera del encapsulado del componente: no ve las CSS vars. */
const NAVY = '#21263C';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-prestamo-calamidad',
  imports: [SharedModule],
  templateUrl: './prestamo-calamidad.component.html',
  styleUrl: './prestamo-calamidad.component.css'
})
export class PrestamoCalamidadComponent implements OnInit {
  searchForm!: FormGroup;
  executeForm!: FormGroup;

  datosOperario: any = null;
  nombreOperario: string = '';

  transaccionesPendientes: any[] = [];
  transaccionSeleccionada: any = null;
  loadingTransacciones = false;
  limiteDisponible: number = 0;

  user: any;
  rolUsuario: string = '';

  constructor(
    private fb: FormBuilder,
    private autorizacionesService: AutorizacionesService,
    private historialService: HistorialService,
    private utilityService: UtilityServiceService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.user = this.utilityService.getUser();
    if (this.user) {
      this.rolUsuario = this.user.rol?.nombre ?? '';
    }

    this.searchForm = this.fb.group({
      numero_documento: ['', [Validators.required, Validators.pattern(/^[A-Za-z]?\d+$/)]]
    });

    this.executeForm = this.fb.group({
      valor: ['', [Validators.required]],
      cuotas: ['', [Validators.required, Validators.min(1), Validators.max(4)]]
    });
  }

  formatCurrency(value: any): string {
    if (value === null || value === undefined || value === '') return '0';
    return Number(value).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  formatCurrencyInput(event: any) {
    const input = event.target;
    const digits = input.value.replace(/\D/g, '');
    // Sin esta guarda, borrar el campo entero lo repuebla con "0" y hay que borrarlo dos veces.
    input.value = digits ? Number(digits).toLocaleString('es-CO') : '';
  }

  async buscarEmpleado() {
    if (this.searchForm.invalid) {
      this.searchForm.markAllAsTouched();
      return;
    }

    const doc = this.searchForm.value.numero_documento.trim().toUpperCase();

    Swal.fire({
      title: 'Buscando trabajador...',
      text: 'Por favor, espera.',
      allowOutsideClick: false, allowEscapeKey: false, showConfirmButton: false,
      didOpen: () => { Swal.showLoading(); }
    });

    try {
      // Validar si existe, está activo y no bloqueado
      const statusData: any = await this.historialService.getPersonaTesoreriaStatus(doc).toPromise();

      if (!statusData || statusData.error) {
        Swal.fire({
          icon: 'error', title: 'Empleado no encontrado',
          text: 'Este empleado no existe, no está registrado en esta quincena o no pertenece a la empresa.',
        });
        return;
      }

      if (statusData.activo === false) {
        Swal.fire({
          icon: 'error', title: 'Empleado inactivo',
          text: 'El empleado con el número de documento proporcionado se encuentra inactivo y no es válido para procesar autorizaciones.',
        });
        return;
      }

      if (statusData.bloqueado === true) {
        let fechaStr = 'fecha desconocida';
        if (statusData.fecha_bloqueo) {
          const d = new Date(statusData.fecha_bloqueo);
          fechaStr = d.toLocaleDateString('es-CO') + ' a las ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        }
        const motivo = statusData.observacion_bloqueo ? statusData.observacion_bloqueo : 'Sin motivo especificado';

        Swal.fire({
          icon: 'error', title: 'Empleado bloqueado',
          text: `El empleado se encuentra bloqueado desde: ${fechaStr}.\n\nMotivo: ${motivo}`,
        });
        return;
      }

      const data = await this.autorizacionesService.traerPersonaTesoreria(doc);
      Swal.close();

      this.datosOperario = data;
      this.nombreOperario = data.nombre || '';

      // Cupo disponible (misma lógica que verificarCondiciones)
      this.limiteDisponible = this.autorizacionesService.calcularCupoDisponible(data, 'prestamo');

      this.cargarTransaccionesPendientes(doc);
    } catch (error: any) {
      Swal.close();
      if (error?.status === 404) {
        Swal.fire('No encontrado', 'Este empleado no existe en la base de datos (puede que no esté registrado en la quincena actual o no pertenezca a la empresa).', 'error');
      } else {
        Swal.fire('Error', 'Hubo un problema al buscar el operario.', 'error');
      }
    } finally {
      // Zoneless + OnPush: sin esto la vista se queda en el buscador aunque ya haya datos.
      this.cdr.markForCheck();
    }
  }

  cargarTransaccionesPendientes(doc: string) {
    this.loadingTransacciones = true;
    this.transaccionesPendientes = [];
    this.transaccionSeleccionada = null;

    this.historialService.getHistorialTransaccionesPorDocumento(doc).subscribe({
      next: (res: any) => {
        const rawList = Array.isArray(res) ? res : (res.results || res.data || []);
        // Filtrar pendientes de tipo préstamo (dinero, seguro funerario, otro): todo
        // lo que NO sea mercado. !includes('mercado') y no !== 'mercado': el concepto
        // mercado llega en variantes ("Mercado", "autorizacion de mercado autorizacion"...)
        // y con la igualdad exacta se colaban como préstamo miles de autorizaciones de mercado.
        this.transaccionesPendientes = rawList.filter(
          (tx: any) => tx.estado === 'PENDIENTE' && !(tx.autorizacion_concepto || '').toLowerCase().includes('mercado')
        ).sort((a: any, b: any) => {
          return new Date(b.autorizado_en || 0).getTime() - new Date(a.autorizado_en || 0).getTime();
        });
        this.loadingTransacciones = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingTransacciones = false;
        // Sin markForCheck en la rama de error el spinner gira para siempre.
        this.cdr.markForCheck();
      }
    });
  }

  seleccionarTransaccion(tx: any) {
    this.transaccionSeleccionada = tx;
    this.executeForm.patchValue({
      valor: Number(tx.autorizacion_monto).toLocaleString('es-CO', { maximumFractionDigits: 0 }),
      cuotas: tx.autorizacion_cuotas || 1
    });
  }

  limpiarSeleccion() {
    this.transaccionSeleccionada = null;
    this.executeForm.reset();
  }

  cancelar() {
    this.datosOperario = null;
    this.nombreOperario = '';
    this.transaccionesPendientes = [];
    this.transaccionSeleccionada = null;
    this.limiteDisponible = 0;
    this.searchForm.reset();
    this.executeForm.reset();
    this.cdr.markForCheck();
  }

  abrirHistorial() {
    if (!this.datosOperario) return;
    this.dialog.open(HistorialDialogComponent, {
      width: '80vw', maxWidth: '90vw', height: '80vh',
      panelClass: 'historial-dialog-panel',
      data: { numeroDocumento: this.datosOperario.numero_documento }
    });
  }

  async ejecutarPrestamo() {
    if (!this.transaccionSeleccionada || this.executeForm.invalid) {
      this.executeForm.markAllAsTouched();
      return;
    }

    const valorStr = String(this.executeForm.value.valor).replace(/\D/g, '');
    const valorNumerico = parseInt(valorStr, 10);
    const montoAutorizado = Number(this.transaccionSeleccionada.autorizacion_monto);

    if (!valorNumerico || valorNumerico <= 0) { Swal.fire('Error', 'El valor debe ser mayor a 0.', 'error'); return; }
    const rolesLibres = ['TIENDA', 'ADMIN', 'GERENCIA'];
    if (!rolesLibres.includes(this.rolUsuario) && valorNumerico > montoAutorizado) {
      Swal.fire('Error', `El valor ($${this.formatCurrency(valorNumerico)}) excede el autorizado ($${this.formatCurrency(montoAutorizado)}).`, 'error');
      return;
    }

    const confirmar = await Swal.fire({
      icon: 'question', title: '¿Confirmar ejecución?',
      html: `<p><strong>Concepto:</strong> ${this.transaccionSeleccionada.autorizacion_concepto}</p>
             <p><strong>Empleado:</strong> ${this.nombreOperario}</p>
             <p><strong>Valor:</strong> $${this.formatCurrency(valorNumerico)}</p>
             <p><strong>Cuotas:</strong> ${this.executeForm.value.cuotas}</p>`,
      showCancelButton: true, confirmButtonText: 'Sí, ejecutar', cancelButtonText: 'Cancelar',
      confirmButtonColor: NAVY
    });

    if (!confirmar.isConfirmed) return;

    Swal.fire({
      title: 'Procesando...', icon: 'info', text: 'Ejecutando la autorización...',
      allowOutsideClick: false, allowEscapeKey: false, showConfirmButton: false,
      didOpen: () => { Swal.showLoading(); }
    });

    try {
      const userName = `${this.user.datos_basicos.nombres} ${this.user.datos_basicos.apellidos}`;
      const sedeEjecucion = this.user?.sede?.nombre || '';

      const response = await this.autorizacionesService.ejecutarTransaccion(
        this.transaccionSeleccionada.codigo_autorizacion,
        valorNumerico,
        userName,
        sedeEjecucion
      );

      Swal.close();
      Swal.fire({
        icon: 'success', title: '¡Listo!',
        text: `Préstamo ejecutado. Código: ${response.codigo_ejecucion || 'N/A'}`,
        confirmButtonText: 'Aceptar', confirmButtonColor: NAVY
      }).then(() => { this.cancelar(); });
    } catch (error: any) {
      Swal.close();
      const msg = error.error?.error || 'Ocurrió un problema al ejecutar.';
      Swal.fire('Error', msg, 'error');
    }
  }
}

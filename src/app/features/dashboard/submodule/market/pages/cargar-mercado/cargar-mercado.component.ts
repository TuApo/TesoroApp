import {  Component, OnInit , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import Swal from 'sweetalert2';
import { SharedModule } from '../../../../../../shared/shared.module';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { AutorizacionesService } from '../../../authorizations/services/autorizaciones/autorizaciones.service';
import { HistorialService } from '../../../history/service/historial/historial.service';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { HistorialDialogComponent } from '../../../authorizations/pages/autorizacion-dinamica/historial-dialog/historial-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cargar-mercado',
  imports: [
    SharedModule,
    FormsModule
  ],
  templateUrl: './cargar-mercado.component.html',
  styleUrls: ['./cargar-mercado.component.css']
} )
export class CargarMercadoComponent implements OnInit {
  searchForm!: FormGroup;
  executeForm!: FormGroup;

  datosOperario: any = null;
  nombreOperario: string = '';

  transaccionesPendientes: any[] = [];
  transaccionSeleccionada: any = null;
  loadingTransacciones = false;
  limiteDisponible: number = 0;

  user: any;

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

    this.searchForm = this.fb.group({
      numero_documento: ['', [Validators.required, Validators.pattern(/^[A-Za-z]?\d+$/)]]
    });

    this.executeForm = this.fb.group({
      valor: ['', [Validators.required]]
    });
  }

  formatCurrency(value: any): string {
    if (value === null || value === undefined || value === '') return '0';
    return Number(value).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  formatCurrencyInput(event: any) {
    const input = event.target;
    let value = input.value.replace(/\D/g, '');
    value = Number(value).toLocaleString('es-CO');
    input.value = value;
  }

  async buscarEmpleado() {
    if (this.searchForm.invalid) {
      this.searchForm.markAllAsTouched();
      return;
    }

    const doc = this.searchForm.value.numero_documento.trim().toUpperCase();

    Swal.fire({
      title: 'Buscando trabajador...',
      text: 'Por favor, espera mientras se procesa la información.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
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
          icon: 'error', title: 'Empleado Inactivo',
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
          icon: 'error', title: 'Empleado Bloqueado',
          text: `El empleado se encuentra bloqueado desde: ${fechaStr}.\n\nMotivo: ${motivo}`,
        });
        return;
      }

      const data = await this.autorizacionesService.traerPersonaTesoreria(doc);
      Swal.close();

      this.datosOperario = data;
      this.nombreOperario = data.nombre || '';

      // Calcular cupo disponible mercado (usa la misma lógica que verificarCondiciones)
      this.limiteDisponible = this.autorizacionesService.calcularCupoDisponible(data, 'mercado');

      // App zoneless: sin markForCheck la vista no se repinta tras el await
      this.cdr.markForCheck();

      // Cargar transacciones pendientes
      this.cargarTransaccionesPendientes(doc);

    } catch (error: any) {
      Swal.close();
      if (error?.status === 404) {
        Swal.fire('No encontrado', 'Este empleado no existe en la base de datos (puede que no esté registrado en la quincena actual o no pertenezca a la empresa).', 'error');
      } else {
        Swal.fire('Error', 'Hubo un problema al buscar el operario.', 'error');
      }
    }
  }

  cargarTransaccionesPendientes(doc: string) {
    this.loadingTransacciones = true;
    this.transaccionesPendientes = [];
    this.transaccionSeleccionada = null;

    this.historialService.getHistorialTransaccionesPorDocumento(doc).subscribe(
      (res: any) => {
        const rawList = Array.isArray(res) ? res : (res.results || res.data || []);
        // Filtrar solo las pendientes de tipo mercado.
        // includes('mercado') y no === 'mercado': el concepto llega en variantes
        // ("Mercado", "mercado autorizacion", "autorizacion de mercado autorizacion"...)
        // segun sea creado por el sistema actual o heredado de la migracion legacy.
        this.transaccionesPendientes = rawList.filter(
          (tx: any) => tx.estado === 'PENDIENTE' && (tx.autorizacion_concepto || '').toLowerCase().includes('mercado')
        ).sort((a: any, b: any) => {
          const dateA = new Date(a.autorizado_en || 0).getTime();
          const dateB = new Date(b.autorizado_en || 0).getTime();
          return dateB - dateA;
        });
        this.loadingTransacciones = false;
        this.cdr.markForCheck();
      },
      () => {
        this.loadingTransacciones = false;
        // Sin esto la rama de error dejaba el spinner girando para siempre
        this.cdr.markForCheck();
        Swal.fire('Error', 'No se pudieron cargar las transacciones pendientes.', 'error');
      }
    );
  }

  onCodigoSeleccionado() {
    if (this.transaccionSeleccionada) {
      // Pre-fill valor with authorized amount
      const monto = this.transaccionSeleccionada.autorizacion_monto;
      this.executeForm.patchValue({
        valor: Number(monto).toLocaleString('es-CO', { maximumFractionDigits: 0 })
      });
    }
  }

  cancelar() {
    this.datosOperario = null;
    this.nombreOperario = '';
    this.transaccionesPendientes = [];
    this.transaccionSeleccionada = null;
    this.limiteDisponible = 0;
    this.searchForm.reset();
    this.executeForm.reset();
    // También se llama desde el .then() de Swal, fuera de todo evento de plantilla
    this.cdr.markForCheck();
  }

  abrirHistorial() {
    if (!this.datosOperario) return;
    const doc = this.datosOperario.numero_documento;
    this.dialog.open(HistorialDialogComponent, {
      width: '80vw',
      maxWidth: '90vw',
      height: '80vh',
      panelClass: 'historial-dialog-panel',
      data: { numeroDocumento: doc }
    });
  }

  async ejecutarMercado() {
    if (!this.transaccionSeleccionada || this.executeForm.invalid) return;

    const valorStr = this.executeForm.value.valor.replace(/\D/g, '');
    const valorNumerico = parseInt(valorStr, 10);
    const montoAutorizado = Number(this.transaccionSeleccionada.autorizacion_monto);

    if (valorNumerico <= 0) {
      Swal.fire('Error', 'El valor debe ser mayor a 0.', 'error');
      return;
    }

    const rolUsuario = this.user?.rol?.nombre || '';
    const rolesLibres = ['TIENDA', 'ADMIN', 'GERENCIA'];
    if (!rolesLibres.includes(rolUsuario) && valorNumerico > montoAutorizado) {
      Swal.fire('Error', `El valor ($${this.formatCurrency(valorNumerico)}) supera el monto autorizado ($${this.formatCurrency(montoAutorizado)}).`, 'error');
      return;
    }


    const confirmar = await Swal.fire({
      icon: 'question',
      title: '¿Confirmar ejecución?',
      html: `
        <p><strong>Código:</strong> ${this.transaccionSeleccionada.codigo_autorizacion}</p>
        <p><strong>Empleado:</strong> ${this.nombreOperario}</p>
        <p><strong>Valor a ejecutar:</strong> $${this.formatCurrency(valorNumerico)}</p>
      `,
      showCancelButton: true,
      confirmButtonText: 'Sí, Ejecutar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#21263C'
    });

    if (!confirmar.isConfirmed) return;

    Swal.fire({
      title: 'Procesando...',
      icon: 'info',
      text: 'Ejecutando la autorización...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => { Swal.showLoading(); }
    });

    try {
      const userName = `${this.user.datos_basicos.nombres} ${this.user.datos_basicos.apellidos}`;
      const sedeEjecucion = this.user?.sede?.nombre || '';

      // Llamar al backend para ejecutar la transacción
      const response = await this.autorizacionesService.ejecutarTransaccion(
        this.transaccionSeleccionada.codigo_autorizacion,
        valorNumerico,
        userName,
        sedeEjecucion
      );

      Swal.close();

      Swal.fire({
        icon: 'success',
        title: '¡Éxito!',
        text: `Mercado ejecutado. Código de ejecución: ${response.codigo_ejecucion || 'N/A'}`,
        confirmButtonText: 'Aceptar',
        confirmButtonColor: '#21263C'
      }).then(() => {
        // Recargar
        this.cancelar();
      });

    } catch (error: any) {
      Swal.close();
      const errorMsg = error.error?.error || error.error?.detail || 'Ocurrió un problema al ejecutar la autorización.';
      Swal.fire('Error', errorMsg, 'error');
    }
  }
}

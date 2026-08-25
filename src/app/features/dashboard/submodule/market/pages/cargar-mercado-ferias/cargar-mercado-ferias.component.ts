import {  Component, OnInit, PLATFORM_ID, inject , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import Swal from 'sweetalert2';
import { MatTableDataSource } from '@angular/material/table';
import { SharedModule } from '../../../../../../shared/shared.module';
import { AutorizacionesService } from '../../../authorizations/services/autorizaciones/autorizaciones.service';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { ComercializadoraService } from '../../../merchandise/service/comercializadora/comercializadora.service';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { HistorialDialogComponent } from '../../../authorizations/pages/autorizacion-dinamica/historial-dialog/historial-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cargar-mercado-ferias',
  standalone: true,
  imports: [
    SharedModule, MatCheckboxModule
  ],
  templateUrl: './cargar-mercado-ferias.component.html',
  styleUrl: './cargar-mercado-ferias.component.css'
} )
export class CargarMercadoFeriasComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  myForm!: FormGroup;
  datosOperario: any;
  nombreOperario: string = '';
  sumaPrestamos: number = 0;
  productos: any[] = [];
  selectedProducts: any[] = []; // Productos seleccionados con checkbox
  fechaIngreso: string = '';
  limiteDisponible: number = 0;

  displayedColumnsInventarioSimple: string[] = [
    'select', 'cantidadSeleccionada',
    'concepto', 'disponible', 'valorUnidad',
    'PersonaEnvia', 'fechaRecibida'];

  dataSourceInventario = new MatTableDataSource<any>();

  usuario: any;

  datos2: string[] = [
    "Mercado",
    "Pollo Suba",
    "Pollo Luz Dary",
    "Embutidos Luz Dary",
    "Emb carmen",
    "Fruver",
    "Fruver Carmen",
    "Embutidos",
    "Carne",
    "Babuchas",
  ];

  rolUsuario: string = '';
  correoUsuario: string = '';

  constructor(
    private fb: FormBuilder,
    private autorizacionesService: AutorizacionesService,
    private comercializadoraService: ComercializadoraService,
    private utilityServiceService: UtilityServiceService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {

    this.myForm = this.fb.group({
      cedula: ['', Validators.required],
      cuotas: ['', [Validators.required, Validators.min(1), Validators.max(2)]],
      valor: ['', [Validators.required, this.currencyValidator]],
      concepto: ['', Validators.required],
    });
  }

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      // Mostrar swal de carga
      Swal.fire({
        title: 'Cargando datos...',
        text: 'Por favor, espera un momento.',
        icon: 'info',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      // Obtener usuario desde el servicio
      this.usuario = this.utilityServiceService.getUser();
      if (this.usuario) {
        this.rolUsuario = this.usuario.rol.nombre;
        this.correoUsuario = this.usuario.correo_electronico;
      }

      // Inventario global: el backend ignora la sede en este listado
      const lotes: any = await this.comercializadoraService.listarInventarioLotes('');

      if (lotes && lotes.length > 0) {
        // Mapear al formato que usa la tabla actualmente
        this.productos = lotes.map((lote: any) => ({
          codigo: lote.codigo,
          concepto: lote.producto_nombre,
          disponible: lote.disponible, // la tabla usa este si lo modificamos, pero vamos a mapear
          valorUnidad: lote.valor_unitario,
          // fecha_recepcion llega como epoch en SEGUNDOS; el pipe date lo lee
          // como milisegundos y mostraba 1970. Convertimos segundos→ms.
          fechaRecibida: typeof lote.fecha_recepcion === 'number' ? lote.fecha_recepcion * 1000 : lote.fecha_recepcion,
          PersonaEnvia: lote.realizado_por,
          // Guardamos el id del lote para consumir luego
          lote_id: lote.id,
        }));

        this.dataSourceInventario.data = this.productos;
      }

      // Cerrar swal de carga al finalizar exitosamente
      Swal.close();
      // App zoneless: sin markForCheck la vista no se repinta tras el await
      this.cdr.markForCheck();
    } catch (error) {
      this.cdr.markForCheck();
      // Mostrar error con Swal
      Swal.fire({
        title: 'Error',
        text: 'No se pudieron cargar los datos. Inténtalo de nuevo.',
        icon: 'error'
      });
    }
  }


  currencyValidator(control: AbstractControl) {
    if (!control.value) return { required: true };
    const value = control.value.replace(/\D/g, '');
    return value ? null : { required: true };
  }

  // Función para enviar el formulario
  async onSubmit() {
    // 1. Validar el formulario
    if (this.myForm.invalid) {
      this.myForm.markAllAsTouched();
      return;
    }

    // 2. Mostrar Swal de carga
    Swal.fire({
      title: 'Procesando...',
      icon: 'info',
      text: 'Por favor, espera mientras se realiza la operación.',
      allowOutsideClick: false, allowEscapeKey: false, showConfirmButton: false,
      didOpen: () => { Swal.showLoading(); }
    });

    try {
      const valorStr = this.myForm.value.valor.replace(/\D/g, '');
      const valorNumerico = parseInt(valorStr);
      const cuotas = this.myForm.get('cuotas')?.value || 1;
      const conceptoForm = this.myForm.get('concepto')?.value;
      const doc = this.datosOperario.numero_documento;
      const userName = `${this.usuario.datos_basicos.nombres} ${this.usuario.datos_basicos.apellidos}`;
      const sedeAutorizacion = this.usuario?.sede?.nombre || '';

      // 3. Calcular saldo y verificar condiciones
      this.sumaPrestamos = this.autorizacionesService.traerSaldoPendiente(this.datosOperario);

      const rolesLibres = ['TIENDA', 'ADMIN', 'GERENCIA'];
      if (!rolesLibres.includes(this.rolUsuario) && this.correoUsuario != "mercarflorats@gmail.com" && this.correoUsuario != "mercarflora2.ts@gmail.com" && this.correoUsuario != "servicioalcliente.tuapo1@gmail.com") {
        const verifica = this.autorizacionesService.verificarCondiciones(
          this.datosOperario, valorNumerico, this.sumaPrestamos, 'mercado'
        );
        if (!verifica) return;
      }

      // 4. Si es Mercado, validar inventario
      if (conceptoForm === 'Mercado') {
        for (const product of this.selectedProducts) {
          if (parseInt(product.cantidadSeleccionada) > product.disponible) {
            Swal.close();
            await Swal.fire({
              icon: 'error', title: 'Inventario insuficiente',
              text: `La cantidad seleccionada para ${product.concepto} supera la cantidad disponible (${product.disponible}).`,
            });
            return;
          }
        }
      }

      // 5. Armar concepto detallado
      let ejecucionConcepto = '';
      if (conceptoForm === 'Mercado' && this.selectedProducts.length > 0) {
        const detalles = this.selectedProducts
          .map((p: any) => `${p.concepto} (x${p.cantidadSeleccionada})`)
          .join(', ');
        ejecucionConcepto = `Mercado feria: ${detalles} en ${sedeAutorizacion}`;
      } else {
        ejecucionConcepto = `${conceptoForm} por $${valorNumerico.toLocaleString('es-CO')} en ${sedeAutorizacion}`;
      }

      // 6. Armar ventas de lotes
      const ventas = (conceptoForm === 'Mercado' && this.selectedProducts.length > 0)
        ? this.selectedProducts.map((p: any) => ({
          lote_id: p.lote_id,
          cantidad: parseInt(p.cantidadSeleccionada)
        }))
        : [];

      // 7. Ejecutar TODO atómicamente en un solo request
      const response = await this.autorizacionesService.ejecutarMercadoCompleto({
        numero_documento: doc,
        autorizacion_monto: valorNumerico,
        autorizacion_cuotas: cuotas,
        autorizacion_concepto: 'Mercado',
        autorizado_por: userName,
        sede_autorizacion: sedeAutorizacion,
        ejecucion_concepto: ejecucionConcepto,
        ejecutado_por: userName,
        sede_ejecucion: sedeAutorizacion,
        ejecucion_monto: valorNumerico,
        ventas: ventas
      });

      // 8. Generar PDF (no bloquear si falla)
      try {
        await this.autorizacionesService.generatePdf(
          this.datosOperario,
          valorNumerico,
          valorStr,
          '',
          '',
          ejecucionConcepto,
          String(cuotas),
          'Mercado',
          userName
        );
      } catch (pdfError) {
        console.warn('Error generando PDF:', pdfError);
      }

      // 9. Éxito
      Swal.close();
      await Swal.fire({
        icon: 'success',
        title: '¡Éxito!',
        text: `Mercado cargado exitosamente.`,
        confirmButtonText: 'Aceptar',
        confirmButtonColor: '#21263C'
      });

      this.cancelar();
      return; // Salir limpiamente

    } catch (error: any) {
      console.error('Error en onSubmit mercado-ferias:', error);
      Swal.close();
      const msg = error?.error?.error || error?.message || 'Hubo un error al realizar el cargue. Intente de nuevo.';
      await Swal.fire({ icon: 'error', title: 'Error', text: msg });
    }
  }


  // Función para buscar operario
  async buscarOperario() {
    const cedula = this.myForm.value.cedula?.trim();
    if (!cedula) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'Por favor, ingrese una cédula válida.' });
      this.myForm.markAllAsTouched();
      return;
    }

    Swal.fire({
      title: 'Buscando trabajador...',
      icon: 'info',
      text: 'Por favor, espera mientras se procesa la información.',
      allowOutsideClick: false, allowEscapeKey: false, showConfirmButton: false,
      didOpen: () => { Swal.showLoading(); }
    });

    try {
      // Validar si existe, está activo y no bloqueado usando getPersonaTesoreriaStatus
      const statusData: any = await this.comercializadoraService.getPersonaTesoreriaStatus(cedula).toPromise();

      if (!statusData || statusData.error) {
        this.datosOperario = null;
        this.cdr.markForCheck();
        Swal.fire({
          icon: 'error', title: 'Empleado no encontrado',
          text: 'Este empleado no existe, no está registrado en esta quincena o no pertenece a la empresa.',
        });
        return;
      }

      if (statusData.activo === false) {
        this.datosOperario = null;
        this.cdr.markForCheck();
        Swal.fire({
          icon: 'error', title: 'Empleado Inactivo',
          text: 'El empleado con el número de documento proporcionado se encuentra inactivo y no es válido para procesar autorizaciones.',
        });
        return;
      }

      if (statusData.bloqueado === true) {
        this.datosOperario = null;
        this.cdr.markForCheck();
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

      // Traer la info del operario si pasó las validaciones
      const data = await this.autorizacionesService.traerPersonaTesoreria(cedula);
      Swal.close();

      this.datosOperario = data;
      this.nombreOperario = data.nombre || '';
      this.fechaIngreso = data.ingreso || '';
      this.limiteDisponible = this.autorizacionesService.calcularCupoDisponible(data, 'mercado');
      this.cdr.markForCheck();

    } catch (error: any) {
      Swal.close();
      let title = 'Error al buscar empleado';
      let msg = 'Hubo un problema al buscar el registro del empleado. Intente nuevamente.';

      if (error?.status === 404) {
        title = 'Empleado no registrado';
        msg = 'Este empleado no existe en la base de datos (puede que no esté registrado en la quincena actual o no pertenezca a la empresa).';
      }

      Swal.fire({
        icon: 'error',
        title: title,
        text: msg,
      });
      this.datosOperario = null;
      this.cdr.markForCheck();
    }
  }

  applyFilterInventario(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSourceInventario.filter = filterValue.trim().toLowerCase();
  }

  incrementarCantidad(element: any) {
    if (!element.seleccionado) return; // Solo si está seleccionado

    if (!element.cantidadSeleccionada) {
      element.cantidadSeleccionada = 1; // La cantidad mínima es 1
    } else {
      element.cantidadSeleccionada++;
    }

    this.updateTotalValue();
  }

  decrementarCantidad(element: any) {
    if (!element.seleccionado) return; // Solo si está seleccionado

    if (element.cantidadSeleccionada && element.cantidadSeleccionada > 1) {
      element.cantidadSeleccionada--;
    }

    this.updateTotalValue();
  }

  // Método para manejar la selección del checkbox
  onProductSelectionChange(product: any, event: any) {
    product.seleccionado = event.checked;

    if (product.seleccionado) {
      product.cantidadSeleccionada = 1; // La cantidad mínima es 1
      if (!this.selectedProducts.includes(product)) {
        this.selectedProducts.push(product);
      }
    } else {
      product.cantidadSeleccionada = 0; // Resetear cantidad al desmarcar
      this.selectedProducts = this.selectedProducts.filter(p => p !== product);
    }

    this.updateTotalValue();
  }

  // Actualiza el total en el campo 'valor' y lo formatea con separadores de miles
  updateTotalValue() {
    const total = this.selectedProducts.reduce((sum, product) =>
      sum + (parseFloat(product.valorUnidad) * (product.cantidadSeleccionada || 0)), 0
    );
    // cuotas 2
    if (this.selectedProducts.length > 0) {
      this.myForm.get('cuotas')?.setValue(2);
    } else {
      this.myForm.get('cuotas')?.setValue('');
    }

    // Aplicar formato antes de asignar el valor
    this.formatCurrencyFromNumber(total);
  }

  // Formatea el número al escribir en el input
  formatCurrency(event: any) {
    let value = event.target.value.replace(/\D/g, ""); // Elimina caracteres no numéricos
    let numericValue = parseFloat(value) || 0;

    this.formatCurrencyFromNumber(numericValue);
  }

  // Formatea el número y lo asigna al campo "valor"
  formatCurrencyFromNumber(value: number) {
    let formattedValue = new Intl.NumberFormat("es-CO").format(value);
    this.myForm.get("valor")?.setValue(formattedValue, { emitEvent: false });
  }

  cancelar() {
    this.datosOperario = null;
    this.nombreOperario = '';
    this.fechaIngreso = '';
    this.limiteDisponible = 0;
    // Los checkbox leen `seleccionado` del propio producto: vaciar selectedProducts
    // no basta, quedaban marcados y con cantidad tras cargar un mercado
    this.productos.forEach(p => {
      p.seleccionado = false;
      p.cantidadSeleccionada = 0;
    });
    this.selectedProducts = [];
    this.myForm.reset();
    // También se llama tras el await de Swal, fuera de todo evento de plantilla
    this.cdr.markForCheck();
  }

  abrirHistorial() {
    if (!this.datosOperario) return;
    const doc = this.datosOperario.numero_documento || this.myForm.get('cedula')?.value;
    this.dialog.open(HistorialDialogComponent, {
      width: '80vw', maxWidth: '90vw', height: '80vh',
      panelClass: 'historial-dialog-panel',
      data: { numeroDocumento: doc }
    });
  }

  // === MEJORAS UX PARA PREVENIR ERRORES ===

  get totalProductos(): number {
    return this.selectedProducts.reduce((sum, p) =>
      sum + (parseFloat(p.valorUnidad) * (p.cantidadSeleccionada || 0)), 0
    );
  }

  get valorNumericoActual(): number {
    const val = this.myForm.get('valor')?.value;
    if (!val) return 0;
    return parseInt(String(val).replace(/\D/g, '')) || 0;
  }

  puedeEnviar(): boolean {
    // Formulario válido
    if (this.myForm.invalid) return false;
    if (!this.datosOperario) return false;
    // Si es Mercado, requiere productos seleccionados
    if (this.myForm.get('concepto')?.value === 'Mercado' && this.selectedProducts.length === 0) return false;
    return true;
  }

  async confirmarYEnviar() {
    if (!this.puedeEnviar()) return;

    const concepto = this.myForm.get('concepto')?.value;
    const valor = this.valorNumericoActual;
    const cuotas = this.myForm.get('cuotas')?.value;

    let detalleHtml = `
      <div style="text-align:left; font-size:14px;">
        <p><strong>Empleado:</strong> ${this.nombreOperario}</p>
        <p><strong>Concepto:</strong> ${concepto}</p>
        <p><strong>Valor:</strong> $ ${valor.toLocaleString('es-CO')}</p>
        <p><strong>Cuotas:</strong> ${cuotas}</p>
    `;

    if (concepto === 'Mercado' && this.selectedProducts.length > 0) {
      detalleHtml += `<hr><p><strong>Productos:</strong></p><ul style="margin:0; padding-left:20px;">`;
      this.selectedProducts.forEach(p => {
        detalleHtml += `<li>${p.concepto} x${p.cantidadSeleccionada} = $ ${(p.valorUnidad * p.cantidadSeleccionada).toLocaleString('es-CO')}</li>`;
      });
      detalleHtml += `</ul>`;
    }
    detalleHtml += `</div>`;

    const result = await Swal.fire({
      title: '¿Confirmar carga?',
      html: detalleHtml,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, Cargar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#21263C',
      reverseButtons: true
    });

    if (result.isConfirmed) {
      await this.onSubmit();
    }
  }
}

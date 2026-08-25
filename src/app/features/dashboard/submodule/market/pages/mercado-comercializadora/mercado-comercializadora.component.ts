import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  FormArray,
  FormControl
} from '@angular/forms';
import Swal from 'sweetalert2';
import { Router } from '@angular/router';
import { MatTableDataSource } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';
import { HistorialDialogComponent } from '../../../authorizations/pages/autorizacion-dinamica/historial-dialog/historial-dialog.component';
import { ComercializadoraService } from '../../../merchandise/service/comercializadora/comercializadora.service';

import { AutorizacionesService } from '../../../authorizations/services/autorizaciones/autorizaciones.service';
import { HistorialService } from '../../../history/service/historial/historial.service';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { SharedModule } from '../../../../../../shared/shared.module'; // si lo usas
import { MatCheckboxModule } from '@angular/material/checkbox';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-mercado-comercializadora',
  templateUrl: './mercado-comercializadora.component.html',
  styleUrls: ['./mercado-comercializadora.component.css'],
  imports: [SharedModule, MatCheckboxModule] // si usas Standalone Components
} )
export class MercadoComercializadoraComponent implements OnInit {
  myForm: FormGroup;
  datosOperario: any;
  nombreOperario: string = '';
  sumaPrestamos: number = 0;
  // Columnas para la tabla "Inventario"
  displayedColumnsInventario: string[] = [
    'seleccion', 'cantidadSeleccionada',
    'concepto', 'disponible', 'valorUnidad', 'fechaRecibida'
  ];
  dataSourceInventario = new MatTableDataSource<any>();
  rolUsuario: string = '';
  correoUsuario: string = '';
  fechaIngreso: string = '';
  limiteDisponible: number = 0;

  constructor(
    private fb: FormBuilder,
    private autorizacionesService: AutorizacionesService,
    private utilityServiceService: UtilityServiceService,
    private comercializadoraService: ComercializadoraService,
    private historialService: HistorialService,
    private router: Router,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {
    // Creamos el FormGroup principal con dos FormArray vacíos (codigos e inventario)
    this.myForm = this.fb.group({
      cedula: ['', Validators.required],
      codigos: this.fb.array([]),
      inventario: this.fb.array([]),
    });
  }

  user: any;

  ngOnInit() {
    this.user = this.utilityServiceService.getUser();
    if (this.user) {
      this.rolUsuario = this.user.rol?.nombre ?? '';
      this.correoUsuario = this.user.correo_electronico ?? '';
    }

    this.loadProductos();
  }

  // Getters para acceder más fácil a los FormArray
  get codigosFormArray(): FormArray {
    return this.myForm.get('codigos') as FormArray;
  }
  get inventarioFormArray(): FormArray {
    return this.myForm.get('inventario') as FormArray;
  }

  async buscarEmpleadoManual(event?: Event) {
    if (event) {
      event.preventDefault();
    }

    this.trimField('cedula');
    const cedulaControl = this.myForm.get('cedula');

    if (cedulaControl?.invalid || !cedulaControl?.value) {
      cedulaControl?.markAsTouched();
      return;
    }

    const doc = cedulaControl.value;

    // Limpiar la tabla de códigos
    this.codigosFormArray.clear();

    Swal.fire({
      title: 'Buscando empleado...',
      text: 'Por favor, espere',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    try {
      // Validar si existe, está activo y no bloqueado
      const statusData: any = await this.historialService.getPersonaTesoreriaStatus(doc).toPromise();

      if (!statusData || statusData.error) {
        this.datosOperario = null;
        this.cdr.markForCheck();
        Swal.fire({
          icon: 'error', title: 'Aviso',
          text: 'Este empleado no existe en la base de datos (puede que no esté registrado en la quincena actual o no pertenezca a la empresa).',
        });
        return;
      }

      if (statusData.activo === false) {
        this.datosOperario = null;
        this.cdr.markForCheck();
        this.mostrarError('El empleado se encuentra retirado y no puede solicitar autorizaciones.');
        return;
      }

      if (statusData.bloqueado === true) {
        this.datosOperario = null;
        this.cdr.markForCheck();
        this.mostrarError('El empleado se encuentra bloqueado y no puede solicitar autorizaciones.');
        return;
      }

      const data = await this.autorizacionesService.traerPersonaTesoreria(doc);
      Swal.close();

      this.datosOperario = data;
      this.nombreOperario = `${this.datosOperario.nombre}`;
      // Format date-only (no time)
      const rawIngreso = this.datosOperario.ingreso;
      if (rawIngreso) {
        const d = new Date(rawIngreso);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        this.fechaIngreso = `${dd}-${mm}-${yyyy}`;
      } else {
        this.fechaIngreso = 'N/A';
      }
      this.limiteDisponible = this.autorizacionesService.calcularCupoDisponible(this.datosOperario, 'mercado');

      // Cargar autorizaciones activas pendientes de mercancia
      const transaccionesRes: any = await this.historialService.getHistorialTransaccionesPorDocumento(doc).toPromise();
      const rawList = Array.isArray(transaccionesRes) ? transaccionesRes : (transaccionesRes.results || transaccionesRes.data || []);

      // includes('mercado') y no === 'mercado': el concepto llega en variantes
      // ("Mercado", "mercado autorizacion", "autorizacion de mercado autorizacion"...)
      // segun sea creado por el sistema actual o heredado de la migracion legacy.
      const authsData = rawList.filter(
        (tx: any) => tx.estado === 'PENDIENTE' && (tx.autorizacion_concepto || '').toLowerCase().includes('mercado')
      ).sort((a: any, b: any) => {
        return new Date(b.autorizado_en || 0).getTime() - new Date(a.autorizado_en || 0).getTime();
      });

      this.codigosFormArray.clear();
      if (authsData && authsData.length > 0) {
        const autoSelect = authsData.length === 1;
        authsData.forEach((item: any) => {
          const grupo = this.fb.group({
            codigo: [item.codigo_autorizacion],
            cuotas: [item.autorizacion_cuotas],
            monto: [item.autorizacion_monto],
            seleccionado: [autoSelect], // Checkbox
            historial_id: [item.id],
          });
          this.codigosFormArray.push(grupo);
        });
      }

      // App zoneless: sin markForCheck la vista no se repinta tras el await
      this.cdr.markForCheck();

    } catch (error: any) {
      Swal.close();
      this.datosOperario = null;
      this.cdr.markForCheck();
      if (error?.status === 404) {
        this.mostrarError('Este empleado no existe en la base de datos (puede que no esté registrado en la quincena actual o no pertenezca a la empresa).');
      } else {
        this.mostrarError('Hubo un problema al buscar el operario. Intente nuevamente.');
      }
    }
  }


  private async loadProductos() {
    try {
      // Inventario global: se listan los lotes de todas las sedes a propósito
      const lotes: any[] = await this.comercializadoraService.listarInventarioLotes('');

      // Limpiamos el FormArray "inventario"
      this.inventarioFormArray.clear();

      // Creamos un FormGroup por lote
      (lotes || []).forEach((lote: any) => {
        const g = this.fb.group({
          lote_id: [lote.id],              // ID del lote Django (para vender-lote)
          codigo: [lote.codigo],
          concepto: [lote.producto_nombre],
          cantidadEnvio: [lote.cantidad_inicial],
          cantidadRecibida: [lote.cantidad_inicial],
          valorUnidad: [lote.valor_unitario],
          cantidadTotalVendida: [lote.cantidad_vendida],
          PersonaEnvia: [''],
          PersonaRecibe: [lote.realizado_por],
          // epoch en SEGUNDOS → ms (si no, el pipe date mostraba 1970)
          fechaRecibida: [typeof lote.fecha_recepcion === 'number' ? lote.fecha_recepcion * 1000 : lote.fecha_recepcion],
          disponible: [lote.disponible],
          seleccionado: [false],
          cantidadSeleccionada: new FormControl({ value: 1, disabled: true })
        });
        this.inventarioFormArray.push(g);
      });

      this.dataSourceInventario.data = this.inventarioFormArray.controls;
      // App zoneless: sin markForCheck la tabla no se repinta tras el await
      this.cdr.markForCheck();
    } catch (error: any) {
      this.cdr.markForCheck();
      Swal.fire({
        icon: 'error',
        title: 'Oops...',
        text: 'Hubo un error al cargar los productos del inventario.',
      });
    }
  }

  private trimField(fieldName: string) {
    const control = this.myForm.get(fieldName);
    if (control && control.value && typeof control.value === 'string') {
      control.setValue(control.value.trim());
    }
  }

  mostrarError(mensaje: string) {
    Swal.fire({
      icon: 'error',
      title: 'Aviso',
      text: mensaje,
      showConfirmButton: true,
      allowOutsideClick: false,
      allowEscapeKey: false,
    });
  }

  applyFilterInventario(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSourceInventario.filterPredicate = (rowControl: any, filter: string) => {
      const rowValue = rowControl.value; // el objeto con {concepto, ...}
      // Busca coincidencia en los campos que desees:
      return (
        rowValue.concepto?.toLowerCase().includes(filter) ||
        rowValue.PersonaEnvia?.toLowerCase().includes(filter)
      );
    };
    this.dataSourceInventario.filter = filterValue.trim().toLowerCase();
  }

  async onSubmit() {
    try {
      // Extraer valores de los formularios
      const codigos = this.codigosFormArray.value;
      const inventario = this.inventarioFormArray.controls.map((control: any) => control.value);

      // Filtrar elementos seleccionados
      const codigosSeleccionados = codigos.filter((item: any) => item.seleccionado);
      const inventarioSeleccionados = this.inventarioFormArray.controls
        .filter((control: any) => control.get('seleccionado')?.value)
        .map((control: any) => ({
          ...control.value,
          cantidadSeleccionada: control.get('cantidadSeleccionada')?.value
            ? Math.max(1, parseInt(control.get('cantidadSeleccionada')?.value))
            : 1,
        }));

      // Validaciones iniciales
      if (codigosSeleccionados.length === 0) {
        this.mostrarError('Debe seleccionar al menos un código para continuar.');
        return;
      }

      if (inventarioSeleccionados.length === 0) {
        this.mostrarError('Debe seleccionar al menos un producto para continuar.');
        return;
      }
      // Validar que la cantidad seleccionada no exceda disponible
      const cantidadSeleccionadaInvalida = inventarioSeleccionados.some(
        (item: any) => parseInt(item.cantidadSeleccionada) > parseInt(item.disponible)
      );


      if (cantidadSeleccionadaInvalida) {
        this.mostrarError('La cantidad seleccionada no puede ser mayor a la cantidad recibida.');
        return;
      }

      this.sumaPrestamos = this.autorizacionesService.traerSaldoPendiente(this.datosOperario);
      let valorTotal = 0;
      let concepto = 'Compra tienda respecto a: ';

      // Calcular el valor total teniendo en cuenta la cantidad seleccionada
      inventarioSeleccionados.forEach((item: any) => {
        valorTotal += parseFloat(item.valorUnidad) * item.cantidadSeleccionada;
        concepto += `${item.concepto} (x${item.cantidadSeleccionada}), `;
      });

      concepto = concepto.slice(0, -2) + ' en ' + this.utilityServiceService.getUser().sede.nombre;

      // Calcular monto total de las autorizaciones seleccionadas
      const montoTotal = codigosSeleccionados.reduce((total: number, item: { monto: string; }) => total + parseFloat(item.monto), 0);

      // Validaciones de montos
      const rolesLibres = ['TIENDA', 'ADMIN', 'GERENCIA'];
      if (!rolesLibres.includes(this.rolUsuario) && valorTotal > montoTotal) {
        Swal.fire({
          icon: 'error',
          title: 'Oops...',
          text: 'El valor total de los productos seleccionados supera el monto total de las autorizaciones.',
        });
        return;
      }

      if (this.rolUsuario != "GERENCIA" && this.rolUsuario != "ADMIN") {
        if (!this.autorizacionesService.verificarCondiciones(this.datosOperario, valorTotal, this.sumaPrestamos, "mercado")) {
          return;
        }

      }


      // Datos del usuario actual
      const user = this.utilityServiceService.getUser();
      const nombreUsuario = `${user?.datos_basicos?.nombres || ''} ${user?.datos_basicos?.apellidos || ''}`.trim()
        || user?.correo_electronico || 'Usuario';
      const sedeEjecucion = user?.sede?.nombre || '';

      // Armar ventas de lotes
      const ventas = inventarioSeleccionados.map((item: any) => ({
        lote_id: item.lote_id,
        cantidad: item.cantidadSeleccionada
      }));

      // Ejecutar TODO atómicamente en un solo request
      try {
        await this.autorizacionesService.ejecutarMercadoCompleto({
          codigos_autorizacion: codigosSeleccionados.map((c: any) => c.codigo),
          ejecucion_monto: valorTotal,
          ejecucion_concepto: concepto,
          ejecutado_por: nombreUsuario,
          sede_ejecucion: sedeEjecucion,
          ventas: ventas
        });

        Swal.fire({
          icon: 'success',
          title: 'Proceso completado',
          text: 'Todas las autorizaciones y ventas se han registrado con éxito.',
          confirmButtonText: 'Aceptar',
        }).then((result) => {
          if (result.isConfirmed) {
            this.router.navigateByUrl('/dashboard', { skipLocationChange: true }).then(() => {
              this.router.navigate(["/dashboard/market/marketing-market"]);
            });
          }
        });
      } catch (error: any) {
        const msg = error?.error?.error || error?.message || 'Hubo un problema al procesar la operación. Nada fue modificado.';
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: msg,
        });
      }

    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Error inesperado',
        text: 'Ocurrió un error inesperado. Intente nuevamente.',
      });
    }
  }

  toggleSeleccionAutorizacion(codigo: FormGroup) {
    const control = codigo.get('seleccionado');
    if (control) {
      control.setValue(!control.value);
    }
  }

  incrementarCantidadPorRow(row: FormGroup) {
    if (row.get('seleccionado')?.value) {
      let currentValue = row.get('cantidadSeleccionada')?.value || 0;
      let disponible = row.get('disponible')?.value || 0;
      if (currentValue < disponible) {
        row.get('cantidadSeleccionada')?.setValue(parseInt(currentValue) + 1);
      }
    }
  }

  decrementarCantidadPorRow(row: FormGroup) {
    if (row.get('seleccionado')?.value) {
      let currentValue = row.get('cantidadSeleccionada')?.value || 0;
      if (currentValue > 1) { // Para evitar valores negativos o cero
        row.get('cantidadSeleccionada')?.setValue(parseInt(currentValue) - 1);
      }
    }
  }

  onProductSelectionChange(row: FormGroup) {
    const control = row.get('seleccionado');
    if (control) {
      const cantidadControl = row.get('cantidadSeleccionada');
      if (control.value) {
        cantidadControl?.enable();
        if (!cantidadControl?.value || cantidadControl.value === '0' || cantidadControl.value < 1) {
          cantidadControl?.setValue('1');
        }
      } else {
        cantidadControl?.disable();
        cantidadControl?.setValue('1');
      }
    }
  }


  toggleRowSelection(row: FormGroup) {
    const control = row.get('seleccionado');
    if (control) {
      control.setValue(!control.value);
      this.onProductSelectionChange(row);
    }
  }

  get totalProductosSeleccionados(): number {
    return this.inventarioFormArray.controls
      .filter((c: any) => c.get('seleccionado')?.value)
      .reduce((sum: number, c: any) => sum + (parseInt(c.get('cantidadSeleccionada')?.value) || 0), 0);
  }

  get valorTotalSeleccionado(): number {
    return this.inventarioFormArray.controls
      .filter((c: any) => c.get('seleccionado')?.value)
      .reduce((sum: number, c: any) => {
        const cant = parseInt(c.get('cantidadSeleccionada')?.value) || 0;
        const val = parseFloat(c.get('valorUnidad')?.value) || 0;
        return sum + (cant * val);
      }, 0);
  }

  cancelar() {
    this.datosOperario = null;
    this.nombreOperario = '';
    this.fechaIngreso = '';
    this.limiteDisponible = 0;
    this.codigosFormArray.clear();
    this.inventarioFormArray.clear();
    this.dataSourceInventario.data = [];
    this.myForm.reset();
    this.cdr.markForCheck();
    // El inventario vive fuera del empleado: se recarga para no dejar la tabla vacía
    this.loadProductos();
  }

  abrirHistorial() {
    const doc = this.datosOperario?.numero_documento || this.myForm.get('cedula')?.value;
    if (!doc) return;
    this.dialog.open(HistorialDialogComponent, {
      width: '80vw', maxWidth: '90vw', height: '80vh',
      panelClass: 'historial-dialog-panel',
      data: { numeroDocumento: doc }
    });
  }

}

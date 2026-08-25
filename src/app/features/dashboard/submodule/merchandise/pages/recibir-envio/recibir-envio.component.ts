import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { FormGroup, FormControl } from '@angular/forms';
import Swal from 'sweetalert2';
import { MatTableDataSource } from '@angular/material/table';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { ComercializadoraService } from '../../service/comercializadora/comercializadora.service';
import { SharedModule } from '../../../../../../shared/shared.module';
import { MatCheckboxModule } from '@angular/material/checkbox';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-recibir-envio',
  imports: [SharedModule, MatCheckboxModule],
  templateUrl: './recibir-envio.component.html',
  styleUrl: './recibir-envio.component.css'
})
export class RecibirEnvioComponent implements OnInit {

  displayedColumnsInventario: string[] = [
    'select',
    'codigo',
    'concepto',
    'cantidadEnvio',
    'cantidadRecibida',
    'valorUnidad',
    'PersonaEnvia',
    'comentariosEnvio'
  ];

  dataSourceInventario = new MatTableDataSource<any>();
  productos: any[] = [];

  cargando = true;
  guardando = false;

  // Objeto para saber si un producto está seleccionado o no
  seleccionados: { [key: string]: boolean } = {};

  // FormGroup para controlar las cantidades recibidas
  cantidadForm = new FormGroup({});

  constructor(
    private utilityService: UtilityServiceService,
    private comercializadoraService: ComercializadoraService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.loadProductos();
  }

  get totalSeleccionados(): number {
    return this.productos.filter(producto => this.seleccionados[producto.codigo]).length;
  }

  async loadProductos() {
    this.cargando = true;
    this.cdr.markForCheck();

    try {
      const user = this.utilityService.getUser();
      if (!user?.sede?.nombre) {
        throw new Error('No se pudo determinar la sede del usuario');
      }

      // Contaduría revisa los envíos de todas las sedes; el resto solo los dirigidos a la suya.
      const sedeFiltro = user.correo_electronico === 'contaduria.rtc@gmail.com'
        ? ''
        : user.sede.nombre;

      const response = await this.comercializadoraService.listarPendientesRecepcion(sedeFiltro);

      this.productos = (response ?? []).map((item: any) => ({
        codigo: item.id.toString(), // usamos id como el código único del envío (como string para FormControl)
        concepto: item.producto_nombre ?? 'Sin concepto',
        cantidadEnvio: item.cantidad,
        valorUnidad: item.valor_unitario,
        PersonaEnvia: item.realizado_por,
        comentariosEnvio: item.comentario,
        fechaRecibida: item.realizado_en // usamos la fecha de salida como orden
      }));

      // Ordenar por fecha descendente
      this.productos.sort(
        (a: any, b: any) => new Date(b.fechaRecibida).getTime() - new Date(a.fechaRecibida).getTime()
      );

      // El formulario se reconstruye entero en cada carga: addControl() ignora los nombres
      // que ya existen, así que tras confirmar una recepción se arrastrarían cantidades viejas.
      const form = new FormGroup({});
      this.seleccionados = {};
      this.productos.forEach((producto: any) => {
        this.seleccionados[producto.codigo] = false;
        form.addControl(
          producto.codigo,
          new FormControl({ value: producto.cantidadEnvio, disabled: true })
        );
      });
      this.cantidadForm = form;

      this.dataSourceInventario.data = this.productos;

    } catch (error) {
      console.error('Error cargando productos pendientes:', error);
      this.productos = [];
      this.dataSourceInventario.data = [];
      this.showError('Hubo un error al obtener los envíos pendientes, por favor intente de nuevo');
    } finally {
      this.cargando = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Manejar selección del checkbox
   */
  toggleSelection(event: any, codigo: string) {
    const isChecked = event.checked;
    this.seleccionados[codigo] = isChecked;

    const control = this.cantidadForm.get(codigo);
    if (!control) {
      return;
    }

    if (isChecked) {
      // Al desmarcar dejamos la cantidad en 0, así que al volver a marcar hay que
      // restaurar la cantidad enviada; si no, el usuario tendría que subirla a mano.
      const producto = this.productos.find(p => p.codigo === codigo);
      control.setValue(producto ? producto.cantidadEnvio : control.value);
      control.enable();
    } else {
      control.setValue(0);
      control.disable();
    }
  }

  /**
   * Incrementar la cantidad recibida
   */
  incrementarCantidad(codigo: string) {
    const control = this.cantidadForm.get(codigo);
    if (!control) {
      return;
    }
    const producto = this.productos.find(p => p.codigo === codigo);
    const maximo = Number(producto?.cantidadEnvio ?? 0);
    const currentValue = Number(control.value) || 0;
    // No se puede recibir más de lo que se envió: el backend no valida este tope.
    if (currentValue < maximo) {
      control.setValue(currentValue + 1);
    }
  }

  /**
   * Decrementar la cantidad recibida
   */
  decrementarCantidad(codigo: string) {
    const control = this.cantidadForm.get(codigo);
    if (!control) {
      return;
    }
    const currentValue = Number(control.value) || 0;
    if (currentValue > 0) {
      control.setValue(currentValue - 1);
    }
  }

  /**
   * Confirmar la recepción
   */
  async confirmarRecepcion() {
    // Obtener solo los productos seleccionados
    const seleccionados = this.productos.filter(
      producto => this.seleccionados[producto.codigo]
    );

    if (seleccionados.length === 0) {
      Swal.fire('Aviso', 'Debe seleccionar al menos un producto para recibir.', 'warning');
      return;
    }

    const sinCantidad = seleccionados.filter(
      producto => (Number(this.cantidadForm.get(producto.codigo)?.value) || 0) <= 0
    );
    if (sinCantidad.length > 0) {
      Swal.fire('Aviso', 'Los productos seleccionados deben tener una cantidad recibida mayor que cero.', 'warning');
      return;
    }

    const user = this.utilityService.getUser();
    const nombres = user?.datos_basicos?.nombres;
    const apellidos = user?.datos_basicos?.apellidos;
    const personaRecibe = nombres ? `${nombres} ${apellidos ?? ''}`.trim() : 'Usuario';

    this.guardando = true;
    this.cdr.markForCheck();

    let successCount = 0;
    try {
      for (const producto of seleccionados) {
        const payload = {
          envio_id: producto.codigo,
          cantidad: this.cantidadForm.get(producto.codigo)?.value,
          persona_recibe: personaRecibe,
          comentario: 'Recibido correctamente'
        };
        await this.comercializadoraService.recibirMercanciaNuevo(payload);
        successCount++;
      }

      Swal.fire('¡Éxito!', `Se han recibido ${successCount} envíos correctamente.`, 'success');
    } catch (error) {
      console.error('Error al recibir envíos:', error);
      // Cada envío se confirma por separado: si falla el tercero, los dos primeros ya se guardaron.
      const detalle = successCount > 0
        ? `Se recibieron ${successCount} de ${seleccionados.length} envíos. Revise la lista antes de reintentar.`
        : 'Hubo un error al recibir la mercancía, por favor intente de nuevo';
      this.showError(detalle);
    } finally {
      this.guardando = false;
      // Recarga siempre: tras un fallo parcial la lista en pantalla ya no es fiable.
      this.loadProductos();
    }
  }

  applyFilterInventario(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSourceInventario.filter = filterValue.trim().toLowerCase();
  }

  private showError(message: string) {
    Swal.fire('Oops...', message, 'error');
  }
}

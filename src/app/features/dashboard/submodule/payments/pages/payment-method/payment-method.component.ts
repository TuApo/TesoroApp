import {  Component, OnInit , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { PaymentsService } from '../../services/payments.service';
import { SharedModule } from '@/app/shared/shared.module';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { FormsModule } from '@angular/forms';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-payment-method',
  standalone: true,
  imports: [
    SharedModule,
    FormsModule,
    StandardFilterTable
  ],
  templateUrl: './payment-method.component.html',
  styleUrl: './payment-method.component.css'
} )
export class PaymentMethodComponent implements OnInit {

  cedula: string = '';

  columns: ColumnDefinition[] = [
    { name: 'contrato', header: 'Contrato', type: 'text', filterable: true },
    { name: 'cedula', header: 'Cédula', type: 'text', filterable: true },
    { name: 'nombre', header: 'Nombre', type: 'text', filterable: true },
    { name: 'centrodecosto', header: 'Centro de Costo', type: 'text', filterable: true },
    { name: 'concepto', header: 'Concepto', type: 'text', filterable: true },
    // Columnas editables con prefijo type_
    { name: 'type_formadepago', header: 'Forma de Pago', type: 'text', filterable: true },
    { name: 'type_valor', header: 'Valor', type: 'text', filterable: true },
    { name: 'type_banco', header: 'Banco', type: 'text', filterable: true },
    { name: 'type_fechadepago', header: 'Fecha de Pago', type: 'text', filterable: true },
    { name: 'actions', header: 'Acciones', type: 'text', filterable: false }
  ];

  dataList: any[] = [];
  originalData: any[] = [];
  user: any;
  correo: any

  /** Correos autorizados para gestionar (descargar/cargar) formas de pago. */
  private readonly correosGestion = new Set<string>([
    'contaduria.rtc@gmail.com',
    'ghumana.rtc@gmail.com',
    'programador.ts@gmail.com',
    'antcontable5.ts@gmail.com',
    'asistconta.rtc@gmail.com',
    'nominacentral9@gmail.com',
    'carteratuapo@gmail.com',
    'antcontable3.ts@gmail.com',
  ]);

  /** true si el usuario puede ver el menú de acciones (plantilla / carga). */
  get puedeGestionar(): boolean {
    return this.correosGestion.has(this.correo);
  }

  constructor(
    private paymentsService: PaymentsService,
    private utilityService: UtilityServiceService,
    private cdr: ChangeDetectorRef,
  ) { }

  async ngOnInit(): Promise<void> {
    this.user = await this.utilityService.getUser();
    if (this.user) {
      this.correo = this.user.correo_electronico;
    }
  }

  public buscarFormasPago(cedula: string): void {
    const cleanedCedula = cedula.replace(/[^\d]/g, '');

    if (!cleanedCedula) {
      Swal.fire({
        icon: 'info',
        title: 'Información',
        text: 'Ingresa un número de cédula válido para buscar.'
      });
      return;
    }

    // Modal de carga mientras se consulta la información.
    Swal.fire({
      title: 'Buscando información...',
      text: 'Por favor espera un momento.',
      icon: 'info',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.paymentsService.buscarFormasPago(cleanedCedula).subscribe(
      (response: any) => {
        // El backend puede responder con un array directo [...] o con un
        // objeto { formasdepago: [...] }. Normalizamos a un array siempre
        // para no romper si la cédula no existe (antes lanzaba
        // "Cannot read properties of undefined (reading 'sort')").
        const lista: any[] = Array.isArray(response)
          ? response
          : Array.isArray(response?.formasdepago)
            ? response.formasdepago
            : [];

        if (lista.length === 0) {
          this.dataList = [];
          this.originalData = [];
          this.cdr.markForCheck();
          Swal.fire({
            icon: 'info',
            title: 'Información',
            text: 'No se encontraron formas de pago para la cédula ingresada'
          });
          return;
        }

        const formasDePago = [...lista]
          .sort((a: any, b: any) => (b?.id ?? 0) - (a?.id ?? 0))
          .slice(0, 4)
          .map((item: any) => ({
            ...item,
            editing: false,
            // Map original values to type_ properties for editing
            type_formadepago: item.formadepago,
            type_valor: item.valor,
            type_banco: item.banco,
            type_fechadepago: item.fechadepago
          }));

        this.originalData = JSON.parse(JSON.stringify(formasDePago));
        this.dataList = formasDePago;
        // OnPush: la respuesta llega async; hay que marcar para que se
        // renderice sin necesidad de un segundo click.
        this.cdr.markForCheck();
        Swal.close();
      },
      (error: any) => {
        // Algunas versiones del backend responden 404 cuando no hay registros;
        // eso no es un error real, es "no encontrado".
        if (error?.status === 404) {
          this.dataList = [];
          this.originalData = [];
          this.cdr.markForCheck();
          Swal.fire({
            icon: 'info',
            title: 'Información',
            text: 'No se encontraron formas de pago para la cédula ingresada'
          });
          return;
        }
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Ha ocurrido un error al buscar la información'
        });
      }
    );
  }

  toggleEdit(element: any): void {
    if (this.correo === "contaduria.rtc@gmail.com" ||
      this.correo === "ghumana.rtc@gmail.com" ||
      this.correo === "antcontable5.ts@gmail.com" ||
      this.correo === "programador.ts@gmail.com") {

      element.editing = !element.editing;

      if (!element.editing) {
        // Guardar cambios: usar valores de type_ properties
        this.paymentsService.editarFormaPago(
          element.id,
          element.type_banco,
          element.nombre,
          element.centrodecosto,
          element.concepto,
          element.contrato,
          element.type_fechadepago,
          element.type_formadepago,
          element.type_valor
        ).then((response: any) => {
          if (response.message === 'success') {
            Swal.fire({
              icon: 'success',
              title: 'Éxito',
              text: 'La información ha sido actualizada correctamente'
            });
            // Actualizar originalData con los nuevos valores confirmados
            const index = this.dataList.findIndex(e => e.id === element.id);
            if (index !== -1) {
              this.originalData[index] = JSON.parse(JSON.stringify(element));
            }
          } else {
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'Ha ocurrido un error al actualizar la información'
            });
          }
        }).catch((error: any) => {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Ha ocurrido un error al actualizar la información'
          });
        });
      } else {
        // Reset data from original when entering edit mode to ensure clean state
        const index = this.dataList.findIndex(e => e.id === element.id);
        if (index !== -1) {
          this.dataList[index] = { ...this.originalData[index], editing: true };
          this.dataList = [...this.dataList]; // Trigger change detection
        }
      }
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No tienes permisos para editar esta información'
      });
    }
  }

  eliminarFormaPago(element: any): void {
    if (this.correo === "contaduria.rtc@gmail.com" ||
      this.correo === "ghumana.rtc@gmail.com" ||
      this.correo === "antcontable5.ts@gmail.com") {

      Swal.fire({
        title: '¿Estás seguro de eliminar esta información?',
        text: 'No podrás revertir esta acción',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed) {
          this.paymentsService.eliminarFormaPago(element.id).then((response: any) => {
            if (response.message == 'success') {
              Swal.fire({
                icon: 'success',
                title: 'Éxito',
                text: 'La información ha sido eliminada correctamente'
              });
              const index = this.dataList.indexOf(element);
              if (index !== -1) {
                this.dataList.splice(index, 1);
                // Trigger change detection in child list by reference change
                this.dataList = [...this.dataList];
                this.cdr.markForCheck();
              }
            } else {
              Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Ha ocurrido un error al eliminar la información'
              });
            }
          }).catch((error: any) => {
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'Ha ocurrido un error al eliminar la información'
            });
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No tienes permisos para eliminar esta información'
          });
        }
      });
    }
  }

  triggerFileInput(): void {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput.click();
  }

  descargarPlantillaFormasPago(): void {
    try {
      const headers = [...this.claves];
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      ws['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'FormasDePago');
      const fileName = `Plantilla_Formas_de_Pago_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName, { bookType: 'xlsx', compression: true });
    } catch (e) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo generar la plantilla. Inténtalo nuevamente.'
      });
    }
  }

  resetFileInput(event: any): void {
    event.target.value = '';
  }


  cargarExcel(event: any): void {
    const file = event.target.files[0];
    const reader = new FileReader();

    // Mostrar Swal de carga
    Swal.fire({
      title: 'Cargando archivo...',
      icon: 'info',
      text: 'Por favor espera mientras se procesa el archivo.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "dd/mm/yyyy" });

        const modifiedRows = this.asignarClaves(rows);

        if (Object.keys(modifiedRows[0]).length !== 10) {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'El archivo no tiene el formato correspondiente. Asegúrese de que tenga exactamente 10 columnas válidas.'
          });
          return;
        }

        this.paymentsService.subirExcelFormasPago(modifiedRows).then((response: any) => {
          if (response.message === 'success') {
            Swal.fire({
              icon: 'success',
              title: 'Éxito',
              text: 'Los datos han sido cargados correctamente.'
            });
          } else {
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'Ha ocurrido un error al cargar los datos.'
            });
          }
        }).catch((error: any) => {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Ocurrió un error inesperado al cargar los datos.'
          });
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'No se pudo procesar el archivo.'
        });
      }
    };

    reader.readAsArrayBuffer(file);
  }

  claves = ["NroDes", "Contrato", "Cedula", "Nombre", "CentrodeCosto", "Concepto", "FormadePago", "Valor", "Banco", "FECHADEPAGO"];

  asignarClaves(data: any[]): any[] {

    return data.map((row: any) => {
      let modifiedRow: any = {};
      row.forEach((cell: any, index: number) => {
        if (index < this.claves.length) {
          modifiedRow[this.claves[index]] = cell !== null ? cell : 'N/A';
        }
      });
      return modifiedRow;
    });
  }

}

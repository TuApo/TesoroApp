import {  Component, OnInit , ChangeDetectionStrategy, signal } from '@angular/core';
import { SharedModule } from '../../../../../../shared/shared.module';
import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';
import { HomeService } from '../../service/home.service';
import { MatDialog } from '@angular/material/dialog';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs/internal/observable/of';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { firstValueFrom } from 'rxjs';
import { TrasladosService } from '../../../eps-transfers/service/traslados.service';
import { ElectronWindowService } from '../../../../../../core/services/electron-window.service';


interface Traslado {
  ultimas_actualizaciones?: Record<string, string>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-terminated-transfers',
  imports: [
    SharedModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './terminated-transfers.component.html',
  styleUrl: './terminated-transfers.component.css'
} )
export class TerminatedTransfersComponent implements OnInit {
  user: any;
  /** Señales: la pantalla es OnPush y la respuesta llega fuera de un evento. */
  traslados = signal<any[]>([]);
  cargando = signal(true);

  /** Mismas columnas (y orden) que la tabla anterior. Cédula y solicitud son enlaces: no se copian. */
  readonly columnasTraslados: ColumnaTabla<any>[] = [
    { id: 'cedulas', header: 'Cédulas', valor: (t) => (t.cedula_disponible === 1 ? 'Ver Cédula' : 'No disponible'),
      copiable: false, interactiva: true, prioridad: 2, tarjeta: 'meta' },
    { id: 'solicitud_traslado', header: 'Solicitud de Traslado',
      valor: (t) => (t.solicitud_disponible === 1 ? 'Ver Solicitud' : 'No disponible'),
      copiable: false, interactiva: true, prioridad: 2, tarjeta: 'meta' },
    { id: 'codigo_traslado', header: 'Código Traslado', valor: (t) => t.codigo_traslado, tarjeta: 'subtitulo' },
    { id: 'eps_trasladada', header: 'EPS Trasladada', valor: (t) => t.eps_trasladada, tarjeta: 'meta' },
    { id: 'cantidad_beneficiarios', header: 'Cantidad Beneficiarios', valor: (t) => t.cantidad_beneficiarios,
      align: 'right', prioridad: 3, tarjeta: 'meta' },
    { id: 'estado_del_traslado', header: 'Estado del Traslado', valor: (t) => t.estado_del_traslado, tarjeta: 'badge' },
    { id: 'fecha_efectividad', header: 'Fecha Efectividad', valor: (t) => t.fecha_efectividad, prioridad: 2, tarjeta: 'meta' },
    { id: 'numero_cedula', header: 'Número Cédula', valor: (t) => t.numero_cedula, tarjeta: 'titulo' },
    { id: 'numero_radicado', header: 'Número Radicado', valor: (t) => t.numero_radicado, prioridad: 3, tarjeta: 'meta' },
    { id: 'observacion_estado', header: 'Observación Estado', valor: (t) => t.observacion_estado, prioridad: 3,
      tarjeta: 'cuerpo' },
    { id: 'responsable', header: 'Responsable', valor: (t) => t.responsable, prioridad: 3, tarjeta: 'meta' },
  ];
  descargarExcel = false;

  constructor(
    private utilityService: UtilityServiceService,
    private trasladosService: TrasladosService,
    private homeService: HomeService,
    private electronWindow: ElectronWindowService,
  ) { }

  ngOnInit(): void {
    this.user = this.utilityService.getUser();
    this.descargarExcel = this.user.rol.nombre === 'ADMIN' || this.user.correo_electronico === 'tuafiliacion@tsservicios.co';

    if (!this.user) {
      this.cargando.set(false);
      return;
    }

    const nombreCompleto = `${this.user.datos_basicos.nombres} ${this.user.datos_basicos.apellidos}`;
    this.homeService.traerTraladosAceptados(nombreCompleto).pipe(
      catchError(error => {
        return of({ traslados: [] }); // Devuelve un array vacío en caso de error
      })
    ).subscribe((data: any) => {
      this.cargando.set(false);
      try {
        if (!data || !Array.isArray(data.traslados)) {
          this.traslados.set([]);
          return;
        }
        this.traslados.set(data.traslados);
      } catch (error) {
        this.traslados.set([]);
      }
    });
  }


  isUrl(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith('http');
  }

  isBase64PDF(value: string): boolean {
    if (!value) {
      return false;
    }
    return value.startsWith('data:application/pdf;base64,');
  }

  openBase64PDF(base64: string) {
    if (!base64) return;
    this.electronWindow.openPdfFromBase64(base64, { title: 'Traslado finalizado' });
  }

  async obtenerTrasladosYGenerarExcel(): Promise<void> {
    Swal.fire({
      title: 'Cargando...',
      text: 'Por favor espera mientras procesamos tu solicitud.',
      icon: 'info',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const data: Traslado[] = await firstValueFrom(this.homeService.traerTraladosPorFecha());
      const dataOrdenada = data.map(item => {
        return {
          ...item,
          ultimas_actualizaciones: this.ordenarActualizaciones(item.ultimas_actualizaciones || {})
        };
      });

      // Generamos el Excel con todos los datos obtenidos
      this.generateExcel(dataOrdenada);

      Swal.fire({
        title: '¡Éxito!',
        text: 'Los datos han sido procesados y el archivo Excel se ha generado.',
        icon: 'success',
      });

    } catch (error) {
      Swal.fire({
        title: '¡Error!',
        text: 'Hubo un error al procesar tu solicitud.',
        icon: 'error',
      });
    }
  }



  generateExcel(data: any[]): void {
    const wb: XLSX.WorkBook = XLSX.utils.book_new();

    const transformedData = data.map(item => {
      let formattedUpdates = "Sin actualizaciones";

      if (item.ultimas_actualizaciones && typeof item.ultimas_actualizaciones === 'object') {
        // Obtenemos las claves y las ordenamos por fecha
        const sortedKeys = Object.keys(item.ultimas_actualizaciones)
          .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        // Convertimos a string con saltos de línea
        formattedUpdates = sortedKeys
          .map(dateStr => `${dateStr} - ${item.ultimas_actualizaciones[dateStr]}`)
          .join('\r\n');
      }

      return {
        "Número Cédula": item.numero_cedula || "",
        "Código Traslado": item.codigo_traslado || "",
        "EPS a Trasladar": item.eps_a_trasladar || "",
        "Asignación Correo": item.asignacion_correo || "",
        "Responsable": item.responsable || "",
        "Estado del Traslado": item.estado_del_traslado || "",
        "Observación Estado": item.observacion_estado || "",
        "Número Radicado": item.numero_radicado || "",
        "Fecha Efectividad": item.fecha_efectividad || "",
        "Cantidad Beneficiarios": item.cantidad_beneficiarios || 0,
        "Marca Temporal Solicitud": this.formatDate(item.marca_temporal_solicitud),
        "EPS Trasladada": item.eps_trasladada || "",
        "Últimas Actualizaciones": formattedUpdates,
      };
    });

    // Convierte la data en hoja de Excel
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(transformedData);

    // Ajusta el ancho de las columnas (opcional)
    ws["!cols"] = [
      { wch: 15 },  // Número Cédula
      { wch: 12 },  // Código Traslado
      { wch: 20 },  // EPS a Trasladar
      { wch: 20 },  // Asignación Correo
      { wch: 20 },  // Responsable
      { wch: 15 },  // Estado del Traslado
      { wch: 25 },  // Observación Estado
      { wch: 30 },  // Número Radicado
      { wch: 15 },  // Fecha Efectividad
      { wch: 10 },  // Cantidad Beneficiarios
      { wch: 25 },  // Marca Temporal Solicitud
      { wch: 20 },  // EPS Trasladada
      { wch: 40 },  // Últimas Actualizaciones
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Traslados");
    XLSX.writeFile(wb, "base_general_traslados.xlsx");
  }

  /**
   * Quita milisegundos si existen, ej.: "2025-02-08 12:02:09.123" => "2025-02-08 12:02:09"
   */
  private formatTimestamp(dateStr: string): string {
    if (!dateStr) return "N/A";
    return dateStr.split('.')[0];
  }

  /**
   * Formatea la fecha de marca temporal a "YYYY-MM-DD HH:mm:ss".
   */
  private formatDate(dateStr: string): string {
    if (!dateStr || typeof dateStr !== 'string') return "N/A";
    if (dateStr.length >= 19) {
      return dateStr.substring(0, 19).replace('T', ' ');
    }
    return dateStr;
  }

  /**
   * Ordena el objeto `ultimas_actualizaciones` basado en la fecha y hora de la clave.
   */
  private ordenarActualizaciones(ultimasActualizaciones: Record<string, string>): Record<string, string> {
    if (!ultimasActualizaciones || typeof ultimasActualizaciones !== 'object') {
      return {}; // Retorna un objeto vacío si no hay datos válidos
    }

    // Convertir el objeto a un array de tuplas [fechaStr, estado]
    const entries = Object.entries(ultimasActualizaciones);

    // Ordenar por fecha/hora (ascendente: más antigua primero)
    entries.sort(([dateA], [dateB]) => {
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    });

    // Reconstruir el objeto con las claves formateadas
    const sortedUpdates: Record<string, string> = {};
    entries.forEach(([dateStr, status]) => {
      sortedUpdates[this.formatTimestamp(dateStr)] = status;
    });

    return sortedUpdates;
  }



  imprimirCedula(codigoTraslado: string): void {
    // Mostrar Swal de carga
    Swal.fire({
      title: 'Cargando...',
      icon: 'info',
      text: 'Obteniendo la cédula escaneada.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.trasladosService.traerCedulaEscaneada(codigoTraslado).subscribe(
      (data: any) => {
        Swal.close();
        if (data.cedula_escaneada_delante) {
          // Mostrar la cédula en PDF si es Base64
          if (this.isBase64PDF(data.cedula_escaneada_delante)) {
            this.openBase64PDF(data.cedula_escaneada_delante);
          } else {
            Swal.fire('Error', 'La cédula no es un PDF válido.', 'error');
          }
        } else {
          Swal.fire('Error', 'No se encontró la cédula escaneada.', 'error');
        }
      },
      (error) => {
        Swal.close(); // Cerrar Swal de carga
        Swal.fire('Error', 'Hubo un problema obteniendo la cédula escaneada.', 'error');
      }
    );
  }

  imprimirSolicitudTraslado(codigoTraslado: string): void {
    // Mostrar Swal de carga
    Swal.fire({
      title: 'Cargando...',
      icon: 'info',
      text: 'Obteniendo la solicitud de traslado.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.trasladosService.traerSolicitudPorCodigo(codigoTraslado).subscribe(
      (data: any) => {
        Swal.close();

        if (data[0].solicitud_traslado) {
          // Mostrar la solicitud en PDF si es Base64
          if (this.isBase64PDF(data[0].solicitud_traslado)) {
            this.openBase64PDF(data[0].solicitud_traslado);
          } else {
            Swal.fire('Error', 'La solicitud de traslado no es un PDF válido.', 'error');
          }
        } else {
          Swal.fire('Error', 'No se encontró la solicitud de traslado.', 'error');
        }
      },
      (error) => {
        Swal.close();
        Swal.fire('Error', 'Hubo un problema obteniendo la solicitud de traslado.', 'error');
      }
    );
  }
}

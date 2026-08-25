import { Component, OnInit, AfterViewInit, ViewChild, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { TrasladosService } from '../../service/traslados.service';
import { catchError } from 'rxjs/operators';
import { lastValueFrom, of } from 'rxjs';
import Swal from 'sweetalert2';
import { EstadosDialogComponent } from '../../components/estados-dialog/estados-dialog.component';
import { TrabajadorComponent } from '../../components/trabajador/trabajador.component';
import { CambiarEstadoComponent } from '../../components/cambiar-estado/cambiar-estado.component';
import { InfoCardComponent } from '../../../../../../shared/components/info-card/info-card.component';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { SharedModule } from '../../../../../../shared/shared.module';
import { ElectronWindowService } from '../../../../../../core/services/electron-window.service';
import { environment } from '@/environments/environment';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-traslados',
  imports: [
    InfoCardComponent,
    SharedModule,
  ],
  templateUrl: './traslados.component.html',
  styleUrls: ['./traslados.component.css'],
})
export class TrasladosComponent implements OnInit, AfterViewInit {
  displayedColumns: string[] = [
    'codigo_traslado',
    'estado_del_traslado',
    'observacion_estado',
    'numero_cedula',
    'solicitud_traslado',
    'cedulas',
    'eps_a_trasladar',
    'actions',
  ];

  estadosCount: { [key: string]: number } = {};

  /**
   * `keyvalue` reordena alfabéticamente por defecto, lo que anulaba el orden
   * por frecuencia que ya calcula mostrarTraslados(). Con este comparador el
   * select respeta el orden de inserción (estado más frecuente primero).
   */
  readonly mantenerOrden = (): number => 0;

  dataSource = new MatTableDataSource<any>();

  /**
   * Predicado por defecto de MatTableDataSource (busca en todos los campos).
   * Se guarda porque `applyFilterByEstado` lo reemplaza por uno de match
   * exacto: sin restaurarlo, el buscador de texto libre dejaría de funcionar
   * después de usar el filtro por estado.
   */
  private readonly filtroPorTexto = this.dataSource.filterPredicate;

  numTraslados: number = 5;
  numTrasladosResponsableNull: number = 0;
  operario: any = {};
  dataLoaded: boolean = false;
  // Texto y estado son excluyentes (comparten dataSource.filter): se reflejan
  // en la vista para que al aplicar uno se vea que el otro se soltó.
  estadoSeleccionado = '';
  textoBusqueda = '';
  user: any;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private trasladosService: TrasladosService,
    public dialog: MatDialog,
    private utilityService: UtilityServiceService,
    private cdr: ChangeDetectorRef,
    private electronWindow: ElectronWindowService,
  ) { }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  async ngOnInit(): Promise<void> {
    try {
      this.user = this.utilityService.getUser();
      await this.mostrarTraslados();
    } catch (error) {
      Swal.fire('Error', 'Hubo un problema al cargar los datos.', 'error');
      return;
    } finally {
      this.dataLoaded = true;
      this.cdr.markForCheck();
    }
  }

  /** Refresca solo el contador de traslados sin responsable. */
  async cuantosTraslados(): Promise<void> {
    try {
      const cont = await lastValueFrom(this.trasladosService.cuantosTrasladosDisponibles());
      this.numTrasladosResponsableNull = cont.count_null_responsables;
    } catch (error) {
      Swal.fire('Error', 'No se pudo actualizar el número de traslados disponibles.', 'error');
    } finally {
      this.cdr.markForCheck();
    }
  }

  async mostrarTraslados(): Promise<void> {
    Swal.fire({
      icon: 'info',
      title: 'Cargando...',
      html: 'Por favor espera mientras se cargan los datos.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    try {
      const cont = await lastValueFrom(this.trasladosService.cuantosTrasladosDisponibles());
      this.numTrasladosResponsableNull = cont.count_null_responsables;

      this.numTraslados = 5;

      const response: any = await lastValueFrom(
        this.trasladosService.getTrasladosPorResponsable(
          `${this.user.datos_basicos.nombres} ${this.user.datos_basicos.apellidos}`
        ).pipe(
          catchError(() => of({ traslados: [], total_diferente_de: 0 }))
        )
      );

      this.dataSource.data = response.traslados ?? [];

      // Al recargar, el filtro por estado anterior puede no existir en los datos nuevos.
      this.limpiarFiltros();

      this.updateEstadosCount();

      this.estadosCount = Object.fromEntries(
        Object.entries(this.estadosCount).sort(([, a], [, b]) => b - a)
      );

      this.numTraslados -= response.total_diferente_de;
      Swal.close();
    } catch (error) {
      // Cerrar el loader ANTES de mostrar el error: si el close vive en el
      // finally se lleva por delante este mismo diálogo y el fallo pasa mudo.
      Swal.close();
      Swal.fire('Error', 'No se pudieron cargar los datos.', 'error');
    } finally {
      this.cdr.markForCheck();
    }
  }

  updateEstadosCount(): void {
    this.estadosCount = this.dataSource.data.reduce((acc, element) => {
      const estado = element.estado_del_traslado;
      if (estado) {
        acc[estado] = (acc[estado] || 0) + 1;
      }
      return acc;
    }, {} as { [key: string]: number });
  }

  /* -------------------------------------------------------------------
     Clasificación de estados para el chip de color.
     Duplica a propósito la de transfer-query: son la misma nomenclatura y
     el usuario usa ambas pantallas juntas, así que un estado tiene que
     verse del mismo color en las dos. Si esta lista cambia, cambia allí.
  ------------------------------------------------------------------- */
  private normalizarEstado(raw: string | null | undefined): string {
    return String(raw || '').trim().toLowerCase();
  }

  estadoEsOk(raw: string | null | undefined): boolean {
    const e = this.normalizarEstado(raw);
    return e === 'aceptado' || e === 'aprobado' || e === 'efectivo' || e === 'efectivos';
  }

  estadoEsPendiente(raw: string | null | undefined): boolean {
    const e = this.normalizarEstado(raw);
    return e === 'pendiente' || e === 'en proceso' || e === 'en curso' || e === 'asignado';
  }

  estadoEsRechazado(raw: string | null | undefined): boolean {
    const e = this.normalizarEstado(raw);
    return e === 'rechazado' || e === 'no efectivo' || e === 'devuelto' || e === 'cancelado';
  }

  private limpiarFiltros(): void {
    this.estadoSeleccionado = '';
    this.textoBusqueda = '';
    this.dataSource.filterPredicate = this.filtroPorTexto;
    this.dataSource.filter = '';
  }

  applyFilterByEstado(estado: string): void {
    if (!estado) {
      this.limpiarFiltros();
      this.cdr.markForCheck();
      return;
    }

    this.estadoSeleccionado = estado;
    this.textoBusqueda = '';
    this.dataSource.filterPredicate = (data: any, filter: string) =>
      String(data.estado_del_traslado ?? '').trim().toLowerCase() === filter;
    this.dataSource.filter = estado.trim().toLowerCase();
    this.cdr.markForCheck();
  }

  applyFilter(event: Event): void {
    // El select de estado deja su propio predicado puesto; hay que devolver el
    // de texto libre antes de buscar, y soltar el estado para no confundir.
    this.textoBusqueda = (event.target as HTMLInputElement).value;
    this.estadoSeleccionado = '';
    this.dataSource.filterPredicate = this.filtroPorTexto;
    this.dataSource.filter = this.textoBusqueda.trim().toLowerCase();
    this.cdr.markForCheck();
  }

  // Acepta data URL o base64 crudo con prefijo %PDF
  isBase64PDF(value: string | null | undefined): boolean {
    return this.electronWindow.isPdfBase64(value);
  }

  // Abre el PDF en base64 en una ventana hija de Electron (o pestaña en web).
  openBase64PDF(base64: string): void {
    this.electronWindow.openPdfFromBase64(base64, { title: 'Solicitud de traslado' });
  }

  openDocument(value: string): void {
    this.electronWindow.openDocument(value, { title: 'Solicitud de traslado' });
  }

  cambiarEstado(element: any): void {
    this.dialog
      .open(CambiarEstadoComponent, {
        minWidth: '30vw',
        maxWidth: '95vw',
        data: element,
      })
      .afterClosed()
      .subscribe((formData: any) => {
        if (formData) {
          this.trasladosService
            .cambiarEstado(
              element.codigo_traslado,
              formData.estado,
              formData.fechaConfirmacion,
              formData.numeroRadicado,
              formData.numeroBeneficiarios,
              formData.observaciones,
              formData.epsTraslado
            )
            .then(() => {
              this.mostrarTraslados();
            })
            .catch(() => {
              Swal.fire(
                'Error',
                'Error cambiando estado, inténtelo nuevamente',
                'error'
              );
            });
        }
      });
  }

  async verTrabajador(element: any): Promise<void> {
    try {
      this.operario = await lastValueFrom(
        await this.utilityService.buscarOperarioPorCedula(element.numero_cedula)
      );
    } catch (error) {
      Swal.fire(
        'Error',
        'Error buscando trabajador, inténtelo nuevamente',
        'error'
      );
      return; // sin esto se abría el diálogo con data undefined
    }

    this.dialog.open(TrabajadorComponent, {
      minWidth: '80vw',
      maxWidth: '95vw',
      data: this.operario?.data,
    });
  }

  verEstado(element: any): void {
    const actualizaciones = element?.ultimas_actualizaciones;
    if (!actualizaciones || Object.keys(actualizaciones).length === 0) {
      Swal.fire('Sin historial', 'Este traslado todavía no tiene cambios de estado registrados.', 'info');
      return;
    }

    const estadosArray = Object.keys(actualizaciones).map((key) => ({
      fecha: key,
      estado: actualizaciones[key],
    }));

    this.dialog.open(EstadosDialogComponent, {
      minWidth: '50vw',
      maxWidth: '95vw',
      data: { estados: estadosArray },
    });
  }

  async autoAsignar(): Promise<void> {
    if (!this.dataLoaded) {
      Swal.fire(
        'Espera',
        'Por favor espera a que todos los datos estén cargados',
        'warning'
      );
      return;
    }

    if (this.numTraslados <= 0) {
      Swal.fire('Sin cupo', 'Acaba primero con los traslados que tienes pendientes', 'warning');
      return;
    }

    Swal.fire({
      title: 'Cargando...',
      icon: 'info',
      text: 'Por favor espera, asignando traslado...',
      didOpen: () => {
        Swal.showLoading();
      },
      allowOutsideClick: false,
      showConfirmButton: false,
    });

    try {
      const response: any = await this.trasladosService.autoasignarTraslado(
        this.user.datos_basicos.nombres + ' ' + this.user.datos_basicos.apellidos
      );

      if (
        response.correo_status === 'Correo actualizado correctamente.' &&
        response.traslado_status === 'Traslado actualizado correctamente.'
      ) {
        await Swal.fire({
          title: 'Correo y traslado asignados correctamente',
          icon: 'success',
          confirmButtonText: 'Aceptar',
        });
      } else {
        await Swal.fire('Error', 'Error autoasignando, inténtelo nuevamente', 'error');
      }
    } catch (error: any) {
      Swal.close();
      // El backend manda el motivo en error.error.error; si no llega, no se
      // puede dejar al usuario sin respuesta (antes se cerraba en silencio).
      const motivo = error?.error?.error;
      if (motivo === 'No hay traslados disponibles') {
        await Swal.fire('Sin traslados', 'No hay traslados disponibles', 'warning');
      } else if (motivo === 'No hay correos disponibles') {
        await Swal.fire('Sin correos', 'No hay correos disponibles', 'warning');
      } else {
        await Swal.fire('Error', 'No se pudo autoasignar el traslado, inténtelo nuevamente', 'error');
      }
    } finally {
      await this.mostrarTraslados();
    }
  }

  imprimirCedula(numeroCedula: string): void {
    Swal.fire({
      title: 'Cargando...',
      icon: 'info',
      text: 'Obteniendo la cédula escaneada.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.trasladosService.traerCedulaEscaneada(numeroCedula).subscribe({
      next: (data: any) => {
        Swal.close();
        const dataUrl: string | undefined = data?.cedula_escaneada_delante;
        const fileUrl: string | undefined = data?.file_url;

        if (dataUrl && this.isBase64PDF(dataUrl)) {
          this.openBase64PDF(dataUrl);
          return;
        }
        if (fileUrl) {
          this.electronWindow.openExternal(fileUrl);
          return;
        }
        Swal.fire('Error', 'No se encontró la cédula escaneada.', 'error');
      },
      error: () => {
        Swal.close();
        Swal.fire('Error', 'Hubo un problema obteniendo la cédula escaneada.', 'error');
      }
    });
  }

  imprimirSolicitudTraslado(codigoTraslado: string): void {
    Swal.fire({
      title: 'Cargando...',
      icon: 'info',
      text: 'Obteniendo la solicitud de traslado.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.trasladosService.traerSolicitudPorCodigo(codigoTraslado).subscribe({
      next: (data: any) => {
        Swal.close();

        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          Swal.fire('Error', 'No se encontró la solicitud de traslado.', 'error');
          return;
        }

        // Prioridad: documento en ms-documents (document_id) → PDF por API con
        // JWT. La mayoría de traslados traen document_id con file_url NULL y
        // external_url "", así que sin esto siempre caía en "No se encontró la
        // solicitud". Fallback a file_url / external_url (Drive) legacy.
        const docId = row.solicitud_doc?.document_id;
        const url: string | undefined = docId
          ? `${environment.apiUrl}/api/v1/documents/${docId}/download`
          : (row.solicitud_doc?.file_url || row.external_url);

        if (url) {
          this.openDocument(url);
        } else {
          Swal.fire('Error', 'No se encontró la solicitud de traslado.', 'error');
        }
      },
      error: () => {
        Swal.close();
        Swal.fire('Error', 'Hubo un problema obteniendo la solicitud de traslado.', 'error');
      }
    });
  }
}

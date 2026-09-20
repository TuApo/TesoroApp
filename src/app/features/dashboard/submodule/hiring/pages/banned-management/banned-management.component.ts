import { SharedModule } from '@/app/shared/shared.module';
import {  Component, ElementRef, OnInit, ViewChild , ChangeDetectionStrategy, LOCALE_ID, inject, signal } from '@angular/core';
import { formatDate } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { VetadosService } from '../../service/vetados/vetados.service';
import { AutorizarVetadoComponent } from '../../components/autorizar-vetado/autorizar-vetado.component';
import Swal from 'sweetalert2';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-banned-management',
  imports: [
    SharedModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './banned-management.component.html',
  styleUrl: './banned-management.component.css'
} )
export class BannedManagementComponent implements OnInit {

  private readonly locale = inject(LOCALE_ID);

  // Datos de ambas tablas (señales: la pantalla es OnPush y sin zone.js)
  reportados = signal<any[]>([]);
  revisados = signal<any[]>([]);

  /** Fecha como Date para ordenar y filtrar; se pinta igual que `date:'short'`. */
  private readonly colFecha: ColumnaTabla<any> = {
    id: 'fecha', header: 'Fecha', prioridad: 2, tarjeta: 'meta',
    valor: (r) => this.fechaDe(r),
    formato: (r) => {
      const d = this.fechaDe(r);
      return d ? formatDate(d, 'short', this.locale) : String(r.fecha ?? '');
    },
  };

  private fechaDe(r: any): Date | null {
    if (!r?.fecha) return null;
    const d = new Date(r.fecha);
    return isNaN(d.getTime()) ? null : d;
  }

  // Columnas para la primera tabla de reportados (las acciones van en tablaAcciones)
  readonly columnasReportados: ColumnaTabla<any>[] = [
    { id: 'cedula', header: 'Cédula', valor: (r) => r.cedula, tarjeta: 'subtitulo' },
    { id: 'nombre_completo', header: 'Nombre Completo', valor: (r) => r.nombre_completo, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'estado', header: 'Estado', valor: (r) => r.estado, tarjeta: 'badge' },
    this.colFecha,
    { id: 'observacion', header: 'Observación', valor: (r) => r.observacion, prioridad: 2, tarjeta: 'cuerpo', minAncho: '200px' },
    { id: 'centro_costo_carnet', header: 'Centro de Costo', valor: (r) => r.centro_costo_carnet, prioridad: 2, tarjeta: 'cuerpo' },
    { id: 'reportado_por', header: 'Reportado Por', valor: (r) => r.reportado_por, prioridad: 3, tarjeta: 'meta' },
    { id: 'sede', header: 'Sede', valor: (r) => r.sede, prioridad: 2, tarjeta: 'meta' },
  ];

  // Columnas para la segunda tabla de todos los vetados
  readonly columnasRevisados: ColumnaTabla<any>[] = [
    { id: 'cedula', header: 'Cédula', valor: (r) => r.cedula, tarjeta: 'subtitulo' },
    { id: 'nombre_completo', header: 'Nombre Completo', valor: (r) => r.nombre_completo, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'categoriaid', header: 'Categoría', valor: (r) => r.categoria?.id, tarjeta: 'badge' },
    { id: 'categoria_clasificacion', header: 'Descripción', valor: (r) => r.categoria?.clasificacion, prioridad: 2, tarjeta: 'cuerpo' },
    { id: 'categoria_descripcion', header: 'Clasificación', valor: (r) => r.categoria?.descripcion, prioridad: 3, tarjeta: 'cuerpo' },
    { id: 'estado', header: 'Estado', valor: (r) => r.estado, tarjeta: 'meta' },
    this.colFecha,
    { id: 'observacion', header: 'Observación', valor: (r) => r.observacion, prioridad: 3, tarjeta: 'cuerpo', minAncho: '200px' },
    { id: 'reportado_por', header: 'Reportado Por', valor: (r) => r.reportado_por, prioridad: 3, tarjeta: 'meta' },
    { id: 'sede', header: 'Sede', valor: (r) => r.sede, prioridad: 2, tarjeta: 'meta' },
    { id: 'autorizado_por', header: 'Autorizado Por', valor: (r) => r.autorizado_por, prioridad: 3, tarjeta: 'meta' },
  ];
  @ViewChild('file901') file901!: ElementRef<HTMLInputElement>;

  constructor(
    private vetadosService: VetadosService,
    public dialog: MatDialog
  ) { }

  ngOnInit() {
    this.getVetados();
  }

  isSidebarHidden = false;

  toggleSidebar() {
    this.isSidebarHidden = !this.isSidebarHidden;
  }

  triggerUpload901(): void {
    this.file901?.nativeElement.click();
  }

  // Obtener los datos de los vetados
  getVetados() {
    this.vetadosService.listarReportesVetados().subscribe((data: any) => {
      // Separar los datos de reportados y todos los vetados
      this.reportados.set(data.reportados ?? []);  // Solo los reportados
      this.revisados.set(data.revisados ?? []);  // Todos los vetados (reportados + revisados)
    });
  }


  // Función para ver los detalles del elemento
  verDetalle(element: any) {
    const dialogRef = this.dialog.open(AutorizarVetadoComponent, {
      minWidth: '850px',
      data: { element }
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result) {
        (await this.vetadosService.actualizarReporte(element, result)).subscribe((data: any) => {
          this.getVetados();
        });
      }
    });

  }

  // Función para eliminar el registro (por ahora solo imprime)
  eliminar(element: any) {
    this.vetadosService.eliminarReporte(element.id).subscribe((data: any) => {
      this.getVetados();
    });
  }

  onFileSelected901(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Llama a tu servicio para subir el archivo tal cual (FormData)
    this.subirReporte901(file);

    // Reset para permitir re-seleccionar el mismo archivo
    input.value = '';
  }

  private subirReporte901(file: File): void {
    Swal.fire({ title: 'Subiendo 901…', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

    this.vetadosService.uploadReporte901(file).subscribe({
      next: (resp) => {
        Swal.close();
        Swal.fire('Listo', 'Archivo procesado correctamente', 'success');
        // refresca datos si aplica
        // this.loadData();
      },
      error: (err) => {
        Swal.close();
        Swal.fire('Error', err?.error?.detail || 'No se pudo subir el archivo', 'error');
      }
    });
  }

}

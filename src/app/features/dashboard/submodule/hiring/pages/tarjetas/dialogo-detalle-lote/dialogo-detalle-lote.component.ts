import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { FilaResultado, LoteCarga, TarjetasService } from '../../../service/tarjetas.service';

/** Estados por los que se puede filtrar el detalle. */
const ESTADOS = [
  { valor: '', etiqueta: 'Todas' },
  { valor: 'ERROR_VALIDACION', etiqueta: 'Con error' },
  { valor: 'DUPLICADO_ARCHIVO', etiqueta: 'Repetidas en el archivo' },
  { valor: 'DUPLICADO_BD', etiqueta: 'Identificación ya registrada' },
  { valor: 'VALIDO_NUEVO', etiqueta: 'Nuevas' },
  { valor: 'VALIDO_ACTUALIZACION', etiqueta: 'Actualizaciones' },
  { valor: 'SIN_CAMBIOS', etiqueta: 'Sin cambios' },
] as const;

/**
 * Detalle de una carga: sus filas, paginadas desde el servidor y filtrables por estado.
 *
 * <p>La columna «¿Aplicada?» es la que responde a «¿hasta dónde llegó?» cuando una carga se
 * cae a mitad: solo las filas que llegaron a escribirse la tienen en sí.
 */
@Component({
  selector: 'app-dialogo-detalle-lote',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule,
            MatButtonToggleModule, ...TABLA_ESTANDAR],
  templateUrl: './dialogo-detalle-lote.component.html',
  styleUrl: './dialogo-detalle-lote.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoDetalleLoteComponent {
  private readonly srv = inject(TarjetasService);
  private readonly ref = inject<MatDialogRef<DialogoDetalleLoteComponent>>(MatDialogRef);
  readonly datos = inject<{ lote: LoteCarga }>(MAT_DIALOG_DATA);

  readonly estados = ESTADOS;
  readonly estado = signal<string>('');
  readonly filas = signal<FilaResultado[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly tamano = signal(50);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly columnas: ColumnaTabla<FilaResultado>[] = [
    { id: 'fila', header: 'Fila', valor: (f) => f.fila, align: 'right', ancho: '80px', tarjeta: 'titulo' },
    { id: 'estado', header: 'Estado', valor: (f) => f.estado, minAncho: '180px' },
    { id: 'accion', header: 'Acción', valor: (f) => f.accion, minAncho: '130px' },
    { id: 'identificacion', header: 'Identificación', valor: (f) => f.identificacion ?? '—', minAncho: '130px' },
    { id: 'tarjeta', header: 'Tarjeta', valor: (f) => f.numero_tarjeta ?? '—', minAncho: '160px' },
    { id: 'aplicada', header: '¿Aplicada?', valor: (f) => (f.aplicada ? 'Sí' : 'No'), ancho: '110px' },
    { id: 'mensaje', header: 'Detalle', valor: (f) => f.mensaje ?? '', minAncho: '320px', tarjeta: 'cuerpo' },
  ];

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.srv.filasDelLote(this.datos.lote.id, this.pagina(), this.tamano(), this.estado() || null).subscribe({
      next: (p) => {
        this.filas.set(p.content);
        this.total.set(p.total_elements);
        this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.error.set(e.error?.error ?? 'No se pudo cargar el detalle del lote.');
        this.cargando.set(false);
      },
    });
  }

  alCambiarEstado(valor: string): void {
    this.estado.set(valor);
    this.pagina.set(0);
    this.cargar();
  }

  alCambiarPagina(evento: { pagina: number; porPagina: number }): void {
    this.pagina.set(evento.pagina);
    this.tamano.set(evento.porPagina);
    this.cargar();
  }

  descargar(soloProblemas: boolean): void {
    this.srv.resultadoExcel(this.datos.lote.id, soloProblemas).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${soloProblemas ? 'tarjetas_errores' : 'tarjetas_resultado'}_lote_${this.datos.lote.id}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e: HttpErrorResponse) => this.error.set(e.error?.error ?? 'No se pudo descargar el archivo.'),
    });
  }

  cerrar(): void {
    this.ref.close();
  }
}

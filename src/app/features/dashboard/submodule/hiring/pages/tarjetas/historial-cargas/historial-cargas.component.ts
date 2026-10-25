import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { LoteCarga, TarjetasService } from '../../../service/tarjetas.service';
import { DialogoDetalleLoteComponent } from '../dialogo-detalle-lote/dialogo-detalle-lote.component';

/**
 * Historial de cargas de tarjetas.
 *
 * Una fila por SIMULACIÓN y otra por APLICACIÓN, con quién la hizo, el archivo, la hora y
 * los totales reales. Las simulaciones se listan a propósito: son la prueba de que se
 * revisó antes de escribir, y una carga rechazada también deja constancia.
 */
@Component({
  selector: 'app-historial-cargas-tarjetas',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, MatDialogModule, ...TABLA_ESTANDAR],
  templateUrl: './historial-cargas.component.html',
  styleUrl: './historial-cargas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistorialCargasComponent {
  private readonly srv = inject(TarjetasService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  readonly lotes = signal<LoteCarga[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly tamano = signal(20);
  readonly cargando = signal(false);

  readonly columnas: ColumnaTabla<LoteCarga>[] = [
    { id: 'id', header: 'Lote', valor: (l) => l.id, align: 'right', ancho: '80px' },
    { id: 'fecha', header: 'Fecha', valor: (l) => this.fecha(l.fecha_inicio), minAncho: '110px', tarjeta: 'titulo' },
    { id: 'hora', header: 'Hora', valor: (l) => this.hora(l.fecha_inicio), minAncho: '80px' },
    { id: 'usuario', header: 'Usuario', valor: (l) => l.usuario_nombre, minAncho: '200px' },
    { id: 'archivo', header: 'Archivo', valor: (l) => l.archivo_nombre, minAncho: '220px', tarjeta: 'cuerpo' },
    { id: 'filas', header: 'Filas', valor: (l) => l.total_filas, align: 'right', ancho: '80px' },
    { id: 'creadas', header: 'Creados', valor: (l) => l.total_creadas, align: 'right', ancho: '90px' },
    { id: 'actualizadas', header: 'Actualizados', valor: (l) => l.total_actualizadas, align: 'right', ancho: '110px' },
    { id: 'sin_cambios', header: 'Sin cambios', valor: (l) => l.total_sin_cambios, align: 'right', ancho: '110px' },
    { id: 'rechazadas', header: 'Rechazados', valor: (l) => l.total_rechazadas, align: 'right', ancho: '110px' },
    { id: 'estado', header: 'Estado', valor: (l) => l.estado, minAncho: '180px' },
  ];

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.srv.historial(this.pagina(), this.tamano()).subscribe({
      next: (p) => {
        this.lotes.set(p.content);
        this.total.set(p.total_elements);
        this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.cargando.set(false);
        this.snack.open(this.mensaje(e, 'No se pudo cargar el historial'), 'Cerrar', { duration: 4000 });
      },
    });
  }

  alCambiarPagina(evento: { pagina: number; porPagina: number }): void {
    this.pagina.set(evento.pagina);
    this.tamano.set(evento.porPagina);
    this.cargar();
  }

  abrirDetalle(lote: LoteCarga): void {
    this.dialog.open(DialogoDetalleLoteComponent, { data: { lote }, maxWidth: '95vw' });
  }

  descargar(lote: LoteCarga, soloProblemas: boolean): void {
    this.srv.resultadoExcel(lote.id, soloProblemas).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${soloProblemas ? 'tarjetas_errores' : 'tarjetas_resultado'}_lote_${lote.id}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e: HttpErrorResponse) =>
        this.snack.open(this.mensaje(e, 'No se pudo descargar el resultado'), 'Cerrar', { duration: 4000 }),
    });
  }

  /** Un lote que se quedó en PROCESANDO es el síntoma de una caída a mitad de carga. */
  claseFila = (l: LoteCarga): string => {
    if (l.estado === 'FALLIDO' || l.estado === 'PROCESANDO') return 'te-fila--peligro';
    if (l.estado === 'COMPLETADO_CON_ERRORES') return 'te-fila--aviso';
    return '';
  };

  private fecha(iso: string): string {
    return iso ? new Date(iso).toLocaleDateString('es-CO') : '—';
  }

  private hora(iso: string): string {
    return iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—';
  }

  private mensaje(e: HttpErrorResponse, porDefecto: string): string {
    return e.error?.error ?? e.error?.message ?? porDefecto;
  }
}

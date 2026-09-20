import {  Component, Inject , ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import { MatDialogModule } from '@angular/material/dialog';

import { MatButtonModule } from '@angular/material/button';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

/** Un cambio de estado del traslado: la fecha es la clave de `ultimas_actualizaciones`. */
interface EstadoTraslado {
  fecha: string;
  estado: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-estados-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    ...TABLA_ESTANDAR,
],
  templateUrl: './estados-dialog.component.html',
  styleUrl: './estados-dialog.component.css'
} )
export class EstadosDialogComponent {
  // La fecha llega como texto "2025-09-04 14:23:11.123456": ordena bien tal cual.
  readonly columnas: ColumnaTabla<EstadoTraslado>[] = [
    { id: 'fecha', header: 'Fecha', valor: (e) => e.fecha, tarjeta: 'subtitulo' },
    { id: 'estado', header: 'Estado', valor: (e) => e.estado, tarjeta: 'titulo' },
  ];

  constructor(@Inject(MAT_DIALOG_DATA) public data: any) { }
}

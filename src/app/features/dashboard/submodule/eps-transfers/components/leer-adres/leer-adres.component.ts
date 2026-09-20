import {  Component, Inject , ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';


import { MatButtonModule } from '@angular/material/button';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-leer-adres',
  imports: [
    MatDialogModule,
    MatButtonModule,
    ...TABLA_ESTANDAR,
],
  templateUrl: './leer-adres.component.html',
  styleUrl: './leer-adres.component.css'
} )
export class LeerAdresComponent {
  // Las fechas de ADRES llegan como texto y se muestran tal cual.
  readonly columnas: ColumnaTabla<any>[] = [
    { id: 'numero_cedula', header: 'Cedula', valor: (e) => e.numero_cedula, tarjeta: 'subtitulo' },
    { id: 'tipo_documento', header: 'Tipo Documento', valor: (e) => e.tipo_documento, prioridad: 3 },
    { id: 'nombre', header: 'Nombre', valor: (e) => e.nombre, tarjeta: 'titulo' },
    { id: 'apellido', header: 'Apellido', valor: (e) => e.apellido, tarjeta: 'titulo' },
    { id: 'departamento', header: 'Departamento', valor: (e) => e.departamento, prioridad: 3 },
    { id: 'municipio', header: 'Municipio', valor: (e) => e.municipio, prioridad: 2 },
    { id: 'estado', header: 'Estado', valor: (e) => e.estado, tarjeta: 'cuerpo' },
    { id: 'entidad', header: 'Entidad', valor: (e) => e.entidad, tarjeta: 'cuerpo' },
    { id: 'regimen', header: 'Régimen', valor: (e) => e.regimen, prioridad: 2 },
    { id: 'fecha_afiliacion_efectiva', header: 'Fecha Afiliación Efectiva',
      valor: (e) => e.fecha_afiliacion_efectiva, prioridad: 2 },
    { id: 'fecha_finalizacion_afiliacion', header: 'Fecha Finalización Afiliación',
      valor: (e) => e.fecha_finalizacion_afiliacion, prioridad: 3 },
    { id: 'tipo_afiliacion', header: 'Tipo Afiliación', valor: (e) => e.tipo_afiliacion, prioridad: 3 },
    // A Excel va la URL; en pantalla, el enlace.
    { id: 'pdf_documento', header: 'PDF Documento', valor: (e) => e.pdf_documento,
      interactiva: true, filtrable: false, ordenable: false },
    { id: 'marca_temporal', header: 'Marca Temporal', valor: (e) => e.marca_temporal, prioridad: 3, tarjeta: 'meta' },
  ];

  constructor(@Inject(MAT_DIALOG_DATA) public data: any[]) {
  }
}

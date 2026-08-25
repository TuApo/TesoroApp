import {  Component, OnInit , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { HistorialService } from '../../service/historial/historial.service';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-historial-modificaciones',
  imports: [
    MatCardModule,
    StandardFilterTable
],
  templateUrl: './historial-modificaciones.component.html',
  styleUrl: './historial-modificaciones.component.css'
} )
export class HistorialModificacionesComponent implements OnInit {

  columns: ColumnDefinition[] = [
    { name: 'accion', header: 'Acción', type: 'text', filterable: true },
    { name: 'modulo_afectado', header: 'Módulo', type: 'text', filterable: true },
    { name: 'entidad_id', header: 'ID (Entidad)', type: 'text', filterable: true },
    { name: 'usuario_responsable', header: 'Usuario', type: 'text', filterable: true },
    { name: 'fecha_evento', header: 'Fecha Evento', type: 'text', filterable: true }
  ];

  dataList: any[] = [];

  constructor(
    private historialService: HistorialService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.historialService.getHistorialComercializadoraTesorero().subscribe(
      (data: any) => {
        const results = data.results || data || [];
        this.dataList = results.map((item: any) => ({
          accion: item.accion,
          modulo_afectado: item.modulo_afectado,
          entidad_id: item.entidad_id || 'N/A',
          usuario_responsable: item.usuario_responsable || 'SISTEMA',
          fecha_evento: new Date(item.fecha_evento).toLocaleString()
        }));
        this.cdr.markForCheck();
      },
      (error: any) => {
          console.error(error);
      }
    );

  }
}

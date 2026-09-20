import {  Component, Input , ChangeDetectionStrategy } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

export interface CedulaPreviewItem {
    nombreArchivo: string;
    documento: string;
    nombre: string;
    esValido: boolean;
    error?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'app-cedulas-preview',
    standalone: true,
    imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
],
    templateUrl: './cedulas-preview.component.html',
    styleUrls: ['./cedulas-preview.component.css']
} )
export class CedulasPreviewComponent {
    @Input() data: CedulaPreviewItem[] = [];

    /**
     * Columnas de la tabla estándar. El detalle del error (antes solo en el
     * tooltip y en la tarjeta móvil propia) va en su columna para que salga
     * también en la vista de tarjetas y en la copia a Excel.
     */
    readonly columnas: ColumnaTabla<CedulaPreviewItem>[] = [
        { id: 'status', header: 'Estado', valor: (i) => (i.esValido ? 'Correcto' : 'Error'), tarjeta: 'badge', align: 'center' },
        { id: 'documento', header: 'Documento', valor: (i) => i.documento ?? '',
          formato: (i) => i.documento || '---', tarjeta: 'titulo' },
        { id: 'nombre', header: 'Nombre Extraído', valor: (i) => i.nombre ?? '',
          formato: (i) => i.nombre || '---', tarjeta: 'subtitulo', minAncho: '180px' },
        { id: 'archivo', header: 'Archivo Original', valor: (i) => i.nombreArchivo, prioridad: 2, tarjeta: 'cuerpo' },
        { id: 'error', header: 'Error', valor: (i) => (i.esValido ? '' : i.error ?? ''), prioridad: 3, tarjeta: 'cuerpo' },
    ];

    readonly claseFila = (i: CedulaPreviewItem) => (i.esValido ? '' : 'te-fila--peligro');

    get totalItems(): number { return this.data.length; }
    get validItems(): number { return this.data.filter(i => i.esValido).length; }
    get invalidItems(): number { return this.data.filter(i => !i.esValido).length; }
}

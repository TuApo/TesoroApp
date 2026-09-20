import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../../../../shared/components/tabla-estandar';
import { CandidatoSinCelular } from '../../../models/contratacion-metricas.models';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';

@Component({
    selector: 'app-sin-celular-table',
    standalone: true,
    imports: [MatIconModule, MatButtonModule, MatTooltipModule, EmptyStateComponent, ...TABLA_ESTANDAR],
    template: `
    @if (cargando || filas.length) {
      <app-tabla-estandar
        id="metricas-contratacion-sin-celular"
        titulo="Candidatos sin celular"
        modulo="Métricas"
        busqueda="Buscar candidato, documento u oficina…"
        [datos]="filas"
        [columnas]="columnas"
        [filaId]="idCandidato"
        [filasPorPagina]="25"
        [cargando]="cargando">
        <div tablaAccionesBarra>
          <button mat-stroked-button color="primary" type="button"
                  (click)="emitBulkDownload()"
                  [disabled]="!filas.length">
            <mat-icon>file_download</mat-icon>
            Descargar Excel (todos)
          </button>
        </div>

        <ng-template tablaAcciones let-element>
          <button mat-icon-button type="button"
                  matTooltip="Descargar Excel de este candidato"
                  (click)="emitRowDownload(element)">
            <mat-icon>file_download</mat-icon>
          </button>
        </ng-template>
      </app-tabla-estandar>
    } @else {
      <app-empty-state
        icon="check_circle"
        title="Todo al día"
        description="Todos los candidatos en este rango tienen celular confirmado.">
      </app-empty-state>
    }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SinCelularTableComponent implements OnChanges {
    @Input() data: CandidatoSinCelular[] | null = null;
    @Output() bulkDownload = new EventEmitter<string[]>();
    @Output() rowDownload = new EventEmitter<string>();

    filas: CandidatoSinCelular[] = [];
    /** El padre pasa `null` mientras el observable no ha emitido. */
    cargando = true;

    readonly columnas: ColumnaTabla<CandidatoSinCelular>[] = [
        { id: 'nombre', header: 'Candidato', valor: (c) => `${c.nombres} ${c.apellidos}`.trim(),
          tarjeta: 'titulo', minAncho: '180px' },
        { id: 'documento', header: 'Documento', valor: (c) => c.numero_documento, tarjeta: 'subtitulo' },
        { id: 'oficina', header: 'Oficina Origen', valor: (c) => c.oficina, prioridad: 2, tarjeta: 'meta' },
        { id: 'status', header: 'Observación', valor: () => 'Sin Celular Válido', prioridad: 3,
          tarjeta: 'badge', filtrable: false, ordenable: false,
          badge: () => ({ texto: 'Sin Celular Válido', tono: 'danger' }) },
    ];

    readonly idCandidato = (c: CandidatoSinCelular) => c.id;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['data']) {
            this.cargando = this.data === null;
            this.filas = this.data ?? [];
        }
    }

    emitBulkDownload(): void {
        const docs = this.filas
            .map(c => String(c.numero_documento || '').trim())
            .filter(Boolean);
        this.bulkDownload.emit(docs);
    }

    emitRowDownload(element: CandidatoSinCelular): void {
        const doc = String(element?.numero_documento || '').trim();
        if (!doc) return;
        this.rowDownload.emit(doc);
    }
}

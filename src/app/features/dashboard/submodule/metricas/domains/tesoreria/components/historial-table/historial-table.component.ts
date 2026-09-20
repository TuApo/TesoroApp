import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ColumnaTabla, TABLA_ESTANDAR, TonoBadge } from '../../../../../../../../shared/components/tabla-estandar';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { HistorialItem } from '../../models/tesoreria-metricas.models';

@Component({
    selector: 'app-historial-table',
    standalone: true,
    imports: [MatIconModule, EmptyStateComponent, ...TABLA_ESTANDAR],
    template: `
    @if (hasData) {
      <app-tabla-estandar
        id="metricas-tesoreria-historial"
        titulo="Historial detallado"
        modulo="Métricas"
        [datos]="displayRows"
        [columnas]="columnas">
        <ng-template tablaCelda="productos" let-row>
          @if (row.productos && row.productos.length) {
            @for (p of row.productos; track p.producto) {
              <span class="prod-tag">{{ p.producto }} x{{ p.cantidad }}</span>
            }
          } @else { <span class="text-muted">-</span> }
        </ng-template>
      </app-tabla-estandar>
    } @else {
      <app-empty-state icon="history" title="Sin Historial" description="No hay transacciones en el rango seleccionado."></app-empty-state>
    }
    `,
    styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .prod-tag { display: inline-block; background: #ede9fe; background: light-dark(#ede9fe, #18184b); color: #6d28d9; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.65rem; margin: 1px 2px; font-weight: 500; }
    .text-muted { color: var(--text-faint); }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistorialTableComponent implements OnChanges {
    @Input() data: HistorialItem[] | null = null;
    hasData = false;
    displayRows: HistorialItem[] = [];
    private currencyPipe = new CurrencyPipe('es-CO');

    /** Columnas de la tabla estándar: valor plano para buscar/filtrar/copiar. */
    readonly columnas: ColumnaTabla<HistorialItem>[] = [
        { id: 'documento', header: 'Documento', valor: (r) => r.numero_documento, tarjeta: 'subtitulo' },
        { id: 'nombre', header: 'Nombre', valor: (r) => r.nombre, tarjeta: 'titulo', minAncho: '160px' },
        { id: 'finca', header: 'Finca', valor: (r) => r.finca ?? '', formato: (r) => r.finca || '-',
          prioridad: 2, tarjeta: 'meta' },
        { id: 'fecha', header: 'Fecha Ejecucion', valor: (r) => r.fecha_ejecucion || r.fecha_autorizacion,
          tarjeta: 'meta' },
        { id: 'concepto', header: 'Concepto', valor: (r) => r.concepto, tarjeta: 'badge',
          badge: (r) => ({ texto: r.concepto, tono: this.tonoConcepto(r.concepto) }) },
        { id: 'monto', header: 'Monto', valor: (r) => r.monto, align: 'right', tarjeta: 'meta',
          formato: (r) => this.formatCurrency(r.monto), copiaTexto: (r) => String(r.monto ?? '') },
        { id: 'estado', header: 'Estado', valor: (r) => r.estado, prioridad: 2, tarjeta: 'meta',
          badge: (r) => ({ texto: r.estado, tono: this.tonoEstado(r.estado) }) },
        { id: 'autorizo', header: 'Autorizo', valor: (r) => r.autorizado_por ?? '',
          formato: (r) => r.autorizado_por || '-', prioridad: 3, tarjeta: 'meta' },
        { id: 'ejecuto', header: 'Ejecuto', valor: (r) => r.ejecutado_por ?? '',
          formato: (r) => r.ejecutado_por || '-', prioridad: 3, tarjeta: 'meta' },
        { id: 'entrego', header: 'Entrego', valor: (r) => r.quien_entrego ?? '',
          formato: (r) => r.quien_entrego || '-', prioridad: 3, tarjeta: 'meta' },
        { id: 'productos', header: 'Productos', prioridad: 2, tarjeta: 'cuerpo',
          valor: (r) => (r.productos ?? []).map((p) => `${p.producto} x${p.cantidad}`).join(', ') },
    ];

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['data']) {
            this.displayRows = this.data || [];
            this.hasData = this.displayRows.length > 0;
        }
    }

    formatCurrency(val: number): string {
        return this.currencyPipe.transform(val, 'COP', 'symbol-narrow', '1.0-0') || '$0';
    }

    /** Mercado en azul, préstamo en ámbar, el resto neutro (como el chip anterior). */
    tonoConcepto(concepto: string): TonoBadge {
        const c = (concepto || '').toLowerCase();
        if (c.includes('mercado')) return 'info';
        if (c.includes('prestamo')) return 'warn';
        return 'neutro';
    }

    /** Ejecutada en verde, pendiente en ámbar, anulada en rojo (como el punto anterior). */
    tonoEstado(estado: string): TonoBadge {
        switch (estado) {
            case 'EJECUTADA': return 'ok';
            case 'PENDIENTE': return 'warn';
            case 'ANULADA': return 'danger';
            default: return 'neutro';
        }
    }
}

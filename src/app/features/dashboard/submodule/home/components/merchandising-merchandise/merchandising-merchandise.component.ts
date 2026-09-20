import {  Component, OnInit, inject , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ColumnaTabla, TABLA_ESTANDAR, TonoBadge } from '../../../../../../shared/components/tabla-estandar';
import { ComercializadoraService } from '../../../merchandise/service/comercializadora/comercializadora.service';

/** Fecha del backend ('yyyy-MM-dd' o ISO) como Date local: un 'yyyy-MM-dd' con
 *  `new Date()` se leería en UTC y en Colombia caería el día anterior. */
function aFecha(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Existencias como chip: agotado en rojo, 3 o menos en ámbar (igual que el chip anterior). */
function tonoStock(n: number): TonoBadge {
  if (n === 0) return 'danger';
  return n <= 3 ? 'warn' : 'ok';
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-merchandising-merchandise',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './merchandising-merchandise.component.html',
  styleUrl: './merchandising-merchandise.component.css'
} )
export class MerchandisingMerchandiseComponent implements OnInit {
  private comercializadoraService = inject(ComercializadoraService);
  private cdr = inject(ChangeDetectorRef);

  loading = false;

  // Tabla detallada (por lote)
  lotes: any[] = [];
  readonly columnasDetallado: ColumnaTabla<any>[] = [
    { id: 'producto_nombre', header: 'Producto', valor: (r) => r.producto_nombre, tarjeta: 'titulo', minAncho: '160px' },
    { id: 'destino', header: 'Destino', valor: (r) => r.destino ?? '', formato: (r) => r.destino || '—',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'codigo', header: 'Código', valor: (r) => r.codigo ?? '', tarjeta: 'subtitulo' },
    { id: 'cantidad_inicial', header: 'Cant. Recibida', valor: (r) => r.cantidad_inicial, align: 'right',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'cantidad_vendida', header: 'Cant. Vendida', valor: (r) => r.cantidad_vendida, align: 'right',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'disponible', header: 'Disponible', valor: (r) => r.disponible, align: 'right', tarjeta: 'badge',
      badge: (r) => ({ texto: String(r.disponible ?? 0), tono: tonoStock(r.disponible) }) },
    { id: 'valor_unitario', header: 'Valor Unidad', valor: (r) => Number(r.valor_unitario || 0), align: 'right',
      formato: (r) => '$' + this.formatCurrency(r.valor_unitario), copiaTexto: (r) => String(Number(r.valor_unitario || 0)),
      prioridad: 3, tarjeta: 'meta' },
    { id: 'fecha_recepcion', header: 'Fecha Recepción', valor: (r) => aFecha(r.fecha_recepcion),
      // Mismo texto que el `date` pipe de antes (locale por defecto).
      formato: (r) => { const d = aFecha(r.fecha_recepcion); return d ? formatDate(d, 'dd/MM/yyyy', 'en-US') : ''; },
      prioridad: 3, tarjeta: 'meta' },
    { id: 'realizado_por', header: 'Recibido por', valor: (r) => r.realizado_por ?? '',
      formato: (r) => r.realizado_por || '—', prioridad: 3, tarjeta: 'meta' },
  ];

  // Tabla resumen (agrupada por producto)
  resumen: any[] = [];
  readonly columnasResumen: ColumnaTabla<any>[] = [
    { id: 'producto_nombre', header: 'Producto', valor: (r) => r.producto_nombre, tarjeta: 'titulo', minAncho: '160px' },
    { id: 'destino', header: 'Destino', valor: (r) => r.destino ?? '', formato: (r) => r.destino || '—',
      tarjeta: 'subtitulo' },
    { id: 'total_recibido', header: 'Recibido', valor: (r) => r.total_recibido, align: 'right',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'total_vendido', header: 'Vendido', valor: (r) => r.total_vendido, align: 'right',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'total_disponible', header: 'Disponible', valor: (r) => r.total_disponible, align: 'right', tarjeta: 'badge',
      badge: (r) => ({ texto: String(r.total_disponible ?? 0), tono: tonoStock(r.total_disponible) }) },
    { id: 'valor_unitario', header: 'Valor Unidad', valor: (r) => r.valor_unitario, align: 'right',
      formato: (r) => '$' + this.formatCurrency(r.valor_unitario), copiaTexto: (r) => String(r.valor_unitario),
      prioridad: 3, tarjeta: 'meta' },
    { id: 'valor_total', header: 'Valor Total', valor: (r) => r.valor_total, align: 'right',
      formato: (r) => '$' + this.formatCurrency(r.valor_total), copiaTexto: (r) => String(r.valor_total),
      tarjeta: 'cuerpo' },
  ];

  // Métricas
  totalLotes = 0;
  totalDisponible = 0;
  totalValorInventario = 0;

  ngOnInit(): void {
    this.cargarInventario();
  }

  async cargarInventario() {
    this.loading = true;
    this.cdr.markForCheck();
    try {
      // User's sede is no longer used for filtering to display global inventory on Home
      const data: any = await this.comercializadoraService.listarInventarioLotes('');
      const lotes = Array.isArray(data) ? data : (data?.results || []);

      // Tabla detallada
      this.lotes = lotes;

      // Tabla resumen (agrupada por producto_nombre)
      this.resumen = this.agruparPorProducto(lotes);

      // Métricas
      this.totalLotes = lotes.length;
      this.totalDisponible = lotes.reduce((sum: number, l: any) => sum + (l.disponible || 0), 0);
      this.totalValorInventario = lotes.reduce(
        (sum: number, l: any) => sum + ((l.disponible || 0) * Number(l.valor_unitario || 0)), 0
      );
    } catch (error) {
      console.error('Error cargando inventario:', error);
      this.lotes = [];
      this.resumen = [];
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private agruparPorProducto(lotes: any[]): any[] {
    const agrupado: Record<string, any> = {};

    for (const lote of lotes) {
      const key = `${lote.producto_nombre}-${lote.valor_unitario}-${lote.destino}`;
      if (!agrupado[key]) {
        agrupado[key] = {
          producto_nombre: lote.producto_nombre,
          destino: lote.destino,
          valor_unitario: Number(lote.valor_unitario || 0),
          total_recibido: 0,
          total_vendido: 0,
          total_disponible: 0,
          valor_total: 0,
        };
      }
      agrupado[key].total_recibido += (lote.cantidad_inicial || 0);
      agrupado[key].total_vendido += (lote.cantidad_vendida || 0);
      agrupado[key].total_disponible += (lote.disponible || 0);
    }

    const resultado = Object.values(agrupado);
    resultado.forEach((r: any) => {
      r.valor_total = r.total_disponible * r.valor_unitario;
    });

    resultado.sort((a: any, b: any) => a.producto_nombre.localeCompare(b.producto_nombre));
    return resultado;
  }

  formatCurrency(value: any): string {
    const n = Number(value || 0);
    return n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }
}

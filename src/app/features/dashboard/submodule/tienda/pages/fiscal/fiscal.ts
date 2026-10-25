import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { ConfigFiscal, ResumenFiscal, TiendaService } from '../../service/tienda.service';

/**
 * Fiscal y contabilidad de los locales: IVA generado y descontable, costo de ventas y
 * margen del periodo; libros de ventas y compras para el contador (Excel) y la cola de
 * documentos que pasan a la contabilidad (FinCore), donde se emite la factura electrónica.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-fiscal',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda],
  templateUrl: './fiscal.html',
  styleUrls: ['../../styles/tienda-comun.css', './fiscal.css'],
})
export class Fiscal {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  readonly desde = signal(primerDia());
  readonly hasta = signal(hoy());
  readonly pestana = signal<'ventas' | 'compras' | 'cola'>('ventas');
  readonly resumen = signal<ResumenFiscal | null>(null);
  readonly filas = signal<any[]>([]);
  readonly config = signal<ConfigFiscal | null>(null);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly tarifas = computed(() => Object.entries(this.resumen()?.base_por_tarifa ?? {}));

  constructor() {
    this.ctx.cargar();
    effect(() => {
      this.ctx.tiendaId(); this.desde(); this.hasta(); this.pestana();
      untracked(() => this.cargar());
    });
  }

  private filtro() { return { tienda: this.ctx.tiendaId() ?? undefined, desde: this.desde(), hasta: this.hasta() }; }

  async cargar(): Promise<void> {
    try {
      const f = this.filtro();
      const [r, filas] = await Promise.all([
        firstValueFrom(this.api.resumenFiscal(f)),
        firstValueFrom(this.pestana() === 'ventas' ? this.api.libroVentas(f) : this.pestana() === 'compras' ? this.api.libroCompras(f) : this.api.colaFiscal(f)),
      ]);
      this.resumen.set(r); this.filas.set(filas); this.error.set(null);
      const t = this.ctx.tiendaId();
      if (t) this.api.configFiscal(t).subscribe({ next: c => this.config.set(c), error: () => this.config.set(null) });
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar la información fiscal'); }
  }

  mes(delta: number): void {
    const d = new Date(this.desde() + 'T12:00:00'); d.setMonth(d.getMonth() + delta, 1);
    const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    this.desde.set(iso(d)); this.hasta.set(iso(fin > new Date() ? new Date() : fin));
  }

  async sincronizar(): Promise<void> {
    try { const r = await firstValueFrom(this.api.sincronizarFiscal()); this.aviso.set(`Cola al día: ${r['ventas_pos']} ventas, ${r['pedidos']} pedidos y ${r['compras']} compras nuevas.`); this.cargar(); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo sincronizar'); }
  }

  async guardarConfig(c: Partial<ConfigFiscal>): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) return;
    try { this.config.set(await firstValueFrom(this.api.guardarConfigFiscal(t, c))); this.aviso.set('Configuración fiscal guardada'); this.cargar(); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar'); }
  }

  /** Excel del libro que se está viendo, con totales, para el contador. */
  async exportar(): Promise<void> {
    const XLSX = await import('xlsx');
    const p = this.pestana();
    const datos = this.filas().map(f => p === 'ventas'
      ? { Fecha: f.fecha?.slice(0, 10), Canal: f.canal, Documento: f.numero, Tienda: f.tienda, 'Cliente doc.': f.cliente_doc, Cliente: f.cliente_nombre, 'Tarifa IVA %': +f.tarifa, Base: +f.base, IVA: +f.iva, Total: +f.total }
      : p === 'compras'
      ? { Fecha: f.fecha?.slice(0, 10), 'Fecha factura': f.fecha_factura, Factura: f.factura_numero, CUFE: f.cufe, Proveedor: f.proveedor, NIT: f.proveedor_nit, Tienda: f.tienda, Base: +f.base, 'IVA descontable': +f.iva, Total: +f.total, Compra: f.numero }
      : { Fecha: f.fecha?.slice(0, 10), Tipo: f.tipo, Documento: f.numero_origen, Tienda: f.tienda, Tercero: f.tercero_nombre, 'Tercero doc.': f.tercero_doc, Base: +f.base, IVA: +f.iva, Total: +f.total, Estado: f.estado, CUFE: f.cufe || f.cufe_proveedor });
    const hoja = XLSX.utils.json_to_sheet(datos);
    const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, p === 'ventas' ? 'Libro de ventas' : p === 'compras' ? 'Libro de compras' : 'Cola contable');
    const r = this.resumen();
    if (r) XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet([
      { Concepto: 'Ventas (con IVA)', Valor: +r.ventas_total }, { Concepto: 'Base gravable', Valor: +r.ventas_base }, { Concepto: 'IVA generado', Valor: +r.iva_generado },
      { Concepto: 'Compras (con IVA)', Valor: +r.compras_total }, { Concepto: 'IVA descontable', Valor: +r.iva_descontable },
      { Concepto: 'IVA a pagar (estimado)', Valor: +r.iva_a_pagar_estimado }, { Concepto: 'Costo de ventas', Valor: +r.costo_ventas }, { Concepto: 'Margen bruto', Valor: +r.margen_bruto },
    ]), 'Resumen');
    XLSX.writeFile(libro, `${p}_${this.desde()}_${this.hasta()}.xlsx`);
  }

  pesos(v: number | null | undefined): string { return v == null ? '—' : '$' + Math.round(+v).toLocaleString('es-CO'); }
  cuenta(e: string): number { return +(this.resumen()?.cola.find(c => c.estado === e)?.n ?? 0); }
}

function iso(d: Date): string { return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); }
function hoy(): string { return iso(new Date()); }
function primerDia(): string { const d = new Date(); d.setDate(1); return iso(d); }

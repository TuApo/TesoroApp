import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import {
  CandidatoProducto, CompraDetalle, CompraResumen, HistorialPrecios, LineaCompra, LineaCompraNueva, ProveedorTienda, TiendaService,
} from '../../service/tienda.service';

const METODO: Record<string, string> = { APRENDIDO: 'Aprendido', CODIGO: 'Por código', TEXTO: 'Por nombre', IA: 'IA', MANUAL: 'Manual' };

/**
 * Compras a proveedores. La factura se sube tal cual llega (XML/ZIP de la DIAN, PDF o foto):
 * se lee, se empareja cada línea con el catálogo y queda un borrador para revisar. Al
 * recibir entra al inventario con su costo y lo emparejado se aprende para la próxima.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-compras',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda],
  templateUrl: './compras.html',
  styleUrls: ['../../styles/tienda-comun.css', './compras.css'],
})
export class Compras {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private visor = inject(DocViewerService);
  readonly METODO = METODO;

  readonly pestana = signal<'compras' | 'proveedores'>('compras');
  readonly estado = signal('BORRADOR');
  readonly lista = signal<CompraResumen[]>([]);
  readonly sel = signal<CompraDetalle | null>(null);
  readonly proveedores = signal<ProveedorTienda[]>([]);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly ocupado = signal<string | null>(null);
  // Emparejar a mano
  readonly buscandoEn = signal<string | null>(null);
  readonly busqueda = signal('');
  readonly resultados = signal<CandidatoProducto[]>([]);
  private buscarTimer: ReturnType<typeof setTimeout> | null = null;
  // Historial
  readonly historial = signal<{ nombre: string; h: HistorialPrecios } | null>(null);
  // Proveedor nuevo
  provNuevo: Partial<ProveedorTienda> = {};
  readonly editandoProv = signal<string | null>(null);

  readonly sinEmparejar = computed(() => (this.sel()?.items ?? []).filter(i => !i.producto_id).length);
  readonly diferencia = computed(() => {
    const s = this.sel(); if (!s?.total_documento) return null;
    return Math.round(+s.total - +s.total_documento);
  });

  constructor() {
    this.ctx.cargar();
    effect(() => { this.ctx.tiendaId(); this.estado(); untracked(() => { this.cargar(); this.cargarProveedores(); }); });
  }

  async cargar(): Promise<void> {
    try { this.lista.set(await firstValueFrom(this.api.compras({ tienda: this.ctx.tiendaId() ?? undefined, estado: this.estado() }))); this.error.set(null); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudieron cargar las compras'); }
  }
  async cargarProveedores(): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) { this.proveedores.set([]); return; }
    try { this.proveedores.set(await firstValueFrom(this.api.proveedores(t))); } catch { this.proveedores.set([]); }
  }

  async abrir(id: string): Promise<void> {
    try { this.sel.set(await firstValueFrom(this.api.compra(id))); this.aviso.set(null); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir la compra'); }
  }

  /** Factura del proveedor -> borrador. */
  async importar(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = '';
    const t = this.ctx.tiendaId(); if (!f) return;
    if (!t) { this.error.set('Elija arriba la tienda que recibe la mercancía'); return; }
    this.ocupado.set('importar'); this.error.set(null); this.aviso.set(null);
    try {
      const c = await firstValueFrom(this.api.importarFactura(t, f));
      this.sel.set(c); this.estado.set('BORRADOR'); this.cargarProveedores();
      const n = c.items.length, sin = c.items.filter(i => !i.producto_id).length;
      this.aviso.set(c.aviso ?? `Leímos ${n} ${n === 1 ? 'línea' : 'líneas'}${sin ? `; ${sin} por emparejar` : ', todas emparejadas'}. Revise y reciba.`);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo leer la factura'); }
    finally { this.ocupado.set(null); }
  }

  /** Excel con columnas codigo, descripcion, cantidad, costo, iva. */
  async desdeExcel(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = '';
    const t = this.ctx.tiendaId(); if (!f || !t) return;
    this.ocupado.set('excel'); this.error.set(null);
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const filas: Record<string, unknown>[] = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { defval: null });
      const clave = (r: Record<string, unknown>, ...ks: string[]) => {
        for (const k of Object.keys(r)) if (ks.some(x => k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(x))) return r[k];
        return null;
      };
      const num = (v: unknown) => v == null || v === '' ? null : Number(String(v).replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
      const lineas: LineaCompraNueva[] = filas.map(r => ({
        codigo: (clave(r, 'codigo', 'sku', 'referencia') as string) ?? null,
        descripcion: String(clave(r, 'descripcion', 'producto', 'nombre') ?? '').trim(),
        cantidad: num(clave(r, 'cantidad', 'cant')) ?? 1, costo_unitario: num(clave(r, 'costo', 'valor', 'precio')), iva_pct: num(clave(r, 'iva')),
      })).filter(l => l.descripcion);
      if (!lineas.length) throw { error: { error: 'El Excel no tiene filas con descripción' } };
      const c = await firstValueFrom(this.api.crearCompra({ tienda_id: t, origen: 'EXCEL', lineas }));
      this.sel.set(c); this.estado.set('BORRADOR');
      this.aviso.set(`Cargamos ${c.items.length} líneas del Excel. Revise el emparejamiento y reciba.`);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo leer el Excel'); }
    finally { this.ocupado.set(null); }
  }

  async plantilla(): Promise<void> {
    const XLSX = await import('xlsx');
    const hoja = XLSX.utils.json_to_sheet([{ codigo: 'AP-IP15-128', descripcion: 'iPhone 15 128GB', cantidad: 2, costo: 2200000, iva: 19 }]);
    const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, 'Compra');
    XLSX.writeFile(libro, 'plantilla_compra.xlsx');
  }

  async nueva(): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) { this.error.set('Elija la tienda'); return; }
    try { this.sel.set(await firstValueFrom(this.api.crearCompra({ tienda_id: t, origen: 'MANUAL', lineas: [] }))); this.estado.set('BORRADOR'); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo crear'); }
  }

  async encabezado(cambio: Partial<{ proveedor_id: string | null; factura_numero: string | null; fecha_factura: string | null; observacion: string | null }>): Promise<void> {
    const s = this.sel(); if (!s) return;
    try {
      this.sel.set(await firstValueFrom(this.api.encabezadoCompra(s.id, {
        proveedor_id: s.proveedor_id, factura_numero: s.factura_numero, fecha_factura: s.fecha_factura, observacion: s.observacion, ...cambio,
      })));
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar'); }
  }

  /** Siempre manda el producto actual: el servidor reemplaza el emparejamiento con lo que llega. */
  async linea(i: LineaCompra, cambio: Partial<LineaCompraNueva>): Promise<void> {
    const s = this.sel(); if (!s) return;
    try {
      this.sel.set(await firstValueFrom(this.api.editarLineaCompra(s.id, i.id, {
        producto_id: i.producto_id, variante_id: i.variante_id, cantidad: +i.cantidad, costo_unitario: +i.costo_unitario, iva_pct: +i.impuesto_pct, ...cambio,
      })));
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo actualizar la línea'); }
  }
  elegir(i: LineaCompra, c: CandidatoProducto): void { this.linea(i, { producto_id: c.producto_id, variante_id: c.variante_id }); this.buscandoEn.set(null); }
  desemparejar(i: LineaCompra): void { this.linea(i, { producto_id: null, variante_id: null }); }

  buscar(i: LineaCompra, v: string): void {
    this.buscandoEn.set(i.id); this.busqueda.set(v);
    if (this.buscarTimer) clearTimeout(this.buscarTimer);
    const t = this.ctx.tiendaId() ?? this.sel()?.tienda_id;
    if (v.trim().length < 2 || !t) { this.resultados.set([]); return; }
    this.buscarTimer = setTimeout(() => this.api.buscarProductosCompra(t, v.trim()).subscribe({ next: r => this.resultados.set(r), error: () => this.resultados.set([]) }), 300);
  }

  async agregarLinea(): Promise<void> {
    const s = this.sel(); if (!s) return;
    try { this.sel.set(await firstValueFrom(this.api.agregarLineaCompra(s.id, { descripcion: 'Producto', cantidad: 1, costo_unitario: 0, iva_pct: 0 }))); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo agregar'); }
  }
  async quitar(i: LineaCompra): Promise<void> {
    const s = this.sel(); if (!s || !confirm(`¿Quitar "${i.descripcion_proveedor || i.producto}"?`)) return;
    try { this.sel.set(await firstValueFrom(this.api.quitarLineaCompra(s.id, i.id))); } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo quitar'); }
  }

  async recibir(): Promise<void> {
    const s = this.sel(); if (!s) return;
    if (!confirm(`¿Recibir la compra ${s.numero}? La mercancía entra al inventario de ${s.tienda} con estos costos.`)) return;
    this.ocupado.set('recibir'); this.error.set(null);
    try { this.sel.set(await firstValueFrom(this.api.recibirCompra(s.id))); this.aviso.set('Compra recibida: el inventario y los costos quedaron al día.'); this.cargar(); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo recibir'); }
    finally { this.ocupado.set(null); }
  }
  async anular(): Promise<void> {
    const s = this.sel(); if (!s || !confirm(`¿Anular el borrador ${s.numero}?`)) return;
    try { this.sel.set(await firstValueFrom(this.api.anularCompra(s.id))); this.cargar(); } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo anular'); }
  }

  async verHistorial(i: LineaCompra): Promise<void> {
    if (!i.producto_id) return;
    try { this.historial.set({ nombre: i.producto ?? '', h: await firstValueFrom(this.api.historialPrecios(i.producto_id)) }); }
    catch { this.error.set('No se pudo cargar el historial'); }
  }

  verDocumento(): void {
    const d = this.sel()?.documento_doc_id; if (d) this.visor.openInNewTab(`${environment.apiUrl}/api/v1/documents/${d}/download`);
  }

  // Proveedores
  editarProv(p: ProveedorTienda | null): void { this.editandoProv.set(p?.id ?? 'nuevo'); this.provNuevo = p ? { ...p } : { dias_credito: 0 }; }
  async guardarProv(): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) return;
    const id = this.editandoProv(); if (!id) return;
    try { await firstValueFrom(this.api.guardarProveedor(t, this.provNuevo, id === 'nuevo' ? undefined : id)); this.editandoProv.set(null); this.cargarProveedores(); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar el proveedor'); }
  }

  pesos(v: number | null | undefined): string { return v == null ? '—' : '$' + Math.round(+v).toLocaleString('es-CO'); }
}

import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, inject, signal } from '@angular/core';
import { CommonModule, formatCurrency, formatDate, getCurrencySymbol } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { Negocio, Producto, TiendaService } from '../../service/tienda.service';

/**
 * Catálogo: productos, precios y costos.
 *
 * <p>El costo se pide junto al precio y no como un campo aparte perdido en otra pantalla,
 * porque sin él no hay margen — y sin margen, la mitad del tablero son cifras inventadas.
 *
 * <p>Cambiar un precio no sobrescribe el anterior: cierra su vigencia y abre otra. Por eso
 * la ficha muestra el histórico.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-catalogo',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, ...TABLA_ESTANDAR],
  templateUrl: './catalogo.html',
  styleUrls: ['../../styles/tienda-comun.css', './catalogo.css'],
})
export class Catalogo implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private readonly locale = inject(LOCALE_ID);

  readonly productos = signal<Producto[]>([]);
  readonly categorias = signal<Array<Record<string, unknown>>>([]);
  readonly negocios = signal<Negocio[]>([]);
  readonly historico = signal<Array<Record<string, unknown>>>([]);
  readonly seleccionado = signal<Producto | null>(null);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly formulario = signal<'' | 'producto' | 'categoria' | 'precio'>('');

  /**
   * Productos en la tabla estándar. La búsqueda por nombre o SKU sigue yendo al servidor
   * (la lista trae solo los primeros 60), por eso la tabla no pinta su propio buscador.
   */
  readonly columnasProductos: ColumnaTabla<Producto>[] = [
    { id: 'producto', header: 'Producto', valor: (p) => p.nombre, tarjeta: 'titulo' },
    { id: 'sku', header: 'SKU', valor: (p) => p.sku, tarjeta: 'subtitulo' },
    { id: 'marca', header: 'Marca', valor: (p) => p.marca ?? '', prioridad: 2, tarjeta: 'meta' },
    { id: 'alcance', header: 'Alcance', tarjeta: 'badge',
      valor: (p) => (p.negocio_id ? 'del negocio' : 'global'),
      badge: (p) => p.negocio_id ? { texto: 'del negocio', tono: 'neutro' } : { texto: 'global', tono: 'info' } },
  ];
  readonly idProducto = (p: Producto) => p.id;
  /** El producto elegido se marca en la tabla: es el que manda en la ficha de la derecha. */
  readonly claseProducto = (p: Producto) => (this.seleccionado()?.id === p.id ? 'te-fila--destacada' : '');

  /** Histórico de precios: fechas y pesos planos; el formato es solo lo visible. */
  readonly columnasHistorico: ColumnaTabla<Record<string, unknown>>[] = [
    { id: 'desde', header: 'Desde', tarjeta: 'titulo',
      valor: (h) => (h['vigente_desde'] ? new Date(h['vigente_desde'] as string) : null),
      formato: (h) => (h['vigente_desde'] ? formatDate(h['vigente_desde'] as string, 'shortDate', this.locale) : '') },
    { id: 'precio', header: 'Precio', align: 'right', tarjeta: 'subtitulo',
      valor: (h) => h['precio'] as number,
      formato: (h) => this.pesos(h['precio']), copiaTexto: (h) => String(h['precio'] ?? '') },
    { id: 'costo', header: 'Costo', align: 'right', tarjeta: 'meta',
      valor: (h) => h['costo'] as number,
      formato: (h) => this.pesos(h['costo']), copiaTexto: (h) => String(h['costo'] ?? '') },
    { id: 'margen', header: 'Margen', align: 'right', tarjeta: 'meta',
      valor: (h) => h['margen'] as number,
      formato: (h) => this.pesos(h['margen']), copiaTexto: (h) => String(h['margen'] ?? '') },
    { id: 'alcance', header: 'Alcance', tarjeta: 'badge',
      valor: (h) => (h['tienda_id'] ? 'tienda' : 'negocio'),
      badge: (h) => h['tienda_id'] ? { texto: 'tienda', tono: 'neutro' } : { texto: 'negocio', tono: 'info' } },
  ];
  readonly idHistorico = (h: Record<string, unknown>) => h['id'];
  /** Las vigencias ya cerradas se atenúan: siguen ahí como histórico, no como precio actual. */
  readonly claseHistorico = (h: Record<string, unknown>) => (h['vigente_hasta'] ? 'te-fila--atenuada' : '');

  busqueda = '';
  nuevoProducto = {
    sku: '', nombre: '', descripcion: '', marca: '', unidad: 'und',
    codigo_barras: '', categoria_id: '', negocio_id: '', impuesto_pct: 0,
  };
  nuevaCategoria = { codigo: '', nombre: '', negocio_id: '' };
  nuevoPrecio = { precio: 0, costo: 0, soloEstaTienda: false };

  ngOnInit(): void {
    this.ctx.cargar();
    this.buscar();
    this.api.categorias().subscribe({ next: c => this.categorias.set(c), error: () => {} });
    this.api.negocios().subscribe({ next: n => this.negocios.set(n), error: () => {} });
  }

  buscar(): void {
    this.cargando.set(true);
    this.api.productos({ texto: this.busqueda || undefined, tamano: 60 }).subscribe({
      next: p => { this.productos.set(p.content); this.cargando.set(false); },
      error: () => { this.error.set('No se pudo cargar el catálogo'); this.cargando.set(false); },
    });
  }

  seleccionar(p: Producto): void {
    this.seleccionado.set(p);
    this.formulario.set('');
    this.api.historicoPrecios(p.id).subscribe({
      next: h => this.historico.set(h), error: () => this.historico.set([]),
    });
  }

  abrir(f: '' | 'producto' | 'categoria' | 'precio'): void {
    this.formulario.set(this.formulario() === f ? '' : f);
    this.error.set(null);
    this.aviso.set(null);
  }

  crearProducto(): void {
    this.api.crearProducto({
      ...this.nuevoProducto,
      negocio_id: this.nuevoProducto.negocio_id || undefined,
      categoria_id: this.nuevoProducto.categoria_id || undefined,
      codigo_barras: this.nuevoProducto.codigo_barras || undefined,
    }).subscribe({
      next: () => {
        this.aviso.set(`Producto "${this.nuevoProducto.nombre}" creado. `
          + 'Ahora fíjele precio y costo, o no se podrá vender.');
        this.nuevoProducto = {
          sku: '', nombre: '', descripcion: '', marca: '', unidad: 'und',
          codigo_barras: '', categoria_id: '', negocio_id: '', impuesto_pct: 0,
        };
        this.formulario.set('');
        this.buscar();
      },
      error: e => this.fallo(e),
    });
  }

  crearCategoria(): void {
    this.api.crearCategoria({
      ...this.nuevaCategoria,
      negocio_id: this.nuevaCategoria.negocio_id || undefined,
    }).subscribe({
      next: () => {
        this.aviso.set('Categoría creada.');
        this.nuevaCategoria = { codigo: '', nombre: '', negocio_id: '' };
        this.formulario.set('');
        this.api.categorias().subscribe({ next: c => this.categorias.set(c), error: () => {} });
      },
      error: e => this.fallo(e),
    });
  }

  fijarPrecio(): void {
    const p = this.seleccionado();
    if (!p) return;
    this.api.fijarPrecio(p.id, {
      precio: this.nuevoPrecio.precio,
      costo: this.nuevoPrecio.costo,
      tienda_id: this.nuevoPrecio.soloEstaTienda ? (this.ctx.tiendaId() ?? undefined) : undefined,
    }).subscribe({
      next: () => {
        this.aviso.set('Precio fijado. El anterior queda en el histórico, no se borra.');
        this.nuevoPrecio = { precio: 0, costo: 0, soloEstaTienda: false };
        this.formulario.set('');
        this.seleccionar(p);
      },
      error: e => this.fallo(e),
    });
  }

  /** Lo mismo que el pipe `currency:'COP':'symbol-narrow':'1.0-0'` de la plantilla. */
  private pesos(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    if (isNaN(n)) return '';
    return formatCurrency(n, this.locale, getCurrencySymbol('COP', 'narrow', this.locale), 'COP', '1.0-0');
  }

  private fallo(e: unknown): void {
    const cuerpo = (e as { error?: { error?: string } })?.error;
    this.error.set(cuerpo?.error ?? 'No se pudo completar la operación');
    this.aviso.set(null);
  }
}

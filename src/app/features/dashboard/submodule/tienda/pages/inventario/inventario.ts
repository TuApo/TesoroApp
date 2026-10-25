import { FotosEvidencia } from '../../components/fotos-evidencia/fotos-evidencia';
import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule, formatCurrency, formatDate, getCurrencySymbol } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR, TonoBadge } from '../../../../../../shared/components/tabla-estandar';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { Movimiento, Producto, Stock, TiendaService } from '../../service/tienda.service';
import { ChatIaAcceso, ContextoChatIa } from '../../../../../../shared/components/chat-ia';

/**
 * Existencias, kardex y ajustes.
 *
 * <p>El kardex se pagina siempre: es histórico y crece sin límite. La pantalla muestra el
 * <b>disponible</b> (cantidad menos reservado) junto a la cantidad total, porque son
 * cifras distintas y confundirlas es lo que hace que alguien venda lo que ya está apartado
 * para un pedido.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-inventario',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, ...TABLA_ESTANDAR, FotosEvidencia, ChatIaAcceso],
  templateUrl: './inventario.html',
  styleUrls: ['../../styles/tienda-comun.css', './inventario.css'],
})
export class Inventario implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private readonly locale = inject(LOCALE_ID);

  readonly stock = signal<Stock[]>([]);
  readonly bajoMinimo = signal<Stock[]>([]);
  /** Mínimo y máximo por producto en esta tienda (store_producto_tienda). */
  readonly minimos = signal<Record<string, { min: number; max: number | null }>>({});
  readonly kardex = signal<Movimiento[]>([]);
  readonly nombres = signal<Record<string, string>>({});
  readonly pestana = signal<'existencias' | 'kardex' | 'reponer'>('existencias');

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly formularioAbierto = signal(false);
  /** Movimiento recién registrado: se le pueden agregar varias fotos de soporte. */
  readonly ultimoMovimiento = signal<string | null>(null);

  readonly productos = signal<Producto[]>([]);
  ajuste = { producto_id: '', tipo: 'ENTRADA_COMPRA', cantidad: 0, costo_unitario: 0, motivo: '' };

  readonly tiposAjuste = [
    { codigo: 'ENTRADA_COMPRA', nombre: 'Entrada por compra' },
    { codigo: 'AJUSTE_POS', nombre: 'Ajuste positivo (sobrante)' },
    { codigo: 'AJUSTE_NEG', nombre: 'Ajuste negativo (faltante)' },
    { codigo: 'MERMA', nombre: 'Merma (dañado o vencido)' },
    { codigo: 'CONSUMO_INTERNO', nombre: 'Consumo interno' },
  ];

  /** Existencias: cantidades y pesos como número; el formato es solo lo visible. */
  /** Foto principal por producto, para reconocerlo en la tabla (se amplía al tocarla). */
  readonly fotos = signal<Record<string, string>>({});

  /** Contexto del chat de IA: la tienda, la pestaña y lo que está por reponer (con nombres). */
  readonly contextoChat = computed<ContextoChatIa>(() => {
    const t = this.ctx.tienda();
    const n = this.nombres();
    return {
      modulo: 'tienda.inventario',
      moduloNombre: 'Tienda › Inventario',
      tiendaId: t?.id ?? null,
      tiendaNombre: t?.nombre ?? null,
      ruta: '/dashboard/tienda/inventario',
      parametros: { tienda: t?.id ?? null },
      pantalla: {
        pestana: this.pestana(),
        referenciasConExistencias: this.stock().length,
        bajoMinimo: this.bajoMinimo().slice(0, 40).map(s => ({ producto: n[s.producto_id] ?? s.producto_id, cantidad: s.cantidad })),
      },
      sugerencias: [
        '¿Qué productos se van a agotar en los próximos días?',
        'Arma el pedido sugerido para 30 días y expórtalo a Excel',
        '¿Qué inventario está quieto o en exceso y cuánto dinero representa?',
        '¿Qué se vende más en esta tienda y tengo suficiente?',
      ],
    };
  });

  private cargarFotos(ids: string[]): void {
    this.api.imagenesPrincipales(ids).subscribe({ next: m => this.fotos.update(f => ({ ...f, ...m })), error: () => {} });
  }

  readonly columnasStock: ColumnaTabla<Stock>[] = [
    { id: 'producto', header: 'Producto', valor: (s) => this.nombre(s.producto_id), tarjeta: 'titulo',
      imagen: (s) => this.fotos()[s.producto_id], minAncho: '220px' },
    { id: 'cantidad', header: 'Cantidad', align: 'right', tarjeta: 'meta', valor: (s) => s.cantidad },
    { id: 'apartado', header: 'Apartado', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (s) => s.cantidad_reservada },
    { id: 'disponible', header: 'Disponible', align: 'right', tarjeta: 'subtitulo', valor: (s) => this.disponible(s) },
    { id: 'minimo', header: 'Mínimo', align: 'right', tarjeta: 'meta', valor: (s) => this.minimos()[s.producto_id]?.min ?? 0 },
    { id: 'costo', header: 'Costo promedio', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (s) => s.costo_promedio,
      formato: (s) => this.pesos(s.costo_promedio), copiaTexto: (s) => String(s.costo_promedio ?? '') },
    { id: 'valor', header: 'Valor', align: 'right', tarjeta: 'meta',
      valor: (s) => s.cantidad * s.costo_promedio,
      formato: (s) => this.pesos(s.cantidad * s.costo_promedio),
      copiaTexto: (s) => String(s.cantidad * s.costo_promedio) },
  ];

  /** Por reponer: el disponible va como chip de aviso, igual que antes. */
  readonly columnasReponer: ColumnaTabla<Stock>[] = [
    { id: 'producto', header: 'Producto', valor: (s) => this.nombre(s.producto_id), tarjeta: 'titulo',
      imagen: (s) => this.fotos()[s.producto_id], minAncho: '220px' },
    { id: 'disponible', header: 'Disponible', align: 'right', tarjeta: 'badge',
      valor: (s) => this.disponible(s),
      badge: (s) => ({ texto: String(this.disponible(s)), tono: 'warn' }) },
    { id: 'minimo', header: 'Mínimo', align: 'right', tarjeta: 'meta', valor: (s) => this.minimos()[s.producto_id]?.min ?? 0 },
    { id: 'pedir', header: 'Sugerido a pedir', align: 'right', tarjeta: 'subtitulo', valor: (s) => this.sugerido(s) },
  ];

  /** Kardex: la fecha como Date para que ordene bien; el tipo como chip. */
  readonly columnasKardex: ColumnaTabla<Movimiento>[] = [
    { id: 'fecha', header: 'Fecha', tarjeta: 'subtitulo',
      valor: (m) => (m.realizado_en ? new Date(m.realizado_en) : null),
      formato: (m) => (m.realizado_en ? formatDate(m.realizado_en, 'short', this.locale) : ''),
      copiaTexto: (m) => (m.realizado_en ? formatDate(m.realizado_en, 'short', this.locale) : '') },
    { id: 'producto', header: 'Producto', valor: (m) => this.nombre(m.producto_id), tarjeta: 'titulo',
      imagen: (m) => this.fotos()[m.producto_id], tamanoImagen: 40 },
    { id: 'tipo', header: 'Tipo', tarjeta: 'badge', valor: (m) => m.tipo,
      badge: (m) => ({ texto: m.tipo, tono: this.tonoMovimiento(m.tipo) }) },
    { id: 'cantidad', header: 'Cantidad', align: 'right', tarjeta: 'meta', valor: (m) => m.cantidad },
    { id: 'saldo', header: 'Saldo', align: 'right', tarjeta: 'meta', valor: (m) => m.saldo_despues },
    { id: 'motivo', header: 'Motivo', prioridad: 2, tarjeta: 'cuerpo', valor: (m) => m.motivo ?? '' },
    { id: 'quien', header: 'Quién', prioridad: 3, tarjeta: 'meta', valor: (m) => m.realizado_por_nombre ?? '' },
  ];

  readonly idStock = (s: Stock) => s.id;
  readonly idMovimiento = (m: Movimiento) => m.id;

  constructor() {
    // Cambiar de tienda tiene que recargar todo: dejar los datos de la anterior en
    // pantalla es la forma más fácil de que alguien ajuste el inventario equivocado.
    effect(() => {
      const tienda = this.ctx.tiendaId();
      if (tienda) this.cargar(tienda);
    });
  }

  ngOnInit(): void {
    this.ctx.cargar();
  }

  cargar(tienda: string): void {
    this.cargando.set(true);
    this.api.stock(tienda).subscribe({
      next: s => { this.stock.set(s); this.cargando.set(false); this.cargarNombres(s); this.cargarFotos(s.map(x => x.producto_id)); },
      error: () => { this.error.set('No se pudo cargar el inventario'); this.cargando.set(false); },
    });
    this.api.bajoMinimo(tienda).subscribe({
      next: s => this.bajoMinimo.set(s), error: () => this.bajoMinimo.set([]),
    });
    this.api.minimos(tienda).subscribe({
      next: ms => this.minimos.set(Object.fromEntries(ms.map(m => [m.producto_id, { min: m.stock_min, max: m.stock_max }]))),
      error: () => this.minimos.set({}),
    });
    this.api.kardex(tienda).subscribe({
      next: k => this.kardex.set(k.content), error: () => this.kardex.set([]),
    });
    this.api.productos({ tamano: 200 }).subscribe({
      next: p => this.productos.set(p.content), error: () => {},
    });
  }

  nombre(productoId: string): string {
    return this.nombres()[productoId] ?? productoId.slice(0, 8);
  }

  /** Hasta el máximo si está fijado; si no, hasta el doble del mínimo. */
  sugerido(s: Stock): number {
    const m = this.minimos()[s.producto_id]; if (!m) return 0;
    return Math.max(0, Math.ceil((m.max ?? m.min * 2) - this.disponible(s)));
  }

  fijarMinimo(s: Stock, valor: string): void {
    const tienda = this.ctx.tiendaId(); const min = Math.floor(+valor);
    if (!tienda || !Number.isFinite(min) || min < 0) return;
    const actual = this.minimos()[s.producto_id];
    if (actual?.min === min) return;
    const max = actual?.max != null && actual.max < min ? null : actual?.max ?? null;
    this.api.fijarMinimo(tienda, { producto_id: s.producto_id, stock_min: min, stock_max: max }).subscribe({
      next: () => {
        this.minimos.update(m => ({ ...m, [s.producto_id]: { min, max } }));
        this.aviso.set(`Mínimo de ${this.nombre(s.producto_id)}: ${min}.`);
        this.api.bajoMinimo(tienda).subscribe({ next: b => this.bajoMinimo.set(b), error: () => {} });
      },
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo fijar el mínimo'),
    });
  }

  disponible(s: Stock): number {
    return s.cantidad - s.cantidad_reservada;
  }

  /** Entradas en verde, salidas y mermas en rojo, ajustes neutros (los colores de antes). */
  private tonoMovimiento(tipo: string): TonoBadge {
    if (tipo.startsWith('ENTRADA')) return 'ok';
    if (tipo.startsWith('SALIDA') || tipo === 'MERMA') return 'danger';
    return 'neutro';
  }

  /** Lo mismo que el pipe `currency:'COP':'symbol-narrow':'1.0-0'` de la plantilla. */
  private pesos(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    if (isNaN(n)) return '';
    return formatCurrency(n, this.locale, getCurrencySymbol('COP', 'narrow', this.locale), 'COP', '1.0-0');
  }

  registrarAjuste(): void {
    const tienda = this.ctx.tiendaId();
    if (!tienda) return;
    this.api.ajustar(tienda, {
      producto_id: this.ajuste.producto_id,
      tipo: this.ajuste.tipo,
      cantidad: this.ajuste.cantidad,
      costo_unitario: this.ajuste.costo_unitario || undefined,
      motivo: this.ajuste.motivo,
    }).subscribe({
      next: m => {
        this.aviso.set(`Movimiento registrado. Saldo: ${m.saldo_despues}. Agregue fotos de soporte si las tiene.`);
        this.ultimoMovimiento.set(m.id);
        this.ajuste = { producto_id: '', tipo: 'ENTRADA_COMPRA', cantidad: 0, costo_unitario: 0, motivo: '' };
        this.formularioAbierto.set(false);
        this.cargar(tienda);
      },
      error: e => {
        const cuerpo = (e as { error?: { error?: string } })?.error;
        this.error.set(cuerpo?.error ?? 'No se pudo registrar el movimiento');
      },
    });
  }

  /** Los nombres se resuelven en bloque, no uno por fila: una consulta, no cincuenta. */
  private cargarNombres(stock: Stock[]): void {
    if (stock.length === 0) return;
    this.api.productos({ tamano: 200 }).subscribe({
      next: p => {
        const mapa: Record<string, string> = {};
        for (const producto of p.content) mapa[producto.id] = producto.nombre;
        this.nombres.set(mapa);
      },
      error: () => {},
    });
  }
}

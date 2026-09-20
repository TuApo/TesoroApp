import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, formatCurrency, getCurrencySymbol } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

import { BuscadorPersonas } from '../../components/buscador-personas/buscador-personas';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { Cupo, Pago, PersonaTarjeta, Producto, TiendaService, Venta } from '../../service/tienda.service';

/** Los medios de pago, en el orden en que se usan en el mostrador. */
const METODOS = [
  { codigo: 'NOMINA', nombre: 'Cupo de nómina', requiereCedula: true, requiereReferencia: false },
  { codigo: 'EFECTIVO', nombre: 'Efectivo', requiereCedula: false, requiereReferencia: false },
  { codigo: 'NEQUI', nombre: 'Nequi', requiereCedula: false, requiereReferencia: true },
  { codigo: 'DAVIPLATA', nombre: 'Daviplata', requiereCedula: false, requiereReferencia: true },
  { codigo: 'LLAVE', nombre: 'Llave', requiereCedula: false, requiereReferencia: true },
  { codigo: 'TRANSFERENCIA', nombre: 'Transferencia', requiereCedula: false, requiereReferencia: true },
  { codigo: 'TARJETA', nombre: 'Tarjeta', requiereCedula: false, requiereReferencia: true },
];

/**
 * Punto de venta.
 *
 * <p>La pantalla sigue el orden real del mostrador: se arma la compra, se identifica a la
 * persona <b>solo si va a fiar</b>, y se cobra. Pedir la cédula de entrada convertiría
 * cada venta en efectivo en un trámite.
 *
 * <p>Los pagos se van apilando y el pendiente se recalcula: es lo que hace visible el pago
 * mixto sin que el tendero tenga que hacer restas de cabeza.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-punto-de-venta',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, BuscadorPersonas, ...TABLA_ESTANDAR],
  templateUrl: './pos.html',
  styleUrls: ['../../styles/tienda-comun.css', './pos.css'],
})
export class PuntoDeVenta implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private readonly locale = inject(LOCALE_ID);

  readonly metodos = METODOS;

  readonly venta = signal<Venta | null>(null);
  readonly lineas = signal<Array<Record<string, unknown>>>([]);
  readonly pagos = signal<Pago[]>([]);
  readonly pendiente = signal(0);
  readonly cobrado = signal(0);

  readonly busqueda = signal('');
  readonly resultados = signal<Producto[]>([]);
  readonly buscando = signal(false);

  readonly cupo = signal<Cupo | null>(null);
  readonly identidadConfirmada = signal(false);

  /**
   * La persona que eligió el tendero en el buscador. Trae ya cruzado contratación con
   * tesorería, así que la pantalla no tiene que volver a preguntar por el cupo ni por si
   * tiene autorización de mercado.
   */
  readonly persona = signal<PersonaTarjeta | null>(null);

  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly trabajando = signal(false);

  cedulaCliente = '';
  nombreCliente = '';
  nuevoPago = { metodo: 'EFECTIVO', monto: 0, referencia: '', cuotas: 1 };

  readonly hayVenta = computed(() => this.venta() !== null);
  readonly puedeConfirmar = computed(() =>
    this.hayVenta() && this.lineas().length > 0 && this.pendiente() === 0);

  readonly metodoActual = computed(() =>
    METODOS.find(m => m.codigo === this.nuevoPago.metodo) ?? METODOS[1]);

  /** Líneas de la venta en la tabla estándar: valores planos; el formato de pesos va aparte. */
  readonly columnasLineas: ColumnaTabla<Record<string, unknown>>[] = [
    { id: 'producto', header: 'Producto', valor: (l) => l['descripcion'] as string, tarjeta: 'titulo' },
    { id: 'cantidad', header: 'Cant.', align: 'right', valor: (l) => l['cantidad'] as number, tarjeta: 'meta' },
    { id: 'precio', header: 'Precio', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (l) => l['precio_unitario'] as number,
      formato: (l) => this.pesos(l['precio_unitario']), copiaTexto: (l) => String(l['precio_unitario'] ?? '') },
    { id: 'descuento', header: 'Dcto.', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (l) => l['descuento'] as number,
      formato: (l) => this.pesos(l['descuento']), copiaTexto: (l) => String(l['descuento'] ?? '') },
    { id: 'total', header: 'Total', align: 'right', tarjeta: 'subtitulo',
      valor: (l) => l['total'] as number,
      formato: (l) => this.pesos(l['total']), copiaTexto: (l) => String(l['total'] ?? '') },
  ];
  readonly idLinea = (l: Record<string, unknown>) => l['id'];

  ngOnInit(): void {
    this.ctx.cargar();
  }

  /**
   * El buscador ya resolvió quién es. Se copian cédula y nombre para la venta y se
   * reutiliza su cupo: pedirlo otra vez sería una llamada de más para el mismo dato.
   */
  personaElegida(p: PersonaTarjeta): void {
    this.persona.set(p);
    this.cedulaCliente = p.cedula;
    this.nombreCliente = p.nombre ?? '';
    this.cupo.set({
      existe: p.en_tesoreria,
      nombre: p.nombre,
      bloqueado: p.bloqueado,
      observacion_bloqueo: p.observacion_bloqueo,
      activo: p.activo,
      saldo_disponible: p.saldo_disponible,
      codigo: null,
      finca: p.oficina,
      tiene_foto: p.tiene_foto,
      foto_url: p.foto_url,
    });
    this.identidadConfirmada.set(false);
  }

  // ── Venta ───────────────────────────────────────────────────────────────

  abrirVenta(): void {
    const tienda = this.ctx.tiendaId();
    if (!tienda) return;
    this.limpiar();
    this.api.abrirVenta({
      tienda_id: tienda,
      cliente_cedula: this.cedulaCliente || undefined,
      cliente_nombre: this.nombreCliente || undefined,
    }).subscribe({
      next: v => { this.venta.set(v); this.refrescar(); },
      error: e => this.fallo(e),
    });
  }

  buscar(): void {
    const texto = this.busqueda().trim();
    if (texto.length < 2) { this.resultados.set([]); return; }
    this.buscando.set(true);
    this.api.productos({ texto, tamano: 12 }).subscribe({
      next: p => { this.resultados.set(p.content); this.buscando.set(false); },
      error: () => this.buscando.set(false),
    });
  }

  agregar(producto: Producto, cantidad = 1): void {
    const v = this.venta();
    if (!v) return;
    this.api.agregarLinea(v.id, { producto_id: producto.id, cantidad }).subscribe({
      next: () => { this.refrescar(); this.busqueda.set(''); this.resultados.set([]); },
      error: e => this.fallo(e),
    });
  }

  quitar(lineaId: string): void {
    this.api.quitarLinea(lineaId).subscribe({
      next: () => this.refrescar(),
      error: e => this.fallo(e),
    });
  }

  // ── Cupo e identidad ────────────────────────────────────────────────────

  /**
   * Consulta el cupo y trae la foto de contratación. Es lo único que se mira antes de
   * fiar, y por eso está separado del alta de la venta.
   */
  consultarCupo(): void {
    const tienda = this.ctx.tiendaId();
    if (!tienda || !this.cedulaCliente) return;
    this.api.cupo(this.cedulaCliente, tienda).subscribe({
      next: c => {
        this.cupo.set(c);
        this.identidadConfirmada.set(false);
        if (c.nombre && !this.nombreCliente) this.nombreCliente = c.nombre;
      },
      error: e => this.fallo(e),
    });
  }

  confirmarIdentidad(coincide: boolean): void {
    const v = this.venta();
    const c = this.cupo();
    if (!v) return;
    const resultado = coincide
      ? 'CONFIRMADA'
      : (c?.tiene_foto === false ? 'SIN_FOTO' : 'RECHAZADA');
    this.api.verificarIdentidad(v.id, resultado).subscribe({
      next: () => {
        this.identidadConfirmada.set(coincide);
        this.aviso.set(coincide
          ? 'Identidad verificada. Ya puede cobrar contra el cupo.'
          : 'Verificación registrada como no confirmada. No se puede fiar.');
      },
      error: e => this.fallo(e),
    });
  }

  // ── Pagos ───────────────────────────────────────────────────────────────

  cobrarPendiente(): void {
    this.nuevoPago.monto = this.pendiente();
  }

  agregarPago(): void {
    const v = this.venta();
    if (!v) return;
    this.trabajando.set(true);
    this.api.agregarPago(v.id, {
      metodo: this.nuevoPago.metodo,
      monto: this.nuevoPago.monto,
      referencia: this.nuevoPago.referencia || undefined,
      cuotas: this.nuevoPago.metodo === 'NOMINA' ? this.nuevoPago.cuotas : undefined,
    }).subscribe({
      next: () => {
        this.nuevoPago = { metodo: 'EFECTIVO', monto: 0, referencia: '', cuotas: 1 };
        this.trabajando.set(false);
        this.refrescar();
      },
      error: e => { this.trabajando.set(false); this.fallo(e); },
    });
  }

  confirmar(): void {
    const v = this.venta();
    if (!v) return;
    this.trabajando.set(true);
    this.api.confirmarVenta(v.id).subscribe({
      next: confirmada => {
        this.trabajando.set(false);
        this.aviso.set(`Venta ${confirmada.numero} confirmada por `
          + `${confirmada.total.toLocaleString('es-CO')}.`);
        this.venta.set(null);
        this.lineas.set([]);
        this.pagos.set([]);
        this.pendiente.set(0);
        this.limpiarCliente();
      },
      error: e => { this.trabajando.set(false); this.fallo(e); },
    });
  }

  anular(): void {
    const v = this.venta();
    if (!v) return;
    this.api.anularVenta(v.id, 'Anulada desde el punto de venta').subscribe({
      next: () => { this.aviso.set('Venta anulada.'); this.limpiar(); this.limpiarCliente(); },
      error: e => this.fallo(e),
    });
  }

  nombreMetodo(codigo: string): string {
    return METODOS.find(m => m.codigo === codigo)?.nombre ?? codigo;
  }

  /** Lo mismo que el pipe `currency:'COP':'symbol-narrow':'1.0-0'` de la plantilla. */
  private pesos(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    if (isNaN(n)) return '';
    return formatCurrency(n, this.locale, getCurrencySymbol('COP', 'narrow', this.locale), 'COP', '1.0-0');
  }

  private refrescar(): void {
    const v = this.venta();
    if (!v) return;
    this.api.detalleVenta(v.id).subscribe({
      next: d => {
        this.venta.set(d.venta);
        this.lineas.set(d.lineas);
        this.pagos.set(d.pagos);
        this.cobrado.set(d.cobrado);
        this.pendiente.set(d.pendiente);
      },
      error: e => this.fallo(e),
    });
  }

  private limpiar(): void {
    this.venta.set(null);
    this.lineas.set([]);
    this.pagos.set([]);
    this.pendiente.set(0);
    this.cobrado.set(0);
    this.error.set(null);
  }

  private limpiarCliente(): void {
    this.cedulaCliente = '';
    this.nombreCliente = '';
    this.cupo.set(null);
    this.persona.set(null);
    this.identidadConfirmada.set(false);
  }

  private fallo(e: unknown): void {
    const cuerpo = (e as { error?: { error?: string } })?.error;
    this.error.set(cuerpo?.error ?? 'No se pudo completar la operación');
    this.aviso.set(null);
  }
}

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';

import {
  CupoMarketplace, InicioMarketplace, TiendaResumen, TiendaService,
} from '../../service/tienda.service';

/** Una línea del carrito, ya resuelta para pintarla. */
interface LineaCarrito {
  id: string;
  producto_id: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

/**
 * El marketplace del colaborador: su tienda, su cupo y su pedido.
 *
 * <p>No es un catálogo global. Es la tienda que surte la oficina donde la persona está
 * contratada, y por eso lo primero que hace la pantalla es preguntar cuál es
 * (`/marketplace/inicio`) en vez de pedirle que la elija de una lista de todas.
 *
 * <p>La cédula sale del token en el servidor. Aquí no se manda nunca: no hay forma de
 * comprar ni de mirar a nombre de otro cambiando algo en el navegador.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-marketplace',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './marketplace.html',
  styleUrls: ['../../styles/tienda-comun.css', './marketplace.css'],
})
export class Marketplace implements OnInit {
  private api = inject(TiendaService);
  private router = inject(Router);

  readonly inicio = signal<InicioMarketplace | null>(null);
  readonly tienda = signal<string | null>(null);
  readonly articulos = signal<Array<Record<string, unknown>>>([]);
  readonly lineas = signal<LineaCarrito[]>([]);
  readonly busqueda = signal('');

  readonly cargando = signal(true);
  readonly cargandoCatalogo = signal(false);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  // ── Datos del pedido ────────────────────────────────────────────────────
  readonly tipoEntrega = signal<'RECOGE_TIENDA' | 'RECOGE_OFICINA' | 'DOMICILIO'>('RECOGE_TIENDA');
  readonly direccion = signal('');
  readonly indicaciones = signal('');
  readonly metodoPago = signal<'NOMINA' | 'EFECTIVO'>('NOMINA');
  readonly fechaCita = signal('');
  readonly horaCita = signal('');

  readonly total = computed(() => this.lineas().reduce((s, l) => s + (l.subtotal || 0), 0));

  readonly tiendaActual = computed<TiendaResumen | null>(() => {
    const id = this.tienda();
    return this.inicio()?.tiendas.find(t => t.id === id) ?? null;
  });

  /**
   * El cupo que queda DESPUÉS de este pedido. Se calcula solo para avisar mientras arma el
   * carrito; quien decide de verdad es el servidor al confirmar, que vuelve a preguntarle
   * a tesorería. Un número de pantalla no puede ser la última palabra sobre dinero.
   */
  readonly cupoDespues = computed(() => {
    const c = this.inicio()?.cupo;
    if (!c || !c.existe) return null;
    return c.disponible - this.total();
  });

  readonly noAlcanzaElCupo = computed(() => {
    const restante = this.cupoDespues();
    return this.metodoPago() === 'NOMINA' && restante !== null && restante < 0;
  });

  ngOnInit(): void {
    this.cargarInicio();
  }

  private cargarInicio(): void {
    this.cargando.set(true);
    this.api.inicioMarketplace().subscribe({
      next: i => {
        this.inicio.set(i);
        const elegida = i.tienda_sugerida ?? i.tiendas[0]?.id ?? null;
        this.tienda.set(elegida);
        this.cargando.set(false);
        if (elegida) this.cargarCatalogo();
        // Si no tiene cupo, el pago por nómina no es una opción: se arranca en efectivo
        // en vez de dejarle armar un carrito que no va a poder confirmar.
        if (!i.cupo?.existe) this.metodoPago.set('EFECTIVO');
      },
      error: () => {
        this.error.set('No se pudo abrir la tienda. Intente de nuevo en un momento.');
        this.cargando.set(false);
      },
    });
  }

  cambiarTienda(id: string): void {
    this.tienda.set(id);
    this.lineas.set([]);
    this.cargarCatalogo();
  }

  cargarCatalogo(): void {
    const t = this.tienda();
    if (!t) return;
    this.cargandoCatalogo.set(true);
    this.api.catalogoVirtual(t, this.busqueda() || undefined).subscribe({
      next: r => { this.articulos.set(r.articulos ?? []); this.cargandoCatalogo.set(false); },
      error: () => {
        this.error.set('No se pudo cargar el catálogo');
        this.cargandoCatalogo.set(false);
      },
    });
  }

  buscar(texto: string): void {
    this.busqueda.set(texto);
    this.cargarCatalogo();
  }

  // ── Carrito ─────────────────────────────────────────────────────────────

  agregar(articulo: Record<string, unknown>): void {
    const t = this.tienda();
    if (!t) return;
    this.api.agregarAlCarrito({
      tienda_id: t, producto_id: String(articulo['id']), cantidad: 1,
    }).subscribe({
      next: () => { this.aviso.set(`${articulo['nombre']} agregado`); this.refrescarCarrito(); },
      error: e => this.error.set(this.mensaje(e, 'No se pudo agregar el producto')),
    });
  }

  quitar(linea: LineaCarrito): void {
    this.api.quitarDelCarrito(linea.id).subscribe({
      next: () => this.refrescarCarrito(),
      error: e => this.error.set(this.mensaje(e, 'No se pudo quitar el producto')),
    });
  }

  private refrescarCarrito(): void {
    const t = this.tienda();
    if (!t) return;
    this.api.verCarrito(t).subscribe({
      next: r => this.lineas.set((r.lineas ?? []).map(l => ({
        id: String(l['id']),
        producto_id: String(l['producto_id'] ?? ''),
        nombre: String(l['nombre'] ?? l['producto_nombre'] ?? 'Artículo'),
        cantidad: Number(l['cantidad'] ?? 0),
        precio_unitario: Number(l['precio_unitario'] ?? 0),
        subtotal: Number(l['subtotal'] ?? 0),
      }))),
      error: () => this.error.set('No se pudo leer el carrito'),
    });
  }

  // ── Confirmar ───────────────────────────────────────────────────────────

  /**
   * Crea el pedido y, si puso cita, la fija en el mismo gesto.
   *
   * <p>Son dos llamadas porque son dos hechos distintos en el servidor, pero para la
   * persona es una sola acción y así se presenta.
   */
  confirmar(): void {
    const t = this.tienda();
    if (!t || this.lineas().length === 0) return;

    if (this.tipoEntrega() === 'DOMICILIO' && !this.direccion().trim()) {
      this.error.set('Escriba la dirección para el domicilio');
      return;
    }

    this.enviando.set(true);
    this.error.set(null);
    this.api.crearPedido({
      tienda_id: t,
      tipo_entrega: this.tipoEntrega(),
      direccion: this.tipoEntrega() === 'DOMICILIO' ? this.direccion().trim() : null,
      indicaciones: this.indicaciones().trim() || null,
      metodo_pago_previsto: this.metodoPago(),
    }).subscribe({
      next: pedido => {
        const cita = this.citaIso();
        if (!cita) { this.terminar(); return; }
        this.api.programarPedido(pedido.id, cita).subscribe({
          next: () => this.terminar(),
          // El pedido YA existe: que falle la cita no puede presentarse como que falló
          // todo. Se avisa de lo que quedó pendiente y se manda a Mis pedidos.
          error: () => {
            this.enviando.set(false);
            this.aviso.set('Pedido creado. No se pudo guardar la cita: prográmela desde Mis pedidos.');
            this.router.navigate(['/dashboard/tienda/mis-pedidos']);
          },
        });
      },
      error: e => {
        this.enviando.set(false);
        this.error.set(this.mensaje(e, 'No se pudo crear el pedido'));
      },
    });
  }

  private terminar(): void {
    this.enviando.set(false);
    this.lineas.set([]);
    this.router.navigate(['/dashboard/tienda/mis-pedidos']);
  }

  /** Junta fecha y hora en un instante ISO. Vacío si no puso cita: es opcional. */
  private citaIso(): string | null {
    const f = this.fechaCita();
    const h = this.horaCita();
    if (!f) return null;
    const fecha = new Date(`${f}T${h || '09:00'}:00`);
    return isNaN(fecha.getTime()) ? null : fecha.toISOString();
  }

  // ── Presentación ────────────────────────────────────────────────────────

  disponibilidad(a: Record<string, unknown>): string {
    const estado = String(a['disponibilidad'] ?? '');
    if (estado === 'BAJO_PEDIDO') {
      const dias = a['dias_entrega'];
      return dias ? `Por encargo · llega en ${dias} días` : 'Por encargo';
    }
    if (estado === 'DISPONIBLE') return 'Disponible hoy';
    return estado || '—';
  }

  esBajoPedido(a: Record<string, unknown>): boolean {
    return String(a['disponibilidad'] ?? '') === 'BAJO_PEDIDO';
  }

  cupoTexto(c: CupoMarketplace | null | undefined): string {
    if (!c) return 'No se pudo consultar su cupo';
    if (!c.existe) return 'No tiene cupo de crédito registrado';
    if (c.bloqueado) return c.motivo_bloqueo || 'Su cupo está bloqueado';
    if (!c.activo) return 'Su cupo no está activo';
    return '';
  }

  private mensaje(e: unknown, porDefecto: string): string {
    const err = e as { error?: { error?: string; message?: string } };
    return err?.error?.error || err?.error?.message || porDefecto;
  }
}

import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ArticuloComprador, CarritoDetallado, CategoriaComprador, InicioMarketplace,
  CarritoPorTienda, LineaCarritoDetallada, PromocionComprador, TiendaResumen, TiendaService,
  PedidoDetallado, ResumenPuntos, EstadoRuleta, GiroRuleta,
} from '../dashboard/submodule/tienda/service/tienda.service';
import { NotificationCenterService, NotificationItem } from '../../core/services/notification-center.service';
import { mensajeError, motivoSinCupo, usuarioEnSesion } from './economia.util';
import { VITRINAS, Vitrina, vitrinaPorCodigo } from './vitrinas';
import { SonidosService } from './sonidos.service';

const CLAVE_TIENDA = 'economiapp.tienda';
const CLAVE_RULETA = 'economiapp.ruleta.mostrada';
const CLAVE_PODIO = 'economiapp.podio.visto';

/** El día de hoy en Bogotá (AAAA-MM-DD): el giro y la racha se cuentan con ese día. */
export function hoyBogota(): string { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); }

/**
 * El estado que comparten todas las pantallas de EconomiAPP: con qué tienda compra la
 * persona, cuánto cupo tiene y qué lleva en el carrito.
 *
 * <p>Vive en un servicio y no en cada pantalla porque la barra superior (cupo, carrito) y
 * el contenido tienen que decir lo mismo: si el carrito se actualiza en la ficha de un
 * producto, el contador de arriba no puede quedarse en el número viejo.
 *
 * <p>El cupo NO se calcula aquí. `disponible` lo da el motor de tesorería ya descontado de lo
 * apartado; restarle algo en el navegador lo contaría dos veces.
 */
@Injectable({ providedIn: 'root' })
export class EconomiaStore {
  private api = inject(TiendaService);
  private notificaciones = inject(NotificationCenterService);
  private sonidos = inject(SonidosService);

  readonly inicio = signal<InicioMarketplace | null>(null);
  /** La tienda de referencia: vitrina, promociones y categorías salen de aquí. */
  readonly tiendaId = signal<string | null>(null);
  /** En modo oficina, si la persona quiso ver UNA sola tienda. Null = toda la oficina. */
  readonly soloTienda = signal<string | null>(null);
  readonly categorias = signal<CategoriaComprador[]>([]);

  /**
   * Las familias (primer nivel del árbol Familia › Grupo › Subcategoría), en orden de
   * vitrina. La portada y los filtros muestran solo estas; lo de adentro se abre al entrar.
   */
  readonly familias = computed(() => {
    const todas = this.categorias();
    return todas.filter(c => !c.padre_id || !todas.some(x => x.id === c.padre_id))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
  });
  /** Las vitrinas especiales que tiene la tienda que se está mirando, con su categoría raíz. */
  readonly vitrinas = computed(() => {
    const fams = this.familias();
    return VITRINAS
      .map(v => ({ v, cat: fams.find(c => c.codigo === v.codigo) ?? null }))
      .filter((x): x is { v: Vitrina; cat: CategoriaComprador } => !!x.cat);
  });

  /** La vitrina especial de una categoría raíz (null si se lista en Explorar como las demás). */
  vitrinaDe(c: CategoriaComprador | null | undefined): Vitrina | null {
    if (!c || (c.padre_id && this.categorias().some(x => x.id === c.padre_id))) return null;
    return vitrinaPorCodigo(c.codigo);
  }

  readonly carrito = signal<(CarritoDetallado & { por_tienda?: CarritoPorTienda[] }) | null>(null);

  /** Avisos de la tienda (estado de sus pedidos, promociones) desde la bandeja de la plataforma. */
  readonly avisos = signal<NotificationItem[]>([]);
  readonly promociones = signal<PromocionComprador[]>([]);
  readonly avisosNoLeidos = computed(() => this.avisos().filter(a => !a.leida).length);

  /** Pedidos de la persona (se refrescan con los avisos): alimentan los contadores de cada módulo. */
  readonly misPedidos = signal<PedidoDetallado[]>([]);

  /**
   * Lo que tiene pendiente en cada módulo, para los globos de la barra, la cabecera y los
   * accesos de la portada. "Accion" = algo que la persona tiene que hacer o ver ya (pedido
   * listo para recoger, aviso sin leer, código por usar, cupo bloqueado).
   */
  readonly modulos = computed(() => {
    const abiertos = this.misPedidos().filter(p => !['ENTREGADO', 'CANCELADO', 'RECHAZADO'].includes(p.pedido.estado));
    const listos = abiertos.filter(p => ['LISTO', 'EN_RUTA'].includes(p.pedido.estado)).length;
    const codigos = this.misPedidos().reduce((n, p) => n + (p.activaciones ?? []).filter(a => a.estado === 'ACTIVA').length, 0);
    const avisosPedidos = this.avisos().filter(a => !a.leida && /PEDIDO|ENTREGA|ACTIVACION/i.test(a.tipo_clave || '')).length;
    const cupo = this.cupo();
    return {
      pedidos: abiertos.length,
      pedidosAccion: listos + avisosPedidos + codigos,
      listos,
      codigos,
      encargos: abiertos.filter(p => p.pedido.bajo_pedido).length,
      ofertas: this.promociones().length,
      cuentaAlerta: !!cupo && (cupo.bloqueado || !cupo.activo),
    };
  });
  private relojAvisos: ReturnType<typeof setInterval> | null = null;

  // ── Puntos ──
  /** Saldo, nivel y racha de puntos de la persona (null mientras carga o si el servicio no responde). */
  readonly puntos = signal<ResumenPuntos | null>(null);
  /** Festejo a pantalla completa (ingreso del día, racha, canje): lo pinta el marco con confeti. */
  readonly festejo = signal<{ titulo: string; detalle: string; puntos: number; icono: string } | null>(null);

  readonly cargando = signal(false);
  readonly errorInicio = signal<string | null>(null);
  readonly ocupadoLinea = signal<string | null>(null);
  readonly toast = signal<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly tienda = computed<TiendaResumen | null>(() => {
    const id = this.tiendaId();
    return this.inicio()?.tiendas.find(t => t.id === id) ?? null;
  });

  /**
   * Modo oficina: su oficina tiene varias tiendas asignadas y compra en todas a la vez, con
   * un solo carrito. Sin asignación (está viendo TODAS las publicadas) no se mezclan
   * tiendas de otras oficinas: se compra en la elegida.
   */
  readonly modoOficina = computed(() => {
    const i = this.inicio();
    return !!i && !i.sin_tienda_asignada && i.tiendas.length > 1;
  });

  /** Las tiendas cuyo inventario se está mirando y comprando. */
  readonly ambito = computed<string[]>(() => {
    const i = this.inicio();
    if (!i) return [];
    if (this.modoOficina() && !this.soloTienda()) return i.tiendas.map(t => t.id);
    const una = this.soloTienda() ?? this.tiendaId();
    return una ? [una] : [];
  });

  readonly etiquetaAmbito = computed(() => {
    if (this.modoOficina() && !this.soloTienda()) return `Su oficina · ${this.inicio()?.tiendas.length} tiendas`;
    const id = this.soloTienda() ?? this.tiendaId();
    return this.inicio()?.tiendas.find(t => t.id === id)?.nombre ?? 'Elegir tienda';
  });

  readonly porTienda = computed(() => this.carrito()?.por_tienda ?? []);
  /** Domicilio solo si TODAS las tiendas del carrito lo hacen. */
  readonly domicilioPosible = computed(() => {
    const pt = this.porTienda();
    if (!pt.length) return !!this.tienda()?.permite_domicilio;
    return pt.every(t => t.permite_domicilio);
  });
  readonly costoDomicilio = computed(() => {
    const pt = this.porTienda();
    return Number(pt[0]?.costo_domicilio ?? this.tienda()?.costo_domicilio ?? 0);
  });

  /** La tienda que le corresponde por su oficina (no la que está mirando ahora). */
  readonly tiendaSugerida = computed(() => this.inicio()?.tienda_sugerida ?? null);
  readonly esSuTienda = computed(() => !!this.tiendaId() && this.tiendaId() === this.tiendaSugerida());

  readonly cupo = computed(() => this.inicio()?.cupo ?? null);
  readonly motivoSinCupo = computed(() => motivoSinCupo(this.cupo(), this.inicio()?.cupo_error));
  readonly puedeNomina = computed(() => !this.motivoSinCupo() && (this.cupo()?.disponible ?? 0) > 0);

  readonly lineas = computed<LineaCarritoDetallada[]>(() => this.carrito()?.detalle ?? []);
  readonly unidades = computed(() => this.lineas().reduce((s, l) => s + Number(l.cantidad || 0), 0));
  readonly total = computed(() => Number(this.carrito()?.total ?? 0));
  /** Lo que se ahorra por promociones: ya está descontado de `total`. */
  readonly ahorro = computed(() => this.lineas().reduce((s, l) => s + Number(l.descuento || 0), 0));
  readonly diasMax = computed(() => this.carrito()?.dias_entrega_max ?? null);
  readonly hayBajoPedido = computed(() => this.lineas().some(l => l.disponibilidad === 'BAJO_PEDIDO'));

  /** Cantidad en el carrito de un producto (para el "− 2 +" de las tarjetas). */
  /** Las categorías que cuelgan directamente de una. */
  hijosDe(id: string | null | undefined): CategoriaComprador[] {
    if (!id) return [];
    return this.categorias().filter(c => c.padre_id === id)
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
  }

  /** De la categoría a la familia: [Celulares, Android, Gama media]. */
  rutaDe(id: string | null | undefined): CategoriaComprador[] {
    const todas = this.categorias();
    const salida: CategoriaComprador[] = [];
    let c = todas.find(x => x.id === id);
    while (c && salida.length < 6) {
      salida.unshift(c);
      c = todas.find(x => x.id === c!.padre_id);
    }
    return salida;
  }

  /**
   * Para agrupar productos: la familia, salvo en las raíces con vitrina (Tecnología agrupa
   * Celulares, Audio, Gaming…): ahí el grupo útil es el segundo nivel.
   */
  grupoDe(id: string | null | undefined): CategoriaComprador | null {
    const ruta = this.rutaDe(id);
    if (ruta.length > 1 && vitrinaPorCodigo(ruta[0].codigo)) return ruta[1];
    return ruta[0] ?? null;
  }

  /** La familia a la que pertenece una categoría cualquiera del árbol. */
  familiaDe(id: string | null | undefined): CategoriaComprador | null {
    return this.rutaDe(id)[0] ?? null;
  }

  cantidadDe(productoId: string): number {
    return this.lineas().filter(l => l.producto_id === productoId)
      .reduce((s, l) => s + Number(l.cantidad || 0), 0);
  }

  /**
   * La línea que suman y restan los botones de la tarjeta: la del producto sin opción, o la
   * única que haya. Con dos opciones distintas en el carrito no hay una sola "línea del
   * producto" y la tarjeta manda a la ficha.
   */
  lineaDe(productoId: string): LineaCarritoDetallada | undefined {
    const del = this.lineas().filter(l => l.producto_id === productoId);
    return del.find(l => !l.variante_id) ?? (del.length === 1 ? del[0] : undefined);
  }

  // ── Arranque ────────────────────────────────────────────────────────────

  async refrescarPuntos(): Promise<void> {
    try {
      const antes = this.puntos()?.nivel?.codigo;
      const p = await firstValueFrom(this.api.misPuntos());
      this.puntos.set(p);
      // Subió de nivel (Plata, Oro, Diamante): fanfarria.
      if (antes && p?.nivel?.codigo && p.nivel.codigo !== antes) this.sonidos.tocar('nivel');
      this.festejarPodio(p);
    } catch { /* sin puntos no se bloquea nada */ }
  }

  /** Si el torneo de la semana le dio puntos (y no lo ha visto), se festeja una vez. */
  private festejarPodio(p: ResumenPuntos | null): void {
    let vistos: string[] = [];
    try { vistos = JSON.parse(localStorage.getItem(CLAVE_PODIO) ?? '[]'); } catch { /* sin storage */ }
    const nuevo = (p?.movimientos ?? []).find(m => m.origen === 'JUEGO' && m.puntos > 0 && !vistos.includes(m.id)
      && Date.now() - Date.parse(m.creado_en) < 8 * 86_400_000);
    if (!nuevo) return;
    try { localStorage.setItem(CLAVE_PODIO, JSON.stringify([...vistos, nuevo.id].slice(-20))); } catch { /* opcional */ }
    this.festejo.set({ titulo: '¡Quedó en el podio!', detalle: nuevo.descripcion ?? 'Torneo semanal de juegos', puntos: nuevo.puntos, icono: 'emoji_events' });
  }

  // ── Ruleta del día ──
  /** Estado de la ruleta de hoy (casillas, si ya giró y qué le salió). */
  readonly ruleta = signal<EstadoRuleta | null>(null);
  readonly ruletaAbierta = signal(false);

  /**
   * Trae la ruleta de hoy. Con `abrirSiFalta`, si no ha girado se abre sola una vez al día:
   * reemplaza los puntos por solo entrar y es el gancho para volver mañana.
   */
  async cargarRuleta(abrirSiFalta = false): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.estadoRuleta(this.tiendaId()));
      this.ruleta.set(r);
      if (!abrirSiFalta || r.girada_hoy || !r.opciones.length) return;
      const hoy = hoyBogota();
      let mostrada: string | null = null;
      try { mostrada = localStorage.getItem(CLAVE_RULETA); } catch { /* sin storage */ }
      if (mostrada === hoy) return;
      try { localStorage.setItem(CLAVE_RULETA, hoy); } catch { /* opcional */ }
      this.ruletaAbierta.set(true);
    } catch { /* sin ruleta la tienda sigue funcionando */ }
  }

  /** Gira (el servidor sortea) y deja la ruleta marcada como girada hoy. */
  async girarRuleta(): Promise<GiroRuleta> {
    const g = await firstValueFrom(this.api.girarRuleta(this.tiendaId(), usuarioEnSesion().nombre));
    this.ruleta.update(r => r ? { ...r, girada_hoy: true, hoy: g } : r);
    void this.refrescarPuntos();
    return g;
  }

  async iniciar(forzar = false): Promise<void> {
    if (this.inicio() && !forzar) return;
    this.cargando.set(true);
    this.errorInicio.set(null);
    try {
      const i = await firstValueFrom(this.api.inicioMarketplace());
      this.inicio.set(i);
      let guardada: string | null = null;
      try { guardada = localStorage.getItem(CLAVE_TIENDA); } catch { /* sin storage */ }
      const valida = (id: string | null) => !!id && i.tiendas.some(t => t.id === id);
      const elegida = valida(guardada) ? guardada : (i.tienda_sugerida ?? i.tiendas[0]?.id ?? null);
      await this.elegirTienda(elegida, false);
      // Los puntos y la ruleta no frenan la apertura de la tienda: van por su lado.
      void this.refrescarPuntos();
      void this.cargarRuleta(true);
    } catch (e) {
      this.errorInicio.set(mensajeError(e, 'No pudimos abrir EconomiAPP. Intente de nuevo en un momento.'));
    } finally {
      this.cargando.set(false);
    }
  }

  /** En modo oficina: ver toda la oficina (null) o una tienda. */
  async verAmbito(soloTienda: string | null): Promise<void> {
    this.soloTienda.set(soloTienda);
    if (soloTienda) this.tiendaId.set(soloTienda);
    else this.tiendaId.set(this.tiendaSugerida() ?? this.tiendaId());
    await this.refrescarCarrito();
  }

  async elegirTienda(id: string | null, recordar = true): Promise<void> {
    this.tiendaId.set(id);
    this.carrito.set(null);
    this.categorias.set([]);
    if (recordar && id) {
      try { localStorage.setItem(CLAVE_TIENDA, id); } catch { /* sin storage */ }
    }
    if (!id) return;
    this.api.promocionesComprador(id).subscribe({
      next: p => this.promociones.set(p ?? []),
      error: () => this.promociones.set([]),
    });
    this.api.categoriasComprador(id).subscribe({
      next: c => this.categorias.set((c ?? []).map(x => ({ ...x, nombre: nombreLegible(x.nombre) }))),
      error: () => this.categorias.set([]),
    });
    await this.refrescarCarrito();
  }

  // ── Avisos ──────────────────────────────────────────────────────────────

  /**
   * Trae la bandeja y se queda con lo de la tienda. Cada 2 minutos mientras la app esté
   * abierta: lo justo para enterarse de que el pedido ya está listo sin martillar el hub.
   */
  vigilarAvisos(): void {
    this.cargarAvisos();
    if (!this.relojAvisos) this.relojAvisos = setInterval(() => this.cargarAvisos(), 120_000);
  }

  dejarDeVigilar(): void {
    if (this.relojAvisos) clearInterval(this.relojAvisos);
    this.relojAvisos = null;
  }

  /** Pedidos para los contadores. Se llama con los avisos y después de crear un pedido. */
  cargarPedidos(): void {
    this.api.misPedidosDetallados().subscribe({
      next: ps => this.misPedidos.set(ps ?? []),
      error: () => { /* sin pedidos la tienda sigue funcionando */ },
    });
  }

  cargarAvisos(): void {
    this.cargarPedidos();
    this.notificaciones.list({ size: 50 }).subscribe({
      next: items => this.avisos.set((items ?? []).filter(i => (i.tipo_clave || '').startsWith('STORE_'))),
      error: () => { /* sin bandeja la tienda sigue funcionando */ },
    });
  }

  marcarLeido(a: NotificationItem): void {
    if (a.leida) return;
    this.avisos.set(this.avisos().map(x => x.id === a.id ? { ...x, leida: true } : x));
    this.notificaciones.markRead(a.id).subscribe({ error: () => null });
  }

  marcarTodosLeidos(): void {
    // Solo los de la tienda: "marcar todo" de la plataforma se llevaría avisos de otros módulos.
    this.avisos().filter(a => !a.leida).forEach(a => this.marcarLeido(a));
  }

  async refrescarCupo(): Promise<void> {
    const i = this.inicio();
    if (!i) return;
    try {
      const cupo = await firstValueFrom(this.api.miCupo(undefined, this.tiendaId() ?? undefined));
      this.inicio.set({ ...i, cupo, cupo_error: null });
    } catch { /* se queda el anterior */ }
  }

  // ── Carrito ─────────────────────────────────────────────────────────────

  async refrescarCarrito(): Promise<void> {
    const ambito = this.ambito();
    if (!ambito.length) return;
    try {
      this.carrito.set(await firstValueFrom(this.api.carritosMulti(ambito)));
    } catch {
      this.carrito.set(null);
    }
  }

  async agregar(a: ArticuloComprador, cantidad = 1, varianteId = a.variante_id ?? undefined): Promise<boolean> {
    // En modo oficina cada producto se pide a la tienda de la que sale.
    const t = a.tienda_id ?? this.tiendaId();
    if (!t) return false;
    this.ocupadoLinea.set(a.id);
    try {
      await firstValueFrom(this.api.agregarAlCarrito({
        tienda_id: t, producto_id: a.id, variante_id: varianteId, cantidad,
      }));
      await this.refrescarCarrito();
      this.sonidos.tocar('agregar');
      this.avisar(`${a.nombre} en su carrito`);
      return true;
    } catch (e) {
      this.avisar(mensajeError(e, 'No se pudo agregar'), 'error');
      return false;
    } finally {
      this.ocupadoLinea.set(null);
    }
  }

  async cambiarCantidad(linea: LineaCarritoDetallada, cantidad: number): Promise<void> {
    this.ocupadoLinea.set(linea.producto_id);
    try {
      await firstValueFrom(this.api.cambiarCantidadCarrito(linea.linea_id, cantidad));
      this.sonidos.tocar(cantidad > Number(linea.cantidad) ? 'agregar' : 'quitar');
      await this.refrescarCarrito();
    } catch (e) {
      this.avisar(mensajeError(e, 'No se pudo cambiar la cantidad'), 'error');
    } finally {
      this.ocupadoLinea.set(null);
    }
  }

  /** "+" de una tarjeta: suma a la línea si ya existe, si no la crea. */
  async sumar(a: ArticuloComprador): Promise<void> {
    const l = this.lineaDe(a.id);
    if (l) await this.cambiarCantidad(l, Number(l.cantidad) + 1);
    else await this.agregar(a);
  }

  async restar(a: ArticuloComprador): Promise<void> {
    const l = this.lineaDe(a.id);
    if (l) await this.cambiarCantidad(l, Number(l.cantidad) - 1);
  }

  async quitar(linea: LineaCarritoDetallada): Promise<void> {
    this.ocupadoLinea.set(linea.producto_id);
    try {
      await firstValueFrom(this.api.quitarDelCarrito(linea.linea_id));
      this.sonidos.tocar('quitar');
      await this.refrescarCarrito();
    } catch (e) {
      this.avisar(mensajeError(e, 'No se pudo quitar'), 'error');
    } finally {
      this.ocupadoLinea.set(null);
    }
  }

  avisar(texto: string, tipo: 'ok' | 'error' = 'ok'): void {
    if (tipo === 'error') this.sonidos.tocar('error');
    this.toast.set({ texto, tipo });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), tipo === 'error' ? 5000 : 2600);
  }
}

/**
 * Los nombres que trajo el sistema anterior a veces no se pueden mostrar tal cual:
 * «Subfamilia unica» (Logis no tenía subfamilia), «Varios», o mayúsculas a medias («CAFé»,
 * «BEBIDA NIñOS»). Solo cambia lo que se ve; la categoría sigue siendo la misma.
 */
/** Nombres que llegan sin tilde desde Logis (solo para mostrar). */
const TILDES: Record<string, string> = {
  cafe: 'Café', lacteos: 'Lácteos', dulceria: 'Dulcería', 'bebida instantanea': 'Bebida instantánea',
  'comida instantanea': 'Comida instantánea', electrodomesticos: 'Electrodomésticos', joyeria: 'Joyería',
  dotacion: 'Dotación', tecnologia: 'Tecnología',
};

export function nombreLegible(nombre: string): string {
  const n = (nombre || '').trim();
  const tilde = TILDES[n.toLocaleLowerCase('es-CO')];
  if (tilde) return tilde;
  if (/^subfamilia [uú]nica$/i.test(n)) return 'General';
  if (/^varios$/i.test(n)) return 'Otros';
  if (/[A-ZÁÉÍÓÚÑ]{2,}/.test(n) && n !== n.toUpperCase() || n.length > 3 && n === n.toUpperCase()) {
    const bajo = n.toLocaleLowerCase('es-CO');
    return bajo.charAt(0).toLocaleUpperCase('es-CO') + bajo.slice(1);
  }
  return n;
}

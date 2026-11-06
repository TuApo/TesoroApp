import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { firstValueFrom } from 'rxjs';

import { ECO_CONTEXTO_TIENDA, ConexionSse, EstadoSse, mensajeError, pesos } from './eco-portable';
import { ColumnaKanban, ColumnaTablero, TableroApi, TarjetaPedido } from './tablero-api.service';

/**
 * Tablero kanban de pedidos: Nuevos → En preparación → En despacho → Entregados (+ Cancelados).
 *
 * <p>En vivo por SSE: cada cambio de estado llega como tarjeta y se recoloca sola. Arrastrar
 * una tarjeta pide la transición al servidor; si una regla lo impide (falta el pago, el
 * acta, la validación de quien reclama) la tarjeta vuelve y el motivo sale arriba.
 *
 * <p>Portable: standalone, sin nada del shell del dashboard. La sede llega por `tiendaId`
 * o por `ECO_CONTEXTO_TIENDA`; el API por `ECO_API_BASE`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'eco-kanban-pedidos',
  imports: [CommonModule, FormsModule, MatIconModule, DragDropModule],
  templateUrl: './kanban.html',
  styleUrl: './kanban.css',
})
export class KanbanPedidos implements OnInit, OnDestroy {
  private api = inject(TableroApi);
  readonly ctx = inject(ECO_CONTEXTO_TIENDA);

  /** Sede fija (otra app). Sin valor, se usa el contexto de tienda. */
  readonly tiendaId = input<string | null>(null);
  /** Oculta el selector de sede (cuando la app ya la fija por fuera). */
  readonly sinSelector = input(false);

  readonly tienda = computed(() => this.tiendaId() ?? this.ctx.tiendaId());
  readonly columnas = signal<ColumnaTablero[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly conexion = signal<EstadoSse>('cerrado');
  readonly generadoEn = signal<string | null>(null);
  readonly ahora = signal(Date.now());

  // Filtros (todos en cliente: el tablero es por sede y cabe entero).
  readonly filtroEntrega = signal<'' | 'DOMICILIO' | 'RECOGE_TIENDA' | 'RECOGE_OFICINA'>('');
  readonly filtroTexto = signal('');
  readonly soloRetrasados = signal(false);
  readonly verCerrados = signal(true);

  readonly detalle = signal<{ tarjeta: TarjetaPedido; datos: Record<string, unknown> | null } | null>(null);
  readonly promesaEdicion = signal('');

  readonly ids = computed(() => this.columnas().map(c => 'col-' + c.clave));
  readonly visibles = computed<ColumnaTablero[]>(() => {
    const entrega = this.filtroEntrega(), q = this.filtroTexto().trim().toLowerCase(), rojo = this.soloRetrasados();
    return this.columnas()
      .filter(c => this.verCerrados() || (c.clave !== 'ENTREGADO' && c.clave !== 'CANCELADO'))
      .map(c => ({
        ...c,
        pedidos: c.pedidos.filter(p =>
          (!entrega || p.tipo_entrega === entrega)
          && (!rojo || this.semaforo(p) === 'ROJO')
          && (!q || [p.numero, p.cliente_nombre, p.cliente_cedula, p.cliente_telefono, p.direccion_texto].some(v => (v ?? '').toLowerCase().includes(q)))),
      }));
  });
  readonly retrasados = computed(() => this.columnas().flatMap(c => c.pedidos).filter(p => this.semaforo(p) === 'ROJO').length);
  readonly activos = computed(() => this.columnas().filter(c => c.clave !== 'ENTREGADO' && c.clave !== 'CANCELADO').reduce((n, c) => n + c.pedidos.length, 0));

  private sse: ConexionSse | null = null;
  private reloj: ReturnType<typeof setInterval> | null = null;
  private tiendaConectada: string | null = null;

  constructor() {
    effect(() => {
      const t = this.tienda();
      untracked(() => this.conectar(t));
    });
    // El semáforo cambia con el reloj aunque no llegue nada: se repinta cada 30 s y se
    // refresca entero cada 2 min por si un evento se perdió en una reconexión.
    this.reloj = setInterval(() => {
      this.ahora.set(Date.now());
      if (document.visibilityState === 'visible' && Math.floor(Date.now() / 30_000) % 4 === 0) this.cargar(true);
    }, 30_000);
  }

  ngOnInit(): void { if (!this.tiendaId()) this.ctx.cargar(); }
  ngOnDestroy(): void { this.sse?.cerrar(); if (this.reloj) clearInterval(this.reloj); }

  private conectar(tienda: string | null): void {
    if (tienda === this.tiendaConectada) return;
    this.sse?.cerrar(); this.sse = null;
    this.tiendaConectada = tienda;
    this.columnas.set([]);
    if (!tienda) return;
    this.cargar();
    this.sse = this.api.stream(tienda, t => this.recibir(t), e => this.conexion.set(e));
  }

  async cargar(silencioso = false): Promise<void> {
    const tienda = this.tienda(); if (!tienda) return;
    if (!silencioso) this.cargando.set(true);
    try {
      const t = await firstValueFrom(this.api.tablero(tienda));
      this.columnas.set(t.columnas);
      this.generadoEn.set(t.generado_en);
      this.error.set(null);
    } catch (e) { if (!silencioso) this.error.set(mensajeError(e, 'No se pudo cargar el tablero')); }
    finally { this.cargando.set(false); }
  }

  /** Una tarjeta nueva o cambiada por SSE: sale de donde estaba y entra en su columna. */
  private recibir(t: TarjetaPedido): void {
    if (t.tienda_id !== this.tienda()) return;
    const esNueva = !this.columnas().some(c => c.pedidos.some(p => p.id === t.id));
    this.columnas.update(cols => cols.map(c => {
      const sin = c.pedidos.filter(p => p.id !== t.id);
      if (c.clave !== t.columna) return { ...c, pedidos: sin };
      const lista = [...sin, t].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
      return { ...c, pedidos: lista };
    }));
    const d = this.detalle();
    if (d && d.tarjeta.id === t.id) this.detalle.set({ ...d, tarjeta: t });
    if (esNueva && t.columna === 'NUEVO') {
      navigator.vibrate?.([120, 80, 120]);
      this.aviso.set(`Pedido nuevo ${t.numero}` + (t.cliente_nombre ? ' · ' + t.cliente_nombre : ''));
    }
  }

  // ── Arrastrar ──

  async soltar(ev: CdkDragDrop<TarjetaPedido[]>, destino: ColumnaTablero): Promise<void> {
    if (ev.previousContainer === ev.container) return;
    const tarjeta = ev.item.data as TarjetaPedido;
    const columna = destino.clave;
    let motivo: string | undefined, efectivoRecibido = false;
    if (columna === 'CANCELADO') {
      const m = prompt(`¿Por qué se cancela el pedido ${tarjeta.numero}? El comprador va a leer el motivo.`);
      if (!m || !m.trim()) return;
      motivo = m.trim();
    }
    if (columna === 'ENTREGADO') {
      if (!confirm(`¿Marcar ${tarjeta.numero} como entregado? Esto saca la mercancía del inventario y cierra el pedido.`)) return;
      efectivoRecibido = confirm('¿Se recibió el efectivo pendiente en este momento?\n\nAceptar = sí, se cobró · Cancelar = no');
    }
    await this.mover(tarjeta, columna, { motivo, efectivoRecibido });
  }

  async mover(tarjeta: TarjetaPedido, columna: ColumnaKanban, extra: { motivo?: string; efectivoRecibido?: boolean } = {}): Promise<void> {
    const antes = this.columnas();
    // Optimista: la tarjeta cambia de columna ya; si el servidor dice que no, vuelve.
    this.recibir({ ...tarjeta, columna });
    try {
      const nueva = await firstValueFrom(this.api.mover(tarjeta.id, columna, extra));
      this.recibir(nueva);
      this.error.set(null);
      this.aviso.set(`${nueva.numero}: ${this.nombreColumna(nueva.columna)}`);
    } catch (e) {
      this.columnas.set(antes);
      this.error.set(mensajeError(e, 'No se pudo mover el pedido'));
    }
  }

  /** Botón de "siguiente paso" en la tarjeta, para el celular (sin arrastrar). */
  siguiente(t: TarjetaPedido): { columna: ColumnaKanban; texto: string; icono: string } | null {
    switch (t.columna) {
      case 'NUEVO': return { columna: 'EN_PREPARACION', texto: 'Preparar', icono: 'play_arrow' };
      case 'EN_PREPARACION': return { columna: 'EN_DESPACHO', texto: t.tipo_entrega === 'DOMICILIO' ? 'Listo para salir' : 'Listo', icono: 'check' };
      case 'EN_DESPACHO': return t.estado === 'EN_RUTA' ? null : { columna: 'ENTREGADO', texto: 'Entregado', icono: 'done_all' };
      default: return null;
    }
  }

  async avanzar(t: TarjetaPedido): Promise<void> {
    const s = this.siguiente(t); if (!s) return;
    if (s.columna === 'ENTREGADO') {
      if (!confirm(`¿Marcar ${t.numero} como entregado?`)) return;
      const efectivo = confirm('¿Se recibió el efectivo pendiente en este momento?\n\nAceptar = sí · Cancelar = no');
      await this.mover(t, 'ENTREGADO', { efectivoRecibido: efectivo });
    } else await this.mover(t, s.columna);
  }

  async cancelar(t: TarjetaPedido): Promise<void> {
    const m = prompt(`¿Por qué se cancela el pedido ${t.numero}?`);
    if (!m || !m.trim()) return;
    await this.mover(t, 'CANCELADO', { motivo: m.trim() });
  }

  // ── Detalle ──

  async abrir(t: TarjetaPedido): Promise<void> {
    if (this.detalle()?.tarjeta.id === t.id) { this.detalle.set(null); return; }
    this.detalle.set({ tarjeta: t, datos: null });
    this.promesaEdicion.set(t.promesa_en ? this.aLocal(t.promesa_en) : '');
    try { this.detalle.set({ tarjeta: t, datos: await firstValueFrom(this.api.detalle(t.id)) }); }
    catch { /* la tarjeta ya basta; el detalle es extra */ }
  }

  lineas(): Array<{ descripcion: string; cantidad: number; total: number; disponibilidad?: string }> {
    return (this.detalle()?.datos?.['lineas'] as Array<{ descripcion: string; cantidad: number; total: number; disponibilidad?: string }> | undefined) ?? [];
  }
  seguimiento(): Array<{ estado: string; comentario: string | null; ocurrido_en: string; usuario_nombre: string | null }> {
    return (this.detalle()?.datos?.['seguimiento'] as Array<{ estado: string; comentario: string | null; ocurrido_en: string; usuario_nombre: string | null }> | undefined) ?? [];
  }
  pagosPendientes(): number {
    const pagos = (this.detalle()?.datos?.['pagos'] as Array<{ estado: string; monto: number }> | undefined) ?? [];
    return pagos.filter(p => p.estado === 'PREVISTO').reduce((s, p) => s + Number(p.monto), 0);
  }

  async guardarPromesa(): Promise<void> {
    const d = this.detalle(); if (!d) return;
    const v = this.promesaEdicion();
    try {
      const t = await firstValueFrom(this.api.fijarPromesa(d.tarjeta.id, v ? new Date(v).toISOString() : null));
      this.recibir(t);
      this.aviso.set(v ? 'Hora prometida guardada' : 'Hora prometida: vuelve a la automática');
    } catch (e) { this.error.set(mensajeError(e, 'No se pudo guardar la hora')); }
  }

  // ── Presentación ──

  /** El semáforo se recalcula con el reloj local a partir de la promesa que mandó el servidor. */
  semaforo(t: TarjetaPedido): 'VERDE' | 'AMBAR' | 'ROJO' | null {
    if (!t.semaforo) return null;
    if (!t.promesa_en) return t.semaforo;
    const promesa = new Date(t.promesa_en).getTime();
    const base = new Date(t.confirmado_en ?? t.creado_en).getTime();
    const ahora = this.ahora();
    if (ahora >= promesa) return 'ROJO';
    if (promesa <= base) return 'VERDE';
    return (promesa - ahora) * 4 <= (promesa - base) ? 'AMBAR' : 'VERDE';
  }
  restante(t: TarjetaPedido): string {
    if (!t.promesa_en || !t.semaforo) return '';
    const m = Math.round((new Date(t.promesa_en).getTime() - this.ahora()) / 60_000);
    if (m >= 0) return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
    const r = -m;
    return r < 60 ? `−${r} min` : `−${Math.floor(r / 60)} h ${r % 60} min`;
  }
  espera(t: TarjetaPedido): string {
    const m = Math.max(0, Math.round((this.ahora() - new Date(t.creado_en).getTime()) / 60_000));
    return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : `hace ${Math.floor(m / 1440)} d`;
  }
  nombreColumna(c: ColumnaKanban): string {
    return ({ NUEVO: 'Nuevos', EN_PREPARACION: 'En preparación', EN_DESPACHO: 'En despacho', ENTREGADO: 'Entregados', CANCELADO: 'Cancelados' })[c];
  }
  entrega(t: TarjetaPedido): string {
    return t.tipo_entrega === 'DOMICILIO' ? 'Domicilio' : t.tipo_entrega === 'RECOGE_OFICINA' ? 'Recoge en oficina' : 'Recoge en tienda';
  }
  estadoTexto(e: string): string {
    return ({ CREADO: 'Sin confirmar', CONFIRMADO: 'Confirmado', ALISTANDO: 'Preparando', LISTO: 'Listo', EN_RUTA: 'En ruta', ENTREGADO: 'Entregado', CANCELADO: 'Cancelado', RECHAZADO: 'Rechazado' } as Record<string, string>)[e] ?? e;
  }
  readonly pesos = pesos;
  trackId = (_: number, t: TarjetaPedido) => t.id;
  private aLocal(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  cambiarTienda(ev: Event): void { this.ctx.seleccionar((ev.target as HTMLSelectElement).value || null); }
}

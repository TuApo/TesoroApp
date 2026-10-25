import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { FotosEvidencia } from '../../components/fotos-evidencia/fotos-evidencia';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { NombresProducto } from '../../service/nombres-producto.service';
import { CandidatoProducto, TiendaService, TrasladoFila, TrasladoLinea } from '../../service/tienda.service';
import { EscanerCodigoComponent, ResultadoEscaneo } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';

const ESTADOS: Record<string, string> = { BORRADOR: 'Borrador', ENVIADO: 'Enviado', EN_TRANSITO: 'En camino', RECIBIDO: 'Recibido', RECIBIDO_CON_DIFERENCIA: 'Recibido con diferencia', ANULADO: 'Anulado' };

/**
 * Mercancía entre bodega y tiendas: quien envía arma el traslado y lo despacha (con fotos
 * de lo que sale); quien recibe cuenta lo que llegó (con fotos) y la diferencia queda escrita.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-traslados',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, FotosEvidencia, EscanerCodigoComponent],
  templateUrl: './traslados.html',
  styleUrls: ['../../styles/tienda-comun.css', './traslados.css'],
})
export class Traslados {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  readonly np = inject(NombresProducto);
  readonly ESTADOS = ESTADOS;
  readonly modo = signal<'pendientes' | 'salientes' | 'entrantes'>('pendientes');
  readonly lista = signal<TrasladoFila[]>([]);
  readonly sel = signal<{ traslado: TrasladoFila; lineas: TrasladoLinea[]; nombres?: Record<string, string>; variantes?: Record<string, string> } | null>(null);
  nombre(l: TrasladoLinea): string {
    const d = this.sel(); const base = d?.nombres?.[l.producto_id] ?? this.np.de(l.producto_id);
    const v = l.variante_id ? d?.variantes?.[l.variante_id] : null;
    return v ? `${base} · ${v}` : base;
  }
  readonly recibidas = signal<Record<string, number>>({});
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  // Nuevo
  readonly creando = signal(false);
  readonly destino = signal('');
  readonly items = signal<{ producto_id: string; variante_id: string | null; nombre: string; cantidad: number }[]>([]);
  readonly busqueda = signal('');
  readonly resultados = signal<CandidatoProducto[]>([]);
  readonly observacion = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly nombreTienda = (id: string) => this.ctx.tiendas().find(t => t.id === id)?.nombre ?? id.slice(0, 8);
  readonly soyDestino = computed(() => this.sel()?.traslado.destino_tienda_id === this.ctx.tiendaId());
  readonly soyOrigen = computed(() => this.sel()?.traslado.origen_tienda_id === this.ctx.tiendaId());

  constructor() {
    this.ctx.cargar(); this.np.cargar();
    effect(() => { const t = this.ctx.tiendaId(); this.modo(); untracked(() => this.cargar(t)); });
  }

  async cargar(t: string | null): Promise<void> {
    this.sel.set(null);
    if (!t) return;
    try { this.lista.set(await firstValueFrom(this.api.traslados(t, this.modo()))); this.error.set(null); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudieron cargar los traslados'); }
  }

  async abrir(id: string): Promise<void> {
    try {
      const d = await firstValueFrom(this.api.detalleTraslado(id));
      this.sel.set(d);
      this.recibidas.set(Object.fromEntries(d.lineas.map(l => [l.id, +(l.cantidad_recibida ?? l.cantidad_enviada)])));
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir'); }
  }

  buscar(v: string): void {
    this.busqueda.set(v);
    if (this.timer) clearTimeout(this.timer);
    const t = this.ctx.tiendaId();
    if (!t || v.trim().length < 2) { this.resultados.set([]); return; }
    this.timer = setTimeout(() => this.api.buscarProductosCompra(t, v.trim()).subscribe({ next: r => this.resultados.set(r), error: () => this.resultados.set([]) }), 300);
  }
  agregar(c: CandidatoProducto): void {
    if (!this.items().some(i => i.producto_id === c.producto_id && i.variante_id === c.variante_id)) {
      this.items.update(is => [...is, { producto_id: c.producto_id, variante_id: c.variante_id, nombre: c.nombre, cantidad: 1 }]);
    }
    this.busqueda.set(''); this.resultados.set([]);
  }
  /** Cada producto escaneado entra al traslado; si ya estaba, suma una unidad. */
  readonly procesarTraslado = async (codigo: string): Promise<ResultadoEscaneo> => {
    try {
      const ps = (await firstValueFrom(this.api.productosPorCodigo(codigo))) ?? [];
      if (!ps.length) return { ok: false, texto: 'Ningún producto tiene ese código', detalle: codigo };
      if (ps.length > 1) {
        this.buscar(ps[0].nombre);
        return { ok: false, texto: `${ps.length} productos con ese código`, detalle: 'Elíjalo en el buscador al cerrar' };
      }
      const p = ps[0];
      const k = this.items().findIndex(i => i.producto_id === p.id && !i.variante_id);
      if (k >= 0) this.cantidad(k, this.items()[k].cantidad + 1);
      else this.items.update(is => [...is, { producto_id: p.id, variante_id: null, nombre: p.nombre, cantidad: 1 }]);
      const n = this.items().find(i => i.producto_id === p.id && !i.variante_id)?.cantidad ?? 1;
      return { ok: true, texto: p.nombre, detalle: `${n} en el traslado` };
    } catch {
      return { ok: false, texto: 'No se pudo buscar el código', detalle: 'Revise la conexión' };
    }
  };

  cantidad(i: number, v: number): void { this.items.update(is => is.map((x, j) => j === i ? { ...x, cantidad: Math.max(0, +v || 0) } : x)); }
  quitar(i: number): void { this.items.update(is => is.filter((_, j) => j !== i)); }

  async crear(enviarYa: boolean): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t || !this.destino() || !this.items().length) return;
    try {
      const tr = await firstValueFrom(this.api.crearTraslado({ origen_tienda_id: t, destino_tienda_id: this.destino(),
        lineas: this.items().filter(i => i.cantidad > 0).map(i => ({ producto_id: i.producto_id, variante_id: i.variante_id, cantidad: i.cantidad })),
        observacion: this.observacion().trim() || null }));
      if (enviarYa) await firstValueFrom(this.api.enviarTraslado(tr.id));
      this.creando.set(false); this.items.set([]); this.observacion.set('');
      this.modo.set('salientes'); await this.cargar(t); await this.abrir(tr.id);
      this.aviso.set(enviarYa ? 'Traslado enviado: la mercancía salió del inventario de esta tienda. Agregue fotos de lo que sale.' : 'Traslado guardado como borrador.');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo crear el traslado'); }
  }

  async enviar(): Promise<void> {
    const s = this.sel(); if (!s) return;
    try { await firstValueFrom(this.api.enviarTraslado(s.traslado.id)); await this.abrir(s.traslado.id); this.cargar(this.ctx.tiendaId()); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo enviar'); }
  }
  ponerRecibida(id: string, v: number): void { this.recibidas.update(r => ({ ...r, [id]: Math.max(0, +v || 0) })); }
  async recibir(): Promise<void> {
    const s = this.sel(); if (!s) return;
    const dif = s.lineas.filter(l => +this.recibidas()[l.id] !== +l.cantidad_enviada).length;
    if (!confirm(dif ? `Hay ${dif} líneas con diferencia. ¿Recibir así? Queda registrado.` : '¿Recibir el traslado completo?')) return;
    try { await firstValueFrom(this.api.recibirTraslado(s.traslado.id, this.recibidas())); await this.abrir(s.traslado.id); this.aviso.set('Recibido: la mercancía entró al inventario.'); this.cargar(this.ctx.tiendaId()); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo recibir'); }
  }
  async anular(): Promise<void> {
    const s = this.sel(); const m = prompt('¿Por qué se anula el traslado?'); if (!s || !m) return;
    try { await firstValueFrom(this.api.anularTraslado(s.traslado.id, m)); await this.abrir(s.traslado.id); this.cargar(this.ctx.tiendaId()); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo anular'); }
  }
}

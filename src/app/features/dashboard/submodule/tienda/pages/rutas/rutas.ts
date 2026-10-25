import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { PedidoPorDespachar, RepartidorEquipo, RutaEntrega, RutaResumen, TiendaService } from '../../service/tienda.service';
import { utc } from '../../util/alerta-nuevos';
import { CasoPedidoPanel } from '../../components/caso-pedido/caso-pedido';
import { franjaAcordada } from '../../util/fechas-entrega';
import { EcoMapa, PuntoMapa } from '../../../../../economiapp/components/eco-mapa';

/**
 * Despacho y seguimiento: qué pedidos están listos esperando repartidor, qué rutas van en
 * la calle y, para cada una, el mapa con las paradas, el trazo real del GPS y cómo va.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-rutas',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, SelectorTienda, EcoMapa, CasoPedidoPanel],
  templateUrl: './rutas.html',
  styleUrls: ['../../styles/tienda-comun.css', './rutas.css'],
})
export class Rutas implements OnDestroy {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);

  readonly filtro = signal<'ACTIVAS' | 'HOY' | 'TODAS'>('ACTIVAS');
  readonly rutas = signal<RutaResumen[]>([]);
  readonly porDespachar = signal<PedidoPorDespachar[]>([]);
  readonly equipo = signal<RepartidorEquipo[]>([]);
  readonly casoDe = signal<string | null>(null);
  franja(p: { programado_en?: string | null; programado_hasta?: string | null }): string | null { return franjaAcordada(p.programado_en, p.programado_hasta); }
  readonly conectados = computed(() => this.equipo().filter(r => +r.disponible && +r.activo).length);
  readonly sel = signal<RutaEntrega | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  private reloj: ReturnType<typeof setInterval> | null = null;

  readonly puntos = computed<PuntoMapa[]>(() => {
    const r = this.sel(); if (!r) return [];
    const ps: PuntoMapa[] = [];
    if (r.origen_lat != null) ps.push({ lat: +r.origen_lat, lng: +r.origen_lng!, etiqueta: 'T', titulo: r.tienda?.nombre, tono: 'origen' });
    r.paradas.forEach((p, i) => { if (p.lat != null) ps.push({ lat: +p.lat, lng: +p.lng!, etiqueta: String(i + 1), titulo: `${p.numero} · ${p.cliente_nombre}`, tono: p.estado === 'ENTREGADO' ? 'ok' : p.estado === 'FALLIDO' ? 'falla' : 'pendiente' }); });
    if (r.ultima_lat != null && r.estado === 'EN_CURSO') ps.push({ lat: +r.ultima_lat, lng: +r.ultima_lng!, tono: 'yo', titulo: r.repartidor_nombre ?? 'Repartidor' });
    return ps;
  });
  /** El trazo llega del más nuevo al más viejo. */
  readonly trazo = computed(() => [...(this.sel()?.trazo ?? [])].reverse().map(t => ({ lat: +t.lat, lng: +t.lng })));
  readonly avance = computed(() => {
    const r = this.sel(); if (!r?.paradas.length) return 0;
    return Math.round(r.paradas.filter(p => p.estado !== 'CARGADO').length / r.paradas.length * 100);
  });
  readonly sinPosicionReciente = computed(() => {
    const r = this.sel();
    return r?.estado === 'EN_CURSO' && (!r.ultima_posicion_en || Date.now() - new Date(r.ultima_posicion_en).getTime() > 5 * 60_000);
  });

  constructor() {
    this.ctx.cargar();
    effect(() => { this.ctx.tiendaId(); this.filtro(); untracked(() => this.cargar()); });
    // Seguimiento en vivo: refresca la lista y la ruta abierta cada 20 s.
    this.reloj = setInterval(() => { if (document.visibilityState === 'visible') this.cargar(true); }, 20_000);
  }
  ngOnDestroy(): void { if (this.reloj) clearInterval(this.reloj); }

  async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.cargando.set(true);
    try {
      const f = this.filtro();
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const r = await firstValueFrom(this.api.rutas({
        tienda: this.ctx.tiendaId() ?? undefined, estado: f === 'ACTIVAS' ? 'ACTIVAS' : undefined, dia: f === 'HOY' ? hoy : undefined,
      }));
      this.rutas.set(r.rutas); this.porDespachar.set(r.por_despachar); this.error.set(null);
      this.api.equipoDomicilios(this.ctx.tiendaId()).subscribe({ next: e => this.equipo.set(e), error: () => {} });
      const s = this.sel();
      if (s) this.sel.set(await firstValueFrom(this.api.ruta(s.id)));
      else if (r.rutas.length && !silencioso && window.innerWidth > 900) this.abrir(r.rutas[0].id);
    } catch (e: any) { if (!silencioso) this.error.set(e?.error?.error ?? 'No se pudieron cargar las rutas'); }
    finally { this.cargando.set(false); }
  }

  async abrir(id: string): Promise<void> {
    try { this.sel.set(await firstValueFrom(this.api.ruta(id))); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir la ruta'); }
  }

  async cancelar(): Promise<void> {
    const r = this.sel(); if (!r || !confirm(`¿Cancelar la ruta ${r.numero}? Los pedidos vuelven a quedar por despachar.`)) return;
    try { this.sel.set(await firstValueFrom(this.api.cancelarRuta(r.id))); this.cargar(true); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cancelar'); }
  }

  async ajustar(r: RepartidorEquipo, cambio: { max_pedidos?: number; activo?: boolean }): Promise<void> {
    if (cambio.activo === false && !confirm(`¿Sacar a ${r.nombre} de la bolsa de domicilios? No podrá tomar pedidos hasta que lo active.`)) return;
    try {
      const n = await firstValueFrom(this.api.ajustarDomiciliario(r.usuario_id, cambio));
      this.equipo.update(l => l.map(x => x.usuario_id === r.usuario_id ? { ...x, ...n } : x));
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo ajustar al domiciliario'); }
  }

  estadoTexto(e: string): string {
    return ({ CARGANDO: 'Cargando', EN_CURSO: 'En la calle', FINALIZADA: 'Terminada', CANCELADA: 'Cancelada' } as Record<string, string>)[e] ?? e;
  }
  readonly utc = utc;
  pesos(v: number | null | undefined): string { return v == null ? '' : '$' + Math.round(+v).toLocaleString('es-CO'); }
  hace(f: string | null): string {
    if (!f) return '—';
    const m = Math.round((Date.now() - new Date(utc(f)!).getTime()) / 60_000);
    return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`;
  }
}

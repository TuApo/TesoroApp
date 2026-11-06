import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ECO_CONTEXTO_TIENDA, mensajeError, pesos } from '../kanban/eco-portable';
import { Cotizacion, ZonaDomicilio, ZonasApi } from './zonas-api.service';
import { EcoMapa, PuntoMapa } from '../../../../../economiapp/components/eco-mapa';

type Vertice = { lat: number; lng: number };

/**
 * Zonas y tarifas de domicilio de una sede: radios o polígonos dibujados sobre el mapa,
 * con tarifa, pedido mínimo, envío gratis desde y tiempo prometido. Abajo, un probador:
 * tocar el mapa cotiza ese punto tal como lo haría el checkout.
 *
 * <p>Portable: standalone; mapa `EcoMapa` (teselas OSM sin librerías, copiable a otra app),
 * sede por `tiendaId` o `ECO_CONTEXTO_TIENDA`, API por `ECO_API_BASE`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'eco-zonas-domicilio',
  imports: [CommonModule, FormsModule, MatIconModule, EcoMapa],
  templateUrl: './zonas.html',
  styleUrl: './zonas.css',
})
export class ZonasDomicilio implements OnInit {
  private api = inject(ZonasApi);
  readonly ctx = inject(ECO_CONTEXTO_TIENDA);

  readonly tiendaId = input<string | null>(null);
  readonly sinSelector = input(false);
  readonly tienda = computed(() => this.tiendaId() ?? this.ctx.tiendaId());
  readonly tiendaDatos = computed(() => this.ctx.tiendas().find(t => t.id === this.tienda()) ?? null);

  readonly zonas = signal<ZonaDomicilio[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /** Zona en edición (null = ninguna). */
  readonly edicion = signal<ZonaDomicilio | null>(null);
  readonly vertices = signal<Vertice[]>([]);
  readonly modo = signal<'ver' | 'dibujar' | 'probar'>('ver');
  readonly prueba = signal<{ punto: Vertice; cotizacion: Cotizacion | null; error?: string } | null>(null);
  readonly subtotalPrueba = signal(30000);

  readonly puntos = computed<PuntoMapa[]>(() => {
    const ps: PuntoMapa[] = [];
    const t = this.tiendaDatos();
    if (t?.latitud != null && t?.longitud != null) ps.push({ lat: +t.latitud, lng: +t.longitud, etiqueta: 'T', titulo: t.nombre, tono: 'origen' });
    const e = this.edicion();
    if (e?.tipo === 'RADIO' && e.centro_lat != null && e.centro_lng != null) ps.push({ lat: +e.centro_lat, lng: +e.centro_lng, etiqueta: 'C', titulo: `${e.nombre || 'Zona'} · ${e.radio_km ?? '?'} km`, tono: 'elegido' });
    if (e?.tipo === 'POLIGONO') this.vertices().forEach((v, i) => ps.push({ lat: v.lat, lng: v.lng, etiqueta: String(i + 1), tono: 'elegido' }));
    if (!e) {
      for (const z of this.zonas()) {
        if (z.tipo === 'RADIO' && z.centro_lat != null && z.centro_lng != null) ps.push({ lat: +z.centro_lat, lng: +z.centro_lng, etiqueta: '◎', titulo: `${z.nombre} · ${z.radio_km} km`, tono: z.activa ? 'pendiente' : 'espera' });
        else if (z.tipo === 'POLIGONO') for (const v of this.parsear(z.poligono_json)) ps.push({ lat: v.lat, lng: v.lng, etiqueta: '·', titulo: z.nombre, tono: z.activa ? 'pendiente' : 'espera' });
      }
    }
    const p = this.prueba();
    if (p) ps.push({ lat: p.punto.lat, lng: p.punto.lng, etiqueta: '?', titulo: 'Punto de prueba', tono: p.cotizacion?.fuera_de_cobertura ? 'falla' : 'ok' });
    return ps;
  });
  /** El contorno del polígono en edición (cerrado). */
  readonly trazo = computed(() => {
    const e = this.edicion();
    if (e?.tipo !== 'POLIGONO' || this.vertices().length < 2) return [];
    const v = this.vertices();
    return v.length >= 3 ? [...v, v[0]] : v;
  });

  constructor() {
    effect(() => { this.tienda(); untracked(() => this.cargar()); });
  }
  ngOnInit(): void { if (!this.tiendaId()) this.ctx.cargar(); }

  async cargar(): Promise<void> {
    const t = this.tienda(); if (!t) { this.zonas.set([]); return; }
    this.cargando.set(true);
    try { this.zonas.set(await firstValueFrom(this.api.deTienda(t))); this.error.set(null); }
    catch (e) { this.error.set(mensajeError(e, 'No se pudieron cargar las zonas')); }
    finally { this.cargando.set(false); }
  }

  nueva(tipo: 'RADIO' | 'POLIGONO'): void {
    const t = this.tiendaDatos();
    this.edicion.set({
      tienda_id: this.tienda(), nombre: '', tipo, centro_lat: t?.latitud ?? null, centro_lng: t?.longitud ?? null,
      radio_km: tipo === 'RADIO' ? 2 : null, poligono_json: null, tarifa: 3000, pedido_minimo: null, gratis_desde: null,
      tiempo_prometido_min: 45, orden: this.zonas().length, color: '#2b59f0', activa: true,
    });
    this.vertices.set([]);
    this.modo.set('dibujar');
    this.prueba.set(null);
  }

  editar(z: ZonaDomicilio): void {
    this.edicion.set({ ...z });
    this.vertices.set(this.parsear(z.poligono_json));
    this.modo.set('dibujar');
    this.prueba.set(null);
  }

  cancelar(): void { this.edicion.set(null); this.vertices.set([]); this.modo.set('ver'); }

  /** Un toque en el mapa: centro del radio, vértice del polígono o punto de prueba, según el modo. */
  async tocar(p: Vertice): Promise<void> {
    const e = this.edicion();
    if (this.modo() === 'probar' || !e) { await this.probar(p); return; }
    if (e.tipo === 'RADIO') this.edicion.set({ ...e, centro_lat: p.lat, centro_lng: p.lng });
    else this.vertices.update(v => [...v, p]);
  }
  quitarVertice(i: number): void { this.vertices.update(v => v.filter((_, j) => j !== i)); }
  deshacer(): void { this.vertices.update(v => v.slice(0, -1)); }

  campo<K extends keyof ZonaDomicilio>(k: K, valor: ZonaDomicilio[K]): void {
    const e = this.edicion(); if (e) this.edicion.set({ ...e, [k]: valor } as ZonaDomicilio);
  }

  async guardar(delNegocio = false): Promise<void> {
    const e = this.edicion(), t = this.tienda(); if (!e || !t) return;
    const cuerpo: Partial<ZonaDomicilio> & { del_negocio?: boolean } = { ...e, del_negocio: delNegocio };
    if (e.tipo === 'POLIGONO') {
      if (this.vertices().length < 3) { this.error.set('Marque al menos 3 puntos en el mapa para cerrar el polígono.'); return; }
      cuerpo.poligono_json = JSON.stringify(this.vertices().map(v => [+v.lat.toFixed(7), +v.lng.toFixed(7)]));
    }
    try {
      await firstValueFrom(this.api.guardar(t, cuerpo));
      this.aviso.set(`Zona "${e.nombre}" guardada`); this.error.set(null);
      this.cancelar(); await this.cargar();
    } catch (err) { this.error.set(mensajeError(err, 'No se pudo guardar la zona')); }
  }

  async desactivar(z: ZonaDomicilio): Promise<void> {
    const t = this.tienda(); if (!t || !z.id || !confirm(`¿Desactivar la zona "${z.nombre}"? Los domicilios a esa zona dejarán de cotizarse con ella.`)) return;
    try { await firstValueFrom(this.api.desactivar(t, z.id)); await this.cargar(); }
    catch (e) { this.error.set(mensajeError(e, 'No se pudo desactivar')); }
  }

  async probar(p: Vertice): Promise<void> {
    const t = this.tienda(); if (!t) return;
    this.prueba.set({ punto: p, cotizacion: null });
    try { this.prueba.set({ punto: p, cotizacion: await firstValueFrom(this.api.cotizar(t, p, this.subtotalPrueba())) }); }
    catch (e) { this.prueba.set({ punto: p, cotizacion: null, error: mensajeError(e, 'No se pudo cotizar') }); }
  }

  parsear(json: string | null): Vertice[] {
    if (!json) return [];
    try {
      const arr = JSON.parse(json) as Array<[number, number] | { lat: number; lng: number }>;
      return arr.map(v => Array.isArray(v) ? { lat: +v[0], lng: +v[1] } : { lat: +v.lat, lng: +v.lng });
    } catch { return []; }
  }
  readonly pesos = pesos;
  resumen(z: ZonaDomicilio): string {
    return z.tipo === 'RADIO' ? `Radio ${z.radio_km} km` : `Polígono · ${this.parsear(z.poligono_json).length} puntos`;
  }
  cambiarTienda(ev: Event): void { this.ctx.seleccionar((ev.target as HTMLSelectElement).value || null); }
}

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { BandejaSoporte, TicketDetalle, TicketFila, TiendaService } from '../../service/tienda.service';

export const AREAS: Record<string, { nombre: string; icono: string }> = {
  TIENDA: { nombre: 'Tienda', icono: 'storefront' },
  PRODUCTO: { nombre: 'Producto', icono: 'devices' },
  PAGOS: { nombre: 'Pagos', icono: 'payments' },
  REPARTIDOR: { nombre: 'Repartidor', icono: 'two_wheeler' },
  PLATAFORMA: { nombre: 'Plataforma', icono: 'phone_iphone' },
  OTRO: { nombre: 'Otro', icono: 'help' },
};
export const ESTADOS: Record<string, string> = {
  ABIERTO: 'Abierto', EN_PROCESO: 'En proceso', ESPERANDO_CLIENTE: 'Esperando cliente', RESUELTO: 'Resuelto', CERRADO: 'Cerrado',
};

/**
 * Bandeja de soporte de EconomiAPP. Llegan los tickets que abre MatIA (con su resumen
 * y lo que ya verificó), los que abre la persona y los de la tienda. Cada uno va por área
 * (tienda, producto, pagos, repartidor, plataforma) para que lo tome quien lo resuelve.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-soporte',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, SelectorTienda],
  templateUrl: './soporte.html',
  styleUrls: ['../../styles/tienda-comun.css', './soporte.css'],
})
export class Soporte {
  private api = inject(TiendaService);
  private ctx = inject(ContextoTiendaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly AREAS = AREAS;
  readonly ESTADOS = ESTADOS;
  readonly LISTA_AREAS = Object.keys(AREAS);
  readonly PRIORIDADES = ['URGENTE', 'ALTA', 'MEDIA', 'BAJA'];

  readonly estado = signal('ACTIVOS');
  readonly area = signal('');
  readonly prioridad = signal('');
  readonly q = signal('');
  readonly mios = signal(false);
  readonly bandeja = signal<BandejaSoporte | null>(null);
  readonly sel = signal<TicketDetalle | null>(null);
  readonly respuesta = signal('');
  readonly interno = signal(false);
  readonly cargando = signal(false);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  readonly conteo = computed(() => {
    const m: Record<string, number> = {};
    for (const c of this.bandeja()?.conteos ?? []) m[c.estado] = +c.n;
    m['ACTIVOS'] = (m['ABIERTO'] ?? 0) + (m['EN_PROCESO'] ?? 0) + (m['ESPERANDO_CLIENTE'] ?? 0);
    return m;
  });
  readonly datos = computed(() => {
    const d = this.sel()?.datos_json;
    try { return d ? JSON.parse(d) : null; } catch { return null; }
  });

  private buscarTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.ctx.cargar();
    effect(() => {
      this.ctx.tiendaId(); this.estado(); this.area(); this.prioridad(); this.mios();
      untracked(() => this.cargar());
    });
    const t = this.route.snapshot.queryParamMap.get('t');
    if (t) this.abrir(t);
  }

  buscar(v: string): void {
    this.q.set(v);
    if (this.buscarTimer) clearTimeout(this.buscarTimer);
    this.buscarTimer = setTimeout(() => this.cargar(), 300);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.bandeja.set(await firstValueFrom(this.api.ticketsSoporte({
        tienda: this.ctx.tiendaId() ?? undefined, estado: this.estado(), area: this.area(), prioridad: this.prioridad(),
        q: this.q(), mios: this.mios(),
      })));
      this.error.set(null);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar la bandeja'); }
    finally { this.cargando.set(false); }
  }

  async abrir(id: string): Promise<void> {
    try {
      this.sel.set(await firstValueFrom(this.api.ticketSoporte(id)));
      this.respuesta.set(''); this.interno.set(false);
      this.router.navigate([], { queryParams: { t: id }, replaceUrl: true });
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir el ticket'); }
  }

  cerrarDetalle(): void {
    this.sel.set(null);
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  async responder(estadoDespues?: string): Promise<void> {
    const t = this.sel(); const texto = this.respuesta().trim();
    if (!t || !texto) return;
    this.enviando.set(true);
    try {
      let d = await firstValueFrom(this.api.responderTicket(t.id, texto, this.interno()));
      if (estadoDespues) d = await firstValueFrom(this.api.cambiarTicket(t.id, { estado: estadoDespues }));
      this.sel.set(d); this.respuesta.set(''); this.cargar();
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo enviar'); }
    finally { this.enviando.set(false); }
  }

  async cambiar(c: { estado?: string; prioridad?: string; area?: string; asignarme?: boolean }): Promise<void> {
    const t = this.sel(); if (!t) return;
    try { this.sel.set(await firstValueFrom(this.api.cambiarTicket(t.id, c))); this.cargar(); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo actualizar'); }
  }

  vence(t: TicketFila): string {
    if (t.estado === 'RESUELTO' || t.estado === 'CERRADO' || t.estado === 'ESPERANDO_CLIENTE') return '';
    const m = Math.round((new Date(t.sla_vence_en).getTime() - Date.now()) / 60_000);
    if (m < 0) return `vencido hace ${this.dur(-m)}`;
    return `vence en ${this.dur(m)}`;
  }
  private dur(m: number): string { return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; }
  categoria(c: string): string { return (c ?? '').replace(/_/g, ' '); }
}

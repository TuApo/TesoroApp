import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { EscanerCodigoComponent } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { CanjePuntos, JuegosAdmin, PremioPuntos, ResumenPuntos, TiendaService } from '../../service/tienda.service';

type Pestana = 'entregar' | 'premios' | 'puntos' | 'juegos';
type PremioAdmin = PremioPuntos & { activo: boolean | number; por_entregar: number; entregados: number; negocio_nombre: string | null };

const NIVELES = ['BRONCE', 'PLATA', 'ORO', 'DIAMANTE'];

/**
 * Premios y puntos, del lado de la tienda: lo que hay por entregar (canjes de EconomiAPP),
 * el catálogo de premios (crear, editar, apagar, existencias, nivel) y la consulta/ajuste de
 * los puntos de una persona. Entregar también se puede desde Redimir o desde la caja: aquí
 * se ve la lista completa de la tienda.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-premios-admin',
  imports: [FormsModule, MatIconModule, RouterLink, DatePipe, DecimalPipe, SelectorTienda, EscanerCodigoComponent],
  templateUrl: './premios-admin.html',
  styleUrls: ['../../styles/tienda-comun.css', './premios-admin.css'],
})
export class PremiosAdmin {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);

  readonly pestana = signal<Pestana>('entregar');
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly ocupado = signal(false);

  // Entregar
  readonly canjes = signal<CanjePuntos[]>([]);
  readonly estado = signal('SOLICITADO');
  readonly codigo = signal('');

  // Premios
  readonly premios = signal<PremioAdmin[]>([]);
  readonly editando = signal<Record<string, any> | null>(null);
  readonly NIVELES = NIVELES;

  // Puntos de una persona
  readonly cedula = signal('');
  readonly resumen = signal<ResumenPuntos | null>(null);
  readonly ajuste = signal<number | null>(null);
  readonly motivo = signal('');

  // Ruleta y juegos
  readonly juegos = signal<JuegosAdmin | null>(null);
  readonly pesos = signal<Record<string, number>>({});
  /** Probabilidad que quedaría con los pesos que se están editando (solo casillas activas). */
  readonly probEditada = computed(() => {
    const j = this.juegos();
    if (!j) return {} as Record<string, number>;
    const p = this.pesos();
    const activos = j.ruleta.opciones.filter(o => +o.activo);
    const total = activos.reduce((s, o) => s + (p[o.id] ?? o.peso), 0);
    return Object.fromEntries(activos.map(o => [o.id, total ? Math.round(10000 * (p[o.id] ?? o.peso) / total) / 100 : 0]));
  });

  readonly porEntregar = computed(() => this.canjes().filter(c => c.estado === 'SOLICITADO' && !Number(c.vencido)).length);

  constructor() {
    this.ctx.cargar();
    effect(() => {
      const t = this.ctx.tiendaId();
      const e = this.estado();
      untracked(() => { if (t) this.cargarCanjes(t, e); });
    });
    effect(() => { if (this.pestana() === 'premios') untracked(() => this.cargarPremios()); });
    effect(() => { if (this.pestana() === 'juegos') untracked(() => this.cargarJuegos()); });
  }

  private mensaje(e: any, porDefecto: string): string { return e?.error?.error ?? e?.error?.mensaje ?? porDefecto; }

  async cargarCanjes(t: string, estado: string): Promise<void> {
    try { this.canjes.set(await firstValueFrom(this.api.canjesDeTienda(t, estado || undefined))); }
    catch (e) { this.error.set(this.mensaje(e, 'No se pudieron cargar los canjes')); }
  }

  async cargarPremios(): Promise<void> {
    try { this.premios.set(await firstValueFrom(this.api.premiosAdmin())); }
    catch (e) { this.error.set(this.mensaje(e, 'No se pudieron cargar los premios')); }
  }

  async entregar(c: CanjePuntos): Promise<void> {
    if (!confirm(`¿Entregar «${c.premio_nombre}» a ${c.nombre || c.cedula}?`)) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      await firstValueFrom(this.api.entregarCanje(c.codigo, { canal: 'MOSTRADOR', tienda_id: c.tienda_id ?? this.ctx.tiendaId() }));
      this.aviso.set(`Entregado: ${c.premio_nombre}`);
      const t = this.ctx.tiendaId(); if (t) await this.cargarCanjes(t, this.estado());
    } catch (e) { this.error.set(this.mensaje(e, 'No se pudo entregar')); }
    finally { this.ocupado.set(false); }
  }

  /** Código leído o tecleado: se busca y, si está por entregar, se ofrece entregarlo. */
  async buscarCodigo(crudo: string): Promise<void> {
    const c = crudo.trim();
    if (!c) return;
    this.error.set(null);
    try {
      const k = await firstValueFrom(this.api.canjePorCodigo(c));
      this.codigo.set('');
      if (k.estado === 'SOLICITADO' && !Number(k.vencido)) await this.entregar(k);
      else this.error.set(`${k.premio_nombre}: ${Number(k.vencido) ? 'venció' : k.estado.toLowerCase()}.`);
    } catch (e) { this.error.set(this.mensaje(e, 'Ese código no existe')); }
  }

  nuevoPremio(): void {
    this.editando.set({ id: null, nombre: '', descripcion: '', categoria: '', puntos: 500, nivel_minimo: 'BRONCE', existencias: null,
      limite_por_persona: null, destacado: false, activo: true, producto_id: '', variante_id: '', negocio_id: this.ctx.tienda()?.negocio_id ?? '', imagen: '' });
  }

  editar(p: PremioAdmin): void {
    this.editando.set({ ...p, destacado: !!Number(p.destacado), activo: !!Number(p.activo) });
  }

  campo(k: string, v: any): void { this.editando.update(e => e ? { ...e, [k]: v } : e); }

  async guardar(): Promise<void> {
    const e = this.editando();
    if (!e) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      await firstValueFrom(this.api.guardarPremio(e['id'] || null, e));
      this.editando.set(null);
      this.aviso.set('Premio guardado');
      await this.cargarPremios();
    } catch (err) { this.error.set(this.mensaje(err, 'No se pudo guardar el premio')); }
    finally { this.ocupado.set(false); }
  }

  async consultar(): Promise<void> {
    const c = this.cedula().trim();
    if (!c) return;
    this.error.set(null);
    try { this.resumen.set(await firstValueFrom(this.api.puntosDePersona(c))); }
    catch (e) { this.error.set(this.mensaje(e, 'No se pudieron consultar los puntos')); }
  }

  async ajustar(): Promise<void> {
    const c = this.cedula().trim(), n = Number(this.ajuste()), m = this.motivo().trim();
    if (!c || !n || !m) { this.error.set('Escriba la cédula, los puntos (positivos o negativos) y el motivo.'); return; }
    if (!confirm(`¿${n > 0 ? 'Sumar' : 'Restar'} ${Math.abs(n)} puntos a ${c}? Motivo: ${m}`)) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      this.resumen.set(await firstValueFrom(this.api.ajustarPuntos(c, n, m)));
      this.ajuste.set(null); this.motivo.set('');
      this.aviso.set('Ajuste registrado');
    } catch (e) { this.error.set(this.mensaje(e, 'No se pudo ajustar')); }
    finally { this.ocupado.set(false); }
  }

  // ── Ruleta y juegos ──

  async cargarJuegos(): Promise<void> {
    this.error.set(null);
    try { this.juegos.set(await firstValueFrom(this.api.juegosAdmin())); this.pesos.set({}); }
    catch (e) { this.error.set(this.mensaje(e, 'No se pudieron cargar la ruleta y los juegos (solo administración).')); }
  }

  ponerPeso(id: string, valor: number | string): void { this.pesos.update(p => ({ ...p, [id]: Math.max(0, Math.round(Number(valor) || 0)) })); }

  async guardarPeso(id: string, activo?: boolean): Promise<void> {
    const peso = this.pesos()[id];
    this.ocupado.set(true);
    try {
      const r = await firstValueFrom(this.api.editarOpcionRuleta(id, { ...(peso != null ? { peso } : {}), ...(activo != null ? { activo } : {}) }));
      this.juegos.update(j => j ? { ...j, ruleta: r } : j);
      this.pesos.update(p => { const x = { ...p }; delete x[id]; return x; });
      this.aviso.set('Casilla de la ruleta actualizada');
    } catch (e) { this.error.set(this.mensaje(e, 'No se pudo guardar la casilla.')); }
    finally { this.ocupado.set(false); }
  }

  async elegirTorneo(codigo: string): Promise<void> {
    if (!confirm('¿Cambiar el juego del torneo de esta semana? El ranking del premio pasa a ese juego.')) return;
    this.ocupado.set(true);
    try { this.juegos.set(await firstValueFrom(this.api.elegirTorneo(codigo))); this.aviso.set('Torneo de la semana actualizado'); }
    catch (e) { this.error.set(this.mensaje(e, 'No se pudo cambiar el torneo.')); }
    finally { this.ocupado.set(false); }
  }

  async cerrarTorneos(): Promise<void> {
    this.ocupado.set(true);
    try { const r = await firstValueFrom(this.api.cerrarTorneos()); this.aviso.set(r.length ? `Semanas cerradas: ${r.length}` : 'No había semanas terminadas por cerrar'); await this.cargarJuegos(); }
    catch (e) { this.error.set(this.mensaje(e, 'No se pudo cerrar.')); }
    finally { this.ocupado.set(false); }
  }

  medalla(p: number): string { return p === 1 ? '🥇' : p === 2 ? '🥈' : '🥉'; }
}

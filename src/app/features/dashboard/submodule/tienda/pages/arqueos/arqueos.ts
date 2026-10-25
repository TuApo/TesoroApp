import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { FotosEvidencia } from '../../components/fotos-evidencia/fotos-evidencia';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { NombresProducto } from '../../service/nombres-producto.service';
import { TiendaService } from '../../service/tienda.service';
import { EscanerCodigoComponent, ResultadoEscaneo } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';

interface Linea {
  id: string; producto_id: string; variante_id: string | null; stock_sistema: number; conteo1: number | null; conteo2: number | null;
  cantidad_final: number | null; diferencia: number | null; costo_unitario: number; valor_diferencia: number | null; motivo: string | null; ajustado: boolean;
}
interface Arqueo {
  id: string; numero: string; tipo: string; estado: string; congelar_ventas: boolean; doble_conteo: boolean; total_items: number;
  items_contados: number; items_con_diferencia: number; valor_diferencia: number; abierto_en: string; cerrado_en: string | null;
}
const ESTADOS: Record<string, string> = { ABIERTO: 'Contando', EN_CONTEO: 'Contando', EN_REVISION: 'En revisión', CERRADO: 'Cerrado', ANULADO: 'Anulado' };

/**
 * Arqueo de inventario: conteo a ciegas (no se ve lo que dice el sistema mientras se
 * cuenta), doble conteo opcional, foto por línea, revisión de diferencias con motivo y
 * cierre que ajusta el inventario.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-arqueos',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, FotosEvidencia, EscanerCodigoComponent],
  templateUrl: './arqueos.html',
  styleUrls: ['../../styles/tienda-comun.css', './arqueos.css'],
})
export class Arqueos {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  readonly np = inject(NombresProducto);
  readonly ESTADOS = ESTADOS;
  readonly lista = signal<Arqueo[]>([]);
  /** Nombres que manda el servidor con el detalle (incluye productos fuera del catálogo activo). */
  readonly nombresDet = signal<Record<string, string>>({});
  readonly variantesDet = signal<Record<string, string>>({});
  nombre(l: { producto_id: string; variante_id: string | null }): string {
    const base = this.nombresDet()[l.producto_id] ?? this.np.de(l.producto_id);
    const v = l.variante_id ? this.variantesDet()[l.variante_id] : null;
    return v ? `${base} · ${v}` : base;
  }
  readonly sel = signal<Arqueo | null>(null);
  readonly lineas = signal<Linea[]>([]);
  readonly filtro = signal<'todas' | 'sin_contar' | 'diferencia'>('todas');
  readonly q = signal('');
  readonly entrada = signal<Record<string, number | null>>({});
  readonly resolucion = signal<Record<string, { cantidad: number | null; motivo: string }>>({});
  readonly fotosDe = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  // Nuevo
  readonly tipo = signal('TOTAL');
  readonly congelar = signal(false);
  readonly doble = signal(true);

  readonly contando = computed(() => ['ABIERTO', 'EN_CONTEO'].includes(this.sel()?.estado ?? ''));
  readonly revision = computed(() => this.sel()?.estado === 'EN_REVISION');
  readonly visibles = computed(() => {
    const q = this.q().trim().toLowerCase(), f = this.filtro();
    return this.lineas().filter(l => {
      if (q && !this.nombre(l).toLowerCase().includes(q)) return false;
      if (f === 'sin_contar') return l.conteo1 == null || (this.sel()?.doble_conteo && l.conteo2 == null);
      if (f === 'diferencia') return this.difiere(l);
      return true;
    });
  });
  readonly avance = computed(() => {
    const ls = this.lineas(); if (!ls.length) return 0;
    return Math.round(ls.filter(l => l.conteo1 != null).length / ls.length * 100);
  });

  constructor() {
    this.ctx.cargar(); this.np.cargar();
    effect(() => { const t = this.ctx.tiendaId(); untracked(() => this.cargar(t)); });
  }

  async cargar(t: string | null): Promise<void> {
    this.sel.set(null);
    if (!t) return;
    try { this.lista.set(await firstValueFrom(this.api.arqueos(t)) as any); this.error.set(null); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudieron cargar los arqueos'); }
  }

  async abrir(id: string): Promise<void> {
    try {
      const d: any = await firstValueFrom(this.api.detalleArqueo(id));
      this.sel.set(d.arqueo); this.lineas.set(d.lineas); this.nombresDet.set(d.nombres ?? {}); this.variantesDet.set(d.variantes ?? {}); this.entrada.set({}); this.aviso.set(null);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir el arqueo'); }
  }

  async nuevo(): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) return;
    try {
      const a: any = await firstValueFrom(this.api.abrirArqueo({ tienda_id: t, tipo: this.tipo(), congelar_ventas: this.congelar(), doble_conteo: this.doble() }));
      await this.cargar(t); await this.abrir(a.id);
      this.aviso.set(this.congelar() ? 'Arqueo abierto con las ventas del mostrador congeladas.' : 'Arqueo abierto. Cuente sin mirar lo que dice el sistema.');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir el arqueo'); }
  }

  /** Cuál conteo se está registrando en la línea (el 2 solo con doble conteo). */
  numeroConteo(l: Linea): 1 | 2 | null {
    if (l.conteo1 == null) return 1;
    if (this.sel()?.doble_conteo && l.conteo2 == null) return 2;
    return null;
  }

  /**
   * Contar escaneando: cada lectura suma 1 al conteo que se está escribiendo en esa línea
   * (sigue siendo a ciegas: no se muestra lo del sistema). Al terminar se guarda con el botón
   * de cada línea, como siempre.
   */
  readonly procesarConteo = async (codigo: string): Promise<ResultadoEscaneo> => {
    if (!this.contando()) return { ok: false, texto: 'El arqueo no está en conteo' };
    try {
      const ps = await firstValueFrom(this.api.productosPorCodigo(codigo));
      const ids = new Set((ps ?? []).map(p => p.id));
      const candidatas = this.lineas().filter(l => ids.has(l.producto_id) && this.numeroConteo(l));
      if (!ids.size) return { ok: false, texto: 'Ningún producto tiene ese código', detalle: codigo };
      if (!candidatas.length) return { ok: false, texto: `${ps[0].nombre}: no está en este arqueo o ya se contó` };
      if (candidatas.length > 1) {
        this.q.set(ps[0].nombre);
        return { ok: false, texto: 'Varias líneas con ese código', detalle: 'Las dejamos filtradas: escriba el conteo en la correcta' };
      }
      const l = candidatas[0];
      const n = (Number(this.entrada()[l.id]) || 0) + 1;
      this.ponerEntrada(l.id, n);
      return { ok: true, texto: this.nombre(l), detalle: `Conteo ${this.numeroConteo(l)} en curso: ${n}` };
    } catch {
      return { ok: false, texto: 'No se pudo buscar el código', detalle: 'Revise la conexión' };
    }
  };

  /** Fuera del conteo, el escáner filtra la lista por el producto leído. */
  async buscarPorCodigo(codigo: string): Promise<void> {
    try {
      const ps = await firstValueFrom(this.api.productosPorCodigo(codigo));
      this.q.set(ps?.[0]?.nombre ?? codigo);
    } catch { this.q.set(codigo); }
  }

  ponerEntrada(id: string, v: number | null): void { this.entrada.update(e => ({ ...e, [id]: v })); }

  async contar(l: Linea): Promise<void> {
    const v = this.entrada()[l.id]; if (v == null || v < 0) return;
    try {
      const r: any = await firstValueFrom(this.api.contarArqueo(l.id, +v));
      this.lineas.update(ls => ls.map(x => x.id === l.id ? { ...x, ...r } : x));
      this.entrada.update(e => ({ ...e, [l.id]: null }));
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo registrar el conteo'); }
  }

  difiere(l: Linea): boolean {
    const c = l.conteo2 ?? l.conteo1;
    return c != null && (+c !== +l.stock_sistema || (l.conteo2 != null && +l.conteo1! !== +l.conteo2));
  }

  async aRevision(): Promise<void> {
    const s = this.sel(); if (!s) return;
    const faltan = this.lineas().filter(l => this.numeroConteo(l) !== null).length;
    if (faltan && !confirm(`Faltan ${faltan} líneas por contar. ¿Pasar a revisión de todos modos?`)) return;
    try { await firstValueFrom(this.api.revisionArqueo(s.id)); await this.abrir(s.id); this.filtro.set('diferencia'); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo pasar a revisión'); }
  }

  ponerRes(id: string, k: 'cantidad' | 'motivo', v: any): void {
    this.resolucion.update(r => ({ ...r, [id]: { ...(r[id] ?? { cantidad: null, motivo: '' }), [k]: v } }));
  }
  async resolver(l: Linea): Promise<void> {
    const r = this.resolucion()[l.id]; if (!r || r.cantidad == null || !r.motivo.trim()) return;
    try {
      const x: any = await firstValueFrom(this.api.resolverArqueo(l.id, +r.cantidad, r.motivo.trim()));
      this.lineas.update(ls => ls.map(y => y.id === l.id ? { ...y, ...x } : y));
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo resolver'); }
  }

  async cerrar(): Promise<void> {
    const s = this.sel(); if (!s) return;
    const valor = this.lineas().reduce((t, l) => t + (+(l.valor_diferencia ?? 0)), 0);
    if (!confirm(`¿Cerrar el arqueo? El inventario se ajusta a lo contado (diferencia ${this.pesos(valor)}).`)) return;
    try { await firstValueFrom(this.api.cerrarArqueo(s.id)); await this.abrir(s.id); this.aviso.set('Arqueo cerrado: el inventario quedó ajustado.'); this.cargar(this.ctx.tiendaId()); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cerrar'); }
  }
  async anular(): Promise<void> {
    const s = this.sel(); const m = prompt('¿Por qué se anula el arqueo?'); if (!s || !m) return;
    try { await firstValueFrom(this.api.anularArqueo(s.id, m)); await this.cargar(this.ctx.tiendaId()); } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo anular'); }
  }

  pesos(v: number | null | undefined): string { return v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(Math.round(+v)).toLocaleString('es-CO'); }
}

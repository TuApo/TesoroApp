import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { Producto, TiendaService } from '../../service/tienda.service';

type Pestana = 'promocion' | 'combo';
type TipoPromo = 'PORCENTAJE' | 'MONTO_FIJO' | 'PRECIO_ESPECIAL' | 'NXM' | 'ENVIO_GRATIS';
interface Elegido { id: string; nombre: string; cantidad: number; }

/**
 * Crear promociones y combos para EconomiAPP y el mostrador.
 *
 * <p>El motor de precios ya sabía aplicar todo esto; lo que faltaba era una forma de
 * cargarlo sin escribir JSON. Una promoción se arma en lenguaje de negocio: qué descuento,
 * sobre qué (todo, categorías o productos), en qué tiendas y hasta cuándo, con su banner
 * opcional. Un combo: qué productos y cuántos, su foto y en qué tiendas se publica.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-ofertas',
  imports: [FormsModule, MatIconModule, CurrencyPipe],
  templateUrl: './ofertas.html',
  styleUrls: ['../../styles/tienda-comun.css', './ofertas.css'],
})
export class Ofertas implements OnInit {
  readonly ctx = inject(ContextoTiendaService);
  private api = inject(TiendaService);

  readonly pestana = signal<Pestana>('promocion');
  readonly categorias = signal<Array<{ id: string; nombre: string }>>([]);
  readonly busqueda = signal('');
  readonly resultados = signal<Producto[]>([]);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  // Comunes
  readonly nombre = signal('');
  readonly descripcion = signal('');
  readonly tiendasElegidas = signal<string[]>([]);
  readonly imagen = signal<File | null>(null);
  readonly vistaImagen = signal<string | null>(null);

  // Promoción
  readonly tipo = signal<TipoPromo>('PORCENTAJE');
  readonly valor = signal<number | null>(10);
  readonly lleva = signal(3);
  readonly paga = signal(2);
  readonly alcanceObjetivo = signal<'TODO' | 'CATEGORIA' | 'PRODUCTO'>('CATEGORIA');
  readonly categoriasElegidas = signal<string[]>([]);
  readonly productosElegidos = signal<Elegido[]>([]);
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly maxPorPersona = signal<number | null>(null);

  // Combo
  readonly componentes = signal<Elegido[]>([]);
  readonly precioCombo = signal<number | null>(null);

  readonly negocio = computed(() => this.ctx.tienda()?.negocio_id ?? this.ctx.tiendas()[0]?.negocio_id ?? null);

  readonly listo = computed(() => {
    if (!this.nombre().trim() || !this.tiendasElegidas().length || this.ocupado()) return false;
    if (this.pestana() === 'combo') return this.componentes().length >= 2;
    const t = this.tipo();
    if ((t === 'PORCENTAJE' || t === 'MONTO_FIJO' || t === 'PRECIO_ESPECIAL') && !(Number(this.valor()) > 0)) return false;
    if (t === 'PORCENTAJE' && Number(this.valor()) > 90) return false;
    if (t === 'NXM' && !(this.lleva() > this.paga() && this.paga() > 0)) return false;
    if (this.alcanceObjetivo() === 'CATEGORIA' && !this.categoriasElegidas().length) return false;
    if (this.alcanceObjetivo() === 'PRODUCTO' && !this.productosElegidos().length) return false;
    return true;
  });

  constructor() {
    effect(() => {
      const n = this.negocio();
      untracked(() => {
        if (!n) return;
        this.api.categorias(n).subscribe({
          next: c => this.categorias.set(c.map(x => ({ id: String(x['id']), nombre: String(x['nombre']) }))),
          error: () => this.categorias.set([]),
        });
      });
    });
    effect(() => {
      const ts = this.ctx.tiendas();
      untracked(() => { if (ts.length && !this.tiendasElegidas().length) this.tiendasElegidas.set(ts.map(t => t.id)); });
    });
  }

  ngOnInit(): void { this.ctx.cargar(); }

  alternar(lista: 'tiendas' | 'categorias', id: string): void {
    const s = lista === 'tiendas' ? this.tiendasElegidas : this.categoriasElegidas;
    s.set(s().includes(id) ? s().filter(x => x !== id) : [...s(), id]);
  }

  buscar(): void {
    const q = this.busqueda().trim();
    if (q.length < 2) return;
    this.api.productos({ negocio: this.negocio() ?? undefined, texto: q, tamano: 10 }).subscribe({
      next: r => this.resultados.set(r.content ?? []),
      error: () => this.resultados.set([]),
    });
  }

  agregar(p: Producto): void {
    const destino = this.pestana() === 'combo' ? this.componentes : this.productosElegidos;
    if (!destino().some(x => x.id === p.id)) destino.set([...destino(), { id: p.id, nombre: p.nombre, cantidad: 1 }]);
    this.resultados.set([]);
    this.busqueda.set('');
  }

  quitar(id: string): void {
    const destino = this.pestana() === 'combo' ? this.componentes : this.productosElegidos;
    destino.set(destino().filter(x => x.id !== id));
  }

  cantidad(id: string, n: number): void {
    this.componentes.set(this.componentes().map(c => c.id === id ? { ...c, cantidad: Math.max(1, n) } : c));
  }

  elegirImagen(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    const previa = this.vistaImagen();
    if (previa) URL.revokeObjectURL(previa);
    this.imagen.set(f);
    this.vistaImagen.set(f ? URL.createObjectURL(f) : null);
  }

  async guardar(): Promise<void> {
    if (!this.listo()) return;
    const negocio = this.negocio();
    if (!negocio) { this.error.set('No hay negocio al que asociarlo'); return; }
    this.ocupado.set(true);
    this.error.set(null);
    this.aviso.set(null);
    try {
      const docImagen = this.imagen()
        ? await firstValueFrom(this.api.subirArchivo(this.imagen()!, this.imagen()!.name, obtenerUsuarioActual().id || 'tienda',
            this.pestana() === 'combo' ? 'STORE_COMBO' : 'STORE_PROMOCION'))
        : null;
      if (this.pestana() === 'promocion') await this.guardarPromocion(negocio, docImagen);
      else await this.guardarCombo(negocio, docImagen);
      this.limpiar();
    } catch (e) {
      const err = e as { error?: { error?: string; message?: string } };
      this.error.set(err?.error?.error || err?.error?.message || 'No se pudo guardar');
    } finally {
      this.ocupado.set(false);
    }
  }

  private async guardarPromocion(negocio: string, docImagen: string | null): Promise<void> {
    const t = this.tipo();
    const objetivos = this.alcanceObjetivo() === 'TODO' ? [{ tipo: 'TODO' }]
      : this.alcanceObjetivo() === 'CATEGORIA' ? this.categoriasElegidas().map(id => ({ tipo: 'CATEGORIA', referencia_id: id }))
      : this.productosElegidos().map(p => ({ tipo: 'PRODUCTO', referencia_id: p.id }));
    const p = await firstValueFrom(this.api.crearPromocion({
      negocio_id: negocio,
      codigo: codigoDe(this.nombre()),
      nombre: this.nombre().trim(),
      descripcion: this.descripcion().trim() || null,
      tipo: t,
      valor: t === 'NXM' || t === 'ENVIO_GRATIS' ? null : Number(this.valor()),
      nxm_lleva: t === 'NXM' ? this.lleva() : null,
      nxm_paga: t === 'NXM' ? this.paga() : null,
      vigente_desde: this.desde() ? new Date(`${this.desde()}T00:00:00`).toISOString() : null,
      vigente_hasta: this.hasta() ? new Date(`${this.hasta()}T23:59:59`).toISOString() : null,
      max_usos_persona: this.maxPorPersona() || null,
      objetivos,
      tiendas: this.tiendasElegidas(),
    }));
    if (docImagen) await firstValueFrom(this.api.agregarMediaPromocion(p.id, { doc_id: docImagen, tipo: 'BANNER' }));
    this.aviso.set(`Promoción «${this.nombre().trim()}» creada. Ya se ve en EconomiAPP con el precio rebajado.`);
  }

  private async guardarCombo(negocio: string, docImagen: string | null): Promise<void> {
    const c = await firstValueFrom(this.api.crearCombo({
      negocio_id: negocio,
      codigo: codigoDe(this.nombre()),
      nombre: this.nombre().trim(),
      descripcion: this.descripcion().trim() || null,
      imagen_doc_id: docImagen,
      tipo_precio: this.precioCombo() ? 'FIJO' : 'SUMA_CON_DESCUENTO',
      descuento_pct: this.precioCombo() ? null : 0,
      precio_fijo: this.precioCombo() || null,
      componentes: this.componentes().map((x, i) => ({ producto_id: x.id, cantidad: x.cantidad, orden: i })),
    }));
    for (const t of this.tiendasElegidas()) {
      await firstValueFrom(this.api.publicarCombo(c.id, { tienda_id: t, publicado: true }));
    }
    this.aviso.set(`Combo «${this.nombre().trim()}» creado y publicado en ${this.tiendasElegidas().length} tienda(s).`);
  }

  private limpiar(): void {
    this.nombre.set(''); this.descripcion.set(''); this.productosElegidos.set([]); this.componentes.set([]);
    this.categoriasElegidas.set([]); this.desde.set(''); this.hasta.set(''); this.precioCombo.set(null);
    this.maxPorPersona.set(null);
    this.elegirImagen({ target: { files: [] } } as unknown as Event);
  }
}

/** PROMO-SEMANA-MERCADO-4F2 — legible y único sin pedirle a nadie que invente un código. */
function codigoDe(nombre: string): string {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return `${base || 'OFERTA'}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

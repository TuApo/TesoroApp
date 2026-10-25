import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { ArticuloComprador, FiltroFamilia, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EcoImagen } from '../../components/eco-imagen';
import { EcoProducto } from '../../components/eco-producto';
import { EconomiaStore } from '../../economia.store';
import { SonidosService } from '../../sonidos.service';
import { iconoCategoria } from '../../economia.util';

type Ver = 'todo' | 'hoy' | 'encargo' | 'ofertas';
type Orden = 'relevancia' | 'menor' | 'mayor' | 'rapido';

/**
 * Buscar y recorrer el catálogo: por texto, por categoría, por "lo llevo hoy" o "lo encargo",
 * y ordenado por precio o por lo que llega antes.
 *
 * <p>Los filtros viven en la URL (`?q=&categoria=&ver=`) para que el botón atrás del
 * celular vuelva al mismo listado y no a uno vacío.
 */
@Component({
  selector: 'eco-explorar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, EcoProducto, EcoImagen],
  templateUrl: './explorar.html',
  styleUrls: ['../../economiapp.css', './explorar.css'],
})
export class EconomiaExplorar {
  readonly store = inject(EconomiaStore);
  private sonidos = inject(SonidosService);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly texto = computed(() => this.params().get('q') ?? '');
  readonly categoria = computed(() => this.params().get('categoria') ?? '');
  readonly ver = computed<Ver>(() => (this.params().get('ver') as Ver) || 'todo');
  readonly orden = signal<Orden>('relevancia');
  /** Filtros de la familia en la URL: "marca:Samsung,Apple;almacenamiento:256GB". */
  readonly f = computed(() => this.params().get('f') ?? '');
  readonly elegidos = computed<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const parte of this.f().split(';')) {
      const [k, v] = parte.split(':');
      if (k && v) out[k] = v.split(',').filter(Boolean);
    }
    return out;
  });
  readonly totalElegidos = computed(() => Object.values(this.elegidos()).reduce((s, v) => s + v.length, 0));
  readonly facetas = signal<FiltroFamilia[]>([]);
  readonly facetaAbierta = signal<string | null>(null);
  /** Hoja de filtros en el celular y faceta con todos sus valores a la vista. */
  readonly hojaFiltros = signal(false);
  readonly expandida = signal<string | null>(null);
  readonly opcionesVer: Array<{ valor: Ver; nombre: string; icono: string }> = [
    { valor: 'todo', nombre: 'Todo', icono: 'apps' },
    { valor: 'hoy', nombre: 'Disponible hoy', icono: 'bolt' },
    { valor: 'encargo', nombre: 'Por encargo', icono: 'local_shipping' },
    { valor: 'ofertas', nombre: 'Ofertas', icono: 'local_offer' },
  ];
  nombreVer(): string { return this.opcionesVer.find(o => o.valor === this.ver())?.nombre ?? ''; }

  readonly articulos = signal<ArticuloComprador[]>([]);
  readonly pagina = signal(0);
  readonly totalPaginas = signal(0);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly categoriaActual = computed(() => this.store.categorias().find(c => c.id === this.categoria()) ?? null);
  /** Familia › Grupo › Subcategoría de lo que se está viendo. */
  readonly ruta = computed(() => this.store.rutaDe(this.categoria()));
  readonly familiaActual = computed(() => this.ruta()[0] ?? null);
  /** Si la familia tiene vitrina especial (Tecnología, Importados), se ofrece entrar a ella. */
  readonly vitrinaActual = computed(() => this.store.vitrinaDe(this.familiaActual()));
  /**
   * El segundo renglón de filtros: lo que hay DENTRO de la categoría elegida; si ya es una
   * hoja, sus hermanas, para poder saltar de "Gama media" a "Gama alta" sin volver atrás.
   */
  readonly subcategorias = computed(() => {
    const actual = this.categoriaActual();
    if (!actual) return [];
    const hijos = this.store.hijosDe(actual.id);
    return hijos.length ? hijos : this.store.hijosDe(actual.padre_id);
  });
  /** A qué volver con "Todo …" en el segundo renglón: la categoría de la que cuelgan. */
  readonly padreSub = computed(() => {
    const actual = this.categoriaActual();
    if (!actual) return null;
    return this.store.hijosDe(actual.id).length ? actual
      : this.store.categorias().find(c => c.id === actual.padre_id) ?? null;
  });

  readonly visibles = computed(() => {
    let lista = this.articulos();
    const v = this.ver();
    if (v === 'hoy') lista = lista.filter(a => a.disponibilidad === 'EN_STOCK');
    if (v === 'encargo') lista = lista.filter(a => a.disponibilidad === 'BAJO_PEDIDO');
    if (v === 'ofertas') lista = lista.filter(a => a.precio_promo != null);
    const o = this.orden();
    const precio = (a: ArticuloComprador) => a.precio_promo ?? a.precio;
    if (o === 'menor') lista = [...lista].sort((a, b) => (precio(a) ?? 1e15) - (precio(b) ?? 1e15));
    if (o === 'mayor') lista = [...lista].sort((a, b) => (precio(b) ?? -1) - (precio(a) ?? -1));
    if (o === 'rapido') lista = [...lista].sort((a, b) => (a.dias_entrega ?? 0) - (b.dias_entrega ?? 0));
    return lista;
  });

  readonly titulo = computed(() => {
    if (this.texto()) return `Resultados para “${this.texto()}”`;
    if (this.categoriaActual()) return this.categoriaActual()!.nombre;
    if (this.ver() === 'hoy') return 'Disponible hoy';
    if (this.ver() === 'encargo') return 'Por encargo';
    if (this.ver() === 'ofertas') return 'Ofertas';
    return 'Todo el catálogo';
  });

  constructor() {
    // La hoja de filtros sube y baja con su «fiu».
    let hoja = false;
    effect(() => {
      const abierta = this.hojaFiltros();
      untracked(() => { if (abierta !== hoja) { hoja = abierta; this.sonidos.tocar(abierta ? 'abrir' : 'cerrar'); } });
    });
    effect(() => {
      const ambito = this.store.ambito();
      const q = this.texto();
      const c = this.categoria();
      const f = this.f();
      untracked(() => { if (ambito.length) this.cargar(ambito, q, c, 0, f); });
    });
    // Los filtros (y sus valores) dependen de la familia: Celulares trae marca y capacidad,
    // Parlantes solo marca. Los valores salen de los productos que hay.
    effect(() => {
      const tienda = this.store.tiendaId();
      const c = this.categoria();
      untracked(() => {
        this.facetaAbierta.set(null);
        if (!tienda) return;
        this.api.filtrosComprador(tienda, c || undefined).subscribe({
          next: x => this.facetas.set(x ?? []), error: () => this.facetas.set([]),
        });
      });
    });
  }

  private cargar(ambito: string[], texto: string, categoria: string, pagina: number, f = this.f()): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.catalogoMulti(ambito, { texto: texto || undefined, categoria: categoria || undefined, f: f || undefined, pagina, tamano: 36 })
      .subscribe({
        next: r => {
          this.articulos.set(pagina === 0 ? (r.articulos ?? []) : [...this.articulos(), ...(r.articulos ?? [])]);
          this.pagina.set(r.pagina ?? pagina);
          this.totalPaginas.set(r.total_paginas ?? 0);
          this.cargando.set(false);
        },
        error: () => { this.error.set('No pudimos cargar el catálogo'); this.cargando.set(false); },
      });
  }

  masResultados(): void {
    const ambito = this.store.ambito();
    if (ambito.length) this.cargar(ambito, this.texto(), this.categoria(), this.pagina() + 1, this.f());
  }

  filtrar(cambios: { ver?: Ver; categoria?: string | null; q?: string | null }): void {
    // null quita el parámetro de la URL; una clave ausente lo deja como estaba.
    const q: Record<string, string | null> = {};
    if ('ver' in cambios) q['ver'] = cambios.ver === 'todo' ? null : cambios.ver ?? null;
    // Cambiar de familia limpia los filtros: "256GB" no significa nada en Parlantes.
    if ('categoria' in cambios) { q['categoria'] = cambios.categoria || null; q['f'] = null; }
    if ('q' in cambios) q['q'] = cambios.q || null;
    this.router.navigate([], { relativeTo: this.route, queryParamsHandling: 'merge', queryParams: q });
  }

  /** Marca o desmarca un valor de un filtro (OR dentro del filtro, AND entre filtros). */
  alternar(clave: string, valor: string): void {
    const sel = { ...this.elegidos() };
    const lista = new Set(sel[clave] ?? []);
    if (lista.has(valor)) lista.delete(valor); else lista.add(valor);
    if (lista.size) sel[clave] = [...lista]; else delete sel[clave];
    this.ponerFiltros(sel);
  }

  quitarFiltros(clave?: string): void {
    if (!clave) { this.ponerFiltros({}); return; }
    const sel = { ...this.elegidos() };
    delete sel[clave];
    this.ponerFiltros(sel);
  }

  private ponerFiltros(sel: Record<string, string[]>): void {
    const f = Object.entries(sel).map(([k, v]) => `${k}:${v.join(',')}`).join(';');
    this.router.navigate([], { relativeTo: this.route, queryParamsHandling: 'merge', queryParams: { f: f || null } });
  }

  marcado(clave: string, valor: string): boolean {
    return (this.elegidos()[clave] ?? []).includes(valor);
  }

  iconoDe(a: ArticuloComprador): string {
    const c = this.store.categorias().find(x => x.id === a.categoria_id);
    return iconoCategoria(c?.nombre, c?.icono);
  }

  icono(nombre: string, icono: string | null): string { return iconoCategoria(nombre, icono); }
}

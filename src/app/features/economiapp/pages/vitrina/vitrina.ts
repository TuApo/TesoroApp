import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { ArticuloComprador, CategoriaComprador, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EcoImagen } from '../../components/eco-imagen';
import { EcoProducto } from '../../components/eco-producto';
import { EconomiaStore } from '../../economia.store';
import { iconoCategoria, pesos, tono } from '../../economia.util';
import { VITRINAS, vitrinaPorSlug } from '../../vitrinas';

interface Seccion { articulos: ArticuloComprador[]; total: number; cargando: boolean; cargada: boolean; error?: boolean; }

/** Cuántas subcategorías se piden a la vez: el celular no tiene por qué abrir 11 conexiones. */
const EN_PARALELO = 3;

/**
 * Vitrina especial de una categoría (Tecnología, Importados…): la página que la vende.
 *
 * <p>Arriba la publicidad (portada de celular o de escritorio según la pantalla), después el
 * mosaico de subcategorías para entrar directo, lo que está más barato que en el comercio,
 * las marcas, y luego un riel por subcategoría (o la rejilla completa si el catálogo es
 * corto). Cierra con los beneficios y MatIA para quien no sabe qué elegir.
 *
 * <p>Pensada primero para el celular: todo corre de lado con el dedo, los botones quedan a
 * la mano y las imágenes se bajan en el tamaño que la pantalla necesita.
 */
@Component({
  selector: 'eco-vitrina',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, EcoProducto, EcoImagen],
  templateUrl: './vitrina.html',
  styleUrls: ['../../economiapp.css', './vitrina.css'],
})
export class EconomiaVitrina {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private readonly slug = toSignal(this.route.paramMap.pipe(map(p => p.get('slug'))), { initialValue: this.route.snapshot.paramMap.get('slug') });
  readonly vitrina = computed(() => vitrinaPorSlug(this.slug()));
  readonly raiz = computed<CategoriaComprador | null>(() => {
    const v = this.vitrina();
    return v ? this.store.familias().find(c => c.codigo === v.codigo) ?? null : null;
  });
  readonly subcategorias = computed(() => {
    const ocultas = this.vitrina()?.ocultar ?? [];
    return this.store.hijosDe(this.raiz()?.id).filter(c => !ocultas.includes(c.codigo ?? ''));
  });

  readonly destacados = signal<ArticuloComprador[]>([]);
  readonly totalRaiz = signal(0);
  readonly cargandoRaiz = signal(true);
  readonly error = signal<string | null>(null);
  readonly secciones = signal<Record<string, Seccion>>({});
  readonly marcas = signal<Array<{ valor: string; cantidad: number }>>([]);

  /** Subcategorías con productos (o que todavía no se sabe porque no han cargado). */
  readonly visibles = computed(() => {
    const s = this.secciones();
    return this.subcategorias().filter(c => !s[c.id]?.cargada || s[c.id].total > 0);
  });
  readonly ahorro = computed(() => this.destacados()
    .filter(a => a.precio != null && a.precio_referencia != null && a.precio_referencia > (a.precio_promo ?? a.precio))
    .sort((x, y) => this.pctAhorro(y) - this.pctAhorro(x))
    .slice(0, 14));
  readonly ofertas = computed(() => this.destacados().filter(a => a.precio_promo != null).slice(0, 14));
  readonly desde = computed(() => {
    const ps = this.destacados().map(a => a.precio_promo ?? a.precio).filter((p): p is number => p != null && p > 0);
    return ps.length ? Math.min(...ps) : null;
  });
  /** Las otras vitrinas de la tienda, para pasar de una a otra (primero las destacadas). */
  readonly otras = computed(() => this.store.vitrinas()
    .filter(x => x.v.slug !== this.slug())
    .sort((a, b) => Number(!!b.v.destacada) - Number(!!a.v.destacada))
    .slice(0, 8));
  /** srcset de la portada de escritorio con el ancho real de cada imagen. */
  readonly srcsetEscritorio = computed(() => {
    const v = this.vitrina();
    if (!v) return '';
    const [chico, grande] = v.anchosEscritorio ?? [1400, 2400];
    return `${v.hero.escritorioChico} ${chico}w, ${v.hero.escritorio} ${grande}w`;
  });
  readonly tema = computed(() => this.vitrina()?.tema);

  readonly pesos = pesos;
  readonly tono = tono;
  readonly todas = VITRINAS;

  constructor() {
    effect(() => {
      const ambito = this.store.ambito();
      const raiz = this.raiz();
      const tienda = this.store.tiendaId();
      untracked(() => { if (ambito.length && raiz && tienda) this.cargar(ambito, raiz, tienda); });
    });
  }

  private cargar(ambito: string[], raiz: CategoriaComprador, tienda: string): void {
    this.cargandoRaiz.set(true);
    this.error.set(null);
    this.api.catalogoMulti(ambito, { categoria: raiz.id, tamano: 60 }).subscribe({
      next: r => { this.destacados.set(r.articulos ?? []); this.totalRaiz.set(r.total ?? (r.articulos ?? []).length); this.cargandoRaiz.set(false); },
      error: () => { this.error.set('No pudimos cargar esta vitrina'); this.cargandoRaiz.set(false); },
    });
    if (this.vitrina()?.marcas) {
      this.api.filtrosComprador(tienda, raiz.id).subscribe({
        next: fs => this.marcas.set((fs ?? []).find(f => f.clave === 'marca')?.valores.slice(0, 18) ?? []),
        error: () => this.marcas.set([]),
      });
    }
    // Cada subcategoría con su riel (o su rejilla completa), de a pocas a la vez.
    const subs = this.subcategorias();
    const tamano = this.vitrina()?.disposicion === 'rejilla' ? 60 : 14;
    this.secciones.set(Object.fromEntries(subs.map(c => [c.id, { articulos: [], total: 0, cargando: true, cargada: false }])));
    let siguiente = 0;
    const lanzar = () => {
      const c = subs[siguiente++];
      if (!c) return;
      this.api.catalogoMulti(ambito, { categoria: c.id, tamano }).subscribe({
        next: r => { this.ponerSeccion(c.id, { articulos: r.articulos ?? [], total: r.total ?? (r.articulos ?? []).length, cargando: false, cargada: true }); lanzar(); },
        error: () => { this.ponerSeccion(c.id, { articulos: [], total: 0, cargando: false, cargada: false, error: true }); lanzar(); },
      });
    };
    for (let i = 0; i < EN_PARALELO; i++) lanzar();
  }

  private ponerSeccion(id: string, s: Seccion): void {
    this.secciones.update(x => ({ ...x, [id]: s }));
  }

  seccion(id: string): Seccion | undefined { return this.secciones()[id]; }

  pctAhorro(a: ArticuloComprador): number {
    const p = a.precio_promo ?? a.precio ?? 0, ref = a.precio_referencia ?? 0;
    return ref > 0 ? (ref - p) / ref : 0;
  }

  mosaico(c: CategoriaComprador): string | null { return this.vitrina()?.mosaicos[c.codigo ?? ''] ?? null; }

  /** Sin foto propia, el mosaico muestra la del primer producto de esa subcategoría. */
  fotoProducto(c: CategoriaComprador): string | null {
    return this.secciones()[c.id]?.articulos.find(a => a.imagen)?.imagen ?? null;
  }

  icono(c: CategoriaComprador): string { return iconoCategoria(c.nombre, c.icono); }

  iconoDe(a: ArticuloComprador): string {
    const c = this.store.categorias().find(x => x.id === a.categoria_id);
    return iconoCategoria(c?.nombre, c?.icono);
  }

  /** El mosaico baja a la sección de esa subcategoría (sin salir de la vitrina). */
  irA(c: CategoriaComprador): void {
    const el = document.getElementById('sec-' + c.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else this.verTodo(c);
  }

  verTodo(c: CategoriaComprador | null, f?: string): void {
    if (!c) return;
    this.router.navigate(['/economiapp/explorar'], { queryParams: f ? { categoria: c.id, f } : { categoria: c.id } });
  }

  ctaPrincipal(): void {
    const v = this.vitrina();
    const sub = v?.ctaCodigo ? this.store.categorias().find(c => c.codigo === v.ctaCodigo) : null;
    if (sub) { this.verTodo(sub); return; }
    document.getElementById('productos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  verMarca(valor: string): void { this.verTodo(this.raiz(), `marca:${valor}`); }
}

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';

import {
  ArticuloComprador, CategoriaComprador, KitComprador, PedidoDetallado, PublicacionVitrina, TiendaService,
} from '../../../dashboard/submodule/tienda/service/tienda.service';
import { Diapositiva, EcoCarrusel } from '../../components/eco-carrusel';
import { EcoImagen } from '../../components/eco-imagen';
import { EcoProducto } from '../../components/eco-producto';
import { EconomiaStore } from '../../economia.store';
import { TemporadaService } from '../../../../core/services/temporada.service';
import {
  ESTADO_PEDIDO, PASOS_PEDIDO, etiquetaPromocion, iconoCategoria, pesos, tono, usuarioEnSesion,
} from '../../economia.util';

const CERRADOS = ['ENTREGADO', 'CANCELADO', 'RECHAZADO'];

/** Una fila del catálogo global agrupada por su categoría. */
interface GrupoGlobal { categoria: CategoriaComprador | null; nombre: string; articulos: ArticuloComprador[]; dias: number | null; }

/**
 * Portada de EconomiAPP, en el orden en que la persona decide: cuánto tiene para gastar y
 * si va algo en camino; qué hay de nuevo (publicidad y ofertas); por dónde empezar
 * (categorías); qué se lleva HOY de su tienda; y qué puede encargar del catálogo global,
 * cada categoría con su tiempo de llegada.
 *
 * <p>La publicidad la carga la tienda (zona HOME_BANNER, 1600×800, y DESTACADOS, 800×800).
 * Si no hay, la portada arma sus propios banners con las ofertas vigentes y lo que ofrece
 * la tienda: una vitrina vacía hace que la app parezca abandonada.
 */
@Component({
  selector: 'eco-inicio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, EcoProducto, EcoImagen, EcoCarrusel],
  templateUrl: './inicio.html',
  styleUrls: ['../../economiapp.css', './inicio.css'],
})
export class EconomiaInicio {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private router = inject(Router);
  readonly temporada = inject(TemporadaService);

  readonly usuario = usuarioEnSesion();
  readonly articulos = signal<ArticuloComprador[]>([]);
  readonly vitrina = signal<PublicacionVitrina[]>([]);
  readonly kits = signal<KitComprador[]>([]);
  readonly enCurso = signal<PedidoDetallado[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly hoy = computed(() => this.articulos().filter(a => a.disponibilidad === 'EN_STOCK'));
  readonly encargo = computed(() => this.articulos().filter(a => a.disponibilidad === 'BAJO_PEDIDO'));
  readonly ofertas = computed(() => this.articulos().filter(a => a.precio_promo != null));
  readonly destacados = computed(() => this.vitrina().filter(v => v.zona === 'DESTACADOS'));
  /** Vitrinas que se anuncian en grande; las demás entran por su círculo con foto. */
  readonly vitrinasDestacadas = computed(() => this.store.vitrinas().filter(x => x.v.destacada));

  /** Catálogo global en filas por categoría, cada una con su tiempo de llegada. */
  readonly globales = computed<GrupoGlobal[]>(() => {
    const grupos = new Map<string, GrupoGlobal>();
    for (const a of this.encargo()) {
      // Se agrupa por FAMILIA: los productos viven en la hoja (Celulares › Android › Gama
      // media) y una pestaña por hoja serían decenas.
      const cat = this.store.grupoDe(a.categoria_id);
      const clave = cat?.id ?? 'otros';
      const g = grupos.get(clave) ?? { categoria: cat, nombre: cat?.nombre ?? 'Más productos', articulos: [], dias: null };
      g.articulos.push(a);
      if (a.dias_entrega != null) g.dias = Math.min(g.dias ?? a.dias_entrega, a.dias_entrega);
      grupos.set(clave, g);
    }
    return [...grupos.values()].sort((x, y) => y.articulos.length - x.articulos.length);
  });

  /** Pestaña elegida del catálogo global ('' = todo). */
  readonly globalSel = signal('');
  readonly globalVisibles = computed(() => {
    const sel = this.globalSel();
    const todos = this.encargo();
    return sel ? todos.filter(a => (this.store.grupoDe(a.categoria_id)?.id ?? 'otros') === sel) : todos;
  });

  /** Banners: los que cargó la tienda y, si son pocos, los que arma la portada. */
  readonly banners = computed<Diapositiva[]>(() => {
    const propios: Diapositiva[] = this.vitrina()
      .filter(v => (v.zona === 'HOME_BANNER' || v.zona === 'CARRUSEL') && (v.imagen_doc_id || v.titulo))
      .map(v => ({ id: 'pub-' + v.id, titulo: v.titulo, subtitulo: v.subtitulo, doc: v.imagen_doc_id,
        fondo: 'linear-gradient(120deg, #0F1B2D, #047857)', cta: v.enlace_tipo !== 'NINGUNO' ? 'Ver más' : null }));
    // Las vitrinas especiales siempre se anuncian: son la puerta a lo que más se quiere vender.
    const vitrinas: Diapositiva[] = this.store.vitrinas().filter(({ v }) => v.destacada).map(({ v }) => ({
      id: 'vit-' + v.slug, titulo: v.eslogan, subtitulo: v.promo.texto, etiqueta: v.nombre,
      doc: v.carrusel.grande, cta: 'Ver la vitrina', fondo: `linear-gradient(120deg, ${v.tema.fondo}, ${v.tema.fondo2})`,
    }));
    // La temporada (Halloween…) va primero: invita a ganar puntos y canjear premios.
    const t = this.temporada.activa();
    if (t?.banner && t.imagenes?.carrusel) {
      vitrinas.unshift({ id: 'temporada-' + t.clave, titulo: t.banner.titulo, subtitulo: t.banner.subtitulo, etiqueta: t.banner.etiqueta,
        doc: t.imagenes.carrusel.grande, cta: t.banner.cta, fondo: 'linear-gradient(120deg, #1B0A36, #5B21B6)' });
    }
    if (propios.length >= 2) return [...propios, ...vitrinas];

    const auto: Diapositiva[] = [...vitrinas];
    for (const p of this.store.promociones().slice(0, 3)) {
      auto.push({ id: 'promo-' + p.id, titulo: p.nombre, subtitulo: p.descripcion, etiqueta: etiquetaPromocion(p),
        doc: p.media[0]?.doc_id ?? null, icono: 'local_offer', cta: 'Ver oferta',
        fondo: 'linear-gradient(120deg, #B91C1C, #F97316)' });
    }
    const celulares = this.store.familias().find(c => /celular/i.test(c.nombre));
    if (this.encargo().length && !vitrinas.some(d => d.id === 'vit-tecnologia')) {
      auto.push({ id: 'auto-global', titulo: 'Celulares y tecnología con su bono mercado',
        subtitulo: 'Lo pide hoy, se lo traemos a su tienda y se descuenta solo cuando lo recibe.',
        etiqueta: 'Catálogo global', icono: 'smartphone', cta: celulares ? 'Ver celulares' : 'Ver catálogo',
        fondo: 'linear-gradient(120deg, #1E3A8A, #2B59F0 55%, #06B6D4)' });
    }
    if (this.hoy().length) {
      auto.push({ id: 'auto-hoy', titulo: `Su mercado, listo hoy en ${this.store.tienda()?.nombre ?? 'su tienda'}`,
        subtitulo: 'Apártelo ahora y recójalo al salir de turno.', etiqueta: 'Disponible hoy',
        icono: 'shopping_basket', cta: 'Ver lo de hoy', fondo: 'linear-gradient(120deg, #065F46, #0E9F6E 55%, #9BD441)',
        doc: 'economiapp/categorias/carrusel/hoy.webp' });
    }
    if (this.store.tienda()?.permite_domicilio) {
      const costo = Number(this.store.tienda()?.costo_domicilio ?? 0);
      auto.push({ id: 'auto-domicilio', titulo: 'Se lo llevamos a la casa',
        subtitulo: costo ? `Domicilio por ${pesos(costo)} desde ${this.store.tienda()?.nombre}.` : 'Domicilio gratis desde su tienda.',
        etiqueta: 'Domicilio', icono: 'two_wheeler', cta: 'Pedir ahora', fondo: 'linear-gradient(120deg, #4C1D95, #7C3AED 55%, #EC4899)',
        doc: 'economiapp/categorias/carrusel/domicilio.webp' });
    }
    return [...propios, ...auto];
  });

  readonly saludo = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  })();

  readonly pesos = pesos;
  readonly ESTADO = ESTADO_PEDIDO;
  readonly tono = tono;

  constructor() {
    // Cada vez que cambia la tienda se recarga la portada. untracked: las llamadas HTTP no
    // pueden quedar suscritas a las señales que ellas mismas escriben.
    effect(() => {
      const t = this.store.tiendaId();
      const ambito = this.store.ambito();
      untracked(() => { if (t && ambito.length) this.cargar(t, ambito); });
    });
    this.api.misPedidosDetallados().subscribe({
      next: ps => this.enCurso.set((ps ?? []).filter(p => !CERRADOS.includes(p.pedido.estado)).slice(0, 3)),
      error: () => this.enCurso.set([]),
    });
  }

  private cargar(tienda: string, ambito: string[]): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.catalogoMulti(ambito, { tamano: 60 }).subscribe({
      next: r => { this.articulos.set(r.articulos ?? []); this.cargando.set(false); },
      error: () => { this.error.set('No pudimos cargar el catálogo'); this.cargando.set(false); },
    });
    this.api.vitrinaComprador(tienda).subscribe({ next: v => this.vitrina.set(v ?? []), error: () => this.vitrina.set([]) });
    this.api.combosComprador(tienda).subscribe({ next: k => this.kits.set(k ?? []), error: () => this.kits.set([]) });
  }

  iconoDe(a: ArticuloComprador): string {
    const c = this.store.categorias().find(x => x.id === a.categoria_id);
    return iconoCategoria(c?.nombre, c?.icono);
  }

  icono(nombre: string, icono: string | null): string { return iconoCategoria(nombre, icono); }

  avance(estado: string): number {
    if (estado === 'EN_RUTA') return 85;
    const i = PASOS_PEDIDO.indexOf(estado);
    return i < 0 ? 0 : Math.max(8, Math.round((i / (PASOS_PEDIDO.length - 1)) * 100));
  }

  /** A dónde lleva un banner: los de la tienda por su enlace; los automáticos por su id. */
  abrirBanner(d: Diapositiva): void {
    if (d.id.startsWith('pub-')) {
      const pub = this.vitrina().find(v => 'pub-' + v.id === d.id);
      if (pub) this.abrirPublicacion(pub);
      return;
    }
    if (d.id.startsWith('temporada-')) { this.router.navigate(['/economiapp/premios']); return; }
    if (d.id.startsWith('vit-')) { this.router.navigate(['/economiapp/vitrina', d.id.slice(4)]); return; }
    if (d.id.startsWith('promo-')) { this.router.navigate(['/economiapp/promocion', d.id.slice(6)]); return; }
    if (d.id === 'auto-global') {
      const cel = this.store.familias().find(c => /celular/i.test(c.nombre));
      this.router.navigate(['/economiapp/explorar'], { queryParams: cel ? { categoria: cel.id } : { ver: 'encargo' } });
      return;
    }
    if (d.id === 'auto-hoy') { this.router.navigate(['/economiapp/explorar'], { queryParams: { ver: 'hoy' } }); return; }
    this.router.navigate(['/economiapp/explorar']);
  }

  abrirPublicacion(b: PublicacionVitrina): void {
    const v = b.enlace_valor;
    switch (b.enlace_tipo) {
      case 'PRODUCTO': if (v) this.router.navigate(['/economiapp/producto', v]); break;
      case 'COMBO': if (v) this.router.navigate(['/economiapp/combo', v]); break;
      case 'PROMOCION': if (v) this.router.navigate(['/economiapp/promocion', v]); break;
      case 'CATEGORIA': this.router.navigate(['/economiapp/explorar'], { queryParams: { categoria: v } }); break;
      case 'BUSQUEDA': this.router.navigate(['/economiapp/explorar'], { queryParams: { q: v } }); break;
      case 'URL': if (v && /^https:\/\//.test(v)) window.open(v, '_blank', 'noopener'); break;
    }
  }
}

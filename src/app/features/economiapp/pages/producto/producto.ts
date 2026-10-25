import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Location } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { FichaProducto, TiendaService, VarianteComprador } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EcoImagen } from '../../components/eco-imagen';
import { EconomiaStore } from '../../economia.store';
import { fechaLlegada, iconoCategoria, llegada, mensajeError, pesos } from '../../economia.util';

/**
 * Ficha de producto. Lo que más pesa aquí es la caja de "cuándo lo tiene": hoy en su
 * tienda, o por encargo con la fecha estimada y de dónde sale. Es la diferencia entre
 * comprar un celular sabiendo que llega el jueves y descubrirlo en el mostrador.
 */
@Component({
  selector: 'eco-producto-ficha',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, EcoImagen],
  templateUrl: './producto.html',
  styleUrls: ['../../economiapp.css', './producto.css'],
})
export class EconomiaProducto {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  private readonly id = toSignal(this.route.paramMap.pipe(map(p => p.get('id'))), { initialValue: this.route.snapshot.paramMap.get('id') });

  private readonly tiendaDeRuta = toSignal(this.route.queryParamMap.pipe(map(p => p.get('tienda'))),
    { initialValue: this.route.snapshot.queryParamMap.get('tienda') });
  readonly ficha = signal<FichaProducto | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly foto = signal(0);
  readonly varianteId = signal<string | null>(null);
  readonly cantidad = signal(1);
  readonly agregando = signal(false);

  readonly variante = computed<VarianteComprador | null>(() =>
    this.ficha()?.variantes.find(v => v.id === this.varianteId()) ?? null);

  /** Lo que se está mirando: la variante elegida o el producto base. */
  readonly vista = computed(() => {
    const f = this.ficha();
    const v = this.variante();
    if (!f) return null;
    return v ? { ...f, precio: v.precio, precio_referencia: v.precio_referencia ?? null, disponibilidad: v.disponibilidad,
                 existencias: v.existencias, dias_entrega: v.dias_entrega } : f;
  });

  /** Familia › Grupo › Subcategoría del producto, para ubicarse y volver a la familia. */
  readonly ruta = computed(() => {
    const cats = this.store.categorias();
    const salida: Array<{ id: string; nombre: string }> = [];
    let c = cats.find(x => x.id === this.ficha()?.categoria_id);
    while (c && salida.length < 5) {
      salida.unshift({ id: c.id, nombre: c.nombre });
      c = cats.find(x => x.id === c!.padre_id);
    }
    return salida;
  });

  /** Lo que ahorra frente al precio típico del comercio, si lo hay. */
  readonly ahorro = computed(() => {
    const v = this.vista();
    const ref = Number(v?.precio_referencia ?? 0), precio = Number(v?.precio ?? 0);
    return ref > precio && precio > 0 ? ref - precio : 0;
  });

  readonly imagenes = computed(() => {
    const f = this.ficha();
    if (!f) return [];
    return f.imagenes?.length ? f.imagenes : [f.imagen];
  });

  readonly total = computed(() => Number(this.vista()?.precio ?? 0) * this.cantidad());
  readonly maximo = computed(() => {
    const v = this.vista();
    return v?.disponibilidad === 'EN_STOCK' ? Math.max(1, Math.floor(Number(v.existencias || 1))) : 20;
  });
  readonly enCarrito = computed(() => {
    const f = this.ficha();
    return f ? this.store.cantidadDe(f.id) : 0;
  });
  readonly alcanzaCupo = computed(() => {
    const c = this.store.cupo();
    if (!c || this.store.motivoSinCupo()) return null;
    // Solo compara contra lo que el motor ya dio como disponible; no resta nada por su cuenta.
    return this.total() + this.store.total() <= c.disponible;
  });

  readonly pesos = pesos;
  readonly llegada = llegada;
  readonly fechaLlegada = fechaLlegada;

  constructor() {
    effect(() => {
      const id = this.id();
      // En modo oficina la tarjeta dice de qué tienda sale el producto; si no, la de referencia.
      const t = this.tiendaDeRuta() ?? this.store.tiendaId();
      untracked(() => { if (id && t) this.cargar(id, t); });
    });
  }

  private cargar(id: string, tienda: string): void {
    this.cargando.set(true);
    this.error.set(null);
    this.foto.set(0);
    this.cantidad.set(1);
    this.api.fichaProducto(id, tienda).subscribe({
      next: f => {
        this.ficha.set(f);
        // Si hay variantes se arranca en la primera que se pueda pedir: un "Agregar" que
        // falla porque no se eligió talla es peor que una talla preseleccionada.
        const primera = f.variantes?.find(v => v.disponibilidad !== 'NO_DISPONIBLE') ?? null;
        this.varianteId.set(primera?.id ?? null);
        this.cargando.set(false);
      },
      error: e => {
        this.error.set(mensajeError(e, 'No encontramos este producto en su tienda'));
        this.cargando.set(false);
      },
    });
  }

  iconoCat(): string {
    const f = this.ficha();
    const c = this.store.categorias().find(x => x.id === f?.categoria_id);
    return iconoCategoria(c?.nombre, c?.icono);
  }

  // ── Carrusel de fotos: pista con scroll-snap (deslizar con el dedo en el celular) ──

  /** La foto visible sale de cuánto se ha desplazado la pista. */
  alDesplazar(pista: HTMLElement): void {
    const i = Math.round(pista.scrollLeft / Math.max(1, pista.clientWidth));
    if (i !== this.foto()) this.foto.set(Math.max(0, Math.min(i, this.imagenes().length - 1)));
  }

  ir(i: number, pista: HTMLElement): void {
    const n = Math.max(0, Math.min(i, this.imagenes().length - 1));
    this.foto.set(n);
    pista.scrollTo({ left: n * pista.clientWidth, behavior: 'smooth' });
  }

  mover(paso: number, pista: HTMLElement): void {
    this.ir(this.foto() + paso, pista);
  }

  cambiar(n: number): void {
    this.cantidad.set(Math.min(this.maximo(), Math.max(1, this.cantidad() + n)));
  }

  async agregar(irAlCarrito = false): Promise<void> {
    const f = this.ficha();
    if (!f) return;
    this.agregando.set(true);
    const tienda = this.tiendaDeRuta() ?? this.store.tiendaId() ?? undefined;
    const ok = await this.store.agregar({ ...f, tienda_id: f.tienda_id ?? tienda }, this.cantidad(), this.varianteId() ?? undefined);
    this.agregando.set(false);
    if (ok && irAlCarrito) this.router.navigate(['/economiapp/carrito']);
  }

  atras(): void {
    if (history.length > 1) this.location.back();
    else this.router.navigate(['/economiapp']);
  }
}

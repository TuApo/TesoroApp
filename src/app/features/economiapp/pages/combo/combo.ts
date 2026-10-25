import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, map } from 'rxjs';

import { KitComprador, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EcoImagen } from '../../components/eco-imagen';
import { EconomiaStore } from '../../economia.store';
import { iconoCategoria, llegada, mensajeError, pesos } from '../../economia.util';

/**
 * Destino de una publicidad de tipo COMBO: el kit y sus productos, con un botón que los
 * pone todos en el carrito. El precio que se muestra es el que se cobra, producto por
 * producto con sus promociones.
 */
@Component({
  selector: 'eco-combo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, EcoImagen],
  template: `
    <div class="pagina">
      <a class="enlace atras" routerLink="/economiapp"><mat-icon>arrow_back</mat-icon> Inicio</a>
      @if (cargando()) {
        <div class="esqueleto"></div>
      } @else if (error()) {
        <div class="estado-vacio"><mat-icon>inventory_2</mat-icon><h2>Combo no disponible</h2><p>{{ error() }}</p>
          <a class="eco-btn" routerLink="/economiapp">Ver la tienda</a></div>
      } @else if (k(); as k) {
        <section class="kit">
          <div class="kit-foto"><eco-imagen [doc]="k.imagen" [nombre]="k.nombre" icono="redeem" /></div>
          <div class="kit-info">
            <span class="chip info"><mat-icon>redeem</mat-icon> Combo · {{ k.componentes.length }} productos</span>
            <h1>{{ k.nombre }}</h1>
            @if (k.descripcion) { <p class="muted">{{ k.descripcion }}</p> }
            <ul class="componentes">
              @for (c of k.componentes; track c.id) {
                <li>
                  <span class="mini"><eco-imagen [doc]="c.imagen" [nombre]="c.nombre" [icono]="iconoDe(c.categoria_id)" /></span>
                  <span class="txt"><b>{{ c.cantidad }} × {{ c.nombre }}</b>
                    <small>{{ llegada(c) }}{{ c.opcional ? ' · opcional' : '' }}</small></span>
                  <span>{{ pesos((c.precio_promo ?? c.precio ?? 0) * c.cantidad) }}</span>
                </li>
              }
            </ul>
            <div class="total"><span>Total del combo</span><b>{{ pesos(k.total) }}</b></div>
            @if (k.dias_entrega_max) { <p class="aviso warn"><mat-icon>local_shipping</mat-icon><span>Parte del combo es por encargo: listo en unos {{ k.dias_entrega_max }} días.</span></p> }
            <button type="button" class="eco-btn ancho" (click)="agregarTodo(k)" [disabled]="agregando() || !k.completo">
              <mat-icon>add_shopping_cart</mat-icon> {{ k.completo ? 'Agregar el combo al carrito' : 'Combo incompleto en esta tienda' }}
            </button>
          </div>
        </section>
      }
    </div>
  `,
  styleUrls: ['../../economiapp.css'],
  styles: [`
    .atras { display:inline-flex; align-items:center; gap:4px; align-self:flex-start; }
    .kit { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1.1fr); gap:24px; align-items:start; }
    @media (max-width: 900px) { .kit { grid-template-columns: 1fr; } }
    .kit-foto { aspect-ratio: 1; border-radius: 24px; overflow: hidden; border:1px solid var(--border); }
    .kit-info { display:flex; flex-direction:column; gap:12px; }
    .kit-info h1 { font-size: clamp(22px,3vw,30px); font-weight:800; }
    .kit-info .chip { align-self:flex-start; }
    .componentes { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
    .componentes li { display:flex; align-items:center; gap:10px; padding:8px; border-radius:14px; background:var(--surface); border:1px solid var(--border); }
    .mini { width:48px; height:48px; border-radius:12px; overflow:hidden; flex:none; }
    .txt { flex:1; min-width:0; display:flex; flex-direction:column; } .txt small { color:var(--muted); }
    .total { display:flex; justify-content:space-between; align-items:baseline; font-size:15px; }
    .total b { font-size: 24px; font-weight:800; }
  `],
})
export class EconomiaCombo {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private readonly id = toSignal(this.route.paramMap.pipe(map(p => p.get('id'))), { initialValue: this.route.snapshot.paramMap.get('id') });

  readonly k = signal<KitComprador | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly agregando = signal(false);

  readonly pesos = pesos;
  readonly llegada = llegada;

  constructor() {
    effect(() => {
      const id = this.id(); const t = this.store.tiendaId();
      untracked(() => {
        if (!id || !t) return;
        this.cargando.set(true);
        this.api.comboComprador(id, t).subscribe({
          next: k => { this.k.set(k); this.cargando.set(false); },
          error: e => { this.error.set(mensajeError(e, 'Este combo no está disponible en su tienda')); this.cargando.set(false); },
        });
      });
    });
  }

  iconoDe(cat: string | null): string {
    const c = this.store.categorias().find(x => x.id === cat);
    return iconoCategoria(c?.nombre, c?.icono);
  }

  async agregarTodo(k: KitComprador): Promise<void> {
    const t = this.store.tiendaId();
    if (!t) return;
    this.agregando.set(true);
    try {
      for (const c of k.componentes.filter(x => !x.opcional)) {
        await firstValueFrom(this.api.agregarAlCarrito({ tienda_id: t, producto_id: c.id, cantidad: Number(c.cantidad) || 1 }));
      }
      await this.store.refrescarCarrito();
      this.store.avisar(`${k.nombre} en su carrito`);
      this.router.navigate(['/economiapp/carrito']);
    } catch (e) {
      await this.store.refrescarCarrito();
      this.store.avisar(mensajeError(e, 'No se pudo agregar todo el combo'), 'error');
    } finally {
      this.agregando.set(false);
    }
  }
}

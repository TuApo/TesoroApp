import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { ArticuloComprador, PromocionComprador, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EcoImagen } from '../../components/eco-imagen';
import { EcoProducto } from '../../components/eco-producto';
import { EconomiaStore } from '../../economia.store';
import { etiquetaPromocion, iconoCategoria, mensajeError } from '../../economia.util';

/** Destino de una publicidad de tipo PROMOCION: la oferta y los productos que entran. */
@Component({
  selector: 'eco-promocion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, DatePipe, EcoProducto, EcoImagen],
  template: `
    <div class="pagina">
      <a class="enlace atras" routerLink="/economiapp"><mat-icon>arrow_back</mat-icon> Inicio</a>
      @if (cargando()) {
        <div class="esqueleto alto"></div>
      } @else if (error()) {
        <div class="estado-vacio"><mat-icon>local_offer</mat-icon><h2>Oferta no disponible</h2><p>{{ error() }}</p>
          <a class="eco-btn" routerLink="/economiapp">Ver la tienda</a></div>
      } @else if (p(); as p) {
        <section class="cabecera-promo">
          @if (p.media.length) { <eco-imagen class="fondo" [doc]="p.media[0].doc_id" [nombre]="p.nombre" icono="local_offer" /> }
          <div class="texto">
            <span class="chip danger"><mat-icon>local_offer</mat-icon> {{ etiqueta(p) }}</span>
            <h1>{{ p.nombre }}</h1>
            @if (p.descripcion) { <p>{{ p.descripcion }}</p> }
            @if (p.vigente_hasta) { <small>Válida hasta el {{ p.vigente_hasta | date: "EEEE d 'de' MMMM" : undefined : 'es-CO' }}</small> }
          </div>
        </section>
        <p class="muted nota">El descuento se aplica solo al confirmar el pedido; ya lo ve reflejado en cada precio.</p>
        @if (p.articulos?.length) {
          <div class="rejilla">
            @for (a of p.articulos; track a.id) { <eco-producto [a]="a" [icono]="iconoDe(a)" /> }
          </div>
        } @else {
          <div class="estado-vacio"><mat-icon>inventory_2</mat-icon><p>Esta oferta aplica en el mostrador; por ahora no tiene productos en la tienda virtual.</p></div>
        }
      }
    </div>
  `,
  styleUrls: ['../../economiapp.css'],
  styles: [`
    .atras { display:inline-flex; align-items:center; gap:4px; align-self:flex-start; }
    .alto { min-height: 260px; }
    .cabecera-promo { position:relative; overflow:hidden; border-radius:24px; min-height:200px; display:flex; align-items:flex-end;
      background: linear-gradient(135deg, #B91C1C, #F97316); color:#fff; }
    .cabecera-promo .fondo { position:absolute; inset:0; opacity:.45; }
    .cabecera-promo .texto { position:relative; padding:24px; display:flex; flex-direction:column; gap:8px; max-width:720px; }
    .cabecera-promo h1 { font-size: clamp(24px, 4vw, 38px); font-weight:800; }
    .cabecera-promo .chip { align-self:flex-start; background:#fff; color:#B91C1C; border:0; }
    .nota { font-size:13px; }
  `],
})
export class EconomiaPromocion {
  readonly store = inject(EconomiaStore);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private readonly id = toSignal(this.route.paramMap.pipe(map(p => p.get('id'))), { initialValue: this.route.snapshot.paramMap.get('id') });

  readonly p = signal<PromocionComprador | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.id(); const t = this.store.tiendaId();
      untracked(() => {
        if (!id || !t) return;
        this.cargando.set(true);
        this.api.promocionComprador(id, t).subscribe({
          next: p => { this.p.set(p); this.cargando.set(false); },
          error: e => { this.error.set(mensajeError(e, 'Esta oferta ya terminó o no aplica en su tienda')); this.cargando.set(false); },
        });
      });
    });
  }

  etiqueta(p: PromocionComprador): string {
    return etiquetaPromocion(p);
  }

  iconoDe(a: ArticuloComprador): string {
    const c = this.store.categorias().find(x => x.id === a.categoria_id);
    return iconoCategoria(c?.nombre, c?.icono);
  }
}

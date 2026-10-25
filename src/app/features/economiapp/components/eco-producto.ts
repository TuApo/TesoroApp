import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { ArticuloComprador } from '../../dashboard/submodule/tienda/service/tienda.service';
import { EconomiaStore } from '../economia.store';
import { llegada, pesos } from '../economia.util';
import { EcoImagen } from './eco-imagen';

/**
 * Tarjeta de producto al estilo de las apps de domicilios: foto grande, precio en negrilla,
 * cuándo llega, y el botón "+" que se convierte en "− n +" cuando ya está en el carrito.
 *
 * <p>Lo de "cuándo llega" es la razón de ser de la tarjeta: lo que hay en la tienda de su
 * oficina se lleva hoy; lo del catálogo global se encarga y llega en N días, y eso se dice
 * en la tarjeta, no se descubre en el mostrador.
 */
@Component({
  selector: 'eco-producto',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, EcoImagen],
  template: `
    <article class="card" [class.compacta]="compacta()">
      <a class="foto" [routerLink]="['/economiapp/producto', a().id]" [queryParams]="a().tienda_id ? { tienda: a().tienda_id } : {}" [attr.aria-label]="'Ver ' + a().nombre">
        <eco-imagen [doc]="a().imagen" [nombre]="a().nombre" [icono]="icono()" />
        @if (a().tipo === 'SERVICIO' || a().tipo === 'BONO') {
          <span class="sello servicio"><mat-icon>{{ a().tipo === 'BONO' ? 'card_giftcard' : 'confirmation_number' }}</mat-icon>{{ a().tipo === 'BONO' ? 'Bono' : 'Servicio' }} · con código</span>
        } @else if (a().disponibilidad === 'BAJO_PEDIDO') {
          <span class="sello encargo"><mat-icon>local_shipping</mat-icon>{{ llegada(a()) }}</span>
        } @else if (pocas()) {
          <span class="sello pocas">Quedan {{ a().existencias }}</span>
        }
        @if (insignia()) { <span class="sello insignia"><mat-icon>flight_land</mat-icon>{{ insignia() }}</span> }
        @else if (a().es_global) { <span class="sello global">Catálogo global</span> }
        @if (condicionEspecial()) { <span class="sello condicion">{{ condicionEspecial() }}</span> }
        @if (descuentoPct()) { <span class="sello oferta">−{{ descuentoPct() }}%</span> }
      </a>

      <div class="cuerpo">
        @if (a().precio_promo != null) {
          <span class="precio oferta">{{ pesos(a().precio_promo) }} <s>{{ pesos(a().precio) }}</s></span>
        } @else {
          <span class="precio">@if (a().con_opciones) { <small>Desde</small> }{{ pesos(a().precio) }}</span>
        }
        @if (a().puntos) { <span class="pts" [class.doble]="a().precio_promo != null" [attr.title]="a().precio_promo != null ? 'En promoción gana el doble de puntos' : 'Puntos que gana al comprarlo'"><mat-icon>stars</mat-icon>+{{ a().puntos }} pts</span> }
        @if (a().precio_referencia && a().precio_promo == null) {
          <span class="referencia">En el comercio <s>{{ pesos(a().precio_referencia) }}</s></span>
        }
        <a class="p-nombre" [routerLink]="['/economiapp/producto', a().id]" [queryParams]="a().tienda_id ? { tienda: a().tienda_id } : {}">{{ a().nombre }}</a>
        <span class="meta">
          @if (a().marca) { {{ a().marca }} · }
          @if (a().tipo === 'SERVICIO' || a().tipo === 'BONO') {
            <span class="hoy"><mat-icon>bolt</mat-icon>Se activa al pedir</span>
          } @else if (a().disponibilidad === 'EN_STOCK') {
            <span class="hoy"><mat-icon>bolt</mat-icon>Disponible hoy</span>
          } @else { {{ a().unidad || 'und' }} }
        </span>
        @if (mostrarTienda() && a().tienda_nombre) { <span class="origen"><mat-icon>storefront</mat-icon>{{ a().tienda_nombre }}</span> }
      </div>

      <div class="accion">
        @if (a().con_opciones && !store.lineaDe(a().id)) {
          <a class="mas opciones" [routerLink]="['/economiapp/producto', a().id]" [queryParams]="a().tienda_id ? { tienda: a().tienda_id } : {}"
             [attr.aria-label]="'Elegir opción de ' + a().nombre" title="Elegir capacidad u opción">
            <mat-icon>{{ cantidad() > 0 ? 'add_shopping_cart' : 'tune' }}</mat-icon>
            @if (cantidad() > 0) { <span class="cuenta">{{ cantidad() }}</span> }
          </a>
        } @else if (cantidad() > 0) {
          <div class="stepper" [class.ocupado]="ocupado()">
            <button type="button" (click)="store.restar(a())" [disabled]="ocupado()" aria-label="Quitar uno">
              <mat-icon>{{ cantidad() === 1 ? 'delete' : 'remove' }}</mat-icon>
            </button>
            <span>{{ cantidad() }}</span>
            <button type="button" (click)="store.sumar(a())" [disabled]="ocupado()" aria-label="Agregar uno">
              <mat-icon>add</mat-icon>
            </button>
          </div>
        } @else {
          <button type="button" class="mas" (click)="store.agregar(a())" [disabled]="ocupado() || a().precio == null"
                  [attr.aria-label]="'Agregar ' + a().nombre">
            <mat-icon>add</mat-icon>
          </button>
        }
      </div>
    </article>
  `,
  styleUrls: ['./eco-producto.css'],
})
export class EcoProducto {
  readonly store = inject(EconomiaStore);

  readonly a = input.required<ArticuloComprador>();
  readonly icono = input<string>('shopping_bag');
  readonly compacta = input(false);
  /** Sello propio de una vitrina («Importado»); reemplaza al de catálogo global. */
  readonly insignia = input('');

  /** En modo oficina se dice de qué tienda sale cada producto. */
  readonly mostrarTienda = computed(() => this.store.modoOficina() && !this.store.soloTienda());

  readonly cantidad = computed(() => this.store.cantidadDe(this.a().id));
  readonly ocupado = computed(() => this.store.ocupadoLinea() === this.a().id);
  /** Porcentaje de descuento para el sello rojo. 0 si no hay promoción. */
  readonly descuentoPct = computed(() => {
    const { precio, precio_promo } = this.a();
    if (precio == null || precio_promo == null || !precio) return 0;
    return Math.round((1 - precio_promo / precio) * 100);
  });
  /** Exhibición o reacondicionado se dicen en la foto: no es lo mismo que nuevo. */
  readonly condicionEspecial = computed(() => {
    const c = (this.a().condicion || '').trim();
    if (!c || /^nuevo$/i.test(c)) return '';
    return /reacondicionado/i.test(c) ? 'Reacondicionado' : c;
  });
  readonly pocas = computed(() => {
    const e = Number(this.a().existencias || 0);
    return this.a().disponibilidad === 'EN_STOCK' && e > 0 && e <= 5;
  });

  readonly pesos = pesos;
  readonly llegada = llegada;
}

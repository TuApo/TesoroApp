import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { ResumenKpi, TiendaService } from '../../service/tienda.service';

interface Atajo {
  ruta: string;
  icono: string;
  titulo: string;
  ayuda: string;
  /** Solo para quien administra la organización. */
  soloSuperAdmin?: boolean;
}

/**
 * Entrada del módulo.
 *
 * <p>Muestra primero <b>dónde está parado</b> el usuario (qué tienda, con qué rol) y
 * después cómo va. El orden importa: en un módulo donde la misma persona puede atender
 * dos puntos, equivocarse de tienda es el error más caro y más fácil de cometer.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-home',
  imports: [CommonModule, MatIconModule, SelectorTienda],
  templateUrl: './home.html',
  styleUrls: ['../../styles/tienda-comun.css', './home.css'],
})
export class TiendaHome implements OnInit {
  readonly ctx = inject(ContextoTiendaService);
  private api = inject(TiendaService);
  private router = inject(Router);

  readonly resumen = signal<ResumenKpi | null>(null);
  readonly cargandoResumen = signal(false);

  readonly atajos: Atajo[] = [
    { ruta: 'pos', icono: 'point_of_sale', titulo: 'Punto de venta',
      ayuda: 'Cobrar, con pago mixto y descuento por nómina' },
    { ruta: 'inventario', icono: 'inventory_2', titulo: 'Inventario',
      ayuda: 'Existencias, kardex, traslados y arqueo' },
    { ruta: 'catalogo', icono: 'category', titulo: 'Catálogo',
      ayuda: 'Productos, precios y costos' },
    { ruta: 'pedidos', icono: 'delivery_dining', titulo: 'Pedidos',
      ayuda: 'Lo que pide la gente desde la tienda virtual' },
    { ruta: 'promociones', icono: 'local_offer', titulo: 'Promociones',
      ayuda: 'Campañas con condiciones y publicidad' },
    { ruta: 'indicadores', icono: 'insights', titulo: 'Indicadores',
      ayuda: 'Venta, margen, rotación y embudo' },
    { ruta: 'administracion', icono: 'account_tree', titulo: 'Administración',
      ayuda: 'Negocios, jerarquía, tiendas y alcances', soloSuperAdmin: true },
  ];

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargarResumen();
  }

  ir(ruta: string): void {
    this.router.navigate(['/dashboard/tienda', ruta]);
  }

  atajosVisibles(): Atajo[] {
    return this.atajos.filter(a => !a.soloSuperAdmin || this.ctx.esSuperAdmin());
  }

  private cargarResumen(): void {
    this.cargandoResumen.set(true);
    this.api.resumenKpi().subscribe({
      next: r => { this.resumen.set(r); this.cargandoResumen.set(false); },
      // El resumen es informativo: si falla, la pantalla sigue sirviendo para navegar.
      error: () => this.cargandoResumen.set(false),
    });
  }
}

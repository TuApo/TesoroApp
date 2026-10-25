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
    { ruta: 'caja', icono: 'payments', titulo: 'Caja',
      ayuda: 'Abrir y cerrar turno, gastos, retiros y cuadre del efectivo' },
    { ruta: 'ventas', icono: 'receipt', titulo: 'Ventas y devoluciones',
      ayuda: 'Detalle de ventas, devoluciones y pagos por verificar' },
    { ruta: 'inventario', icono: 'inventory_2', titulo: 'Inventario',
      ayuda: 'Existencias, kardex, traslados y arqueo' },
    { ruta: 'arqueos', icono: 'fact_check', titulo: 'Arqueos',
      ayuda: 'Contar el inventario de la tienda o la bodega y ajustar' },
    { ruta: 'traslados', icono: 'swap_horiz', titulo: 'Traslados',
      ayuda: 'Mover mercancía entre bodega y tiendas, con fotos' },
    { ruta: 'catalogo', icono: 'category', titulo: 'Catálogo',
      ayuda: 'Productos, precios y costos' },
    { ruta: 'pedidos', icono: 'delivery_dining', titulo: 'Pedidos',
      ayuda: 'Lo que pide la gente desde la tienda virtual' },
    { ruta: 'alistamiento', icono: 'inventory', titulo: 'Alistamiento',
      ayuda: 'Cola de pedidos por alistar: tomar, juntar, imprimir paquete y stickers' },
    { ruta: 'rutas', icono: 'local_shipping', titulo: 'Rutas y domiciliarios',
      ayuda: 'Despacho, domiciliarios conectados y seguimiento en vivo' },
    { ruta: 'domicilios', icono: 'two_wheeler', titulo: 'Domicilios',
      ayuda: 'Para el domiciliario: escoger pedidos, recogerlos, ruta y entrega con acta' },
    { ruta: 'fiscal', icono: 'account_balance', titulo: 'Fiscal y contabilidad',
      ayuda: 'IVA, margen, libros de ventas y compras, factura electrónica' },
    { ruta: 'compras', icono: 'local_shipping', titulo: 'Compras y proveedores',
      ayuda: 'Importar facturas (XML DIAN, PDF, foto) con IA e histórico de precios' },
    { ruta: 'activos', icono: 'devices_other', titulo: 'Activos de oficina',
      ayuda: 'Equipos por punto, quién los tiene y su entrega con firma' },
    { ruta: 'custodia', icono: 'inventory', titulo: 'Custodia de documentos',
      ayuda: 'Solicitudes de préstamo firmadas: por archivar, archivadas, historial' },
    { ruta: 'medios-pago', icono: 'account_balance_wallet', titulo: 'Medios de pago',
      ayuda: 'Nequi, PSE, cuentas y links de pago de cada tienda' },
    { ruta: 'soporte', icono: 'support_agent', titulo: 'Soporte',
      ayuda: 'Tickets de las personas, por área, con el análisis de MatIA' },
    { ruta: 'promociones', icono: 'local_offer', titulo: 'Promociones',
      ayuda: 'Campañas con condiciones y publicidad' },
    { ruta: 'ofertas', icono: 'sell', titulo: 'Ofertas y combos',
      ayuda: 'Crear promociones y combos para EconomiAPP', soloSuperAdmin: true },
    { ruta: 'redimir', icono: 'qr_code_scanner', titulo: 'Redimir códigos',
      ayuda: 'Servicios, bonos y premios por puntos de EconomiAPP' },
    { ruta: 'premios', icono: 'stars', titulo: 'Premios y puntos',
      ayuda: 'Premios por entregar, catálogo de premios y puntos de cada persona' },
    { ruta: 'publicidad', icono: 'campaign', titulo: 'Publicidad EconomiAPP',
      ayuda: 'Banners y videos de la portada, con sus enlaces' },
    { ruta: 'cargas', icono: 'drive_folder_upload', titulo: 'Cargas masivas',
      ayuda: 'Fotos por ZIP, catálogo y existencias por Excel', soloSuperAdmin: true },
    { ruta: 'indicadores', icono: 'insights', titulo: 'Indicadores',
      ayuda: 'Venta, margen, rotación y embudo' },
    { ruta: 'logis', icono: 'analytics', titulo: 'Logis',
      ayuda: 'Qué se compra, quién, cuándo, qué va junto y qué viene: el análisis a fondo' },
    { ruta: 'administracion', icono: 'account_tree', titulo: 'Administración',
      ayuda: 'Negocios, jerarquía, tiendas y alcances', soloSuperAdmin: true },
  ];

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargarResumen();
  }

  abrirEconomiapp(): void {
    this.router.navigateByUrl('/economiapp');
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

import { Routes } from '@angular/router';
import { economiaGuard } from './economiapp.guard';

/**
 * EconomiAPP: la tienda virtual del colaborador como una app aparte, a pantalla completa,
 * fuera del marco del dashboard (sin menú lateral ni barra de la temporal).
 *
 * <p>Va al nivel raíz (`/economiapp`) y no bajo `/dashboard` justamente para eso: la idea es
 * que al tocar "Tienda" la persona sienta que entró a otra aplicación, especializada en
 * comprar, y que un botón visible la regrese a Tu Apo.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [economiaGuard],
    loadComponent: () => import('./shell/shell').then(m => m.EconomiaShell),
    children: [
      { path: '', loadComponent: () => import('./pages/inicio/inicio').then(m => m.EconomiaInicio) },
      { path: 'explorar', loadComponent: () => import('./pages/explorar/explorar').then(m => m.EconomiaExplorar) },
      { path: 'premios', loadComponent: () => import('./pages/premios/premios').then(m => m.EconomiaPremios) },
      { path: 'juegos', loadComponent: () => import('./pages/juegos/juegos').then(m => m.EconomiaJuegos) },
      { path: 'juego/:codigo', loadComponent: () => import('./pages/juego/juego').then(m => m.EconomiaJuego) },
      { path: 'vitrina/:slug', loadComponent: () => import('./pages/vitrina/vitrina').then(m => m.EconomiaVitrina) },
      { path: 'producto/:id', loadComponent: () => import('./pages/producto/producto').then(m => m.EconomiaProducto) },
      { path: 'promocion/:id', loadComponent: () => import('./pages/promocion/promocion').then(m => m.EconomiaPromocion) },
      { path: 'combo/:id', loadComponent: () => import('./pages/combo/combo').then(m => m.EconomiaCombo) },
      { path: 'asesor', loadComponent: () => import('./pages/asesor/asesor').then(m => m.EconomiaAsesor) },
      { path: 'carrito', loadComponent: () => import('./pages/carrito/carrito').then(m => m.EconomiaCarrito) },
      { path: 'pedidos', loadComponent: () => import('./pages/pedidos/pedidos').then(m => m.EconomiaPedidos) },
      { path: 'pedidos/:id', loadComponent: () => import('./pages/pedido/pedido').then(m => m.EconomiaPedido) },
      { path: 'soporte', loadComponent: () => import('./pages/soporte/soporte').then(m => m.EconomiaSoporte) },
      { path: 'soporte/:id', loadComponent: () => import('./pages/soporte/soporte').then(m => m.EconomiaSoporte) },
      { path: 'cuenta', loadComponent: () => import('./pages/cuenta/cuenta').then(m => m.EconomiaCuenta) },
      { path: '**', redirectTo: '' },
    ],
  },
];

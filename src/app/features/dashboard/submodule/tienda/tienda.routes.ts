import { Routes } from '@angular/router';

/**
 * Rutas del módulo Tienda.
 *
 * <p>Los caminos coinciden EXACTAMENTE con lo declarado en `db_admin.modulo` (V92). El
 * `permisosLecturaGuard` toma el nodo de ruta más largo que coincida, así que una ruta
 * aquí que no exista allí deja al usuario fuera de su propia pantalla.
 *
 * <p>`mis-pedidos` es la excepción: es la vista del COMPRADOR, no del operador, y por eso
 * no tiene nodo de módulo ni permisos — cualquiera con sesión puede ver lo que él mismo
 * pidió. Va antes que nada paramétrico por el motivo de siempre.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then(m => m.TiendaHome),
  },
  {
    path: 'mis-pedidos',
    loadComponent: () => import('./pages/mis-pedidos/mis-pedidos').then(m => m.MisPedidos),
  },
  {
    // Como `mis-pedidos`: es la pantalla del COMPRADOR, no la de un operador. Cualquiera
    // con sesión puede comprar lo suyo, así que no lleva nodo de módulo ni permisos.
    path: 'marketplace',
    loadComponent: () => import('./pages/marketplace/marketplace').then(m => m.Marketplace),
  },
  {
    path: 'entrega',
    loadComponent: () => import('./pages/entrega/entrega').then(m => m.Entrega),
  },
  {
    path: 'pos',
    loadComponent: () => import('./pages/pos/pos').then(m => m.PuntoDeVenta),
  },
  {
    path: 'inventario',
    loadComponent: () => import('./pages/inventario/inventario').then(m => m.Inventario),
  },
  {
    path: 'catalogo',
    loadComponent: () => import('./pages/catalogo/catalogo').then(m => m.Catalogo),
  },
  {
    path: 'promociones',
    loadComponent: () => import('./pages/promociones/promociones').then(m => m.Promociones),
  },
  {
    path: 'pedidos',
    loadComponent: () => import('./pages/pedidos/pedidos').then(m => m.Pedidos),
  },
  {
    path: 'indicadores',
    loadComponent: () => import('./pages/indicadores/indicadores').then(m => m.Indicadores),
  },
  {
    path: 'administracion',
    loadComponent: () => import('./pages/administracion/administracion').then(m => m.Administracion),
  },
];

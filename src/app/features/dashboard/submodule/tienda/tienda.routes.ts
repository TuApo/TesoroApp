import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { PermissionsService } from '../../../../core/services/permissions.service';

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
    // Quien no opera ninguna tienda (el colaborador que viene a comprar) no tiene nada que
    // hacer en el tablero del operador: el botón "Tienda" lo lleva directo a EconomiAPP.
    path: '',
    canActivate: [() => {
      const permisos = inject(PermissionsService);
      const opera = ['pos', 'inventario', 'catalogo', 'pedidos', 'entrega', 'indicadores']
        .some(r => permisos.canReadRoute('/dashboard/tienda/' + r));
      if (opera) return true;
      // El domiciliario y el alistador (roles de plataforma DOMICILIARIO / ALISTADOR) entran
      // directo a su pantalla.
      if (permisos.canReadRoute('/dashboard/tienda/domicilios')) return inject(Router).parseUrl('/dashboard/tienda/domicilios');
      if (permisos.canReadRoute('/dashboard/tienda/alistamiento')) return inject(Router).parseUrl('/dashboard/tienda/alistamiento');
      return inject(Router).parseUrl('/economiapp');
    }],
    loadComponent: () => import('./pages/home/home').then(m => m.TiendaHome),
  },
  // Las pantallas del COMPRADOR se mudaron a EconomiAPP (/economiapp), una app aparte a
  // pantalla completa. Las rutas viejas se quedan como puerta: el menú (db_admin.modulo V99)
  // sigue apuntando aquí y el permisosLecturaGuard decide con ESTE nodo quién entra; pasado
  // el guard, se salta a la app nueva. `redirectTo` como función para que el guard corra
  // antes (un redirectTo de texto se resuelve antes que los guards del hijo).
  {
    path: 'mis-pedidos',
    canActivate: [() => inject(Router).parseUrl('/economiapp/pedidos')],
    children: [],
  },
  {
    path: 'marketplace',
    canActivate: [() => inject(Router).parseUrl('/economiapp')],
    children: [],
  },
  {
    path: 'entrega',
    loadComponent: () => import('./pages/entrega/entrega').then(m => m.Entrega),
  },
  {
    // Caja: turnos, movimientos de efectivo con soporte y cierre con conteo.
    path: 'caja',
    loadComponent: () => import('./pages/caja/caja').then(m => m.Caja),
  },
  {
    // Ventas hechas: detalle, devoluciones con reembolso y pagos por verificar.
    path: 'ventas',
    loadComponent: () => import('./pages/ventas/ventas').then(m => m.Ventas),
  },
  {
    path: 'pos',
    loadComponent: () => import('./pages/pos/pos').then(m => m.PuntoDeVenta),
  },
  {
    // Arqueos de inventario: conteo a ciegas, doble conteo, fotos, revisión y ajuste.
    path: 'arqueos',
    loadComponent: () => import('./pages/arqueos/arqueos').then(m => m.Arqueos),
  },
  {
    // Traslados entre bodega y tiendas, con fotos de envío y recepción.
    path: 'traslados',
    loadComponent: () => import('./pages/traslados/traslados').then(m => m.Traslados),
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
    // Crear promociones y combos sin JSON. Hereda el permiso de /dashboard/tienda; crear exige
    // en el backend administrar la organización.
    path: 'ofertas',
    loadComponent: () => import('./pages/ofertas/ofertas').then(m => m.Ofertas),
  },
  {
    // Redimir códigos de servicios y bonos de EconomiAPP. Hereda el permiso de
    // /dashboard/tienda; el backend exige rol TENDERO sobre la tienda del código.
    path: 'redimir',
    loadComponent: () => import('./pages/redimir/redimir').then(m => m.Redimir),
  },
  {
    // Premios y puntos (ms-store V34): canjes por entregar, catálogo de premios y ajustes.
    // Hereda el permiso de /dashboard/tienda; el backend exige alcance de tienda para ver y
    // entregar, y administración para editar premios o ajustar puntos.
    path: 'premios',
    loadComponent: () => import('./pages/premios-admin/premios-admin').then(m => m.PremiosAdmin),
  },
  {
    // Publicidad de EconomiAPP (banners y destacados). Sin nodo propio en db_admin: hereda
    // el permiso de /dashboard/tienda, y el backend exige ADMIN_TIENDA o administración.
    path: 'publicidad',
    loadComponent: () => import('./pages/publicidad/publicidad').then(m => m.Publicidad),
  },
  {
    // Cargas masivas (fotos, catálogo, existencias). Hereda el permiso de /dashboard/tienda;
    // el backend exige administración de la organización.
    path: 'cargas',
    loadComponent: () => import('./pages/cargas/cargas').then(m => m.Cargas),
  },
  {
    path: 'pedidos',
    loadComponent: () => import('./pages/pedidos/pedidos').then(m => m.Pedidos),
  },
  {
    // Alistar un pedido línea por línea y sacar el sticker con QR de cada bulto. Hereda el
    // permiso de /dashboard/tienda; el backend exige acceso a la tienda del pedido.
    path: 'alistar/:id',
    loadComponent: () => import('./pages/alistar/alistar').then(m => m.Alistar),
  },
  {
    // Seguimiento de rutas de entrega (despacho). Hereda el permiso de /dashboard/tienda.
    path: 'rutas',
    loadComponent: () => import('./pages/rutas/rutas').then(m => m.Rutas),
  },
  {
    // La app del domiciliario (V148, nodo propio): bolsa de domicilios para escoger bajo
    // demanda, recoger escaneando los stickers, ruta con contacto (llamar, WhatsApp, navegar)
    // y entrega con acta. El backend exige rol de tienda DOMICILIARIO en la tienda del pedido.
    path: 'domicilios',
    loadComponent: () => import('./pages/domicilios/domicilios').then(m => m.Domicilios),
  },
  {
    // "Mi ruta" se volvió la pestaña Mi ruta de Domicilios. Sin nodo propio: hereda el
    // permiso de /dashboard/tienda y salta a la pantalla nueva.
    path: 'mi-ruta',
    canActivate: [() => inject(Router).parseUrl('/dashboard/tienda/domicilios?tab=ruta')],
    children: [],
  },
  {
    // Cola del alistador (V148, nodo propio): tomar, juntar, imprimir paquete y stickers.
    path: 'alistamiento',
    loadComponent: () => import('./pages/alistamiento/alistamiento').then(m => m.Alistamiento),
  },
  {
    // Entregar en el punto con acta: verificar a quien recibe, documento, papel firmado y firma.
    path: 'entregar/:id',
    loadComponent: () => import('./pages/entregar/entregar').then(m => m.Entregar),
  },
  {
    // Fiscal y contabilidad: libros de ventas y compras, IVA, margen y cola para FinCore.
    path: 'fiscal',
    loadComponent: () => import('./pages/fiscal/fiscal').then(m => m.Fiscal),
  },
  {
    // Compras y proveedores: importar facturas (XML DIAN, PDF, foto), emparejar con IA, recibir.
    path: 'compras',
    loadComponent: () => import('./pages/compras/compras').then(m => m.Compras),
  },
  {
    // Activos de oficina: inventario de equipos y su entrega verificada a personas.
    path: 'activos',
    loadComponent: () => import('./pages/activos/activos').then(m => m.Activos),
  },
  {
    // Custodia de las solicitudes de préstamo firmadas en papel.
    path: 'custodia',
    loadComponent: () => import('./pages/custodia/custodia').then(m => m.Custodia),
  },
  {
    // Medios de pago de cada tienda (Nequi, PSE, cuentas, link de pago). Hereda el permiso de
    // /dashboard/tienda; guardar exige ADMIN_TIENDA en el backend.
    path: 'medios-pago',
    loadComponent: () => import('./pages/medios-pago/medios-pago').then(m => m.MediosPago),
  },
  {
    // CRM de soporte de EconomiAPP. Hereda el permiso de /dashboard/tienda; el backend deja
    // a cada tienda sus tickets y los de plataforma solo al alcance total.
    path: 'soporte',
    loadComponent: () => import('./pages/soporte/soporte').then(m => m.Soporte),
  },
  {
    path: 'indicadores',
    loadComponent: () => import('./pages/indicadores/indicadores').then(m => m.Indicadores),
  },
  {
    // Logis: el análisis a fondo de las ventas (histórico de Logis + caja nueva). Nodo propio en
    // db_admin (ms-auth-admin V146), con los mismos permisos que Indicadores.
    path: 'logis',
    loadComponent: () => import('./pages/logis/logis').then(m => m.Logis),
  },
  {
    path: 'administracion',
    loadComponent: () => import('./pages/administracion/administracion').then(m => m.Administracion),
  },
];

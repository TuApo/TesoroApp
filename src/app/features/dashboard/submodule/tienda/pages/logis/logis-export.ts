/**
 * Qué trae el export de Logis (logis.com.co) de Flora Market / MercaFlor, entregado el
 * 11-oct-2026, y qué se hizo con cada archivo. Las cifras son las del archivo; las de la base
 * (lo que de verdad quedó cargado) las trae en vivo `GET /store/logis/datos`.
 */
export interface ArchivoExport {
  carpeta: string;
  archivo: string;
  contenido: string;
  registros: string;
  periodo?: string;
  estado: 'IMPORTADO' | 'PARCIAL' | 'DERIVADO' | 'NO_IMPORTADO' | 'INFORMATIVO';
  destino: string;
  nota?: string;
}

export const ARCHIVOS_EXPORT_LOGIS: ArchivoExport[] = [
  {
    carpeta: '01 · Productos', archivo: 'MercaFlor_productos_maestro.xlsx',
    contenido: 'Maestro de productos: código, nombre, familia, subfamilia, marca, IVA, precio, costo, existencia, códigos de barras, compuestos.',
    registros: '3.494 productos', estado: 'IMPORTADO',
    destino: 'Catálogo de la tienda (3.468 productos y 27 paquetes) con sus códigos de barras, internos y de Logis.',
    nota: 'Los productos que Logis vendía con existencia negativa (2.399) quedaron sin control de existencia.',
  },
  {
    carpeta: '02 · Catálogo', archivo: 'MercaFlor_catalogo_tienda.xlsx / .csv',
    contenido: 'Precio de venta, existencia por bodega, publicación y orden de vitrina.',
    registros: '3.477 productos de venta', estado: 'IMPORTADO',
    destino: 'Precios, saldo inicial (1.067 productos con existencia) y orden de vitrina en EconomiAPP.',
  },
  {
    carpeta: 'JSON', archivo: 'MercaFlor_logis_export.json',
    contenido: 'Volcado del API de Logis: productos de venta y compra, inventario, clientes, proveedores y catálogos (49 familias, 80 subfamilias, 142 marcas, 30 compuestos, 26 tipos de impuesto).',
    registros: '≈ 11 MB', estado: 'PARCIAL',
    destino: 'Taxonomía Departamento › Familia › Subfamilia, marcas y paquetes.',
    nota: 'Los clientes del JSON no se cargaron (ver abajo).',
  },
  {
    carpeta: '03 · Clientes y proveedores', archivo: 'MercaFlor_clientes.xlsx',
    contenido: 'Documento, nombre, teléfonos, correo, dirección, barrio, ciudad, fecha de nacimiento y cupo.',
    registros: '3.178 clientes', estado: 'NO_IMPORTADO',
    destino: '—',
    nota: 'A propósito: son datos personales que la tienda no necesita. Las ventas ya traen documento y nombre de quien compró, que es lo que usa este análisis.',
  },
  {
    carpeta: '03 · Clientes y proveedores', archivo: 'MercaFlor_proveedores.xlsx',
    contenido: 'Proveedores con documento, contacto y ciudad.', registros: '3 proveedores', estado: 'NO_IMPORTADO',
    destino: 'Se registran en Compras y proveedores al recibir la primera factura.',
  },
  {
    carpeta: '04 · Calidad', archivo: 'MercaFlor_reporte_calidad.xlsx',
    contenido: 'Revisión del maestro: 41 sin precio de venta, 333 con existencia negativa, 24 con IVA atípico, 66 códigos duplicados, 100 códigos de barras duplicados, 91 nombres duplicados, 26 nombres «separador», 156 sin código de barras, 3 con precio menor que el costo y 173 inactivos.',
    registros: '10 revisiones', estado: 'INFORMATIVO',
    destino: 'Sirvió para la importación: las barras repetidas quedaron como códigos compartidos (la caja pregunta cuál).',
  },
  {
    carpeta: '05 · Histórico de ventas', archivo: 'MercaFlor_ventas_documentos.xlsx',
    contenido: 'Cada factura y venta POS: número, fecha y hora, cliente, ítems, subtotal, IVA, descuento, total, pagado, saldo, estado, cajero y cierre de caja.',
    registros: '13.494 documentos', periodo: 'mar-2025 → oct-2026', estado: 'IMPORTADO',
    destino: 'Histórico de ventas (no mueve inventario ni entra a la caja ni a los libros fiscales).',
  },
  {
    carpeta: '05 · Histórico de ventas', archivo: 'MercaFlor_ventas_detalle_lineas.csv',
    contenido: 'Cada producto vendido: código, cantidad, precio, IVA, descuento, total y costo.',
    registros: '296.210 líneas', periodo: 'mar-2025 → oct-2026', estado: 'IMPORTADO',
    destino: 'Líneas del histórico, enlazadas al catálogo por el código de Logis.',
    nota: 'Logis no guardó el costo antes de marzo de 2026 (70 % de las líneas en cero): se reconstruye con los movimientos de inventario.',
  },
  {
    carpeta: '05 · Histórico de ventas', archivo: 'MercaFlor_pagos.xlsx',
    contenido: 'Pagos de cada documento: forma de pago, subcuenta, valor, recibido, cierre de caja y usuario.',
    registros: '14.247 pagos', estado: 'IMPORTADO',
    destino: 'Pagos del histórico, con la forma de pago llevada a los medios de la tienda (descuento ventas → nómina).',
    nota: 'Había códigos de barras escaneados en el campo del valor (un efectivo de $22 billones en el resumen): se corrigieron al cargar.',
  },
  {
    carpeta: '05 · Histórico de ventas', archivo: 'MercaFlor_resumen_ventas.xlsx',
    contenido: 'Resúmenes ya calculados por mes, por producto, por cliente y por forma de pago.',
    registros: '20 meses · 3.263 productos · 3.155 clientes', estado: 'DERIVADO',
    destino: 'Se recalcula desde el detalle (aquí). Sirvió para ordenar la vitrina por lo más vendido.',
  },
  {
    carpeta: '06 · Cartera y caja', archivo: 'MercaFlor_cuentas_por_cobrar.xlsx',
    contenido: 'Facturas con saldo pendiente.', registros: '129 documentos', estado: 'DERIVADO',
    destino: 'Sale del saldo de las facturas del histórico (pestaña Pagos y operación › Cartera).',
  },
  {
    carpeta: '06 · Cartera y caja', archivo: 'MercaFlor_caja.xlsx',
    contenido: 'Bases de caja diarias y comprobantes de egreso.', registros: '586 bases de caja · 1 egreso', estado: 'NO_IMPORTADO',
    destino: '—', nota: 'Solo trae la base con la que abría la caja cada día y un egreso de taxi: no aporta al análisis.',
  },
  {
    carpeta: '07 · Inventario', archivo: 'MercaFlor_movimientos_inventario_inicial.csv',
    contenido: 'Conteos y ajustes de existencia con su costo unitario de compra.',
    registros: '14.850 movimientos', periodo: 'mar-2025 → oct-2026', estado: 'IMPORTADO',
    destino: 'Movimientos históricos de inventario: de aquí sale el costo de las ventas viejas.',
    nota: '50 movimientos traen un código de barras escaneado en la cantidad (hasta 10⁴⁰ unidades): se guardan con cantidad 0 y la nota.',
  },
  {
    carpeta: 'Fotos', archivo: 'Fotos Merca Flor (≈ 1 GB)',
    contenido: 'Fotos de los productos.', registros: '2.822 fotos válidas', estado: 'IMPORTADO',
    destino: 'Fotos de 1.134 productos, cargadas por Cargas › Fotos y verificadas archivo por archivo.',
  },
];

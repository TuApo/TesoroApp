import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

/**
 * Cliente de ms-store.
 *
 * <p>El servidor devuelve snake_case (SPRING_JACKSON_PROPERTY_NAMING_STRATEGY del
 * contenedor), así que las interfaces de aquí lo respetan tal cual. Renombrar a camelCase
 * en el front obligaría a un mapeo en cada pantalla y, en cuanto uno se olvide, el campo
 * llega `undefined` sin que nada falle a la vista.
 */

export interface Alcance {
  super_admin: boolean;
  ve_todo: boolean;
  tiendas: TiendaResumen[];
  nodos: string[];
}

export interface TiendaResumen {
  id: string;
  negocio_id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  sede_id: string | null;
  direccion: string | null;
  municipio: string | null;
  telefono: string | null;
  latitud: number | null;
  longitud: number | null;
  permite_domicilio: boolean;
  permite_recogida: boolean;
  publicada_en_virtual: boolean;
  activa: boolean;
  rol_en_la_tienda: string | null;
}

export interface Negocio { id: string; codigo: string; nombre: string; nit?: string; activo: boolean; }

export interface Nivel {
  id: string; negocio_id: string | null; codigo: string; nombre: string;
  profundidad: number; contiene_tiendas: boolean; icono: string;
}

/** Nodo del árbol comercial, con sus hijos ya anidados. */
export interface NodoArbol {
  id: string; negocio_id: string | null; nivel_id: string; nivel_nombre: string;
  codigo: string; nombre: string; tienda_id: string | null;
  orden: number; activo: boolean; hijos: NodoArbol[];
}

export interface AlcanceUsuario {
  id: string; usuario_id: string; nodo_id: string | null;
  rol_tienda: string; ve_todo: boolean;
  vigente_desde: string | null; vigente_hasta: string | null;
}

export interface Producto {
  id: string; sku: string; codigo_barras: string | null; nombre: string;
  descripcion: string | null; marca: string | null; unidad: string;
  categoria_id: string | null; negocio_id: string | null; impuesto_pct: number; activo: boolean;
}

export interface ProductoEnTienda {
  id: string; sku: string; codigo_barras: string | null; nombre: string;
  descripcion: string | null; marca: string | null; unidad: string;
  categoria_id: string | null; global: boolean;
  precio: number | null; impuesto_pct: number;
  disponibilidad: 'EN_STOCK' | 'BAJO_PEDIDO' | 'NO_DISPONIBLE';
  existencias: number; dias_entrega: number | null; tienda_origen_id: string | null;
  imagen_principal_doc_id: string | null;
  variantes: unknown[];
}

export interface Stock {
  id: string; tienda_id: string; producto_id: string; variante_id: string | null;
  cantidad: number; cantidad_reservada: number; costo_promedio: number; actualizado_en: string;
}

export interface Movimiento {
  id: string; tienda_id: string; producto_id: string; tipo: string;
  cantidad: number; costo_unitario: number; saldo_despues: number;
  referencia_tipo: string | null; motivo: string | null;
  realizado_por_nombre: string | null; realizado_en: string;
}

export interface Venta {
  id: string; numero: string; tienda_id: string; estado: string; canal: string;
  cliente_cedula: string | null; cliente_nombre: string | null;
  subtotal: number; descuento_total: number; total: number; costo_total: number;
  confirmada_en: string | null;
}

export interface Pago {
  id: string; venta_id: string; metodo: string; monto: number;
  referencia: string | null; estado: string; evidencia_doc_id: string | null;
}

export interface Cupo {
  existe: boolean; nombre: string | null; bloqueado: boolean;
  observacion_bloqueo: string | null; activo: boolean;
  saldo_disponible: number | null; codigo: string | null; finca: string | null;
  tiene_foto: boolean | null; foto_url: string | null;
}

export interface Pedido {
  id: string; numero: string; tienda_id: string; cliente_cedula: string;
  cliente_nombre: string | null; estado: string; tipo_entrega: string;
  direccion_texto: string | null; bajo_pedido: boolean; fecha_estimada: string | null;
  total: number; creado_en: string; entregado_en: string | null;

  /**
   * La CITA. Distinta de `fecha_estimada`, que es cuándo la mercancía estará lista: un
   * pedido puede estar listo el martes y recogerse el viernes a las 4, que es cuando la
   * persona sale de turno.
   */
  programado_en: string | null;
  programado_hasta: string | null;
  /** TITULAR | TERCERO */
  reclama: string;
  /** NO_REQUERIDA | PENDIENTE | APROBADA | RECHAZADA | SOSPECHOSA */
  validacion_estado: string;
}

/**
 * El cupo tal como debe verlo el comprador.
 *
 * <p>`disponible` YA viene descontado de `comprometido` — lo calcula el motor de reglas de
 * tesorería, que es el único que ve también las autorizaciones hechas en el mostrador.
 * `comprometido` se muestra solo para explicar por qué le queda menos de lo que esperaba.
 */
export interface CupoMarketplace {
  existe: boolean; nombre: string | null; bloqueado: boolean;
  motivo_bloqueo: string | null; activo: boolean;
  disponible: number; comprometido: number;
  tope_aplicado: number | null; saldo_pendiente: number | null;
  advertencias: string[]; codigo: string | null; finca: string | null;
}

export interface InicioMarketplace {
  cedula: string;
  oficina: string | null;
  temporal: string | null;
  tienda_sugerida: string | null;
  tiendas: TiendaResumen[];
  /** true = su oficina no tiene tienda asignada y está viendo TODAS las publicadas. */
  sin_tienda_asignada: boolean;
  cupo: CupoMarketplace | null;
  /** Presente cuando tesorería no respondió. La tienda sigue abierta para pagar de otro modo. */
  cupo_error?: string | null;
}

/** El cupo apartado por un pedido. BLOQUEADO no es deuda todavía; EJECUTADO sí. */
export interface CupoBloqueado {
  id: string; pedido_id: string; cedula: string; monto: number; cuotas: number;
  estado: string; codigo_autorizacion: string | null; codigo_ejecucion: string | null;
  saldo_al_bloquear: number | null; error_mensaje: string | null;
  creado_en: string; ejecutado_en: string | null; liberado_en: string | null;
}

export interface TerceroReclamo {
  id: string; pedido_id: string; nombre: string; cedula: string;
  telefono: string | null; parentesco: string | null;
  rostro_doc_id: string | null;
  cedula_frente_doc_id: string | null; cedula_reverso_doc_id: string | null;
  estado: string; observacion: string | null; revisado_en: string | null;
}

export interface ValidacionReclamo {
  id: string; pedido_id: string; tercero_id: string | null;
  cedula_presentada: string; medio: string;
  /** APROBADA | RECHAZADA | SOSPECHOSA */
  resultado: string;
  comentario: string | null;
  foto_contratacion_doc_id: string | null; foto_validacion_doc_id: string | null;
  revisado_por_nombre: string | null; creado_en: string;
}

export interface EstadoPagoTemporal {
  id: string; pedido_id: string | null; venta_id: string | null; cedula: string;
  empresa: string | null; periodo: string | null;
  /** PENDIENTE | PAGADO | PARCIAL | INCONVENIENTE | ANULADO */
  estado: string;
  monto_aplicado: number | null; comentario: string | null;
  soporte_doc_id: string | null; creado_en: string; actualizado_en: string | null;
}

/** Un pedido con todo lo que el comprador quiere saber de él, sin más viajes. */
export interface PedidoDetallado {
  pedido: Pedido;
  cupo_bloqueado: CupoBloqueado | null;
  estado_pago_temporal: EstadoPagoTemporal | null;
  terceros: TerceroReclamo[];
}

/** Una línea del historial: un mercado suyo, del canal que sea. */
export interface MovimientoHistorial {
  origen: 'PEDIDO' | 'VENTA';
  id: string; numero: string; estado: string;
  fecha: string; total: number; tienda_id: string;
  cupo_estado: string | null;
  /** true = el descuento ya se aplicó de verdad, no solo se apartó cupo. */
  ejecutado: boolean;
  estado_pago_temporal: string | null;
  comentario_temporal: string | null;
}

export interface DocumentoPersona {
  cedula: string; document_id: number; nombre_archivo: string;
  tamano_bytes: number | null; type_id: number | null; type_name: string | null;
  periodo_clave: string | null; periodo_etiqueta: string | null; empresa: string | null;
}

export interface PedidoParaEntregar {
  id: string; numero: string; estado: string; tipo_entrega: string;
  programado_en: string | null; total: number;
  reclama: string; validacion_estado: string;
  tercero: TerceroReclamo | null;
}

/**
 * Lo que ve quien entrega al teclear una cédula.
 *
 * <p>`tiene_foto` en `null` NO es lo mismo que `false`: significa que no se pudo preguntar
 * a ms-hr. La pantalla tiene que distinguirlo, porque en un caso la persona no tiene foto
 * y en el otro el dato falta por un fallo.
 */
export interface Expediente {
  cedula: string; nombre: string | null;
  tiene_foto: boolean | null; foto_url: string | null; foto_doc_id: string | null;
  documentos: DocumentoPersona[];
  pedidos: PedidoParaEntregar[];
}

export interface TiendaOficina {
  id: string; tienda_id: string; oficina: string; principal: boolean; creado_en: string;
}

/**
 * Una persona vista desde el mostrador: contratación + tesorería + mercado, de una vez.
 * Antes esto eran tres pantallas distintas y un campo donde escribir la cédula de memoria.
 */
export interface PersonaTarjeta {
  cedula: string;
  nombre: string | null;
  empresa: string | null;
  centro_costo: string | null;
  oficina: string | null;
  numero_contrato: string | null;
  fecha_ingreso: string | null;
  en_tesoreria: boolean;
  bloqueado: boolean;
  observacion_bloqueo: string | null;
  activo: boolean;
  saldo_disponible: number;
  deuda: number;
  tiene_autorizacion_mercado: boolean;
  autorizaciones_pendientes: number;
  monto_autorizado: number;
  autorizaciones: Array<Record<string, unknown>>;
  puede_solicitar_mercado: boolean;
  motivo_no_puede: string | null;
  cupo_mercado_disponible: number;
  cupo_mercado_limite: number;
  dias_trabajados: number;
  tiene_foto: boolean | null;
  foto_url: string | null;
}

export interface ResumenKpi {
  ventas_cantidad?: number; ventas_total: number; costo_total?: number;
  margen_bruto?: number; margen_pct?: number; descuento_total?: number;
  ticket_promedio?: number; pagos_por_metodo?: Record<string, number>;
  credito_nomina?: number; valor_inventario?: number; productos_sin_stock?: number;
  rotacion?: number | null; sin_alcance?: boolean; sin_tiendas?: boolean; mensaje?: string;
}

export interface KpiDia {
  fecha: string; ventas_total: number; margen_bruto: number; ventas_cantidad: number;
  ticket_promedio: number; valor_inventario: number; pedidos_entregados: number;
}

@Injectable({ providedIn: 'root' })
export class TiendaService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/store`;

  // ── Alcance y organización ───────────────────────────────────────────────

  /** Lo primero que pide el módulo: quién soy y qué tiendas puedo tocar. */
  miAlcance(): Observable<Alcance> {
    return this.http.get<Alcance>(`${this.base}/tiendas/mi-alcance`);
  }

  tiendas(negocio?: string, nodo?: string): Observable<TiendaResumen[]> {
    let p = new HttpParams();
    if (negocio) p = p.set('negocio', negocio);
    if (nodo) p = p.set('nodo', nodo);
    return this.http.get<TiendaResumen[]>(`${this.base}/tiendas`, { params: p });
  }

  negocios(): Observable<Negocio[]> {
    return this.http.get<Negocio[]>(`${this.base}/organizacion/negocios`);
  }

  crearNegocio(cuerpo: { codigo: string; nombre: string; nit?: string }): Observable<Negocio> {
    return this.http.post<Negocio>(`${this.base}/organizacion/negocios`, cuerpo);
  }

  niveles(negocio?: string): Observable<Nivel[]> {
    let p = new HttpParams();
    if (negocio) p = p.set('negocio', negocio);
    return this.http.get<Nivel[]>(`${this.base}/organizacion/niveles`, { params: p });
  }

  crearNivel(cuerpo: {
    negocio_id?: string; codigo: string; nombre: string;
    profundidad: number; contiene_tiendas: boolean; icono?: string;
  }): Observable<Nivel> {
    return this.http.post<Nivel>(`${this.base}/organizacion/niveles`, cuerpo);
  }

  /** El árbol entero, ya recortado por el alcance de quien pregunta. */
  arbol(): Observable<NodoArbol[]> {
    return this.http.get<NodoArbol[]>(`${this.base}/organizacion/arbol`);
  }

  crearNodo(cuerpo: {
    negocio_id?: string; nivel_id: string; padre_id?: string;
    codigo: string; nombre: string; orden?: number;
  }): Observable<NodoArbol> {
    return this.http.post<NodoArbol>(`${this.base}/organizacion/nodos`, cuerpo);
  }

  /** Reorganizar: mover una rama entera. El alcance de la gente se mueve con ella. */
  moverNodo(id: string, nuevoPadreId: string): Observable<unknown> {
    return this.http.patch(`${this.base}/organizacion/nodos/${id}/mover`,
      { nuevo_padre_id: nuevoPadreId });
  }

  crearTienda(cuerpo: Record<string, unknown>): Observable<TiendaResumen> {
    return this.http.post<TiendaResumen>(`${this.base}/tiendas`, cuerpo);
  }

  configuracion(tiendaId: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.base}/tiendas/${tiendaId}/configuracion`);
  }

  guardarConfiguracion(tiendaId: string, cuerpo: Record<string, unknown>): Observable<unknown> {
    return this.http.put(`${this.base}/tiendas/${tiendaId}/configuracion`, cuerpo);
  }

  // ── Alcances de usuario ──────────────────────────────────────────────────

  alcances(usuario?: string, nodo?: string): Observable<AlcanceUsuario[]> {
    let p = new HttpParams();
    if (usuario) p = p.set('usuario', usuario);
    if (nodo) p = p.set('nodo', nodo);
    return this.http.get<AlcanceUsuario[]>(`${this.base}/alcances`, { params: p });
  }

  asignarAlcance(cuerpo: {
    usuario_id: string; nodo_id?: string; rol_tienda: string;
    ve_todo?: boolean; vigente_hasta?: string;
  }): Observable<AlcanceUsuario> {
    return this.http.post<AlcanceUsuario>(`${this.base}/alcances`, cuerpo);
  }

  retirarAlcance(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/alcances/${id}`);
  }

  rolesDeTienda(): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/alcances/roles`);
  }

  // ── Catálogo ─────────────────────────────────────────────────────────────

  categorias(negocio?: string): Observable<Array<Record<string, unknown>>> {
    let p = new HttpParams();
    if (negocio) p = p.set('negocio', negocio);
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/categorias`, { params: p });
  }

  crearCategoria(cuerpo: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/categorias`, cuerpo);
  }

  productos(opciones: {
    negocio?: string; categoria?: string; texto?: string; pagina?: number; tamano?: number;
  } = {}): Observable<{ content: Producto[]; total_elements: number; total_pages: number }> {
    let p = new HttpParams();
    if (opciones.negocio) p = p.set('negocio', opciones.negocio);
    if (opciones.categoria) p = p.set('categoria', opciones.categoria);
    if (opciones.texto) p = p.set('texto', opciones.texto);
    p = p.set('pagina', String(opciones.pagina ?? 0));
    p = p.set('tamano', String(opciones.tamano ?? 40));
    return this.http.get<{ content: Producto[]; total_elements: number; total_pages: number }>(
      `${this.base}/productos`, { params: p });
  }

  crearProducto(cuerpo: Record<string, unknown>): Observable<Producto> {
    return this.http.post<Producto>(`${this.base}/productos`, cuerpo);
  }

  fichaEnTienda(tiendaId: string, productoId: string): Observable<ProductoEnTienda> {
    return this.http.get<ProductoEnTienda>(`${this.base}/tiendas/${tiendaId}/productos/${productoId}`);
  }

  /** Lectura del lector de código de barras del POS. */
  porCodigoBarras(tiendaId: string, codigo: string): Observable<ProductoEnTienda> {
    return this.http.get<ProductoEnTienda>(
      `${this.base}/tiendas/${tiendaId}/productos/por-codigo/${encodeURIComponent(codigo)}`);
  }

  fijarPrecio(productoId: string, cuerpo: {
    precio: number; costo?: number; tienda_id?: string; variante_id?: string;
  }): Observable<unknown> {
    return this.http.post(`${this.base}/productos/${productoId}/precios`, cuerpo);
  }

  historicoPrecios(productoId: string): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/productos/${productoId}/precios`);
  }

  publicarEnTienda(productoId: string, cuerpo: Record<string, unknown>): Observable<unknown> {
    return this.http.put(`${this.base}/productos/${productoId}/publicacion`, cuerpo);
  }

  // ── Inventario ───────────────────────────────────────────────────────────

  stock(tiendaId: string): Observable<Stock[]> {
    return this.http.get<Stock[]>(`${this.base}/inventario/tiendas/${tiendaId}/stock`);
  }

  bajoMinimo(tiendaId: string): Observable<Stock[]> {
    return this.http.get<Stock[]>(`${this.base}/inventario/tiendas/${tiendaId}/bajo-minimo`);
  }

  kardex(tiendaId: string, producto?: string, pagina = 0, tamano = 50)
    : Observable<{ content: Movimiento[]; total_elements: number }> {
    let p = new HttpParams().set('pagina', String(pagina)).set('tamano', String(tamano));
    if (producto) p = p.set('producto', producto);
    return this.http.get<{ content: Movimiento[]; total_elements: number }>(
      `${this.base}/inventario/tiendas/${tiendaId}/kardex`, { params: p });
  }

  ajustar(tiendaId: string, cuerpo: {
    producto_id: string; variante_id?: string; tipo: string;
    cantidad: number; costo_unitario?: number; motivo: string;
  }): Observable<Movimiento> {
    return this.http.post<Movimiento>(`${this.base}/inventario/tiendas/${tiendaId}/ajustes`, cuerpo);
  }

  // ── Arqueo ───────────────────────────────────────────────────────────────

  arqueos(tienda: string): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/arqueos`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  abrirArqueo(cuerpo: {
    tienda_id: string; tipo?: string; congelar_ventas?: boolean; doble_conteo?: boolean;
  }): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(`${this.base}/arqueos`, cuerpo);
  }

  detalleArqueo(id: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.base}/arqueos/${id}`);
  }

  contarArqueo(itemId: string, cantidad: number, motivo?: string, fotoDocId?: string)
    : Observable<unknown> {
    return this.http.post(`${this.base}/arqueos/lineas/${itemId}/contar`,
      { cantidad, motivo, foto_doc_id: fotoDocId });
  }

  cerrarArqueo(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/arqueos/${id}/cerrar`, {});
  }

  // ── Punto de venta ───────────────────────────────────────────────────────

  ventas(tienda: string, pagina = 0, tamano = 30)
    : Observable<{ content: Venta[]; total_elements: number }> {
    const p = new HttpParams().set('tienda', tienda)
      .set('pagina', String(pagina)).set('tamano', String(tamano));
    return this.http.get<{ content: Venta[]; total_elements: number }>(`${this.base}/ventas`, { params: p });
  }

  abrirVenta(cuerpo: {
    tienda_id: string; turno_id?: string; cliente_cedula?: string;
    cliente_nombre?: string; canal?: string;
  }): Observable<Venta> {
    return this.http.post<Venta>(`${this.base}/ventas`, cuerpo);
  }

  detalleVenta(id: string): Observable<{
    venta: Venta; lineas: Array<Record<string, unknown>>; pagos: Pago[];
    cobrado: number; pendiente: number;
  }> {
    return this.http.get<{
      venta: Venta; lineas: Array<Record<string, unknown>>; pagos: Pago[];
      cobrado: number; pendiente: number;
    }>(`${this.base}/ventas/${id}`);
  }

  agregarLinea(ventaId: string, cuerpo: {
    producto_id: string; variante_id?: string; cantidad: number; descuento?: number;
  }): Observable<unknown> {
    return this.http.post(`${this.base}/ventas/${ventaId}/lineas`, cuerpo);
  }

  quitarLinea(lineaId: string): Observable<unknown> {
    return this.http.delete(`${this.base}/ventas/lineas/${lineaId}`);
  }

  agregarPago(ventaId: string, cuerpo: {
    metodo: string; monto: number; referencia?: string;
    evidencia_doc_id?: string; cuotas?: number;
  }): Observable<Pago> {
    return this.http.post<Pago>(`${this.base}/ventas/${ventaId}/pagos`, cuerpo);
  }

  confirmarVenta(ventaId: string): Observable<Venta> {
    return this.http.post<Venta>(`${this.base}/ventas/${ventaId}/confirmar`, {});
  }

  anularVenta(ventaId: string, motivo: string): Observable<unknown> {
    return this.http.post(`${this.base}/ventas/${ventaId}/anular`, { motivo });
  }

  /** Cupo, bloqueo y foto de contratación. Es lo que se mira antes de fiar. */
  cupo(cedula: string, tienda: string): Observable<Cupo> {
    return this.http.get<Cupo>(`${this.base}/ventas/cupo/${encodeURIComponent(cedula)}`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  verificarIdentidad(ventaId: string, resultado: string, observacion?: string): Observable<unknown> {
    return this.http.post(`${this.base}/ventas/${ventaId}/verificacion`, { resultado, observacion });
  }

  // ── Pedidos ──────────────────────────────────────────────────────────────

  pedidosPendientes(tienda?: string): Observable<Pedido[]> {
    let p = new HttpParams();
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<Pedido[]>(`${this.base}/gestion/pedidos`, { params: p });
  }

  detallePedido(id: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.base}/gestion/pedidos/${id}`);
  }

  confirmarPedido(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/pedidos/${id}/confirmar`, {});
  }

  cambiarEstadoPedido(id: string, estado: string, comentario?: string): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/pedidos/${id}/estado`, { estado, comentario });
  }

  rechazarPedido(id: string, motivo: string): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/pedidos/${id}/rechazar`, { motivo });
  }

  // ── Tienda virtual (vista del comprador) ─────────────────────────────────
  // La cédula NUNCA se manda: el servidor la toma del token. Si viajara como parámetro,
  // cualquiera podría leer los pedidos de otro cambiando un número en la URL.

  tiendasParaComprar(): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/tienda/tiendas`);
  }

  vitrina(tienda: string): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/tienda/vitrina`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  catalogoVirtual(tienda: string, texto?: string, pagina = 0)
    : Observable<{ articulos: Array<Record<string, unknown>>; total: number; total_paginas: number }> {
    let p = new HttpParams().set('tienda', tienda).set('pagina', String(pagina));
    if (texto) p = p.set('texto', texto);
    return this.http.get<{ articulos: Array<Record<string, unknown>>; total: number; total_paginas: number }>(
      `${this.base}/tienda/catalogo`, { params: p });
  }

  verCarrito(tienda: string): Observable<{ carrito: Record<string, unknown>; lineas: Array<Record<string, unknown>> }> {
    return this.http.get<{ carrito: Record<string, unknown>; lineas: Array<Record<string, unknown>> }>(
      `${this.base}/tienda/carrito`, { params: new HttpParams().set('tienda', tienda) });
  }

  agregarAlCarrito(cuerpo: {
    tienda_id: string; producto_id?: string; variante_id?: string; combo_id?: string; cantidad: number;
  }): Observable<unknown> {
    return this.http.post(`${this.base}/tienda/carrito`, cuerpo);
  }

  quitarDelCarrito(itemId: string): Observable<unknown> {
    return this.http.delete(`${this.base}/tienda/carrito/${itemId}`);
  }

  crearPedido(cuerpo: Record<string, unknown>): Observable<Pedido> {
    return this.http.post<Pedido>(`${this.base}/tienda/pedidos`, cuerpo);
  }

  misPedidos(): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(`${this.base}/tienda/pedidos`);
  }

  miPedido(id: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.base}/tienda/pedidos/${id}`);
  }

  cancelarMiPedido(id: string, motivo?: string): Observable<unknown> {
    return this.http.post(`${this.base}/tienda/pedidos/${id}/cancelar`, { motivo });
  }

  // ── Promociones y combos ─────────────────────────────────────────────────

  promociones(negocio: string): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/promociones`,
      { params: new HttpParams().set('negocio', negocio) });
  }

  promocionesVigentes(tienda: string): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/promociones/vigentes`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  crearPromocion(cuerpo: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/promociones`, cuerpo);
  }

  cambiarEstadoPromocion(id: string, activa: boolean): Observable<unknown> {
    return this.http.patch(`${this.base}/promociones/${id}/estado`, {},
      { params: new HttpParams().set('activa', String(activa)) });
  }

  combos(tienda: string): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/combos`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  crearCombo(cuerpo: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/combos`, cuerpo);
  }

  // ── Personas del mostrador ───────────────────────────────────────────────

  /** Buscador de contratados, ya cruzado con tesorería y con el estado de mercado. */
  buscarPersonas(q: string, tienda: string, limite = 6): Observable<PersonaTarjeta[]> {
    return this.http.get<PersonaTarjeta[]>(`${this.base}/personas/buscar`, {
      params: new HttpParams().set('q', q).set('tienda', tienda).set('limite', String(limite)),
    });
  }

  /** Ficha completa con foto de contratación, para verificar identidad. */
  personaDetalle(cedula: string, tienda: string): Observable<PersonaTarjeta> {
    return this.http.get<PersonaTarjeta>(
      `${this.base}/personas/${encodeURIComponent(cedula)}`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  /** Crea la autorización de mercado. Las reglas las valida el servidor. */
  autorizarMercado(cedula: string, tienda: string, cuerpo: {
    monto: number; cuotas?: number; identidad_verificada: boolean;
  }): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(
      `${this.base}/personas/${encodeURIComponent(cedula)}/autorizacion-mercado`, cuerpo,
      { params: new HttpParams().set('tienda', tienda) });
  }

  // ── Indicadores ──────────────────────────────────────────────────────────

  resumenKpi(opciones: { tienda?: string; nodo?: string; desde?: string; hasta?: string } = {})
    : Observable<ResumenKpi> {
    return this.http.get<ResumenKpi>(`${this.base}/kpi/resumen`, { params: this.rango(opciones) });
  }

  serieKpi(opciones: { tienda?: string; nodo?: string; desde?: string; hasta?: string } = {})
    : Observable<KpiDia[]> {
    return this.http.get<KpiDia[]>(`${this.base}/kpi/serie`, { params: this.rango(opciones) });
  }

  rankingKpi(opciones: { nodo?: string; desde?: string; hasta?: string } = {})
    : Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/kpi/ranking`,
      { params: this.rango(opciones) });
  }

  rentabilidad(opciones: { tienda?: string; nodo?: string; desde?: string; hasta?: string } = {})
    : Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/kpi/rentabilidad`,
      { params: this.rango(opciones) });
  }

  /** Lo que la gente buscó y no encontró: la lista de compras que hacen los compradores. */
  busquedasSinResultado(tienda: string, dias = 30): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/kpi/busquedas-sin-resultado`,
      { params: new HttpParams().set('tienda', tienda).set('dias', String(dias)) });
  }

  pagosPorVerificar(tienda: string): Observable<Pago[]> {
    return this.http.get<Pago[]>(`${this.base}/pagos/por-verificar`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  verificarPago(id: string, resultado: string, motivo?: string): Observable<unknown> {
    return this.http.post(`${this.base}/pagos/${id}/verificar`, { resultado, motivo });
  }

  // ── Marketplace del colaborador ──────────────────────────────────────────

  /** Su tienda y su cupo, en una sola llamada al abrir el módulo. */
  inicioMarketplace(): Observable<InicioMarketplace> {
    return this.http.get<InicioMarketplace>(`${this.base}/marketplace/inicio`);
  }

  /**
   * El cupo, opcionalmente evaluado contra un monto.
   *
   * <p>Este número ya viene descontado de lo que la persona tiene apartado en pedidos sin
   * recoger — lo calcula el motor de tesorería, no el front. Ojo con sumar o restar aquí:
   * es exactamente el error que haría que alguien comprometiera dos veces el mismo cupo.
   */
  miCupo(monto?: number, tienda?: string): Observable<CupoMarketplace> {
    let p = new HttpParams();
    if (monto != null) p = p.set('monto', String(monto));
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<CupoMarketplace>(`${this.base}/marketplace/cupo`, { params: p });
  }

  misPedidosDetallados(): Observable<PedidoDetallado[]> {
    return this.http.get<PedidoDetallado[]>(`${this.base}/marketplace/mis-pedidos`);
  }

  miPedidoDetallado(id: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.base}/marketplace/mis-pedidos/${id}`);
  }

  miHistorial(): Observable<MovimientoHistorial[]> {
    return this.http.get<MovimientoHistorial[]>(`${this.base}/marketplace/mi-historial`);
  }

  /** La cita de recogida o entrega. Va en ISO-8601 y en snake_case, como todo el módulo. */
  programarPedido(id: string, programadoEn: string, programadoHasta?: string): Observable<Pedido> {
    return this.http.post<Pedido>(`${this.base}/marketplace/mis-pedidos/${id}/programar`,
      { programado_en: programadoEn, programado_hasta: programadoHasta });
  }

  autorizarTercero(pedidoId: string, cuerpo: {
    nombre: string; cedula: string; telefono?: string; parentesco?: string;
    rostro_doc_id?: string; cedula_frente_doc_id?: string; cedula_reverso_doc_id?: string;
  }): Observable<TerceroReclamo> {
    return this.http.post<TerceroReclamo>(
      `${this.base}/marketplace/mis-pedidos/${pedidoId}/tercero`, cuerpo);
  }

  quitarTercero(pedidoId: string, terceroId: string): Observable<Pedido> {
    return this.http.delete<Pedido>(
      `${this.base}/marketplace/mis-pedidos/${pedidoId}/tercero/${terceroId}`);
  }

  // ── Punto de entrega ─────────────────────────────────────────────────────

  /** Lo que ve quien entrega al teclear una cédula. */
  expediente(cedula: string): Observable<Expediente> {
    return this.http.get<Expediente>(`${this.base}/entrega/expediente`,
      { params: new HttpParams().set('cedula', cedula) });
  }

  validarReclamo(pedidoId: string, cuerpo: {
    cedula_presentada: string; medio?: string; resultado: string;
    comentario?: string; tercero_id?: string;
  }): Observable<ValidacionReclamo> {
    return this.http.post<ValidacionReclamo>(
      `${this.base}/entrega/pedidos/${pedidoId}/validar`, cuerpo);
  }

  validacionesDe(pedidoId: string): Observable<ValidacionReclamo[]> {
    return this.http.get<ValidacionReclamo[]>(`${this.base}/entrega/pedidos/${pedidoId}/validaciones`);
  }

  validacionesSospechosas(): Observable<ValidacionReclamo[]> {
    return this.http.get<ValidacionReclamo[]>(`${this.base}/entrega/sospechosas`);
  }

  // ── Estado de pago por parte de la temporal ──────────────────────────────

  registrarEstadoPago(cuerpo: {
    pedido_id?: string; venta_id?: string; cedula?: string; empresa?: string;
    periodo?: string; estado: string; monto_aplicado?: number;
    comentario?: string; soporte_doc_id?: string;
  }): Observable<EstadoPagoTemporal> {
    return this.http.post<EstadoPagoTemporal>(`${this.base}/entrega/pagos-temporal`, cuerpo);
  }

  pagosConInconveniente(): Observable<EstadoPagoTemporal[]> {
    return this.http.get<EstadoPagoTemporal[]>(`${this.base}/entrega/pagos-temporal/inconvenientes`);
  }

  pagosDePersona(cedula: string): Observable<EstadoPagoTemporal[]> {
    return this.http.get<EstadoPagoTemporal[]>(`${this.base}/entrega/pagos-temporal/persona`,
      { params: new HttpParams().set('cedula', cedula) });
  }

  // ── Qué tienda surte a qué oficina ───────────────────────────────────────

  oficinasDeTienda(tiendaId: string): Observable<TiendaOficina[]> {
    return this.http.get<TiendaOficina[]>(`${this.base}/entrega/tiendas/${tiendaId}/oficinas`);
  }

  asignarOficina(tiendaId: string, oficina: string, principal = true): Observable<TiendaOficina> {
    return this.http.post<TiendaOficina>(`${this.base}/entrega/tiendas/${tiendaId}/oficinas`,
      { oficina, principal });
  }

  quitarOficina(tiendaId: string, oficina: string): Observable<unknown> {
    return this.http.delete(`${this.base}/entrega/tiendas/${tiendaId}/oficinas`,
      { params: new HttpParams().set('oficina', oficina) });
  }

  private rango(o: { tienda?: string; nodo?: string; desde?: string; hasta?: string }): HttpParams {
    let p = new HttpParams();
    if (o.tienda) p = p.set('tienda', o.tienda);
    if (o.nodo) p = p.set('nodo', o.nodo);
    if (o.desde) p = p.set('desde', o.desde);
    if (o.hasta) p = p.set('hasta', o.hasta);
    return p;
  }
}

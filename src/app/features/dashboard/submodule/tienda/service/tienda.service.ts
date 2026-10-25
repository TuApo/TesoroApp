import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
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
  /** Lo que cuesta el domicilio desde esta tienda (llega en /marketplace/inicio). */
  costo_domicilio?: number | null;
  horario_json?: string | null;
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
  tipo?: 'BIEN' | 'SERVICIO' | 'BONO'; dias_vigencia_reclamo?: number | null; instrucciones_reclamo?: string | null;
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
  confirmada_en: string | null; creado_en?: string;
  cliente_tipo?: 'COLABORADOR' | 'MOSTRADOR'; cliente_telefono?: string | null;
  etiqueta?: string | null; observacion?: string | null;
}

/** Línea de una venta tal como la devuelve el detalle. */
export interface LineaVenta {
  id: string; venta_id: string; producto_id: string | null; variante_id: string | null;
  descripcion: string; cantidad: number; precio_unitario: number; descuento: number;
  total: number; bajo_pedido?: boolean; dias_entrega?: number | null;
}

/** Venta abierta (sesión) de la caja. */
export interface VentaAbierta {
  id: string; numero: string; etiqueta: string | null; cliente_nombre: string | null;
  cliente_cedula: string | null; cliente_tipo: string; total: number; creado_en: string;
  vendedor_nombre: string | null; lineas: number; cobrado: number;
}

/** Producto en la caja: foto, precio y existencias (o bajo pedido con días). */
export interface ProductoCaja {
  id: string; sku: string; codigo_barras: string | null; nombre: string; marca: string | null;
  categoria_id: string | null; tipo: string; global: boolean; precio: number | null;
  estado: 'EN_STOCK' | 'BAJO_PEDIDO' | 'NO_DISPONIBLE'; existencias: number;
  dias_entrega: number | null; imagen: string | null; imagenes: string[];
  coincide_codigo?: boolean; ubicacion?: string | null; controla_stock?: boolean; compuesto?: boolean; unidad?: string;
  variantes: Array<{ id: string; nombre: string; sku: string; precio: number | null; estado: string; existencias: number; dias_entrega: number | null }>;
}

/** Cifras de la caja por rango de fechas. */
export interface ResumenCaja {
  desde: string; hasta: string;
  totales: { ventas: number; total: number; ticket_promedio: number; margen: number; descuentos: number;
    ventas_colaborador: number; ventas_mostrador: number; con_observacion: number };
  por_medio: Array<{ metodo: string; pagos: number; monto: number; por_verificar: number; vueltas: number }>;
  por_hora: Array<{ hora: number; ventas: number; total: number }>;
  por_vendedor: Array<{ vendedor: string; ventas: number; total: number }>;
  top_productos: Array<{ producto_id: string; descripcion: string; cantidad: number; total: number; bajo_pedido: number }>;
  bono: { pagos: number; monto: number; con_autorizacion: number };
  bajo_pedido: { ventas: number; monto: number };
  abiertas: number; anuladas: number;
}

export interface RegistroCaja {
  id: string; numero: string; estado: string; etiqueta: string | null; cliente_tipo: string;
  cliente_nombre: string | null; cliente_cedula: string | null; cliente_telefono: string | null;
  total: number; observacion: string | null; vendedor_nombre: string | null; creado_en: string;
  confirmada_en: string | null; medios: string | null; vueltas: number; por_verificar: number;
  soportes: number; lineas_bajo_pedido: number;
}

export interface Pago {
  id: string; venta_id: string; metodo: string; monto: number;
  referencia: string | null; estado: string; evidencia_doc_id: string | null;
  recibido?: number | null; cambio?: number | null;
  pasarela?: string | null; pasarela_ref?: string | null; pasarela_estado?: string | null; pasarela_url?: string | null;
  motivo_rechazo?: string | null;
}

export interface ImagenProducto { id: string; producto_id: string; doc_id: string; orden: number; principal: boolean }

export type ModoSubidaFoto = 'NORMAL' | 'MEJORA_BASICA' | 'IA';
export interface EstiloFoto { codigo: string; nombre: string; descripcion: string; prompt: string }
export interface ConfigFotos {
  modo_subida: ModoSubidaFoto; estilo: string; color_fondo: string | null; instrucciones_marca: string | null;
  angulos: string[]; requiere_aprobacion: boolean; modelo?: string; calidad: 'low' | 'medium' | 'high'; actualizado_por?: string | null;
  ia_configurada?: boolean; estilos?: EstiloFoto[]; angulos_disponibles?: string[];
}
export interface TrabajoFotoIa {
  id: string; producto_id: string; doc_origen: string; estilo: string; angulo: string; prompt: string;
  estado: 'PENDIENTE' | 'PROCESANDO' | 'LISTO' | 'ERROR' | 'APROBADO' | 'DESCARTADO';
  doc_resultado: string | null; error: string | null; creado_en: string; nombre?: string; sku?: string;
}

export interface VentaConSaldo {
  id: string; numero: string; cliente_nombre: string | null; cliente_cedula: string | null; estado: string;
  total: number; creado_en: string; pendiente: number; rechazado: number;
}

export interface PagoBandeja {
  id: string; venta_id: string; venta_numero: string; cliente_nombre: string | null; cliente_cedula: string | null;
  venta_estado: string; metodo: string; monto: number; referencia: string | null; evidencia_doc_id: string | null;
  estado: string; creado_en: string;
}

export interface DevolucionFila {
  id: string; numero: string; venta_id: string; venta_numero?: string; cliente_nombre?: string | null;
  motivo: string; total: number; estado: string; reversa_credito: boolean | number;
  reembolso_metodo?: string | null; error_mensaje?: string | null; creado_en: string;
}

export interface Cupo {
  existe: boolean; nombre: string | null; bloqueado: boolean;
  observacion_bloqueo: string | null; activo: boolean;
  saldo_disponible: number | null; codigo: string | null; finca: string | null;
  tiene_foto: boolean | null; foto_url: string | null;
}

export interface Pedido {
  id: string; numero: string; tienda_id: string; cliente_cedula: string;
  grupo_id?: string | null;
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

// ── Filtros de familia, asesor y listas ────────────────────────────────────

export interface PagoPedido {
  id: string; metodo: string; monto: number; referencia: string | null; comprobante_doc_id?: string | null; reportado_en?: string | null;
  estado: 'PREVISTO' | 'VERIFICADO' | 'RECHAZADO'; nota: string | null; origen: 'CLIENTE' | 'TIENDA';
  verificado_por_nombre: string | null; verificado_en: string | null; creado_en: string;
}
export interface RegistroPedidos {
  pedidos: Array<{
    id: string; numero: string; grupo: string | null; creado_en: string; confirmado_en: string | null; entregado_en: string | null;
    estado: string; tipo_entrega: string; cliente_cedula: string; cliente_nombre: string | null; cliente_telefono: string | null;
    total: number; metodo_pago_previsto: string | null; bajo_pedido: boolean; tienda: string; tienda_codigo: string; lineas: number;
    pagos: Array<{ metodo: string; monto: number; estado: string; referencia: string | null }>;
  }>;
  total: number; pagina: number;
  resumen: { pedidos: number; vendido: number; entregados: number; cancelados: number };
  por_metodo: Array<{ metodo: string; estado: string; partes: number; monto: number }>;
}

export interface SugerenciasBusqueda {
  categorias: Array<{ id: string; nombre: string; ruta: string; icono: string | null }>;
  marcas: Array<{ marca: string; productos: number }>;
  productos: Array<Pick<ArticuloComprador, 'id' | 'nombre' | 'marca' | 'precio' | 'precio_promo' | 'con_opciones' | 'imagen' | 'disponibilidad' | 'dias_entrega' | 'categoria_id'>>;
}
export interface FiltroFamilia { clave: string; nombre: string; valores: Array<{ valor: string; cantidad: number }>; }

export interface ConversacionResumen { id: string; titulo: string; actualizado_en: string; ultimo: string | null; }
export type BloqueAsesor =
  | { tipo: 'productos'; titulo?: string | null; productos: ArticuloComprador[] }
  | { tipo: 'comparacion'; productos: Array<ArticuloComprador & { ficha?: FichaTecnica | null; opciones: Array<{ id: string; nombre: string; precio: number }> }> }
  | { tipo: 'pedido'; pedido: Pedido; lineas: Array<{ descripcion: string; cantidad: number; total: number }> }
  | { tipo: 'lista'; lista: ListaDetalle }
  | { tipo: 'carrito' }
  | { tipo: 'ticket'; ticket: { id: string; numero: string; asunto: string; estado: string; area: string } };
export interface MensajeAsesor { id?: number | null; rol: 'USUARIO' | 'ASESOR'; contenido: string; creado_en?: string; bloques: BloqueAsesor[]; }
export interface ConversacionAsesor { id: string; titulo: string; mensajes: MensajeAsesor[]; }
export interface RespuestaAsesor { conversacion_id: string; titulo: string; mensaje: MensajeAsesor; carrito_cambio: boolean; }
export interface ListaResumen { id: string; nombre: string; nota: string | null; actualizado_en: string; items: number; }
export interface ListaDetalle {
  id: string; nombre: string; nota: string | null; total: number;
  items: Array<ArticuloComprador & { item_id: string; cantidad: number; nota: string | null; variante_nombre?: string; activo: boolean }>;
}

// ── Cargas masivas ─────────────────────────────────────────────────────────

export interface CodigoResuelto {
  codigo: string; producto_id: string | null; variante_id: string | null; sku: string | null;
  nombre: string | null; fotos: number; ambiguo: boolean; candidatos: string[];
}
export interface CategoriaResuelta { codigo: string; categoria_id?: string; nombre?: string; tiene_foto?: boolean; ambiguo: boolean; }
export interface FilaCatalogo {
  fila: number; codigo_producto: string | null; nombre_producto?: string | null; marca?: string | null;
  categoria?: string | null; tipo?: string | null; condicion?: string | null; origen?: string | null;
  garantia?: string | null; descripcion?: string | null; caracteristicas?: string | null; etiquetas?: string | null;
  vendedor?: string | null; negocio?: string | null; impuesto_pct?: number | null; sku_variante?: string | null;
  nombre_variante?: string | null; ram?: string | null; almacenamiento?: string | null; sim?: string | null;
  red?: string | null; costo?: number | null; precio?: number | null; precio_referencia?: number | null; activo?: string | null;
}
export interface ResultadoCargaCatalogo {
  filas: Array<{ fila: number; codigo: string; sku: string | null; accion: string; mensaje: string }>;
  productos: number; errores: number; categorias_nuevas: string[]; aplicado: boolean;
  creados?: number; actualizados?: number;
}

// ── Tipos del comprador (EconomiAPP) ─────────────────────────────────────

/** EN_STOCK = lo lleva hoy de su tienda · BAJO_PEDIDO = hay que traerlo (dias_entrega). */
export type Disponibilidad = 'EN_STOCK' | 'BAJO_PEDIDO' | 'NO_DISPONIBLE';

export interface CategoriaComprador {
  id: string; padre_id: string | null; codigo: string; nombre: string;
  icono: string | null; imagen: string | null;
  /** Texto de vitrina de la familia (portada y cabecera de la familia). */
  descripcion?: string | null;
  /** Filtros que aplican (propios o heredados) y los propios (null = hereda). */
  filtros?: string[];
  filtros_propios?: string[] | null;
  orden?: number;
}

/** Ficha técnica pública de un producto (lo interno no llega al comprador). */
export interface FichaTecnica {
  condicion?: string | null; origen?: string | null; garantia?: string | null; envio?: string | null;
  caracteristicas?: Array<{ nombre: string; valor: string }>;
  etiquetas?: string[];
  ficha_verificada?: boolean;
}

export interface ArticuloComprador {
  id: string; nombre: string; descripcion: string | null; marca: string | null;
  /** Puntos que gana una unidad (fijos del producto o por valor; doble en promoción). */
  puntos?: number;
  unidad: string | null; categoria_id: string | null; precio: number | null;
  disponibilidad: Disponibilidad; existencias: number; dias_entrega: number | null;
  /** Del catálogo común de la organización (celulares, tecnología…), no del surtido local. */
  es_global: boolean;
  imagen: string | null;
  /** BIEN se entrega; SERVICIO y BONO se activan con un código y se reclaman en la tienda. */
  tipo?: 'BIEN' | 'SERVICIO' | 'BONO';
  dias_vigencia_reclamo?: number | null;
  instrucciones_reclamo?: string | null;
  /** Catálogo de oficina: la tienda de la que sale este producto. */
  tienda_id?: string;
  tienda_nombre?: string;
  /** Aliado comercial que vende y despacha (catálogo global). */
  vendedor_id?: string;
  vendedor_nombre?: string;
  tiendas_con_existencias?: number;
  /** Precio con la promoción vigente (1 und, sin condiciones personales). Ausente si no hay. */
  precio_promo?: number | null;
  promo_etiqueta?: string | null;
  promocion_id?: string | null;
  /** Precio comercial típico en el mercado; solo llega si es mayor que el nuestro. */
  precio_referencia?: number | null;
  /** Tiene varias opciones (capacidad, SIM…): el precio es "desde" y se elige en la ficha. */
  con_opciones?: boolean;
  /** Si tiene una sola opción, cuál: la tarjeta la agrega directo. */
  variante_id?: string | null;
  /** Nuevo, Exhibición, Reacondicionado certificado (CPO)… */
  condicion?: string | null;
}

export interface VarianteComprador {
  id: string; nombre: string; atributos: string | null; precio: number | null;
  disponibilidad: Disponibilidad; existencias: number; dias_entrega: number | null;
  precio_referencia?: number | null;
}

export interface FichaProducto extends ArticuloComprador {
  ficha?: FichaTecnica | null;
  imagenes: string[];
  variantes: VarianteComprador[];
  tienda_origen_nombre: string | null;
}

export interface LineaCarritoDetallada extends ArticuloComprador {
  linea_id: string; producto_id: string; variante_id: string | null;
  cantidad: number; precio_unitario: number;
  /** Ya con el descuento que aplicará el pedido. */
  subtotal: number;
  descuento?: number; linea_promo?: string | null;
}

export interface CarritoPorTienda {
  tienda_id: string; tienda_nombre: string; lineas: number; subtotal: number;
  permite_domicilio: boolean; costo_domicilio: number | null;
}

export interface Activacion {
  id: string; pedido_id: string; tienda_id: string; producto_id: string; descripcion: string;
  tipo: 'SERVICIO' | 'BONO'; cantidad: number; valor: number; codigo: string;
  /** PENDIENTE | ACTIVA | REDIMIDA | VENCIDA | ANULADA */
  estado: string;
  activada_en: string | null; vence_en: string | null; redimida_en: string | null;
  redimida_por_nombre: string | null; reclamada_por_cedula: string | null; anulada_motivo: string | null;
}

export interface PedidoGrupo {
  id: string; numero: string; cliente_cedula: string; oficina: string | null;
  tipo_entrega: string; metodo_pago_previsto: string | null; total: number; creado_en: string;
}

/** Resultado de una verificación de identidad (rostro o presencial). */
export interface VerificacionResumen {
  id: string; resultado: string; aprueba: boolean; puntaje: number | null; umbral: number | null;
  via: string; creado_en: string; acta?: string;
}

export interface PromocionComprador {
  id: string; nombre: string; descripcion: string | null; tipo: string;
  valor: number | null; nxm_lleva: number | null; nxm_paga: number | null;
  vigente_hasta: string | null;
  media: Array<{ doc_id: string; tipo: string }>;
  articulos?: ArticuloComprador[];
}

export interface ComponenteKit extends ArticuloComprador { cantidad: number; opcional: boolean; }

export interface KitComprador {
  id: string; nombre: string; descripcion: string | null; imagen: string | null;
  componentes: ComponenteKit[]; total: number; completo: boolean; dias_entrega_max: number | null;
}

/** Zonas de publicidad de EconomiAPP y la medida EXACTA que exige cada una. */
export const ZONAS_PUBLICIDAD = {
  HOME_BANNER: { nombre: 'Carrusel principal', ancho: 1600, alto: 800, descripcion: 'Banner grande de la portada (2:1)' },
  DESTACADOS: { nombre: 'Tarjeta destacada', ancho: 800, alto: 800, descripcion: 'Tarjeta cuadrada en "Para usted" (1:1)' },
} as const;
export type ZonaPublicidad = keyof typeof ZONAS_PUBLICIDAD;

export interface PublicacionGestion extends PublicacionVitrina {
  activa: boolean; vigente_desde: string | null; vigente_hasta: string | null; creado_en: string;
}

export interface CarritoDetallado {
  carrito: Record<string, unknown>;
  lineas: Array<Record<string, unknown>>;
  detalle: LineaCarritoDetallada[];
  total: number;
  /** El pedido sale cuando llega lo último: si una línea es bajo pedido, manda ella. */
  dias_entrega_max: number | null;
}

export interface PublicacionVitrina {
  id: string; tienda_id: string | null; zona: string; titulo: string | null;
  subtitulo: string | null; imagen_doc_id: string | null;
  enlace_tipo: string; enlace_valor: string | null; orden: number;
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
  activaciones?: Activacion[];
  grupo?: PedidoGrupo | null;
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
  /** Tope que da tesorería (antigüedad o padrón) y lo ya comprometido. Solo en la ficha. */
  tope_tesoreria?: number | null;
  origen_tope?: 'AJUSTE_TIENDA' | 'TESORERIA' | 'LOCAL' | null;
  saldo_pendiente?: number | null;
  monto_comprometido?: number | null;
  tope_ajustado?: TopeAjustado | null;
  puede_ajustar_tope?: boolean;
}

export interface TopeAjustado {
  id: string; tope: number; tope_tesoreria: number | null; motivo: string;
  vigente_hasta: string | null; activo: boolean; ajustado_por: string | null;
  ajustado_por_cedula: string | null; creado_en: string;
}

export interface ResumenKpi {
  ventas_cantidad?: number; ventas_total: number; costo_total?: number;
  margen_bruto?: number; margen_pct?: number; costo_estimado_pct?: number; descuento_total?: number;
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

  /** Foto, descripción, icono, orden y padre de una familia. Lo que no se manda no cambia. */
  editarCategoria(id: string, cuerpo: {
    nombre?: string; descripcion?: string; icono?: string; imagen_doc_id?: string;
    quitar_imagen?: boolean; orden?: number; activa?: boolean; padre_id?: string;
    /** Claves de filtro; [] = heredar de la familia padre. */
    filtros?: string[];
  }): Observable<Record<string, unknown>> {
    return this.http.put<Record<string, unknown>>(`${this.base}/categorias/${id}`, cuerpo);
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

  cambiarTipoProducto(id: string, cuerpo: { tipo: string; dias_vigencia_reclamo?: number | null; instrucciones_reclamo?: string | null }): Observable<Producto> {
    return this.http.put<Producto>(`${this.base}/productos/${id}/tipo`, cuerpo);
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
    /** Precio comercial en el mercado; sin él se conserva el que ya tenía. */
    precio_referencia?: number;
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
  revisionArqueo(id: string): Observable<unknown> { return this.http.post(`${this.base}/arqueos/${id}/revision`, {}); }
  resolverArqueo(itemId: string, cantidadFinal: number, motivo: string): Observable<unknown> {
    return this.http.post(`${this.base}/arqueos/lineas/${itemId}/resolver`, { cantidad_final: cantidadFinal, motivo });
  }
  anularArqueo(id: string, motivo: string): Observable<unknown> { return this.http.post(`${this.base}/arqueos/${id}/anular`, { motivo }); }

  // ── Traslados entre tiendas y bodegas ──
  traslados(tienda: string, modo: 'salientes' | 'entrantes' | 'pendientes'): Observable<TrasladoFila[]> {
    let p = new HttpParams().set('tienda', tienda);
    if (modo === 'entrantes') p = p.set('entrantes', 'true');
    if (modo === 'pendientes') p = p.set('pendientes', 'true');
    return this.http.get<TrasladoFila[]>(`${this.base}/traslados`, { params: p });
  }
  detalleTraslado(id: string): Observable<{ traslado: TrasladoFila; lineas: TrasladoLinea[]; nombres?: Record<string, string>; variantes?: Record<string, string> }> { return this.http.get<any>(`${this.base}/traslados/${id}`); }
  crearTraslado(c: { origen_tienda_id: string; destino_tienda_id: string; lineas: { producto_id: string; variante_id?: string | null; cantidad: number }[]; observacion?: string | null }): Observable<TrasladoFila> {
    return this.http.post<TrasladoFila>(`${this.base}/traslados`, c);
  }
  enviarTraslado(id: string): Observable<TrasladoFila> { return this.http.post<TrasladoFila>(`${this.base}/traslados/${id}/enviar`, {}); }
  recibirTraslado(id: string, recibidas: Record<string, number>): Observable<TrasladoFila> { return this.http.post<TrasladoFila>(`${this.base}/traslados/${id}/recibir`, { recibidas }); }
  anularTraslado(id: string, motivo: string): Observable<TrasladoFila> { return this.http.post<TrasladoFila>(`${this.base}/traslados/${id}/anular`, { motivo }); }

  // ── Punto de venta ───────────────────────────────────────────────────────

  ventas(tienda: string, pagina = 0, tamano = 30)
    : Observable<{ content: Venta[]; total_elements: number }> {
    const p = new HttpParams().set('tienda', tienda)
      .set('pagina', String(pagina)).set('tamano', String(tamano));
    return this.http.get<{ content: Venta[]; total_elements: number }>(`${this.base}/ventas`, { params: p });
  }

  abrirVenta(cuerpo: {
    tienda_id: string; turno_id?: string; cliente_cedula?: string;
    cliente_nombre?: string; canal?: string; cliente_tipo?: 'COLABORADOR' | 'MOSTRADOR';
    cliente_telefono?: string; etiqueta?: string;
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
    evidencia_doc_id?: string; cuotas?: number; recibido?: number; codigo_autorizacion?: string;
  }): Observable<Pago> {
    return this.http.post<Pago>(`${this.base}/ventas/${ventaId}/pagos`, cuerpo);
  }

  // ── Códigos de barras y compuestos ──────────────────────────────────────
  producto(id: string): Observable<Producto> {
    return this.http.get<Producto>(`${this.base}/productos/${id}`);
  }
  codigosProducto(id: string): Observable<CodigoProducto[]> {
    return this.http.get<CodigoProducto[]>(`${this.base}/productos/${id}/codigos`);
  }
  agregarCodigo(id: string, cuerpo: { codigo: string; tipo?: string; principal?: boolean }): Observable<CodigoProducto> {
    return this.http.post<CodigoProducto>(`${this.base}/productos/${id}/codigos`, cuerpo);
  }
  quitarCodigo(id: string, codigoId: string): Observable<unknown> {
    return this.http.delete(`${this.base}/productos/${id}/codigos/${codigoId}`);
  }
  generarCodigo(id: string): Observable<CodigoProducto> {
    return this.http.post<CodigoProducto>(`${this.base}/productos/${id}/codigos/generar`, {});
  }
  generarCodigosFaltantes(ids: string[]): Observable<{ generados: number }> {
    return this.http.post<{ generados: number }>(`${this.base}/productos/codigos/generar-faltantes`, ids);
  }
  productosPorCodigo(codigo: string): Observable<Producto[]> {
    return this.http.get<Producto[]>(`${this.base}/productos/por-codigo/${encodeURIComponent(codigo)}`);
  }
  componentesProducto(id: string): Observable<ComponenteProducto[]> {
    return this.http.get<ComponenteProducto[]>(`${this.base}/productos/${id}/componentes`);
  }
  fijarComponentes(id: string, componentes: Array<{ componente_id: string; cantidad: number }>): Observable<ComponenteProducto[]> {
    return this.http.put<ComponenteProducto[]>(`${this.base}/productos/${id}/componentes`, { componentes });
  }

  // ── Importación desde Logis ─────────────────────────────────────────────
  importarLogis(form: FormData): Observable<InformeImportacion> {
    return this.http.post<InformeImportacion>(`${this.base}/cargas/importaciones/logis`, form);
  }
  estadoImportacion(id: string): Observable<InformeImportacion> {
    return this.http.get<InformeImportacion>(`${this.base}/cargas/importaciones/${id}`);
  }
  historialImportaciones(negocio?: string): Observable<Array<Record<string, unknown>>> {
    let p = new HttpParams(); if (negocio) p = p.set('negocio', negocio);
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/cargas/importaciones`, { params: p });
  }

  mediosCaja(tienda: string): Observable<MediosCaja> {
    return this.http.get<MediosCaja>(`${this.base}/ventas/medios-caja`, { params: new HttpParams().set('tienda', tienda) });
  }

  /** Crea el cobro en la pasarela: devuelve el enlace de pago que la persona abre con el QR. */
  cobroPasarela(ventaId: string, metodo: string, monto: number): Observable<CobroPasarela> {
    return this.http.post<CobroPasarela>(`${this.base}/ventas/${ventaId}/cobro-pasarela`, { metodo, monto });
  }

  consultarPasarela(pagoId: string): Observable<Pago> {
    return this.http.get<Pago>(`${this.base}/ventas/pagos/${pagoId}/pasarela`);
  }

  cancelarPasarela(pagoId: string): Observable<unknown> {
    return this.http.post(`${this.base}/ventas/pagos/${pagoId}/pasarela/cancelar`, {});
  }

  configPasarela(tienda: string): Observable<ConfigPasarela> {
    return this.http.get<ConfigPasarela>(`${this.base}/gestion/tiendas/${tienda}/pasarela`);
  }

  guardarPasarela(tienda: string, cuerpo: Record<string, unknown>): Observable<ConfigPasarela> {
    return this.http.put<ConfigPasarela>(`${this.base}/gestion/tiendas/${tienda}/pasarela`, cuerpo);
  }

  probarPasarela(tienda: string): Observable<{ ok: boolean; nombre_comercio: string | null }> {
    return this.http.post<{ ok: boolean; nombre_comercio: string | null }>(`${this.base}/gestion/tiendas/${tienda}/pasarela/probar`, {});
  }

  quitarPago(pagoId: string): Observable<unknown> {
    return this.http.delete(`${this.base}/ventas/pagos/${pagoId}`);
  }

  cambiarCantidadLinea(lineaId: string, cantidad: number): Observable<unknown> {
    return this.http.patch(`${this.base}/ventas/lineas/${lineaId}`, { cantidad });
  }

  /** Etiqueta de la sesión, observación y datos del cliente de una venta. */
  actualizarVenta(ventaId: string, cambios: {
    etiqueta?: string | null; observacion?: string | null; cliente_nombre?: string | null;
    cliente_cedula?: string | null; cliente_telefono?: string | null; cliente_tipo?: string;
  }): Observable<Venta> {
    return this.http.patch<Venta>(`${this.base}/ventas/${ventaId}`, cambios);
  }

  ventasAbiertas(tienda: string): Observable<VentaAbierta[]> {
    return this.http.get<VentaAbierta[]>(`${this.base}/ventas/abiertas`, { params: new HttpParams().set('tienda', tienda) });
  }

  catalogoCaja(tienda: string, texto: string, pagina = 0, tamano = 24, categoria?: string)
    : Observable<{ items: ProductoCaja[]; total: number; pagina: number; paginas: number }> {
    let p = new HttpParams().set('tienda', tienda).set('pagina', pagina).set('tamano', tamano);
    if (texto) p = p.set('texto', texto);
    if (categoria) p = p.set('categoria', categoria);
    return this.http.get<{ items: ProductoCaja[]; total: number; pagina: number; paginas: number }>(
      `${this.base}/ventas/catalogo`, { params: p });
  }

  resumenCaja(tienda: string, desde?: string, hasta?: string): Observable<ResumenCaja> {
    let p = new HttpParams().set('tienda', tienda);
    if (desde) p = p.set('desde', desde);
    if (hasta) p = p.set('hasta', hasta);
    return this.http.get<ResumenCaja>(`${this.base}/ventas/resumen`, { params: p });
  }

  registroCaja(tienda: string, desde?: string, hasta?: string): Observable<RegistroCaja[]> {
    let p = new HttpParams().set('tienda', tienda);
    if (desde) p = p.set('desde', desde);
    if (hasta) p = p.set('hasta', hasta);
    return this.http.get<RegistroCaja[]>(`${this.base}/ventas/registro`, { params: p });
  }

  /** Foto principal de varios productos: {producto_id: doc_id}. */
  imagenesPrincipales(ids: string[]): Observable<Record<string, string>> {
    const unicos = [...new Set(ids.filter(Boolean))].slice(0, 500);
    if (!unicos.length) return of({});
    return this.http.get<Record<string, string>>(`${this.base}/productos/imagenes-principales`,
      { params: new HttpParams().set('ids', unicos.join(',')) });
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

  cambiarEstadoPedido(id: string, estado: string, comentario?: string, efectivoRecibido = false): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/pedidos/${id}/estado`, { estado, comentario, efectivo_recibido: efectivoRecibido });
  }

  /** La tienda verifica (o rechaza) una parte del pago contra su extracto o el bono. */
  verificarPagoPedido(id: string, pagoId: string, cuerpo: { estado: 'VERIFICADO' | 'RECHAZADO' | 'PREVISTO'; referencia?: string; nota?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/pedidos/${id}/pagos/${pagoId}/verificar`, cuerpo);
  }

  /** Un pago que no estaba en el plan (la diferencia en efectivo, otro bono). */
  agregarPagoPedido(id: string, cuerpo: { metodo: string; monto: number; referencia?: string; verificado?: boolean }): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/pedidos/${id}/pagos`, cuerpo);
  }

  /** Registro de TODOS los pedidos con su desglose de pago y totales por método. */
  registroPedidos(filtro: { tienda?: string; desde?: string; hasta?: string; estado?: string; metodo?: string; q?: string; pagina?: number; tamano?: number }): Observable<RegistroPedidos> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(filtro)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return this.http.get<RegistroPedidos>(`${this.base}/gestion/pedidos/registro`, { params: p });
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

  // ── EconomiAPP (comprador) ───────────────────────────────────────────────

  /** Categorías que puede recorrer el comprador en esa tienda (sin exigir alcance). */
  categoriasComprador(tienda: string): Observable<CategoriaComprador[]> {
    return this.http.get<CategoriaComprador[]>(`${this.base}/tienda/categorias`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  catalogoComprador(tienda: string, filtro: { texto?: string; categoria?: string; f?: string; pagina?: number; tamano?: number } = {})
    : Observable<{ articulos: ArticuloComprador[]; pagina: number; total: number; total_paginas: number }> {
    let p = new HttpParams().set('tienda', tienda)
      .set('pagina', String(filtro.pagina ?? 0)).set('tamano', String(filtro.tamano ?? 24));
    if (filtro.texto) p = p.set('texto', filtro.texto);
    if (filtro.categoria) p = p.set('categoria', filtro.categoria);
    if (filtro.f) p = p.set('f', filtro.f);
    return this.http.get<{ articulos: ArticuloComprador[]; pagina: number; total: number; total_paginas: number }>(
      `${this.base}/tienda/catalogo`, { params: p });
  }

  fichaProducto(id: string, tienda: string): Observable<FichaProducto> {
    return this.http.get<FichaProducto>(`${this.base}/tienda/productos/${id}`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  carritoDetallado(tienda: string): Observable<CarritoDetallado> {
    return this.http.get<CarritoDetallado>(`${this.base}/tienda/carrito`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  /** Fija la cantidad de una línea. Cero la quita. */
  cambiarCantidadCarrito(itemId: string, cantidad: number): Observable<unknown> {
    return this.http.patch(`${this.base}/tienda/carrito/${itemId}`, { cantidad });
  }

  vitrinaComprador(tienda: string): Observable<PublicacionVitrina[]> {
    return this.http.get<PublicacionVitrina[]>(`${this.base}/tienda/vitrina`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  promocionesComprador(tienda: string): Observable<PromocionComprador[]> {
    return this.http.get<PromocionComprador[]>(`${this.base}/tienda/promociones`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  promocionComprador(id: string, tienda: string): Observable<PromocionComprador> {
    return this.http.get<PromocionComprador>(`${this.base}/tienda/promociones/${id}`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  combosComprador(tienda: string): Observable<KitComprador[]> {
    return this.http.get<KitComprador[]>(`${this.base}/tienda/combos`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  comboComprador(id: string, tienda: string): Observable<KitComprador> {
    return this.http.get<KitComprador>(`${this.base}/tienda/combos/${id}`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  // ── Publicidad (operador) ────────────────────────────────────────────────

  /** Sin tienda = la publicidad GLOBAL (solo administración). */
  publicaciones(tienda?: string | null): Observable<PublicacionGestion[]> {
    let p = new HttpParams();
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<PublicacionGestion[]>(`${this.base}/gestion/publicaciones`, { params: p });
  }

  crearPublicacion(cuerpo: {
    tienda_id: string | null; zona: string; titulo?: string | null; subtitulo?: string | null;
    imagen_doc_id: string; enlace_tipo: string; enlace_valor?: string | null; orden?: number;
    vigente_desde?: string | null; vigente_hasta?: string | null;
  }): Observable<PublicacionGestion> {
    return this.http.post<PublicacionGestion>(`${this.base}/gestion/publicaciones`, cuerpo);
  }

  retirarPublicacion(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/gestion/publicaciones/${id}`);
  }

  // ── EconomiAPP por oficina ───────────────────────────────────────────────

  catalogoMulti(tiendas: string[], filtro: { texto?: string; categoria?: string; f?: string; pagina?: number; tamano?: number } = {})
    : Observable<{ articulos: ArticuloComprador[]; pagina: number; total: number; total_paginas: number }> {
    let p = new HttpParams().set('tiendas', tiendas.join(','))
      .set('pagina', String(filtro.pagina ?? 0)).set('tamano', String(filtro.tamano ?? 36));
    if (filtro.texto) p = p.set('texto', filtro.texto);
    if (filtro.categoria) p = p.set('categoria', filtro.categoria);
    if (filtro.f) p = p.set('f', filtro.f);
    return this.http.get<{ articulos: ArticuloComprador[]; pagina: number; total: number; total_paginas: number }>(
      `${this.base}/tienda/catalogo-multi`, { params: p });
  }

  carritosMulti(tiendas: string[]): Observable<CarritoDetallado & { por_tienda: CarritoPorTienda[] }> {
    return this.http.get<CarritoDetallado & { por_tienda: CarritoPorTienda[] }>(`${this.base}/tienda/carritos`,
      { params: new HttpParams().set('tiendas', tiendas.join(',')) });
  }

  crearPedidoOficina(cuerpo: Record<string, unknown>): Observable<{ grupo: PedidoGrupo; pedidos: Pedido[] }> {
    return this.http.post<{ grupo: PedidoGrupo; pedidos: Pedido[] }>(`${this.base}/tienda/pedidos-oficina`, cuerpo);
  }

  grupo(id: string): Observable<{ grupo: PedidoGrupo; pedidos: Pedido[] }> {
    return this.http.get<{ grupo: PedidoGrupo; pedidos: Pedido[] }>(`${this.base}/marketplace/grupos/${id}`);
  }

  misActivaciones(): Observable<Activacion[]> {
    return this.http.get<Activacion[]>(`${this.base}/marketplace/mis-activaciones`);
  }

  /** Selfie del titular contra su foto de contratación (con consentimiento). */
  verificarTitular(foto: Blob, vivacidad: string, consentimiento: { version: string; sha256: string }): Observable<VerificacionResumen> {
    const fd = new FormData();
    fd.append('muestra', foto, 'selfie.jpg');
    fd.append('vivacidad', vivacidad);
    fd.append('consentimiento_version', consentimiento.version);
    fd.append('consentimiento_sha256', consentimiento.sha256);
    return this.http.post<VerificacionResumen>(`${this.base}/marketplace/verificar-titular`, fd);
  }

  autorizarTerceroVerificado(pedidoId: string, datos: {
    nombre: string; cedula: string; telefono?: string; parentesco?: string; verificacion_id: string;
    consentimiento_version: string; consentimiento_sha256: string;
    rostro: Blob; cedula_frente: Blob; cedula_reverso: Blob;
  }): Observable<TerceroReclamo[]> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(datos)) {
      if (v == null || v === '') continue;
      if (v instanceof Blob) fd.append(k, v, `${k}.jpg`); else fd.append(k, String(v));
    }
    return this.http.post<TerceroReclamo[]>(`${this.base}/marketplace/mis-pedidos/${pedidoId}/tercero-verificado`, fd);
  }

  // ── Mostrador: verificación y redención ──────────────────────────────────

  verificarRostroPedido(pedidoId: string, foto: Blob, vivacidad: string, terceroId: string | null,
                        consentimiento: { version: string; sha256: string }): Observable<VerificacionResumen> {
    const fd = new FormData();
    fd.append('muestra', foto, 'reclama.jpg');
    fd.append('vivacidad', vivacidad);
    if (terceroId) fd.append('tercero_id', terceroId);
    fd.append('consentimiento_version', consentimiento.version);
    fd.append('consentimiento_sha256', consentimiento.sha256);
    return this.http.post<VerificacionResumen>(`${this.base}/entrega/pedidos/${pedidoId}/verificar-rostro`, fd);
  }

  consultarCodigo(codigo: string): Observable<{ activacion: Activacion; pedido: Pedido; terceros: TerceroReclamo[]; vencida: boolean }> {
    return this.http.get<{ activacion: Activacion; pedido: Pedido; terceros: TerceroReclamo[]; vencida: boolean }>(
      `${this.base}/entrega/activaciones/${encodeURIComponent(codigo)}`);
  }

  verificarCodigo(codigo: string, foto: Blob, vivacidad: string, terceroId: string | null,
                  consentimiento: { version: string; sha256: string }): Observable<VerificacionResumen> {
    const fd = new FormData();
    fd.append('muestra', foto, 'reclama.jpg');
    fd.append('vivacidad', vivacidad);
    if (terceroId) fd.append('tercero_id', terceroId);
    fd.append('consentimiento_version', consentimiento.version);
    fd.append('consentimiento_sha256', consentimiento.sha256);
    return this.http.post<VerificacionResumen>(`${this.base}/entrega/activaciones/${encodeURIComponent(codigo)}/verificar`, fd);
  }

  verificarCodigoPresencial(codigo: string, cuerpo: { cedula_presentada: string; tercero_id: string | null; comentario: string })
    : Observable<VerificacionResumen> {
    return this.http.post<VerificacionResumen>(
      `${this.base}/entrega/activaciones/${encodeURIComponent(codigo)}/verificar-presencial`, cuerpo);
  }

  redimirCodigo(codigo: string, verificacionId: string): Observable<{ activacion: Activacion; pedido_cerrado: boolean }> {
    return this.http.post<{ activacion: Activacion; pedido_cerrado: boolean }>(
      `${this.base}/entrega/activaciones/${encodeURIComponent(codigo)}/redimir`, { verificacion_id: verificacionId });
  }

  verificarTraza(): Observable<{ integra: boolean; eslabones: number; primer_eslabon_roto: number | null; detalle: string }> {
    return this.http.get<{ integra: boolean; eslabones: number; primer_eslabon_roto: number | null; detalle: string }>(
      `${this.base}/entrega/traza/verificar`);
  }

  registrarEventoComprador(cuerpo: { tienda_id: string; tipo: string; referencia_id?: string; termino?: string; dispositivo?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/tienda/eventos`, cuerpo);
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

  crearPromocion(cuerpo: Record<string, unknown>): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/promociones`, cuerpo);
  }

  cambiarEstadoPromocion(id: string, activa: boolean): Observable<unknown> {
    return this.http.patch(`${this.base}/promociones/${id}/estado`, {},
      { params: new HttpParams().set('activa', String(activa)) });
  }

  combos(tienda: string): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${this.base}/combos`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  crearCombo(cuerpo: Record<string, unknown>): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/combos`, cuerpo);
  }

  publicarCombo(id: string, cuerpo: { tienda_id: string; publicado: boolean; precio_override?: number | null }): Observable<unknown> {
    return this.http.put(`${this.base}/combos/${id}/publicacion`, cuerpo);
  }

  /** Sube un archivo a gestión documental y devuelve su id (fotos de combos, banners de promoción). */
  subirArchivo(archivo: Blob, nombre: string, duenoId: string, tipoDueno: string): Observable<string> {
    const fd = new FormData();
    // Gestión documental VERSIONA por (dueño, tipo): con el mismo dueño, la segunda foto
    // reemplaza a la primera como versión nueva del mismo documento. Cada archivo lleva su
    // propio dueño (máx. 40 caracteres) para quedar como documento aparte; el dueño real
    // queda en la entidad que guarda el id (producto, combo, promoción).
    void duenoId;
    fd.append('ownerId', crypto.randomUUID());
    fd.append('typeCode', 'FORMULARIO_ADJUNTO');
    fd.append('ownerType', tipoDueno);
    fd.append('sourceService', 'tienda');
    fd.append('file', archivo, nombre);
    return this.http.post<{ document_id?: number | string }>(`${environment.apiUrl}/api/v1/documents/upload-by-owner`, fd)
      .pipe(map(r => {
        if (r?.document_id == null) throw new Error('Gestión documental no confirmó la subida');
        return String(r.document_id);
      }));
  }

  /** Sugerencias del buscador mientras se escribe: familias, marcas y productos. */
  sugerencias(tienda: string, q: string): Observable<SugerenciasBusqueda> {
    return this.http.get<SugerenciasBusqueda>(`${this.base}/tienda/sugerencias`, { params: new HttpParams().set('tienda', tienda).set('q', q) });
  }

  /** Filtros que se pueden asignar a una familia: clave → nombre visible. */
  filtrosDisponibles(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.base}/categorias/filtros-disponibles`);
  }

  /** Valores de los filtros de una familia (marcas, capacidades…) con cuántos productos tiene cada uno. */
  // ── Puntos y premios ─────────────────────────────────────────────────────

  misPuntos(): Observable<ResumenPuntos> {
    return this.http.get<ResumenPuntos>(`${this.base}/tienda/puntos`);
  }

  /** El ingreso del día: suma una vez por día (y el bono de racha cada 7 días seguidos). */
  ingresoDiario(nombre?: string | null): Observable<IngresoDiario> {
    return this.http.post<IngresoDiario>(`${this.base}/tienda/puntos/ingreso`, { nombre: nombre || null });
  }

  premiosComprador(tienda: string | null): Observable<PremioPuntos[]> {
    let p = new HttpParams();
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<PremioPuntos[]>(`${this.base}/tienda/premios`, { params: p });
  }

  canjearPremio(id: string, tienda: string, nombre?: string | null): Observable<CanjePuntos> {
    return this.http.post<CanjePuntos>(`${this.base}/tienda/premios/${id}/canjear`, { tienda_id: tienda, nombre: nombre || null });
  }

  misCanjes(): Observable<CanjePuntos[]> {
    return this.http.get<CanjePuntos[]>(`${this.base}/tienda/canjes`);
  }

  cancelarCanje(id: string): Observable<CanjePuntos> {
    return this.http.post<CanjePuntos>(`${this.base}/tienda/canjes/${id}/cancelar`, {});
  }

  canjePorCodigo(codigo: string): Observable<CanjePuntos> {
    return this.http.get<CanjePuntos>(`${this.base}/gestion/canjes/codigo/${encodeURIComponent(codigo.trim())}`);
  }

  entregarCanje(codigo: string, cuerpo: { canal: 'MOSTRADOR' | 'CAJA'; tienda_id?: string | null; venta_id?: string | null; cedula_presentada?: string | null }): Observable<CanjePuntos> {
    return this.http.post<CanjePuntos>(`${this.base}/gestion/canjes/codigo/${encodeURIComponent(codigo.trim())}/entregar`, cuerpo);
  }

  canjesPendientes(cedula: string, tienda?: string | null): Observable<CanjePuntos[]> {
    let p = new HttpParams().set('cedula', cedula);
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<CanjePuntos[]>(`${this.base}/gestion/canjes/pendientes`, { params: p });
  }

  canjesDeTienda(tienda: string, estado?: string): Observable<CanjePuntos[]> {
    let p = new HttpParams().set('tienda', tienda);
    if (estado) p = p.set('estado', estado);
    return this.http.get<CanjePuntos[]>(`${this.base}/gestion/canjes`, { params: p });
  }

  puntosDePersona(cedula: string): Observable<ResumenPuntos> {
    return this.http.get<ResumenPuntos>(`${this.base}/gestion/puntos/${encodeURIComponent(cedula)}`);
  }

  premiosAdmin(): Observable<Array<PremioPuntos & { activo: boolean | number; por_entregar: number; entregados: number; negocio_nombre: string | null }>> {
    return this.http.get<Array<PremioPuntos & { activo: boolean | number; por_entregar: number; entregados: number; negocio_nombre: string | null }>>(`${this.base}/gestion/premios`);
  }

  guardarPremio(id: string | null, cuerpo: Record<string, unknown>): Observable<PremioPuntos> {
    return id ? this.http.put<PremioPuntos>(`${this.base}/gestion/premios/${id}`, cuerpo)
      : this.http.post<PremioPuntos>(`${this.base}/gestion/premios`, cuerpo);
  }

  ajustarPuntos(cedula: string, puntos: number, motivo: string): Observable<ResumenPuntos> {
    return this.http.post<ResumenPuntos>(`${this.base}/gestion/puntos/ajuste`, { cedula, puntos, motivo });
  }

  puntosDeProducto(productoId: string, puntos: number | null): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${this.base}/productos/${productoId}/puntos`, { puntos });
  }

  // ── Ruleta diaria y minijuegos ──

  estadoRuleta(tienda?: string | null): Observable<EstadoRuleta> {
    let p = new HttpParams();
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<EstadoRuleta>(`${this.base}/tienda/ruleta`, { params: p });
  }

  girarRuleta(tienda: string | null, nombre?: string | null): Observable<GiroRuleta> {
    return this.http.post<GiroRuleta>(`${this.base}/tienda/ruleta/girar`, { tienda_id: tienda, nombre: nombre || null });
  }

  juegos(): Observable<ResumenJuegos> {
    return this.http.get<ResumenJuegos>(`${this.base}/tienda/juegos`);
  }

  historialJuegos(): Observable<HistorialJuegos> {
    return this.http.get<HistorialJuegos>(`${this.base}/tienda/juegos/historial`);
  }

  rankingJuego(codigo: string, semana?: string | null): Observable<RankingJuego> {
    let p = new HttpParams();
    if (semana) p = p.set('semana', semana);
    return this.http.get<RankingJuego>(`${this.base}/tienda/juegos/${codigo}/ranking`, { params: p });
  }

  iniciarPartida(codigo: string, tienda: string | null, nombre?: string | null): Observable<PartidaIniciada> {
    return this.http.post<PartidaIniciada>(`${this.base}/tienda/juegos/${codigo}/partidas`, { tienda_id: tienda, nombre: nombre || null });
  }

  terminarPartida(id: string, puntaje: number, detalle?: string): Observable<ResultadoPartida> {
    return this.http.post<ResultadoPartida>(`${this.base}/tienda/juegos/partidas/${id}/terminar`, { puntaje, detalle: detalle ?? null });
  }

  juegosAdmin(): Observable<JuegosAdmin> {
    return this.http.get<JuegosAdmin>(`${this.base}/gestion/juegos`);
  }

  elegirTorneo(juego: string): Observable<JuegosAdmin> {
    return this.http.put<JuegosAdmin>(`${this.base}/gestion/juegos/torneo`, { juego });
  }

  editarOpcionRuleta(id: string, cuerpo: { peso?: number; activo?: boolean; etiqueta?: string; color?: string }): Observable<JuegosAdmin['ruleta']> {
    return this.http.put<JuegosAdmin['ruleta']>(`${this.base}/gestion/ruleta/opciones/${id}`, cuerpo);
  }

  cerrarTorneos(): Observable<unknown[]> {
    return this.http.post<unknown[]>(`${this.base}/gestion/juegos/cerrar`, {});
  }

  filtrosComprador(tienda: string, categoria?: string): Observable<FiltroFamilia[]> {
    let p = new HttpParams().set('tienda', tienda);
    if (categoria) p = p.set('categoria', categoria);
    return this.http.get<FiltroFamilia[]>(`${this.base}/tienda/filtros`, { params: p });
  }

  // ── Asesor de EconomiAPP y listas ────────────────────────────────────────

  asesorEstado(): Observable<{ disponible: boolean; medios?: boolean }> {
    return this.http.get<{ disponible: boolean }>(`${this.base}/tienda/asesor/estado`);
  }
  asesorConversaciones(): Observable<ConversacionResumen[]> {
    return this.http.get<ConversacionResumen[]>(`${this.base}/tienda/asesor/conversaciones`);
  }
  asesorConversacion(id: string, tienda: string): Observable<ConversacionAsesor> {
    return this.http.get<ConversacionAsesor>(`${this.base}/tienda/asesor/conversaciones/${id}`, { params: new HttpParams().set('tienda', tienda) });
  }
  /** Nota de voz, foto, PDF o texto: MatIA lo lee y devuelve lo que entendió. */
  asesorAdjunto(archivo: Blob, nombre: string): Observable<{ tipo: 'AUDIO' | 'IMAGEN' | 'DOCUMENTO' | 'TEXTO'; nombre: string; texto: string }> {
    const fd = new FormData();
    fd.append('archivo', archivo, nombre);
    return this.http.post<{ tipo: 'AUDIO' | 'IMAGEN' | 'DOCUMENTO' | 'TEXTO'; nombre: string; texto: string }>(`${this.base}/tienda/asesor/adjuntos`, fd);
  }

  /** La respuesta de MatIA en voz (MP3). */
  asesorVoz(texto: string): Observable<Blob> {
    return this.http.post(`${this.base}/tienda/asesor/voz`, { texto }, { responseType: 'blob' });
  }

  asesorEnviar(cuerpo: { conversacion_id?: string | null; tienda_id: string; texto: string }): Observable<RespuestaAsesor> {
    return this.http.post<RespuestaAsesor>(`${this.base}/tienda/asesor/mensajes`, cuerpo);
  }
  asesorRenombrar(id: string, titulo: string): Observable<unknown> {
    return this.http.patch(`${this.base}/tienda/asesor/conversaciones/${id}`, { titulo });
  }
  asesorArchivar(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/tienda/asesor/conversaciones/${id}`);
  }
  misListas(): Observable<ListaResumen[]> {
    return this.http.get<ListaResumen[]>(`${this.base}/tienda/listas`);
  }
  lista(id: string, tienda: string): Observable<ListaDetalle> {
    return this.http.get<ListaDetalle>(`${this.base}/tienda/listas/${id}`, { params: new HttpParams().set('tienda', tienda) });
  }
  crearLista(nombre: string, items: Array<{ producto_id: string; variante_id?: string | null; cantidad?: number }> = []): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/tienda/listas`, { nombre, items });
  }
  agregarALista(id: string, item: { producto_id: string; variante_id?: string | null; cantidad?: number }): Observable<unknown> {
    return this.http.post(`${this.base}/tienda/listas/${id}/items`, item);
  }
  cambiarItemLista(id: string, itemId: string, cantidad: number): Observable<unknown> {
    return this.http.patch(`${this.base}/tienda/listas/${id}/items/${itemId}`, { cantidad });
  }
  renombrarLista(id: string, nombre: string): Observable<unknown> {
    return this.http.patch(`${this.base}/tienda/listas/${id}`, { nombre });
  }
  borrarLista(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/tienda/listas/${id}`);
  }
  listaAlCarrito(id: string, tienda: string): Observable<{ agregados: number; saltados: string[] }> {
    return this.http.post<{ agregados: number; saltados: string[] }>(`${this.base}/tienda/listas/${id}/al-carrito`, { tienda_id: tienda });
  }

  // ── Cargas masivas ───────────────────────────────────────────────────────

  /** Qué producto (y opción) es cada código de archivo: SKU o id del catálogo del proveedor. */
  resolverCodigos(codigos: string[]): Observable<CodigoResuelto[]> {
    return this.http.post<CodigoResuelto[]>(`${this.base}/cargas/resolver`, { codigos });
  }

  resolverCategorias(codigos: string[]): Observable<CategoriaResuelta[]> {
    return this.http.post<CategoriaResuelta[]>(`${this.base}/cargas/resolver-categorias`, { codigos });
  }

  /** Vincula fotos ya subidas a un producto, en orden; la primera queda de principal. */
  imagenesProducto(productoId: string): Observable<ImagenProducto[]> {
    return this.http.get<ImagenProducto[]>(`${this.base}/productos/${productoId}/imagenes`);
  }

  quitarImagenProducto(productoId: string, imagenId: string): Observable<ImagenProducto[]> {
    return this.http.delete<ImagenProducto[]>(`${this.base}/productos/${productoId}/imagenes/${imagenId}`);
  }

  principalImagenProducto(productoId: string, imagenId: string): Observable<ImagenProducto[]> {
    return this.http.post<ImagenProducto[]>(`${this.base}/productos/${productoId}/imagenes/${imagenId}/principal`, {});
  }

  fijarFotosProducto(productoId: string, docIds: string[], reemplazar: boolean): Observable<{ agregadas: number; total: number }> {
    return this.http.post<{ agregadas: number; total: number }>(`${this.base}/cargas/fotos/${productoId}`, { doc_ids: docIds, reemplazar });
  }

  // ── Fotos con IA ─────────────────────────────────────────────────────────

  configFotos(tiendaId: string): Observable<ConfigFotos> {
    return this.http.get<ConfigFotos>(`${this.base}/gestion/tiendas/${tiendaId}/config-fotos`);
  }

  guardarConfigFotos(tiendaId: string, c: Partial<ConfigFotos>): Observable<ConfigFotos> {
    return this.http.put<ConfigFotos>(`${this.base}/gestion/tiendas/${tiendaId}/config-fotos`, c);
  }

  promptFotoIa(tiendaId: string | null, estilo: string, angulo: string, extra?: string): Observable<{ prompt: string }> {
    let params = new HttpParams().set('estilo', estilo).set('angulo', angulo);
    if (tiendaId) params = params.set('tienda', tiendaId);
    if (extra) params = params.set('extra', extra);
    return this.http.get<{ prompt: string }>(`${this.base}/fotos-ia/prompt`, { params });
  }

  solicitarFotosIa(productoId: string, c: { tienda_id: string | null; doc_origen?: string | null; estilos: string[]; angulos: string[]; extra?: string; prompt?: string }): Observable<TrabajoFotoIa[]> {
    return this.http.post<TrabajoFotoIa[]>(`${this.base}/productos/${productoId}/fotos-ia`, c);
  }

  trabajosFotoIa(productoId: string): Observable<TrabajoFotoIa[]> {
    return this.http.get<TrabajoFotoIa[]>(`${this.base}/productos/${productoId}/fotos-ia`);
  }

  loteFotosIa(tiendaId: string | null, productoIds: string[]): Observable<{ trabajos: number; sin_foto: number; ia_configurada: boolean }> {
    return this.http.post<{ trabajos: number; sin_foto: number; ia_configurada: boolean }>(`${this.base}/fotos-ia/lote`, { tienda_id: tiendaId, producto_ids: productoIds });
  }

  revisionFotosIa(tiendaId: string | null): Observable<TrabajoFotoIa[]> {
    const params = tiendaId ? new HttpParams().set('tienda', tiendaId) : undefined;
    return this.http.get<TrabajoFotoIa[]>(`${this.base}/fotos-ia/revision`, { params });
  }

  aprobarFotoIa(id: string, principal: boolean): Observable<unknown> {
    return this.http.post(`${this.base}/fotos-ia/${id}/aprobar`, {}, { params: new HttpParams().set('principal', principal) });
  }

  descartarFotoIa(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/fotos-ia/${id}/descartar`, {});
  }

  reintentarFotosIa(tiendaId: string | null): Observable<{ reintentados: number }> {
    const params = tiendaId ? new HttpParams().set('tienda', tiendaId) : undefined;
    return this.http.post<{ reintentados: number }>(`${this.base}/fotos-ia/reintentar`, {}, { params });
  }

  /** Sin aplicar solo valida; con aplicar guarda todo o nada. */
  cargarCatalogo(filas: FilaCatalogo[], aplicar: boolean): Observable<ResultadoCargaCatalogo> {
    return this.http.post<ResultadoCargaCatalogo>(`${this.base}/cargas/catalogo`, { filas, aplicar });
  }

  agregarMediaPromocion(id: string, cuerpo: { doc_id: string; tipo?: string; orden?: number }): Observable<unknown> {
    return this.http.post(`${this.base}/promociones/${id}/media`, cuerpo);
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
    foto_doc_id?: string; observacion?: string;
  }): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(
      `${this.base}/personas/${encodeURIComponent(cedula)}/autorizacion-mercado`, cuerpo,
      { params: new HttpParams().set('tienda', tienda) });
  }

  /** Ajusta (o quita, con tope null) el tope de mercado de la persona. Solo ADMIN/GERENCIA. */
  ajustarTope(cedula: string, tienda: string, cuerpo: { tope: number | null; motivo: string; vigente_hasta?: string | null })
    : Observable<Record<string, unknown>> {
    return this.http.put<Record<string, unknown>>(`${this.base}/personas/${encodeURIComponent(cedula)}/tope`, cuerpo,
      { params: new HttpParams().set('tienda', tienda) });
  }

  historiaTopes(cedula: string, tienda: string): Observable<TopeAjustado[]> {
    return this.http.get<TopeAjustado[]>(`${this.base}/personas/${encodeURIComponent(cedula)}/topes`,
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

  // ── Logis (análisis a fondo: histórico de Logis + caja nueva) ────────────

  /**
   * Un recurso del análisis de Logis (`resumen`, `serie`, `proyeccion`, `productos`, `categorias`,
   * `clientes`, `patrones`, `canasta`, `operacion`, `reabastecimiento`, `datos`). Todo llega
   * agregado del servidor; los parámetros extra (grano, orden, límite, días) van en `extra`.
   */
  logis<T = any>(recurso: string, opciones: { tienda?: string; nodo?: string; desde?: string; hasta?: string } = {},
                 extra: Record<string, string | number> = {}): Observable<T> {
    let params = this.rango(opciones);
    for (const [k, v] of Object.entries(extra)) params = params.set(k, String(v));
    return this.http.get<T>(`${this.base}/logis/${recurso}`, { params });
  }

  /** Rehace el costo estimado de las ventas viejas de Logis de una tienda. */
  recalcularCostosLogis(tienda: string): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(`${this.base}/logis/costos/recalcular`, null,
      { params: new HttpParams().set('tienda', tienda) });
  }

  pagosPorVerificar(tienda: string): Observable<Pago[]> {
    return this.http.get<Pago[]>(`${this.base}/pagos/por-verificar`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  ventasConSaldo(tienda: string): Observable<VentaConSaldo[]> {
    return this.http.get<VentaConSaldo[]>(`${this.base}/ventas/con-saldo`, { params: new HttpParams().set('tienda', tienda) });
  }

  /** Cobra lo que falta de una venta confirmada (p. ej. tras un pago rechazado). */
  cobrarSaldo(ventaId: string, cuerpo: { metodo: string; monto: number; referencia?: string | null }): Observable<Pago> {
    return this.http.post<Pago>(`${this.base}/ventas/${ventaId}/saldo`, cuerpo);
  }

  minimos(tienda: string): Observable<{ producto_id: string; stock_min: number; stock_max: number | null }[]> {
    return this.http.get<{ producto_id: string; stock_min: number; stock_max: number | null }[]>(`${this.base}/inventario/tiendas/${tienda}/minimos`);
  }

  fijarMinimo(tienda: string, cuerpo: { producto_id: string; stock_min: number; stock_max?: number | null }): Observable<unknown> {
    return this.http.put(`${this.base}/inventario/tiendas/${tienda}/minimos`, cuerpo);
  }

  /** Bandeja de conciliación con la venta y el cliente de cada pago. */
  bandejaPagos(tienda: string): Observable<PagoBandeja[]> {
    return this.http.get<PagoBandeja[]>(`${this.base}/pagos/por-verificar/bandeja`,
      { params: new HttpParams().set('tienda', tienda) });
  }

  devolucionesTienda(tienda: string): Observable<{ devoluciones: DevolucionFila[] }> {
    return this.http.get<{ devoluciones: DevolucionFila[] }>(`${this.base}/devoluciones`, { params: new HttpParams().set('tienda', tienda) });
  }

  devolucionesVenta(venta: string): Observable<{ devoluciones: DevolucionFila[] }> {
    return this.http.get<{ devoluciones: DevolucionFila[] }>(`${this.base}/devoluciones`, { params: new HttpParams().set('venta', venta) });
  }

  registrarDevolucion(cuerpo: {
    venta_id: string; motivo: string; reembolso_metodo: string;
    lineas: { venta_item_id: string; cantidad: number; destino: string; observacion?: string | null }[];
  }): Observable<DevolucionFila> {
    return this.http.post<DevolucionFila>(`${this.base}/devoluciones`, cuerpo);
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

  // ── Soporte (bandeja del equipo) ──

  ticketsSoporte(f: { tienda?: string; estado?: string; area?: string; prioridad?: string; q?: string; mios?: boolean; pagina?: number }): Observable<BandejaSoporte> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '' && v !== false) p = p.set(k, String(v));
    return this.http.get<BandejaSoporte>(`${this.base}/gestion/soporte/tickets`, { params: p });
  }
  ticketSoporte(id: string): Observable<TicketDetalle> {
    return this.http.get<TicketDetalle>(`${this.base}/gestion/soporte/tickets/${id}`);
  }
  responderTicket(id: string, texto: string, interno: boolean): Observable<TicketDetalle> {
    return this.http.post<TicketDetalle>(`${this.base}/gestion/soporte/tickets/${id}/mensajes`, { texto, interno });
  }
  cambiarTicket(id: string, cambio: { estado?: string; prioridad?: string; area?: string; asignarme?: boolean }): Observable<TicketDetalle> {
    return this.http.patch<TicketDetalle>(`${this.base}/gestion/soporte/tickets/${id}`, cambio);
  }
  areasSoporte(): Observable<Record<string, string[]>> {
    return this.http.get<Record<string, string[]>>(`${this.base}/tienda/soporte/areas`);
  }

  // ── Evidencias (varias fotos por cosa: gasto, ajuste, conteo, traslado) ──

  evidencias(entidadTipo: string, entidadId: string): Observable<Evidencia[]> {
    return this.http.get<Evidencia[]>(`${this.base}/inventario/evidencias`, { params: { entidadTipo, entidadId } });
  }
  adjuntarEvidencia(e: { entidad_tipo: string; entidad_id: string; doc_id: string; tipo?: string; comentario?: string | null }): Observable<Evidencia> {
    return this.http.post<Evidencia>(`${this.base}/inventario/evidencias`, { tipo: 'FOTO', ...e });
  }

  // ── Caja: turnos, movimientos de efectivo y cuadre ──

  cajasDeTienda(tienda: string): Observable<{ id: string; nombre: string; activa: boolean }[]> {
    return this.http.get<{ id: string; nombre: string; activa: boolean }[]>(`${this.base}/cajas`, { params: { tienda } });
  }
  crearCaja(tiendaId: string, nombre: string): Observable<{ id: string; nombre: string }> { return this.http.post<{ id: string; nombre: string }>(`${this.base}/cajas`, { tienda_id: tiendaId, nombre }); }
  turnosCaja(tienda: string, soloAbiertos = false): Observable<TurnoCajaFila[]> {
    return this.http.get<TurnoCajaFila[]>(`${this.base}/cajas/turnos`, { params: { tienda, soloAbiertos: String(soloAbiertos) } });
  }
  abrirTurnoCaja(cajaId: string, baseInicial: number): Observable<TurnoCajaFila> { return this.http.post<TurnoCajaFila>(`${this.base}/cajas/turnos`, { caja_id: cajaId, base_inicial: baseInicial }); }
  cuadreTurno(id: string): Observable<CuadreTurno> { return this.http.get<CuadreTurno>(`${this.base}/cajas/turnos/${id}/cuadre`); }
  movimientoCaja(id: string, m: { tipo: string; concepto: string; monto: number; referencia?: string | null }): Observable<MovimientoCaja> {
    return this.http.post<MovimientoCaja>(`${this.base}/cajas/turnos/${id}/movimientos`, m);
  }
  cerrarTurnoCaja(id: string, c: { declarado: Record<string, number>; observacion: string | null; conteo: Record<string, number> }): Observable<TurnoCajaFila> {
    return this.http.post<TurnoCajaFila>(`${this.base}/cajas/turnos/${id}/cerrar`, c);
  }

  // ── Fiscal y contabilidad ──

  private paramsFiscal(f: { tienda?: string; desde?: string; hasta?: string; estado?: string }): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) p = p.set(k, String(v));
    return p;
  }
  resumenFiscal(f: { tienda?: string; desde?: string; hasta?: string }): Observable<ResumenFiscal> {
    return this.http.get<ResumenFiscal>(`${this.base}/gestion/fiscal/resumen`, { params: this.paramsFiscal(f) });
  }
  libroVentas(f: { tienda?: string; desde?: string; hasta?: string }): Observable<any[]> { return this.http.get<any[]>(`${this.base}/gestion/fiscal/libro-ventas`, { params: this.paramsFiscal(f) }); }
  libroCompras(f: { tienda?: string; desde?: string; hasta?: string }): Observable<any[]> { return this.http.get<any[]>(`${this.base}/gestion/fiscal/libro-compras`, { params: this.paramsFiscal(f) }); }
  colaFiscal(f: { tienda?: string; desde?: string; hasta?: string; estado?: string }): Observable<any[]> { return this.http.get<any[]>(`${this.base}/gestion/fiscal/cola`, { params: this.paramsFiscal(f) }); }
  sincronizarFiscal(): Observable<Record<string, number>> { return this.http.post<Record<string, number>>(`${this.base}/gestion/fiscal/sincronizar`, {}); }
  configFiscal(tienda: string): Observable<ConfigFiscal> { return this.http.get<ConfigFiscal>(`${this.base}/gestion/fiscal/config`, { params: { tienda } }); }
  guardarConfigFiscal(tienda: string, c: Partial<ConfigFiscal>): Observable<ConfigFiscal> { return this.http.put<ConfigFiscal>(`${this.base}/gestion/fiscal/config`, c, { params: { tienda } }); }

  // ── Proveedores y compras ──

  proveedores(tienda: string, q?: string): Observable<ProveedorTienda[]> {
    const params: Record<string, string> = { tienda }; if (q) params['q'] = q;
    return this.http.get<ProveedorTienda[]>(`${this.base}/gestion/proveedores`, { params });
  }
  guardarProveedor(tienda: string, p: Partial<ProveedorTienda>, id?: string): Observable<ProveedorTienda> {
    return id ? this.http.put<ProveedorTienda>(`${this.base}/gestion/proveedores/${id}`, p, { params: { tienda } })
      : this.http.post<ProveedorTienda>(`${this.base}/gestion/proveedores`, p, { params: { tienda } });
  }
  compras(f: { tienda?: string; estado?: string; q?: string }): Observable<CompraResumen[]> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) p = p.set(k, String(v));
    return this.http.get<CompraResumen[]>(`${this.base}/gestion/compras`, { params: p });
  }
  compra(id: string): Observable<CompraDetalle> { return this.http.get<CompraDetalle>(`${this.base}/gestion/compras/${id}`); }
  crearCompra(c: { tienda_id: string; proveedor_id?: string | null; factura_numero?: string | null; fecha_factura?: string | null; origen?: string; lineas: LineaCompraNueva[] }): Observable<CompraDetalle> {
    return this.http.post<CompraDetalle>(`${this.base}/gestion/compras`, c);
  }
  importarFactura(tienda: string, archivo: File): Observable<CompraDetalle> {
    const fd = new FormData(); fd.append('archivo', archivo, archivo.name);
    return this.http.post<CompraDetalle>(`${this.base}/gestion/compras/importar`, fd, { params: { tienda } });
  }
  encabezadoCompra(id: string, e: { proveedor_id: string | null; factura_numero: string | null; fecha_factura: string | null; observacion: string | null }): Observable<CompraDetalle> {
    return this.http.put<CompraDetalle>(`${this.base}/gestion/compras/${id}`, e);
  }
  agregarLineaCompra(id: string, l: LineaCompraNueva): Observable<CompraDetalle> { return this.http.post<CompraDetalle>(`${this.base}/gestion/compras/${id}/lineas`, l); }
  editarLineaCompra(id: string, item: string, l: Partial<LineaCompraNueva>): Observable<CompraDetalle> { return this.http.put<CompraDetalle>(`${this.base}/gestion/compras/${id}/lineas/${item}`, l); }
  quitarLineaCompra(id: string, item: string): Observable<CompraDetalle> { return this.http.delete<CompraDetalle>(`${this.base}/gestion/compras/${id}/lineas/${item}`); }
  recibirCompra(id: string): Observable<CompraDetalle> { return this.http.post<CompraDetalle>(`${this.base}/gestion/compras/${id}/recibir`, {}); }
  anularCompra(id: string): Observable<CompraDetalle> { return this.http.post<CompraDetalle>(`${this.base}/gestion/compras/${id}/anular`, {}); }
  buscarProductosCompra(tienda: string, q: string): Observable<CandidatoProducto[]> {
    return this.http.get<CandidatoProducto[]>(`${this.base}/gestion/compras/buscar-productos`, { params: { tienda, q } });
  }
  historialPrecios(productoId: string): Observable<HistorialPrecios> { return this.http.get<HistorialPrecios>(`${this.base}/gestion/productos/${productoId}/historial-precios`); }

  // ── Activos de oficina ──

  activos(f: { tienda?: string; estado?: string; q?: string }): Observable<{ activos: ActivoOficina[]; resumen: { por_estado: { estado: string; n: number; valor: number }[] } }> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) p = p.set(k, String(v));
    return this.http.get<any>(`${this.base}/gestion/activos`, { params: p });
  }
  activo(id: string): Observable<ActivoOficina & { movimientos: MovimientoActivo[] }> { return this.http.get<any>(`${this.base}/gestion/activos/${id}`); }
  crearActivo(a: Partial<ActivoOficina>): Observable<ActivoOficina> { return this.http.post<ActivoOficina>(`${this.base}/gestion/activos`, a); }
  editarActivo(id: string, a: Partial<ActivoOficina>): Observable<ActivoOficina> { return this.http.put<ActivoOficina>(`${this.base}/gestion/activos/${id}`, a); }
  verificarRostroActivo(cedula: string, foto: Blob, vivacidad: string, consentimiento: { version: string; sha256: string }): Observable<VerificacionResumen> {
    const fd = new FormData();
    fd.append('muestra', foto, 'persona.jpg'); fd.append('cedula', cedula); fd.append('vivacidad', vivacidad);
    fd.append('consentimiento_version', consentimiento.version); fd.append('consentimiento_sha256', consentimiento.sha256);
    return this.http.post<VerificacionResumen>(`${this.base}/gestion/activos/verificar-rostro`, fd);
  }
  verificarPresencialActivo(cedula: string, comentario: string): Observable<VerificacionResumen> {
    return this.http.post<VerificacionResumen>(`${this.base}/gestion/activos/verificar-presencial`, { cedula, comentario });
  }
  asignarActivo(id: string, e: EntregaActivo): Observable<any> { return this.http.post(`${this.base}/gestion/activos/${id}/asignar`, e); }
  devolverActivo(id: string, e: Partial<EntregaActivo>): Observable<any> { return this.http.post(`${this.base}/gestion/activos/${id}/devolver`, e); }
  trasladarActivo(id: string, tiendaId: string, nota: string | null): Observable<any> { return this.http.post(`${this.base}/gestion/activos/${id}/trasladar`, { tienda_id: tiendaId, nota }); }
  estadoActivo(id: string, estado: string, nota: string | null): Observable<any> { return this.http.post(`${this.base}/gestion/activos/${id}/estado`, { estado, nota }); }
  misActivos(): Observable<ActivoOficina[]> { return this.http.get<ActivoOficina[]>(`${this.base}/tienda/mis-activos`); }

  // ── Ficha de la tienda ──

  fichaTienda(id: string): Observable<FichaTienda> {
    return this.http.get<FichaTienda>(`${this.base}/tiendas/${id}/ficha`);
  }
  guardarFichaTienda(id: string, f: Partial<FichaTienda>): Observable<FichaTienda> {
    return this.http.put<FichaTienda>(`${this.base}/tiendas/${id}/ficha`, f);
  }
  madresPosibles(id: string): Observable<{ id: string; nombre: string; tipo: string }[]> {
    return this.http.get<{ id: string; nombre: string; tipo: string }[]>(`${this.base}/tiendas/${id}/madres-posibles`);
  }
  oficinasConocidas(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/tiendas/oficinas-conocidas`);
  }

  // ── Direcciones de la persona ──

  misDirecciones(): Observable<DireccionGuardada[]> {
    return this.http.get<DireccionGuardada[]>(`${this.base}/tienda/direcciones`);
  }
  guardarDireccion(d: Partial<DireccionGuardada>): Observable<DireccionGuardada> {
    return this.http.post<DireccionGuardada>(`${this.base}/tienda/direcciones`, d);
  }
  borrarDireccion(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/tienda/direcciones/${id}`);
  }
  geocodificar(q: string, cerca?: { lat: number; lng: number } | null): Observable<LugarMapa[]> {
    const params: Record<string, string> = { q };
    if (cerca) { params['lat'] = String(cerca.lat); params['lng'] = String(cerca.lng); }
    return this.http.get<LugarMapa[]>(`${this.base}/tienda/geocodificar`, { params });
  }
  geocodificarInversa(lat: number, lng: number): Observable<LugarMapa> {
    return this.http.get<LugarMapa>(`${this.base}/tienda/geocodificar/inversa`, { params: { lat: String(lat), lng: String(lng) } });
  }

  // ── Entrega firmada: solicitud de préstamo, acta y custodia ──

  miSolicitudPrestamo(pedidoId: string): Observable<SolicitudPrestamo> {
    return this.http.get<SolicitudPrestamo>(`${this.base}/tienda/mis-pedidos/${pedidoId}/solicitud-prestamo`);
  }
  firmarSolicitudPrestamo(pedidoId: string, firma: Blob, verificacionId: string): Observable<SolicitudPrestamo> {
    const fd = new FormData();
    fd.append('firma', firma, 'firma.png');
    fd.append('verificacion_id', verificacionId);
    return this.http.post<SolicitudPrestamo>(`${this.base}/tienda/mis-pedidos/${pedidoId}/solicitud-prestamo/firmar`, fd);
  }
  estadoEntrega(pedidoId: string): Observable<EstadoEntrega> {
    return this.http.get<EstadoEntrega>(`${this.base}/entrega/pedidos/${pedidoId}/estado-entrega`);
  }
  imprimirSolicitudPrestamo(pedidoId: string): Observable<SolicitudPrestamo & { firma_virtual_doc_id: string | null; nombre: string | null; cedula: string }> {
    return this.http.post<any>(`${this.base}/entrega/pedidos/${pedidoId}/solicitud-prestamo/imprimir`, {});
  }
  verificarPresencialPedido(pedidoId: string, cedula: string, terceroId: string | null, comentario: string): Observable<VerificacionResumen> {
    return this.http.post<VerificacionResumen>(`${this.base}/entrega/pedidos/${pedidoId}/verificar-presencial`,
      { cedula_presentada: cedula, tercero_id: terceroId, comentario });
  }
  registrarActa(pedidoId: string, acta: {
    canal: 'PUNTO' | 'DOMICILIO'; verificacion_id: string; foto_receptor_doc_id?: string | null; foto_documento_doc_id: string;
    firma_receptor_doc_id: string; papel_firmado_doc_id?: string | null; latitud?: number | null; longitud?: number | null;
  }): Observable<EstadoEntrega> {
    return this.http.post<EstadoEntrega>(`${this.base}/entrega/pedidos/${pedidoId}/acta`, acta);
  }
  custodia(f: { tienda?: string; estado?: string; q?: string }): Observable<DocumentoCustodia[]> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) p = p.set(k, String(v));
    return this.http.get<DocumentoCustodia[]>(`${this.base}/gestion/custodia`, { params: p });
  }
  documentoCustodia(id: string): Observable<DocumentoCustodia & { eventos: EventoCustodia[]; texto: string; acta: any }> {
    return this.http.get<any>(`${this.base}/gestion/custodia/${id}`);
  }
  moverCustodia(id: string, m: { evento: string; ubicacion?: string | null; nota?: string | null; foto_doc_id?: string | null }): Observable<any> {
    return this.http.post(`${this.base}/gestion/custodia/${id}/movimientos`, m);
  }

  // ── Medios de pago por tienda ──

  mediosPago(tiendas: string[]): Observable<Record<string, MediosTienda>> {
    return this.http.get<Record<string, MediosTienda>>(`${this.base}/tienda/medios-pago`, { params: { tiendas: tiendas.join(',') } });
  }
  reportarPago(pedidoId: string, pagoId: string, referencia: string | null, comprobanteDocId: string | null): Observable<unknown> {
    return this.http.post(`${this.base}/tienda/mis-pedidos/${pedidoId}/pagos/${pagoId}/reportar`, { referencia, comprobante_doc_id: comprobanteDocId });
  }
  mediosDeTienda(tienda: string): Observable<MedioPago[]> {
    return this.http.get<MedioPago[]>(`${this.base}/gestion/tiendas/${tienda}/medios-pago`);
  }
  guardarMediosDeTienda(tienda: string, medios: Partial<MedioPago>[]): Observable<MedioPago[]> {
    return this.http.put<MedioPago[]>(`${this.base}/gestion/tiendas/${tienda}/medios-pago`, medios);
  }

  // ── Soporte (lado de la persona, EconomiAPP) ──

  misTickets(): Observable<TicketFila[]> {
    return this.http.get<TicketFila[]>(`${this.base}/tienda/soporte/tickets`);
  }
  abrirTicket(t: { area: string; categoria?: string | null; asunto: string; descripcion: string; pedido_id?: string | null; nombre?: string | null; telefono?: string | null }): Observable<{ id: string; numero: string; duplicado: boolean }> {
    return this.http.post<{ id: string; numero: string; duplicado: boolean }>(`${this.base}/tienda/soporte/tickets`, t);
  }
  miTicket(id: string): Observable<TicketDetalle> {
    return this.http.get<TicketDetalle>(`${this.base}/tienda/soporte/tickets/${id}`);
  }
  responderMiTicket(id: string, texto: string, nombre: string | null): Observable<TicketDetalle> {
    return this.http.post<TicketDetalle>(`${this.base}/tienda/soporte/tickets/${id}/mensajes`, { texto, nombre });
  }
  calificarTicket(id: string, estrellas: number): Observable<unknown> {
    return this.http.post(`${this.base}/tienda/soporte/tickets/${id}/calificar`, { estrellas });
  }

  // ── Alistamiento, stickers y rutas ──

  alistamiento(pedidoId: string): Observable<Alistamiento> {
    return this.http.get<Alistamiento>(`${this.base}/gestion/pedidos/${pedidoId}/alistamiento`);
  }
  alistar(pedidoId: string, items: string[], bultos: number | null): Observable<Alistamiento> {
    return this.http.post<Alistamiento>(`${this.base}/gestion/pedidos/${pedidoId}/alistamiento`, { items, bultos });
  }
  etiquetaPedido(pedidoId: string): Observable<EtiquetaPedido> {
    return this.http.post<EtiquetaPedido>(`${this.base}/gestion/pedidos/${pedidoId}/etiqueta`, {});
  }
  miRuta(): Observable<RutaEntrega | { ruta: false }> {
    return this.http.get<RutaEntrega | { ruta: false }>(`${this.base}/gestion/rutas/mia`);
  }
  escanearParaRuta(codigo: string): Observable<RutaEntrega> {
    return this.http.post<RutaEntrega>(`${this.base}/gestion/rutas/escanear`, { codigo });
  }
  descargarDeRuta(rutaId: string, pedidoId: string): Observable<RutaEntrega> {
    return this.http.delete<RutaEntrega>(`${this.base}/gestion/rutas/${rutaId}/paradas/${pedidoId}`);
  }
  iniciarRuta(rutaId: string, lat: number | null, lng: number | null): Observable<RutaEntrega> {
    return this.http.post<RutaEntrega>(`${this.base}/gestion/rutas/${rutaId}/iniciar`, { lat, lng });
  }
  posicionRuta(rutaId: string, lat: number, lng: number, precision: number | null): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/rutas/${rutaId}/posicion`, { lat, lng, precision });
  }
  entregarParada(rutaId: string, pedidoId: string, recibidoPor: string | null): Observable<RutaEntrega> {
    return this.http.post<RutaEntrega>(`${this.base}/gestion/rutas/${rutaId}/paradas/${pedidoId}/entregar`, { recibido_por: recibidoPor });
  }
  fallarParada(rutaId: string, pedidoId: string, motivo: string): Observable<RutaEntrega> {
    return this.http.post<RutaEntrega>(`${this.base}/gestion/rutas/${rutaId}/paradas/${pedidoId}/fallar`, { motivo });
  }
  rutas(f: { tienda?: string; estado?: string; dia?: string }): Observable<{ rutas: RutaResumen[]; por_despachar: PedidoPorDespachar[] }> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) p = p.set(k, String(v));
    return this.http.get<{ rutas: RutaResumen[]; por_despachar: PedidoPorDespachar[] }>(`${this.base}/gestion/rutas`, { params: p });
  }
  ruta(id: string): Observable<RutaEntrega> {
    return this.http.get<RutaEntrega>(`${this.base}/gestion/rutas/${id}`);
  }
  cancelarRuta(id: string): Observable<RutaEntrega> {
    return this.http.post<RutaEntrega>(`${this.base}/gestion/rutas/${id}/cancelar`, {});
  }

  // ── Alistamiento (cola) y paquete en PDF ──

  colaAlistamiento(tienda?: string | null): Observable<PedidoEnCola[]> {
    let p = new HttpParams();
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<PedidoEnCola[]>(`${this.base}/gestion/alistamiento/cola`, { params: p });
  }
  tomarAlistamiento(pedidoId: string, reasignar = false): Observable<Alistamiento> {
    return this.http.post<Alistamiento>(`${this.base}/gestion/pedidos/${pedidoId}/alistamiento/tomar`, { reasignar });
  }
  soltarAlistamiento(pedidoId: string): Observable<Alistamiento> {
    return this.http.post<Alistamiento>(`${this.base}/gestion/pedidos/${pedidoId}/alistamiento/soltar`, {});
  }
  /** Hoja de alistamiento + solicitud de préstamo (2 copias) con QR, en PDF. */
  paquetePdf(pedidoId: string): Observable<Blob> {
    return this.http.get(`${this.base}/gestion/pedidos/${pedidoId}/paquete.pdf`, { responseType: 'blob' });
  }
  /** Solo la solicitud de préstamo (2 copias), para reimprimir en la puerta o en el punto. */
  autorizacionPdf(pedidoId: string): Observable<Blob> {
    return this.http.get(`${this.base}/entrega/pedidos/${pedidoId}/autorizacion.pdf`, { responseType: 'blob' });
  }

  // ── Bolsa de domicilios (domiciliario) ──

  bolsaDomicilios(lat?: number | null, lng?: number | null): Observable<BolsaDomicilios> {
    let p = new HttpParams();
    if (lat != null && lng != null) p = p.set('lat', String(lat)).set('lng', String(lng));
    return this.http.get<BolsaDomicilios>(`${this.base}/gestion/domicilios/bolsa`, { params: p });
  }
  tomarDomicilios(pedidos: string[], lat: number | null, lng: number | null): Observable<RutaEntrega> {
    return this.http.post<RutaEntrega>(`${this.base}/gestion/domicilios/tomar`, { pedidos, lat, lng });
  }
  disponibleDomiciliario(disponible: boolean, lat: number | null, lng: number | null): Observable<Repartidor> {
    return this.http.post<Repartidor>(`${this.base}/gestion/domicilios/disponible`, { disponible, lat, lng });
  }
  perfilDomiciliario(cuerpo: { telefono?: string | null; vehiculo?: string | null; placa?: string | null }): Observable<Repartidor> {
    return this.http.put<Repartidor>(`${this.base}/gestion/domicilios/perfil`, cuerpo);
  }
  equipoDomicilios(tienda?: string | null): Observable<RepartidorEquipo[]> {
    let p = new HttpParams();
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<RepartidorEquipo[]>(`${this.base}/gestion/domicilios/equipo`, { params: p });
  }
  ajustarDomiciliario(usuarioId: string, cuerpo: { max_pedidos?: number | null; activo?: boolean | null }): Observable<Repartidor> {
    return this.http.patch<Repartidor>(`${this.base}/gestion/domicilios/equipo/${usuarioId}`, cuerpo);
  }
  llegueParada(rutaId: string, pedidoId: string): Observable<RutaEntrega> {
    return this.http.post<RutaEntrega>(`${this.base}/gestion/rutas/${rutaId}/paradas/${pedidoId}/llegue`, {});
  }
  contactoParada(rutaId: string, pedidoId: string, canal: 'LLAMADA' | 'WHATSAPP', destino: 'TITULAR' | 'TERCERO' | 'TIENDA'): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/rutas/${rutaId}/paradas/${pedidoId}/contacto`, { canal, destino });
  }

  // ── Entrega con huella ──

  /** Foto o firma de la entrega subida por ms-store: el servidor calcula y guarda su sha256. */
  subirEvidencia(pedidoId: string, tipo: TipoEvidencia, archivo: Blob, nombre: string,
                 pos?: { lat: number; lng: number } | null): Observable<EvidenciaEntrega> {
    const fd = new FormData();
    fd.append('archivo', archivo, nombre);
    fd.append('tipo', tipo);
    if (pos) { fd.append('lat', String(pos.lat)); fd.append('lng', String(pos.lng)); }
    return this.http.post<EvidenciaEntrega>(`${this.base}/entrega/pedidos/${pedidoId}/evidencias`, fd);
  }
  /** El titular firma la autorización de descuento en el equipo de quien entrega (rostro verificado). */
  firmarPrestamoEnEntrega(pedidoId: string, firma: Blob, verificacionId: string): Observable<SolicitudPrestamo & { firma_canal: string; firma_virtual_sha256: string }> {
    const fd = new FormData();
    fd.append('firma', firma, 'firma-autoriza.png');
    fd.append('verificacion_id', verificacionId);
    return this.http.post<any>(`${this.base}/entrega/pedidos/${pedidoId}/solicitud-prestamo/firmar-en-entrega`, fd);
  }
  /** Hora de entrega acordada con la persona (fecha yyyy-MM-dd, horas HH:mm). */
  confirmarHoraEntrega(pedidoId: string, cuerpo: { fecha: string; desde: string; hasta: string; via: 'LLAMADA' | 'WHATSAPP' | 'PERSONA'; nota?: string | null }):
    Observable<{ ok: boolean; fecha: string; franja: string }> {
    return this.http.post<{ ok: boolean; fecha: string; franja: string }>(`${this.base}/gestion/pedidos/${pedidoId}/hora-entrega`, cuerpo);
  }
  /** Video del empaque o foto final del pedido empacado (el servidor calcula la huella). */
  evidenciaAlistamiento(pedidoId: string, tipo: 'VIDEO_ALISTAMIENTO' | 'FOTO_ALISTAMIENTO', archivo: Blob, nombre: string): Observable<EvidenciaEntrega> {
    const fd = new FormData();
    fd.append('archivo', archivo, nombre);
    fd.append('tipo', tipo);
    return this.http.post<EvidenciaEntrega>(`${this.base}/gestion/pedidos/${pedidoId}/alistamiento/evidencias`, fd);
  }
  /** Entrega simple: quien recibe, su cédula, su foto (y el papel firmado si aplica) y se cierra. */
  entregaSimple(pedidoId: string, cuerpo: {
    canal: 'PUNTO' | 'DOMICILIO'; tercero_id: string | null; cedula: string; foto_receptor_doc_id: string;
    papel_firmado_doc_id?: string | null; latitud?: number | null; longitud?: number | null; nota?: string | null; papel_despues?: boolean;
  }): Observable<EstadoEntrega> {
    return this.http.post<EstadoEntrega>(`${this.base}/entrega/pedidos/${pedidoId}/entrega-simple`, cuerpo);
  }
  /** Formatos de mercado firmados que tengo (domiciliario): por escanear y por entregar en la tienda. */
  misPapeles(): Observable<PapelFirmado[]> {
    return this.http.get<PapelFirmado[]>(`${this.base}/gestion/domicilios/papeles`);
  }
  escanearMiPapel(docId: string, archivo: Blob, nombre: string): Observable<DocumentoCustodia & { qr_leido: boolean }> {
    const fd = new FormData();
    fd.append('archivo', archivo, nombre);
    return this.http.post<DocumentoCustodia & { qr_leido: boolean }>(`${this.base}/gestion/domicilios/papeles/${docId}/escaneo`, fd);
  }
  /** La tienda recibe el formato firmado que trae el domiciliario. */
  recibirPapel(docId: string, nota?: string | null): Observable<DocumentoCustodia> {
    return this.http.post<DocumentoCustodia>(`${this.base}/gestion/custodia/${docId}/recibir`, { nota: nota ?? null });
  }
  recibirPapelQr(codigo: string): Observable<DocumentoCustodia> {
    return this.http.post<DocumentoCustodia>(`${this.base}/gestion/custodia/recibir-qr`, { codigo });
  }
  casoPedido(pedidoId: string): Observable<CasoPedido> {
    return this.http.get<CasoPedido>(`${this.base}/gestion/pedidos/${pedidoId}/caso`);
  }
  abrirCaso(pedidoId: string, cuerpo: { categoria: string; prioridad: string; descripcion: string; evidencia_doc_id?: string | null }): Observable<CasoPedido> {
    return this.http.post<CasoPedido>(`${this.base}/gestion/pedidos/${pedidoId}/casos`, cuerpo);
  }
  notaCaso(casoId: string, texto: string, evidenciaDocId?: string | null): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/casos/${casoId}/notas`, { texto, evidencia_doc_id: evidenciaDocId ?? null });
  }
  cerrarCaso(casoId: string, resolucion: string): Observable<unknown> {
    return this.http.post(`${this.base}/gestion/casos/${casoId}/cerrar`, { resolucion });
  }

  /** Papel firmado escaneado o fotografiado: el servidor lee el QR de la hoja. */
  escanearCustodia(archivo: Blob, nombre: string, documentoId?: string | null): Observable<ResultadoEscaneoCustodia> {
    const fd = new FormData();
    fd.append('archivo', archivo, nombre);
    if (documentoId) fd.append('documento_id', documentoId);
    return this.http.post<ResultadoEscaneoCustodia>(`${this.base}/gestion/custodia/escaneo`, fd);
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

// ── Soporte ──
export interface TicketFila {
  id: string; numero: string; cedula: string; nombre: string | null; area: string; categoria: string; prioridad: string;
  estado: string; asunto: string; origen: string; asignado_nombre: string | null; sla_vence_en: string; creado_en: string;
  actualizado_en: string; pedido_id: string | null; tienda: string | null; vencido: number | boolean; mensajes: number;
}
export interface BandejaSoporte { tickets: TicketFila[]; total: number; conteos: { estado: string; n: number }[] }
export interface TicketMensaje { id: number; autor_tipo: 'CLIENTE' | 'AGENTE' | 'SISTEMA' | 'IA'; autor_nombre: string | null; texto: string; interno: number | boolean; creado_en: string }
export interface TicketDetalle extends TicketFila {
  descripcion: string; resumen_ia: string | null; datos_json: string | null; telefono: string | null; producto_id: string | null;
  tienda_id: string | null; conversacion_id: string | null; primera_respuesta_en: string | null; resuelto_en: string | null;
  calificacion: number | null; mensajes: TicketMensaje[] | any;
  pedido?: { id: string; numero: string; estado: string; total: number; tipo_entrega: string; creado_en: string } | null;
}

// ── Logística ──
export interface EtiquetaPedido {
  id: string; numero: string; cliente_nombre: string | null; cliente_telefono: string | null; tipo_entrega: string;
  direccion_texto: string | null; latitud: number | null; longitud: number | null; total: number; bultos: number | null;
  alistado_por_nombre: string | null; alistado_en: string | null; etiqueta_impresa_en: string | null; tienda: string;
  lineas: number; por_cobrar: number; codigo_qr: string;
}
export interface Alistamiento extends EtiquetaPedido {
  estado: string;
  alistador_id?: string | null; alistador_nombre?: string | null; alistamiento_tomado_en?: string | null;
  paquete_impreso_en?: string | null; indicaciones?: string | null; observacion?: string | null; es_mio?: boolean;
  prestamo_numero?: string | null; prestamo_estado?: string | null; prestamo_impresiones?: number | null;
  fecha_compromiso?: string | null; programado_en?: string | null; programado_hasta?: string | null;
  hora_confirmada_en?: string | null; hora_confirmada_via?: string | null;
  evidencias?: { tipo: string; doc_id: string; sha256: string; bytes: number; mime: string | null; tomado_por_nombre: string | null; creado_en: string }[];
  items: { id: string; descripcion: string; cantidad: number; alistado: number | boolean; disponibilidad: string; sku: string | null; codigo_barras: string | null; imagen?: string | null }[];
}
export interface ParadaRuta {
  pedido_id: string; orden: number; estado: 'CARGADO' | 'ENTREGADO' | 'FALLIDO'; lat: number | null; lng: number | null;
  km_desde_anterior: number | null; cargado_en: string; entregado_en: string | null; nota: string | null; numero: string;
  cliente_nombre: string | null; cliente_telefono: string | null; direccion_texto: string | null; indicaciones: string | null;
  observacion: string | null; total: number; bultos: number | null; estado_pedido: string; por_cobrar: number;
  // V35: tomar ≠ recoger; contacto y autorización
  tomado_en?: string | null; recogido_en?: string | null; bultos_recogidos?: string | null; recogida_manual?: number | boolean;
  llegada_en?: string | null; cliente_cedula?: string; requiere_acta?: number | boolean; recibe?: 'TITULAR' | 'TERCERO' | null;
  costo_domicilio?: number; lineas?: number; prestamo_numero?: string | null; prestamo_estado?: string | null;
  prestamo_monto?: number | null; contactos?: number;
  terceros?: { id: string; nombre: string; telefono: string | null; parentesco: string | null; estado: string }[];
  fecha_compromiso?: string | null; programado_en?: string | null; programado_hasta?: string | null;
  hora_confirmada_en?: string | null; hora_confirmada_via?: string | null; casos_abiertos?: number;
}
export interface RutaEntrega {
  id: string; numero: string; tienda_id: string; repartidor_id: string | null; repartidor_nombre: string | null;
  estado: 'CARGANDO' | 'EN_CURSO' | 'FINALIZADA' | 'CANCELADA'; origen_lat: number | null; origen_lng: number | null;
  distancia_km: number | null; minutos_estimados: number | null; ultima_lat: number | null; ultima_lng: number | null;
  ultima_posicion_en: string | null; creado_en: string; iniciada_en: string | null; finalizada_en: string | null;
  tienda: { nombre: string; direccion: string | null; telefono: string | null; latitud?: number | null; longitud?: number | null };
  paradas: ParadaRuta[]; trazo?: { lat: number; lng: number; registrado_en: string }[]; aviso?: string;
}
export interface RutaResumen {
  id: string; numero: string; estado: string; repartidor_nombre: string | null; distancia_km: number | null; minutos_estimados: number | null;
  creado_en: string; iniciada_en: string | null; finalizada_en: string | null; ultima_posicion_en: string | null; tienda: string;
  paradas: number; entregadas: number | null; fallidas: number | null; por_recoger?: number | null;
}
/** Un pedido en la cola del alistador. */
export interface PedidoEnCola {
  id: string; numero: string; estado: string; tipo_entrega: string; cliente_nombre: string | null; direccion_texto: string | null;
  total: number; bultos: number | null; creado_en: string; confirmado_en: string | null; programado_en: string | null;
  alistador_id: string | null; alistador_nombre: string | null; alistamiento_tomado_en: string | null; alistado_en: string | null;
  paquete_impreso_en: string | null; etiqueta_impresa_en: string | null; tienda: string; tienda_id: string; es_mio: number | boolean | null;
  lineas: number; alistadas: number; unidades: number; prestamo_numero: string | null; prestamo_estado: string | null;
  prestamo_impresiones: number | null; tomado: number | boolean;
  fecha_compromiso?: string | null; programado_hasta?: string | null; hora_confirmada_en?: string | null;
  cliente_telefono?: string | null; videos?: number; fotos?: number; casos_abiertos?: number;
}
export interface Repartidor {
  usuario_id?: string; nombre?: string | null; cedula?: string | null; telefono?: string | null; vehiculo?: string | null;
  placa?: string | null; disponible: boolean | number; disponible_desde?: string | null; max_pedidos: number; activo: boolean | number;
  nuevo?: boolean;
}
export interface RepartidorEquipo extends Repartidor {
  usuario_id: string; ultima_lat: number | null; ultima_lng: number | null; ultima_posicion_en: string | null;
  ruta_activa: string | null; ruta_estado: string | null; entregados_hoy: number; papeles_pendientes?: number;
}
/** Un domicilio en la bolsa (sin tomar). */
export interface DomicilioEnBolsa {
  id: string; numero: string; estado: string; tienda_id: string; tienda: string; tienda_direccion: string | null;
  tienda_lat: number | null; tienda_lng: number | null; cliente_nombre: string | null; direccion_texto: string | null;
  indicaciones: string | null; latitud: number | null; longitud: number | null; total: number; bultos: number | null;
  costo_domicilio: number; confirmado_en: string | null; alistado_en: string | null; programado_en: string | null;
  alistador_nombre: string | null; requiere_acta: number | boolean; lineas: number; por_cobrar: number; pagos_sin_verificar: number;
  prestamo_estado: string | null; minutos_esperando: number | null; km_a_tienda?: number; km_entrega?: number;
  barrio: string | null; listo: boolean;
  fecha_compromiso?: string | null; programado_hasta?: string | null; hora_confirmada_en?: string | null;
  casos_abiertos?: number;
}
/** Todo lo de un pedido para investigarlo: línea de tiempo, evidencias y casos internos. */
export interface CasoPedido {
  id: string; numero: string; estado: string; tipo_entrega: string; tienda: string; cliente_cedula: string; cliente_nombre: string | null;
  cliente_telefono: string | null; direccion_texto: string | null; total: number; fecha_compromiso: string | null;
  programado_en: string | null; programado_hasta: string | null; hora_confirmada_en: string | null; hora_confirmada_por: string | null;
  hora_confirmada_via: string | null; alistador_nombre: string | null;
  linea: { cuando: string; tipo: 'ESTADO' | 'TRAZA' | 'CONTACTO' | 'RUTA' | 'EVIDENCIA' | 'CASO'; titulo: string; detalle: string | null; quien: string | null; doc_id: string | null }[];
  evidencias: { tipo: string; doc_id: string; sha256: string; bytes: number; mime: string | null; tomado_por_nombre: string | null; creado_en: string }[];
  casos: { id: string; numero: string; categoria: string; prioridad: string; estado: string; asunto: string; interno: number | boolean;
           origen: string; creado_en: string; sla_vence_en: string | null; resuelto_en: string | null;
           mensajes: { autor_tipo: string; autor_nombre: string | null; texto: string; adjunto_doc_id: string | null; creado_en: string }[] }[];
  categorias: string[];
}
export interface BolsaDomicilios {
  repartidor: Repartidor;
  mi_ruta: { id: string; numero: string; estado: string; tienda_id: string; paradas: number } | null;
  pedidos: DomicilioEnBolsa[]; sin_tiendas?: boolean;
}
export type TipoEvidencia = 'FOTO_DOCUMENTO' | 'FIRMA_RECIBE' | 'PAPEL_FIRMADO' | 'FOTO_RECEPTOR' | 'FOTO_ENTREGA' | 'CASO';
export interface EvidenciaEntrega { id: string; tipo: TipoEvidencia; doc_id: string; sha256: string; bytes: number }
export interface ResultadoEscaneoCustodia {
  identificado: boolean; qr_leido?: boolean; codigos?: string[]; mensaje?: string;
  id?: string; numero?: string; cedula?: string; nombre?: string; estado?: string; escaneo_sha256?: string;
}
export interface PedidoPorDespachar {
  id: string; numero: string; cliente_nombre: string | null; direccion_texto: string | null; latitud: number | null; longitud: number | null;
  total: number; bultos: number | null; alistado_en: string | null; etiqueta_impresa_en: string | null; tienda: string;
}

// ── Medios de pago ──
export interface MedioPago {
  id: string; tienda_id?: string; metodo: string; activo?: boolean | number; nombre: string | null; titular: string | null;
  documento_titular?: string | null; entidad: string | null; tipo_cuenta: string | null; numero: string | null;
  enlace_pago: string | null; qr_doc_id: string | null; instrucciones: string | null; requiere_comprobante: boolean | number; orden?: number;
}
export interface MediosTienda { acepta_bono_mercado: boolean; medios: MedioPago[] }

/** Medios de la caja: datos de las cuentas de la tienda y la pasarela activa (sin secretos). */
export interface MediosCaja {
  medios: MedioPago[]; acepta_bono_mercado: boolean;
  pasarela: { activa: boolean; proveedor: string | null; ambiente: string | null; metodos: string[] };
}
export interface CodigoProducto {
  id: string; producto_id: string; variante_id: string | null; codigo: string;
  tipo: 'BARRAS' | 'INTERNO' | 'ORIGEN' | 'GENERADO'; principal: boolean; creado_en: string;
}
export interface ComponenteProducto { id: string; producto_id: string; componente_id: string; cantidad: number }
/** Informe de una importación (previsualización o avance). */
export interface InformeImportacion {
  id?: string; estado?: 'EN_CURSO' | 'TERMINADA' | 'FALLIDA'; aplicado?: boolean;
  productos: number; ya_importados?: number; nuevos?: number; inactivos?: number; sin_codigo_barras?: number;
  con_stock?: number; sin_control_de_existencias?: number; compuestos?: number; a_publicar_en_economiapp?: number;
  con_historial_de_ventas?: number; por_departamento?: Record<string, number>; familias?: Record<string, number>;
  totales_calidad?: Record<string, number>; procesados?: number; creados?: number; actualizados?: number;
  compuestos_armados?: number; con_stock_inicial?: number; codigos_agregados?: number; total_fallas?: number;
  fallas?: string[]; error?: string; ejemplos?: Array<Record<string, unknown>>;
  sin_precio?: Array<Record<string, unknown>>; barras_repetidas?: Array<Record<string, unknown>>;
  stock_negativo?: Array<Record<string, unknown>>; iva_atipico?: Array<Record<string, unknown>>;
  omitidos_separadores?: Array<Record<string, unknown>>; barras_de_otro_producto?: Array<Record<string, unknown>>;
}

export interface CobroPasarela { pago: Pago; url: string; referencia: string; ambiente: string }
export interface ConfigPasarela {
  cifrado_disponible: boolean; url_eventos: string; configurada: boolean; proveedor: string; ambiente: 'SANDBOX' | 'PRODUCCION';
  llave_publica?: string | null; tiene_llave_privada?: boolean; tiene_secreto_integridad?: boolean; tiene_secreto_eventos?: boolean;
  metodos: string[]; activo: boolean; nombre_comercio?: string | null; verificado_en?: string | null; actualizado_por?: string | null;
}

// ── Entrega firmada ──
export interface SolicitudPrestamo {
  existe: boolean; id?: string; numero?: string; monto?: number; cuotas?: number; texto?: string; texto_sha256?: string;
  estado?: 'PENDIENTE_FIRMA' | 'FIRMADO_VIRTUAL' | 'FIRMADO_FISICO' | 'ARCHIVADO' | 'ANULADO'; firmado_virtual_en?: string | null; firmado_fisico_en?: string | null;
}
export interface EstadoEntrega {
  id: string; numero: string; cliente_cedula: string; cliente_nombre: string | null; tipo_entrega: string;
  requiere_acta: boolean | number; recibe: 'TITULAR' | 'TERCERO' | null;
  documento: (SolicitudPrestamo & { impresiones: number; firma_virtual_doc_id: string | null; firma_canal?: string | null; cedula?: string; nombre?: string | null; plantilla_version?: string }) | null;
  acta: { id: string; receptor_tipo: string; receptor_nombre: string | null; receptor_cedula: string; via: string; creado_en: string;
          modo_autorizacion?: string | null; acta_sha256?: string | null } | null;
  terceros: { id: string; nombre: string; cedula: string; telefono?: string | null; parentesco: string | null; estado: string; con_foto: number | boolean }[];
  evidencias?: { tipo: string; doc_id: string; sha256: string; bytes: number; creado_en: string }[];
}
export interface DocumentoCustodia {
  id: string; numero: string; pedido_id: string; pedido_numero: string; pedido_estado: string; cedula: string; nombre: string | null;
  monto: number; cuotas: number; estado: string; firmado_virtual_en: string | null; impresiones: number; firmado_fisico_en: string | null;
  escaneo_doc_id: string | null; custodia_responsable: string | null; custodia_ubicacion: string | null; actualizado_en: string; tienda: string;
  firma_canal?: string | null; escaneo_origen?: string | null; firma_virtual_doc_id?: string | null;
  papel_estado?: 'CON_DOMICILIARIO' | 'EN_TIENDA' | 'ARCHIVADO' | null; custodia_responsable_id?: string | null; firmado_en?: string | null;
}
/** Un formato de mercado firmado en poder del domiciliario. */
export interface PapelFirmado {
  id: string; numero: string; cedula: string; nombre: string | null; monto: number; cuotas: number; escaneo_doc_id: string | null;
  escaneo_origen: string | null; firmado_fisico_en: string | null; custodia_ubicacion: string | null; pedido_numero: string;
  pedido_id: string; tienda: string; tienda_id: string;
}
export interface EventoCustodia { id: number; evento: string; responsable: string | null; ubicacion: string | null; foto_doc_id: string | null; nota: string | null; creado_en: string }

// ── Direcciones ──
export interface DireccionGuardada {
  id: string; nombre: string; direccion: string; barrio: string | null; municipio: string | null; indicaciones: string | null;
  latitud: number; longitud: number; precision_m: number | null; principal: boolean | number;
}
export interface LugarMapa {
  direccion: string | null; barrio: string | null; municipio: string | null; departamento?: string | null; descripcion: string;
  latitud: number; longitud: number; exacta: boolean;
}

export interface FichaTienda {
  id: string; nombre: string; descripcion: string | null; tipo: string; direccion: string | null; municipio: string | null;
  telefono: string | null; latitud: number | null; longitud: number | null; permite_domicilio: boolean; permite_recogida: boolean;
  radio_domicilio_km: number | null; costo_domicilio: number; publicada_en_virtual: boolean; atiende_todas_oficinas: boolean;
  tienda_madre_id: string | null; tienda_madre: string | null; activa: boolean; negocio: string; puntos: number;
  dias_habiles_entrega?: number; entrega_sabado?: boolean | number;
  oficinas: { oficina: string; principal: boolean }[]; puntos_lista: { id: string; nombre: string; activa: boolean; oficinas: string | null }[];
}

// ── Activos ──
export interface ActivoOficina {
  id: string; tienda_id: string; tienda: string; codigo: string; nombre: string; categoria: string | null; marca: string | null;
  modelo: string | null; serial: string | null; valor: number | null; fecha_compra: string | null;
  estado: 'DISPONIBLE' | 'ASIGNADO' | 'MANTENIMIENTO' | 'BAJA'; estado_fisico: 'BUENO' | 'REGULAR' | 'MALO';
  asignado_cedula: string | null; asignado_nombre: string | null; asignado_en: string | null; foto_doc_id: string | null; notas: string | null;
}
export interface MovimientoActivo {
  id: number; tipo: string; de_tienda: string | null; a_tienda: string | null; cedula: string | null; nombre: string | null; via: string | null;
  foto_documento_doc_id: string | null; firma_doc_id: string | null; foto_estado_doc_id: string | null; estado_fisico: string | null;
  nota: string | null; responsable: string | null; creado_en: string;
}
export interface EntregaActivo {
  cedula: string; nombre: string | null; verificacion_id: string; foto_documento_doc_id: string | null; firma_doc_id: string;
  foto_estado_doc_id: string | null; estado_fisico: string | null; nota: string | null;
}

// ── Compras ──
export interface ProveedorTienda {
  id: string; nit: string | null; nombre: string; contacto: string | null; telefono: string | null; correo: string | null; direccion: string | null;
  dias_credito: number; activo: boolean | number; compras?: number; ultima_compra?: string | null;
}
export interface CompraResumen {
  id: string; numero: string; estado: 'BORRADOR' | 'RECIBIDA' | 'ANULADA'; origen: string; factura_numero: string | null; fecha_factura: string | null;
  total: number; total_documento: number | null; creado_en: string; recibida_en: string | null; proveedor: string | null; tienda: string;
  lineas: number; sin_emparejar: number;
}
export interface CandidatoProducto { producto_id: string; variante_id: string | null; nombre: string; sku: string | null; score: number; activo?: boolean }
export interface LineaCompra {
  id: string; producto_id: string | null; variante_id: string | null; producto: string | null; variante: string | null; sku: string | null;
  cantidad: number; costo_unitario: number; impuesto_pct: number; total: number; codigo_proveedor: string | null; descripcion_proveedor: string | null;
  coincidencia: number | null; metodo_emparejado: string | null; candidatos: CandidatoProducto[]; ultimo_costo: number | null; variacion_pct?: number;
}
export interface CompraDetalle extends Omit<CompraResumen, 'proveedor' | 'lineas' | 'sin_emparejar'> {
  tienda_id: string; proveedor_id: string | null; proveedor: string | null; proveedor_nit: string | null; proveedor_leido: string | null;
  nit_leido: string | null; documento_doc_id: string | null; subtotal: number; impuesto_total: number; observacion: string | null;
  items: LineaCompra[]; aviso?: string; texto_leido?: string;
}
export interface LineaCompraNueva {
  producto_id?: string | null; variante_id?: string | null; codigo?: string | null; descripcion?: string | null;
  cantidad?: number | null; costo_unitario?: number | null; iva_pct?: number | null;
}
export interface HistorialPrecios {
  compras: { fecha: string; numero: string; factura_numero: string | null; proveedor: string | null; tienda: string; cantidad: number; costo_unitario: number; impuesto_pct: number; variante: string | null }[];
  ventas: { vigente_desde: string; vigente_hasta: string | null; precio: number; tienda: string | null; variante: string | null }[];
  proveedores: { proveedor: string; compras: number; minimo: number; maximo: number; ultimo: string; ultima: string }[];
}

// ── Fiscal ──
export interface ResumenFiscal {
  desde: string; hasta: string; ventas_total: number; ventas_base: number; iva_generado: number; base_por_tarifa: Record<string, number>;
  documentos_venta: number; compras_total: number; iva_descontable: number; iva_a_pagar_estimado: number; costo_ventas: number;
  margen_bruto: number; margen_pct: number | null; costo_incompleto: boolean; salidas_sin_costo: number; mermas: number;
  ajustes_neg: number; ajustes_pos: number; cola: { estado: string; n: number }[];
}
export interface ConfigFiscal {
  id: string; nombre: string; nit: string | null; dv: string | null; razon_social: string | null; tipo_contribuyente: string | null;
  responsable_iva: boolean | number; factura_electronica: boolean | number; fincore_empresa: string | null;
}

// ── Evidencias y caja ──
export interface Evidencia { id: string; entidad_tipo: string; entidad_id: string; doc_id: string; tipo: string; comentario: string | null; tomada_en?: string; creado_en?: string }
export interface TurnoCajaFila {
  id: string; caja_id: string; tienda_id: string; usuario_nombre: string | null; base_inicial: number; estado: 'ABIERTO' | 'CERRADO';
  totales_sistema_json: string | null; totales_declarado_json: string | null; diferencia: number | null; observacion_cierre: string | null;
  abierto_en: string; cerrado_en: string | null;
}
export interface MovimientoCaja { id: string; tipo: string; concepto: string; monto: number; referencia: string | null; creado_por_nombre: string | null; creado_en: string; fotos?: number }
export interface CuadreTurno {
  id: string; caja: string; caja_id: string; tienda_id: string; usuario_nombre: string | null; base_inicial: number; estado: string; abierto_en: string;
  cerrado_en: string | null; diferencia: number | null; efectivo_esperado: number;
  ventas_por_metodo: { metodo: string; ventas: number; total: number; por_verificar: number }[]; ventas: number; anuladas: number;
  movimientos: MovimientoCaja[]; movimientos_por_tipo: Record<string, number>;
}

// ── Traslados ──
export interface TrasladoFila {
  id: string; numero: string; origen_tienda_id: string; destino_tienda_id: string; estado: string; observacion: string | null;
  creado_en: string; enviado_en?: string | null; recibido_en?: string | null;
}
export interface TrasladoLinea { id: string; producto_id: string; variante_id: string | null; cantidad_enviada: number; cantidad_recibida: number | null }

// ── Puntos y premios (ms-store V34) ───────────────────────────────────────────
export interface NivelPuntos { codigo: 'BRONCE' | 'PLATA' | 'ORO' | 'DIAMANTE'; nombre: string; desde: number; siguiente: string | null; siguiente_desde: number | null; faltan: number; progreso: number; }
export interface MovimientoPuntos { id: string; puntos: number; saldo_despues: number; origen: string; referencia: string; descripcion: string | null; creado_en: string; }
export interface ResumenPuntos {
  cedula: string; saldo: number; ganados_total: number; canjeados_total: number; racha: number; racha_max: number;
  ingreso_hoy: boolean; ingreso_diario: number; bono_racha: number; nivel: NivelPuntos;
  reglas: Array<{ codigo: string; nombre: string; descripcion: string; valor: string }>;
  movimientos?: MovimientoPuntos[];
}
export interface IngresoDiario { ya_reclamado: boolean; ganados: number; bono_racha: number; racha: number; saldo: number; }
export interface PremioPuntos {
  id: string; nombre: string; descripcion: string | null; categoria: string | null; imagen: string | null; puntos: number;
  nivel_minimo: string; existencias: number | null; limite_por_persona: number | null; destacado: boolean | number; orden: number;
  producto_id: string | null; variante_id: string | null; tienda_id: string | null; negocio_id: string | null; vigente_hasta: string | null;
  valor_pesos: number | null; mis_canjes: number; bloqueado_por_nivel: boolean; agotado: boolean; limite_alcanzado: boolean; faltan: number; alcanzable: boolean;
}
export interface CanjePuntos {
  id: string; codigo: string; cedula: string; nombre: string | null; premio_id: string; premio_nombre: string; puntos: number;
  tienda_id: string | null; estado: 'SOLICITADO' | 'ENTREGADO' | 'CANCELADO' | 'VENCIDO'; vence_en: string; entregado_en: string | null;
  entregado_por_nombre: string | null; canal_entrega: string | null; venta_id: string | null; cancelado_en: string | null; motivo: string | null;
  creado_en: string; vencido: number | boolean; premio_imagen: string | null; premio_descripcion: string | null; premio_categoria: string | null;
  tienda_nombre: string | null; saldo_persona?: number; origen?: 'CANJE' | 'RULETA' | string;
}

// ── Ruleta diaria y minijuegos (ms-store V34_5) ──
export interface OpcionRuleta {
  id: string; tipo: 'PUNTOS' | 'PREMIO'; puntos: number | null; premio_id: string | null; etiqueta: string; color: string | null;
  peso: number; orden: number; premio_nombre: string | null; premio_imagen: string | null; probabilidad: number;
}
export interface GiroRuleta {
  id: string; opcion_id: string; tipo: 'PUNTOS' | 'PREMIO'; puntos: number; premio_id: string | null; premio_nombre: string | null;
  canje_id: string | null; dia: string; etiqueta: string; color: string | null; premio_imagen: string | null; canje_codigo: string | null;
  canje_estado: string | null; canje_vence_en: string | null; tienda_nombre: string | null;
  ya_girado?: boolean; indice?: number; racha?: number; bono_racha?: number; saldo?: number;
}
export interface EstadoRuleta { girada_hoy: boolean; hoy: GiroRuleta | null; opciones: OpcionRuleta[]; proximo_giro: string; bono_racha: number; }
export interface PremiosPodio { nivel: 'BASE' | 'MEDIO' | 'ALTO'; primero: number; segundo: number; tercero: number; jugadores?: number; faltan?: number; }
export interface PuestoRanking { puesto: number; nombre: string; puntaje: number; logrado_en: string; yo: boolean; }
export interface MiPuesto { puesto: number; puntaje: number; }
export interface RecordJuego { nombre: string; puntaje: number; logrado_en: string; }
export interface JuegoResumen {
  codigo: string; nombre: string; descripcion: string; icono: string; duracion_seg: number; partidas_dia: number; torneo: boolean;
  partidas_hoy: number; mi_mejor_semana: number | null; mi_record: number | null; record: RecordJuego | null; jugadores_semana: number;
}
export interface PodioSemana { puesto: number; nombre: string; puntaje: number; puntos_premio: number; }
export interface SemanaCerrada { semana: string; juego_codigo: string; juego_nombre: string; participantes: number; nivel_premio: string; podio: PodioSemana[]; }
export interface ResumenJuegos {
  semana: {
    semana: string; fin: string; cierra_en: string; juego: string; participantes: number; premios: PremiosPodio;
    siguiente?: PremiosPodio; niveles: PremiosPodio[]; podio: PuestoRanking[]; yo: MiPuesto | null;
  };
  juegos: JuegoResumen[];
  salon_fama: SemanaCerrada[];
  mis_premios: Array<{ semana: string; juego_codigo: string; juego_nombre: string; puesto: number; puntaje: number; puntos_premio: number; creado_en: string }>;
}
export interface RankingJuego { juego: string; semana: string; cierra_en: string; participantes: number; top: PuestoRanking[]; yo: MiPuesto | null; record: RecordJuego | null; }
export interface HistorialJuegos {
  semanas: SemanaCerrada[];
  mis_marcas: Array<{ semana: string; juego_codigo: string; juego_nombre: string; mejor: number; partidas: number }>;
  mis_records: Array<{ juego_codigo: string; juego_nombre: string; record: number; partidas: number }>;
}
export interface PartidaIniciada { id: string; juego: string; semilla: number; duracion_seg: number; partidas_restantes: number; }
export interface ResultadoPartida {
  id: string; juego: string; estado: string; aceptada: boolean; motivo: string | null; puntaje: number; nuevo_record: boolean; mejor_semana: boolean;
  yo: MiPuesto | null; record: RecordJuego | null; participantes: number;
}
export interface JuegosAdmin {
  semana: string; cierra_en: string; torneo: string; participantes: number; rechazadas_7_dias: number;
  juegos: Array<{ codigo: string; nombre: string; duracion_seg: number; puntaje_max: number; partidas_dia: number; destacado: number; activo: number; orden: number }>;
  semanas: SemanaCerrada[];
  ruleta: { opciones: Array<OpcionRuleta & { activo: number; premio_existencias: number | null }>; ultimos_7_dias: Array<{ etiqueta: string; tipo: string; veces: number; puntos: number }>; giros_hoy: number };
}

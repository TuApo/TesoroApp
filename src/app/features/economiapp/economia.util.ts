import { obtenerUsuarioActual } from '../../core/utils/usuario-actual';
import { ArticuloComprador, CupoMarketplace } from '../dashboard/submodule/tienda/service/tienda.service';

/** Pesos colombianos sin decimales: es como se lee un precio en la calle. */
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export function pesos(valor: number | null | undefined): string {
  if (valor == null || isNaN(Number(valor))) return '—';
  return COP.format(Number(valor));
}

/** Cuándo llega, dicho como lo diría una persona. */
export function llegada(a: Pick<ArticuloComprador, 'disponibilidad' | 'dias_entrega'>): string {
  if (a.disponibilidad === 'EN_STOCK') return 'Disponible hoy';
  if (a.disponibilidad === 'BAJO_PEDIDO') {
    const d = a.dias_entrega;
    if (!d) return 'Por encargo';
    return d === 1 ? 'Llega mañana' : `Llega en ${d} días`;
  }
  return 'No disponible';
}

/** La fecha estimada en que llegaría si se pide hoy. */
export function fechaLlegada(dias: number | null | undefined): string | null {
  if (!dias) return null;
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return f.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Por qué no se puede usar el cupo, o vacío si se puede. */
export function motivoSinCupo(c: CupoMarketplace | null | undefined, error?: string | null): string {
  if (!c) return error ? 'No pudimos consultar su bono mercado ahora mismo' : 'No pudimos consultar su bono mercado';
  if (!c.existe) return 'No tiene bono mercado registrado';
  if (c.bloqueado) return c.motivo_bloqueo || 'Su bono mercado está bloqueado';
  if (!c.activo) return 'Su bono mercado no está activo';
  return '';
}

/** Icono de Material para una categoría cuando no trae imagen. */
export function iconoCategoria(nombre: string | null | undefined, icono?: string | null): string {
  if (icono && icono !== 'category') return icono;
  const n = (nombre || '').toLowerCase();
  if (/celular|tel[eé]fono|smart/.test(n)) return 'smartphone';
  if (/tecno|computa|port[aá]til|electr/.test(n)) return 'devices';
  if (/audio|aud[ií]f|parlante/.test(n)) return 'headphones';
  if (/experien|viaje|plan|entrada|evento/.test(n)) return 'confirmation_number';
  if (/hogar|casa|electrodom/.test(n)) return 'chair';
  if (/aseo|limpi/.test(n)) return 'cleaning_services';
  if (/beb|jugo|gaseosa/.test(n)) return 'local_drink';
  if (/fruta|verdura/.test(n)) return 'nutrition';
  if (/carne|pollo|pesc/.test(n)) return 'set_meal';
  if (/l[aá]cteo|leche|queso/.test(n)) return 'egg';
  if (/mercado|abarrote|grano|despensa/.test(n)) return 'shopping_basket';
  if (/ropa|calzado|moda/.test(n)) return 'checkroom';
  if (/belleza|cuidado|personal/.test(n)) return 'spa';
  if (/beb[eé]|ni[nñ]o|jugue/.test(n)) return 'child_care';
  if (/herram|ferret/.test(n)) return 'construction';
  return 'category';
}

/** Un tono estable por texto, para que cada producto sin foto tenga su color. */
export function tono(texto: string | null | undefined): number {
  let h = 0;
  for (const c of texto || '') h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Estados del pedido en lenguaje humano (mismo vocabulario de Mis pedidos). */
export const ESTADO_PEDIDO: Record<string, { texto: string; icono: string; tono: 'info' | 'ok' | 'warn' | 'danger' | 'neutro' }> = {
  CREADO: { texto: 'Esperando que la tienda lo confirme', icono: 'hourglass_top', tono: 'info' },
  CONFIRMADO: { texto: 'Confirmado, en cola', icono: 'task_alt', tono: 'info' },
  ALISTANDO: { texto: 'La tienda lo está alistando', icono: 'inventory_2', tono: 'info' },
  LISTO: { texto: 'Listo para recoger', icono: 'storefront', tono: 'ok' },
  EN_RUTA: { texto: 'En camino', icono: 'two_wheeler', tono: 'info' },
  ENTREGADO: { texto: 'Entregado', icono: 'check_circle', tono: 'ok' },
  CANCELADO: { texto: 'Cancelado por usted', icono: 'cancel', tono: 'neutro' },
  RECHAZADO: { texto: 'Rechazado por la tienda', icono: 'block', tono: 'danger' },
};

export const ESTADO_CUPO: Record<string, string> = {
  BLOQUEADO: 'Apartado de su bono mercado · todavía no se le ha descontado',
  EJECUTADO: 'Descontado de su bono mercado',
  LIBERADO: 'Devuelto a su bono mercado',
  FALLIDO: 'No se pudo apartar',
};

export const TIPO_ENTREGA: Record<string, { texto: string; icono: string }> = {
  RECOGE_TIENDA: { texto: 'Recoge en la tienda', icono: 'storefront' },
  RECOGE_OFICINA: { texto: 'Recoge en su oficina', icono: 'apartment' },
  DOMICILIO: { texto: 'Domicilio', icono: 'two_wheeler' },
};

/** Los pasos que recorre un pedido, para la línea de tiempo. */
export const PASOS_PEDIDO = ['CREADO', 'CONFIRMADO', 'ALISTANDO', 'LISTO', 'ENTREGADO'];

export function mensajeError(e: unknown, porDefecto: string): string {
  const err = e as { status?: number; error?: { error?: string; message?: string; detail?: string } };
  if (err?.status === 0) return 'Sin conexión. Revise su internet e intente de nuevo.';
  return err?.error?.error || err?.error?.message || err?.error?.detail || porDefecto;
}

/**
 * Datos de la persona en sesión para prellenar el pedido. El nombre sale del helper
 * canónico (tolera las tres formas en que el login ha guardado al usuario); el teléfono,
 * de donde lo haya dejado el login, si lo dejó.
 */
export function usuarioEnSesion(): { nombre: string; primerNombre: string; telefono: string; correo: string } {
  const u = obtenerUsuarioActual();
  let telefono = '';
  try {
    const crudo = JSON.parse(localStorage.getItem('user') || '{}');
    const b = crudo?.datos_basicos ?? {};
    telefono = String(b.celular || crudo.celular || b.telefono || crudo.telefono || '');
  } catch { /* sin storage */ }
  const primero = (u.nombreCompleto.split(' ')[0] || '').toLowerCase();
  return {
    nombre: titulo(u.nombreCompleto),
    primerNombre: primero ? primero.charAt(0).toUpperCase() + primero.slice(1) : '',
    telefono,
    correo: u.email,
  };
}

/** "JUAN PÉREZ" → "Juan Pérez". */
function titulo(t: string): string {
  return t.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

/** El gancho de una promoción en pocas palabras, para sellos y banners. */
export function etiquetaPromocion(p: { tipo: string; valor: number | null; nxm_lleva: number | null; nxm_paga: number | null }): string {
  switch (p.tipo) {
    case 'PORCENTAJE': return p.valor ? `${Number(p.valor)}% de descuento` : 'Descuento';
    case 'MONTO_FIJO': return p.valor ? `${pesos(p.valor)} menos` : 'Descuento';
    case 'PRECIO_ESPECIAL': return p.valor ? `A solo ${pesos(p.valor)}` : 'Precio especial';
    case 'NXM': return p.nxm_lleva && p.nxm_paga ? `Lleve ${p.nxm_lleva}, pague ${p.nxm_paga}` : 'Pague menos';
    case 'REGALO': return 'Con regalo';
    case 'ENVIO_GRATIS': return 'Domicilio gratis';
    default: return 'Oferta';
  }
}

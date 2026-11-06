import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ECO_API_BASE, ECO_TOKEN, ConexionSse, EstadoSse, conectarSse } from './eco-portable';

/** Columnas del tablero (ms-store V44). Se derivan del estado del pedido. */
export type ColumnaKanban = 'NUEVO' | 'EN_PREPARACION' | 'EN_DESPACHO' | 'ENTREGADO' | 'CANCELADO';
export type Semaforo = 'VERDE' | 'AMBAR' | 'ROJO';

export interface TarjetaPedido {
  id: string; numero: string; tienda_id: string; estado: string; columna: ColumnaKanban;
  tipo_entrega: 'RECOGE_TIENDA' | 'RECOGE_OFICINA' | 'DOMICILIO' | string;
  cliente_cedula: string; cliente_nombre: string | null; cliente_telefono: string | null;
  direccion_texto: string | null; total: number; bajo_pedido: boolean; validacion_estado: string;
  observacion: string | null; motivo_rechazo: string | null;
  creado_en: string; confirmado_en: string | null; entregado_en: string | null;
  programado_en: string | null; programado_hasta: string | null; fecha_compromiso: string | null;
  lineas: number; zona_nombre?: string | null; zona_color?: string | null;
  repartidor_nombre?: string | null; domicilio_estado?: string | null;
  promesa_en: string | null; minutos_espera: number | null; minutos_restantes: number | null; semaforo: Semaforo | null;
}

export interface ColumnaTablero { clave: ColumnaKanban; nombre: string; pedidos: TarjetaPedido[]; }
export interface Tablero { columnas: ColumnaTablero[]; retrasados: number; generado_en: string; }

/**
 * Cliente del tablero kanban. Portable: solo depende de HttpClient y de los tokens de
 * `eco-portable.ts` (base del API y token de sesión).
 */
@Injectable({ providedIn: 'root' })
export class TableroApi {
  private http = inject(HttpClient);
  private base = inject(ECO_API_BASE);
  private token = inject(ECO_TOKEN);

  tablero(tienda: string, filtros: { tipoEntrega?: string; q?: string } = {}): Observable<Tablero> {
    let p = new HttpParams().set('tienda', tienda);
    if (filtros.tipoEntrega) p = p.set('tipo_entrega', filtros.tipoEntrega);
    if (filtros.q) p = p.set('q', filtros.q);
    return this.http.get<Tablero>(`${this.base}/pedidos/tablero`, { params: p });
  }

  tarjeta(id: string): Observable<TarjetaPedido> {
    return this.http.get<TarjetaPedido>(`${this.base}/pedidos/${id}/tarjeta`);
  }

  mover(id: string, columna: ColumnaKanban, extra: { motivo?: string; comentario?: string; efectivoRecibido?: boolean } = {}): Observable<TarjetaPedido> {
    return this.http.post<TarjetaPedido>(`${this.base}/pedidos/${id}/mover`,
      { columna, motivo: extra.motivo, comentario: extra.comentario, efectivo_recibido: extra.efectivoRecibido ?? false });
  }

  fijarPromesa(id: string, promesaEn: string | null): Observable<TarjetaPedido> {
    return this.http.put<TarjetaPedido>(`${this.base}/pedidos/${id}/promesa`, { promesa_en: promesaEn });
  }

  /** Detalle completo del pedido (líneas, seguimiento, pagos), del API de gestión ya existente. */
  detalle(id: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.base}/gestion/pedidos/${id}`);
  }

  /** Canal en vivo: eventos `pedido` (tarjeta), `conectado` y `latido`. */
  stream(tienda: string, onTarjeta: (t: TarjetaPedido) => void, onEstado?: (e: EstadoSse) => void): ConexionSse {
    return conectarSse(`${this.base}/pedidos/stream?tienda=${encodeURIComponent(tienda)}`, this.token,
      (nombre, datos) => { if (nombre === 'pedido') onTarjeta(datos as TarjetaPedido); }, onEstado);
  }
}

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ECO_API_BASE } from '../kanban/eco-portable';

/** Zona de domicilio con su tarifa (ms-store V44, `store_zona_domicilio`). */
export interface ZonaDomicilio {
  id?: string; negocio_id?: string; tienda_id: string | null; nombre: string; tipo: 'RADIO' | 'POLIGONO';
  centro_lat: number | null; centro_lng: number | null; radio_km: number | null; poligono_json: string | null;
  tarifa: number; pedido_minimo: number | null; gratis_desde: number | null; tiempo_prometido_min: number;
  orden: number; color: string | null; activa: boolean; creado_en?: string;
}

export interface Cotizacion {
  hay_zonas: boolean; fuera_de_cobertura: boolean; zona_id: string | null; zona_nombre: string | null;
  tarifa: number; gratis: boolean; tiempo_prometido_min: number | null; pedido_minimo: number | null;
  cumple_minimo: boolean; distancia_km: number | null; origen: 'ZONA' | 'TIENDA' | 'FUERA' | 'SIN_PUNTO';
}

/** Cliente de zonas y cotización. Portable (solo `ECO_API_BASE`). */
@Injectable({ providedIn: 'root' })
export class ZonasApi {
  private http = inject(HttpClient);
  private base = inject(ECO_API_BASE);

  deTienda(tienda: string): Observable<ZonaDomicilio[]> {
    return this.http.get<ZonaDomicilio[]>(`${this.base}/zonas`, { params: { tienda } });
  }

  guardar(tienda: string, z: Partial<ZonaDomicilio> & { del_negocio?: boolean }): Observable<ZonaDomicilio> {
    return this.http.post<ZonaDomicilio>(`${this.base}/zonas`, z, { params: { tienda } });
  }

  desactivar(tienda: string, id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/zonas/${id}`, { params: { tienda } });
  }

  /** Por coordenadas o por una dirección guardada (V20) de quien pregunta. */
  cotizar(tienda: string, punto: { lat?: number; lng?: number; direccionId?: string }, subtotal?: number): Observable<Cotizacion> {
    let p = new HttpParams().set('tienda', tienda);
    if (punto.direccionId) p = p.set('direccion_id', punto.direccionId);
    if (punto.lat != null && punto.lng != null) p = p.set('lat', punto.lat).set('lng', punto.lng);
    if (subtotal != null) p = p.set('subtotal', subtotal);
    return this.http.get<Cotizacion>(`${this.base}/zonas/cotizar`, { params: p });
  }
}

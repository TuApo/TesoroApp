import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

/** Datos de un sticker (el QR y el código de barras los dibuja el front). */
export interface Etiqueta {
  id: number; codigo: string; nombre: string; categoriaNombre: string | null;
  serial: string | null; sedeNombre: string | null; qrContenido: string | null;
  placa: string | null; marca: string | null; modelo: string | null;
  estado: string | null; codigoBarras: string | null;
}

export interface Sede { id: string; nombre: string; activa?: boolean; }
export interface Categoria { id: number; nombre: string; }

/** Cliente de etiquetas/stickers de activos (ms-assets). */
@Injectable({ providedIn: 'root' })
export class EtiquetasService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/assets`;

  /** Etiquetas por filtro, organizadas por sede (para imprimir todos los de una oficina). */
  etiquetas(filtros: { q?: string; estado?: string; sede_id?: string; categoria_id?: number; limite?: number }): Observable<Etiqueta[]> {
    const params: Record<string, string> = {};
    if (filtros.q) params['q'] = filtros.q;
    if (filtros.estado) params['estado'] = filtros.estado;
    if (filtros.sede_id) params['sede_id'] = filtros.sede_id;
    if (filtros.categoria_id != null) params['categoria_id'] = String(filtros.categoria_id);
    if (filtros.limite != null) params['limite'] = String(filtros.limite);
    return this.http.get<Etiqueta[]>(`${this.base}/etiquetas`, { params });
  }

  /** Etiquetas de ids concretos (desde una selección en el inventario). */
  etiquetasDeIds(ids: number[]): Observable<Etiqueta[]> {
    return this.http.post<Etiqueta[]>(`${this.base}/etiquetas`, { ids });
  }

  sedes(): Observable<Sede[]> { return this.http.get<Sede[]>(`${this.base}/sedes`); }
  categorias(): Observable<Categoria[]> { return this.http.get<Categoria[]>(`${this.base}/categorias`, { params: { solo_activas: 'true' } }); }
}

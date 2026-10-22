import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

/** Analítica de actividad y mapa de proceso (ms-assets). Server en snake_case. */
export interface CategoriaTiempo { categoria: string; segundos: number; pct: number; }
export interface HoraTiempo { hora: number; segundos: number; }
export interface AppTiempo { app: string; segundos: number; }
export interface Arista { desde: string; hacia: string; conteo: number; }
export interface Nodo { categoria: string; segundos: number; }

export interface ResumenActividad {
  endpointId: number; personaRef: string | null; desde: string; hasta: string;
  totalSegundos: number; categorias: CategoriaTiempo[]; horasPico: HoraTiempo[];
  topApps: AppTiempo[]; transiciones: Arista[];
}
export interface MapaProceso { desde: string; hasta: string; nodos: Nodo[]; aristas: Arista[]; }
export interface PerfilActividad {
  endpointId: number; personaRef: string | null; desde: string; hasta: string;
  narrativa: string | null; procesos: Array<Record<string, unknown>>; horasPico: HoraTiempo[]; generado: string;
}

@Injectable({ providedIn: 'root' })
export class ActividadService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/assets/actividad`;

  resumen(endpointId: number, desde?: string, hasta?: string): Observable<ResumenActividad> {
    return this.http.get<ResumenActividad>(`${this.base}/${endpointId}/resumen`, { params: this.rango(desde, hasta) });
  }
  mapa(endpointId: number, desde?: string, hasta?: string): Observable<MapaProceso> {
    return this.http.get<MapaProceso>(`${this.base}/${endpointId}/mapa`, { params: this.rango(desde, hasta) });
  }
  mapaGlobal(desde?: string, hasta?: string): Observable<MapaProceso> {
    return this.http.get<MapaProceso>(`${this.base}/mapa`, { params: this.rango(desde, hasta) });
  }
  perfil(endpointId: number): Observable<PerfilActividad> {
    return this.http.get<PerfilActividad>(`${this.base}/${endpointId}/perfil`);
  }
  generarPerfil(endpointId: number, desde?: string, hasta?: string): Observable<PerfilActividad> {
    return this.http.post<PerfilActividad>(`${this.base}/${endpointId}/perfil`, {}, { params: this.rango(desde, hasta) });
  }
  recalcular(fecha?: string): Observable<{ fecha: string; equipos: number }> {
    return this.http.post<{ fecha: string; equipos: number }>(`${this.base}/recalcular`, {}, { params: fecha ? { fecha } : {} });
  }
  contextoAgente(endpointId: number, desde?: string, hasta?: string): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(`${this.base}/${endpointId}/contexto-agente`, {}, { params: this.rango(desde, hasta) });
  }

  private rango(desde?: string, hasta?: string): Record<string, string> {
    const p: Record<string, string> = {};
    if (desde) p['desde'] = desde;
    if (hasta) p['hasta'] = hasta;
    return p;
  }
}

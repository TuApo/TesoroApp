import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  AgenteIn, AgenteInfra, AltaAgente, DetalleCluster, DetalleDatos, DetalleRed, DetalleSitios, EquipoVista, Evento, Grafica,
  Informe, InformeMeta, LineaLog, Rango, ResumenUbicaciones, Snapshot, Ubicacion, UbicacionIn, UsoGlobal,
} from '../models/infra.models';

/** Llamadas a ms-infra. Lectura, salvo generar un informe y administrar ubicaciones remotas y sus equipos. */
@Injectable({ providedIn: 'root' })
export class InfraService {
  private readonly http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1/infra`;

  /** El canal SSE se abre con fetch (lleva cabecera Authorization): ver InfraVivoService. */
  urlStream(): string {
    return `${this.base}/stream`;
  }

  acceso(): Observable<{ permitido: boolean; roles: string[] }> {
    return this.http.get<{ permitido: boolean; roles: string[] }>(`${this.base}/acceso`);
  }

  snapshot(): Observable<Snapshot> {
    return this.http.get<Snapshot>(`${this.base}/snapshot`);
  }

  eventos(limite = 300): Observable<Evento[]> {
    return this.http.get<Evento[]>(`${this.base}/eventos`, { params: { limite } });
  }

  servicios(rango: Rango): Observable<UsoGlobal> {
    return this.http.get<UsoGlobal>(`${this.base}/servicios`, { params: { rango } });
  }

  sitios(rango: Rango): Observable<DetalleSitios> {
    return this.http.get<DetalleSitios>(`${this.base}/sitios`, { params: { rango } });
  }

  red(rango: Rango): Observable<DetalleRed> {
    return this.http.get<DetalleRed>(`${this.base}/red`, { params: { rango } });
  }

  datos(): Observable<DetalleDatos> {
    return this.http.get<DetalleDatos>(`${this.base}/datos`);
  }

  cluster(): Observable<DetalleCluster> {
    return this.http.get<DetalleCluster>(`${this.base}/cluster`);
  }

  serie(clave: string, rango: Rango, objeto?: string | null): Observable<Grafica> {
    let params = new HttpParams().set('clave', clave).set('rango', rango);
    if (objeto) params = params.set('objeto', objeto);
    return this.http.get<Grafica>(`${this.base}/serie`, { params });
  }

  logs(contenedor: string, nivel: 'error' | 'warn' | 'todo', limite = 80): Observable<LineaLog[]> {
    return this.http.get<LineaLog[]>(`${this.base}/logs`, { params: { contenedor, nivel, limite } });
  }

  informes(): Observable<InformeMeta[]> {
    return this.http.get<InformeMeta[]>(`${this.base}/informes`);
  }

  informe(id: string): Observable<Informe> {
    return this.http.get<Informe>(`${this.base}/informes/${encodeURIComponent(id)}`);
  }

  generarInforme(rango: Rango): Observable<Informe> {
    return this.http.post<Informe>(`${this.base}/informes`, null, { params: { rango } });
  }

  // ── Ubicaciones remotas y sus equipos ─────────────────────────────────────

  ubicaciones() {
    return this.http.get<ResumenUbicaciones>(`${this.base}/ubicaciones`);
  }

  crearUbicacion(u: UbicacionIn) {
    return this.http.post<Ubicacion>(`${this.base}/ubicaciones`, u);
  }

  editarUbicacion(id: string, u: UbicacionIn) {
    return this.http.put<Ubicacion>(`${this.base}/ubicaciones/${encodeURIComponent(id)}`, u);
  }

  borrarUbicacion(id: string) {
    return this.http.delete<void>(`${this.base}/ubicaciones/${encodeURIComponent(id)}`);
  }

  crearAgente(ubicacionId: string, a: AgenteIn) {
    return this.http.post<AltaAgente>(`${this.base}/ubicaciones/${encodeURIComponent(ubicacionId)}/agentes`, a);
  }

  equipo(agenteId: string) {
    return this.http.get<EquipoVista>(`${this.base}/ubicaciones/agentes/${encodeURIComponent(agenteId)}`);
  }

  editarAgente(agenteId: string, a: AgenteIn) {
    return this.http.put<AgenteInfra>(`${this.base}/ubicaciones/agentes/${encodeURIComponent(agenteId)}`, a);
  }

  regenerarToken(agenteId: string) {
    return this.http.post<AltaAgente>(`${this.base}/ubicaciones/agentes/${encodeURIComponent(agenteId)}/token`, null);
  }

  borrarAgente(agenteId: string) {
    return this.http.delete<void>(`${this.base}/ubicaciones/agentes/${encodeURIComponent(agenteId)}`);
  }
}

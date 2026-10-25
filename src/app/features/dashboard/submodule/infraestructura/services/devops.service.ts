import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  DetalleEjecucion, Ejecucion, EstadoPlay, Integracion, Integridad, OrdenIn, OrdenOut, ResumenDevops, Trabajo,
} from '../models/devops.models';

/** Llamadas a la sección DevOps de ms-infra. Las órdenes las valida el servidor con lista cerrada. */
@Injectable({ providedIn: 'root' })
export class DevopsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/infra/devops`;

  resumen(): Observable<ResumenDevops> {
    return this.http.get<ResumenDevops>(this.base);
  }

  ejecuciones(flujo: string | null, max = 40): Observable<Ejecucion[]> {
    const params: Record<string, string | number> = { max };
    if (flujo) params['flujo'] = flujo;
    return this.http.get<Ejecucion[]>(`${this.base}/ejecuciones`, { params });
  }

  ejecucion(id: number): Observable<DetalleEjecucion> {
    return this.http.get<DetalleEjecucion>(`${this.base}/ejecuciones/${id}`);
  }

  cancelar(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/ejecuciones/${id}/cancelar`, {});
  }

  play(): Observable<EstadoPlay> {
    return this.http.get<EstadoPlay>(`${this.base}/play`);
  }

  integridad(): Observable<Integridad> {
    return this.http.get<Integridad>(`${this.base}/integridad`);
  }

  integraciones(): Observable<Integracion[]> {
    return this.http.get<Integracion[]>(`${this.base}/integraciones`);
  }

  ramas(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/ramas`);
  }

  ordenar(o: OrdenIn): Observable<OrdenOut> {
    return this.http.post<OrdenOut>(`${this.base}/ordenes`, o);
  }

  trabajos(): Observable<Trabajo[]> {
    return this.http.get<Trabajo[]>(`${this.base}/trabajos`);
  }

  trabajo(id: string): Observable<Trabajo> {
    return this.http.get<Trabajo>(`${this.base}/trabajos/${id}`);
  }
}

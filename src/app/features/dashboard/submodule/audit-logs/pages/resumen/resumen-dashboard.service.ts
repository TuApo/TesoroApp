import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';

@Injectable({ providedIn: 'root' })
export class ResumenDashboardService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  getContratacionMetricas(start: string, end: string): Observable<any> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get<any>(`${this.api}/gestion_contratacion/procesos/metricas-temporal/`, { params })
      .pipe(catchError(() => of(null)));
  }

  getAfiliacionesResumen(desde: string, hasta: string, oficina?: string): Observable<any> {
    let params = new HttpParams()
      .set('base', 'firma')
      .set('desde', desde)
      .set('hasta', hasta);
    if (oficina) params = params.set('oficina', oficina);
    return this.http.get<any>(`${this.api}/gestion_afiliaciones/contratos/resumen`, { params })
      .pipe(catchError(() => of(null)));
  }

  getAfiliacionesTimeline(desde: string, hasta: string, oficina?: string): Observable<any[]> {
    let params = new HttpParams()
      .set('dim', 'oficina')
      .set('base', 'firma')
      .set('gran', 'mes')
      .set('desde', desde)
      .set('hasta', hasta)
      .set('solo_activos', 'false');
    if (oficina) params = params.set('oficina', oficina);
    return this.http.get<any[]>(`${this.api}/gestion_afiliaciones/contratos/timeline`, { params })
      .pipe(catchError(() => of([])));
  }

  getTesoreriaStats(): Observable<any> {
    return this.http.get<any>(`${this.api}/gestion_tesoreria/metricas-resumen`)
      .pipe(catchError(() => of(null)));
  }

  getLegalPorTipo(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/legal/dashboard/por-tipo`)
      .pipe(catchError(() => of([])));
  }

  getLegalPorEstado(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/legal/dashboard/por-estado`)
      .pipe(catchError(() => of([])));
  }

  getLegalVencimientos(): Observable<any[]> {
    const params = new HttpParams().set('dias', '30');
    return this.http.get<any[]>(`${this.api}/legal/dashboard/vencimientos-proximos`, { params })
      .pipe(catchError(() => of([])));
  }

  getBugStats(): Observable<any> {
    return this.http.get<any>(`${this.api}/bug_tickets/estadisticas/`)
      .pipe(catchError(() => of(null)));
  }

  getAuditStats(): Observable<any> {
    return this.http.get<any>(`${this.api}/api/v1/admin/logs/stats`)
      .pipe(catchError(() => of(null)));
  }

  getSedes(): Observable<any[]> {
    return this.http.get<any>(`${this.api}/gestion_admin/sedes/`).pipe(
      map(res => res?.results || (Array.isArray(res) ? res : [])),
      catchError(() => of([]))
    );
  }
}

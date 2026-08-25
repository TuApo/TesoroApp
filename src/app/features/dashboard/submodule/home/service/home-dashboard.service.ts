import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';

@Injectable({ providedIn: 'root' })
export class HomeDashboardService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  loadProcesos(): Observable<any[]> {
    const params = new HttpParams().set('limit', '3000').set('ordering', '-updated_at');
    return this.http.get<any>(`${this.api}/gestion_contratacion/procesos/`, { params }).pipe(
      map(res => (res?.results || []) as any[]),
      catchError(() => of([] as any[]))
    );
  }

  loadVacantes(): Observable<{ activas: number; total: number }> {
    return this.http.get<any>(`${this.api}/publicacion/publicaciones/?limit=500`).pipe(
      map(res => {
        const items: any[] = res?.results || (Array.isArray(res) ? res : []);
        return { activas: items.filter((v: any) => v.activo).length, total: items.length };
      }),
      catchError(() => of({ activas: 0, total: 0 }))
    );
  }

  loadAfiliacionesResumen(sede?: string): Observable<any> {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    let params = new HttpParams()
      .set('base_fecha', 'firma')
      .set('fecha_inicio', start.toISOString().split('T')[0])
      .set('fecha_fin', today.toISOString().split('T')[0]);
    if (sede) params = params.set('sede', sede);
    return this.http.get<any>(`${this.api}/gestion_afiliaciones/contratos/resumen`, { params }).pipe(
      catchError(() => of(null))
    );
  }

  loadAfiliacionesTimeline(sede?: string): Observable<any[]> {
    const today = new Date();
    const desde = `${today.getFullYear() - 1}-01-01`;
    const hasta = today.toISOString().split('T')[0];
    let params = new HttpParams()
      .set('dim', 'oficina')
      .set('base', 'firma')
      .set('gran', 'mes')
      .set('desde', desde)
      .set('hasta', hasta)
      .set('solo_activos', 'false');
    if (sede) params = params.set('oficina', sede);
    return this.http.get<any[]>(`${this.api}/gestion_afiliaciones/contratos/timeline`, { params }).pipe(
      catchError(() => of([] as any[]))
    );
  }

  loadSedes(): Observable<any[]> {
    return this.http.get<any>(`${this.api}/gestion_admin/sedes/`).pipe(
      map(res => (res?.results || (Array.isArray(res) ? res : [])) as any[]),
      catchError(() => of([] as any[]))
    );
  }
}

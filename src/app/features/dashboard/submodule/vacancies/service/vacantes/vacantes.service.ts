import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { environment } from '@/environments/environment';

@Injectable({ providedIn: 'root' })
export class VacantesService {
  private apiUrl = environment.apiUrl; // ej: https://tuservidor/api

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  // ========= Helpers =========
  private base(path: string): string {
    const root = this.apiUrl.replace(/\/+$/, '');
    const p = path.replace(/^\/+/, '');
    return `${root}/${p}`;
  }

  private handleError(error: any) {
    return throwError(() => error);
  }

  // ========= Publicación (congruente con publicacion/urls.py) =========
  // activo: true (solo activas, default) | false (solo inactivas) | 'all' (todas)
  listarVacantes(activo: boolean | 'all' = true): Observable<any> {
    const url = this.base('/publicacion/publicaciones/');
    let params = new HttpParams();
    if (activo !== 'all') {
      params = params.set('activo', activo ? 'true' : 'false');
    }
    return this.http.get(url, { params })
      .pipe(catchError(this.handleError));
  }


  // VacantesService
  cambiarEstadoActivo(id: number | string, activo: boolean, motivo_inactivacion?: string) {
    const url = this.base(`/publicacion/publicaciones/${id}/`);
    const body: any = { activo };
    if (motivo_inactivacion !== undefined) body.motivo_inactivacion = motivo_inactivacion;
    return this.http.patch(url, body).pipe(
      catchError(this.handleError)
    );
  }


  // (Opcional) Alternativa para hacer toggle rápido desde el valor actual
  toggleActivo(id: number | string, activoActual: boolean): Observable<any> {
    return this.cambiarEstadoActivo(id, !activoActual);
  }

  enviarVacante(vacanteData: any): Observable<any> {
    const url = this.base('/publicacion/publicaciones/');
    return this.http.post(url, vacanteData).pipe(map(res => res), catchError(this.handleError));
  }

  // GET/PUT/DELETE -> /publicacion/publicaciones/<id>/
  obtenerVacante(id: number | string): Observable<any> {
    const url = this.base(`/publicacion/publicaciones/${id}/`);
    return this.http.get(url).pipe(map(res => res), catchError(this.handleError));
  }

  actualizarVacante(id: number | string, vacanteData: any): Observable<any> {
    const url = this.base(`/publicacion/publicaciones/${id}/`);
    return this.http.put(url, vacanteData).pipe(map(res => res), catchError(this.handleError));
  }

  eliminarVacante(id: number | string): Observable<any> {
    const url = this.base(`/publicacion/publicaciones/${id}/`);
    return this.http.delete(url).pipe(map(res => res), catchError(this.handleError));
  }

  // PATCH -> /publicacion/cambioestado/<pk>/estado/<field>/
  // body: { cedula: string, op?: 'add' | 'remove' | 'toggle' }
  cambiarEstadoAplicante(
    pk: number | string,
    field: 'preseleccionado' | 'contratado',
    body: { cedula: string; op?: 'add' | 'remove' | 'toggle' }
  ): Observable<any> {
    const url = this.base(`/publicacion/cambioestado/${pk}/estado/${field}/`);
    return this.http.patch(url, body).pipe(map(res => res), catchError(this.handleError));
  }

  // GET -> /publicacion/vacantes-por-nombre-oficina/<nombre_oficina>/
  // ========= Excel =========
  getVacantesExcel(start?: string, end?: string, oficina?: string | string[]): Observable<Blob> {
    const url = this.base('/publicacion/publicaciones-excel/');
    let params = new HttpParams();

    if (start) params = params.set('start', start);
    if (end) params = params.set('end', end);

    // Nuevo: filtro por OficinaQueContrata (uno o varios nombres)
    if (Array.isArray(oficina)) {
      const value = oficina
        .map(s => (s ?? '').trim())
        .filter(s => s.length > 0)
        .join(','); // el backend acepta coma o ';'
      if (value) params = params.set('oficina', value);
    } else if (typeof oficina === 'string' && oficina.trim()) {
      params = params.set('oficina', oficina.trim());
    }

    return this.http.get(url, { params, responseType: 'blob' as const })
      .pipe(catchError(err => throwError(() => err)));
  }


  downloadVacantesExcel(start?: string, end?: string, filename?: string): Observable<void> {
    const suggested = `vacantes_${start || 'inicio'}_${end || 'hoy'}.xlsx`;
    const name = filename || suggested;

    return this.getVacantesExcel(start, end).pipe(
      tap(blob => {
        if (!isPlatformBrowser(this.platformId)) return;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        window.URL.revokeObjectURL(url);
      }),
      map(() => void 0),
      catchError(err => throwError(() => err))
    );
  }
}

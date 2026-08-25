import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import { ModuleNode, Placement, PlacementRequest, RouteResolution } from '../models/placement.models';

/**
 * Ubicación de formularios dinámicos como vista de un módulo (endpoints /placement,
 * /modules/tree, /forms/resolve). El JWT lo añade el auth.interceptor.
 */
@Injectable({ providedIn: 'root' })
export class PlacementService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  /** Árbol de módulos donde el usuario puede colgar un formulario (hoja o raíz). */
  moduleTree(onlyManageable = true): Observable<ModuleNode[]> {
    const params = new HttpParams().set('only_manageable', String(onlyManageable));
    return this.http.get<ModuleNode[]>(`${this.base}/modules/tree`, { params });
  }

  getPlacement(formId: number): Observable<Placement> {
    return this.http.get<Placement>(`${this.base}/forms/${formId}/placement`);
  }

  /** Publicar (idempotente). */
  place(formId: number, req: PlacementRequest): Observable<Placement> {
    return this.http.post<Placement>(`${this.base}/forms/${formId}/placement`, req);
  }

  /** Mover / renombrar / reordenar (conserva módulo, permisos y respuestas). */
  move(formId: number, req: PlacementRequest): Observable<Placement> {
    return this.http.patch<Placement>(`${this.base}/forms/${formId}/placement`, req);
  }

  /** Desvincular del menú (conserva formulario y respuestas). */
  unlink(formId: number): Observable<Placement> {
    return this.http.delete<Placement>(`${this.base}/forms/${formId}/placement`);
  }

  /** Reintentar = reconciliar el estado real en ms-auth-admin. */
  retry(formId: number): Observable<Placement> {
    return this.http.post<Placement>(`${this.base}/forms/${formId}/placement/retry`, {});
  }

  /**
   * Resolver un formulario POR ID, para abrirlo con sus pestañas desde el LISTADO.
   * La resolución por ruta solo alcanza a los publicados en el menú; desde la pantalla
   * de gestión se abre cualquiera, incluidos los pendientes de ubicar.
   */
  resolveForm(formId: number): Observable<RouteResolution> {
    return this.http.get<RouteResolution>(`${this.base}/forms/${formId}/resolve`);
  }

  /**
   * Resolver una ruta (relativa a /dashboard) a un formulario. Devuelve null si esa
   * ruta no corresponde a ningún formulario dinámico. Usado por el canMatch guard.
   */
  resolveRoute(routePath: string): Observable<RouteResolution | null> {
    const params = new HttpParams().set('route_path', routePath);
    return this.http.get<RouteResolution>(`${this.base}/forms/resolve`, { params }).pipe(
      catchError(() => of(null)),
      map((r) => r ?? null),
    );
  }
}

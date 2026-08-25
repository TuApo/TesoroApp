import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, shareReplay, catchError } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  ChoiceOptionsResolver, ChoiceOptionsResult,
} from '@/app/shared/components/forms/choice-options';
import {
  OptionCatalog, OptionSource, OptionSourceRequest, OptionsResult,
} from '../models/option-source.models';

/**
 * Orígenes de opciones (ms-forms, /api/dynamic-forms/option-sources).
 *
 * Hace dos oficios:
 *  · CRUD del submódulo "Orígenes de opciones" (pantalla de administración)
 *  · RESOLVER las opciones de un campo al llenar — implementa el contrato
 *    ChoiceOptionsResolver que consumen los campos de selección de shared/,
 *    registrado contra CHOICE_OPTIONS_RESOLVER en app.config.ts.
 *
 * La resolución se cachea por (origen + valor del padre) mientras dure la pantalla: un
 * formulario con el mismo origen en varios campos pide una sola vez, y una cascada solo
 * vuelve a preguntar cuando cambia el valor del padre.
 */
@Injectable({ providedIn: 'root' })
export class OptionSourceService implements ChoiceOptionsResolver {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  private cache = new Map<string, Observable<OptionsResult>>();
  /** El listado lo piden todas las tarjetas del constructor: se comparte una sola llamada. */
  private listCache = new Map<string, Observable<OptionSource[]>>();

  // ---------- Catálogos ----------

  catalogs(): Observable<OptionCatalog[]> {
    return this.http.get<OptionCatalog[]>(`${this.base}/catalogs`);
  }

  /** Columnas del catálogo (las declaradas más las que traigan sus filas). */
  catalogColumns(code: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/catalogs/${encodeURIComponent(code)}/columns`);
  }

  // ---------- CRUD ----------

  list(includeInactive = false): Observable<OptionSource[]> {
    const key = String(includeInactive);
    const hit = this.listCache.get(key);
    if (hit) return hit;
    const params = new HttpParams().set('include_inactive', String(includeInactive));
    const req$ = this.http
      .get<OptionSource[]>(`${this.base}/option-sources`, { params })
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    this.listCache.set(key, req$);
    return req$;
  }

  create(req: OptionSourceRequest): Observable<OptionSource> {
    this.clearCache();
    return this.http.post<OptionSource>(`${this.base}/option-sources`, req);
  }

  update(id: number, req: OptionSourceRequest): Observable<OptionSource> {
    this.clearCache();
    return this.http.put<OptionSource>(`${this.base}/option-sources/${id}`, req);
  }

  remove(id: number): Observable<void> {
    this.clearCache();
    return this.http.delete<void>(`${this.base}/option-sources/${id}`);
  }

  // ---------- Resolución ----------

  /** Opciones ya filtradas por las reglas del origen para el usuario actual. */
  options(source: string, parent: string | null = null): Observable<OptionsResult> {
    const key = `${source}||${parent ?? ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    let params = new HttpParams();
    if (parent) params = params.set('parent', parent);
    const req$ = this.http
      .get<OptionsResult>(`${this.base}/option-sources/${encodeURIComponent(source)}/options`, { params })
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    this.cache.set(key, req$);
    return req$;
  }

  /** Contrato que consumen los campos de selección de shared/. */
  resolveOptions(source: string, parent: string | null): Observable<ChoiceOptionsResult> {
    return this.options(source, parent).pipe(
      map(r => ({
        options: (r.options ?? []).map(o => ({ value: o.value, label: o.label })),
        restricted: !!r.restricted,
        reason: r.reason ?? null,
        truncated: !!r.truncated,
      })),
      catchError(() => of({
        options: [],
        restricted: true,
        reason: 'catalogo_no_disponible',
        truncated: false,
      })),
    );
  }

  /** Tras editar orígenes hay que olvidar lo cacheado (las reglas pudieron cambiar). */
  clearCache(): void {
    this.cache.clear();
    this.listCache.clear();
  }
}

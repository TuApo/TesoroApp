// src/app/shared/services/gestion-parametrizacion.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, switchMap, shareReplay } from 'rxjs';
import { environment } from '@/environments/environment';

/** === Tipos del backend === */
export type CampoTipo = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'JSON' | 'ENUM';

export interface MetaCampo {
  id: string;
  campo: string;
  tipo: CampoTipo;
  obligatorio: boolean;
  visible: boolean;
  orden: number;
  activo: boolean;
  tabla?: string;
}

export interface MetaTabla {
  id: string;                  // UUID
  codigo: string;              // ej. "AFILIADO"
  descripcion?: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
  campos: MetaCampo[];
}

export interface MetaValor {
  id: string;                  // UUID
  tabla: string;               // UUID de MetaTabla
  datos: Record<string, any>;  // objeto validado por MetaCampo
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface DRFPaginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Filtros de list para meta/valores */
export interface MetaValorFilters {
  tablaCodigo?: string;   // ?tabla=AFILIADO (lookup por código)
  referencia?: string;
  activo?: boolean;
  page?: number;
  page_size?: number;
}

/** Filtros para meta/campos */
export interface MetaCampoFilters {
  tabla?: string;         // ?tabla=<uuid> o ?tabla=<codigo>
  activo?: boolean;
  page?: number;
  page_size?: number;
}

/** === Tipos “amigables” para UI (adaptadores) === */
export interface CatalogValue {
  codigo: string;
  descripcion?: string | null;
  /** Cualquier otro campo que venga en `datos` lo dejamos disponible */
  [k: string]: any;
}

export interface CatalogOption {
  value: string;
  label: string;
  raw: CatalogValue;      // por si necesitas el objeto original
}

@Injectable({ providedIn: 'root' })
export class GestionParametrizacionService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl.replace(/\/$/, '')}/gestion_catalogos`;

  // ===== Helpers =====
  private unwrapMaybePaginated<T>() {
    return map((res: T[] | DRFPaginated<T>) =>
      this.isPaginated(res) ? (res as DRFPaginated<T>).results : (res as T[])
    );
  }
  private isPaginated<T>(res: any): res is DRFPaginated<T> {
    return res && typeof res === 'object' && Array.isArray(res.results);
  }
  private qp(params?: Record<string, any>): HttpParams {
    let p = new HttpParams();
    if (!params) return p;
    Object.entries(params).forEach(([k, v]) => {
      if (v === null || v === undefined || v === '') return;
      if (typeof v === 'boolean') {
        p = p.set(k, v ? 'true' : 'false');
      } else {
        p = p.set(k, String(v));
      }
    });
    return p;
  }

  /** ===========================
   *  MetaTablas (CRUD)
   *  =========================== */
  listMetaTablas(params?: { created_from?: string; created_to?: string; ordering?: string; }): Observable<MetaTabla[]> {
    return this.http
      .get<MetaTabla[] | DRFPaginated<MetaTabla>>(
        `${this.base}/meta/tablas/`,
        { params: this.qp(params) }
      )
      .pipe(this.unwrapMaybePaginated<MetaTabla>());
  }

  getMetaTablaByCodigo(codigo: string): Observable<MetaTabla> {
    return this.http.get<MetaTabla>(`${this.base}/meta/tablas/${encodeURIComponent(codigo)}/`);
  }

  createMetaTabla(payload: Partial<MetaTabla>): Observable<MetaTabla> {
    return this.http.post<MetaTabla>(`${this.base}/meta/tablas/`, payload);
  }

  updateMetaTabla(codigo: string, partial: Partial<MetaTabla>): Observable<MetaTabla> {
    return this.http.patch<MetaTabla>(`${this.base}/meta/tablas/${encodeURIComponent(codigo)}/`, partial);
  }

  /** ===========================
   *  MetaCampos (CRUD)
   *  =========================== */
  listMetaCampos(filters: MetaCampoFilters = {}): Observable<MetaCampo[]> {
    const params = this.qp({
      tabla: filters.tabla,
      activo: filters.activo,
      page: filters.page,
      page_size: filters.page_size,
    });
    return this.http
      .get<MetaCampo[] | DRFPaginated<MetaCampo>>(`${this.base}/meta/campos/`, { params })
      .pipe(this.unwrapMaybePaginated<MetaCampo>());
  }

  createMetaCampo(payload: {
    tabla: string; campo: string; tipo: CampoTipo;
    obligatorio?: boolean; visible?: boolean; orden?: number; activo?: boolean;
  }): Observable<MetaCampo> {
    return this.http.post<MetaCampo>(`${this.base}/meta/campos/`, payload);
  }

  updateMetaCampo(id: string, partial: Partial<{
    campo: string; tipo: CampoTipo; obligatorio: boolean; visible: boolean; orden: number; activo: boolean;
  }>): Observable<MetaCampo> {
    return this.http.patch<MetaCampo>(`${this.base}/meta/campos/${encodeURIComponent(id)}/`, partial);
  }

  deleteMetaCampo(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/meta/campos/${encodeURIComponent(id)}/`);
  }

  /** ===========================
   *  MetaValores (CRUD)
   *  =========================== */
  listMetaValores(filters: MetaValorFilters = {}): Observable<MetaValor[]> {
    const params = this.qp({
      tabla: filters.tablaCodigo,         // backend espera 'tabla' (por código)
      referencia: filters.referencia,
      activo: filters.activo,
      page: filters.page,
      page_size: filters.page_size,
    });
    return this.http
      .get<MetaValor[] | DRFPaginated<MetaValor>>(`${this.base}/meta/valores/`, { params })
      .pipe(this.unwrapMaybePaginated<MetaValor>());
  }

  createMetaValor(payload: Pick<MetaValor, 'tabla' | 'datos'> & { activo?: boolean }): Observable<MetaValor> {
    return this.http.post<MetaValor>(`${this.base}/meta/valores/`, payload);
  }

  createMetaValorByCodigo(
    tablaCodigo: string,
    body: Omit<MetaValor, 'id' | 'tabla' | 'created_at' | 'updated_at'>
  ): Observable<MetaValor> {
    return this.getMetaTablaByCodigo(tablaCodigo).pipe(
      switchMap(tabla => this.createMetaValor({ tabla: tabla.id, datos: body.datos, activo: (body as any).activo }))
    );
  }

  patchMetaValor(id: string, partial: Partial<MetaValor>): Observable<MetaValor> {
    return this.http.patch<MetaValor>(`${this.base}/meta/valores/${encodeURIComponent(id)}/`, partial);
  }

  deleteMetaValor(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/meta/valores/${encodeURIComponent(id)}/`);
  }

  /** ===========================
   *  Valores por código de tabla (endpoint anidado)
   *  ===========================
   *  GET /meta/tablas/TIPO_CONTRATO/valores/?activo=true&referencia=XYZ
   */
  /** Cache de catálogos (por código+filtros): son datos de referencia estáticos y
   *  form-entrevista los re-pedía en cada apertura de pestaña. shareReplay evita
   *  el re-fetch dentro de la sesión (servicio singleton providedIn root). */
  private valoresCodigoCache = new Map<string, Observable<MetaValor[]>>();

  listMetaValoresByTablaCodigo(
    codigo: string,
    filters: Omit<MetaValorFilters, 'tablaCodigo'> = {}
  ): Observable<MetaValor[]> {
    const key = `${codigo}|${filters.activo ?? ''}|${filters.referencia ?? ''}|${filters.page ?? ''}|${filters.page_size ?? ''}`;
    const cached = this.valoresCodigoCache.get(key);
    if (cached) return cached;

    const params = this.qp({
      referencia: filters.referencia,
      activo: filters.activo,
      page: filters.page,
      page_size: filters.page_size,
    });
    const obs = this.http
      .get<MetaValor[] | DRFPaginated<MetaValor>>(
        `${this.base}/meta/tablas/${encodeURIComponent(codigo)}/valores/`,
        { params }
      )
      .pipe(this.unwrapMaybePaginated<MetaValor>(), shareReplay({ bufferSize: 1, refCount: false }));
    this.valoresCodigoCache.set(key, obs);
    // Un error no se cachea: si el backend falló, el próximo debe reintentar.
    obs.subscribe({ error: () => this.valoresCodigoCache.delete(key) });
    return obs;
  }

  /** Vacía el cache de catálogos (tras editarlos en parametrización). */
  invalidarCacheCatalogos(codigo?: string): void {
    if (!codigo) { this.valoresCodigoCache.clear(); return; }
    for (const k of [...this.valoresCodigoCache.keys()]) {
      if (k.startsWith(`${codigo}|`)) this.valoresCodigoCache.delete(k);
    }
  }

  /** ===========================
   *  ADAPTADORES para la UI (lo que necesitas)
   *  =========================== */

  /**
   * Devuelve SOLO los `datos` de cada MetaValor, mapeados a {codigo, descripcion, ...resto}.
   * No normaliza ni valida: respeta exactamente lo que venga del backend.
   *
   * Ejemplos soportados:
   *   {"codigo":"C.C.","descripcion":"Cédula de Ciudadanía (CC)"}
   *   {"codigo":"EDUCACIÓN MEDIA ACADÉMICA","descripcion":"..."}
   *   {"codigo":"TERMINADA"}
   */
  /** Devuelve los `datos` mapeados a {codigo, descripcion, ...resto} sin normalizar/validar */
  listDatosByTablaCodigo(
    codigo: string,
    opts: { activo?: boolean; referencia?: string; page?: number; page_size?: number } = {}
  ): Observable<CatalogValue[]> {
    return this.listMetaValoresByTablaCodigo(codigo, opts).pipe(
      map(rows =>
        rows.map(({ datos }) => {
          const d = (datos ?? {}) as Record<string, unknown>;

          const codigoVal = (d['codigo'] ?? '') as string;
          const descripcionVal = (Object.prototype.hasOwnProperty.call(d, 'descripcion')
            ? (d['descripcion'] as string | null)
            : null);

          // construir "resto" SIN codigo/descripcion
          const rest: Record<string, unknown> = { ...d };
          delete rest['codigo'];
          delete rest['descripcion'];

          return {
            codigo: String(codigoVal),
            descripcion: descripcionVal,
            ...rest
          } as CatalogValue;
        })
      )
    );
  }

  /**
   * Igual que arriba, pero listo para `<mat-option [value]="value">{{ label }}</mat-option>`.
   * Útil si tu template espera value/label.
   */
  listOpcionesByTablaCodigo(
    codigo: string,
    opts: { activo?: boolean; referencia?: string; page?: number; page_size?: number } = {}
  ): Observable<CatalogOption[]> {
    return this.listDatosByTablaCodigo(codigo, opts).pipe(
      map(values =>
        values.map(v => ({
          value: v.codigo,
          label: (v.descripcion ?? v.codigo) as string,
          raw: v
        }))
      )
    );
  }

  /** ===========================
   *  Descargas (opcional)
   *  =========================== */
  descargarExcel(path: string): Observable<Blob> {
    return this.http.get(`${this.base}${path}`, { responseType: 'blob' });
  }
  descargarZip(path: string): Observable<Blob> {
    return this.http.get(`${this.base}${path}`, { responseType: 'blob' });
  }
  saveBlobAs(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

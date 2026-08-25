import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  Catalogo, ConfigVisualizacion, DatasetCatalogo, FiltroGlobalTablero, FilterNode,
  MetadatosModulo, PaginaAuditoria, PaginaReportes, PaginaTableros, ReportDefinition,
  ReporteDetalle, ResultadoConsulta, SortSpec, TableroDetalle, WidgetTablero, Comparticion,
  CampoCatalogo, RelacionCatalogo,
} from '../models/reportes.models';

/**
 * Cliente HTTP del módulo Reportes y Analítica (ms-reports) vía el gateway.
 * El JWT lo inyecta el auth.interceptor.
 *
 * El CATÁLOGO se cachea en memoria: son metadatos que no cambian entre pantallas
 * y el constructor los consulta constantemente (al pintar el explorador, al
 * resolver el nombre de un campo, al validar una relación). Pedirlo en cada
 * navegación sería un viaje redundante en cada clic.
 */
@Injectable({ providedIn: 'root' })
export class ReportesApiService {

  private http = inject(HttpClient);
  private base = `${environment.apiUrl.replace(/\/$/, '')}/api/v1/reports`;

  // ── caché del catálogo ──
  private readonly _catalogo = signal<Catalogo | null>(null);
  private readonly _metadatos = signal<MetadatosModulo | null>(null);

  readonly catalogo = this._catalogo.asReadonly();
  readonly metadatos = this._metadatos.asReadonly();

  /** Índice clave → dataset, para resolver nombres sin recorrer el arreglo. */
  readonly datasetsPorClave = computed(() => {
    const mapa = new Map<string, DatasetCatalogo>();
    for (const d of this._catalogo()?.datasets ?? []) mapa.set(d.clave, d);
    return mapa;
  });

  /** Índice clave → campo. */
  readonly camposPorClave = computed(() => {
    const mapa = new Map<string, CampoCatalogo>();
    for (const d of this._catalogo()?.datasets ?? []) {
      for (const c of d.campos) mapa.set(c.clave, c);
    }
    return mapa;
  });

  readonly relacionesPorClave = computed(() => {
    const mapa = new Map<string, RelacionCatalogo>();
    for (const r of this._catalogo()?.relaciones ?? []) mapa.set(r.clave, r);
    return mapa;
  });

  // ─────────────────────────────── catálogo ───────────────────────────────

  /** @param forzar vuelve a pedirlo aunque esté en caché (tras editar el catálogo). */
  cargarCatalogo(forzar = false): Observable<Catalogo> {
    const enCache = this._catalogo();
    if (enCache && !forzar) return of(enCache);
    return this.http.get<Catalogo>(`${this.base}/catalogo`)
      .pipe(tap(c => this._catalogo.set(c)));
  }

  cargarMetadatos(): Observable<MetadatosModulo> {
    const enCache = this._metadatos();
    if (enCache) return of(enCache);
    return this.http.get<MetadatosModulo>(`${this.base}/catalogo/metadatos`)
      .pipe(tap(m => this._metadatos.set(m)));
  }

  /** Valores distintos de un campo, para el desplegable de un filtro "está en (…)". */
  valoresDeCampo(clave: string, texto?: string, limite = 100): Observable<unknown[]> {
    let params = new HttpParams().set('limite', limite);
    if (texto) params = params.set('q', texto);
    return this.http.get<unknown[]>(
      `${this.base}/catalogo/campos/${encodeURIComponent(clave)}/valores`, { params });
  }

  diagnosticoCatalogo(): Observable<any> {
    return this.http.get(`${this.base}/catalogo/diagnostico`);
  }

  refrescarCatalogo(): Observable<any> {
    return this.http.post(`${this.base}/catalogo/refrescar`, {})
      .pipe(tap(() => this._catalogo.set(null)));
  }

  tablasDisponibles(esquema: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/catalogo/disponibles`,
      { params: new HttpParams().set('esquema', esquema) });
  }

  relacionesSugeridas(esquema: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/catalogo/relaciones/sugeridas`,
      { params: new HttpParams().set('esquema', esquema) });
  }

  guardarDatasetCatalogo(body: unknown): Observable<{ clave: string }> {
    return this.http.post<{ clave: string }>(`${this.base}/catalogo/admin/datasets`, body)
      .pipe(tap(() => this._catalogo.set(null)));
  }

  desactivarDatasetCatalogo(clave: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/catalogo/admin/datasets/${encodeURIComponent(clave)}`)
      .pipe(tap(() => this._catalogo.set(null)));
  }

  guardarRelacionCatalogo(body: unknown): Observable<{ clave: string }> {
    return this.http.post<{ clave: string }>(`${this.base}/catalogo/admin/relaciones`, body)
      .pipe(tap(() => this._catalogo.set(null)));
  }

  permisosDataset(clave: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/catalogo/admin/datasets/${encodeURIComponent(clave)}/permisos`);
  }

  guardarPermisosDataset(clave: string, permisos: unknown[]): Observable<any[]> {
    return this.http.put<any[]>(
      `${this.base}/catalogo/admin/datasets/${encodeURIComponent(clave)}/permisos`, permisos)
      .pipe(tap(() => this._catalogo.set(null)));
  }

  // ─────────────────────────────── consultas ───────────────────────────────

  vistaPrevia(definicion: ReportDefinition, filas?: number): Observable<ResultadoConsulta> {
    return this.http.post<ResultadoConsulta>(`${this.base}/consultas/vista-previa`,
      { definicion, filas });
  }

  ejecutarDefinicion(
    definicion: ReportDefinition,
    opts: { page?: number; size?: number; orden?: SortSpec[]; filtros?: FilterNode | null; incluir_conteo?: boolean } = {},
  ): Observable<ResultadoConsulta> {
    return this.http.post<ResultadoConsulta>(`${this.base}/consultas/ejecutar`, {
      definicion,
      page: opts.page ?? 0,
      size: opts.size ?? 50,
      orden: opts.orden ?? null,
      filtros: opts.filtros ?? null,
      incluir_conteo: opts.incluir_conteo ?? true,
    });
  }

  validar(definicion: ReportDefinition): Observable<{
    valido: boolean; advertencias: string[]; tablas: string[]; agregada: boolean; sql: string;
  }> {
    return this.http.post<any>(`${this.base}/consultas/validar`, { definicion });
  }

  /** Edición en línea de una celda (§10). */
  editarCelda(body: {
    dataset: string; campo: string; clave_fila: unknown;
    valor_anterior: unknown; valor_nuevo: unknown; motivo?: string;
  }): Observable<{ ok: boolean; valor_guardado: unknown; mensaje: string }> {
    return this.http.post<any>(`${this.base}/consultas/celda`, body);
  }

  // ─────────────────────────────── reportes ───────────────────────────────

  listarReportes(opts: {
    q?: string; categoria?: string; tipo?: string; estado?: string;
    alcance?: string; favoritos?: boolean; page?: number; size?: number; orden?: string;
  } = {}): Observable<PaginaReportes> {
    let params = new HttpParams();
    if (opts.q) params = params.set('q', opts.q);
    if (opts.categoria) params = params.set('categoria', opts.categoria);
    if (opts.tipo) params = params.set('tipo', opts.tipo);
    if (opts.estado) params = params.set('estado', opts.estado);
    if (opts.alcance) params = params.set('alcance', opts.alcance);
    if (opts.favoritos) params = params.set('favoritos', 'true');
    params = params.set('page', opts.page ?? 0).set('size', opts.size ?? 24);
    if (opts.orden) params = params.set('orden', opts.orden);
    return this.http.get<PaginaReportes>(`${this.base}/reportes`, { params });
  }

  reportesRecientes(limite = 8): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/reportes/recientes`,
      { params: new HttpParams().set('limite', limite) });
  }

  categorias(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/reportes/categorias`);
  }

  abrirReporte(id: string): Observable<ReporteDetalle> {
    return this.http.get<ReporteDetalle>(`${this.base}/reportes/${id}`);
  }

  crearReporte(body: {
    nombre: string; descripcion?: string | null; categoria?: string | null;
    tipo?: string; estado?: string; visibilidad?: string;
    definicion: ReportDefinition; visualizacion?: ConfigVisualizacion | null;
    comparticiones?: Comparticion[];
  }): Observable<ReporteDetalle> {
    return this.http.post<ReporteDetalle>(`${this.base}/reportes`, body);
  }

  actualizarReporte(id: string, body: unknown): Observable<ReporteDetalle> {
    return this.http.put<ReporteDetalle>(`${this.base}/reportes/${id}`, body);
  }

  duplicarReporte(id: string, nombre?: string): Observable<ReporteDetalle> {
    return this.http.post<ReporteDetalle>(`${this.base}/reportes/${id}/duplicar`, { nombre });
  }

  eliminarReporte(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/reportes/${id}`);
  }

  alternarFavoritoReporte(id: string): Observable<{ favorito: boolean }> {
    return this.http.post<{ favorito: boolean }>(`${this.base}/reportes/${id}/favorito`, {});
  }

  compartirReporte(id: string, visibilidad: string, comparticiones: Comparticion[]): Observable<Comparticion[]> {
    return this.http.put<Comparticion[]>(`${this.base}/reportes/${id}/compartir`,
      { visibilidad, comparticiones });
  }

  ejecutarReporte(id: string, opts: {
    page?: number; size?: number; orden?: SortSpec[]; filtros?: FilterNode | null; incluir_conteo?: boolean;
  } = {}): Observable<ResultadoConsulta> {
    return this.http.post<ResultadoConsulta>(`${this.base}/reportes/${id}/ejecutar`, {
      page: opts.page ?? 0,
      size: opts.size ?? 50,
      orden: opts.orden ?? null,
      filtros: opts.filtros ?? null,
      incluir_conteo: opts.incluir_conteo ?? true,
    });
  }

  // ─────────────────────────────── tableros ───────────────────────────────

  listarTableros(opts: { q?: string; favoritos?: boolean; page?: number; size?: number } = {}): Observable<PaginaTableros> {
    let params = new HttpParams();
    if (opts.q) params = params.set('q', opts.q);
    if (opts.favoritos) params = params.set('favoritos', 'true');
    params = params.set('page', opts.page ?? 0).set('size', opts.size ?? 24);
    return this.http.get<PaginaTableros>(`${this.base}/dashboards`, { params });
  }

  abrirTablero(id: string): Observable<TableroDetalle> {
    return this.http.get<TableroDetalle>(`${this.base}/dashboards/${id}`);
  }

  crearTablero(body: unknown): Observable<TableroDetalle> {
    return this.http.post<TableroDetalle>(`${this.base}/dashboards`, body);
  }

  actualizarTablero(id: string, body: unknown): Observable<TableroDetalle> {
    return this.http.put<TableroDetalle>(`${this.base}/dashboards/${id}`, body);
  }

  eliminarTablero(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/dashboards/${id}`);
  }

  alternarFavoritoTablero(id: string): Observable<{ favorito: boolean }> {
    return this.http.post<{ favorito: boolean }>(`${this.base}/dashboards/${id}/favorito`, {});
  }

  compartirTablero(id: string, visibilidad: string, comparticiones: Comparticion[]): Observable<Comparticion[]> {
    return this.http.put<Comparticion[]>(`${this.base}/dashboards/${id}/compartir`,
      { visibilidad, comparticiones });
  }

  datosTablero(id: string, filtros: FilterNode | null, filasTabla = 50): Observable<{ widgets: any[] }> {
    return this.http.post<{ widgets: any[] }>(`${this.base}/dashboards/${id}/datos`,
      { filtros, filas_tabla: filasTabla });
  }

  // ─────────────────────────────── exportación ───────────────────────────────

  /**
   * Descarga la exportación. Va como blob porque el archivo lo genera el
   * servidor: exportar en el navegador solo podría llevarse las filas que ya
   * están cargadas, y §21 pide explícitamente que "Exportar reporte completo"
   * traiga todo, no la página a la vista.
   */
  exportarConsulta(body: {
    definicion: ReportDefinition; titulo: string; formato: 'XLSX' | 'CSV' | 'PDF';
    completo: boolean; limite?: number; offset?: number; orden?: SortSpec[]; filtros?: FilterNode | null;
  }): Observable<Blob> {
    return this.http.post(`${this.base}/exportar/consulta`, body, { responseType: 'blob' });
  }

  exportarReporte(id: string, body: {
    formato: 'XLSX' | 'CSV' | 'PDF'; completo: boolean;
    limite?: number; offset?: number; orden?: SortSpec[]; filtros?: FilterNode | null;
  }): Observable<Blob> {
    return this.http.post(`${this.base}/exportar/reportes/${id}`, body, { responseType: 'blob' });
  }

  // ─────────────────────────────── auditoría ───────────────────────────────

  auditoria(opts: {
    accion?: string; actor?: string; recurso?: string; desde?: string; hasta?: string;
    page?: number; size?: number;
  } = {}): Observable<PaginaAuditoria> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    }
    return this.http.get<PaginaAuditoria>(`${this.base}/auditoria`, { params });
  }

  accionesAuditoria(): Observable<{ acciones: string[] }> {
    return this.http.get<{ acciones: string[] }>(`${this.base}/auditoria/acciones`);
  }

  // ─────────────────────────────── asistente IA ───────────────────────────────

  estadoAsistente(): Observable<{ disponible: boolean }> {
    return this.http.get<{ disponible: boolean }>(`${this.base}/asistente/estado`);
  }

  proponerConIA(texto: string): Observable<{ ok: boolean; definicion: ReportDefinition | null; advertencias: string[]; mensaje: string | null }> {
    return this.http.post<any>(`${this.base}/asistente/definicion`, { texto });
  }
}

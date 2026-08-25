import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  AiSummary,
  BuilderRequest,
  FormDetail,
  FormPatchRequest,
  FormStructure,
  FormSummary,
  FormUi,
  PageResult,
  ProvisioningResult,
  VersionInfo,
} from '../models/dynamic-forms.models';
import {
  SupportDownloadLog,
  SupportsPage,
  SupportsZipRequest,
} from '../models/placement.models';

/**
 * Formularios Dinámicos — gestión (ms-forms vía gateway, /api/dynamic-forms).
 * El JWT lo agrega el auth.interceptor global. Los errores llegan como ProblemDetail
 * RFC 7807 con `code` de negocio (df_*); cada pantalla los muestra con Swal/snackbar.
 */
@Injectable({ providedIn: 'root' })
export class DynamicFormService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  list(opts: {
    q?: string;
    active?: boolean | null;
    owner_user_id?: string;
    page?: number;
    size?: number;
  } = {}): Observable<PageResult<FormSummary>> {
    let params = new HttpParams()
      .set('page', String(opts.page ?? 0))
      .set('size', String(opts.size ?? 25));
    if (opts.q?.trim()) params = params.set('q', opts.q.trim());
    if (opts.active !== undefined && opts.active !== null) params = params.set('active', String(opts.active));
    if (opts.owner_user_id) params = params.set('owner_user_id', opts.owner_user_id);
    return this.http.get<PageResult<FormSummary>>(`${this.base}/forms`, { params });
  }

  get(id: number): Observable<FormDetail> {
    return this.http.get<FormDetail>(`${this.base}/forms/${id}`);
  }

  /** Estructura publicada vigente; con `version` trae esa versión exacta. */
  structure(id: number, version?: number): Observable<FormStructure> {
    let params = new HttpParams();
    if (version != null) params = params.set('version', String(version));
    return this.http.get<FormStructure>(`${this.base}/forms/${id}/structure`, { params });
  }

  createBuilder(req: BuilderRequest): Observable<FormDetail> {
    return this.http.post<FormDetail>(`${this.base}/forms/builder`, req);
  }

  /** Editar estructura = crea versión nueva PUBLISHED y deprecia la anterior. */
  editBuilder(id: number, req: BuilderRequest): Observable<FormDetail> {
    return this.http.put<FormDetail>(`${this.base}/forms/${id}/builder`, req);
  }

  /**
   * Tema de diseño / modo de navegación. Cambio COSMÉTICO: el backend lo guarda en el
   * formulario, no en la versión, así que no publica una versión nueva ni invalida las
   * respuestas ya recibidas.
   */
  updateUi(id: number, ui: FormUi | null): Observable<FormDetail> {
    return this.http.put<FormDetail>(`${this.base}/forms/${id}/ui`, { ui });
  }

  /** Resumen IA guardado (el último generado). No llama al modelo. */
  aiSummary(id: number): Observable<AiSummary> {
    return this.http.get<AiSummary>(`${this.base}/forms/${id}/ai-summary`);
  }

  /**
   * Regenera el resumen IA y lo persiste. Cuesta una llamada al modelo, así que va
   * SIEMPRE por acción explícita del usuario. Si la IA no responde el backend
   * devuelve 503 (df_ai_unavailable) y el resumen anterior se conserva intacto.
   */
  generateAiSummary(id: number): Observable<AiSummary> {
    return this.http.post<AiSummary>(`${this.base}/forms/${id}/ai-summary`, {});
  }

  patch(id: number, req: FormPatchRequest): Observable<FormDetail> {
    return this.http.patch<FormDetail>(`${this.base}/forms/${id}`, req);
  }

  softDelete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/forms/${id}`);
  }

  restore(id: number): Observable<FormDetail> {
    return this.http.post<FormDetail>(`${this.base}/forms/${id}/restore`, {});
  }

  hardDelete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/forms/${id}/hard`, {
      params: new HttpParams().set('force', 'true'),
    });
  }

  duplicate(id: number): Observable<FormDetail> {
    return this.http.post<FormDetail>(`${this.base}/forms/${id}/duplicate`, {});
  }

  versions(id: number): Observable<VersionInfo[]> {
    return this.http.get<VersionInfo[]>(`${this.base}/forms/${id}/versions`);
  }

  /**
   * Archivos adjuntos (soportes) de las respuestas, paginados y FILTRADOS en el
   * servidor. Cada elemento trae ya su identificador corto ({cédula}-{pregunta}) y
   * la lista de preguntas con soportes viene en `fields`, para clasificar sin
   * pedir la estructura aparte. El JWT lo agrega el auth.interceptor.
   */
  supports(id: number, opts: {
    q?: string;
    fields?: string[];
    types?: string[];
    page?: number;
    size?: number;
  } = {}): Observable<SupportsPage> {
    let params = new HttpParams()
      .set('page', String(opts.page ?? 0))
      .set('size', String(opts.size ?? 24));
    if (opts.q?.trim()) params = params.set('q', opts.q.trim());
    for (const f of opts.fields ?? []) params = params.append('fields', f);
    for (const t of opts.types ?? []) params = params.append('types', t);
    return this.http.get<SupportsPage>(`${this.base}/forms/${id}/supports`, { params });
  }

  /**
   * Descarga de UN soporte por ms-forms (no por ms-documents): así sale con su nombre
   * corto y la descarga queda registrada. `observe: 'response'` para poder leer el
   * nombre del Content-Disposition cuando el borde lo expone.
   */
  supportDownload(id: number, documentId: number, submissionId: number) {
    const params = new HttpParams().set('submission_id', String(submissionId));
    return this.http.get(`${this.base}/forms/${id}/supports/${documentId}/download`, {
      params,
      responseType: 'blob',
      observe: 'response',
    });
  }

  /** ZIP con los soportes seleccionados (o con todo lo que casa con la búsqueda). */
  supportsZip(id: number, req: SupportsZipRequest) {
    return this.http.post(`${this.base}/forms/${id}/supports/zip`, req, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  /** Registro de actividad: quién descargó soportes de este formulario y cuándo. */
  supportDownloads(id: number, page = 0, size = 25): Observable<PageResult<SupportDownloadLog>> {
    const params = new HttpParams().set('page', String(page)).set('size', String(size));
    return this.http.get<PageResult<SupportDownloadLog>>(
      `${this.base}/forms/${id}/supports/downloads`, { params });
  }

  provisionRetry(id: number): Observable<ProvisioningResult> {
    return this.http.post<ProvisioningResult>(`${this.base}/forms/${id}/provision-module`, {});
  }

  /** Excel generado por el backend (POI); el caller lo baja con saveAs. */
  exportXlsx(id: number, opts: { version?: number; status?: string; from?: string; to?: string } = {}) {
    let params = new HttpParams();
    if (opts.version != null) params = params.set('version', String(opts.version));
    if (opts.status) params = params.set('status', opts.status);
    if (opts.from) params = params.set('from', opts.from);
    if (opts.to) params = params.set('to', opts.to);
    return this.http.get(`${this.base}/forms/${id}/export.xlsx`, {
      params,
      responseType: 'blob',
      observe: 'response',
    });
  }
}

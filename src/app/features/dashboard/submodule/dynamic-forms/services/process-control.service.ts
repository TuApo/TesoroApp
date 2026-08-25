import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { PageResult } from '../models/dynamic-forms.models';
import {
  BulkApplyResult,
  BulkBatch,
  BulkPreview,
  BulkRequest,
  FormAccess,
  FormAccessConfig,
  FormColumn,
  ProcessRecord,
  ProcessSummary,
  Revision,
} from '../models/process.models';

/**
 * CONTROL DEL PROCESO y PERMISOS de un formulario dinámico (ms-forms, V14).
 *
 * El JWT lo pone el interceptor global; los errores llegan como ProblemDetail RFC 7807
 * con `code` df_* y los pinta cada pantalla.
 *
 * El masivo va en DOS llamadas a propósito: `preview` cruza el archivo contra la base y
 * dice qué pasaría, `apply` lo ejecuta. No se puede aplicar lo que no se ha visto.
 */
@Injectable({ providedIn: 'root' })
export class ProcessControlService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  // ---------- Permisos ----------

  /** Qué puede hacer el usuario ACTUAL sobre este formulario (decide pestañas y botones). */
  myAccess(formId: number): Observable<FormAccess> {
    return this.http.get<FormAccess>(`${this.base}/forms/${formId}/access/mine`);
  }

  /** Configuración de permisos de todos los roles (solo quien gestiona el formulario). */
  accessConfig(formId: number, version?: number): Observable<FormAccessConfig> {
    let params = new HttpParams();
    if (version != null) params = params.set('version', String(version));
    return this.http.get<FormAccessConfig>(`${this.base}/forms/${formId}/access`, { params });
  }

  /** Reemplaza el juego COMPLETO de permisos (la pantalla manda siempre todas las reglas). */
  saveAccess(formId: number, cfg: FormAccessConfig): Observable<FormAccessConfig> {
    return this.http.put<FormAccessConfig>(`${this.base}/forms/${formId}/access`, cfg);
  }

  /** Columnas del formulario: matriz de permisos, plantilla del masivo y tabla del proceso. */
  columns(formId: number, version?: number): Observable<FormColumn[]> {
    let params = new HttpParams();
    if (version != null) params = params.set('version', String(version));
    return this.http.get<FormColumn[]>(`${this.base}/forms/${formId}/columns`, { params });
  }

  // ---------- Seguimiento ----------

  summary(formId: number): Observable<ProcessSummary> {
    return this.http.get<ProcessSummary>(`${this.base}/forms/${formId}/process/summary`);
  }

  records(formId: number, opts: {
    version?: number | null;
    status?: string | null;
    onlyChanged?: boolean;
    key?: string | null;
    page?: number;
    size?: number;
  } = {}): Observable<PageResult<ProcessRecord>> {
    let params = new HttpParams()
      .set('page', String(opts.page ?? 0))
      .set('size', String(opts.size ?? 25));
    if (opts.version != null) params = params.set('version', String(opts.version));
    if (opts.status) params = params.set('status', opts.status);
    if (opts.onlyChanged) params = params.set('only_changed', 'true');
    if (opts.key?.trim()) params = params.set('key', opts.key.trim());
    return this.http.get<PageResult<ProcessRecord>>(
      `${this.base}/forms/${formId}/process/records`, { params });
  }

  /** Edita columnas concretas de un registro. Deja revisión con el diff. */
  updateRecord(submissionId: number, values: Record<string, unknown>, note?: string):
    Observable<ProcessRecord> {
    return this.http.patch<ProcessRecord>(
      `${this.base}/process/records/${submissionId}`, { values, note });
  }

  history(submissionId: number): Observable<Revision[]> {
    return this.http.get<Revision[]>(`${this.base}/process/records/${submissionId}/history`);
  }

  // ---------- Carga masiva ----------

  preview(formId: number, req: BulkRequest): Observable<BulkPreview> {
    return this.http.post<BulkPreview>(`${this.base}/forms/${formId}/process/bulk/preview`, req);
  }

  apply(formId: number, req: BulkRequest): Observable<BulkApplyResult> {
    return this.http.post<BulkApplyResult>(`${this.base}/forms/${formId}/process/bulk/apply`, req);
  }

  batches(formId: number, page = 0, size = 25): Observable<PageResult<BulkBatch>> {
    const params = new HttpParams().set('page', String(page)).set('size', String(size));
    return this.http.get<PageResult<BulkBatch>>(
      `${this.base}/forms/${formId}/process/batches`, { params });
  }

  /**
   * Rellena la llave de negocio en los registros que no la tienen. Hace falta después de
   * declarar el campo llave en un formulario que ya tenía respuestas: sin esto un masivo
   * no cruzaría con nada y duplicaría lo que ya existe.
   */
  reindexKeys(formId: number): Observable<{ form_id: number; updated: number }> {
    return this.http.post<{ form_id: number; updated: number }>(
      `${this.base}/forms/${formId}/process/reindex-keys`, {});
  }
}

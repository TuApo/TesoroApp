import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  PageResult,
  Submission,
  SubmissionCreateRequest,
  SubmissionStatus,
} from '../models/dynamic-forms.models';

/** Respuestas autenticadas de Formularios Dinámicos. */
@Injectable({ providedIn: 'root' })
export class SubmissionService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  /** status DRAFT = borrador; SUBMITTED (default) = envío validado completo. */
  create(formVersionId: number, req: SubmissionCreateRequest): Observable<Submission> {
    const params = new HttpParams().set('form_version_id', String(formVersionId));
    return this.http.post<Submission>(`${this.base}/submissions`, req, { params });
  }

  updateDraft(id: number, req: SubmissionCreateRequest): Observable<Submission> {
    return this.http.put<Submission>(`${this.base}/submissions/${id}`, req);
  }

  listByVersion(formVersionId: number, opts: { status?: string; page?: number; size?: number } = {}):
      Observable<PageResult<Submission>> {
    let params = new HttpParams()
      .set('form_version_id', String(formVersionId))
      .set('page', String(opts.page ?? 0))
      .set('size', String(opts.size ?? 25));
    if (opts.status) params = params.set('status', opts.status);
    return this.http.get<PageResult<Submission>>(`${this.base}/submissions`, { params });
  }

  listByForm(formId: number, opts: { version?: number; status?: string; page?: number; size?: number } = {}):
      Observable<PageResult<Submission>> {
    let params = new HttpParams()
      .set('page', String(opts.page ?? 0))
      .set('size', String(opts.size ?? 25));
    if (opts.version != null) params = params.set('version', String(opts.version));
    if (opts.status) params = params.set('status', opts.status);
    return this.http.get<PageResult<Submission>>(`${this.base}/submissions/by-form/${formId}`, { params });
  }

  get(id: number): Observable<Submission> {
    return this.http.get<Submission>(`${this.base}/submissions/${id}`);
  }

  /** DRAFT→SUBMITTED (autor) · SUBMITTED→APPROVED|REJECTED (dueño/admin). */
  changeStatus(id: number, status: SubmissionStatus): Observable<Submission> {
    return this.http.patch<Submission>(`${this.base}/submissions/${id}/status`, { status });
  }
}

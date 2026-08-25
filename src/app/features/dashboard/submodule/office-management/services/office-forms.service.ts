import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  DashboardData, FieldValue, FormDefinition, FormFieldDef, FormResponse,
  FormSummary, OfficeImportResult, OfficeImportedForm, OfficeTemplateConfig,
  PageResult, PublishResult, ResponseSummary, RoleAccess,
} from '../models/office-forms.models';

/**
 * Cliente HTTP del motor de formularios (ms-forms) vía el gateway.
 * El token JWT lo inyecta automáticamente el auth.interceptor (host api.tuapo.co);
 * los envíos con adjuntos van como multipart (part "payload" + parts de archivos).
 */
@Injectable({ providedIn: 'root' })
export class OfficeFormsService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl.replace(/\/$/, '')}/api/forms`;
  /** Catálogo de sedes (oficinas) — ya existente en ms-auth-admin. */
  private sedesUrl = `${environment.apiUrl.replace(/\/$/, '')}/gestion_admin/sedes/`;
  /** Catálogo de roles — mismo endpoint que usa el resto de la plataforma. */
  private rolesUrl = `${environment.apiUrl.replace(/\/$/, '')}/gestion_admin/roles/`;

  /**
   * Formulario leído de un Excel que espera a que el constructor lo recoja. Se consume
   * UNA vez (`tomarPendiente`) para que un F5 en /builder no vuelva a cargarlo.
   */
  readonly pendienteImportado = signal<OfficeImportedForm | null>(null);

  dejarPendiente(f: OfficeImportedForm): void {
    this.pendienteImportado.set(f);
  }

  tomarPendiente(): OfficeImportedForm | null {
    const f = this.pendienteImportado();
    if (f) this.pendienteImportado.set(null);
    return f;
  }

  // ---------- Definición / constructor ----------

  list(opts: { status?: string; parent_module?: string; q?: string } = {}): Observable<FormSummary[]> {
    let params = new HttpParams();
    if (opts.status) params = params.set('status', opts.status);
    if (opts.parent_module) params = params.set('parent_module', opts.parent_module);
    if (opts.q) params = params.set('q', opts.q);
    return this.http.get<FormSummary[]>(this.base, { params });
  }

  dashboard(): Observable<DashboardData> {
    return this.http.get<DashboardData>(`${this.base}/dashboard`);
  }

  get(id: number): Observable<FormDefinition> {
    return this.http.get<FormDefinition>(`${this.base}/${id}`);
  }

  create(body: {
    title: string; description?: string | null; parent_module?: string | null; visibility: string;
  }): Observable<FormDefinition> {
    return this.http.post<FormDefinition>(this.base, body);
  }

  update(id: number, body: {
    title?: string; description?: string | null; parent_module?: string | null; visibility?: string;
  }): Observable<FormDefinition> {
    return this.http.put<FormDefinition>(`${this.base}/${id}`, body);
  }

  setFields(id: number, fields: FormFieldDef[]): Observable<FormDefinition> {
    return this.http.put<FormDefinition>(`${this.base}/${id}/fields`, { fields });
  }

  setOffices(id: number, office_ids: string[]): Observable<FormDefinition> {
    return this.http.put<FormDefinition>(`${this.base}/${id}/offices`, { office_ids });
  }

  setAccess(id: number, roles: RoleAccess[]): Observable<FormDefinition> {
    return this.http.put<FormDefinition>(`${this.base}/${id}/access`, { roles });
  }

  publish(id: number): Observable<PublishResult> {
    return this.http.post<PublishResult>(`${this.base}/${id}/publish`, {});
  }

  // ---------- Respuestas ----------

  listResponses(id: number, opts: { office_id?: string; page?: number; size?: number } = {}): Observable<PageResult<ResponseSummary>> {
    let params = new HttpParams();
    if (opts.office_id) params = params.set('office_id', opts.office_id);
    params = params.set('page', String(opts.page ?? 0)).set('size', String(opts.size ?? 25));
    return this.http.get<PageResult<ResponseSummary>>(`${this.base}/${id}/responses`, { params });
  }

  getResponse(rid: number): Observable<FormResponse> {
    return this.http.get<FormResponse>(`${this.base}/responses/${rid}`);
  }

  /** Envío interno. Arma multipart con "payload" + un part por cada archivo/foto. */
  submit(id: number, values: FieldValue[], meta: { office_id?: string | null } = {}): Observable<FormResponse> {
    const { formData } = buildSubmitFormData(values, meta);
    return this.http.post<FormResponse>(`${this.base}/${id}/responses`, formData);
  }

  /** Descarga un adjunto de ms-documents con el JWT del interceptor (blob). */
  downloadDocument(documentUrl: string): Observable<Blob> {
    const full = documentUrl.startsWith('http')
      ? documentUrl
      : `${environment.apiUrl.replace(/\/$/, '')}${documentUrl}`;
    return this.http.get(full, { responseType: 'blob' });
  }

  // ---------- Carga por Excel ----------

  /** Plantilla .xlsx (blob) parametrizada con el módulo, las oficinas y los roles elegidos. */
  plantilla(config: OfficeTemplateConfig): Observable<Blob> {
    return this.http.post(`${this.base}/import/template`, config, { responseType: 'blob' });
  }

  /** Lee el archivo lleno. No persiste nada: devuelve los formularios como quedarían. */
  cargarExcel(archivo: File): Observable<OfficeImportResult> {
    const fd = new FormData();
    fd.append('file', archivo, archivo.name);
    return this.http.post<OfficeImportResult>(`${this.base}/import/parse`, fd);
  }

  // ---------- Catálogo ----------

  sedes(): Observable<any> {
    return this.http.get<any>(this.sedesUrl);
  }

  /** Roles de la plataforma (para decidir quién ve y quién responde el formulario). */
  roles(): Observable<Array<{ id: string; nombre: string }>> {
    return this.http.get<Array<{ id: string; nombre: string }>>(this.rolesUrl);
  }
}

/** Descarga un blob con el nombre dado (el navegador no lo hace solo desde XHR). */
export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Construye el FormData de un envío: part "payload" (JSON) + parts file_<field_id>. */
export function buildSubmitFormData(values: FieldValue[], meta: { office_id?: string | null }) {
  const fd = new FormData();
  const outValues = values.map(v => {
    if (v.file) {
      const part = `file_${v.field_id}`;
      fd.append(part, v.file, v.file.name);
      return { field_id: v.field_id, file_part: part };
    }
    return { field_id: v.field_id, value: v.value ?? null, value_json: v.value_json ?? null };
  });
  const payload = { office_id: meta.office_id ?? null, values: outValues };
  fd.append('payload', JSON.stringify(payload));
  return { formData: fd, payload };
}

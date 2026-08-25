import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { AuditLogEntry, ChangeLogEntry, PageResponse, AuditStats } from '../models/audit-logs.models';

export interface ActividadParams {
  actorId?: string;
  action?: string;
  resource?: string;
  success?: boolean;
  desdeEpoch?: number;
  hastaEpoch?: number;
  page?: number;
  size?: number;
}

export interface CambiosParams {
  actorId?: string;
  modulo?: string;
  entidad?: string;
  accion?: string;
  entidadId?: string;
  desdeEpoch?: number;
  hastaEpoch?: number;
  page?: number;
  size?: number;
}

@Injectable({ providedIn: 'root' })
export class AuditLogsService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/admin/logs`;

  getActividad(p: ActividadParams = {}): Observable<PageResponse<AuditLogEntry>> {
    return this.http.get<PageResponse<AuditLogEntry>>(`${this.base}/actividad`, { params: buildParams(p as object) });
  }

  getSeguridad(p: Omit<ActividadParams, 'action' | 'resource'> = {}): Observable<PageResponse<AuditLogEntry>> {
    return this.http.get<PageResponse<AuditLogEntry>>(`${this.base}/seguridad`, { params: buildParams(p as object) });
  }

  getCambios(p: CambiosParams = {}): Observable<PageResponse<ChangeLogEntry>> {
    return this.http.get<PageResponse<ChangeLogEntry>>(`${this.base}/cambios`, { params: buildParams(p as object) });
  }

  getStats(): Observable<AuditStats> {
    return this.http.get<AuditStats>(`${this.base}/stats`);
  }
}

function buildParams(obj: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== '') p = p.set(k, String(v));
  }
  return p;
}

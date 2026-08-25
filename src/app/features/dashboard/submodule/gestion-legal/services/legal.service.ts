import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  ProcesoTipo, ProcesoEstado, ChecklistItem, DocumentoTipo,
  ProcesoLegal, ActuacionLegal, TerminoLegal, ParteProceso, DocumentoProceso,
  PaginaResponse, BandejaParams
} from '../models/legal.models';

@Injectable({ providedIn: 'root' })
export class LegalService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/legal`;

  // ── Catálogos ───────────────────────────────────────────────────────────────

  getTipos(): Observable<ProcesoTipo[]> {
    return this.http.get<ProcesoTipo[]>(`${this.base}/catalogos/tipos`);
  }

  getEstados(tipoId?: number): Observable<ProcesoEstado[]> {
    let params = new HttpParams();
    if (tipoId != null) params = params.set('tipoId', String(tipoId));
    return this.http.get<ProcesoEstado[]>(`${this.base}/catalogos/estados`, { params });
  }

  getChecklist(tipoId: number): Observable<ChecklistItem[]> {
    const params = new HttpParams().set('tipoId', String(tipoId));
    return this.http.get<ChecklistItem[]>(`${this.base}/catalogos/checklist`, { params });
  }

  getDocumentoTipos(): Observable<DocumentoTipo[]> {
    return this.http.get<DocumentoTipo[]>(`${this.base}/catalogos/documento-tipos`);
  }

  // ── Procesos ────────────────────────────────────────────────────────────────

  listarProcesos(filtros: BandejaParams = {}): Observable<PaginaResponse<ProcesoLegal>> {
    let params = new HttpParams();
    if (filtros.estado != null) params = params.set('estado', String(filtros.estado));
    if (filtros.tipo != null) params = params.set('tipo', String(filtros.tipo));
    if (filtros.q) params = params.set('q', filtros.q);
    params = params.set('page', String(filtros.page ?? 0));
    params = params.set('size', String(filtros.size ?? 50));
    return this.http.get<PaginaResponse<ProcesoLegal>>(`${this.base}/procesos`, { params });
  }

  crearProceso(body: Partial<ProcesoLegal>): Observable<ProcesoLegal> {
    return this.http.post<ProcesoLegal>(`${this.base}/procesos`, body);
  }

  getProceso(id: number): Observable<ProcesoLegal> {
    return this.http.get<ProcesoLegal>(`${this.base}/procesos/${id}`);
  }

  cambiarEstado(id: number, body: { estadoId: number; motivo: string }): Observable<ProcesoLegal> {
    return this.http.patch<ProcesoLegal>(`${this.base}/procesos/${id}/estado`, body);
  }

  // ── Actuaciones ─────────────────────────────────────────────────────────────

  getActuaciones(id: number): Observable<ActuacionLegal[]> {
    return this.http.get<ActuacionLegal[]>(`${this.base}/procesos/${id}/actuaciones`);
  }

  crearActuacion(id: number, body: Partial<ActuacionLegal>): Observable<ActuacionLegal> {
    return this.http.post<ActuacionLegal>(`${this.base}/procesos/${id}/actuaciones`, body);
  }

  // ── Términos ────────────────────────────────────────────────────────────────

  getTerminos(id: number): Observable<TerminoLegal[]> {
    return this.http.get<TerminoLegal[]>(`${this.base}/procesos/${id}/terminos`);
  }

  // ── Partes ──────────────────────────────────────────────────────────────────

  getPartes(id: number): Observable<ParteProceso[]> {
    return this.http.get<ParteProceso[]>(`${this.base}/procesos/${id}/partes`);
  }

  crearParte(id: number, body: Partial<ParteProceso>): Observable<ParteProceso> {
    return this.http.post<ParteProceso>(`${this.base}/procesos/${id}/partes`, body);
  }

  // ── Documentos ──────────────────────────────────────────────────────────────

  getDocumentos(id: number): Observable<DocumentoProceso[]> {
    return this.http.get<DocumentoProceso[]>(`${this.base}/procesos/${id}/documentos`);
  }

  subirDocumento(id: number, formData: FormData): Observable<DocumentoProceso> {
    return this.http.post<DocumentoProceso>(`${this.base}/procesos/${id}/documentos`, formData);
  }

  urlDescargarDocumento(id: number): string {
    return `${this.base}/documentos/${id}/descargar`;
  }
}

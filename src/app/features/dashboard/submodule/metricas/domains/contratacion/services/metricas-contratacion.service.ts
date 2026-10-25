import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import { RespuestaResumenIa } from '../components/resumen-ia/resumen-ia.component';
import {
  ConfigInforme, Destinatario, FiltrosInforme, EnvioInforme, InformeDiario, ResultadoEnvio, UsuarioPlataforma,
  FichaPersona, FiltrosMetricas, ListaMetricas, FilaIngreso, FilaProceso, TableroContratacion,
} from '../models/metricas-contratacion.models';

/**
 * ms-hr `GET /gestion_contratacion/reporte/metricas/*` (Métricas de Contratación, 22-oct-2026).
 * Reglas (qué es presentación, ingreso, "dónde se quedó"…) en `MetricasContratacionService` de ms-hr.
 */
@Injectable({ providedIn: 'root' })
export class MetricasContratacionService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl.replace(/\/$/, '')}/gestion_contratacion/reporte/metricas`;

  tablero(f: FiltrosMetricas): Observable<TableroContratacion> {
    return this.http.get<TableroContratacion>(`${this.base}/tablero/`, { params: params(f) });
  }

  procesos(f: FiltrosMetricas): Observable<ListaMetricas<FilaProceso>> {
    return this.http.get<ListaMetricas<FilaProceso>>(`${this.base}/presentaciones/`, { params: params(f) });
  }

  ingresos(f: FiltrosMetricas): Observable<ListaMetricas<FilaIngreso>> {
    return this.http.get<ListaMetricas<FilaIngreso>>(`${this.base}/ingresos/`, { params: params(f) });
  }

  persona(cedula: string): Observable<FichaPersona> {
    return this.http.get<FichaPersona>(`${this.base}/persona/${encodeURIComponent(cedula)}/`);
  }

  // ─── Informe diario (ms-hr reporte/informe-diario) ──────────────
  private get diario() { return `${environment.apiUrl.replace(/\/$/, '')}/gestion_contratacion/reporte/informe-diario`; }

  informeDiario(fecha: string, f?: FiltrosInforme): Observable<InformeDiario> {
    return this.http.get<InformeDiario>(`${this.diario}/`, { params: paramsInforme(fecha, f) });
  }

  informeDiarioExcel(fecha: string, f?: FiltrosInforme): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.diario}/`, { params: paramsInforme(fecha, f).set('formato', 'xlsx'), responseType: 'blob', observe: 'response' });
  }

  resumenDiario(fecha: string, f?: FiltrosInforme): Observable<RespuestaResumenIa> {
    return this.http.get<RespuestaResumenIa>(`${this.diario}/resumen-ia/`, { params: paramsInforme(fecha, f) });
  }

  resumenAnalisis(f: FiltrosMetricas): Observable<RespuestaResumenIa> {
    return this.http.get<RespuestaResumenIa>(`${this.base}/resumen-ia/`, { params: params(f) });
  }

  vistaCorreo(fecha: string): Observable<{ asunto: string; html: string; whatsapp: string }> {
    return this.http.get<{ asunto: string; html: string; whatsapp: string }>(`${this.diario}/vista/`, { params: { fecha } });
  }

  enviarInforme(fecha: string, prueba?: string | null): Observable<ResultadoEnvio> {
    return this.http.post<ResultadoEnvio>(`${this.diario}/enviar/`, prueba ? { prueba } : {}, { params: { fecha } });
  }

  configInforme(): Observable<{ config: ConfigInforme; puede_gestionar: boolean }> {
    return this.http.get<{ config: ConfigInforme; puede_gestionar: boolean }>(`${this.diario}/config/`);
  }

  guardarConfigInforme(c: Partial<ConfigInforme>): Observable<ConfigInforme> {
    return this.http.put<ConfigInforme>(`${this.diario}/config/`, c);
  }

  destinatarios(): Observable<Destinatario[]> {
    return this.http.get<Destinatario[]>(`${this.diario}/destinatarios/`);
  }

  agregarDestinatario(d: { canal: 'CORREO' | 'WHATSAPP'; valor: string; nombre?: string | null; usuario_id?: string | null }): Observable<Destinatario[]> {
    return this.http.post<Destinatario[]>(`${this.diario}/destinatarios/`, d);
  }

  activarDestinatario(id: number, activo: boolean): Observable<Destinatario[]> {
    return this.http.patch<Destinatario[]>(`${this.diario}/destinatarios/${id}/`, { activo });
  }

  quitarDestinatario(id: number): Observable<Destinatario[]> {
    return this.http.delete<Destinatario[]>(`${this.diario}/destinatarios/${id}/`);
  }

  buscarUsuarios(q: string): Observable<UsuarioPlataforma[]> {
    return this.http.get<UsuarioPlataforma[]>(`${this.diario}/usuarios/`, { params: { q } });
  }

  bitacoraEnvios(): Observable<EnvioInforme[]> {
    return this.http.get<EnvioInforme[]>(`${this.diario}/envios/`);
  }

  /** Excel del servidor con TODAS las filas filtradas (sin el tope de la vista). */
  excel(vista: 'presentaciones' | 'ingresos', f: FiltrosMetricas, resultado?: string | null): Observable<HttpResponse<Blob>> {
    let p = params(f).set('formato', 'xlsx');
    if (resultado) p = p.set('resultado', resultado);
    return this.http.get(`${this.base}/${vista}/`, { params: p, responseType: 'blob', observe: 'response' });
  }
}

function params(f: FiltrosMetricas): HttpParams {
  let p = new HttpParams().set('desde', f.desde).set('hasta', f.hasta);
  const extra: Record<string, string | null | undefined> = {
    oficina: f.oficinas?.length ? f.oficinas.join(',') : null,
    temporal: f.temporal, finca: f.fincas?.length ? f.fincas.join('|') : null, medio: f.medio,
    usuario: f.usuarios?.length ? f.usuarios.join('|') : null, cargo: f.cargo, q: f.q,
  };
  for (const [k, v] of Object.entries(extra)) if (v != null && String(v).trim() !== '') p = p.set(k, String(v).trim());
  return p;
}

function paramsInforme(fecha: string, f?: FiltrosInforme): HttpParams {
  let p = new HttpParams().set('fecha', fecha).set('dias', String(f?.dias ?? 30));
  if (f?.desde && f.desde !== fecha) p = p.set('desde', f.desde);
  if (f?.temporal) p = p.set('temporal', f.temporal);
  if (f?.oficinas?.length) p = p.set('oficina', f.oficinas.join(','));
  if (f?.fincas?.length) p = p.set('finca', f.fincas.join('|'));
  if (f?.usuarios?.length) p = p.set('usuario', f.usuarios.join('|'));
  return p;
}

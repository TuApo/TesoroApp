import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  BandejaEps, CanalEpsConfig, CanalEpsRequest, EnvioEps, EventoTramiteEps, PreviaCorreoEps,
  ResultadoEnvioEps, ResultadoMasivoEps, TramiteEps,
} from '../models/envios-eps.models';

const BASE = `${environment.apiUrl}/gestion_afiliaciones/envios-eps`;

/**
 * Acceso a Afiliaciones › Envíos a EPS (ms-hr EnvioEpsController, V70). Todo en snake_case:
 * los DTO del backend lo fijan con @JsonNaming, así que aquí no hay traducción de claves.
 */
@Injectable({ providedIn: 'root' })
export class EnviosEpsService {

  private http = inject(HttpClient);

  // ── Parametrización ──────────────────────────────────────────────────────

  canales(): Observable<CanalEpsConfig[]> {
    return this.http.get<CanalEpsConfig[]>(`${BASE}/canales`);
  }

  crearCanal(req: CanalEpsRequest): Observable<CanalEpsConfig> {
    return this.http.post<CanalEpsConfig>(`${BASE}/canales`, req);
  }

  guardarCanal(epsKey: string, req: CanalEpsRequest): Observable<CanalEpsConfig> {
    return this.http.put<CanalEpsConfig>(`${BASE}/canales/${encodeURIComponent(epsKey)}`, req);
  }

  // ── Bandeja y envío ──────────────────────────────────────────────────────

  bandeja(filtros: { desde?: string | null; hasta?: string | null; empresa?: string | null; eps_key?: string | null }): Observable<BandejaEps> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filtros)) if (v) params = params.set(k, v);
    return this.http.get<BandejaEps>(`${BASE}/bandeja`, { params });
  }

  confirmarDatos(procesoIds: number[], incluirIncompletos = false): Observable<ResultadoMasivoEps> {
    return this.http.post<ResultadoMasivoEps>(`${BASE}/confirmar-datos`,
      { proceso_ids: procesoIds, incluir_incompletos: incluirIncompletos });
  }

  previa(epsKey: string, empresa: string | null, tramiteIds: number[]): Observable<{ correos: PreviaCorreoEps[] }> {
    return this.http.post<{ correos: PreviaCorreoEps[] }>(`${BASE}/previa`,
      { eps_key: epsKey, empresa, tramite_ids: tramiteIds });
  }

  enviar(epsKey: string, empresa: string | null, tramiteIds: number[], nota: string | null): Observable<ResultadoEnvioEps> {
    return this.http.post<ResultadoEnvioEps>(`${BASE}/enviar`,
      { eps_key: epsKey, empresa, tramite_ids: tramiteIds, nota });
  }

  envios(epsKey?: string | null): Observable<EnvioEps[]> {
    const params = epsKey ? new HttpParams().set('eps_key', epsKey) : undefined;
    return this.http.get<EnvioEps[]>(`${BASE}/envios`, { params });
  }

  cuerpoEnvio(id: number): Observable<string> {
    return this.http.get(`${BASE}/envios/${id}/cuerpo`, { responseType: 'text' });
  }

  // ── Seguimiento ──────────────────────────────────────────────────────────

  tramites(filtros: { estado?: string | null; eps_key?: string | null; empresa?: string | null; q?: string | null; limite?: number }): Observable<TramiteEps[]> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get<TramiteEps[]>(`${BASE}/tramites`, { params });
  }

  historial(id: number): Observable<EventoTramiteEps[]> {
    return this.http.get<EventoTramiteEps[]>(`${BASE}/tramites/${id}/historial`);
  }

  radicar(ids: number[], radicadoNumero: string | null, radicadoFecha: string | null, canal: string | null, nota: string | null): Observable<ResultadoMasivoEps> {
    return this.http.post<ResultadoMasivoEps>(`${BASE}/tramites/radicar`,
      { tramite_ids: ids, radicado_numero: radicadoNumero, radicado_fecha: radicadoFecha, canal, nota });
  }

  confirmar(ids: number[], fecha: string | null, directa: boolean, nota: string | null): Observable<ResultadoMasivoEps> {
    return this.http.post<ResultadoMasivoEps>(`${BASE}/tramites/confirmar`,
      { tramite_ids: ids, confirmacion_fecha: fecha, directa, nota });
  }

  rechazar(ids: number[], motivo: string): Observable<ResultadoMasivoEps> {
    return this.http.post<ResultadoMasivoEps>(`${BASE}/tramites/rechazar`, { tramite_ids: ids, motivo });
  }

  reabrir(ids: number[], nota: string | null): Observable<ResultadoMasivoEps> {
    return this.http.post<ResultadoMasivoEps>(`${BASE}/tramites/reabrir`, { tramite_ids: ids, nota });
  }

  subirSoporte(id: number, tipo: 'RADICADO' | 'CONFIRMACION', archivo: File): Observable<TramiteEps> {
    const fd = new FormData();
    fd.append('file', archivo, archivo.name);
    return this.http.post<TramiteEps>(`${BASE}/tramites/${id}/soporte/${tipo}`, fd);
  }

  /** Por blob autenticado: un <a href> plano no lleva el JWT y el gateway responde 401. */
  descargarSoporte(id: number, tipo: 'RADICADO' | 'CONFIRMACION'): Observable<Blob> {
    return this.http.get(`${BASE}/tramites/${id}/soporte/${tipo}`, { responseType: 'blob' });
  }
}

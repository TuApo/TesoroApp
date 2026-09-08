import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import { getLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import { InformeUmbral, Page } from '../../models/incapacidad-v2.model';
import {
  AlertaBandeja,
  AlertasResumen,
  CorreoConfig,
  CorreoConfigRequest,
  CorreoEmpresa,
  CorreoEmpresaRequest,
  EnvioHistorial,
  EstadoAlertaIncapacidad,
  FilaSst,
  FiltrosAlertas,
  FiltrosInforme,
  FiltrosSst,
  GrupoEmpresa,
  InformeGlobal,
  InformeRecurrencia,
  InformeTop,
  InvestigacionSstRequest,
  LoteCorreo,
  LotePreview,
  NotificacionCorreo,
  ResultadoEnvioLote,
  ResumenSst,
} from '../../models/incapacidad-gestion.model';

/**
 * Servicio de los submodulos de gestion de incapacidades (reunion 2026-09-07): correos a
 * empresas usuarias, informes, alertas y seguridad y salud en el trabajo.
 *
 * Vive aparte de `IncapacidadV2Service` (registro/consulta) para no engordarlo: mismas
 * convenciones — todo por `environment.apiUrl`, errores propagados tal cual, actor en el
 * cuerpo porque el gateway aun no inyecta X-User-*.
 */
@Injectable({ providedIn: 'root' })
export class IncapacidadGestionService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/Incapacidades/v2`;

  // ── Cabeceras / actor ─────────────────────────────────────────────────

  private cabeceras(): HttpHeaders {
    const token = getLocalStorageItem('token');
    return token ? new HttpHeaders().set('Authorization', token) : new HttpHeaders();
  }

  private cabecerasJson(): HttpHeaders {
    return this.cabeceras().set('Content-Type', 'application/json');
  }

  /** Nombre del usuario logueado para la bitacora (tolerante: sin usuario queda "anonimo"). */
  actor(): string | undefined {
    try {
      const crudo = getLocalStorageItem('user');
      if (!crudo) return undefined;
      const usuario = JSON.parse(crudo) as {
        email?: string;
        datos_basicos?: { nombres?: string; apellidos?: string };
      };
      const nombre =
        usuario.email ||
        [usuario.datos_basicos?.nombres, usuario.datos_basicos?.apellidos].filter(Boolean).join(' ');
      return nombre || undefined;
    } catch {
      return undefined;
    }
  }

  /** Query params sin vacios. */
  private params(valores: Record<string, unknown>): HttpParams {
    let p = new HttpParams();
    for (const [clave, valor] of Object.entries(valores)) {
      if (valor === null || valor === undefined) continue;
      const texto = String(valor).trim();
      if (!texto) continue;
      p = p.set(clave, texto);
    }
    return p;
  }

  // ── Correos: configuracion ────────────────────────────────────────────

  correoConfig(): Observable<CorreoConfig> {
    return this.http.get<CorreoConfig>(`${this.base}/correos/config`, { headers: this.cabeceras() });
  }

  actualizarCorreoConfig(req: CorreoConfigRequest): Observable<CorreoConfig> {
    return this.http.put<CorreoConfig>(
      `${this.base}/correos/config`,
      { ...req, actor: this.actor() },
      { headers: this.cabecerasJson() },
    );
  }

  // ── Correos: directorio ───────────────────────────────────────────────

  directorio(grupo?: GrupoEmpresa | '', incluirInactivos = false): Observable<CorreoEmpresa[]> {
    return this.http.get<CorreoEmpresa[]>(`${this.base}/correos/empresas`, {
      headers: this.cabeceras(),
      params: this.params({ grupo, incluirInactivos: incluirInactivos ? 'true' : '' }),
    });
  }

  crearCorreoEmpresa(req: CorreoEmpresaRequest): Observable<CorreoEmpresa> {
    return this.http.post<CorreoEmpresa>(
      `${this.base}/correos/empresas`,
      { ...req, actor: this.actor() },
      { headers: this.cabecerasJson() },
    );
  }

  editarCorreoEmpresa(id: number, req: CorreoEmpresaRequest): Observable<CorreoEmpresa> {
    return this.http.put<CorreoEmpresa>(
      `${this.base}/correos/empresas/${id}`,
      { ...req, actor: this.actor() },
      { headers: this.cabecerasJson() },
    );
  }

  desactivarCorreoEmpresa(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/correos/empresas/${id}`, { headers: this.cabeceras() });
  }

  // ── Correos: lote diario y trazabilidad ───────────────────────────────

  previsualizarLote(fecha?: string): Observable<LotePreview> {
    return this.http.get<LotePreview>(`${this.base}/correos/lotes/previsualizar`, {
      headers: this.cabeceras(),
      params: this.params({ fecha }),
    });
  }

  enviarLoteAhora(): Observable<ResultadoEnvioLote> {
    return this.http.post<ResultadoEnvioLote>(
      `${this.base}/correos/lotes/enviar`,
      { actor: this.actor() },
      { headers: this.cabecerasJson() },
    );
  }

  lotes(desde?: string, hasta?: string): Observable<LoteCorreo[]> {
    return this.http.get<LoteCorreo[]>(`${this.base}/correos/lotes`, {
      headers: this.cabeceras(),
      params: this.params({ desde, hasta }),
    });
  }

  lote(id: number): Observable<LoteCorreo> {
    return this.http.get<LoteCorreo>(`${this.base}/correos/lotes/${id}`, { headers: this.cabeceras() });
  }

  envios(desde?: string, hasta?: string, estado?: string, page = 0, size = 50): Observable<Page<EnvioHistorial>> {
    return this.http.get<Page<EnvioHistorial>>(`${this.base}/correos/envios`, {
      headers: this.cabeceras(),
      params: this.params({ desde, hasta, estado, page, size }),
    });
  }

  /** HTML exacto de un envio (texto). */
  cuerpoEnvio(id: number): Observable<string> {
    return this.http.get(`${this.base}/correos/envios/${id}/cuerpo`, {
      headers: this.cabeceras(),
      responseType: 'text',
    });
  }

  /** Historial de intentos de UNA incapacidad (endpoint previo, se conserva). */
  historialCorreo(incapacidadId: number): Observable<NotificacionCorreo[]> {
    return this.http.get<NotificacionCorreo[]>(`${this.base}/${incapacidadId}/notificacion-correo`, {
      headers: this.cabeceras(),
    });
  }

  reenviarCorreo(incapacidadId: number): Observable<NotificacionCorreo> {
    return this.http.post<NotificacionCorreo>(
      `${this.base}/${incapacidadId}/notificacion-correo/reenviar`,
      {},
      { headers: this.cabecerasJson() },
    );
  }

  // ── Informes ──────────────────────────────────────────────────────────

  informeGlobal(f: FiltrosInforme = {}): Observable<InformeGlobal> {
    return this.http.get<InformeGlobal>(`${this.base}/informes/global`, {
      headers: this.cabeceras(),
      params: this.params({ desde: f.desde, hasta: f.hasta, grupo: f.grupo }),
    });
  }

  informeRecurrencia(f: FiltrosInforme = {}, maxDias = 2, minEventos = 2): Observable<InformeRecurrencia> {
    return this.http.get<InformeRecurrencia>(`${this.base}/informes/recurrencia`, {
      headers: this.cabeceras(),
      params: this.params({ desde: f.desde, hasta: f.hasta, grupo: f.grupo, maxDias, minEventos }),
    });
  }

  informeTop(f: FiltrosInforme = {}, limite = 25): Observable<InformeTop> {
    return this.http.get<InformeTop>(`${this.base}/informes/top-personas`, {
      headers: this.cabeceras(),
      params: this.params({ desde: f.desde, hasta: f.hasta, grupo: f.grupo, limite }),
    });
  }

  proximosUmbral(margen = 30): Observable<InformeUmbral> {
    return this.http.get<InformeUmbral>(`${this.base}/informes/proximos-umbral`, {
      headers: this.cabeceras(),
      params: this.params({ margen }),
    });
  }

  // ── Alertas ───────────────────────────────────────────────────────────

  alertas(f: FiltrosAlertas = {}, page = 0, size = 25): Observable<Page<AlertaBandeja>> {
    return this.http.get<Page<AlertaBandeja>>(`${this.base}/alertas`, {
      headers: this.cabeceras(),
      params: this.params({ estado: f.estado, destino: f.destino, tipo: f.tipo, cedula: f.cedula, page, size }),
    });
  }

  alertasResumen(): Observable<AlertasResumen> {
    return this.http.get<AlertasResumen>(`${this.base}/alertas/resumen`, { headers: this.cabeceras() });
  }

  atenderAlerta(id: number, estado: EstadoAlertaIncapacidad, nota?: string): Observable<unknown> {
    return this.http.post(
      `${this.base}/alertas/${id}/atender`,
      { estado, nota: nota ?? null, actor: this.actor() },
      { headers: this.cabecerasJson() },
    );
  }

  // ── SST ───────────────────────────────────────────────────────────────

  sstResumen(desde?: string, hasta?: string): Observable<ResumenSst> {
    return this.http.get<ResumenSst>(`${this.base}/sst/resumen`, {
      headers: this.cabeceras(),
      params: this.params({ desde, hasta }),
    });
  }

  sstIncapacidades(f: FiltrosSst = {}, page = 0, size = 25): Observable<Page<FilaSst>> {
    return this.http.get<Page<FilaSst>>(`${this.base}/sst/incapacidades`, {
      headers: this.cabeceras(),
      params: this.params({ desde: f.desde, hasta: f.hasta, q: f.q, estado: f.estado, page, size }),
    });
  }

  sstActualizar(incapacidadId: number, req: InvestigacionSstRequest): Observable<FilaSst> {
    return this.http.put<FilaSst>(
      `${this.base}/sst/${incapacidadId}/investigacion`,
      { ...req, actor: this.actor() },
      { headers: this.cabecerasJson() },
    );
  }

  sstSubirArchivo(incapacidadId: number, archivo: File): Observable<FilaSst> {
    const cuerpo = new FormData();
    cuerpo.append('file', archivo, archivo.name);
    const actor = this.actor();
    if (actor) cuerpo.append('actor', actor);
    return this.http.post<FilaSst>(`${this.base}/sst/${incapacidadId}/investigacion/archivo`, cuerpo, {
      headers: this.cabeceras(),
    });
  }

  sstDescargarArchivo(incapacidadId: number): Observable<Blob> {
    return this.http.get(`${this.base}/sst/${incapacidadId}/investigacion/archivo`, {
      headers: this.cabeceras(),
      responseType: 'blob',
    });
  }
}

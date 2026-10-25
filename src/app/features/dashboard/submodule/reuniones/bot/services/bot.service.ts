import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  BotConfig, Buzon, Comando, Compromiso, CrearSesion, EstadoCompromiso, Evento, Live, PaginaSpring,
  GrupoSesiones, RespuestaChat, Sesion, SesionResumen, TipoComando, UrlArchivo,
} from '../models/bot.model';

/**
 * Asistente de reuniones (bot) contra ms-meetings (`/api/v1/meetings/bot/**`).
 * El JWT lo pone `auth.interceptor`. Imágenes y clips van por URL firmada (`urlArchivo`),
 * porque un `<img>`/`<video>` no puede mandar cabecera Authorization.
 */
@Injectable({ providedIn: 'root' })
export class BotService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/meetings/bot`;

  // ── Configuración ─────────────────────────────────────────────────────────

  config(): Observable<BotConfig> {
    return this.http.get<BotConfig>(`${this.base}/config`);
  }

  guardarConfig(body: BotConfig): Observable<BotConfig> {
    return this.http.put<BotConfig>(`${this.base}/config`, body);
  }

  buzones(): Observable<Buzon[]> {
    return this.http.get<Buzon[]>(`${this.base}/buzones`);
  }

  // ── Sesiones ──────────────────────────────────────────────────────────────

  sesiones(filtros: { estado?: GrupoSesiones | string; page?: number; size?: number } = {}): Observable<PaginaSpring<SesionResumen>> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filtros)) {
      if (v !== undefined && v !== null && `${v}` !== '') params = params.set(k, `${v}`);
    }
    return this.http.get<PaginaSpring<SesionResumen>>(`${this.base}/sessions`, { params });
  }

  crear(body: CrearSesion): Observable<Sesion> {
    return this.http.post<Sesion>(`${this.base}/sessions`, body);
  }

  sesion(id: string): Observable<Sesion> {
    return this.http.get<Sesion>(`${this.base}/sessions/${id}`);
  }

  aprobar(id: string): Observable<Sesion> {
    return this.http.post<Sesion>(`${this.base}/sessions/${id}/aprobar`, {});
  }

  rechazar(id: string): Observable<Sesion> {
    return this.http.post<Sesion>(`${this.base}/sessions/${id}/rechazar`, {});
  }

  cancelar(id: string): Observable<Sesion> {
    return this.http.post<Sesion>(`${this.base}/sessions/${id}/cancelar`, {});
  }

  // ── Sala en vivo ──────────────────────────────────────────────────────────

  live(id: string, desde: number, notasVersion: number): Observable<Live> {
    const params = new HttpParams().set('desde', `${desde}`).set('notas_version', `${notasVersion}`);
    return this.http.get<Live>(`${this.base}/sessions/${id}/live`, { params });
  }

  comando(id: string, tipo: TipoComando, extra: { texto?: string; segundos?: number } = {}): Observable<Comando> {
    return this.http.post<Comando>(`${this.base}/sessions/${id}/comandos`, { tipo, ...extra });
  }

  chat(id: string, pregunta: string): Observable<RespuestaChat> {
    return this.http.post<RespuestaChat>(`${this.base}/sessions/${id}/chat`, { pregunta });
  }

  marca(id: string, texto: string): Observable<Evento> {
    return this.http.post<Evento>(`${this.base}/sessions/${id}/marcas`, { texto });
  }

  agregarCompromiso(id: string, body: { texto: string; responsable?: string | null; fecha_limite?: string | null }): Observable<Compromiso> {
    return this.http.post<Compromiso>(`${this.base}/sessions/${id}/compromisos`, body);
  }

  editarCompromiso(id: string, cid: string, body: {
    texto?: string; responsable?: string | null; fecha_limite?: string | null; estado?: EstadoCompromiso;
  }): Observable<Compromiso> {
    return this.http.patch<Compromiso>(`${this.base}/sessions/${id}/compromisos/${cid}`, body);
  }

  /**
   * URL firmada (10 min) de una captura o clip. Viene RELATIVA a la raíz del API
   * (`/api/v1/meetings/media/bot/...?t=`): se completa con `absoluta`.
   */
  urlArchivo(id: string, eventoId: number): Observable<UrlArchivo> {
    return this.http.get<UrlArchivo>(`${this.base}/sessions/${id}/archivos/${eventoId}/url`);
  }

  absoluta(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `${environment.apiUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  // ── Captura desde el dispositivo ─────────────────────────────────────────

  subirAudio(id: string, seq: number, trozo: Blob): Observable<{ seq: number }> {
    const params = new HttpParams().set('seq', `${seq}`);
    return this.http.put<{ seq: number }>(`${this.base}/sessions/${id}/captura/audio`, trozo, {
      params, headers: { 'Content-Type': (trozo.type || 'audio/webm').split(';')[0] },
    });
  }

  subirImagen(id: string, tMs: number, imagen: Blob): Observable<Evento> {
    const params = new HttpParams().set('t_ms', `${Math.max(0, Math.round(tMs))}`);
    return this.http.put<Evento>(`${this.base}/sessions/${id}/captura/imagen`, imagen, {
      params, headers: { 'Content-Type': imagen.type || 'image/jpeg' },
    });
  }
}

import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import { AccionAcuse, Acuse, ConfigParlantePublico, OkMensaje, SttToken } from '../models/seguridad.models';

/**
 * Superficie PÚBLICA de ms-seguridad (`/api/v1/public/seguridad`), sin JWT: el parlante en modo
 * quiosco y el enlace de acuse que llega en los mensajes de alarma. El interceptor de auth deja
 * pasar todo lo que cuelga de `/api/v1/public/` sin exigir sesión.
 *
 * <p>Credencial del parlante: `?token=` (SSE y audios, que no admiten cabeceras) o la cabecera
 * `X-Parlante-Token` (el resto).
 */
@Injectable({ providedIn: 'root' })
export class SeguridadPublicoService {
  private readonly http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1/public/seguridad`;

  private cab(token: string | null): { headers?: HttpHeaders } {
    return token ? { headers: new HttpHeaders({ 'X-Parlante-Token': token }) } : {};
  }

  /** Agrega `token=` a una URL si no lo trae. */
  conToken(url: string, token: string | null): string {
    if (!token || /[?&]token=/.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  }

  // ── Parlante ─────────────────────────────────────────────────────────────
  private p(codigo: string): string { return `${this.base}/parlante/${encodeURIComponent(codigo)}`; }

  configParlante(codigo: string, token: string | null): Observable<ConfigParlantePublico> {
    return this.http.get<ConfigParlantePublico>(this.p(codigo), this.cab(token));
  }
  urlStreamParlante(codigo: string, token: string | null): string { return this.conToken(`${this.p(codigo)}/stream`, token); }
  urlAudioParlante(codigo: string, audioId: string, token: string | null): string {
    return this.conToken(`${this.p(codigo)}/audio/${encodeURIComponent(audioId)}`, token);
  }
  latido(codigo: string, token: string | null, estado: string): Observable<unknown> {
    return this.http.post(`${this.p(codigo)}/latido`, { estado }, this.cab(token));
  }
  transcripcion(codigo: string, token: string | null, t: { texto: string; inicio: string; fin: string }): Observable<unknown> {
    return this.http.post(`${this.p(codigo)}/transcripcion`, t, this.cab(token));
  }
  sttToken(codigo: string, token: string | null): Observable<SttToken> {
    return this.http.get<SttToken>(`${this.p(codigo)}/stt-token`, this.cab(token));
  }

  // ── Acuse ────────────────────────────────────────────────────────────────
  acuse(token: string): Observable<Acuse> { return this.http.get<Acuse>(`${this.base}/acuse/${encodeURIComponent(token)}`); }
  responderAcuse(token: string, accion: AccionAcuse, nota?: string | null): Observable<OkMensaje> {
    return this.http.post<OkMensaje>(`${this.base}/acuse/${encodeURIComponent(token)}`, { accion, nota: nota || undefined });
  }
  urlCapturaAcuse(token: string): string { return `${this.base}/acuse/${encodeURIComponent(token)}/captura`; }
}

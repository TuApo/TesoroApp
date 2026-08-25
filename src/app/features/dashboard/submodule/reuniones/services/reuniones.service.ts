import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  CrearReunion, Grabacion, Nota, PaginaSpring, Participante, ResultadoBusqueda,
  ReunionDetalle, ReunionResumen, SegmentoTranscripcion, Transcripcion,
} from '../models/reunion.model';

/**
 * Reuniones Funcionales y Gestión de Requisitos, contra ms-meetings.
 *
 * El JWT lo pone `auth.interceptor`; aquí no se arma ninguna cabecera. La única
 * excepción es la reproducción del audio, que va por URL firmada (ver `urlDeMedia`).
 */
@Injectable({ providedIn: 'root' })
export class ReunionesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/meetings`;

  // ── Reuniones ─────────────────────────────────────────────────────────────

  listar(filtros: {
    q?: string; status?: string; desde?: string; hasta?: string;
    page?: number; size?: number;
  } = {}): Observable<PaginaSpring<ReunionResumen>> {
    let params = new HttpParams();
    for (const [clave, valor] of Object.entries(filtros)) {
      if (valor !== undefined && valor !== null && `${valor}` !== '') {
        params = params.set(clave, `${valor}`);
      }
    }
    return this.http.get<PaginaSpring<ReunionResumen>>(this.base, { params });
  }

  detalle(id: string): Observable<ReunionDetalle> {
    return this.http.get<ReunionDetalle>(`${this.base}/${id}`);
  }

  crear(body: CrearReunion): Observable<ReunionDetalle> {
    return this.http.post<ReunionDetalle>(this.base, body);
  }

  actualizar(id: string, body: CrearReunion): Observable<ReunionDetalle> {
    return this.http.put<ReunionDetalle>(`${this.base}/${id}`, body);
  }

  eliminar(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  // ── Participantes y notas ─────────────────────────────────────────────────

  participantes(id: string): Observable<Participante[]> {
    return this.http.get<Participante[]>(`${this.base}/${id}/participants`);
  }

  agregarParticipante(id: string, body: Partial<Participante>): Observable<Participante> {
    return this.http.post<Participante>(`${this.base}/${id}/participants`, body);
  }

  quitarParticipante(id: string, participanteId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/participants/${participanteId}`);
  }

  notas(id: string): Observable<Nota[]> {
    return this.http.get<Nota[]>(`${this.base}/${id}/notes`);
  }

  agregarNota(id: string, body: { at_ms: number | null; body: string }): Observable<Nota> {
    return this.http.post<Nota>(`${this.base}/${id}/notes`, body);
  }

  // ── Grabaciones ───────────────────────────────────────────────────────────

  grabaciones(id: string): Observable<Grabacion[]> {
    return this.http.get<Grabacion[]>(`${this.base}/${id}/recordings`);
  }

  eliminarGrabacion(grabacionId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/recordings/${grabacionId}`);
  }

  /**
   * URL reproducible para `<audio src>`.
   *
   * POR QUÉ NO SE USA EL INTERCEPTOR: un elemento `<audio>`/`<video>` no manda
   * cabeceras, así que el JWT no viaja y el gateway devolvería 401. Se pide primero un
   * token firmado (esa petición SÍ lleva el JWT y comprueba permiso y ACL) y se pega
   * como query param. Dura minutos y sólo sirve para esa grabación y ese usuario.
   *
   * Tampoco se descarga a un blob: dos horas de audio no caben en memoria y se perdería
   * el salto por rangos, que es justo lo que hace utilizable el reproductor.
   */
  async urlDeMedia(grabacionId: string): Promise<string> {
    const { token } = await new Promise<{ token: string }>((resolve, reject) => {
      this.http.post<{ token: string }>(`${this.base}/recordings/${grabacionId}/media-token`, {})
        .subscribe({ next: resolve, error: reject });
    });
    return `${this.base}/media/${grabacionId}?t=${encodeURIComponent(token)}`;
  }

  // ── Transcripción ─────────────────────────────────────────────────────────

  transcripcion(grabacionId: string): Observable<Transcripcion> {
    return this.http.get<Transcripcion>(`${this.base}/recordings/${grabacionId}/transcript`);
  }

  segmentos(grabacionId: string, page = 0, size = 200): Observable<PaginaSpring<SegmentoTranscripcion>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PaginaSpring<SegmentoTranscripcion>>(
      `${this.base}/recordings/${grabacionId}/segments`, { params });
  }

  buscarEnTranscripcion(grabacionId: string, q: string): Observable<ResultadoBusqueda> {
    const params = new HttpParams().set('q', q);
    return this.http.get<ResultadoBusqueda>(
      `${this.base}/recordings/${grabacionId}/search`, { params });
  }

  editarSegmento(segmentoId: number, text: string): Observable<SegmentoTranscripcion> {
    return this.http.put<SegmentoTranscripcion>(`${this.base}/segments/${segmentoId}`, { text });
  }

  asignarHablante(hablanteId: string, participanteId: string | null): Observable<unknown> {
    return this.http.put(`${this.base}/speakers/${hablanteId}`, { participant_id: participanteId });
  }
}

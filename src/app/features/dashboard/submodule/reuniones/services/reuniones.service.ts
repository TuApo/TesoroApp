import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  Acuerdo, Analisis, CrearReunion, FichaPersona, FiltroSegmentos, Grabacion, GuardarAcuerdo,
  HablanteInsight, InsightsReunion, Nota, PaginaSpring, Participante, Persona, ResultadoBusqueda,
  ResultadoBusquedaGlobal, ReunionDetalle, ReunionResumen, SegmentoTranscripcion, Transcripcion,
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

  /**
   * Segmentos por páginas. `filtro` acota a un hablante y/o a un rango de tiempo (un tema);
   * la ficha trae la reunión completa y filtra en el navegador, pero el backend lo admite
   * para quien necesite sólo un pedazo.
   */
  segmentos(
    grabacionId: string, page = 0, size = 200, filtro: FiltroSegmentos = {},
  ): Observable<PaginaSpring<SegmentoTranscripcion>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (filtro.speaker_id) params = params.set('speaker_id', filtro.speaker_id);
    if (filtro.from_ms != null) params = params.set('from_ms', filtro.from_ms);
    if (filtro.to_ms != null) params = params.set('to_ms', filtro.to_ms);
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

  /** Asignación MANUAL; `null` la limpia. */
  asignarHablante(hablanteId: string, participanteId: string | null): Observable<HablanteInsight> {
    return this.http.put<HablanteInsight>(`${this.base}/speakers/${hablanteId}`, { participant_id: participanteId });
  }

  /** Da por buena la asignación que hizo la IA (IA → MANUAL). */
  confirmarHablante(hablanteId: string): Observable<HablanteInsight> {
    return this.http.post<HablanteInsight>(`${this.base}/speakers/${hablanteId}/confirm`, {});
  }

  /** Crea el participante con el nombre y el cargo que sugirió la IA y se lo asigna. 409 sin sugerencia. */
  participanteDesdeSugerencia(hablanteId: string): Observable<HablanteInsight> {
    return this.http.post<HablanteInsight>(
      `${this.base}/speakers/${hablanteId}/participant-from-suggestion`, {});
  }

  // ── Lo que se habló: análisis, temas y acuerdos ───────────────────────────

  /** Hablantes con estadísticas, temas, acuerdos, resumen y estado del pipeline. */
  insights(reunionId: string): Observable<InsightsReunion> {
    return this.http.get<InsightsReunion>(`${this.base}/${reunionId}/insights`);
  }

  /**
   * Relanza el análisis (202). Acepta la respuesta como el análisis suelto o envuelto en
   * `{ analysis }`: el contrato dice "202 + analysis" y no vale la pena romperse por la forma.
   */
  analizar(reunionId: string): Observable<Analisis | null> {
    return this.http.post<Analisis | { analysis: Analisis } | null>(`${this.base}/${reunionId}/analyze`, {})
      .pipe(map(r => (r && 'analysis' in r ? r.analysis : (r as Analisis | null))));
  }

  crearAcuerdo(reunionId: string, body: GuardarAcuerdo): Observable<Acuerdo> {
    return this.http.post<Acuerdo>(`${this.base}/${reunionId}/items`, body);
  }

  actualizarAcuerdo(acuerdoId: string, body: GuardarAcuerdo): Observable<Acuerdo> {
    return this.http.put<Acuerdo>(`${this.base}/items/${acuerdoId}`, body);
  }

  eliminarAcuerdo(acuerdoId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/items/${acuerdoId}`);
  }

  // ── Búsqueda global y personas ────────────────────────────────────────────

  /** Busca en TODO lo transcrito que el usuario puede ver. `persona` = person_key. */
  buscarGlobal(q: string, opciones: { persona?: string | null; limit?: number } = {}): Observable<ResultadoBusquedaGlobal> {
    let params = new HttpParams().set('q', q);
    if (opciones.persona) params = params.set('person', opciones.persona);
    if (opciones.limit) params = params.set('limit', opciones.limit);
    return this.http.get<ResultadoBusquedaGlobal>(`${this.base}/search`, { params });
  }

  /** Directorio de personas a través de todas las reuniones visibles. */
  personas(q?: string): Observable<Persona[]> {
    let params = new HttpParams();
    if (q?.trim()) params = params.set('q', q.trim());
    return this.http.get<Persona[]>(`${this.base}/people`, { params });
  }

  /** Ficha de una persona. La clave lleva `:` y a veces `@` o espacios: va codificada. */
  persona(clave: string): Observable<FichaPersona> {
    return this.http.get<FichaPersona>(`${this.base}/people/${encodeURIComponent(clave)}`);
  }
}

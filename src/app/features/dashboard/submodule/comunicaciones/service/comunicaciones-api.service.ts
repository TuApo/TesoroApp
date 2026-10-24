import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  AccionRedactar, Adjunto, Busqueda, Compromiso, CompromisoReq, Conversacion, EnVivo, Favorito, FiltroDirectorio, LineaVivo, Llamada,
  Mensaje, MensajeLlamada, MiCoordinador, Momento, MsgAsistente,
  OpcionesDirectorio, PaginaPersonas, ParticipanteOut, ReglaContacto, ReglaContactoReq, Resumen, Transcripcion, UnirseOut,
  UsuarioDir,
} from '../modelos';

/** HTTP de ms-comunicaciones. El JWT lo pone el interceptor. */
@Injectable({ providedIn: 'root' })
export class ComunicacionesApiService {
  private readonly http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1/comunicaciones`;

  /** Las URLs firmadas llegan relativas ("/api/v1/public/..."): se completan con el host del API. */
  absoluta(url: string | null | undefined): string | null {
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : `${environment.apiUrl}${url}`;
  }

  urlEventos(): string { return `${this.base}/eventos`; }

  // ─── Directorio ─────────────────────────────────────────────────────────
  buscarPersonas(q: string, limite = 20): Observable<UsuarioDir[]> {
    return this.http.get<UsuarioDir[]>(`${this.base}/usuarios`, { params: { q, limite } });
  }
  yo(): Observable<UsuarioDir> { return this.http.get<UsuarioDir>(`${this.base}/usuarios/yo`); }
  /** Directorio de la organización con filtros; primero quien está activo. */
  directorio(f: FiltroDirectorio): Observable<PaginaPersonas> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get<PaginaPersonas>(`${this.base}/usuarios/directorio`, { params });
  }
  opcionesDirectorio(): Observable<OpcionesDirectorio> {
    return this.http.get<OpcionesDirectorio>(`${this.base}/usuarios/opciones`);
  }
  misFavoritos(): Observable<Favorito[]> { return this.http.get<Favorito[]>(`${this.base}/usuarios/mis-favoritos`); }
  estrella(usuarioId: string, poner: boolean): Observable<void> {
    const url = `${this.base}/usuarios/${usuarioId}/favorito`;
    return poner ? this.http.put<void>(url, {}) : this.http.delete<void>(url);
  }
  misCoordinadores(): Observable<MiCoordinador[]> {
    return this.http.get<MiCoordinador[]>(`${this.base}/usuarios/mis-coordinadores`);
  }
  foto(id: string): Observable<{ foto: string | null }> {
    return this.http.get<{ foto: string | null }>(`${this.base}/usuarios/${id}/foto`);
  }

  // ─── Conversaciones ─────────────────────────────────────────────────────
  conversaciones(archivadas = false): Observable<Conversacion[]> {
    return this.http.get<Conversacion[]>(`${this.base}/conversaciones`, { params: { archivadas } });
  }
  conversacion(id: string): Observable<Conversacion> {
    return this.http.get<Conversacion>(`${this.base}/conversaciones/${id}`);
  }
  directa(usuarioId: string): Observable<Conversacion> {
    return this.http.post<Conversacion>(`${this.base}/conversaciones/directa`, { usuario_id: usuarioId });
  }
  grupo(titulo: string, participantes: string[], descripcion?: string): Observable<Conversacion> {
    return this.http.post<Conversacion>(`${this.base}/conversaciones/grupo`, { titulo, descripcion, participantes });
  }
  actualizar(id: string, cambios: { titulo?: string; descripcion?: string; color?: string }): Observable<Conversacion> {
    return this.http.patch<Conversacion>(`${this.base}/conversaciones/${id}`, cambios);
  }
  preferencias(id: string, p: { silenciada?: boolean; fijada?: boolean; archivada?: boolean }): Observable<Conversacion> {
    return this.http.put<Conversacion>(`${this.base}/conversaciones/${id}/preferencias`, p);
  }
  agregar(id: string, usuarios: string[]): Observable<Conversacion> {
    return this.http.post<Conversacion>(`${this.base}/conversaciones/${id}/participantes`, { usuarios });
  }
  quitar(id: string, usuarioId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/conversaciones/${id}/participantes/${usuarioId}`);
  }
  /** Participantes paginados (los grupos por rango pueden tener miles). */
  participantes(id: string, q = '', pagina = 0, tamano = 60): Observable<ParticipanteOut[]> {
    return this.http.get<ParticipanteOut[]>(`${this.base}/conversaciones/${id}/participantes`, { params: { q, pagina, tamano } });
  }
  rol(id: string, usuarioId: string, rol: 'ADMIN' | 'MIEMBRO'): Observable<Conversacion> {
    return this.http.put<Conversacion>(`${this.base}/conversaciones/${id}/participantes/${usuarioId}/rol`, { rol });
  }

  // ─── Soporte ────────────────────────────────────────────────────────────
  /** Abre (o crea) la línea de soporte propia. */
  soporte(): Observable<Conversacion> { return this.http.post<Conversacion>(`${this.base}/soporte`, {}); }
  escalarSoporte(id: string): Observable<Conversacion> {
    return this.http.post<Conversacion>(`${this.base}/soporte/${id}/escalar`, {});
  }
  /** Devuelve la conversación si cierra la dueña; null (204) si cierra alguien del equipo. */
  cerrarSoporte(id: string): Observable<Conversacion | null> {
    return this.http.post<Conversacion | null>(`${this.base}/soporte/${id}/cerrar`, {});
  }

  // ─── Mensajes ───────────────────────────────────────────────────────────
  mensajes(id: string, opts: { antes?: number; despues?: number; limite?: number } = {}): Observable<Mensaje[]> {
    let params = new HttpParams().set('limite', opts.limite ?? 40);
    if (opts.antes != null) params = params.set('antes', opts.antes);
    if (opts.despues != null) params = params.set('despues', opts.despues);
    return this.http.get<Mensaje[]>(`${this.base}/conversaciones/${id}/mensajes`, { params });
  }
  enviar(id: string, cuerpo: { texto?: string | null; responde_a_id?: number | null; adjuntos?: string[]; cliente_id: string }): Observable<Mensaje> {
    return this.http.post<Mensaje>(`${this.base}/conversaciones/${id}/mensajes`, cuerpo);
  }
  editar(mensajeId: number, texto: string): Observable<Mensaje> {
    return this.http.patch<Mensaje>(`${this.base}/mensajes/${mensajeId}`, { texto });
  }
  eliminar(mensajeId: number): Observable<Mensaje> {
    return this.http.delete<Mensaje>(`${this.base}/mensajes/${mensajeId}`);
  }
  leido(id: string, hastaId: number): Observable<void> {
    return this.http.post<void>(`${this.base}/conversaciones/${id}/leido`, { hasta_id: hastaId });
  }
  escribiendo(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/conversaciones/${id}/escribiendo`, {});
  }

  // ─── Adjuntos ───────────────────────────────────────────────────────────
  subir(conversacionId: string, archivo: File, clase?: string, texto?: string): Observable<HttpEvent<Adjunto>> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    let params = new HttpParams();
    if (clase) params = params.set('clase', clase);
    if (texto) fd.append('texto', texto);
    return this.http.post<Adjunto>(`${this.base}/conversaciones/${conversacionId}/adjuntos`, fd,
      { params, reportProgress: true, observe: 'events' });
  }
  descartarAdjunto(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/adjuntos/${id}`); }
  galeria(conversacionId: string, clases: string[] = [], limite = 120): Observable<Adjunto[]> {
    let params = new HttpParams().set('limite', limite);
    for (const c of clases) params = params.append('clase', c);
    return this.http.get<Adjunto[]>(`${this.base}/conversaciones/${conversacionId}/adjuntos`, { params });
  }

  // ─── Llamadas ───────────────────────────────────────────────────────────
  rtcConfig(): Observable<{ ice_servers: RTCIceServer[]; tiene_turn: boolean; servidor_ahora_ms: number }> {
    return this.http.get<{ ice_servers: RTCIceServer[]; tiene_turn: boolean; servidor_ahora_ms: number }>(`${this.base}/rtc/config`);
  }
  iniciarLlamada(conversacionId: string, tipo: 'AUDIO' | 'VIDEO', transcribir: boolean, sesion: string): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/conversaciones/${conversacionId}/llamadas`, { tipo, transcribir, sesion });
  }
  llamada(id: string): Observable<Llamada> { return this.http.get<Llamada>(`${this.base}/llamadas/${id}`); }
  historial(conversacionId?: string, limite = 60): Observable<Llamada[]> {
    let params = new HttpParams().set('limite', limite);
    if (conversacionId) params = params.set('conversacion_id', conversacionId);
    return this.http.get<Llamada[]>(`${this.base}/llamadas`, { params });
  }
  unirse(id: string, sesion: string): Observable<UnirseOut> {
    return this.http.post<UnirseOut>(`${this.base}/llamadas/${id}/unirse`, { sesion });
  }
  rechazar(id: string): Observable<Llamada> { return this.http.post<Llamada>(`${this.base}/llamadas/${id}/rechazar`, {}); }
  salir(id: string, sesion: string): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/llamadas/${id}/salir`, { sesion });
  }
  terminar(id: string): Observable<Llamada> { return this.http.post<Llamada>(`${this.base}/llamadas/${id}/terminar`, {}); }
  /** Sumar personas a la llamada en curso (aunque no sean del chat). */
  invitarALlamada(id: string, usuarios: string[]): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/llamadas/${id}/invitar`, { usuarios });
  }
  chatDeLlamada(id: string): Observable<MensajeLlamada[]> {
    return this.http.get<MensajeLlamada[]>(`${this.base}/llamadas/${id}/chat`);
  }
  escribirEnLlamada(id: string, texto: string, clienteId: string): Observable<Mensaje> {
    return this.http.post<Mensaje>(`${this.base}/llamadas/${id}/chat`, { texto, cliente_id: clienteId });
  }
  senal(id: string, cuerpo: { para: string; para_sesion: string | null; de_sesion: string; tipo: string; datos: unknown }): Observable<void> {
    return this.http.post<void>(`${this.base}/llamadas/${id}/senal`, cuerpo);
  }
  abrirPista(llamadaId: string, pistaId: string, inicioServidorMs: number, mime: string, tipo: 'AUDIO' | 'PANTALLA' = 'AUDIO'): Observable<unknown> {
    return this.http.post(`${this.base}/llamadas/${llamadaId}/pistas`,
      { pista_id: pistaId, inicio_servidor_ms: Math.round(inicioServidorMs), mime, tipo });
  }
  subirParte(llamadaId: string, pistaId: string, indice: number, datos: Blob): Observable<void> {
    return this.http.put<void>(`${this.base}/llamadas/${llamadaId}/pistas/${pistaId}/partes/${indice}`, datos,
      { headers: { 'Content-Type': 'application/octet-stream' } });
  }
  cerrarPista(llamadaId: string, pistaId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/llamadas/${llamadaId}/pistas/${pistaId}/cerrar`, {});
  }

  // ─── En vivo y momentos ─────────────────────────────────────────────────
  tokenEnVivo(llamadaId: string): Observable<{ token: string; url: string; modelo: string; idioma: string; sample_rate: number }> {
    return this.http.post<{ token: string; url: string; modelo: string; idioma: string; sample_rate: number }>(
      `${this.base}/llamadas/${llamadaId}/en-vivo/token`, {});
  }
  guardarLineasVivo(llamadaId: string, lineas: { cliente_id: string; texto: string; inicio_ms: number; fin_ms: number | null }[]): Observable<LineaVivo[]> {
    return this.http.post<LineaVivo[]>(`${this.base}/llamadas/${llamadaId}/en-vivo/lineas`, { lineas });
  }
  enVivo(llamadaId: string): Observable<EnVivo> { return this.http.get<EnVivo>(`${this.base}/llamadas/${llamadaId}/en-vivo`); }
  guardarMomento(llamadaId: string, cuerpo: { momento_ms?: number | null; titulo?: string | null; nota?: string | null } = {}): Observable<Momento> {
    return this.http.post<Momento>(`${this.base}/llamadas/${llamadaId}/momentos`, cuerpo);
  }
  momentos(llamadaId: string): Observable<Momento[]> { return this.http.get<Momento[]>(`${this.base}/llamadas/${llamadaId}/momentos`); }
  editarMomento(id: string, cuerpo: { titulo?: string | null; nota?: string | null }): Observable<Momento> {
    return this.http.patch<Momento>(`${this.base}/momentos/${id}`, cuerpo);
  }
  quitarMomento(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/momentos/${id}`); }
  imagenMomento(id: string, jpeg: Blob): Observable<Momento> {
    return this.http.put<Momento>(`${this.base}/momentos/${id}/imagen`, jpeg, { headers: { 'Content-Type': 'application/octet-stream' } });
  }

  // ─── Asistente IA ───────────────────────────────────────────────────────
  preguntarAsistente(ambito: { conversacion_id?: string | null; llamada_id?: string | null }, texto: string): Observable<MsgAsistente> {
    return this.http.post<MsgAsistente>(`${this.base}/asistente`, { ...ambito, texto });
  }
  historialAsistente(ambito: { conversacion_id?: string | null; llamada_id?: string | null }): Observable<MsgAsistente[]> {
    let params = new HttpParams();
    if (ambito.conversacion_id) params = params.set('conversacion_id', ambito.conversacion_id);
    if (ambito.llamada_id) params = params.set('llamada_id', ambito.llamada_id);
    return this.http.get<MsgAsistente[]>(`${this.base}/asistente`, { params });
  }
  olvidarAsistente(ambito: { conversacion_id?: string | null; llamada_id?: string | null }): Observable<void> {
    let params = new HttpParams();
    if (ambito.conversacion_id) params = params.set('conversacion_id', ambito.conversacion_id);
    if (ambito.llamada_id) params = params.set('llamada_id', ambito.llamada_id);
    return this.http.delete<void>(`${this.base}/asistente`, { params });
  }
  redactar(cuerpo: { conversacion_id?: string | null; llamada_id?: string | null; texto?: string; accion: AccionRedactar; instruccion?: string }): Observable<{ texto: string }> {
    return this.http.post<{ texto: string }>(`${this.base}/asistente/redactar`, cuerpo);
  }

  // ─── Memoria ────────────────────────────────────────────────────────────
  transcripcion(llamadaId: string): Observable<Transcripcion> {
    return this.http.get<Transcripcion>(`${this.base}/llamadas/${llamadaId}/transcripcion`);
  }
  reprocesar(llamadaId: string): Observable<unknown> { return this.http.post(`${this.base}/llamadas/${llamadaId}/reprocesar`, {}); }
  resumenes(conversacionId: string): Observable<Resumen[]> {
    return this.http.get<Resumen[]>(`${this.base}/conversaciones/${conversacionId}/resumenes`);
  }
  resumir(conversacionId: string): Observable<unknown> {
    return this.http.post(`${this.base}/conversaciones/${conversacionId}/resumir`, {});
  }
  compromisos(filtro: { alcance?: 'mios' | 'todos'; estado?: string; conversacion_id?: string } = {}): Observable<Compromiso[]> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filtro)) if (v) params = params.set(k, v);
    return this.http.get<Compromiso[]>(`${this.base}/compromisos`, { params });
  }
  crearCompromiso(c: CompromisoReq): Observable<Compromiso> { return this.http.post<Compromiso>(`${this.base}/compromisos`, c); }
  actualizarCompromiso(id: string, c: CompromisoReq): Observable<Compromiso> {
    return this.http.patch<Compromiso>(`${this.base}/compromisos/${id}`, c);
  }
  eliminarCompromiso(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/compromisos/${id}`); }
  buscar(q: string, conversacionId?: string): Observable<Busqueda> {
    let params = new HttpParams().set('q', q);
    if (conversacionId) params = params.set('conversacion_id', conversacionId);
    return this.http.get<Busqueda>(`${this.base}/buscar`, { params });
  }
  estado(): Observable<{ ia: boolean; administra_contactos?: boolean }> {
    return this.http.get<{ ia: boolean; administra_contactos?: boolean }>(`${this.base}/estado`);
  }

  // ─── Contactos para novedades (administración) ─────────────────────────
  contactosAsignados(): Observable<ReglaContacto[]> { return this.http.get<ReglaContacto[]>(`${this.base}/contactos-asignados`); }
  crearContacto(r: ReglaContactoReq): Observable<ReglaContacto> {
    return this.http.post<ReglaContacto>(`${this.base}/contactos-asignados`, r);
  }
  actualizarContacto(id: number, r: ReglaContactoReq): Observable<ReglaContacto> {
    return this.http.put<ReglaContacto>(`${this.base}/contactos-asignados/${id}`, r);
  }
  borrarContacto(id: number): Observable<void> { return this.http.delete<void>(`${this.base}/contactos-asignados/${id}`); }
  audiencia(r: { rol?: string | null; alcance_tipo: string; alcance_clave?: string | null; contacto_id?: string | null }): Observable<{ personas: number }> {
    let params = new HttpParams().set('alcanceTipo', r.alcance_tipo);
    if (r.rol) params = params.set('rol', r.rol);
    if (r.alcance_clave) params = params.set('alcanceClave', r.alcance_clave);
    if (r.contacto_id) params = params.set('contactoId', r.contacto_id);
    return this.http.get<{ personas: number }>(`${this.base}/contactos-asignados/audiencia`, { params });
  }
}

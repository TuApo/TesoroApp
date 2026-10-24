import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  AccionDispositivo, AccionPtz, AccionRegistrada, Acceso, Agente, Ajustes, AjustesEntrada, Audio, Aforo, Avistamiento,
  Calidad, Camara, Clip, Conteos, Contacto, Demografia, Dispositivo, DispositivoEntrada, Evento, FuenteReproduccion,
  Grabaciones, Grabador, GrabadorEntrada, Grupo, Incidente, IncidenteDetalle, Integracion, Mosaico, NuevoIncidente,
  OkMensaje, Pagina, Parlante, PedidoLocucion, PedidoReproducir, Persona, Protocolo, Regla, RegistroAuditoria,
  Reproduccion, RespuestaAccion, ResultadoDescubrir, ResultadoPrueba, Rostro, Sede, SesionMedia, Sistema, StreamCamara,
  Tablero, TipoAudio, TokenAgente, TokenParlante, Transcripcion, VinculoTelegram, Voz, Zona,
} from '../models/seguridad.models';

type Filtros = Record<string, string | number | boolean | null | undefined>;

/** Arma HttpParams sin los vacíos (null, undefined, ''). */
export function params(f: Filtros = {}): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === null || v === undefined || v === '') continue;
    p = p.set(k, String(v));
  }
  return p;
}

/**
 * Las URLs que devuelve el backend (capturas, audios, clips) pueden venir relativas
 * (`/api/v1/seguridad/...`) o absolutas. Aquí quedan siempre absolutas contra la API.
 */
export function urlApi(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/^(https?:|blob:|data:)/i.test(u)) return u;
  return `${environment.apiUrl}${u.startsWith('/') ? '' : '/'}${u}`;
}

/**
 * Todas las llamadas a ms-seguridad (base `/api/v1/seguridad`). JWT por el interceptor.
 * Lectura = operador; crear/editar/borrar = administrador (un 403 trae mensaje en español).
 */
@Injectable({ providedIn: 'root' })
export class SeguridadService {
  private readonly http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1/seguridad`;

  urlStream(): string { return `${this.base}/stream`; }

  // ── Tablero ──────────────────────────────────────────────────────────────
  tablero(): Observable<Tablero> { return this.http.get<Tablero>(`${this.base}/tablero`); }

  // ── CRUD genéricos (sedes, agentes, grabadores, grupos, cámaras…) ────────
  private listar<T>(ruta: string, f?: Filtros): Observable<T[]> { return this.http.get<T[]>(`${this.base}/${ruta}`, { params: params(f) }); }
  private uno<T>(ruta: string, id: string): Observable<T> { return this.http.get<T>(`${this.base}/${ruta}/${id}`); }
  private crear<T>(ruta: string, cuerpo: unknown): Observable<T> { return this.http.post<T>(`${this.base}/${ruta}`, cuerpo); }
  private editar<T>(ruta: string, id: string, cuerpo: unknown): Observable<T> { return this.http.put<T>(`${this.base}/${ruta}/${id}`, cuerpo); }
  private borrar(ruta: string, id: string): Observable<unknown> { return this.http.delete(`${this.base}/${ruta}/${id}`); }

  /** Crea si no hay id, si no actualiza. */
  private guardar<T>(ruta: string, id: string | null | undefined, cuerpo: unknown): Observable<T> {
    return id ? this.editar<T>(ruta, id, cuerpo) : this.crear<T>(ruta, cuerpo);
  }

  // Sedes
  sedes(): Observable<Sede[]> { return this.listar<Sede>('sedes'); }
  guardarSede(id: string | null, s: Partial<Sede>): Observable<Sede> { return this.guardar<Sede>('sedes', id, s); }
  borrarSede(id: string) { return this.borrar('sedes', id); }

  // Agentes de sitio
  agentes(): Observable<Agente[]> { return this.listar<Agente>('agentes'); }
  guardarAgente(id: string | null, a: Partial<Agente>): Observable<Agente> { return this.guardar<Agente>('agentes', id, a); }
  borrarAgente(id: string) { return this.borrar('agentes', id); }
  tokenAgente(id: string): Observable<TokenAgente> { return this.http.post<TokenAgente>(`${this.base}/agentes/${id}/token`, {}); }

  // Grabadores
  grabadores(): Observable<Grabador[]> { return this.listar<Grabador>('grabadores'); }
  guardarGrabador(id: string | null, g: GrabadorEntrada): Observable<Grabador> { return this.guardar<Grabador>('grabadores', id, g); }
  borrarGrabador(id: string) { return this.borrar('grabadores', id); }
  probarGrabador(id: string): Observable<ResultadoPrueba> { return this.http.post<ResultadoPrueba>(`${this.base}/grabadores/${id}/probar`, {}); }
  descubrirCanales(id: string, canales?: number | null): Observable<ResultadoDescubrir> {
    return this.http.post<ResultadoDescubrir>(`${this.base}/grabadores/${id}/descubrir`, canales ? { canales } : {});
  }

  // Grupos
  grupos(): Observable<Grupo[]> { return this.listar<Grupo>('grupos'); }
  guardarGrupo(id: string | null, g: Partial<Grupo>): Observable<Grupo> { return this.guardar<Grupo>('grupos', id, g); }
  borrarGrupo(id: string) { return this.borrar('grupos', id); }

  // Cámaras
  camaras(f: { sede_id?: string | null; grupo_id?: string | null; q?: string | null } = {}): Observable<Camara[]> {
    return this.listar<Camara>('camaras', f);
  }
  camara(id: string): Observable<Camara> { return this.uno<Camara>('camaras', id); }
  guardarCamara(id: string | null, c: Partial<Camara>): Observable<Camara> { return this.guardar<Camara>('camaras', id, c); }
  borrarCamara(id: string) { return this.borrar('camaras', id); }
  stream(id: string, calidad: Calidad): Observable<StreamCamara> {
    return this.http.get<StreamCamara>(`${this.base}/camaras/${id}/stream`, { params: { calidad } });
  }
  urlCaptura(id: string): string { return `${this.base}/camaras/${id}/captura`; }
  /** JPEG como Blob (el `<img>` no puede llevar el JWT). `t` evita la caché. */
  captura(url: string): Observable<Blob> {
    const u = urlApi(url) ?? url;
    const sep = u.includes('?') ? '&' : '?';
    return this.http.get(`${u}${sep}t=${Date.now()}`, { responseType: 'blob' });
  }
  ptz(id: string, accion: AccionPtz, valor?: number | null, velocidad?: number | null): Observable<OkMensaje> {
    return this.http.post<OkMensaje>(`${this.base}/camaras/${id}/ptz`, { accion, valor: valor ?? undefined, velocidad: velocidad ?? undefined });
  }

  // Mosaicos
  mosaicos(): Observable<Mosaico[]> { return this.listar<Mosaico>('mosaicos'); }
  guardarMosaico(id: string | null, m: Partial<Mosaico>): Observable<Mosaico> { return this.guardar<Mosaico>('mosaicos', id, m); }
  borrarMosaico(id: string) { return this.borrar('mosaicos', id); }

  // Zonas
  zonas(camaraId: string): Observable<Zona[]> { return this.listar<Zona>('zonas', { camara_id: camaraId }); }
  guardarZona(id: string | null, z: Partial<Zona>): Observable<Zona> { return this.guardar<Zona>('zonas', id, z); }
  borrarZona(id: string) { return this.borrar('zonas', id); }

  // Reglas
  reglas(f: { camara_id?: string | null; sede_id?: string | null } = {}): Observable<Regla[]> { return this.listar<Regla>('reglas', f); }
  guardarRegla(id: string | null, r: Partial<Regla>): Observable<Regla> { return this.guardar<Regla>('reglas', id, r); }
  borrarRegla(id: string) { return this.borrar('reglas', id); }

  // ── Grabaciones ──────────────────────────────────────────────────────────
  grabaciones(camaraId: string, desde: string, hasta: string): Observable<Grabaciones> {
    return this.http.get<Grabaciones>(`${this.base}/camaras/${camaraId}/grabaciones`, { params: params({ desde, hasta }) });
  }
  reproduccion(camaraId: string, desde: string, hasta: string, fuente: FuenteReproduccion): Observable<Reproduccion> {
    return this.http.get<Reproduccion>(`${this.base}/camaras/${camaraId}/reproduccion`, { params: params({ desde, hasta, fuente }) });
  }
  descargar(camaraId: string, desde: string, duracionSeg: number): Observable<Blob> {
    return this.http.get(`${this.base}/camaras/${camaraId}/descargar`, {
      params: params({ desde, duracion_seg: duracionSeg }), responseType: 'blob',
    });
  }
  clips(f: Filtros = {}): Observable<Clip[]> { return this.listar<Clip>('clips', f); }
  crearClip(c: { camara_id: string; desde: string; hasta: string; motivo?: string | null; incidente_id?: string | null }): Observable<Clip> {
    return this.crear<Clip>('clips', c);
  }

  // ── Rostros ──────────────────────────────────────────────────────────────
  personas(): Observable<Persona[]> { return this.listar<Persona>('personas'); }
  guardarPersona(id: string | null, p: Partial<Persona>): Observable<Persona> { return this.guardar<Persona>('personas', id, p); }
  borrarPersona(id: string) { return this.borrar('personas', id); }
  rostros(personaId: string): Observable<Rostro[]> { return this.http.get<Rostro[]>(`${this.base}/personas/${personaId}/rostros`); }
  enrolarRostro(personaId: string, imagen: Blob, nombre = 'rostro.jpg'): Observable<Rostro> {
    const fd = new FormData();
    fd.append('imagen', imagen, nombre);
    return this.http.post<Rostro>(`${this.base}/personas/${personaId}/rostros`, fd);
  }
  borrarRostro(id: string) { return this.http.delete(`${this.base}/rostros/${id}`); }
  avistamientos(f: Filtros = {}): Observable<Pagina<Avistamiento>> {
    return this.http.get<Pagina<Avistamiento>>(`${this.base}/avistamientos`, { params: params(f) });
  }

  // ── Analítica ────────────────────────────────────────────────────────────
  aforo(): Observable<Aforo> { return this.http.get<Aforo>(`${this.base}/analitica/aforo`); }
  conteos(f: { sede_id?: string | null; camara_id?: string | null; desde: string; hasta: string; agrupar: 'hora' | 'dia' }): Observable<Conteos> {
    return this.http.get<Conteos>(`${this.base}/analitica/conteos`, { params: params(f) });
  }
  demografia(f: { sede_id?: string | null; desde: string; hasta: string }): Observable<Demografia> {
    return this.http.get<Demografia>(`${this.base}/analitica/demografia`, { params: params(f) });
  }

  // ── Domótica y accesos ───────────────────────────────────────────────────
  dispositivos(): Observable<Dispositivo[]> { return this.listar<Dispositivo>('dispositivos'); }
  guardarDispositivo(id: string | null, d: DispositivoEntrada): Observable<Dispositivo> { return this.guardar<Dispositivo>('dispositivos', id, d); }
  borrarDispositivo(id: string) { return this.borrar('dispositivos', id); }
  accionDispositivo(id: string, accion: AccionDispositivo, motivo: string | null): Observable<RespuestaAccion> {
    return this.http.post<RespuestaAccion>(`${this.base}/dispositivos/${id}/accion`, { accion, motivo });
  }
  accionesDispositivo(id: string): Observable<AccionRegistrada[]> {
    return this.http.get<AccionRegistrada[]>(`${this.base}/dispositivos/${id}/acciones`);
  }
  accesos(f: Filtros = {}): Observable<Pagina<Acceso>> { return this.http.get<Pagina<Acceso>>(`${this.base}/accesos`, { params: params(f) }); }
  integraciones(): Observable<Integracion[]> { return this.listar<Integracion>('integraciones'); }

  // ── Alertas ──────────────────────────────────────────────────────────────
  contactos(): Observable<Contacto[]> { return this.listar<Contacto>('contactos'); }
  guardarContacto(id: string | null, c: Partial<Contacto>): Observable<Contacto> { return this.guardar<Contacto>('contactos', id, c); }
  borrarContacto(id: string) { return this.borrar('contactos', id); }
  vincularTelegram(id: string): Observable<VinculoTelegram> {
    return this.http.post<VinculoTelegram>(`${this.base}/contactos/${id}/telegram`, {});
  }
  desvincularTelegram(id: string) { return this.http.delete(`${this.base}/contactos/${id}/telegram`); }
  protocolos(): Observable<Protocolo[]> { return this.listar<Protocolo>('protocolos'); }
  guardarProtocolo(id: string | null, p: Partial<Protocolo>): Observable<Protocolo> { return this.guardar<Protocolo>('protocolos', id, p); }
  borrarProtocolo(id: string) { return this.borrar('protocolos', id); }

  /** `estado` admite varios separados por coma (p. ej. los activos). */
  incidentes(f: { estado?: string | null; sede_id?: string | null; severidad?: string | null; limit?: number; offset?: number } = {}): Observable<Pagina<Incidente>> {
    return this.http.get<Pagina<Incidente>>(`${this.base}/incidentes`, { params: params(f) });
  }
  incidente(id: string): Observable<IncidenteDetalle> { return this.http.get<IncidenteDetalle>(`${this.base}/incidentes/${id}`); }
  crearIncidente(i: NuevoIncidente): Observable<Incidente> { return this.http.post<Incidente>(`${this.base}/incidentes`, i); }
  reconocer(id: string, nota?: string | null): Observable<Incidente> {
    return this.http.post<Incidente>(`${this.base}/incidentes/${id}/reconocer`, { nota: nota || undefined });
  }
  comentar(id: string, texto: string): Observable<unknown> { return this.http.post(`${this.base}/incidentes/${id}/comentar`, { texto }); }
  cerrarIncidente(id: string, resultado: 'CERRADO' | 'FALSA_ALARMA', nota: string): Observable<Incidente> {
    return this.http.post<Incidente>(`${this.base}/incidentes/${id}/cerrar`, { resultado, nota });
  }
  escalar(id: string): Observable<Incidente> { return this.http.post<Incidente>(`${this.base}/incidentes/${id}/escalar`, {}); }
  eventos(f: Filtros = {}): Observable<Pagina<Evento>> { return this.http.get<Pagina<Evento>>(`${this.base}/eventos`, { params: params(f) }); }
  probarCanal(canal: string, destino: string): Observable<OkMensaje> {
    return this.http.post<OkMensaje>(`${this.base}/canales/probar`, { canal, destino });
  }

  // ── Audio ────────────────────────────────────────────────────────────────
  parlantes(): Observable<Parlante[]> { return this.listar<Parlante>('parlantes'); }
  guardarParlante(id: string | null, p: Partial<Parlante>): Observable<Parlante> { return this.guardar<Parlante>('parlantes', id, p); }
  borrarParlante(id: string) { return this.borrar('parlantes', id); }
  tokenParlante(id: string): Observable<TokenParlante> { return this.http.post<TokenParlante>(`${this.base}/parlantes/${id}/token`, {}); }
  audios(tipo?: TipoAudio | null): Observable<Audio[]> { return this.listar<Audio>('audios', { tipo }); }
  borrarAudio(id: string) { return this.borrar('audios', id); }
  urlArchivoAudio(id: string): string { return `${this.base}/audios/${id}/archivo`; }
  archivoAudio(id: string): Observable<Blob> { return this.http.get(this.urlArchivoAudio(id), { responseType: 'blob' }); }
  locucion(p: PedidoLocucion): Observable<Audio> { return this.http.post<Audio>(`${this.base}/audios/locucion`, p); }
  efecto(p: { nombre: string; prompt: string; duracion_seg?: number | null }): Observable<Audio> {
    return this.http.post<Audio>(`${this.base}/audios/efecto`, p);
  }
  subirAudio(archivo: File, nombre: string, tipo: TipoAudio): Observable<Audio> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    fd.append('nombre', nombre);
    fd.append('tipo', tipo);
    return this.http.post<Audio>(`${this.base}/audios/subir`, fd);
  }
  reproducir(parlanteId: string, p: PedidoReproducir): Observable<{ ok: boolean; reproduccion_id: string; mensaje: string }> {
    return this.http.post<{ ok: boolean; reproduccion_id: string; mensaje: string }>(`${this.base}/parlantes/${parlanteId}/reproducir`, p);
  }
  detener(parlanteId: string): Observable<{ ok: boolean }> { return this.http.post<{ ok: boolean }>(`${this.base}/parlantes/${parlanteId}/detener`, {}); }
  iniciarPtt(parlanteId: string): Observable<SesionMedia> { return this.http.post<SesionMedia>(`${this.base}/parlantes/${parlanteId}/ptt`, {}); }
  terminarPtt(parlanteId: string) { return this.http.delete(`${this.base}/parlantes/${parlanteId}/ptt`); }
  escuchar(parlanteId: string): Observable<SesionMedia> { return this.http.get<SesionMedia>(`${this.base}/parlantes/${parlanteId}/escuchar`); }
  transcripciones(parlanteId: string, limit = 50): Observable<Transcripcion[]> {
    return this.http.get<Transcripcion[]>(`${this.base}/parlantes/${parlanteId}/transcripciones`, { params: { limit } });
  }
  voces(): Observable<Voz[]> { return this.http.get<Voz[]>(`${this.base}/voces`); }

  // ── Ajustes, sistema, auditoría ──────────────────────────────────────────
  ajustes(): Observable<Ajustes> { return this.http.get<Ajustes>(`${this.base}/ajustes`); }
  guardarAjustes(a: AjustesEntrada): Observable<Ajustes> { return this.http.put<Ajustes>(`${this.base}/ajustes`, a); }
  sistema(): Observable<Sistema> { return this.http.get<Sistema>(`${this.base}/sistema`); }
  auditoria(f: Filtros = {}): Observable<Pagina<RegistroAuditoria>> {
    return this.http.get<Pagina<RegistroAuditoria>>(`${this.base}/auditoria`, { params: params(f) });
  }
}

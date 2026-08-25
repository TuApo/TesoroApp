import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  Activo, AnalisisImportacion, Catalogo, OrigenDatos, PlantillaDetalle, PlantillaResumen,
  Preview, ResultadoEnvio, ResultadoImportacion, Sujeto, Variable, Version,
} from '../models/plantilla-correo.model';

/**
 * Cliente del motor de plantillas de correo (ms-auth-admin).
 *
 * Va por el gateway contra `/api/v1/admin/**`, que ya está enrutado a ese
 * servicio: este submódulo no necesitó tocar el api-gateway. El JWT lo pone el
 * `auth.interceptor` global.
 *
 * Los errores llegan como `{ error: "mensaje" }` con 400/404/409/422, igual que
 * en Correos electrónicos; cada pantalla los muestra tal cual porque son
 * mensajes escritos para el operador, no códigos.
 */
@Injectable({ providedIn: 'root' })
export class PlantillasCorreoService {
  private http = inject(HttpClient);

  private readonly base = `${environment.apiUrl}/api/v1/admin/correos/plantillas`;
  private readonly baseVars = `${environment.apiUrl}/api/v1/admin/correos/variables`;

  // ── Plantillas ─────────────────────────────────────────────────────────────

  listar(filtros: { estado?: string | null; categoria?: string | null; q?: string | null } = {})
    : Observable<PlantillaResumen[]> {
    let params = new HttpParams();
    if (filtros.estado) params = params.set('estado', filtros.estado);
    if (filtros.categoria) params = params.set('categoria', filtros.categoria);
    if (filtros.q?.trim()) params = params.set('q', filtros.q.trim());
    return this.http.get<PlantillaResumen[]>(this.base, { params });
  }

  categorias(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/categorias`);
  }

  detalle(id: string): Observable<PlantillaDetalle> {
    return this.http.get<PlantillaDetalle>(`${this.base}/${id}`);
  }

  crear(body: {
    codigo?: string | null; nombre: string; descripcion?: string | null;
    categoria?: string | null; origen_codigo?: string | null;
    cuenta_id?: string | null; copiar_de?: string | null;
  }): Observable<PlantillaDetalle> {
    return this.http.post<PlantillaDetalle>(this.base, body);
  }

  actualizar(id: string, body: Record<string, unknown>): Observable<PlantillaResumen> {
    return this.http.patch<PlantillaResumen>(`${this.base}/${id}`, body);
  }

  /**
   * Autoguardado del editor. Se llama a menudo (cada pausa de escritura), y el
   * backend reutiliza la misma fila de borrador en vez de crear una versión por
   * llamada: sin eso el histórico sería ilegible en una tarde de trabajo.
   */
  guardarBorrador(id: string, body: {
    modo_edicion?: string; asunto?: string; preencabezado?: string | null;
    documento_json?: string | null; tema_json?: string | null;
    cuerpo_html?: string | null; cuerpo_texto?: string | null;
    modo_imagenes?: string; notas?: string | null;
  }): Observable<Version> {
    return this.http.put<Version>(`${this.base}/${id}/borrador`, body);
  }

  publicar(id: string, notas?: string | null): Observable<PlantillaDetalle> {
    return this.http.post<PlantillaDetalle>(`${this.base}/${id}/publicar`, { notas: notas ?? null });
  }

  descartarBorrador(id: string): Observable<PlantillaDetalle> {
    return this.http.delete<PlantillaDetalle>(`${this.base}/${id}/borrador`);
  }

  version(id: string, versionId: string): Observable<Version> {
    return this.http.get<Version>(`${this.base}/${id}/versiones/${versionId}`);
  }

  restaurar(id: string, versionId: string): Observable<PlantillaDetalle> {
    return this.http.post<PlantillaDetalle>(`${this.base}/${id}/versiones/${versionId}/restaurar`, {});
  }

  archivar(id: string): Observable<PlantillaResumen> {
    return this.http.post<PlantillaResumen>(`${this.base}/${id}/archivar`, {});
  }

  reactivar(id: string): Observable<PlantillaResumen> {
    return this.http.post<PlantillaResumen>(`${this.base}/${id}/reactivar`, {});
  }

  // ── Vista previa y prueba ──────────────────────────────────────────────────

  preview(id: string, opts: { clave?: string | null; borrador?: boolean } = {}): Observable<Preview> {
    return this.http.post<Preview>(`${this.base}/${id}/preview`, {
      clave: opts.clave ?? null,
      borrador: opts.borrador ?? true,
    });
  }

  /** Envío REAL: consume cuota del pool de remitentes y queda en el ledger. */
  enviarPrueba(id: string, body: {
    destinatario: string; clave?: string | null; borrador?: boolean; cuenta_id?: string | null;
  }): Observable<ResultadoEnvio> {
    return this.http.post<ResultadoEnvio>(`${this.base}/${id}/prueba`, body);
  }

  // ── Importación de HTML externo ────────────────────────────────────────────

  /**
   * Analiza un `.html` subido. NO guarda nada: devuelve qué marcadores e
   * imágenes trae para que el asistente los muestre antes de decidir.
   */
  analizarArchivo(archivo: File, origenCodigo?: string | null): Observable<AnalisisImportacion> {
    const fd = new FormData();
    fd.append('archivo', archivo);
    if (origenCodigo) fd.append('origen', origenCodigo);
    return this.http.post<AnalisisImportacion>(`${this.base}/importar/analizar`, fd);
  }

  /** Igual, para HTML pegado en el asistente en vez de subido como fichero. */
  analizarHtml(html: string, origenCodigo?: string | null): Observable<AnalisisImportacion> {
    return this.http.post<AnalisisImportacion>(`${this.base}/importar/analizar`, {
      html, origen_codigo: origenCodigo ?? null,
    });
  }

  /**
   * Guarda lo importado. Con `plantilla_id` añade una VERSIÓN nueva a una
   * plantilla existente en vez de crear otra: es lo que permite rehacer el
   * diseño de un correo sin perder su histórico ni su código.
   */
  aplicarImportacion(body: {
    html: string;
    plantilla_id?: string | null;
    nombre?: string | null;
    descripcion?: string | null;
    categoria?: string | null;
    origen_codigo?: string | null;
    asunto?: string | null;
    preencabezado?: string | null;
    modo_imagenes?: string;
    mapeos: Record<string, string>;
    imagenes: string[];
    publicar?: boolean;
  }): Observable<ResultadoImportacion> {
    return this.http.post<ResultadoImportacion>(`${this.base}/importar/aplicar`, body);
  }

  // ── Catálogo de variables ──────────────────────────────────────────────────

  catalogo(origenCodigo?: string | null): Observable<Catalogo> {
    let params = new HttpParams();
    if (origenCodigo) params = params.set('origen', origenCodigo);
    return this.http.get<Catalogo>(`${this.baseVars}/catalogo`, { params });
  }

  origenes(soloActivos = false): Observable<OrigenDatos[]> {
    const params = new HttpParams().set('solo_activos', String(soloActivos));
    return this.http.get<OrigenDatos[]>(`${this.baseVars}/origenes`, { params });
  }

  crearOrigen(body: Record<string, unknown>): Observable<OrigenDatos> {
    return this.http.post<OrigenDatos>(`${this.baseVars}/origenes`, body);
  }

  actualizarOrigen(id: string, body: Record<string, unknown>): Observable<OrigenDatos> {
    return this.http.patch<OrigenDatos>(`${this.baseVars}/origenes/${id}`, body);
  }

  /** Diagnóstico: dice si el microservicio dueño del origen responde. */
  probarOrigen(id: string, clave?: string | null): Observable<{ ok: boolean; mensaje?: string; payload?: unknown }> {
    let params = new HttpParams();
    if (clave) params = params.set('clave', clave);
    return this.http.get<{ ok: boolean; mensaje?: string; payload?: unknown }>(
      `${this.baseVars}/origenes/${id}/probar`, { params });
  }

  buscarSujetos(origenCodigo: string, q: string): Observable<Sujeto[]> {
    const params = new HttpParams().set('q', q);
    return this.http.get<Sujeto[]>(`${this.baseVars}/origenes/${origenCodigo}/sujetos`, { params });
  }

  variables(origenId: string): Observable<Variable[]> {
    return this.http.get<Variable[]>(`${this.baseVars}/origenes/${origenId}/variables`);
  }

  crearVariable(origenId: string, body: Record<string, unknown>): Observable<Variable> {
    return this.http.post<Variable>(`${this.baseVars}/origenes/${origenId}/variables`, body);
  }

  actualizarVariable(id: string, body: Record<string, unknown>): Observable<Variable> {
    return this.http.patch<Variable>(`${this.baseVars}/${id}`, body);
  }

  /** Desactiva, no borra: las plantillas ya publicadas siguen citándola. */
  desactivarVariable(id: string): Observable<Variable> {
    return this.http.delete<Variable>(`${this.baseVars}/${id}`);
  }

  // ── Biblioteca de medios ───────────────────────────────────────────────────

  activos(tipo?: string | null, q?: string | null): Observable<Activo[]> {
    let params = new HttpParams();
    if (tipo) params = params.set('tipo', tipo);
    if (q?.trim()) params = params.set('q', q.trim());
    return this.http.get<Activo[]>(`${this.base}/activos`, { params });
  }

  subirImagen(archivo: File, descripcion?: string, etiquetas?: string): Observable<Activo> {
    const fd = new FormData();
    fd.append('archivo', archivo);
    if (descripcion) fd.append('descripcion', descripcion);
    if (etiquetas) fd.append('etiquetas', etiquetas);
    return this.http.post<Activo>(`${this.base}/activos/imagen`, fd);
  }

  registrarVideo(body: {
    nombre: string; url: string; descripcion?: string | null;
    miniatura_id?: string | null; etiquetas?: string | null;
  }): Observable<Activo> {
    return this.http.post<Activo>(`${this.base}/activos/video`, body);
  }

  archivarActivo(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/activos/${id}`);
  }

  /**
   * URL absoluta de un activo para pintarlo en el editor.
   *
   * El backend devuelve la ruta relativa al servicio; el navegador necesita el
   * host del gateway delante. Nunca se arma a mano en las plantillas: si el
   * `apiUrl` cambia, cambia aquí y en un solo sitio.
   */
  urlActivo(activo: Activo): string {
    return activo.url.startsWith('http') ? activo.url : `${environment.apiUrl}${activo.url}`;
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import {
  ArchivoOrden, DetalleOrden, Ejecucion, EventoOrden, FlujoResumen, ListadoOrdenes, ModeloIa,
  NuevaOrden, Orden, Proveedores,
} from './ordenes.models';

/**
 * Ordenes de servicio y flujos de IA.
 *
 * <p>El nombre de quien actua viaja en {@code X-Usuario-Nombre} porque el JWT de la plataforma
 * solo trae el correo; es solo para la bitacora (los permisos los decide el backend con el id
 * del token). Va con encodeURIComponent: una cabecera HTTP no admite tildes y el navegador
 * rechaza la peticion entera si las lleva.
 */
@Injectable({ providedIn: 'root' })
export class OrdenesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/marketing`;

  private cab(): HttpHeaders {
    const nombre = obtenerUsuarioActual().nombreCompleto;
    return nombre ? new HttpHeaders({ 'X-Usuario-Nombre': encodeURIComponent(nombre) }) : new HttpHeaders();
  }

  // ── ordenes ───────────────────────────────────────────────────────────────

  listar(filtro: { estado?: string; tipo?: string; mias?: boolean; busca?: string }): Observable<ListadoOrdenes> {
    let p = new HttpParams();
    if (filtro.estado) p = p.set('estado', filtro.estado);
    if (filtro.tipo) p = p.set('tipo', filtro.tipo);
    if (filtro.mias) p = p.set('mias', 'true');
    if (filtro.busca) p = p.set('busca', filtro.busca);
    return this.http.get<ListadoOrdenes>(`${this.base}/ordenes`, { params: p, headers: this.cab() });
  }

  detalle(id: string): Observable<DetalleOrden> {
    return this.http.get<DetalleOrden>(`${this.base}/ordenes/${id}`, { headers: this.cab() });
  }

  ejecuciones(id: string): Observable<Ejecucion[]> {
    return this.http.get<Ejecucion[]>(`${this.base}/ordenes/${id}/ejecuciones`);
  }

  crear(o: NuevaOrden): Observable<Orden> {
    return this.http.post<Orden>(`${this.base}/ordenes`, o, { headers: this.cab() });
  }

  editar(id: string, cambios: Partial<NuevaOrden>): Observable<Orden> {
    return this.http.put<Orden>(`${this.base}/ordenes/${id}`, cambios, { headers: this.cab() });
  }

  tomar(id: string): Observable<Orden> {
    return this.http.post<Orden>(`${this.base}/ordenes/${id}/tomar`, {}, { headers: this.cab() });
  }

  cancelar(id: string, motivo: string): Observable<Orden> {
    return this.http.post<Orden>(`${this.base}/ordenes/${id}/cancelar`, { motivo }, { headers: this.cab() });
  }

  reactivar(id: string): Observable<Orden> {
    return this.http.post<Orden>(`${this.base}/ordenes/${id}/reactivar`, {}, { headers: this.cab() });
  }

  comentar(id: string, texto: string, entregableId?: string | null): Observable<EventoOrden> {
    return this.http.post<EventoOrden>(`${this.base}/ordenes/${id}/comentarios`,
      { texto, entregable_id: entregableId ?? null }, { headers: this.cab() });
  }

  agregarEntregable(id: string, e: { tipo: string; titulo: string; especificacion?: Record<string, unknown> }) {
    return this.http.post(`${this.base}/ordenes/${id}/entregables`, e, { headers: this.cab() });
  }

  cancelarEntregable(id: string, eid: string) {
    return this.http.post(`${this.base}/ordenes/${id}/entregables/${eid}/cancelar`, {}, { headers: this.cab() });
  }

  // ── archivos ──────────────────────────────────────────────────────────────

  insumo(id: string, datos: { archivo?: File | null; descripcion?: string; url?: string; texto?: string; nombre?: string }) {
    return this.http.post<ArchivoOrden>(`${this.base}/ordenes/${id}/insumos`, this.form(datos), { headers: this.cab() });
  }

  version(id: string, eid: string, datos: { archivo?: File | null; texto?: string; descripcion?: string; padre_id?: string | null }) {
    return this.http.post<ArchivoOrden>(`${this.base}/ordenes/${id}/entregables/${eid}/versiones`, this.form(datos), { headers: this.cab() });
  }

  evidencia(id: string, eid: string, datos: { archivo?: File | null; url?: string; tipo: string; descripcion?: string }) {
    return this.http.post<ArchivoOrden>(`${this.base}/ordenes/${id}/entregables/${eid}/evidencias`, this.form(datos), { headers: this.cab() });
  }

  entregaDirecta(id: string, eid: string, datos: {
    archivo?: File | null; texto?: string; descripcion?: string;
    evidencia?: File | null; evidencia_url?: string; evidencia_tipo?: string;
  }) {
    return this.http.post<{ estado: string }>(`${this.base}/ordenes/${id}/entregables/${eid}/entrega-directa`,
      this.form(datos), { headers: this.cab() });
  }

  entregar(id: string, eid: string) {
    return this.http.post<{ estado: string }>(`${this.base}/ordenes/${id}/entregables/${eid}/entregar`, {}, { headers: this.cab() });
  }

  reabrir(id: string, eid: string, motivo: string) {
    return this.http.post<{ estado: string }>(`${this.base}/ordenes/${id}/entregables/${eid}/reabrir`, { motivo }, { headers: this.cab() });
  }

  revisar(id: string, archivoId: string, aprobar: boolean, nota?: string) {
    return this.http.post<ArchivoOrden>(`${this.base}/ordenes/${id}/archivos/${archivoId}/revision`,
      { aprobar, nota: nota ?? null }, { headers: this.cab() });
  }

  retirar(id: string, archivoId: string) {
    return this.http.delete(`${this.base}/ordenes/${id}/archivos/${archivoId}`, { headers: this.cab() });
  }

  /** El binario como Blob: pasa por el interceptor (JWT) y se muestra con un object URL. */
  contenido(id: string, archivoId: string, fuente = false): Observable<Blob> {
    const q = fuente ? '?fuente=true' : '';
    return this.http.get(`${this.base}/ordenes/${id}/archivos/${archivoId}/contenido${q}`, { responseType: 'blob' });
  }

  // ── generacion ────────────────────────────────────────────────────────────

  generar(id: string, eid: string, flujoId: string, baseArchivoId: string | null, instrucciones: string) {
    return this.http.post<Ejecucion>(`${this.base}/ordenes/${id}/entregables/${eid}/generar`,
      { flujo_id: flujoId, base_archivo_id: baseArchivoId, instrucciones }, { headers: this.cab() });
  }

  continuar(ejecucionId: string) {
    return this.http.post<Ejecucion>(`${this.base}/ordenes/ejecuciones/${ejecucionId}/continuar`, {}, { headers: this.cab() });
  }

  rehacer(ejecucionId: string, desde: string | null, instrucciones: string) {
    return this.http.post<Ejecucion>(`${this.base}/ordenes/ejecuciones/${ejecucionId}/rehacer`,
      { desde, instrucciones }, { headers: this.cab() });
  }

  cancelarEjecucion(ejecucionId: string) {
    return this.http.post<Ejecucion>(`${this.base}/ordenes/ejecuciones/${ejecucionId}/cancelar`, {}, { headers: this.cab() });
  }

  // ── flujos ────────────────────────────────────────────────────────────────

  flujos(todos = false): Observable<FlujoResumen[]> {
    return this.http.get<FlujoResumen[]>(`${this.base}/flujos${todos ? '?todos=true' : ''}`);
  }

  flujo(id: string): Observable<FlujoResumen> {
    return this.http.get<FlujoResumen>(`${this.base}/flujos/${id}`);
  }

  proveedores(): Observable<Proveedores> {
    return this.http.get<Proveedores>(`${this.base}/flujos/proveedores`);
  }

  modelos(): Observable<ModeloIa[]> {
    return this.http.get<ModeloIa[]>(`${this.base}/flujos/modelos`);
  }

  validarFlujo(pasos: unknown) {
    return this.http.post<{ valido: boolean; problemas: string[]; faltantes: string[] }>(`${this.base}/flujos/validar`, { pasos });
  }

  guardarFlujo(id: string | null, f: Partial<FlujoResumen> & { pasos?: unknown }): Observable<FlujoResumen> {
    return id ? this.http.put<FlujoResumen>(`${this.base}/flujos/${id}`, f)
              : this.http.post<FlujoResumen>(`${this.base}/flujos`, f);
  }

  duplicarFlujo(id: string): Observable<FlujoResumen> {
    return this.http.post<FlujoResumen>(`${this.base}/flujos/${id}/duplicar`, {});
  }

  private form(datos: Record<string, unknown>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(datos)) {
      if (v === null || v === undefined || v === '') continue;
      if (v instanceof File) f.append(k, v, v.name);
      else f.append(k, String(v));
    }
    return f;
  }
}

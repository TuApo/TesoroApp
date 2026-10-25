import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import {
  AporteCumpleanos, CalendarioCelebraciones, CatalogoCelebraciones, CelebracionDelDia, EtiquetaCelebracion,
  PersonalizacionCumpleanos, PeticionPersona, VistasDia, PersonaCelebradaAdmin, PiezaCelebracion, PlantillaCelebracionAdmin,
} from './celebracion.models';

/**
 * Cliente de las celebraciones de cumpleaños (ms-marketing).
 *
 * `hoy()` lo pide el shell de CUALQUIER persona con sesión; lo demás es de Marketing y el
 * backend lo corta por rol (403), no esta clase.
 */
@Injectable({ providedIn: 'root' })
export class CelebracionService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl.replace(/\/$/, '');
  private readonly base = `${this.api}/api/v1/marketing/celebraciones`;

  /**
   * Pide al lanzador del shell que vuelva a mirar ya (botón «Simular primer ingreso»). Va por
   * aquí y no recargando la página: así se prueba exactamente el camino real.
   */
  readonly revisarAhora$ = new Subject<void>();

  /** URL absoluta de una foto (el backend la manda relativa y firmada). */
  urlFoto(relativa: string | null | undefined): string {
    if (!relativa) return '';
    return /^(https?:|blob:|data:)/i.test(relativa) ? relativa : `${this.api}${relativa}`;
  }

  // ── lo que ve cada persona ────────────────────────────────────────────────

  /** Nunca falla hacia la pantalla: sin respuesta, simplemente no hay celebración. */
  hoy(superficie = 'TESORO'): Observable<CelebracionDelDia | null> {
    return this.http
      .get<CelebracionDelDia>(`${this.base}/hoy`, { params: { superficie } })
      .pipe(catchError(() => of(null)));
  }

  /**
   * Telemetría: se dispara y se olvida. Lleva el nombre de quien mira para «quién la vio»
   * (el JWT solo trae correo y cédula); va con encodeURIComponent porque una cabecera HTTP no
   * admite tildes y el navegador rechazaría la petición entera.
   */
  apuntar(fecha: string, accion: 'MOSTRADA' | 'CERRADA_ANTES', superficie = 'TESORO'): void {
    let headers = new HttpHeaders();
    try {
      const nombre = obtenerUsuarioActual().nombreCompleto;
      if (nombre) headers = headers.set('X-Usuario-Nombre', encodeURIComponent(nombre));
    } catch { /* sin usuario en memoria: el backend usa el correo del token */ }
    this.http.post(`${this.base}/hoy/vista`, { fecha, accion, superficie }, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  olvidarVista(superficie = 'TESORO'): Observable<{ olvidada: boolean }> {
    return this.http.delete<{ olvidada: boolean }>(`${this.base}/hoy/vista`, { params: { superficie } });
  }

  // ── administración ────────────────────────────────────────────────────────

  /** Quién vio la celebración de un día (solo Marketing). */
  vistasDia(fecha: string): Observable<VistasDia> {
    return this.http.get<VistasDia>(`${this.base}/dias/${fecha}/vistas`);
  }

  catalogo(): Observable<CatalogoCelebraciones> {
    return this.http.get<CatalogoCelebraciones>(`${this.base}/catalogo`);
  }

  calendario(desde?: string, hasta?: string): Observable<CalendarioCelebraciones> {
    const params: Record<string, string> = {};
    if (desde) params['desde'] = desde;
    if (hasta) params['hasta'] = hasta;
    return this.http.get<CalendarioCelebraciones>(this.base, { params });
  }

  crear(p: PeticionPersona): Observable<PersonaCelebradaAdmin> {
    return this.http.post<PersonaCelebradaAdmin>(this.base, p);
  }

  editar(id: string, p: Partial<PeticionPersona>): Observable<PersonaCelebradaAdmin> {
    return this.http.put<PersonaCelebradaAdmin>(`${this.base}/${id}`, p);
  }

  quitar(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/${id}`);
  }

  subirFoto(id: string, archivo: File): Observable<PersonaCelebradaAdmin> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    return this.http.post<PersonaCelebradaAdmin>(`${this.base}/${id}/foto`, fd);
  }

  quitarFoto(id: string): Observable<PersonaCelebradaAdmin> {
    return this.http.delete<PersonaCelebradaAdmin>(`${this.base}/${id}/foto`);
  }

  guardarDia(fecha: string, d: { plantilla_id: string | null; titulo?: string | null; mensaje?: string | null }):
      Observable<unknown> {
    return this.http.put(`${this.base}/dias/${fecha}`, d);
  }

  vistaPrevia(o: { fecha?: string; plantilla_id?: string | null; como_cumpleanero?: boolean; superficie?: string }):
      Observable<CelebracionDelDia> {
    const params: Record<string, string> = { superficie: o.superficie ?? 'TESORO' };
    if (o.fecha) params['fecha'] = o.fecha;
    if (o.plantilla_id) params['plantilla_id'] = o.plantilla_id;
    if (o.como_cumpleanero) params['como_cumpleanero'] = 'true';
    return this.http.get<CelebracionDelDia>(`${this.base}/vista-previa`, { params });
  }

  plantillas(): Observable<PlantillaCelebracionAdmin[]> {
    return this.http.get<PlantillaCelebracionAdmin[]>(`${this.base}/plantillas`);
  }

  crearPlantilla(p: Partial<PlantillaCelebracionAdmin>): Observable<PlantillaCelebracionAdmin> {
    return this.http.post<PlantillaCelebracionAdmin>(`${this.base}/plantillas`, p);
  }

  editarPlantilla(id: string, p: Partial<PlantillaCelebracionAdmin>): Observable<PlantillaCelebracionAdmin> {
    return this.http.put<PlantillaCelebracionAdmin>(`${this.base}/plantillas/${id}`, p);
  }

  // ── aportes (cualquiera con el enlace) ────────────────────────────────────

  aporte(token: string): Observable<AporteCumpleanos> {
    return this.http.get<AporteCumpleanos>(`${this.base}/aporte/${token}`);
  }

  votar(token: string, ids: string[]): Observable<AporteCumpleanos> {
    return this.http.put<AporteCumpleanos>(`${this.base}/aporte/${token}/etiquetas`, { ids });
  }

  mensajeJefe(token: string, texto: string, firma: string): Observable<AporteCumpleanos> {
    return this.http.put<AporteCumpleanos>(`${this.base}/aporte/${token}/mensaje-jefe`, { texto, firma });
  }

  // ── personalización (Marketing) ───────────────────────────────────────────

  enlaceAportes(id: string): Observable<{ token: string; ruta: string }> {
    return this.http.post<{ token: string; ruta: string }>(`${this.base}/${id}/enlace-aportes`, {});
  }

  personalizacion(id: string): Observable<PersonalizacionCumpleanos> {
    return this.http.get<PersonalizacionCumpleanos>(`${this.base}/${id}/personalizacion`);
  }

  personalizar(id: string, animar: boolean): Observable<{ piezas: PiezaCelebracion[]; higgsfield_configurado: boolean }> {
    return this.http.post<{ piezas: PiezaCelebracion[]; higgsfield_configurado: boolean }>(`${this.base}/${id}/personalizar`, { animar });
  }

  subirPieza(piezaId: string, archivo: File): Observable<PiezaCelebracion> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    return this.http.post<PiezaCelebracion>(`${this.base}/piezas/${piezaId}/archivo`, fd, { params: { origen: 'MANUAL' } });
  }

  aprobarPieza(piezaId: string): Observable<PiezaCelebracion> {
    return this.http.post<PiezaCelebracion>(`${this.base}/piezas/${piezaId}/aprobar`, {});
  }

  descartarPieza(piezaId: string): Observable<unknown> {
    return this.http.post(`${this.base}/piezas/${piezaId}/descartar`, {});
  }

  etiquetas(): Observable<EtiquetaCelebracion[]> {
    return this.http.get<EtiquetaCelebracion[]>(`${this.base}/etiquetas`);
  }

  crearEtiqueta(e: Partial<EtiquetaCelebracion>): Observable<EtiquetaCelebracion> {
    return this.http.post<EtiquetaCelebracion>(`${this.base}/etiquetas`, e);
  }

  editarEtiqueta(id: string, e: Partial<EtiquetaCelebracion>): Observable<EtiquetaCelebracion> {
    return this.http.put<EtiquetaCelebracion>(`${this.base}/etiquetas/${id}`, e);
  }
}

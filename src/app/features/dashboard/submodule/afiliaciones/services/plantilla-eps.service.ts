import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  TemporalConfig, TemporalConfigRequest,
  PlantillaResumen, PlantillaDetalle, PlantillaRequest,
  CampoDisponible,
  PaginaPlantilla, PaginaRequest,
  FuentePersonalizada, FuenteRequest,
} from '../models/plantilla-eps.models';

const BASE = `${environment.apiUrl}/gestion_afiliaciones`;

/**
 * Acceso HTTP al módulo de parametrización de plantillas EPS (V36/V39).
 * Encapsula todos los endpoints del PlantillaEpsController.
 */
@Injectable({ providedIn: 'root' })
export class PlantillaEpsService {

  private http = inject(HttpClient);

  // ── Temporales ─────────────────────────────────────────────────────────────

  listarTemporales(): Observable<TemporalConfig[]> {
    return this.http.get<TemporalConfig[]>(`${BASE}/temporales`);
  }

  obtenerTemporal(key: string): Observable<TemporalConfig> {
    return this.http.get<TemporalConfig>(`${BASE}/temporales/${key}`);
  }

  /** Devuelve el data URI de la firma (string). */
  obtenerFirmaUri(key: string): Observable<string> {
    return this.http.get(`${BASE}/temporales/${key}/firma`, { responseType: 'text' });
  }

  obtenerSelloUri(key: string): Observable<string> {
    return this.http.get(`${BASE}/temporales/${key}/sello`, { responseType: 'text' });
  }

  guardarTemporal(key: string, req: TemporalConfigRequest): Observable<TemporalConfig> {
    return this.http.put<TemporalConfig>(`${BASE}/temporales/${key}`, req);
  }

  // ── Plantillas ─────────────────────────────────────────────────────────────

  camposDisponibles(): Observable<CampoDisponible[]> {
    return this.http.get<CampoDisponible[]>(`${BASE}/plantillas/campos-disponibles`);
  }

  listarPlantillas(): Observable<PlantillaResumen[]> {
    return this.http.get<PlantillaResumen[]>(`${BASE}/plantillas`);
  }

  obtenerPlantilla(id: number): Observable<PlantillaDetalle> {
    return this.http.get<PlantillaDetalle>(`${BASE}/plantillas/${id}`);
  }

  crearPlantilla(req: PlantillaRequest): Observable<PlantillaDetalle> {
    return this.http.post<PlantillaDetalle>(`${BASE}/plantillas`, req);
  }

  actualizarPlantilla(id: number, req: PlantillaRequest): Observable<PlantillaDetalle> {
    return this.http.put<PlantillaDetalle>(`${BASE}/plantillas/${id}`, req);
  }

  desactivarPlantilla(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/plantillas/${id}`);
  }

  /**
   * Genera el PDF del documento EPS para el proceso indicado.
   * Devuelve un Blob para abrir/descargar en el navegador.
   */
  generarPdf(procesoId: number): Observable<Blob> {
    return this.http.post(`${BASE}/plantillas/generar/${procesoId}`, null,
      { responseType: 'blob' });
  }

  // ── Páginas del editor visual (V39) ────────────────────────────────────────

  /** Lista las páginas de una plantilla (sin imagen de fondo). */
  listarPaginas(plantillaId: number): Observable<PaginaPlantilla[]> {
    return this.http.get<PaginaPlantilla[]>(`${BASE}/plantillas/${plantillaId}/paginas`);
  }

  /**
   * Reemplaza todas las páginas de la plantilla (PUT total).
   * El campo imagenFondo en cada PaginaRequest debe incluir el data URI base64 completo
   * si se quiere guardar/actualizar la imagen, o null para dejarla sin fondo.
   */
  guardarPaginas(plantillaId: number, paginas: PaginaRequest[]): Observable<PaginaPlantilla[]> {
    return this.http.put<PaginaPlantilla[]>(
      `${BASE}/plantillas/${plantillaId}/paginas`, paginas);
  }

  /** Devuelve el data URI base64 de la imagen de fondo de una página específica. */
  obtenerFondoPagina(plantillaId: number, numeroPagina: number): Observable<string> {
    return this.http.get(
      `${BASE}/plantillas/${plantillaId}/paginas/${numeroPagina}/fondo`,
      { responseType: 'text' });
  }

  // ── Fuentes tipográficas (V39) ─────────────────────────────────────────────

  listarFuentes(): Observable<FuentePersonalizada[]> {
    return this.http.get<FuentePersonalizada[]>(`${BASE}/fuentes`);
  }

  /** Sube una fuente TTF/OTF en base64. */
  crearFuente(req: FuenteRequest): Observable<FuentePersonalizada> {
    return this.http.post<FuentePersonalizada>(`${BASE}/fuentes`, req);
  }

  desactivarFuente(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/fuentes/${id}`);
  }
}

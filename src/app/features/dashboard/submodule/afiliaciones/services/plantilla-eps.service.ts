import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { conAliasCamel, aSnake } from './claves-api';
import { environment } from '../../../../../../environments/environment';
import {
  TemporalConfig, TemporalConfigRequest,
  PlantillaResumen, PlantillaDetalle, PlantillaRequest,
  CampoDisponible,
  PaginaPlantilla, PaginaRequest,
  FuentePersonalizada, FuenteRequest,
  DiagnosticoGeneracion, MuestraProceso, ValoresPrevisualizacion, CampoRequest, EstadoDocumentoEps,
} from '../models/plantilla-eps.models';

const BASE = `${environment.apiUrl}/gestion_afiliaciones`;

/**
 * Acceso HTTP al módulo de parametrización de plantillas EPS (V36/V39).
 * Encapsula todos los endpoints del PlantillaEpsController.
 */
@Injectable({ providedIn: 'root' })
export class PlantillaEpsService {

  private http = inject(HttpClient);

  /** Igual que PlantillaEpsService.MAX_MASIVO en ms-hr. */
  static readonly MAX_MASIVO = 200;

  // ── Temporales ─────────────────────────────────────────────────────────────

  listarTemporales(): Observable<TemporalConfig[]> {
    return this.http.get<TemporalConfig[]>(`${BASE}/temporales`).pipe(map(r => conAliasCamel(r)));
  }

  obtenerTemporal(key: string): Observable<TemporalConfig> {
    return this.http.get<TemporalConfig>(`${BASE}/temporales/${key}`).pipe(map(r => conAliasCamel(r)));
  }

  /** Devuelve el data URI de la firma (string). */
  obtenerFirmaUri(key: string): Observable<string> {
    return this.http.get(`${BASE}/temporales/${key}/firma`, { responseType: 'text' });
  }

  obtenerSelloUri(key: string): Observable<string> {
    return this.http.get(`${BASE}/temporales/${key}/sello`, { responseType: 'text' });
  }

  guardarTemporal(key: string, req: TemporalConfigRequest): Observable<TemporalConfig> {
    return this.http.put<TemporalConfig>(`${BASE}/temporales/${key}`, aSnake(req)).pipe(map(r => conAliasCamel(r)));
  }

  // ── Plantillas ─────────────────────────────────────────────────────────────

  camposDisponibles(): Observable<CampoDisponible[]> {
    return this.http.get<CampoDisponible[]>(`${BASE}/plantillas/campos-disponibles`).pipe(map(r => conAliasCamel(r)));
  }

  listarPlantillas(): Observable<PlantillaResumen[]> {
    return this.http.get<PlantillaResumen[]>(`${BASE}/plantillas`).pipe(map(r => conAliasCamel(r)));
  }

  obtenerPlantilla(id: number): Observable<PlantillaDetalle> {
    return this.http.get<PlantillaDetalle>(`${BASE}/plantillas/${id}`).pipe(map(r => conAliasCamel(r)));
  }

  crearPlantilla(req: PlantillaRequest): Observable<PlantillaDetalle> {
    return this.http.post<PlantillaDetalle>(`${BASE}/plantillas`, aSnake(req)).pipe(map(r => conAliasCamel(r)));
  }

  actualizarPlantilla(id: number, req: PlantillaRequest): Observable<PlantillaDetalle> {
    return this.http.put<PlantillaDetalle>(`${BASE}/plantillas/${id}`, aSnake(req)).pipe(map(r => conAliasCamel(r)));
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

  /** Por qué cada proceso puede o no generar su documento EPS (no descarga nada). */
  diagnosticar(procesoIds: number[]): Observable<DiagnosticoGeneracion[]> {
    return this.http.post<DiagnosticoGeneracion[]>(`${BASE}/plantillas/diagnostico`,
      { proceso_ids: procesoIds }).pipe(map(r => conAliasCamel(r)));
  }

  /** Rojo / amarillo / verde del documento EPS de cada proceso (hasta 500). */
  estadoDocumentos(procesoIds: number[]): Observable<EstadoDocumentoEps[]> {
    return this.http.post<EstadoDocumentoEps[]>(`${BASE}/plantillas/estado-documentos`,
      { proceso_ids: procesoIds }).pipe(map(r => conAliasCamel(r)));
  }

  /** Un solo PDF con el documento EPS de cada proceso que se pueda generar. */
  generarMasivo(procesoIds: number[]): Observable<Blob> {
    return this.http.post(`${BASE}/plantillas/generar-masivo`, { proceso_ids: procesoIds },
      { responseType: 'blob' });
  }

  /**
   * El 422 de generar viaja como Blob (la petición pide PDF): se lee el JSON del
   * diagnóstico para mostrar el motivo exacto. Devuelve null si el cuerpo no lo es.
   */
  static async leerDiagnostico(err: unknown): Promise<DiagnosticoGeneracion | DiagnosticoGeneracion[] | null> {
    const cuerpo = (err as { error?: unknown })?.error;
    try {
      const texto = cuerpo instanceof Blob ? await cuerpo.text()
        : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo ?? null);
      const json = JSON.parse(texto);
      return json && typeof json === 'object' ? conAliasCamel(json) : null;
    } catch {
      return null;
    }
  }

  // ── Previsualización del editor ────────────────────────────────────────────

  /** Contratos de la EPS/temporal de la plantilla (primero los que tienen firma). */
  muestras(plantillaId: number): Observable<MuestraProceso[]> {
    return this.http.get<MuestraProceso[]>(`${BASE}/plantillas/${plantillaId}/muestras`)
      .pipe(map(r => conAliasCamel(r)));
  }

  /** Busca contratos por cédula o nombre. */
  buscarProceso(q: string): Observable<MuestraProceso[]> {
    return this.http.get<MuestraProceso[]>(`${BASE}/plantillas/buscar-proceso`, { params: { q } })
      .pipe(map(r => conAliasCamel(r)));
  }

  /** Lo que pintaría el PDF en cada campo del editor, sin guardar. procesoId null = datos de ejemplo. */
  valores(plantillaId: number, procesoId: number | null, campos: CampoRequest[]): Observable<ValoresPrevisualizacion> {
    return this.http.post<ValoresPrevisualizacion>(`${BASE}/plantillas/${plantillaId}/valores`,
      aSnake({ procesoId, campos })).pipe(map(r => conAliasCamel(r)));
  }

  /** PDF real con los campos del editor sin guardar. */
  previsualizarPdf(plantillaId: number, procesoId: number | null, campos: CampoRequest[]): Observable<Blob> {
    return this.http.post(`${BASE}/plantillas/${plantillaId}/previsualizar`,
      aSnake({ procesoId, campos }), { responseType: 'blob' });
  }

  /** Data URI del archivo de una fuente personalizada. */
  archivoFuente(id: number): Observable<string> {
    return this.http.get(`${BASE}/fuentes/${id}/archivo`, { responseType: 'text' });
  }

  // ── Páginas del editor visual (V39) ────────────────────────────────────────

  /** Lista las páginas de una plantilla (sin imagen de fondo). */
  listarPaginas(plantillaId: number): Observable<PaginaPlantilla[]> {
    return this.http.get<PaginaPlantilla[]>(`${BASE}/plantillas/${plantillaId}/paginas`).pipe(map(r => conAliasCamel(r)));
  }

  /**
   * Reemplaza todas las páginas de la plantilla (PUT total).
   * El campo imagenFondo en cada PaginaRequest debe incluir el data URI base64 completo
   * si se quiere guardar/actualizar la imagen, o null para dejarla sin fondo.
   */
  guardarPaginas(plantillaId: number, paginas: PaginaRequest[]): Observable<PaginaPlantilla[]> {
    return this.http.put<PaginaPlantilla[]>(
      `${BASE}/plantillas/${plantillaId}/paginas`, aSnake(paginas)).pipe(map(r => conAliasCamel(r)));
  }

  /** Devuelve el data URI base64 de la imagen de fondo de una página específica. */
  obtenerFondoPagina(plantillaId: number, numeroPagina: number): Observable<string> {
    return this.http.get(
      `${BASE}/plantillas/${plantillaId}/paginas/${numeroPagina}/fondo`,
      { responseType: 'text' });
  }

  // ── Fuentes tipográficas (V39) ─────────────────────────────────────────────

  listarFuentes(): Observable<FuentePersonalizada[]> {
    return this.http.get<FuentePersonalizada[]>(`${BASE}/fuentes`).pipe(map(r => conAliasCamel(r)));
  }

  /** Sube una fuente TTF/OTF en base64. */
  crearFuente(req: FuenteRequest): Observable<FuentePersonalizada> {
    return this.http.post<FuentePersonalizada>(`${BASE}/fuentes`, aSnake(req)).pipe(map(r => conAliasCamel(r)));
  }

  desactivarFuente(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/fuentes/${id}`);
  }
}

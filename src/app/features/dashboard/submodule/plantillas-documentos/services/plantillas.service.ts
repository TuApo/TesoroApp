import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  Plantilla, PlantillaVersion, PlantillaCampo, CampoDiccionario, CampoPdf,
  RespuestaSugerencias, Auditoria, DocumentoGenerado, ResultadoSembrado, ModoPlantilla, MotorPlantilla, OrigenDato, FilaMapeoGuardar
} from '../models/plantillas.models';

/**
 * Cliente de ms-templates.
 *
 * OJO con la URL: se construye ABSOLUTA sobre environment.apiUrl a propósito.
 * Una ruta relativa la resolvería el interceptor contra el origen del documento
 * y no llegaría a la API. Ver auth.interceptor.ts.
 */
@Injectable({ providedIn: 'root' })
export class PlantillasService {
  private http = inject(HttpClient);
  private raiz = `${environment.apiUrl.replace(/\/+$/, '')}/plantillas`;

  // ── Diccionario: las variables habilitadas ────────────────────────────────
  diccionario(): Observable<CampoDiccionario[]> {
    return this.http.get<CampoDiccionario[]>(`${this.raiz}/diccionario`);
  }

  // ── Catálogo ──────────────────────────────────────────────────────────────
  listar(): Observable<Plantilla[]> {
    return this.http.get<Plantilla[]>(this.raiz);
  }

  crear(datos: { clave: string; nombre: string; modo: ModoPlantilla; notas?: string }): Observable<Plantilla> {
    return this.http.post<Plantilla>(this.raiz, datos);
  }

  /** El corte entre el sistema anterior y este. Es un dato, no un despliegue. */
  cambiarMotor(id: number, motor: MotorPlantilla): Observable<Plantilla> {
    return this.http.post<Plantilla>(`${this.raiz}/${id}/motor`, { motor });
  }

  // ── Formatos de origen ────────────────────────────────────────────────────
  /** Carga de una vez los formatos que la empresa ya usa. */
  sembrarFormatos(directorio?: string): Observable<{ cargados: number; total: number; detalle: ResultadoSembrado[] }> {
    return this.http.post<{ cargados: number; total: number; detalle: ResultadoSembrado[] }>(
      `${this.raiz}/sembrar-formatos`, directorio ? { directorio } : {});
  }

  subirPdfBase(id: number, archivo: File): Observable<{
    plantilla_id: number; version_id: number; activo_base_id: number;
    total_campos: number; campos: CampoPdf[]; aviso: string;
  }> {
    const fd = new FormData();
    fd.append('archivo', archivo);
    return this.http.post<any>(`${this.raiz}/${id}/pdf-base`, fd);
  }

  camposDelPdf(versionId: number): Observable<CampoPdf[]> {
    return this.http.get<CampoPdf[]>(`${this.raiz}/version/${versionId}/campos-pdf`);
  }

  // ── Mapeo ─────────────────────────────────────────────────────────────────
  /** Propuestas automáticas. NO guardan nada: hay que revisarlas y confirmar. */
  sugerencias(versionId: number): Observable<RespuestaSugerencias> {
    return this.http.get<RespuestaSugerencias>(`${this.raiz}/version/${versionId}/sugerencias`);
  }

  verMapeo(versionId: number): Observable<PlantillaCampo[]> {
    return this.http.get<PlantillaCampo[]>(`${this.raiz}/version/${versionId}/mapeo`);
  }

  guardarMapeo(versionId: number, filas: FilaMapeoGuardar[]): Observable<{ version_id: number; campos_guardados: number }> {
    return this.http.put<any>(`${this.raiz}/version/${versionId}/mapeo`, filas);
  }

  // ── Versiones ─────────────────────────────────────────────────────────────
  versiones(id: number): Observable<PlantillaVersion[]> {
    return this.http.get<PlantillaVersion[]>(`${this.raiz}/${id}/versiones`);
  }

  abrirBorrador(id: number): Observable<PlantillaVersion> {
    return this.http.post<PlantillaVersion>(`${this.raiz}/${id}/borrador`, {});
  }

  publicar(versionId: number, notasCambio?: string): Observable<PlantillaVersion> {
    return this.http.post<PlantillaVersion>(`${this.raiz}/version/${versionId}/publicar`,
      { notas_cambio: notasCambio ?? null });
  }

  // ── Auditoría y trazabilidad ──────────────────────────────────────────────
  auditoria(plantillaId?: number): Observable<Auditoria[]> {
    const q = plantillaId ? `?plantilla_id=${plantillaId}` : '';
    return this.http.get<Auditoria[]>(`${this.raiz}/auditoria${q}`);
  }

  generados(plantillaId: number): Observable<DocumentoGenerado[]> {
    return this.http.get<DocumentoGenerado[]>(`${this.raiz}/generados?plantilla_id=${plantillaId}`);
  }

  /** Genera y devuelve el PDF. `SOMBRA` genera sin entregar, para comparar. */
  generar(id: number, datos: unknown, cedula?: string, motor: 'TEMPLATES' | 'SOMBRA' = 'TEMPLATES'): Observable<Blob> {
    return this.http.post(`${this.raiz}/${id}/generar`,
      { datos, cedula: cedula ?? null, motor }, { responseType: 'blob' });
  }

  // ── Modo OVERLAY: el fondo del editor visual ──────────────────────────────
  /** Cuántas páginas tiene el fondo y su escala (puntos PDF por píxel). */
  paginasDelFondo(versionId: number): Observable<{ paginas: number; puntos_por_pixel: number; dpi: number }> {
    return this.http.get<any>(`${this.raiz}/version/${versionId}/paginas`);
  }

  /**
   * Imagen de fondo, como blob.
   *
   * NO se puede usar la URL directa en un <img src>: la API exige la cabecera
   * Authorization y una etiqueta <img> no la envía — devuelve 401 y el fondo
   * sale roto. Comprobado en producción. Por eso se descarga con HttpClient
   * (el interceptor añade el token) y quien la use crea un object URL.
   */
  imagenPagina(versionId: number, numero: number): Observable<Blob> {
    return this.http.get(`${this.raiz}/version/${versionId}/pagina/${numero}/imagen`,
      { responseType: 'blob' });
  }

  /**
   * Qué texto exacto caería en cada campo con datos de ejemplo.
   *
   * Lo calcula el backend con el mismo resolutor que genera el documento real,
   * así que la vista enseña la fecha ya en dd/mm/aaaa y la X en la casilla que
   * toca. Pintar aquí el ejemplo suelto del diccionario daría una vista previa
   * que no coincide con el papel.
   */
  valoresDeEjemplo(versionId: number): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.raiz}/version/${versionId}/valores-ejemplo`);
  }

  // ── De dónde puede venir un dato ──────────────────────────────────────────
  /** Todo lo que una persona tiene al registrarse, agrupado por bloque. */
  origenesDeDatos(): Observable<OrigenDato[]> {
    return this.http.get<OrigenDato[]>(`${this.raiz}/origenes-datos`);
  }

  /** Da de alta un concepto nuevo en el diccionario, atado a una ruta del catálogo. */
  crearConcepto(datos: {
    clave: string; etiqueta: string; ruta: string;
    tipo?: string; ejemplo?: string; descripcion?: string; sensible?: boolean;
  }): Observable<CampoDiccionario> {
    return this.http.post<CampoDiccionario>(`${this.raiz}/diccionario`, datos);
  }

  // ── Modos HTML y RICH ─────────────────────────────────────────────────────
  guardarHtml(versionId: number, html: string, css?: string): Observable<{ version_id: number; caracteres: number }> {
    return this.http.put<any>(`${this.raiz}/version/${versionId}/html`, { html, css: css ?? null });
  }

  /**
   * El documento con datos de ejemplo, sea cual sea su tipo.
   *
   * Se pide por plantilla y el backend decide la versión: el borrador si lo
   * hay, y si no la publicada. Quien mira el catálogo quiere ver el documento,
   * no averiguar primero en qué versión está.
   */
  previsualizarPlantilla(plantillaId: number): Observable<Blob> {
    return this.http.get(`${this.raiz}/${plantillaId}/previsualizar`, { responseType: 'blob' });
  }

  /** PDF de muestra con datos de ejemplo. No guarda nada ni deja rastro. */
  previsualizar(versionId: number): Observable<Blob> {
    return this.http.post(`${this.raiz}/version/${versionId}/previsualizar`, {}, { responseType: 'blob' });
  }
}

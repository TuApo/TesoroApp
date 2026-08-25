import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, retry, throwError, timer } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Submódulo Nómina → "Envío de correos (modelo antiguo)".
 *
 * Habla con DOS microservicios a través del gateway:
 *   - ms-documents (`/gestion_documental/carga-carpeta/**`) para la carga por
 *     carpeta y su previsualizador;
 *   - ms-payroll (`/api/nomina/envio-correos/**`) para el cruce contra la hoja
 *     del modelo antiguo.
 *
 * ⚠️ Los dos responden en snake_case (`@JsonProperty` explícito en los DTO):
 * los modelos de abajo reflejan el JSON REAL, no camelCase.
 */

// ── Carga por carpeta (ms-documents) ─────────────────────────────────────────

export interface ArchivoManifiesto {
  ruta_relativa: string;
  tamano_bytes: number;
}

export interface TipoRef {
  id: number;
  name: string;
}

export interface CarpetaResumen {
  ruta: string;
  profundidad: number;
  total_archivos: number;
  type_id: number | null;
  type_name: string | null;
  ambigua: boolean;
  candidatos: TipoRef[];
}

export interface ItemCarga {
  id: number;
  ruta_relativa: string;
  nombre_archivo: string;
  carpeta_categoria: string | null;
  cedula: string | null;
  type_id: number | null;
  type_name: string | null;
  titulo: string | null;
  estado: EstadoItem;
  motivo: string | null;
  document_id: number | null;
  tamano_bytes: number | null;
  candidatos: string[];
}

export type EstadoItem =
  | 'PENDIENTE' | 'CARGADO' | 'DUPLICADO' | 'AMBIGUO'
  | 'SIN_CEDULA' | 'SIN_TIPO' | 'OMITIDO' | 'ERROR';

export interface LoteCarga {
  lote_id: number;
  carpeta_raiz: string;
  empresa: string | null;
  periodo_clave: string | null;
  periodo_etiqueta: string | null;
  periodo_inferido: boolean;
  estado: string;
  total_archivos: number;
  total_cargados: number;
  total_duplicados: number;
  total_errores: number;
  creado_por: string | null;
  creado_en: string;
}

export interface PreviewCarga {
  lote: LoteCarga;
  resumen: Record<string, number>;
  carpetas: CarpetaResumen[];
  items_por_resolver: ItemCarga[];
  tipos_disponibles: TipoRef[];
  listo_para_subir: boolean;
  advertencias: string[];
}

export interface ResultadoArchivo {
  ruta_relativa: string;
  estado: EstadoItem;
  document_id: number | null;
  motivo: string | null;
}

export interface SubirRespuesta {
  lote: LoteCarga;
  resumen: Record<string, number>;
  resultados: ResultadoArchivo[];
  pendientes: number;
}

// ── Cruce (ms-payroll) ───────────────────────────────────────────────────────

export interface PeriodoDisponible {
  clave: string;
  etiqueta: string;
  total_filas: number;
}

/** Un documento de la persona, con su tipo y la carga de la que salió. */
export interface DocumentoCruce {
  document_id: number;
  type_id: number | null;
  type_name: string | null;
  nombre_archivo: string | null;
  tamano_bytes: number | null;
  lote_id: number | null;
  carpeta_raiz: string | null;
}

/** Una carga de documentos que se puede cruzar contra la quincena. */
export interface CargaDisponible {
  lote_id: number;
  carpeta_raiz: string;
  empresa: string | null;
  total_cargados: number;
  tipos: string[];
}

export interface FilaCruce {
  id: number;
  cedula: string;
  nombre: string;
  finca: string | null;
  correo: string | null;
  telefono: string | null;
  concepto: string | null;
  ingreso: string | null;
  retiro: string | null;
  confirmacion_envio: string | null;
  link_legacy: string | null;
  estado_archivo: 'SUBIDO' | 'FALTANTE';
  document_id: number | null;
  nombre_archivo: string | null;
  tamano_bytes: number | null;
  /** Todos los documentos: una liquidación son varios, de carpetas distintas. */
  documentos: DocumentoCruce[];
  sin_correo: boolean;
}

export interface ResumenCruce {
  total_personas: number;
  subidos: number;
  faltantes: number;
  sin_correo: number;
  archivos_huerfanos: number;
}

export interface CruceRespuesta {
  periodo_clave: string;
  periodo_etiqueta: string;
  empresa: string | null;
  type_id: number | null;
  resumen: ResumenCruce;
  cargas_disponibles: CargaDisponible[];
  /** Tipos presentes en las cargas elegidas: una columna por cada uno. */
  tipos_presentes: string[];
  content: FilaCruce[];
  total_elements: number;
  total_pages: number;
  page: number;
  advertencias: string[];
}

// ── Fase 2: plantillas, envío e histórico ────────────────────────────────────

export type ModoDocumento = 'ADJUNTO' | 'ENLACE' | 'AMBOS';

export interface Plantilla {
  id: number;
  nombre: string;
  empresa: string | null;
  tipo: string | null;
  asunto: string;
  cuerpo_html: string;
  modo_documento: ModoDocumento;
  activo: boolean;
  /** Sube la plantilla al principio de la lista. */
  destacada: boolean;
  orden: number;
  creado_por: string | null;
  creado_en: string;
}

export interface CampoPlantilla {
  campo: string;
  descripcion: string;
}

export interface PreviewCorreo {
  asunto: string;
  cuerpo_html: string;
  modo_documento: ModoDocumento;
  /** false = la quincena no tenía filas y el preview usa datos de ejemplo. */
  con_datos_reales: boolean;
  destinatario_ejemplo: string | null;
  aviso: string | null;
}

export interface CargaCorreos {
  filas_leidas: number;
  actualizados: number;
  sin_cambio: number;
  invalidos: number;
  detalle_invalidos: string[];
  advertencias: string[];
}

export type EstadoEnvioItem =
  | 'PENDIENTE' | 'ENVIADO' | 'FALLIDO'
  | 'SIN_CORREO' | 'SIN_DOCUMENTO' | 'OMITIDO';

export interface EnvioLote {
  id: number;
  periodo_clave: string;
  periodo_etiqueta: string | null;
  empresa: string | null;
  type_id: number | null;
  tipo_etiqueta: string | null;
  plantilla_id: number;
  plantilla_nombre: string | null;
  estado: string;
  total: number;
  total_enviados: number;
  total_fallidos: number;
  total_omitidos: number;
  creado_por: string | null;
  creado_en: string;
}

export interface EnvioItem {
  id: number;
  cedula: string;
  nombre: string | null;
  correo: string | null;
  correo_origen: 'HOJA' | 'OVERRIDE' | null;
  document_id: number | null;
  nombre_archivo: string | null;
  estado: EstadoEnvioItem;
  motivo: string | null;
  asunto: string | null;
  enviado_en: string | null;
}

export interface LoteDetalle {
  lote: EnvioLote;
  resumen: Record<string, number>;
  listos_para_enviar: number;
  items_con_problema: EnvioItem[];
  advertencias: string[];
}

export interface EnviarTanda {
  lote: EnvioLote;
  procesados: number;
  enviados: number;
  fallidos: number;
  pendientes: number;
  resultados: EnvioItem[];
  advertencias: string[];
}

@Injectable({ providedIn: 'root' })
export class EnvioCorreosService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  private get carga() { return `${this.api}/gestion_documental/carga-carpeta`; }
  private get nomina() { return `${this.api}/api/nomina/envio-correos`; }

  /**
   * Reintenta ante un 429 con espera creciente.
   *
   * El gateway limita a 50 req/s con ráfaga de 100 POR USUARIO, y la app hace
   * un refresco en segundo plano de 50 URLs cacheadas que se come casi toda la
   * ráfaga de golpe. Cuando eso coincide con abrir una de estas pantallas, las
   * peticiones caen con 429 y la pantalla sale vacía.
   *
   * Un 429 se rechaza EN EL GATEWAY: la petición nunca llega al microservicio,
   * así que no hay efecto secundario y reintentar es seguro incluso para la
   * subida de una tanda.
   *
   * Solo reintenta el 429: cualquier otro error se propaga tal cual, para no
   * disfrazar un fallo real de lentitud.
   */
  private reintentarSi429<T>(): MonoTypeOperatorFunction<T> {
    return retry<T>({
      count: 4,
      delay: (error: any, intento: number) => {
        if (error?.status !== 429) return throwError(() => error);
        // 400ms, 800ms, 1.6s, 3.2s: dentro de ese margen el cubo se rellena.
        return timer(400 * Math.pow(2, intento - 1));
      },
    });
  }

  // ── Carga por carpeta ──────────────────────────────────────────────────────

  /**
   * Paso 1. Manda SOLO el manifiesto (rutas y tamaños, sin bytes) para que el
   * backend clasifique y cruce. Un corte son ~1500 PDFs: mandar los binarios
   * antes de saber si están bien clasificados es tirar ancho de banda.
   */
  previsualizar(
    carpetaRaiz: string,
    empresa: string | null,
    periodoClave: string | null,
    archivos: ArchivoManifiesto[],
  ): Observable<PreviewCarga> {
    return this.http.post<PreviewCarga>(`${this.carga}/preview`, {
      carpeta_raiz: carpetaRaiz,
      empresa,
      periodo_clave: periodoClave,
      archivos,
    }).pipe(this.reintentarSi429());
  }

  obtenerLote(loteId: number): Observable<PreviewCarga> {
    return this.http.get<PreviewCarga>(`${this.carga}/lotes/${loteId}`)
      .pipe(this.reintentarSi429());
  }

  /**
   * Items del lote, paginados y filtrables por estado. El detalle del lote solo
   * devuelve los que exigen acción del usuario; para saber QUÉ subir hay que
   * preguntar por los PENDIENTE explícitamente en vez de deducirlos por
   * descarte (que se rompe en cuanto hay omitidos o cargados previos).
   */
  itemsDeLote(loteId: number, estado?: EstadoItem, page = 0, size = 500):
    Observable<{ content: ItemCarga[]; total_elements: number; total_pages: number }> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (estado) params = params.set('estado', estado);
    return this.http.get<{ content: ItemCarga[]; total_elements: number; total_pages: number }>(
      `${this.carga}/lotes/${loteId}/items`, { params }).pipe(this.reintentarSi429());
  }

  listarLotes(page = 0, size = 20): Observable<{ content: LoteCarga[]; total_elements: number }> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<{ content: LoteCarga[]; total_elements: number }>(
      `${this.carga}/lotes`, { params }).pipe(this.reintentarSi429());
  }

  /** Empresa, quincena, o "aplicar este tipo a toda esta carpeta". */
  ajustarLote(loteId: number, cambios: {
    empresa?: string | null;
    periodo_clave?: string | null;
    carpeta?: string;
    type_id?: number;
  }): Observable<PreviewCarga> {
    return this.http.patch<PreviewCarga>(`${this.carga}/lotes/${loteId}`, cambios);
  }

  /** Correcciones fila a fila: resolver cédula, elegir tipo, omitir. */
  ajustarItems(loteId: number, items: {
    id: number; type_id?: number; cedula?: string; estado?: 'OMITIDO' | 'PENDIENTE';
  }[]): Observable<PreviewCarga> {
    return this.http.patch<PreviewCarga>(`${this.carga}/lotes/${loteId}/items`, { items });
  }

  /**
   * Paso 2. Sube UNA TANDA de archivos del lote ya revisado. El componente
   * trocea para poder mostrar progreso y reintentar solo lo que falló.
   */
  subirTanda(loteId: number, archivos: File[], rutas: string[]): Observable<SubirRespuesta> {
    const form = new FormData();
    archivos.forEach((f, i) => {
      // El nombre del File se pierde si la ruta trae carpetas; por eso la ruta
      // viaja aparte, en el mismo orden, y es lo que ata cada binario a su item.
      form.append('archivos', f, f.name);
      form.append('rutas', rutas[i]);
    });
    return this.http.post<SubirRespuesta>(`${this.carga}/lotes/${loteId}/subir`, form)
      .pipe(this.reintentarSi429());
  }

  cancelarLote(loteId: number): Observable<LoteCarga> {
    return this.http.delete<LoteCarga>(`${this.carga}/lotes/${loteId}`);
  }

  tiposDisponibles(): Observable<TipoRef[]> {
    return this.http.get<TipoRef[]>(`${this.carga}/tipos`).pipe(this.reintentarSi429());
  }

  // ── Cruce ──────────────────────────────────────────────────────────────────

  periodos(): Observable<{ content: PeriodoDisponible[]; total: number }> {
    return this.http.get<{ content: PeriodoDisponible[]; total: number }>(
      `${this.nomina}/periodos`).pipe(this.reintentarSi429());
  }

  cruce(opts: {
    periodoClave: string;
    typeId?: number | null;
    empresa?: string | null;
    estado?: string;
    q?: string;
    /** Cargas concretas a cruzar; vacío = todas las de la quincena. */
    loteIds?: number[];
    page?: number;
    size?: number;
  }): Observable<CruceRespuesta> {
    let params = new HttpParams().set('periodo_clave', opts.periodoClave);
    if (opts.typeId) params = params.set('type_id', opts.typeId);
    if (opts.empresa) params = params.set('empresa', opts.empresa);
    if (opts.estado) params = params.set('estado', opts.estado);
    if (opts.q) params = params.set('q', opts.q);
    // Repetido, no separado por comas: es como Spring enlaza List<Long>.
    for (const id of opts.loteIds ?? []) params = params.append('lote_ids', id);
    params = params.set('page', opts.page ?? 0).set('size', opts.size ?? 50);
    return this.http.get<CruceRespuesta>(`${this.nomina}/cruce`, { params })
      .pipe(this.reintentarSi429());
  }

  /**
   * Descarga el documento interno como blob.
   *
   * NO se puede usar `window.open(url)`: `/api/v1/documents/**` no está en
   * `GATEWAY_AUTH_PUBLIC_PATHS`, así que el gateway exige JWT y una navegación
   * directa responde 401 — el documento no abre nunca. Pasando por HttpClient,
   * el `authInterceptor` añade el token. Es el patrón que ya usan afiliaciones
   * y gestión documental.
   */
  descargarDocumento(documentId: number): Observable<Blob> {
    return this.http.get(`${this.api}/api/v1/documents/${documentId}/download`,
      { responseType: 'blob' });
  }

  // ── Fase 2: plantillas ─────────────────────────────────────────────────────

  plantillas(): Observable<{ content: Plantilla[] }> {
    return this.http.get<{ content: Plantilla[] }>(`${this.nomina}/plantillas`)
      .pipe(this.reintentarSi429());
  }

  /** Placeholders disponibles: la UI los muestra para no obligar a adivinarlos. */
  camposPlantilla(): Observable<{ content: CampoPlantilla[] }> {
    return this.http.get<{ content: CampoPlantilla[] }>(`${this.nomina}/plantillas/campos`)
      .pipe(this.reintentarSi429());
  }

  guardarPlantilla(id: number | null, p: Partial<Plantilla>): Observable<Plantilla> {
    return id
      ? this.http.put<Plantilla>(`${this.nomina}/plantillas/${id}`, p)
      : this.http.post<Plantilla>(`${this.nomina}/plantillas`, p);
  }

  /** Marca/desmarca destacada. No cambia cuál se resuelve por defecto. */
  destacarPlantilla(id: number, destacada: boolean): Observable<Plantilla> {
    const params = new HttpParams().set('destacada', destacada);
    return this.http.patch<Plantilla>(`${this.nomina}/plantillas/${id}/destacada`, null, { params });
  }

  activarPlantilla(id: number, activo: boolean): Observable<Plantilla> {
    const params = new HttpParams().set('activo', activo);
    return this.http.patch<Plantilla>(`${this.nomina}/plantillas/${id}/activo`, null, { params });
  }

  /**
   * Previsualiza el correo. Con `plantilla_id` usa la guardada; con asunto y
   * cuerpo en crudo permite ver una plantilla mientras se escribe.
   */
  previewPlantilla(body: {
    plantilla_id?: number | null;
    asunto?: string;
    cuerpo_html?: string;
    modo_documento?: ModoDocumento;
    periodo_clave?: string | null;
    empresa?: string | null;
    tipo?: string | null;
  }): Observable<PreviewCorreo> {
    return this.http.post<PreviewCorreo>(`${this.nomina}/plantillas/preview`, body);
  }

  // ── Fase 2: plantilla Excel de correos ─────────────────────────────────────

  /** Excel con la gente de la quincena y su correo actual, para corregirlo. */
  descargarPlantillaCorreos(periodoClave: string, empresa: string | null): Observable<Blob> {
    let params = new HttpParams().set('periodo_clave', periodoClave);
    if (empresa) params = params.set('empresa', empresa);
    return this.http.get(`${this.nomina}/correos/plantilla-excel`,
      { params, responseType: 'blob' });
  }

  cargarPlantillaCorreos(archivo: File): Observable<CargaCorreos> {
    const form = new FormData();
    form.append('archivo', archivo, archivo.name);
    return this.http.post<CargaCorreos>(`${this.nomina}/correos/plantilla-excel`, form);
  }

  // ── Fase 2: lotes de envío ─────────────────────────────────────────────────

  /** Arma el lote cruzando hoja + correo vigente + documento. No envía nada. */
  prepararLote(body: {
    periodo_clave: string;
    empresa: string | null;
    type_id: number | null;
    tipo: string | null;
    plantilla_id: number | null;
    omitir_ya_enviados: boolean;
    /** Cargas que alimentan el envío: varias para una liquidación. */
    lote_ids?: number[];
  }): Observable<LoteDetalle> {
    return this.http.post<LoteDetalle>(`${this.nomina}/lotes/preparar`, body);
  }

  /** Envía UNA tanda. El componente la llama en bucle mostrando progreso. */
  enviarTanda(loteId: number, tamano = 20): Observable<EnviarTanda> {
    const params = new HttpParams().set('tamano', tamano);
    return this.http.post<EnviarTanda>(`${this.nomina}/lotes/${loteId}/enviar`, null, { params });
  }

  reintentarFallidos(loteId: number): Observable<LoteDetalle> {
    return this.http.post<LoteDetalle>(`${this.nomina}/lotes/${loteId}/reintentar`, null);
  }

  obtenerLoteEnvio(loteId: number): Observable<LoteDetalle> {
    return this.http.get<LoteDetalle>(`${this.nomina}/lotes/${loteId}`);
  }

  cancelarLoteEnvio(loteId: number): Observable<EnvioLote> {
    return this.http.delete<EnvioLote>(`${this.nomina}/lotes/${loteId}`);
  }

  listarLotesEnvio(periodoClave: string | null, estado: string | null, page = 0, size = 20):
    Observable<{ content: EnvioLote[]; total_elements: number; total_pages: number; page: number }> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (periodoClave) params = params.set('periodo_clave', periodoClave);
    if (estado) params = params.set('estado', estado);
    return this.http.get<{ content: EnvioLote[]; total_elements: number; total_pages: number; page: number }>(
      `${this.nomina}/lotes`, { params });
  }

  itemsDelLoteEnvio(loteId: number, estado: string | null, page = 0, size = 50):
    Observable<{ content: EnvioItem[]; total_elements: number; total_pages: number; page: number }> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (estado) params = params.set('estado', estado);
    return this.http.get<{ content: EnvioItem[]; total_elements: number; total_pages: number; page: number }>(
      `${this.nomina}/lotes/${loteId}/items`, { params });
  }
}

import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, tap, timeout } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '@/environments/environment';
import { sinTildes } from '../../shared/sin-tildes.helper';
import { ExpedienteContrato, procesoValido } from './expediente-contrato.model';

@Injectable({
  providedIn: 'root',
})
export class GestionDocumentalService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  // ------------------ DOCUMENTOS (CRUD) ------------------

  /**
   * Crea/actualiza un Document en gestion_documental.
   *
   * `owner_id` debe ser la cédula RAW (sin prefijo).
   * Si la persona NO es CC, hay que pasar `tipo_documento` (ej: "CE", "PPT");
   * el backend prefijará automáticamente owner_id con "x" para evitar
   * colisiones entre CC y non-CC con el mismo número de cédula.
   *
   * `proceso_id` = id del proceso de contratación (`entrevistas[i].proceso.id`,
   * que también es la llave del contrato en ms-hr). Con él el documento queda
   * atado a SU contrato (ms-documents V21): el examen o el contrato del 2º
   * vínculo ya no se confunden con los del 1º. Si no llega, todo sigue como antes.
   */
  guardarDocumento(
    title: any,
    owner_id: any,
    type: number,
    file: File,
    contract_number?: string,
    tipo_documento?: string,
    proceso_id?: number | string | null,
  ): Observable<any> {
    const formData = new FormData();
    // El título queda guardado en gestion_documental: sin tildes ni ñ.
    // `tipo_documento` NO se toca: debe hacer match exacto contra el catálogo.
    formData.append('title', typeof title === 'string' ? sinTildes(title) : title);
    formData.append('owner_id', owner_id);
    formData.append('type', type.toString());
    formData.append('file', file);
    if (contract_number) formData.append('contract_number', contract_number);
    if (tipo_documento) formData.append('tipo_documento', tipo_documento);
    const proceso = procesoValido(proceso_id);
    if (proceso) formData.append('proceso_id', proceso);

    // Carga VALIDADA (ms-templates): si el tipo no está chuleado en el parametrizador para la
    // requisición de la persona responde 409 con el motivo en error/detail/message y no llega a
    // gestión documental. Si pasa, la guarda ms-documents igual que antes (misma respuesta).
    return this.http.post(
      `${this.apiUrl}/plantillas/excel/documentos/cargar`,
      formData
    ).pipe(
      // El expediente de esa cédula cambió: la próxima lectura debe ir al servidor.
      tap(() => this.invalidarDocumentos(owner_id)),
    );
  }

  /**
   * Une las dos caras que dejó el formulario de vacantes en el documento
   * ampliado al 150% (tipo 29, CEDULA). Idempotente: si ya hay uno igual o más
   * nuevo lo devuelve sin tocarlo; sin las dos caras responde SIN_CARAS.
   */
  armarCedulaAmpliada(owner_id: string | number): Observable<{ estado: string; id: number | null }> {
    const clave = String(owner_id ?? '').trim();
    return this.http
      .post<{ estado: string; id: number | null }>(
        `${this.apiUrl}/gestion_documental/cedula-ampliada/${encodeURIComponent(clave)}`, {})
      .pipe(tap((r) => { if (r?.estado === 'CREADA') this.invalidarDocumentos(clave); }));
  }

  /* ============ Expediente completo por cédula (UNA petición) ============ */

  /**
   * Todos los documentos de una cédula en UNA sola petición, compartida.
   *
   * Al abrir un candidato en el pipeline, tres componentes pedían el mismo
   * endpoint OCHO veces variando solo `type` (32, 30, 89, 16, 17, 18, 86 y una
   * sin tipo). El backend aplica la misma regla con y sin tipo —el documento
   * vigente de cada tipo, dos para referencias personales/familiares— y ninguno
   * de esos tipos tiene subtipos, así que la respuesta sin `type` contiene TODO
   * lo que las otras siete buscaban. Cada consumidor filtra por `type` en local.
   *
   * La respuesta queda cacheada unos segundos por cédula: las llamadas del
   * mismo "estallido" (pipeline + selección + contratación abriendo a la vez)
   * comparten una única petición en vuelo. Un 404 significa "sin documentos" y
   * se entrega como lista vacía; un error real no se cachea para que el
   * siguiente intento vuelva a preguntar.
   *
   * `force` salta el caché (polling que espera documentos nuevos del robot).
   * Toda subida por `guardarDocumento` invalida la cédula automáticamente;
   * subidas por OTROS servicios (p. ej. la foto) deben llamar
   * `invalidarDocumentos(cedula)`.
   */
  getDocumentosDeCandidato(
    cedula: string | number,
    opts?: { force?: boolean; tipoDoc?: string | null },
  ): Observable<any[]> {
    const clave = String(cedula ?? '').trim();
    if (!clave) return of([]);
    // Documento que no es CC (PPT/PET, CE, PEP, TI…): la flota de robots sube sus PDF con
    // owner_id `x<cédula>` (make_owner_id) y ms-documents filtra el owner TAL CUAL, así que
    // con la cédula pelada no salían. Se piden las dos llaves y se juntan. No se hace para CC:
    // una cédula vieja de 7 dígitos puede coincidir con el PPT de OTRA persona.
    const conX = /^\d+$/.test(clave) && GestionDocumentalService.tipoConPrefijo(opts?.tipoDoc);
    if (!conX) return this.expedientePorOwner(clave, opts?.force);
    return forkJoin([
      this.expedientePorOwner(clave, opts?.force),
      this.expedientePorOwner(`x${clave}`, opts?.force),
    ]).pipe(
      map(([planos, conPrefijo]) => {
        // Mismo orden que el backend (id DESC): quien toma "el primero por tipo" sigue
        // quedándose con el más reciente.
        const vistos = new Set<unknown>();
        return [...planos, ...conPrefijo]
          .filter((d) => (vistos.has(d?.id) ? false : (vistos.add(d?.id), true)))
          .sort((a, b) => Number(b?.id ?? 0) - Number(a?.id ?? 0));
      }),
    );
  }

  /** Regla de `make_owner_id` (Django): CC o sin tipo → cédula pelada; cualquier otro → `x`. */
  static tipoConPrefijo(tipoDoc: string | null | undefined): boolean {
    const t = String(tipoDoc ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    return !!t && t !== 'CC';
  }

  /** Un owner_id exacto, con caché. Ver `getDocumentosDeCandidato`. */
  private expedientePorOwner(clave: string, force?: boolean): Observable<any[]> {
    const hit = this.docsPorCedula.get(clave);
    if (hit && !force && Date.now() - hit.creadoEn < GestionDocumentalService.DOCS_TTL_MS) {
      return hit.obs;
    }

    const obs = this.http
      .get(`${this.apiUrl}/gestion_documental/documentos/`, {
        params: new HttpParams().set('cedula', clave),
      })
      .pipe(
        map((r) => (Array.isArray(r) ? r : [])),
        catchError((err: HttpErrorResponse) => {
          // "No hay documentos" no es un error: es un expediente vacío.
          if (err.status === 404) return of([] as any[]);
          return throwError(() => err);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.docsPorCedula.set(clave, { obs, creadoEn: Date.now() });
    // Un error real no debe quedar cacheado como si fuera la respuesta.
    obs.subscribe({ error: () => this.docsPorCedula.delete(clave) });
    return obs;
  }

  /**
   * Retira un documento del expediente (borrado LOGICO en ms-documents).
   *
   * Invalida el caché de la cédula: sin eso el documento borrado seguía saliendo
   * hasta que venciera el TTL de 30 s, y parecía que el borrado no había hecho
   * nada.
   */
  eliminarDocumento(id: number | string, cedula?: string | number): Observable<any> {
    return this.http
      .delete(`${this.apiUrl}/gestion_documental/documentos/${id}/`)
      .pipe(tap(() => this.invalidarDocumentos(cedula)));
  }

  /** Olvida el expediente cacheado de una cédula (o todos, sin argumento). */
  invalidarDocumentos(cedula?: string | number): void {
    if (cedula == null || cedula === '') {
      this.docsPorCedula.clear();
      return;
    }
    const original = String(cedula).trim();
    const clave = original.replace(/^x/i, '');
    this.docsPorCedula.delete(original);
    this.docsPorCedula.delete(clave);
    this.docsPorCedula.delete(`x${clave}`);
  }

  /** Expedientes ya pedidos, por cédula. Ver `getDocumentosDeCandidato`. */
  private readonly docsPorCedula = new Map<string, { obs: Observable<any[]>; creadoEn: number }>();

  /**
   * Cubre el estallido de apertura de un candidato (todas las llamadas caen en
   * segundos) sin arriesgar datos viejos si lo vuelven a consultar más tarde.
   */
  private static readonly DOCS_TTL_MS = 30_000;

  /**
   * Obtiene documentos filtrados por cédula (obligatoria) y opcionalmente tipo o contrato.
   *
   * Con `contract_number` o `proceso_id` el backend devuelve SOLO los documentos
   * etiquetados con ese contrato (lo histórico casi nunca lo está). Para ver un
   * contrato completo, con lo de la persona y lo sin asignar, usar
   * `getExpedienteContrato`.
   */
  getDocuments(cedula: string, type?: number, contract_number?: string,
    proceso_id?: number | string | null): Observable<any> {
    let params = new HttpParams().set('cedula', cedula);
    if (type !== undefined && type !== null) {
      params = params.set('type', type.toString());
    }
    if (contract_number) {
      params = params.set('contract_number', contract_number);
    }
    const proceso = procesoValido(proceso_id);
    if (proceso) params = params.set('proceso_id', proceso);
    return this.http.get(`${this.apiUrl}/gestion_documental/documentos/`, { params });
  }

  // ------------------ EXPEDIENTE POR CONTRATO ------------------

  /**
   * GET /gestion_documental/expediente-contrato
   *
   * Documentos de UN contrato + los de la persona (cédula, hoja de vida, foto,
   * firma, huella, antecedentes) + los exigidos con su estado. Basta la cédula
   * (toma su último contrato) o el proceso. `tipos` reemplaza los exigidos por
   * defecto (mismos ids que las columnas del checklist).
   */
  getExpedienteContrato(filtro: {
    cedula?: string | number | null;
    proceso_id?: number | string | null;
    contract_number?: string | null;
    tipos?: number[] | null;
  }): Observable<ExpedienteContrato> {
    let params = new HttpParams();
    const ced = String(filtro?.cedula ?? '').trim();
    if (ced) params = params.set('cedula', ced);
    const proceso = procesoValido(filtro?.proceso_id);
    if (proceso) params = params.set('proceso_id', proceso);
    const cn = String(filtro?.contract_number ?? '').trim();
    if (cn) params = params.set('contract_number', cn);
    const tipos = filtro?.tipos;
    if (Array.isArray(tipos) && tipos.length) {
      params = params.set('tipos', tipos.join(','));
    }
    return this.http.get<ExpedienteContrato>(
      `${this.apiUrl}/gestion_documental/expediente-contrato`, { params });
  }

  // Alias para compatibilidad regresiva (si es necesario)
  obtenerDocumentosPorTipo(owner_id: any, type: number, contract_number?: string): Observable<any> {
    return this.getDocuments(owner_id, type, contract_number);
  }

  consultarDocumentosPorCedulaYTipo(cedula: string, type?: number): Observable<any> {
    return this.getDocuments(cedula, type);
  }

  // ------------------ ZIP POR CÉDULAS + ORDEN ------------------

  /**
   * Descarga el ZIP de documentos unidos por cédula.
   *
   * Notas operativas:
   *  - `responseType: 'blob'` → el offlineInterceptor lo excluye del queue.
   *  - `timeout(15 min)` → el backend genera el ZIP en disco (puede tardar
   *    minutos si hay muchas cédulas). El timeout default de fetch es ~5min
   *    en Electron/Chromium y depende del SO; lo subimos explícitamente.
   *  - Si el server responde con un error JSON (no blob), lo capturamos en
   *    el catchError para devolver un Error con mensaje legible.
   *  - `observe: 'body'` (default) → recibimos el blob completo.
   */
  descargarZipPorCedulasYOrden(cedulas: number[], orden: number[]): Observable<Blob> {
    const body = { cedulas, orden };

    // 15 minutos: cota generosa. Si tarda más, hay algo realmente mal.
    const ZIP_TIMEOUT_MS = 15 * 60 * 1000;

    return this.http
      .post(`${this.apiUrl}/gestion_documental/descargar-zip`, body, {
        responseType: 'blob',
        // ⚠️ NO mandar `Accept: application/zip`: DRF (Django REST Framework)
        // hace content negotiation contra sus renderers configurados
        // (por default solo JSONRenderer). Si recibe un Accept específico
        // que NO matchea ningún renderer, devuelve 406 Not Acceptable
        // ("Could not satisfy the request Accept header").
        // Como esperamos un binario, lo correcto es `*/*`.
        headers: new HttpHeaders({
          'Accept': '*/*',
          'X-Requested-With': 'XMLHttpRequest',
        }),
      })
      .pipe(
        timeout({
          each: ZIP_TIMEOUT_MS,
          with: () => throwError(() => new Error(
            'La descarga tardó más de 15 min. Reintenta con menos cédulas a la vez.'
          )),
        }),
        catchError((err: unknown) => {
          // Si la respuesta de error es Blob, intentamos parsear el JSON
          // dentro para mostrar el mensaje real del backend.
          if (err instanceof HttpErrorResponse && err.error instanceof Blob) {
            return new Observable<Blob>((sub) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                let detail = 'Error al generar el ZIP';
                try {
                  const parsed = JSON.parse(String(reader.result || '{}'));
                  detail = parsed?.error || parsed?.detail || detail;
                } catch { /* no era JSON */ }
                sub.error(new Error(detail));
              };
              reader.onerror = () => sub.error(new Error('Error al generar el ZIP'));
              reader.readAsText(err.error);
            });
          }
          return throwError(() => err);
        }),
      );
  }

  // ------------------ NUEVO: CHECKLIST DOCUMENTAL ------------------

  /**
   * POST /gestion_documental/documentos-checklist/
   * Envía SOLO cédulas; el backend usa los tipos por defecto si no envías 'tipos'.
   * @param cedulas array de cédulas (string|number) -> se envían como string
   * @param tipos   opcional para override puntual
   * @param contrato opcional: solo cuentan los documentos de ESE contrato en los
   *   tipos de contrato (la cédula, la foto y los antecedentes no se filtran).
   *   Viaja en la query para no cambiar el cuerpo.
   */
  getDocumentosChecklist(cedulas: Array<string | number>, tipos?: number[],
    contrato?: { proceso_id?: number | string | null; contract_number?: string | null }): Observable<any> {
    const body: any = { cedulas: cedulas.map(String) };
    if (Array.isArray(tipos) && tipos.length) body.tipos = tipos;
    let params = new HttpParams();
    const proceso = procesoValido(contrato?.proceso_id);
    if (proceso) params = params.set('proceso_id', proceso);
    const cn = String(contrato?.contract_number ?? '').trim();
    if (cn) params = params.set('contract_number', cn);
    return this.http.post(
      `${this.apiUrl}/gestion_documental/documentos-checklist/`,
      body,
      { params }
    );
  }

  /**
   * GET /gestion_documental/documentos-checklist/?cedulas=...[,...]&tipos=...[,...]
   * Alternativa por querystring. Si omites 'tipos', el backend usará los defaults.
   */
  getDocumentosChecklistByGet(cedulas: Array<string | number>, tipos?: number[]): Observable<any> {
    let params = new HttpParams().set('cedulas', cedulas.map(String).join(','));
    if (Array.isArray(tipos) && tipos.length) {
      params = params.set('tipos', tipos.join(','));
    }
    return this.http.get(
      `${this.apiUrl}/gestion_documental/documentos-checklist/`,
      { params }
    );
  }

  /**
   * GET /gestion_contratacion/entrevistas/cedulas-por-oficina/
   * Devuelve cédulas únicas con entrevista en una de las sedes y dentro del rango.
   * Útil para la "consulta automática" del módulo de checklist documental.
   */
  getCedulasPorOficina(
    oficinas: string[],
    start?: string | null,
    end?: string | null,
  ): Observable<{ docs: string[]; count: number }> {
    let params = new HttpParams().set('oficinas', (oficinas ?? []).join(','));
    if (start) params = params.set('start', start);
    if (end) params = params.set('end', end);
    return this.http.get<{ docs: string[]; count: number }>(
      `${this.apiUrl}/gestion_contratacion/entrevistas/cedulas-por-oficina/`,
      { params },
    );
  }
}

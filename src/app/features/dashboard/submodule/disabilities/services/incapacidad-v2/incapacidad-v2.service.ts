import { Injectable, computed, inject, signal } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
} from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';

import { environment } from '@/environments/environment';
import { getLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import {
  CatalogosIncapacidad,
  CodigoDiagnostico,
  CrearIncapacidadV2Request,
  DatosContratacionResponse,
  EmpleadoBusqueda,
  EpsMatrizItem,
  ExportJob,
  FiltrosIncapacidadV2,
  IncapacidadResumen,
  IncapacidadV2,
  InformeUmbral,
  IpsBusqueda,
  ListaSoportesResponse,
  Page,
  RadicacionIncapacidad,
  RadicarPeticion,
  ResultadoCargaMasivaRadicados,
  ResultadoPromocion,
  ResumenIncapacidades,
  SoporteIncapacidad,
  TipoExportJob,
  TipoSoporte,
  ValidacionResponse,
  ValidarIncapacidadRequest,
} from '../../models/incapacidad-v2.model';

/* El mapeo `TipoSoporte` -> `legacy_field` ya NO vive aqui: los soportes de la
   v2 se suben por `POST /Incapacidades/v2/{id}/soportes`, que ancla en la
   tabla `incapacidad` y recibe el nombre del enum tal cual. El `legacy_field`
   lo resuelve el backend (commons `DocumentTypeCodes`) para que el documento
   quede en el mismo espacio de ms-documents que los legacy.
   El mundo viejo sigue usando su propio literal en
   `IncapacidadService.uploadDocumento`, que no depende de este servicio. */

/** Ordenamiento para `listar()`. `campo,direccion` estilo Spring Data. */
export interface OrdenListado {
  campo: string;
  direccion?: 'asc' | 'desc';
}

/**
 * Servicio unico de Incapacidades v2.
 *
 * Principios:
 *  - NO se traga los errores: cualquier fallo HTTP se propaga tal cual para
 *    que la vista decida como mostrarlo. La UNICA excepcion deliberada es
 *    `promoverAValidada`, donde el 409 es una respuesta de negocio esperada
 *    y se traduce a `{ ok: false, motivosBloqueo }`.
 *  - El estado que expone son SIGNALS (la app es ZONELESS). Nada de
 *    `BehaviorSubject` para estado de UI.
 *  - Los catalogos se piden UNA sola vez por sesion y quedan cacheados.
 */
@Injectable({ providedIn: 'root' })
export class IncapacidadV2Service {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly base = `${environment.apiUrl}/Incapacidades/v2`;

  // ── Cache de catalogos ────────────────────────────────────────────────
  private readonly _catalogos = signal<CatalogosIncapacidad | null>(null);
  private readonly _cargandoCatalogos = signal(false);

  /** Catalogos ya cacheados (`null` mientras no se hayan pedido). */
  readonly catalogosCache = this._catalogos.asReadonly();
  /** `true` mientras la peticion de catalogos esta en vuelo. */
  readonly cargandoCatalogos = this._cargandoCatalogos.asReadonly();
  /** `true` cuando los catalogos ya estan disponibles. */
  readonly catalogosListos = computed(() => this._catalogos() !== null);

  /** Peticion en vuelo compartida, para que N componentes no disparen N GET. */
  private peticionCatalogos$: Observable<CatalogosIncapacidad> | null = null;

  // ── Cache de la matriz de EPS (V43) ───────────────────────────────────
  private readonly _epsMatriz = signal<EpsMatrizItem[] | null>(null);
  /** Matriz de EPS ya cacheada (`null` mientras no se haya pedido). */
  readonly epsMatrizCache = this._epsMatriz.asReadonly();
  /** Peticion en vuelo compartida de la matriz. */
  private peticionEpsMatriz$: Observable<EpsMatrizItem[]> | null = null;

  // ── Cabeceras ─────────────────────────────────────────────────────────

  /**
   * Token desde `localStorage` (SSR-safe via `getLocalStorageItem`).
   * Mismo criterio que el `IncapacidadService` actual.
   */
  private getToken(): string | null {
    return getLocalStorageItem('token');
  }

  /**
   * Cabecera `Authorization`.
   * NOTA: `core/interceptors/auth.interceptor.ts` tambien la inyecta (y le
   * antepone `Bearer ` si falta), asi que en runtime la del interceptor gana.
   * Se deja aqui por consistencia con el resto de servicios del modulo y
   * para que el servicio siga siendo usable sin el interceptor (tests).
   */
  private cabeceras(): HttpHeaders {
    const token = this.getToken();
    return token ? new HttpHeaders().set('Authorization', token) : new HttpHeaders();
  }

  /** Cabeceras para cuerpos JSON. NO usar en multipart. */
  private cabecerasJson(): HttpHeaders {
    return this.cabeceras().set('Content-Type', 'application/json');
  }

  // ── Validacion (stateless) ────────────────────────────────────────────

  /**
   * `POST /Incapacidades/v2/validar`.
   *
   * Motor de reglas SIN persistencia: se puede llamar en cada cambio del
   * formulario. Devuelve dias, responsable de pago, traslapes, soportes
   * exigidos y alertas.
   */
  validar(req: ValidarIncapacidadRequest): Observable<ValidacionResponse> {
    return this.http.post<ValidacionResponse>(`${this.base}/validar`, req, {
      headers: this.cabecerasJson(),
    });
  }

  // ── CRUD ──────────────────────────────────────────────────────────────

  /** `POST /Incapacidades/v2` -> 201. */
  crear(req: CrearIncapacidadV2Request): Observable<IncapacidadV2> {
    return this.http.post<IncapacidadV2>(this.base, req, {
      headers: this.cabecerasJson(),
    });
  }

  /** `PUT /Incapacidades/v2/{id}`. */
  actualizar(id: number, req: CrearIncapacidadV2Request): Observable<IncapacidadV2> {
    return this.http.put<IncapacidadV2>(`${this.base}/${id}`, req, {
      headers: this.cabecerasJson(),
    });
  }

  /** `GET /Incapacidades/v2/{id}`. */
  obtener(id: number): Observable<IncapacidadV2> {
    return this.http.get<IncapacidadV2>(`${this.base}/${id}`, {
      headers: this.cabeceras(),
    });
  }

  /** `DELETE /Incapacidades/v2/{id}` -> 204. */
  eliminar(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`, {
      headers: this.cabeceras(),
    });
  }

  /**
   * `POST /Incapacidades/v2/{id}/validar` — promueve la incapacidad a VALIDADA.
   *
   * Contrato: `200` = promovida; `409` = bloqueada, con
   * `{ motivosBloqueo: string[] }` en el cuerpo.
   *
   * El 409 NO se propaga como error porque es una respuesta de negocio
   * esperada: se normaliza a `{ ok: false, motivosBloqueo }`. Cualquier
   * otro codigo (401, 404, 500...) SI se propaga.
   */
  promoverAValidada(id: number): Observable<ResultadoPromocion> {
    return this.http
      .post<IncapacidadV2 | null>(`${this.base}/${id}/validar`, {}, {
        headers: this.cabecerasJson(),
      })
      .pipe(
        map((resp): ResultadoPromocion => ({
          ok: true,
          motivosBloqueo: [],
          incapacidad: resp ?? undefined,
        })),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 409) {
            return of<ResultadoPromocion>({
              ok: false,
              motivosBloqueo: this.extraerMotivosBloqueo(error),
            });
          }
          return throwError(() => error);
        }),
      );
  }

  /** Lee `motivosBloqueo` del cuerpo del 409 tolerando cuerpo string o nulo. */
  private extraerMotivosBloqueo(error: HttpErrorResponse): string[] {
    const cuerpo: unknown = error.error;

    if (cuerpo && typeof cuerpo === 'object') {
      const motivos = (cuerpo as { motivosBloqueo?: unknown }).motivosBloqueo;
      if (Array.isArray(motivos)) {
        return motivos.map((m) => String(m)).filter((m) => m.length > 0);
      }
      const mensaje = (cuerpo as { message?: unknown }).message;
      if (typeof mensaje === 'string' && mensaje) return [mensaje];
    }

    if (typeof cuerpo === 'string' && cuerpo.trim()) {
      // Algunos proxies devuelven el JSON como texto plano.
      try {
        const parseado: unknown = JSON.parse(cuerpo);
        if (parseado && typeof parseado === 'object') {
          const motivos = (parseado as { motivosBloqueo?: unknown }).motivosBloqueo;
          if (Array.isArray(motivos)) return motivos.map((m) => String(m));
        }
      } catch {
        /* no era JSON: se usa el texto tal cual */
      }
      return [cuerpo.trim()];
    }

    return ['La incapacidad no cumple los requisitos para ser validada.'];
  }

  // ── Listado paginado ──────────────────────────────────────────────────

  /**
   * `GET /Incapacidades/v2` -> `Page<IncapacidadResumen>`.
   *
   * @param filtros filtros opcionales; los vacios NO se envian.
   * @param page indice base 0.
   * @param size tamano de pagina.
   * @param sort ordenamiento (`{ campo, direccion }`) o cadena `campo,desc`.
   */
  listar(
    filtros: FiltrosIncapacidadV2 = {},
    page = 0,
    size = 20,
    sort?: OrdenListado | string,
  ): Observable<Page<IncapacidadResumen>> {
    let params = new HttpParams()
      .set('page', String(page))
      .set('size', String(size));

    for (const [clave, valor] of Object.entries(filtros)) {
      if (valor === null || valor === undefined) continue;
      const texto = String(valor).trim();
      if (!texto) continue;
      params = params.set(clave, texto);
    }

    if (sort) {
      const textoSort =
        typeof sort === 'string' ? sort : `${sort.campo},${sort.direccion ?? 'asc'}`;
      if (textoSort.trim()) params = params.set('sort', textoSort.trim());
    }

    return this.http.get<Page<IncapacidadResumen>>(this.base, {
      headers: this.cabeceras(),
      params,
    });
  }

  // ── Catalogos (cacheados en un signal) ────────────────────────────────

  /**
   * `GET /Incapacidades/v2/catalogos`.
   *
   * Se pide UNA sola vez por sesion:
   *  - si ya hay cache, devuelve el valor cacheado sin tocar la red;
   *  - si hay una peticion en vuelo, la comparte (`shareReplay`), asi que
   *    N componentes suscritos a la vez producen UN solo GET.
   *
   * Los errores se propagan (y se limpia la peticion en vuelo para permitir
   * un reintento posterior).
   */
  catalogos(): Observable<CatalogosIncapacidad> {
    const cacheado = this._catalogos();
    if (cacheado) return of(cacheado);

    if (!this.peticionCatalogos$) {
      this._cargandoCatalogos.set(true);
      this.peticionCatalogos$ = this.http
        .get<CatalogosIncapacidad>(`${this.base}/catalogos`, { headers: this.cabeceras() })
        .pipe(
          tap((resp) => this._catalogos.set(resp)),
          catchError((error: unknown) => {
            // Se libera la peticion fallida para poder reintentar.
            this.peticionCatalogos$ = null;
            return throwError(() => error);
          }),
          finalize(() => this._cargandoCatalogos.set(false)),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }

    return this.peticionCatalogos$;
  }

  /** Descarta la cache de catalogos (util tras un cambio administrativo). */
  invalidarCatalogos(): void {
    this._catalogos.set(null);
    this.peticionCatalogos$ = null;
  }

  /**
   * `GET /Incapacidades/v2/eps-matriz`.
   *
   * Lista CERRADA de EPS de la matriz oficial de cartera, con la forma de
   * cargue que exige cada una al radicar (un solo PDF o PDF por documento).
   * Misma politica de cache que los catalogos: una peticion por sesion,
   * compartida entre suscriptores, con reintento posible tras un error.
   */
  epsMatriz(): Observable<EpsMatrizItem[]> {
    const cacheada = this._epsMatriz();
    if (cacheada) return of(cacheada);

    if (!this.peticionEpsMatriz$) {
      this.peticionEpsMatriz$ = this.http
        .get<EpsMatrizItem[]>(`${this.base}/eps-matriz`, { headers: this.cabeceras() })
        .pipe(
          tap((resp) => this._epsMatriz.set(resp ?? [])),
          catchError((error: unknown) => {
            // Se libera la peticion fallida para poder reintentar.
            this.peticionEpsMatriz$ = null;
            return throwError(() => error);
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }

    return this.peticionEpsMatriz$;
  }

  // ── Radicacion (V44) ──────────────────────────────────────────────────

  /** `GET /Incapacidades/v2/{id}/radicacion` — estado completo + archivos generados. */
  obtenerRadicacion(id: number): Observable<RadicacionIncapacidad> {
    return this.http.get<RadicacionIncapacidad>(`${this.base}/${id}/radicacion`, {
      headers: this.cabeceras(),
    });
  }

  /** `POST /{id}/pendiente-radicacion` — genera el paquete de PDF y clasifica. 409 = motivo. */
  pasarAPendienteRadicacion(id: number): Observable<RadicacionIncapacidad> {
    return this.http.post<RadicacionIncapacidad>(
      `${this.base}/${id}/pendiente-radicacion`,
      this.cuerpoActor(),
      { headers: this.cabecerasJson() },
    );
  }

  /** `POST /{id}/radicacion/regenerar` — rehace los PDF (p. ej. tras cambiar un soporte). */
  regenerarRadicacion(id: number): Observable<RadicacionIncapacidad> {
    return this.http.post<RadicacionIncapacidad>(
      `${this.base}/${id}/radicacion/regenerar`,
      this.cuerpoActor(),
      { headers: this.cabecerasJson() },
    );
  }

  /** `POST /{id}/radicar` — registra el numero de radicado y deja la incapacidad RADICADA. */
  radicar(id: number, peticion: RadicarPeticion): Observable<RadicacionIncapacidad> {
    return this.http.post<RadicacionIncapacidad>(
      `${this.base}/${id}/radicar`,
      { ...this.cuerpoActor(), ...peticion },
      { headers: this.cabecerasJson() },
    );
  }

  /**
   * `GET /{id}/radicacion/archivos/{archivoId}/descargar` — el PDF con su nombre EXACTO,
   * como Blob (la descarga lleva el token: un `<a href>` plano no lo llevaria).
   */
  descargarArchivoRadicacion(id: number, archivoId: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/radicacion/archivos/${archivoId}/descargar`, {
      headers: this.cabeceras(),
      responseType: 'blob',
    });
  }

  /** `POST /radicados/carga-masiva` — radica en lote (.xlsx/.csv) y devuelve fila a fila. */
  cargaMasivaRadicados(archivo: File): Observable<ResultadoCargaMasivaRadicados> {
    const cuerpo = new FormData();
    cuerpo.append('file', archivo, archivo.name);
    const actor = this.cuerpoActor();
    if (actor.actor) cuerpo.append('actor', actor.actor);
    if (actor.actorRol) cuerpo.append('actorRol', actor.actorRol);
    return this.http.post<ResultadoCargaMasivaRadicados>(
      `${this.base}/radicados/carga-masiva`,
      cuerpo,
      { headers: this.cabeceras() },
    );
  }

  // ── Exportaciones masivas asincronas (V44) ────────────────────────────

  /** `POST /exports` — crea y encola el trabajo (202). Se sondea con `estadoExport`. */
  crearExport(tipo: TipoExportJob, filtros: FiltrosIncapacidadV2 = {}): Observable<ExportJob> {
    return this.http.post<ExportJob>(
      `${this.base}/exports`,
      { tipo, filtros, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  /** `GET /exports/{id}` — estado y progreso del trabajo. */
  estadoExport(id: string): Observable<ExportJob> {
    return this.http.get<ExportJob>(`${this.base}/exports/${id}`, {
      headers: this.cabeceras(),
    });
  }

  /** `GET /exports/{id}/descargar` — el resultado (ZIP o XLSX) como Blob autenticado. */
  descargarExport(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/exports/${id}/descargar`, {
      headers: this.cabeceras(),
      responseType: 'blob',
    });
  }

  // ── Resumen e informes (V44) ──────────────────────────────────────────

  /** `GET /resumen` — los conteos de la cabecera en UNA llamada, con los mismos filtros. */
  resumen(filtros: FiltrosIncapacidadV2 = {}): Observable<ResumenIncapacidades> {
    let params = new HttpParams();
    for (const [clave, valor] of Object.entries(filtros)) {
      if (valor === null || valor === undefined) continue;
      const texto = String(valor).trim();
      if (!texto) continue;
      params = params.set(clave, texto);
    }
    return this.http.get<ResumenIncapacidades>(`${this.base}/resumen`, {
      headers: this.cabeceras(),
      params,
    });
  }

  /** `GET /informes/proximos-umbral` — personas proximas a (o sobre) 180/540 dias. */
  proximosUmbral(margen = 30): Observable<InformeUmbral> {
    const params = new HttpParams().set('margen', String(margen));
    return this.http.get<InformeUmbral>(`${this.base}/informes/proximos-umbral`, {
      headers: this.cabeceras(),
      params,
    });
  }

  /**
   * Actor para la bitacora: hoy el gateway no inyecta X-User-*, asi que el nombre viaja en
   * el cuerpo (mismo respaldo que usa el registro). Lee el usuario de localStorage con
   * tolerancia total: sin usuario, la bitacora queda como "anonimo" y nada revienta.
   */
  private cuerpoActor(): { actor?: string; actorRol?: string } {
    try {
      const crudo = getLocalStorageItem('user');
      if (!crudo) return {};
      const usuario = JSON.parse(crudo) as {
        email?: string;
        datos_basicos?: { nombres?: string; apellidos?: string };
        rol?: { nombre?: string };
      };
      const nombre =
        usuario.email ||
        [usuario.datos_basicos?.nombres, usuario.datos_basicos?.apellidos]
          .filter(Boolean)
          .join(' ');
      return {
        actor: nombre || undefined,
        actorRol: usuario.rol?.nombre || undefined,
      };
    } catch {
      return {};
    }
  }

  // ── Endpoints de contratacion reutilizados ────────────────────────────

  /**
   * `GET /contratacion/empleados/buscar?q=&limit=`.
   * Autocomplete de empleados por cedula o nombre.
   */
  buscarEmpleados(q: string, limit = 15): Observable<EmpleadoBusqueda[]> {
    const params = new HttpParams().set('q', q ?? '').set('limit', String(limit));
    return this.http.get<EmpleadoBusqueda[]>(
      `${this.apiUrl}/contratacion/empleados/buscar`,
      { headers: this.cabeceras(), params },
    );
  }

  /**
   * `GET /Incapacidades/v2/empleados/buscar?q=&tipo=&limit=` (reunion 2026-10-05).
   *
   * Con `tipo` (CC, CE, PPT, TI, PA) `q` es el NUMERO de documento: ms-hr lo limpia, quita una
   * X inicial (forzando PPT) y solo devuelve fichas cuyo tipo canonico coincide. Sin `tipo`
   * (null o vacio) se comporta como el buscador de siempre (cedula o nombre). Cada fila trae
   * ademas `tipoDocumentoCanonico`. Si la fecha de ingreso no se pudo leer en el servidor
   * llega null y se cae a su texto crudo, como la entregaba el buscador de contratacion.
   */
  buscarEmpleadosPorDocumento(
    q: string,
    tipo: string | null,
    limit = 15,
  ): Observable<EmpleadoBusqueda[]> {
    let params = new HttpParams().set('q', q ?? '').set('limit', String(limit));
    if (tipo && tipo.trim()) params = params.set('tipo', tipo.trim());
    return this.http
      .get<EmpleadoBusqueda[]>(`${this.base}/empleados/buscar`, {
        headers: this.cabeceras(),
        params,
      })
      .pipe(
        map((filas) =>
          (filas ?? []).map((e) =>
            e.fechaIngreso ? e : { ...e, fechaIngreso: e.fechaIngresoTexto ?? '' },
          ),
        ),
      );
  }

  /**
   * `GET /contratacion/datosIncapacidadContratacion/{cedula}`.
   * Trae `datos_basicos`, `contratacion` y `afp` para autocompletar el
   * formulario. OJO con los avisos del modelo: `afp.afp` (no `afc`),
   * `fecha_nacimiento` en dos formatos, EPS con espacios finales.
   */
  datosContratacion(cedula: string): Observable<DatosContratacionResponse> {
    return this.http.get<DatosContratacionResponse>(
      `${this.apiUrl}/contratacion/datosIncapacidadContratacion/${encodeURIComponent(cedula)}`,
      { headers: this.cabeceras() },
    );
  }

  /** `GET /Incapacidades/codigos-diagnostico/search?q=&limit=` (CIE-10). */
  buscarCodigosDiagnostico(q: string, limit = 20): Observable<CodigoDiagnostico[]> {
    const params = new HttpParams().set('q', q ?? '').set('limit', String(limit));
    return this.http.get<CodigoDiagnostico[]>(
      `${this.apiUrl}/Incapacidades/codigos-diagnostico/search`,
      { headers: this.cabeceras(), params },
    );
  }

  /** `GET /Incapacidades/ips/search?q=&limit=`. */
  buscarIps(q: string, limit = 20): Observable<IpsBusqueda[]> {
    const params = new HttpParams().set('q', q ?? '').set('limit', String(limit));
    return this.http.get<IpsBusqueda[]>(`${this.apiUrl}/Incapacidades/ips/search`, {
      headers: this.cabeceras(),
      params,
    });
  }

  // ── Soportes (multipart anclado en la incapacidad v2) ─────────────────

  /**
   * `POST /Incapacidades/v2/{id}/soportes` -> 201 `SoporteIncapacidad`.
   *
   * Sustituye al multipart LEGACY (`/Incapacidades/{consec}/documentos/upload`),
   * que resolvia el consecutivo contra `tabla_formulario_incapacidades` y por
   * eso respondia 404 "Formulario no encontrado" para toda incapacidad creada
   * con el modelo nuevo.
   *
   * Contrato del multipart: `file` (binario) + `tipoSoporte` (nombre del enum).
   * NO se pone `Content-Type` a mano: el navegador debe generar el boundary.
   *
   * Hay UN soporte por (incapacidad, tipo): repetir el tipo REEMPLAZA el
   * vinculo anterior. Cada subida hace que el servidor recalcule
   * `soportesCargados` desde las filas reales, asi que conviene releer la
   * incapacidad (`obtener`) despues de subir.
   *
   * Errores esperados: `400` (tipo invalido, archivo vacio, mas de 10 MB o
   * mime distinto de PDF/JPG/PNG) y `404` (incapacidad inexistente o inactiva).
   * Se propagan tal cual: los traduce la vista.
   *
   * @param incapacidadId id NUMERICO de la incapacidad v2 (no el codigoUnico).
   * @param tipoSoporte tipo de soporte de la v2.
   * @param file archivo a subir.
   */
  subirSoporte(
    incapacidadId: number,
    tipoSoporte: TipoSoporte,
    file: File,
  ): Observable<SoporteIncapacidad> {
    if (!Number.isFinite(incapacidadId) || incapacidadId <= 0) {
      return throwError(
        () => new Error('No se puede subir el soporte: la incapacidad no tiene id.'),
      );
    }

    const cuerpo = new FormData();
    cuerpo.append('file', file, file.name);
    cuerpo.append('tipoSoporte', tipoSoporte);

    return this.http.post<SoporteIncapacidad>(
      `${this.base}/${incapacidadId}/soportes`,
      cuerpo,
      { headers: this.cabeceras() },
    );
  }

  /**
   * `GET /Incapacidades/v2/{id}/soportes` -> `{ incapacidadId, soportes }`.
   * Es el estado REAL del servidor, no lo que el formulario cree tener.
   */
  listarSoportes(incapacidadId: number): Observable<ListaSoportesResponse> {
    return this.http.get<ListaSoportesResponse>(
      `${this.base}/${incapacidadId}/soportes`,
      { headers: this.cabeceras() },
    );
  }

  /**
   * `DELETE /Incapacidades/v2/{id}/soportes/{tipoSoporte}` -> 204.
   * Tambien recalcula `soportesCargados` en el servidor.
   */
  eliminarSoporte(incapacidadId: number, tipoSoporte: TipoSoporte): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/${incapacidadId}/soportes/${encodeURIComponent(tipoSoporte)}`,
      { headers: this.cabeceras() },
    );
  }

  /**
   * Resuelve la URL absoluta de un documento devuelto por el backend, que
   * puede venir relativa (`/media/...`).
   */
  urlAbsolutaDocumento(rutaRelativa: string | null | undefined): string {
    if (!rutaRelativa) return '';
    if (/^https?:\/\//i.test(rutaRelativa)) return rutaRelativa;
    const base = (this.apiUrl || '').replace(/\/+$/, '');
    const ruta = rutaRelativa.startsWith('/') ? rutaRelativa : `/${rutaRelativa}`;
    return base + ruta;
  }

  /**
   * Baja un documento de la gestion documental como Blob AUTENTICADO. El gateway
   * exige JWT en `/api/v1/documents/**`, asi que un `<a href>` plano (navegacion
   * del navegador, sin header Authorization) responde 401: toda descarga o vista
   * previa de soportes debe pasar por aqui.
   */
  descargarDocumento(fileUrl: string): Observable<Blob> {
    return this.http.get(this.urlAbsolutaDocumento(fileUrl), {
      headers: this.cabeceras(),
      responseType: 'blob',
    });
  }
}

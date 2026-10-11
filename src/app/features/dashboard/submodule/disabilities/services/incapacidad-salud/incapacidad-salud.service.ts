import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import { getLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import type { Page } from '../../models/incapacidad-v2.model';
import type {
  ActualizarEquivalenciaRequest,
  AsignarRadicadoRequest,
  CargaLiquidacion,
  CargaLiquidacionDetalle,
  CausalNegacion,
  CausalNegacionRequest,
  CausalSinHomologar,
  CrearEquivalenciaRequest,
  EquivalenciaCausal,
  FilaLiquidacion,
  FiltrosNegaciones,
  FiltrosPagos,
  FiltrosPendientesRadicacion,
  FiltrosRecobro,
  IncapacidadRef,
  LiquidacionIncapacidad,
  ModoBusquedaRadicacion,
  NegacionItem,
  PagoItem,
  PaginaPagos,
  RadicadoItem,
  RecobroItem,
  ResultadoAplicacion,
  ResultadoAsignacionRadicado,
  ResultadoBusquedaCodigos,
  ResultadoEquivalencia,
  TipoRadicado,
} from '../../models/incapacidad-salud.model';

/**
 * Servicio de los modulos de Salud de la reunion funcional 2026-10-05: Radicacion, Recobro y
 * Liquidacion (Pagos y Negaciones). SEVENET y "Base actual" van por los jobs de exportacion de
 * `IncapacidadV2Service` (crearExport / estadoExport / descargarExport).
 *
 * Mismos principios que `IncapacidadV2Service`: no se traga errores (la vista decide como
 * mostrarlos) y el actor viaja en el cuerpo como respaldo (el backend prefiere el JWT).
 */
@Injectable({ providedIn: 'root' })
export class IncapacidadSaludService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/Incapacidades/v2`;

  // ── Cabeceras y actor ─────────────────────────────────────────────────

  private cabeceras(): HttpHeaders {
    const token = getLocalStorageItem('token');
    return token ? new HttpHeaders().set('Authorization', token) : new HttpHeaders();
  }

  private cabecerasJson(): HttpHeaders {
    return this.cabeceras().set('Content-Type', 'application/json');
  }

  /** Mismo criterio que `IncapacidadV2Service.cuerpoActor()`: tolerante a todo. */
  cuerpoActor(): { actor?: string; actorRol?: string } {
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
        [usuario.datos_basicos?.nombres, usuario.datos_basicos?.apellidos].filter(Boolean).join(' ');
      return { actor: nombre || undefined, actorRol: usuario.rol?.nombre || undefined };
    } catch {
      return {};
    }
  }

  private paginacion(pagina: number, tamano: number): HttpParams {
    return new HttpParams().set('pagina', String(pagina)).set('tamano', String(tamano));
  }

  private conFiltros(params: HttpParams, filtros: object): HttpParams {
    let p = params;
    for (const [clave, valor] of Object.entries(filtros)) {
      if (valor === undefined || valor === null || valor === '') continue;
      p = p.set(clave, String(valor));
    }
    return p;
  }

  // ── Radicacion ────────────────────────────────────────────────────────

  /** `POST /radicacion/buscar` — resuelve codigos (general u oficina) y dice si se pueden radicar. */
  buscarCodigos(codigos: string[], modo: ModoBusquedaRadicacion = 'RADICACION'): Observable<ResultadoBusquedaCodigos> {
    return this.http.post<ResultadoBusquedaCodigos>(
      `${this.base}/radicacion/buscar`,
      { codigos, modo },
      { headers: this.cabecerasJson() },
    );
  }

  /** `POST /radicacion/asignar` — un mismo radicado para una o varias incapacidades. */
  asignarRadicado(req: Omit<AsignarRadicadoRequest, 'actor' | 'actorRol'>): Observable<ResultadoAsignacionRadicado> {
    return this.http.post<ResultadoAsignacionRadicado>(
      `${this.base}/radicacion/asignar`,
      { ...req, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  /** `GET /radicacion/pendientes` — validadas sin radicar. */
  pendientesRadicacion(filtros: FiltrosPendientesRadicacion, pagina = 0, tamano = 20): Observable<Page<IncapacidadRef>> {
    return this.http.get<Page<IncapacidadRef>>(`${this.base}/radicacion/pendientes`, {
      headers: this.cabeceras(),
      params: this.conFiltros(this.paginacion(pagina, tamano), filtros),
    });
  }

  /** `GET /radicacion/historial` — ultimos radicados registrados en el modulo. */
  historialRadicados(tipo: TipoRadicado, q = '', pagina = 0, tamano = 20): Observable<Page<RadicadoItem>> {
    return this.http.get<Page<RadicadoItem>>(`${this.base}/radicacion/historial`, {
      headers: this.cabeceras(),
      params: this.conFiltros(this.paginacion(pagina, tamano), { tipo, q }),
    });
  }

  /** `GET /{id}/radicados` — todos los radicados de una incapacidad (inicial + recobros). */
  radicadosDe(incapacidadId: number): Observable<RadicadoItem[]> {
    return this.http.get<RadicadoItem[]>(`${this.base}/${incapacidadId}/radicados`, {
      headers: this.cabeceras(),
    });
  }

  /** `POST /radicados/{id}/anular` — solo recobros. */
  anularRadicado(radicadoId: number, motivo?: string): Observable<RadicadoItem> {
    return this.http.post<RadicadoItem>(
      `${this.base}/radicados/${radicadoId}/anular`,
      { motivo: motivo ?? null, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  // ── Recobro ───────────────────────────────────────────────────────────

  /** `GET /recobros` — incapacidades negadas que hay que recobrar. */
  recobros(filtros: FiltrosRecobro, pagina = 0, tamano = 20): Observable<Page<RecobroItem>> {
    return this.http.get<Page<RecobroItem>>(`${this.base}/recobros`, {
      headers: this.cabeceras(),
      params: this.conFiltros(this.paginacion(pagina, tamano), filtros),
    });
  }

  /** `POST /recobros` — radicado de recobro para una o varias incapacidades. */
  registrarRecobro(req: Omit<AsignarRadicadoRequest, 'actor' | 'actorRol'>): Observable<ResultadoAsignacionRadicado> {
    return this.http.post<ResultadoAsignacionRadicado>(
      `${this.base}/recobros`,
      { ...req, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  // ── Liquidacion: plantilla y cargas ───────────────────────────────────

  /** `GET /liquidacion/plantilla` — Excel con hojas Pagos y Negaciones. */
  descargarPlantillaLiquidacion(): Observable<Blob> {
    return this.http.get(`${this.base}/liquidacion/plantilla`, {
      headers: this.cabeceras(),
      responseType: 'blob',
    });
  }

  /** `POST /liquidacion/cargas/simular` — lee la plantilla y cruza SIN aplicar. */
  simularCarga(archivo: File): Observable<CargaLiquidacionDetalle> {
    const cuerpo = new FormData();
    cuerpo.append('file', archivo, archivo.name);
    const actor = this.cuerpoActor();
    if (actor.actor) cuerpo.append('actor', actor.actor);
    if (actor.actorRol) cuerpo.append('actorRol', actor.actorRol);
    return this.http.post<CargaLiquidacionDetalle>(`${this.base}/liquidacion/cargas/simular`, cuerpo, {
      headers: this.cabeceras(),
    });
  }

  /** Asigna a mano una fila que no cruzo (o `null` para soltarla). */
  asignarFila(cargaId: number, filaId: number, incapacidadId: number | null): Observable<FilaLiquidacion> {
    return this.http.post<FilaLiquidacion>(
      `${this.base}/liquidacion/cargas/${cargaId}/filas/${filaId}/asignar`,
      { incapacidadId, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  /** Homologa a mano la causal de una fila de Negaciones (opcionalmente la recuerda). */
  asignarCausalFila(
    cargaId: number,
    filaId: number,
    causalId: number,
    recordarEquivalencia: boolean,
  ): Observable<FilaLiquidacion> {
    return this.http.post<FilaLiquidacion>(
      `${this.base}/liquidacion/cargas/${cargaId}/filas/${filaId}/causal`,
      { causalId, recordarEquivalencia, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  aplicarCarga(cargaId: number): Observable<ResultadoAplicacion> {
    return this.http.post<ResultadoAplicacion>(
      `${this.base}/liquidacion/cargas/${cargaId}/aplicar`,
      { ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  descartarCarga(cargaId: number): Observable<CargaLiquidacion> {
    return this.http.post<CargaLiquidacion>(
      `${this.base}/liquidacion/cargas/${cargaId}/descartar`,
      { ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  anularCarga(cargaId: number): Observable<CargaLiquidacion> {
    return this.http.post<CargaLiquidacion>(
      `${this.base}/liquidacion/cargas/${cargaId}/anular`,
      { ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  cargas(pagina = 0, tamano = 20): Observable<Page<CargaLiquidacion>> {
    return this.http.get<Page<CargaLiquidacion>>(`${this.base}/liquidacion/cargas`, {
      headers: this.cabeceras(),
      params: this.paginacion(pagina, tamano),
    });
  }

  detalleCarga(cargaId: number): Observable<CargaLiquidacionDetalle> {
    return this.http.get<CargaLiquidacionDetalle>(`${this.base}/liquidacion/cargas/${cargaId}`, {
      headers: this.cabeceras(),
    });
  }

  // ── Liquidacion: pagos y negaciones ───────────────────────────────────

  pagos(filtros: FiltrosPagos, pagina = 0, tamano = 20): Observable<PaginaPagos> {
    return this.http.get<PaginaPagos>(`${this.base}/liquidacion/pagos`, {
      headers: this.cabeceras(),
      params: this.conFiltros(this.paginacion(pagina, tamano), filtros),
    });
  }

  anularPago(id: number, motivo?: string): Observable<PagoItem> {
    return this.http.post<PagoItem>(
      `${this.base}/liquidacion/pagos/${id}/anular`,
      { motivo: motivo ?? null, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  negaciones(filtros: FiltrosNegaciones, pagina = 0, tamano = 20): Observable<Page<NegacionItem>> {
    return this.http.get<Page<NegacionItem>>(`${this.base}/liquidacion/negaciones`, {
      headers: this.cabeceras(),
      params: this.conFiltros(this.paginacion(pagina, tamano), filtros),
    });
  }

  anularNegacion(id: number, motivo?: string): Observable<NegacionItem> {
    return this.http.post<NegacionItem>(
      `${this.base}/liquidacion/negaciones/${id}/anular`,
      { motivo: motivo ?? null, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  /** `GET /{id}/liquidacion` — pagos y negaciones de una incapacidad (detalle). */
  liquidacionDe(incapacidadId: number): Observable<LiquidacionIncapacidad> {
    return this.http.get<LiquidacionIncapacidad>(`${this.base}/${incapacidadId}/liquidacion`, {
      headers: this.cabeceras(),
    });
  }

  // ── Causales y equivalencias ──────────────────────────────────────────

  causales(incluirInactivas = false): Observable<CausalNegacion[]> {
    return this.http.get<CausalNegacion[]>(`${this.base}/liquidacion/causales`, {
      headers: this.cabeceras(),
      params: new HttpParams().set('incluirInactivas', String(incluirInactivas)),
    });
  }

  crearCausal(req: CausalNegacionRequest): Observable<CausalNegacion> {
    return this.http.post<CausalNegacion>(
      `${this.base}/liquidacion/causales`,
      { ...req, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  actualizarCausal(id: number, req: CausalNegacionRequest): Observable<CausalNegacion> {
    return this.http.put<CausalNegacion>(
      `${this.base}/liquidacion/causales/${id}`,
      { ...req, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  equivalencias(): Observable<EquivalenciaCausal[]> {
    return this.http.get<EquivalenciaCausal[]>(`${this.base}/liquidacion/equivalencias`, {
      headers: this.cabeceras(),
    });
  }

  crearEquivalencia(req: CrearEquivalenciaRequest): Observable<ResultadoEquivalencia> {
    return this.http.post<ResultadoEquivalencia>(
      `${this.base}/liquidacion/equivalencias`,
      { ...req, ...this.cuerpoActor() },
      { headers: this.cabecerasJson() },
    );
  }

  actualizarEquivalencia(id: number, req: ActualizarEquivalenciaRequest): Observable<EquivalenciaCausal> {
    return this.http.put<EquivalenciaCausal>(`${this.base}/liquidacion/equivalencias/${id}`, req, {
      headers: this.cabecerasJson(),
    });
  }

  eliminarEquivalencia(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/liquidacion/equivalencias/${id}`, {
      headers: this.cabeceras(),
    });
  }

  causalesSinHomologar(): Observable<CausalSinHomologar[]> {
    return this.http.get<CausalSinHomologar[]>(`${this.base}/liquidacion/causales/sin-homologar`, {
      headers: this.cabeceras(),
    });
  }
}

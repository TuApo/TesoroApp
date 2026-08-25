import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@/environments/environment';
import { Observable, BehaviorSubject, combineLatest, of } from 'rxjs';
import { map, shareReplay, switchMap, catchError, debounceTime, distinctUntilChanged, finalize } from 'rxjs/operators';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;

import {
  AfiliacionesDateRange,
  AfiliacionesKpiSummary,
  ContratacionRow,
  ContratacionesPage,
  ResumenPorOficina,
  ResumenPorEmpresa,
  TimelinePoint
} from '../models/afiliaciones-dashboard.models';

export type TimelineDim = 'oficina' | 'empresa' | 'usuario_responsable';

/**
 * Anclaje del rango de fechas del tablero. 'firma' es el que manda: es la fecha real de
 * firma del contrato. 'registro' (created_at) queda disponible pero NO es un dato de
 * negocio — cada recarga masiva lo mueve en bloque.
 */
export type BaseFecha = 'firma' | 'ingreso' | 'registro';

export const BASE_FECHA_LABEL: Record<BaseFecha, string> = {
  firma: 'Fecha de firma de contrato',
  ingreso: 'Fecha de ingreso',
  registro: 'Fecha de registro'
};

/** Dimensiones/etiquetas de un grupo tal como llegan del backend (código sin traducir). */
interface GrupoApi { clave: string; total: number; contratados: number; pendientes: number; }
interface ResumenApi { kpis: AfiliacionesKpiSummary; porOficina: GrupoApi[]; porEmpresa: GrupoApi[]; }

const EMPTY_KPIS: AfiliacionesKpiSummary = {
  totalIngresos: 0, ingresosHoy: 0, totalEmpresas: 0,
  totalOficinas: 0, totalContratados: 0, totalPendientes: 0
};

/**
 * Fuente del dashboard de Afiliaciones.
 *
 * IMPORTANTE (fix jul-2026): los KPIs, la serie temporal y los resúmenes se piden ya
 * AGREGADOS al backend (/gestion_afiliaciones/contratos/resumen y /timeline), calculados
 * en SQL sobre TODO el conjunto filtrado. Antes se traían hasta 5.000 filas y se agregaban
 * en el cliente; con rangos amplios (p.ej. desde 1-ene) las 5.000 filas más recientes se las
 * comía el bloque masivo de abril y los meses viejos "desaparecían" del tablero. La tabla
 * consolidada se pagina server-side (/contratos con page/size).
 *
 * ANCLAJE del rango (ago-2026): por defecto la FECHA DE FIRMA DEL CONTRATO. Antes se anclaba
 * en registrado_at (created_at), que es un dato de la carga y no del negocio: la recarga del
 * 09/08 dejó 14.794 contratos con created_at de ese día, y el tablero los mostraba a todos
 * como "registrados hoy". El anclaje es UNO para todo (KPIs, resúmenes, catálogos y tabla),
 * así que las cifras de arriba y el detalle de abajo cuentan siempre el mismo conjunto.
 */
@Injectable({
  providedIn: 'root'
})
export class AfiliacionesDashboardService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/gestion_afiliaciones`;

  // ── Estado de filtros ───────────────────────────────────────────────────────
  // Rango por defecto = este mes (para que el tablero cargue con datos).
  private dateRangeSubject = new BehaviorSubject<AfiliacionesDateRange>({
    start: moment().startOf('month').toDate(),
    end: moment().endOf('day').toDate()
  });
  public dateRange$ = this.dateRangeSubject.asObservable();

  private searchSubject = new BehaviorSubject<string>('');
  // Debounce para no disparar una tanda de peticiones por cada tecla.
  public search$ = this.searchSubject.pipe(debounceTime(300), distinctUntilChanged());

  private empresaSubject = new BehaviorSubject<string>('');
  public empresa$ = this.empresaSubject.asObservable();

  private oficinaSubject = new BehaviorSubject<string>('');
  public oficina$ = this.oficinaSubject.asObservable();

  private responsableSubject = new BehaviorSubject<string>('');
  public responsable$ = this.responsableSubject.asObservable();

  private soloActivosSubject = new BehaviorSubject<boolean>(true);
  public soloActivos$ = this.soloActivosSubject.asObservable();

  private granSubject = new BehaviorSubject<'mes' | 'dia'>('mes');
  public gran$ = this.granSubject.asObservable();

  // Paginación de la tabla (server-side). page$ es la fuente única del estado del
  // paginador, para que al cambiar filtros la tabla vuelva a la primera página.
  private pageSubject = new BehaviorSubject<{ page: number; size: number }>({ page: 0, size: 50 });
  public page$ = this.pageSubject.asObservable();

  // Anclaje del rango. Gobierna TODO el tablero (KPIs, resúmenes, catálogos y tabla), por eso
  // entra en filters$: si sólo afectara a la tabla, las tarjetas de arriba contarían un
  // conjunto distinto al del detalle de abajo.
  private baseFechaSubject = new BehaviorSubject<BaseFecha>('firma');
  public baseFecha$ = this.baseFechaSubject.asObservable();

  // Conjunto de filtros combinado → parámetros de consulta.
  private filters$ = combineLatest([
    this.dateRange$, this.soloActivos$, this.empresa$, this.oficina$, this.responsable$,
    this.search$, this.baseFecha$, this.gran$
  ]).pipe(
    map(([range, soloActivos, empresa, oficina, responsable, search, base, gran]) =>
      ({ range, soloActivos, empresa, oficina, responsable, search, base, gran })),
    shareReplay(1)
  );

  private toParams(f: any): HttpParams {
    let p = new HttpParams()
      .set('desde', moment(f.range.start).format('YYYY-MM-DD'))
      .set('hasta', moment(f.range.end).format('YYYY-MM-DD'))
      .set('solo_activos', String(f.soloActivos))
      .set('base', f.base);
    if (f.empresa) p = p.set('empresa', f.empresa);
    if (f.oficina) p = p.set('oficina', f.oficina);
    if (f.responsable) p = p.set('responsable', f.responsable);
    const term = (f.search || '').trim();
    if (term) p = p.set('q', term);
    return p;
  }

  // ──────────────────────────────────────────────
  // Resumen agregado (KPIs + por oficina + por empresa)
  // ──────────────────────────────────────────────
  /**
   * Indicadores de carga por bloque. Las tarjetas del tablero tenían `[loading]="false"`
   * fijo: durante los segundos que tarda la agregación en SQL el usuario veía tarjetas
   * vacías, sin forma de distinguir "cargando" de "no hay datos".
   *
   * Se marcan ANTES de lanzar la petición (dentro del switchMap, no en un tap previo)
   * para que un cambio de filtro que cancela la petición en vuelo deje el flag en true
   * y lo baje la nueva, sin parpadeo intermedio.
   */
  private cargandoResumenSubject = new BehaviorSubject<boolean>(true);
  public cargandoResumen$ = this.cargandoResumenSubject.asObservable();

  private cargandoTablaSubject = new BehaviorSubject<boolean>(true);
  public cargandoTabla$ = this.cargandoTablaSubject.asObservable();

  private resumen$: Observable<ResumenApi> = this.filters$.pipe(
    switchMap(f => {
      this.cargandoResumenSubject.next(true);
      return this.http.get<ResumenApi>(`${this.apiUrl}/contratos/resumen`, { params: this.toParams(f) }).pipe(
        catchError(() => of({ kpis: EMPTY_KPIS, porOficina: [], porEmpresa: [] } as ResumenApi)),
        finalize(() => this.cargandoResumenSubject.next(false))
      );
    }),
    shareReplay(1)
  );

  public kpiSummary$: Observable<AfiliacionesKpiSummary> =
    this.resumen$.pipe(map(r => r.kpis || EMPTY_KPIS));

  public resumenPorOficina$: Observable<ResumenPorOficina[]> = this.resumen$.pipe(
    map(r => (r.porOficina || []).map(g => ({
      oficina: g.clave, total: g.total, contratados: g.contratados, pendientes: g.pendientes
    })))
  );

  public resumenPorEmpresa$: Observable<ResumenPorEmpresa[]> = this.resumen$.pipe(
    map(r => (r.porEmpresa || []).map(g => ({
      empresa: this.empresaLabel(g.clave), total: g.total, contratados: g.contratados, pendientes: g.pendientes
    })))
  );

  // ──────────────────────────────────────────────
  // Serie temporal — gráficas "Evolución de Contrataciones" y "por Responsable"
  // ──────────────────────────────────────────────
  // Por MES y por el anclaje elegido (firma por defecto). Con una fecha real de negocio los
  // lotes masivos se reparten en sus meses verdaderos en vez de amontonarse en el día de la
  // carga. Usa una ventana histórica PROPIA (2023→hoy) e IGNORA el rango de fechas de arriba
  // (que controla KPIs/tabla); sí respeta empresa/oficina/responsable/búsqueda.
  private chartFilters$ = combineLatest([
    this.soloActivos$, this.empresa$, this.oficina$, this.responsable$, this.search$,
    this.baseFecha$, this.gran$, this.dateRange$
  ]).pipe(
    map(([soloActivos, empresa, oficina, responsable, search, base, gran, range]) =>
      ({ soloActivos, empresa, oficina, responsable, search, base, gran, range })),
    shareReplay(1)
  );

  // Ventana histórica de la gráfica (por fecha de ingreso). 2023→hoy = ~99,9% de los datos;
  // acota de paso las pocas fechas basura (2017/2018/2028) fuera de rango.
  private readonly CHART_DESDE = '2023-01-01';

  /** Un flag por dimensión: las dos gráficas del tablero cargan de forma independiente. */
  private cargandoTimeline = new Map<TimelineDim, BehaviorSubject<boolean>>();

  public cargandoTimeline$(dim: TimelineDim): Observable<boolean> {
    return this.flagTimeline(dim).asObservable();
  }

  private flagTimeline(dim: TimelineDim): BehaviorSubject<boolean> {
    let s = this.cargandoTimeline.get(dim);
    if (!s) {
      s = new BehaviorSubject<boolean>(true);
      this.cargandoTimeline.set(dim, s);
    }
    return s;
  }

  public getTimeline(dim: TimelineDim): Observable<TimelinePoint[]> {
    return this.chartFilters$.pipe(
      switchMap(f => {
        this.flagTimeline(dim).next(true);
        // Por mes: ventana histórica fija (2023→hoy) sin importar el rango del filtro.
        // Por día: usa el rango seleccionado en los filtros de arriba (más útil para rangos cortos).
        const isDia = f.gran === 'dia';
        const desde = isDia ? moment(f.range.start).format('YYYY-MM-DD') : this.CHART_DESDE;
        const hasta = isDia ? moment(f.range.end).format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');
        let params = new HttpParams()
          .set('dim', dim)
          .set('base', f.base)
          .set('gran', f.gran)
          .set('desde', desde)
          .set('hasta', hasta)
          .set('solo_activos', String(f.soloActivos));
        if (f.empresa) params = params.set('empresa', f.empresa);
        if (f.oficina) params = params.set('oficina', f.oficina);
        if (f.responsable) params = params.set('responsable', f.responsable);
        const term = (f.search || '').trim();
        if (term) params = params.set('q', term);
        return this.http.get<TimelinePoint[]>(`${this.apiUrl}/contratos/timeline`, { params }).pipe(
          // La dimensión 'empresa' llega como código (APOYO_LABORAL/TU_ALIANZA/SIN_EMPRESA);
          // la traducimos a etiqueta legible para la leyenda de la gráfica.
          map(points => dim === 'empresa'
            ? (points || []).map(p => ({ ...p, label: this.empresaLabel(p.label) }))
            : (points || [])),
          catchError(() => of([] as TimelinePoint[])),
          finalize(() => this.flagTimeline(dim).next(false))
        );
      }),
      shareReplay(1)
    );
  }

  // ──────────────────────────────────────────────
  // Catálogos para los selectores: dependen del rango + solo-activos Y de los filtros
  // empresa/oficina activos, para que las OPCIONES de los selectores también estén
  // conectadas a los filtros (elegir empresa acota las oficinas; empresa+oficina acota
  // los responsables).
  // ──────────────────────────────────────────────
  private catalogos$ = combineLatest([
    this.dateRange$, this.soloActivos$, this.empresa$, this.oficina$, this.baseFecha$
  ]).pipe(
    switchMap(([range, soloActivos, empresa, oficina, base]) => {
      let params = new HttpParams()
        .set('desde', moment(range.start).format('YYYY-MM-DD'))
        .set('hasta', moment(range.end).format('YYYY-MM-DD'))
        .set('solo_activos', String(soloActivos))
        .set('base', base);
      if (empresa) params = params.set('empresa', empresa);
      if (oficina) params = params.set('oficina', oficina);
      return this.http.get<{ oficinas: string[]; responsables: string[] }>(
        `${this.apiUrl}/contratos/catalogos`, { params }).pipe(
        catchError(() => of({ oficinas: [] as string[], responsables: [] as string[] }))
      );
    }),
    shareReplay(1)
  );

  public oficinasDisponibles$: Observable<string[]> = this.catalogos$.pipe(map(c => c.oficinas || []));
  public responsablesDisponibles$: Observable<string[]> = this.catalogos$.pipe(map(c => c.responsables || []));

  // ──────────────────────────────────────────────
  // Tabla consolidada (paginada server-side)
  // ──────────────────────────────────────────────
  public tablePage$: Observable<ContratacionesPage> = combineLatest([this.filters$, this.pageSubject]).pipe(
    switchMap(([f, pg]) => {
      this.cargandoTablaSubject.next(true);
      // 'base' ya viaja dentro de toParams(): es el mismo anclaje que usan KPIs y resúmenes.
      const params = this.toParams(f)
        .set('page', String(pg.page))
        .set('size', String(pg.size));
      return this.http.get<any>(`${this.apiUrl}/contratos`, { params }).pipe(
        map(res => ({
          rows: (res?.results || []).map((r: any) => this.mapRow(r)),
          total: res?.total || 0
        } as ContratacionesPage)),
        catchError(() => of({ rows: [], total: 0 } as ContratacionesPage)),
        finalize(() => this.cargandoTablaSubject.next(false))
      );
    }),
    shareReplay(1)
  );

  // ──────────────────────────────────────────────
  // Acciones
  // ──────────────────────────────────────────────
  /** Cambiar cualquier filtro reinicia la tabla a la primera página. */
  private resetPage(): void {
    this.pageSubject.next({ page: 0, size: this.pageSubject.value.size });
  }

  public updateDateRange(start: Date, end: Date): void {
    this.dateRangeSubject.next({
      start: moment(start).startOf('day').toDate(),
      end: moment(end).endOf('day').toDate()
    });
    this.resetPage();
  }

  public updateSearch(term: string): void {
    this.searchSubject.next(term);
    this.resetPage();
  }

  /** '' = Todas | 'APOYO_LABORAL' | 'TU_ALIANZA'. */
  public updateEmpresa(empresa: string): void {
    this.empresaSubject.next(empresa || '');
    this.resetPage();
  }

  /** '' = Todas | '<nombre exacto de la oficina>'. */
  public updateOficina(oficina: string): void {
    this.oficinaSubject.next(oficina || '');
    this.resetPage();
  }

  /** '' = Todos | '<usuario responsable exacto>'. */
  public updateResponsable(responsable: string): void {
    this.responsableSubject.next(responsable || '');
    this.resetPage();
  }

  public updateSoloActivos(value: boolean): void {
    this.soloActivosSubject.next(value);
    this.resetPage();
  }

  /** Cambio de página/tamaño desde el paginador de la tabla. */
  public setPage(page: number, size: number): void {
    this.pageSubject.next({ page, size });
  }

  /** Granularidad de las gráficas temporales: 'mes' (histórico) | 'dia' (usa el rango de arriba). */
  public updateGran(gran: 'mes' | 'dia'): void {
    this.granSubject.next(gran);
  }

  /** Anclaje del rango de TODO el tablero: 'firma' (por defecto) | 'ingreso' | 'registro'. */
  public updateBaseFecha(base: BaseFecha): void {
    this.baseFechaSubject.next(
      base === 'ingreso' || base === 'registro' ? base : 'firma');
    this.resetPage();
  }

  // ──────────────────────────────────────────────
  // Helpers de mapeo de fila (tabla)
  // ──────────────────────────────────────────────
  // ms-hr serializa en camelCase; LocalDate como array [y,m,d] o string; Instant como ISO/epoch.
  private mapRow(r: any): ContratacionRow {
    return {
      id: r.procesoId,
      candidato_id: r.candidatoId,
      numero_documento: r.cedula || '',
      primer_nombre: r.primerNombre || '',
      segundo_nombre: r.segundoNombre || '',
      primer_apellido: r.primerApellido || '',
      segundo_apellido: r.segundoApellido || '',
      nombre_completo: r.nombreCompleto || `${r.primerNombre || ''} ${r.primerApellido || ''}`.trim(),
      empresa: this.empresaLabel(r.empresa),
      oficina: r.oficina || 'Sin Oficina',
      finca: r.finca || r.centroCosto || '',
      cargo: r.cargo || '',
      fecha_firma_contrato: this.toIsoDate(r.fechaFirmaContrato),
      fecha_ingreso: this.toIsoDate(r.fechaIngreso),
      estado: this.calcularEstado(r),
      usuario_responsable: r.responsable || '',
      contratado_at: this.toIso(r.contratadoAt),
      ingreso_at: this.toIso(r.ingresoAt),
      examenes_medicos_at: this.toIso(r.examenesMedicosAt),
      autorizado_at: this.toIso(r.autorizadoAt),
      centro_costo: r.centroCosto || '',
      // extras
      codigo_contrato: r.codigoContrato,
      registrado_at: this.toIso(r.registradoAt),
      activo: r.activo,
      estado_afiliacion: r.estadoAfiliacion,
      ingreso_confirmado: !!r.ingresoConfirmado,
      ingreso_confirmado_canal: r.ingresoConfirmadoCanal,
      coord_confirmado: !!r.coordConfirmado,
      nomina_confirmado: !!r.nominaConfirmado,
      pago_confirmado: !!r.pagoConfirmado,
      arl_estado: r.arlEstado,
      tipo_documento: r.tipoDocumento,
      sexo: r.sexo,
      fecha_nacimiento: this.toIsoDate(r.fechaNacimiento),
      direccion: r.direccion,
      barrio: r.barrio,
      municipio: r.municipio,
      departamento: r.departamento,
      eps: r.eps,
      afp: r.afp,
      caja_compensacion: r.cajaCompensacion,
      correo: r.correo,
      celular: r.celular,
      whatsapp: r.whatsapp,
      salario: r.salario,
      adres_estado: r.adresEstado,
      adres_eps: r.adresEps,
      adres_fecha: this.toIso(r.adresFecha)
    };
  }

  /** LocalDate llega como [y,m,d] (o string). Devuelve 'YYYY-MM-DD' o ''. */
  private toIsoDate(v: any): string {
    if (!v) return '';
    if (Array.isArray(v) && v.length >= 3) {
      const [y, m, d] = v;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return String(v);
  }

  /** Instant llega como ISO string o epoch-segundos. Devuelve ISO string o ''. */
  private toIso(v: any): string {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return this.toIsoDate(v);
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (typeof v === 'number' && !isNaN(n)) {
      const ms = n < 1e12 ? Math.round(n * 1000) : n; // segundos → ms
      return new Date(ms).toISOString();
    }
    return String(v);
  }

  private empresaLabel(e: string | null | undefined): string {
    if (e === 'APOYO_LABORAL') return 'Apoyo Laboral';
    if (e === 'TU_ALIANZA') return 'Tu Alianza';
    return 'Sin Empresa';
  }

  /** Estado del pipeline de contratación (informativo en la tabla). */
  private calcularEstado(r: any): string {
    if (r.rechazadoAt || r.rechazadoFlag) return 'Rechazado';
    if (r.ingresoFlag || r.ingresoAt) return 'Ingreso';
    if (r.contratadoAt) return 'Contratado';
    if (r.examenesMedicosAt) return 'Exámenes Médicos';
    if (r.autorizadoAt) return 'En Proceso';
    return 'Pendiente';
  }
}

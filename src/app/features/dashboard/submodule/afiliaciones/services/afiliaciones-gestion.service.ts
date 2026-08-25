import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@/environments/environment';
import { Observable, BehaviorSubject, combineLatest, of, from } from 'rxjs';
import {
  map, shareReplay, switchMap, catchError, debounceTime, distinctUntilChanged, startWith,
  mergeMap, toArray
} from 'rxjs/operators';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;

import {
  AfiliacionesDateRange,
  ContratacionRow,
  ContratacionesPage,
  CasoDetalle,
  CedulaDoc,
  MasivoResult,
  Validador,
  Canal,
  Expediente,
  DocumentoExpediente,
  ResumenPersona,
  EmpresaUsuariaOpcion
} from '../models/afiliaciones-dashboard.models';

/**
 * Servicio OPERATIVO de la página "Gestión de Afiliaciones" (confirmación de ingreso).
 *
 * Distinto del dashboard (que es analítico): aquí el foco es el CONTROL diario del personal
 * cuya fecha de ingreso ya llegó — filtro `listo` (gate: fecha_ingreso ≤ hoy y sin confirmar
 * el Validador 1) activado por defecto — con acciones individuales y MASIVAS sobre los 4
 * validadores (afiliaciones / coordinador de finca / nómina / pago de seguridad social)
 * por canal (llamada/correo/whatsapp).
 *
 * Estado propio (no comparte filtros con el dashboard). La tabla se pagina server-side y se
 * refresca tras cada mutación vía refreshSubject.
 */
/**
 * Anclaje del rango de fechas de ESTA pantalla.
 *  'ingreso'  fecha de ingreso (por defecto: la pantalla gira alrededor de ella).
 *  'firma'    fecha de contratación = COALESCE(fecha_contrato, fecha_contratacion_form).
 *  'registro' created_at — dato de CARGA, no de negocio: cada recarga masiva lo mueve en bloque.
 */
export type BaseFechaGestion = 'ingreso' | 'firma' | 'registro';

/** Respuesta de /contratos/catalogos. */
interface CatalogosResp {
  oficinas: string[];
  responsables: string[];
  empresasUsuarias: EmpresaUsuariaOpcion[];
}

@Injectable({ providedIn: 'root' })
export class AfiliacionesGestionService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/gestion_afiliaciones`;
  private base = environment.apiUrl;   // raíz del gateway (para descargar documentos)

  // ── Estado de filtros ──────────────────────────────────────────────
  private dateRangeSubject = new BehaviorSubject<AfiliacionesDateRange>({
    start: moment().startOf('month').toDate(),
    end: moment().endOf('day').toDate()
  });
  dateRange$ = this.dateRangeSubject.asObservable();

  private searchSubject = new BehaviorSubject<string>('');
  search$ = this.searchSubject.pipe(debounceTime(300), distinctUntilChanged());

  private empresaSubject = new BehaviorSubject<string>('');
  empresa$ = this.empresaSubject.asObservable();
  /** Empresa USUARIA (cliente). Se manda la clave normalizada que devuelve el catálogo. */
  private empresaUsuariaSubject = new BehaviorSubject<string>('');
  empresaUsuaria$ = this.empresaUsuariaSubject.asObservable();
  private oficinaSubject = new BehaviorSubject<string>('');
  oficina$ = this.oficinaSubject.asObservable();
  private responsableSubject = new BehaviorSubject<string>('');
  responsable$ = this.responsableSubject.asObservable();
  private soloActivosSubject = new BehaviorSubject<boolean>(true);
  soloActivos$ = this.soloActivosSubject.asObservable();

  // Gate: solo "listos para confirmar" (fecha_ingreso ≤ hoy y Validador 1 pendiente). ON por defecto.
  private soloListosSubject = new BehaviorSubject<boolean>(true);
  soloListos$ = this.soloListosSubject.asObservable();

  // Base de fecha del rango: 'ingreso' por defecto (esta pantalla gira alrededor de la fecha
  // de ingreso), con opción a 'firma' (fecha de contratación) o 'registro' (dato de carga).
  private baseFechaSubject = new BehaviorSubject<BaseFechaGestion>('ingreso');
  baseFecha$ = this.baseFechaSubject.asObservable();

  private pageSubject = new BehaviorSubject<{ page: number; size: number }>({ page: 0, size: 50 });
  page$ = this.pageSubject.asObservable();

  // Se emite tras cada mutación para re-consultar la tabla.
  private refreshSubject = new BehaviorSubject<number>(0);

  private filters$ = combineLatest([
    this.dateRange$, this.soloActivos$, this.empresa$, this.oficina$, this.responsable$,
    this.search$, this.soloListos$, this.baseFecha$, this.empresaUsuaria$
  ]).pipe(
    map(([range, soloActivos, empresa, oficina, responsable, search, listo, base, empresaUsuaria]) =>
      ({ range, soloActivos, empresa, oficina, responsable, search, listo, base, empresaUsuaria })),
    shareReplay(1)
  );

  private toParams(f: any): HttpParams {
    let p = new HttpParams()
      .set('desde', moment(f.range.start).format('YYYY-MM-DD'))
      .set('hasta', moment(f.range.end).format('YYYY-MM-DD'))
      .set('solo_activos', String(f.soloActivos))
      .set('base', f.base)
      .set('listo', String(f.listo));
    if (f.empresa) p = p.set('empresa', f.empresa);
    if (f.empresaUsuaria) p = p.set('empresa_usuaria', f.empresaUsuaria);
    if (f.oficina) p = p.set('oficina', f.oficina);
    if (f.responsable) p = p.set('responsable', f.responsable);
    const term = (f.search || '').trim();
    if (term) p = p.set('q', term);
    return p;
  }

  // ── Catálogos para los selectores ──────────────────────────────────
  private catalogos$ = combineLatest([
    this.dateRange$, this.soloActivos$, this.empresa$, this.oficina$, this.baseFecha$,
    this.empresaUsuaria$
  ]).pipe(
    switchMap(([range, soloActivos, empresa, oficina, base, empresaUsuaria]) => {
      // 'base' explícito: el default del endpoint es 'firma' (el del tablero) y esta
      // pantalla gira alrededor de la fecha de ingreso.
      let params = new HttpParams()
        .set('desde', moment(range.start).format('YYYY-MM-DD'))
        .set('hasta', moment(range.end).format('YYYY-MM-DD'))
        .set('solo_activos', String(soloActivos))
        .set('base', base);
      if (empresa) params = params.set('empresa', empresa);
      if (empresaUsuaria) params = params.set('empresa_usuaria', empresaUsuaria);
      if (oficina) params = params.set('oficina', oficina);
      return this.http.get<CatalogosResp>(
        `${this.apiUrl}/contratos/catalogos`, { params }).pipe(
        catchError(() => of({ oficinas: [], responsables: [], empresasUsuarias: [] } as CatalogosResp))
      );
    }),
    shareReplay(1)
  );
  oficinasDisponibles$: Observable<string[]> = this.catalogos$.pipe(map(c => c.oficinas || []));
  responsablesDisponibles$: Observable<string[]> = this.catalogos$.pipe(map(c => c.responsables || []));
  /** Empresas usuarias disponibles: clave (para filtrar) + etiqueta legible + cuántos hay. */
  empresasUsuariasDisponibles$: Observable<EmpresaUsuariaOpcion[]> =
    this.catalogos$.pipe(map(c => c.empresasUsuarias || []));

  // ── Tabla (paginada server-side, se refresca tras mutaciones) ──────
  tablePage$: Observable<ContratacionesPage> = combineLatest([
    this.filters$, this.pageSubject, this.refreshSubject
  ]).pipe(
    switchMap(([f, pg]) => {
      const params = this.toParams(f).set('page', String(pg.page)).set('size', String(pg.size));
      return this.http.get<any>(`${this.apiUrl}/contratos`, { params }).pipe(
        map(res => ({
          rows: (res?.results || []).map((r: any) => this.mapRow(r)),
          total: res?.total || 0
        } as ContratacionesPage)),
        // Los badges del expediente (cuántas cédulas/ADRES/traslados tiene cada persona y en
        // qué va su traslado) se piden APARTE, en una sola llamada por página, y se emiten
        // como una segunda emisión: la tabla se pinta de inmediato y se enriquece después.
        switchMap(page => this.conResumen(page)),
        catchError(() => of({ rows: [], total: 0 } as ContratacionesPage))
      );
    }),
    startWith({ rows: [], total: 0 } as ContratacionesPage),
    shareReplay(1)
  );

  // ── Acciones de filtro ─────────────────────────────────────────────
  private resetPage(): void { this.pageSubject.next({ page: 0, size: this.pageSubject.value.size }); }

  updateDateRange(start: Date, end: Date): void {
    this.dateRangeSubject.next({
      start: moment(start).startOf('day').toDate(),
      end: moment(end).endOf('day').toDate()
    });
    this.resetPage();
  }
  updateSearch(term: string): void { this.searchSubject.next(term); this.resetPage(); }
  updateEmpresa(v: string): void { this.empresaSubject.next(v || ''); this.resetPage(); }
  updateEmpresaUsuaria(v: string): void { this.empresaUsuariaSubject.next(v || ''); this.resetPage(); }
  updateOficina(v: string): void { this.oficinaSubject.next(v || ''); this.resetPage(); }
  updateResponsable(v: string): void { this.responsableSubject.next(v || ''); this.resetPage(); }
  updateSoloActivos(v: boolean): void { this.soloActivosSubject.next(v); this.resetPage(); }
  updateSoloListos(v: boolean): void { this.soloListosSubject.next(v); this.resetPage(); }
  updateBaseFecha(base: BaseFechaGestion): void {
    const b: BaseFechaGestion = (base === 'registro' || base === 'firma') ? base : 'ingreso';
    this.baseFechaSubject.next(b); this.resetPage();
  }
  setPage(page: number, size: number): void { this.pageSubject.next({ page, size }); }
  refresh(): void { this.refreshSubject.next(this.refreshSubject.value + 1); }

  // ── Detalle / cédula ───────────────────────────────────────────────
  getCaso(candidatoId: number): Observable<CasoDetalle> {
    return this.http.get<any>(`${this.apiUrl}/casos/${candidatoId}`).pipe(
      map(r => ({
        candidato_id: r.candidatoId,
        contrato: r.contrato || null,
        caso: r.caso || null,
        intentos: (r.intentos || []).map((i: any) => this.mapIntento(i))
      } as CasoDetalle)),
      catchError(() => of({ candidato_id: candidatoId, contrato: null, caso: null, intentos: [] } as CasoDetalle))
    );
  }

  /**
   * Fila COMPLETA de la vista para un candidato, con la misma forma que las filas de la tabla.
   * `/casos/{id}` devuelve la entidad `AfiliacionContratoView` cruda, así que se reusa el mismo
   * mapeo — de ahí que sirva para alimentar el PDF con gente que no está en la página visible.
   */
  getContratoRow(candidatoId: number): Observable<ContratacionRow | null> {
    return this.http.get<any>(`${this.apiUrl}/casos/${candidatoId}`).pipe(
      map(r => (r?.contrato ? this.mapRow(r.contrato) : null)),
      catchError(() => of(null))
    );
  }

  /** Máximo de filas que se resuelven de a una contra el backend (tope del PDF masivo). */
  static readonly MAX_FILAS_PDF = 500;

  /**
   * Resuelve las filas completas de una lista de candidatos.
   *
   * Las que ya están en pantalla se reusan tal cual (`conocidas`) y solo se piden al servidor las
   * que faltan — la selección sobrevive al cambio de página, así que casi siempre falta alguna.
   * Se piden de a 6 en paralelo: son N llamadas y el gateway no agradece 300 de golpe.
   *
   * Devuelve las filas EN EL ORDEN pedido, sin las que no se pudieron resolver.
   */
  cargarFilas(ids: number[], conocidas?: Map<number, ContratacionRow>): Observable<ContratacionRow[]> {
    const unicos = Array.from(new Set(ids.filter(id => id != null)));
    const faltantes = unicos.filter(id => !conocidas?.has(id));
    if (!faltantes.length) {
      return of(unicos.map(id => conocidas!.get(id)!).filter(Boolean));
    }
    return from(faltantes).pipe(
      mergeMap(id => this.getContratoRow(id).pipe(map(row => ({ id, row }))), 6),
      toArray(),
      map(res => {
        const traidas = new Map<number, ContratacionRow>();
        res.forEach(({ id, row }) => { if (row) traidas.set(id, row); });
        return unicos
          .map(id => conocidas?.get(id) || traidas.get(id))
          .filter((r): r is ContratacionRow => !!r);
      })
    );
  }

  getCedula(candidatoId: number): Observable<CedulaDoc> {
    return this.http.get<any>(`${this.apiUrl}/casos/${candidatoId}/cedula`).pipe(
      map(r => ({
        found: !!r.found, cedula: r.cedula, owner_id: r.ownerId, documentos: r.documentos || []
      } as CedulaDoc)),
      catchError(() => of({ found: false, documentos: [] } as CedulaDoc))
    );
  }

  // ── Expediente (documentos + ADRES + traslados) ─────────────────────

  /**
   * Expediente completo de la persona: documentos de cédula / ADRES / solicitud de traslado,
   * los datos crudos que el robot leyó en ADRES y sus traslados de EPS con estado.
   */
  getExpediente(candidatoId: number, maxPorGrupo?: number): Observable<Expediente> {
    let params = new HttpParams();
    if (maxPorGrupo) params = params.set('max_por_grupo', String(maxPorGrupo));
    return this.http.get<any>(`${this.apiUrl}/casos/${candidatoId}/expediente`, { params }).pipe(
      map(r => this.mapExpediente(candidatoId, r)),
      catchError(() => of(this.expedienteVacio(candidatoId)))
    );
  }

  /**
   * Resumen del expediente para un lote de cédulas (los badges de la tabla).
   * Devuelve un mapa cédula → resumen para que la fila lo resuelva sin buscar en un array.
   */
  resumenMasivo(cedulas: string[]): Observable<Map<string, ResumenPersona>> {
    const limpias = Array.from(new Set((cedulas || []).map(c => (c || '').trim()).filter(Boolean)));
    if (!limpias.length) return of(new Map<string, ResumenPersona>());
    return this.http.post<any[]>(`${this.apiUrl}/expediente/resumen-masivo`, { cedulas: limpias }).pipe(
      map(rows => {
        const out = new Map<string, ResumenPersona>();
        (rows || []).forEach(r => {
          const res: ResumenPersona = {
            cedula: r.cedula,
            docs_cedula: r.docsCedula || 0,
            docs_adres: r.docsAdres || 0,
            docs_traslado: r.docsTraslado || 0,
            traslado_codigo: r.trasladoCodigo ?? null,
            traslado_estado: r.trasladoEstado ?? null,
            traslado_eps_a_trasladar: r.trasladoEpsATrasladar ?? null,
            traslado_solicitado_en: this.toIso(r.trasladoSolicitadoEn) || null,
            traslados_total: r.trasladosTotal || 0
          };
          if (res.cedula) out.set(res.cedula, res);
        });
        return out;
      }),
      catchError(() => of(new Map<string, ResumenPersona>()))
    );
  }

  /**
   * Emite la página tal cual y, cuando llegan los conteos, la vuelve a emitir con el resumen
   * pegado a cada fila. Si el resumen falla, la tabla se queda como está (sin badges).
   */
  private conResumen(page: ContratacionesPage): Observable<ContratacionesPage> {
    const cedulas = page.rows.map(r => r.numero_documento).filter(Boolean);
    if (!cedulas.length) return of(page);
    return this.resumenMasivo(cedulas).pipe(
      map(resumenes => ({
        total: page.total,
        rows: page.rows.map(r => ({ ...r, resumen: resumenes.get(r.numero_documento) }))
      } as ContratacionesPage)),
      startWith(page)
    );
  }

  /** Último ADRES reportado por el robot (documento tipo ADRES de la persona). */
  getAdres(candidatoId: number): Observable<CedulaDoc> {
    return this.http.get<any>(`${this.apiUrl}/casos/${candidatoId}/adres`).pipe(
      map(r => ({
        found: !!r.found, cedula: r.cedula, owner_id: r.ownerId, documentos: r.documentos || []
      } as CedulaDoc)),
      catchError(() => of({ found: false, documentos: [] } as CedulaDoc))
    );
  }

  /**
   * Descarga el binario de un documento (vía gateway, con el token de la app).
   *
   * `versionId` es obligatorio en la práctica: sin él ms-documents sirve la versión `is_current`,
   * que NO siempre es la última subida (el robot guarda versiones nuevas sin marcarlas vigentes).
   * Pasando el versionId que devolvió /cedula|/adres el archivo abierto coincide con la metadata.
   */
  descargarDocumento(documentId: number, versionId?: number | null): Observable<Blob> {
    const qs = versionId == null ? '' : `?versionId=${versionId}`;
    return this.http.get(`${this.base}/api/v1/documents/${documentId}/download${qs}`, { responseType: 'blob' });
  }

  // ── Mutaciones individuales ────────────────────────────────────────
  confirmar(candidatoId: number, validador: Validador, canal: Canal, nota?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/casos/${candidatoId}/confirmar/${validador.toLowerCase()}`,
      { canal, nota: nota || null });
  }
  registrarIntento(candidatoId: number, validador: Validador, canal: Canal, resultado: string, nota?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/casos/${candidatoId}/intento-contacto`,
      { validador, canal, resultado, nota: nota || null });
  }

  // ── Mutaciones MASIVAS ─────────────────────────────────────────────
  confirmarMasivo(candidatoIds: number[], validador: Validador, canal: Canal, nota?: string): Observable<MasivoResult> {
    return this.http.post<any>(`${this.apiUrl}/casos/confirmar-masivo`,
      { candidatoIds, validador, canal, nota: nota || null }).pipe(map(r => this.mapMasivo(r)));
  }
  registrarIntentoMasivo(candidatoIds: number[], validador: Validador, canal: Canal, resultado: string, nota?: string): Observable<MasivoResult> {
    return this.http.post<any>(`${this.apiUrl}/casos/intento-masivo`,
      { candidatoIds, validador, canal, resultado, nota: nota || null }).pipe(map(r => this.mapMasivo(r)));
  }

  // ── Mapeo ──────────────────────────────────────────────────────────
  private mapMasivo(r: any): MasivoResult {
    return { solicitados: r?.solicitados || 0, procesados: r?.procesados || 0, fallidos: r?.fallidos || [] };
  }

  private expedienteVacio(candidatoId: number): Expediente {
    return {
      candidato_id: candidatoId, owners_con_match: [], adres: null,
      traslado_eps_formulario: null, traslados: [], documentos: [], conteos: []
    };
  }

  private mapExpediente(candidatoId: number, r: any): Expediente {
    return {
      candidato_id: r?.candidatoId ?? candidatoId,
      cedula: r?.cedula,
      nombre_completo: r?.nombreCompleto,
      owners_con_match: r?.ownersConMatch || [],
      adres: r?.adres ? {
        cedula: r.adres.cedula,
        tipo_documento: r.adres.tipoDocumento,
        nombre_reportado: r.adres.nombreReportado,
        estado: r.adres.estado,
        entidad: r.adres.entidad,
        regimen: r.adres.regimen,
        tipo_afiliacion: r.adres.tipoAfiliacion,
        fecha_afiliacion_efectiva: r.adres.fechaAfiliacionEfectiva,
        fecha_finalizacion_afiliacion: r.adres.fechaFinalizacionAfiliacion,
        fecha_adres: r.adres.fechaAdres,
        departamento: r.adres.departamento,
        municipio: r.adres.municipio,
        consultado_at: this.toIso(r.adres.consultadoAt)
      } : null,
      traslado_eps_formulario: r?.trasladoEpsFormulario ?? null,
      traslados: (r?.traslados || []).map((t: any) => ({
        codigo: t.codigo,
        cedula: t.cedula,
        eps_a_trasladar: t.epsATrasladar,
        eps_trasladada: t.epsTrasladada,
        estado: t.estado,
        observacion: t.observacion,
        radicado: t.radicado,
        fecha_efectividad: t.fechaEfectividad,
        cantidad_beneficiarios: t.cantidadBeneficiarios,
        responsable: t.responsable,
        asignacion_correo: t.asignacionCorreo,
        solicitado_en: this.toIso(t.solicitadoEn),
        activo: t.activo,
        documento: t.documento ? this.mapDocumento(t.documento) : null
      })),
      documentos: (r?.documentos || []).map((d: any) => this.mapDocumento(d)),
      conteos: (r?.conteos || []).map((c: any) => ({
        grupo: c.grupo, mostrados: c.mostrados, total: c.total
      }))
    };
  }

  private mapDocumento(d: any): DocumentoExpediente {
    return {
      grupo: d.grupo,
      document_id: d.documentId,
      version_id: d.versionId ?? null,
      owner_id: d.ownerId,
      tipo: d.tipo,
      archivo: d.archivo,
      mime: d.mime,
      tamano_bytes: d.tamanoBytes,
      version: d.version,
      vigente: d.vigente,
      subido_en: this.toIso(d.subidoEn),
      registrado_en: this.toIso(d.registradoEn)
    };
  }

  private mapIntento(i: any): any {
    return {
      id: i.id, validador: i.validador, origen: i.origen, canal: i.canal,
      resultado: i.resultado, nota: i.nota, usuario: i.usuario, created_at: this.toIso(i.createdAt)
    };
  }

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
      // Empresa usuaria = el cliente donde trabaja la persona (distinta de la temporal que
      // contrata). Se guardan las tres formas: la legible, el texto crudo del formulario
      // (para el tooltip) y la clave con la que se filtra.
      empresa_usuaria: r.empresaUsuaria || '',
      empresa_usuaria_raw: r.empresaUsuariaRaw || '',
      empresa_usuaria_key: r.empresaUsuariaKey || '',
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
      localidad: r.localidad,
      nacionalidad: r.nacionalidad,
      pais: r.pais,
      departamento_nacimiento: r.departamentoNacimiento,
      municipio_nacimiento: r.municipioNacimiento,
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

  private toIsoDate(v: any): string {
    if (!v) return '';
    if (Array.isArray(v) && v.length >= 3) {
      const [y, m, d] = v;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return String(v);
  }
  private toIso(v: any): string {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return this.toIsoDate(v);
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (typeof v === 'number' && !isNaN(n)) {
      const ms = n < 1e12 ? Math.round(n * 1000) : n;
      return new Date(ms).toISOString();
    }
    return String(v);
  }
  private empresaLabel(e: string | null | undefined): string {
    if (e === 'APOYO_LABORAL') return 'Apoyo Laboral';
    if (e === 'TU_ALIANZA') return 'Tu Alianza';
    return 'Sin Empresa';
  }
  private calcularEstado(r: any): string {
    if (r.rechazadoAt || r.rechazadoFlag) return 'Rechazado';
    if (r.ingresoFlag || r.ingresoAt) return 'Ingreso';
    if (r.contratadoAt) return 'Contratado';
    if (r.examenesMedicosAt) return 'Exámenes Médicos';
    if (r.autorizadoAt) return 'En Proceso';
    return 'Pendiente';
  }
}

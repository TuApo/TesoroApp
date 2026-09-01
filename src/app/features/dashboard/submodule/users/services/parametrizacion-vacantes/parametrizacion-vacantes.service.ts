import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Parametrizacion de CREACION DE VACANTES (ms-auth-admin, db_admin).
 *
 * Sustituye progresivamente a `shared/data/labores-por-mes.data.ts`, que hoy tiene 910
 * lineas de reglas cableadas. Mientras dure la transicion conviven las dos fuentes; el
 * archivo TS NO se retira hasta comprobar paridad (ver la fase de comparacion).
 *
 * ms-auth-admin serializa en SNAKE_CASE (`tuapo.json.snake-case: true` en su
 * application.yml, que gana sobre el LOWER_CAMEL_CASE de shared-config), asi que las
 * interfaces de aqui son los nombres del JSON tal cual.
 */

export type TipoResolucion = 'MES_AREA' | 'MES' | 'MES_DIA' | 'MES_RANGO_DIA' | 'FIJA';
export type TipoLabor = 'FIJA' | 'PARAMETRIZADA';
export type EstadoArea = 'CONFIRMADA' | 'PENDIENTE_PARAMETRIZACION';

export interface AreaOperativa {
  id?: number;
  codigo: string;
  /** null cuando negocio aun no confirmo el nombre oficial (AE, EL, HM, TR). */
  nombre: string | null;
  descripcion?: string | null;
  estado?: EstadoArea;
  activo?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Perfil de vacante: la línea de producto de una vacante ('Rosa', 'Clavel'...).
 *
 * Es el catálogo del campo «Área» del formulario de Crear Vacante. NO confundir con
 * `AreaOperativa`, que es el área con la que se resuelve la LABOR ('CU', 'PO', 'AD'):
 * la publicación las guarda en dos columnas distintas.
 *
 * La clave es el NOMBRE porque la vacante guarda el texto literal, no una referencia.
 * Por eso renombrar no reescribe las vacantes ya publicadas, y desactivar solo lo retira
 * del desplegable.
 */
export interface PerfilVacante {
  id?: number;
  nombre: string;
  descripcion?: string | null;
  /** Orden del desplegable; a igualdad, alfabético. */
  orden?: number;
  activo?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EsquemaLabor {
  id?: number;
  codigo: string;
  nombre: string | null;
  tipo_resolucion: TipoResolucion;
  descripcion?: string | null;
  activo?: boolean;
  /** Cuantas reglas activas tiene. 0 = esquema declarado pero sin datos todavia. */
  reglas_activas?: number;
  /** Configuraciones vivas. Con reglas > 0 y esto en 0 el esquema es INALCANZABLE. */
  configuraciones_activas?: number;
  /** Alcance del dominio vacantes. NO es `activo`: APOYO y BLU siguen activos. */
  habilitado_vacantes?: boolean;
  /** `EXCEL_ACTUAL` o `LEGACY_TS`. */
  origen?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ReglaLabor {
  id?: number;
  esquema_id: number;
  esquema_codigo?: string;
  tipo_resolucion?: TipoResolucion;
  area_id?: number | null;
  area_codigo?: string | null;
  area_nombre?: string | null;
  mes?: number | null;
  dia_desde?: number | null;
  dia_hasta?: number | null;
  codigo_eq?: string | null;
  descripcion_labor: string;
  vigencia_desde?: string | null;
  vigencia_hasta?: string | null;
  prioridad?: number;
  origen?: string;
  activo?: boolean;
}

export interface CargoArea {
  id?: number;
  cargo_id?: number | null;
  cargo_nombre_origen: string;
  esquema_id: number;
  esquema_codigo?: string;
  area_id: number;
  area_codigo?: string;
  area_nombre?: string | null;
  /** false = el cargo no existe en tabla_cargos y hay que conciliarlo. */
  conciliado?: boolean;
  origen?: string;
  activo?: boolean;
}

export interface ConfiguracionCentroCargo {
  id?: number;
  centro_costo_id: number;
  cargo_id?: number | null;
  cargo_nombre_origen: string;
  area_id: number;
  area_codigo?: string;
  area_nombre?: string | null;
  esquema_id: number;
  esquema_codigo?: string;
  tipo_resolucion?: TipoResolucion;
  tipo_labor?: TipoLabor;
  labor_fija_override?: string | null;
  conciliado?: boolean;
  origen?: string;
  activo?: boolean;
}

/**
 * Empresa habilitada para el dominio de VACANTES.
 *
 * OJO: no son las 46 del maestro global. El maestro sigue teniéndolas todas para nómina,
 * contratación e históricos; esto es el ALCANCE del módulo de vacantes.
 * `nombre` y `nit` los resuelve el backend contra ms-payroll — aquí no se guarda copia.
 */
export interface EmpresaVacante {
  id: number;
  empresa_usuaria_ref: number;
  /** Del maestro. null si ms-payroll no respondió o la referencia quedó huérfana. */
  nombre: string | null;
  nit: string | null;
  /** Texto tal cual venía en la hoja de origen. Trazabilidad de la conciliación. */
  nombre_excel: string | null;
  tipo_conciliacion: 'EXACTA' | 'NORMALIZADA' | 'POR_NIT' | 'REQUIERE_REVISION' | 'MANUAL';
  /** Derivada de sus centros de costo. null si no tiene centros registrados. */
  temporal: string | null;
  /** TEMPORAL asignada explícitamente (id de afiliacion_temporal_config). Manda sobre la derivada. */
  temporal_config_ref: number | null;
  activo_vacantes: boolean;
  existe_en_maestro: boolean;
}

/** Centro de costo dentro del dominio VACANTES. */
export interface CentroVacante {
  id: number;
  empresa_usuaria_ref: number;
  /** Razón social de la empresa dueña. Útil al listar varias empresas a la vez. */
  empresa_nombre: string | null;
  finca: string | null;
  ccostos: string | null;
  subcentro: string | null;
  centro_de_costo: string | null;
  ciudad: string | null;
  direccion: string | null;
  temporal: string | null;
  sublabor: string | null;
  salario: number | null;
  auxilio_transporte: boolean | null;
  /** Alcance del dominio vacantes; NO es el estado global del centro. */
  habilitado_vacantes: boolean | null;
  /** Códigos de las áreas permitidas en este centro, ya formateados. */
  areas: string | null;
  configuraciones_activas?: number;
}

/** Conteos autoritativos de la cadena. Vienen del backend, no de listas ya cargadas. */
/** Un área del catálogo frente a un centro concreto. */
export interface CentroArea {
  area_id: number;
  codigo: string;
  nombre: string | null;
  asignada: boolean;
  relacion_id: number | null;
}

/** Cargo del maestro dentro del alcance de VACANTES (los 74 del Excel). */
export interface CargoVacante {
  id: number;
  nombre: string;
  porcentaje_arl: number | null;
  habilitado_vacantes: boolean;
}

export interface ResumenCadena {
  empresas_habilitadas: number;
  centros_habilitados: number;
  areas_activas: number;
  /** Total del catálogo, incluidas las retiradas del alcance. */
  areas_totales: number;
  esquemas_activos: number;
  reglas_activas: number;
  cargo_areas: number;
  configuraciones_activas: number;
  centro_areas: number;
  /** Maestro global de cargos: aún no tiene alcance propio de vacantes. */
  cargos_maestro: number;
  cargos_habilitados: number;
  /**
   * Perfiles de vacante activos. NO gobierna la resolución de la labor: llena el
   * desplegable «Área» del formulario. Va en el resumen porque la cadena lo lista junto
   * a los demás, marcado como catálogo aparte.
   */
  perfiles_vacante_activos: number;
}

/**
 * Cargo AUTORIZADO en un (centro, area) concreto. Sale de una fila de configuracion,
 * no del maestro: que un cargo exista en el maestro no lo habilita en ningun centro.
 */
export interface CargoAutorizado {
  configuracion_id: number;
  cargo_id: number | null;
  cargo_nombre: string;
  area_id: number | null;
  area_codigo: string | null;
  esquema_id: number | null;
  esquema_codigo: string | null;
  /** false = la fila aun no tiene esquema; el resolutor la rechazara. */
  completa: boolean;
  activo: boolean | null;
}

/**
 * Como debe encadenarse el selector de un centro.
 *
 * `trabaja_por_area` sale de los DATOS —de si el centro tiene areas asignadas— y no del
 * nombre de la empresa. Un centro que devuelva false salta el paso de area.
 */
export interface ModoCentro {
  centro_costo_id: number;
  finca: string | null;
  trabaja_por_area: boolean;
}

export interface ResolucionLabor {
  centro_costo_id: number;
  cargo_id: number | null;
  cargo_nombre: string;
  area: { id: number; codigo: string; nombre: string | null } | null;
  esquema: { id: number; codigo: string; nombre: string | null } | null;
  configuracion_id: number | null;
  regla_labor_id: number | null;
  codigo_labor: string | null;
  labor: string;
  tipo_resolucion: TipoResolucion | null;
  /** REGLA_LABOR | OVERRIDE_CONFIGURACION | LABOR_FIJA_CENTRO | FALLBACK_CARGO_AREA */
  origen_resolucion: string;
  mes: number;
  dia: number;
}

@Injectable({ providedIn: 'root' })
export class ParametrizacionVacantesService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl.replace(/\/$/, '')}/api/v1/admin/parametrizacion/vacantes`;

  // ── Empresas habilitadas para vacantes ────────────────────────────────────
  /**
   * `activo` omitido = todo el alcance; `true` = solo habilitadas (lo que debe consumir
   * el selector de Crear Vacante); `false` = solo las excluidas.
   */
  listarEmpresas(activo?: boolean): Observable<EmpresaVacante[]> {
    return this.http.get<EmpresaVacante[]>(`${this.base}/empresas`, { params: this.params({ activo }) });
  }
  habilitarEmpresa(body: { empresaUsuariaRef: number; nombreExcel?: string; tipoConciliacion?: string; activo?: boolean }): Observable<EmpresaVacante> {
    return this.http.post<EmpresaVacante>(`${this.base}/empresas`, body);
  }
  /** Edita el alcance (temporal, nombre de origen). NO toca el maestro. */
  actualizarEmpresa(id: number, body: { temporal_config_ref?: number | null; nombre_excel?: string; tipo_conciliacion?: string }): Observable<EmpresaVacante> {
    return this.http.put<EmpresaVacante>(`${this.base}/empresas/${id}`, body);
  }
  /** Saca la empresa del alcance de vacantes. NO la toca en el maestro. */
  estadoEmpresa(id: number, activo: boolean): Observable<EmpresaVacante> {
    return this.http.patch<EmpresaVacante>(`${this.base}/empresas/${id}/estado`, {}, { params: this.params({ activo }) });
  }

  /** Conteos de los 8 eslabones para la pestaña «Cadena de configuración». */
  resumenCadena(): Observable<ResumenCadena> {
    return this.http.get<ResumenCadena>(`${this.base}/resumen`);
  }

  /**
   * Catálogo de cargos del alcance de VACANTES (los 74), NO el maestro de 206.
   * Distinto de `cargosDeCentro`: aquel devuelve los autorizados en un centro+área.
   */
  cargosHabilitados(incluirNoHabilitados = false): Observable<CargoVacante[]> {
    return this.http.get<CargoVacante[]>(`${this.base}/cargos`,
      { params: this.params({ incluirNoHabilitados }) });
  }
  /** Alta de un cargo. Nace ya dentro del alcance de vacantes. */
  crearCargo(body: { nombre: string; porcentaje_arl?: number | null }): Observable<CargoVacante> {
    return this.http.post<CargoVacante>(`${this.base}/cargos`, body);
  }
  /**
   * Edita nombre y ARL. El renombrado conserva el id del cargo, así que lo que apunta a él
   * por id no se rompe; los snapshots ya emitidos (publicaciones, contratos) NO se reescriben.
   */
  actualizarCargo(id: number, body: { nombre: string; porcentaje_arl?: number | null }): Observable<CargoVacante> {
    return this.http.put<CargoVacante>(`${this.base}/cargos/${id}`, body);
  }
  /** Habilita/saca el cargo del alcance de vacantes. No lo toca en el maestro global. */
  estadoCargo(id: number, habilitado: boolean): Observable<CargoVacante> {
    return this.http.patch<CargoVacante>(`${this.base}/cargos/${id}/estado`, {},
      { params: this.params({ habilitado }) });
  }

  // ── Centros de costo por empresa ──────────────────────────────────────────
  /**
   * Centros de UNA empresa. El filtro lo hace el backend por `empresa_usuaria_ref`;
   * Angular nunca compara nombres de empresa.
   */
  listarCentros(refs: number | number[], incluirNoHabilitados = false): Observable<CentroVacante[]> {
    // El backend acepta una lista; un solo id sigue funcionando igual.
    const lista = Array.isArray(refs) ? refs : [refs];
    return this.http.get<CentroVacante[]>(`${this.base}/centros`,
      { params: this.params({ empresaUsuariaRef: lista.join(','), incluirNoHabilitados }) });
  }
  crearCentro(body: Partial<CentroVacante>): Observable<CentroVacante> {
    return this.http.post<CentroVacante>(`${this.base}/centros`, body);
  }
  actualizarCentro(id: number, body: Partial<CentroVacante>): Observable<CentroVacante> {
    return this.http.put<CentroVacante>(`${this.base}/centros/${id}`, body);
  }
  /** Áreas del catálogo frente a un centro, marcando cuáles tiene permitidas. */
  areasDeCentro(centroId: number): Observable<CentroArea[]> {
    return this.http.get<CentroArea[]>(`${this.base}/centros/${centroId}/areas`);
  }
  /** Fija EXACTAMENTE las áreas del centro; las que salen se dan de baja lógica. */
  fijarAreasDeCentro(centroId: number, areaIds: number[]): Observable<CentroArea[]> {
    return this.http.put<CentroArea[]>(`${this.base}/centros/${centroId}/areas`, { area_ids: areaIds });
  }

  /**
   * Cargos autorizados en (centro, area). Ultimo eslabon de la cascada de Crear Vacante.
   * Sin `areaId` devuelve los de las configuraciones sin area (centros que no trabajan
   * por area).
   */
  cargosDeCentro(centroId: number, areaId?: number): Observable<CargoAutorizado[]> {
    return this.http.get<CargoAutorizado[]>(`${this.base}/centros/${centroId}/cargos`,
      { params: this.params({ areaId }) });
  }

  /** Si el centro encadena por area o va directo a cargo. Lo deciden los datos. */
  modoDeCentro(centroId: number): Observable<ModoCentro> {
    return this.http.get<ModoCentro>(`${this.base}/centros/${centroId}/modo`);
  }

  /** Habilita/saca el centro del selector de vacantes. No lo toca en otros módulos. */
  estadoCentro(id: number, habilitado: boolean): Observable<CentroVacante> {
    return this.http.patch<CentroVacante>(`${this.base}/centros/${id}/estado`, {},
      { params: this.params({ habilitado }) });
  }

  // ── Perfiles de flor (catálogo del campo «Área» de la vacante) ────────────
  /**
   * `activo` omitido = todo el catálogo (para administrarlo); `true` = solo los vivos,
   * que es lo que debe consumir el desplegable de Crear Vacante.
   */
  listarPerfilesVacante(activo?: boolean): Observable<PerfilVacante[]> {
    return this.http.get<PerfilVacante[]>(`${this.base}/perfiles-vacante`, { params: this.params({ activo }) });
  }
  crearPerfilVacante(body: Partial<PerfilVacante>): Observable<PerfilVacante> {
    return this.http.post<PerfilVacante>(`${this.base}/perfiles-vacante`, body);
  }
  actualizarPerfilVacante(id: number, body: Partial<PerfilVacante>): Observable<PerfilVacante> {
    return this.http.put<PerfilVacante>(`${this.base}/perfiles-vacante/${id}`, body);
  }
  estadoPerfilVacante(id: number, activo: boolean): Observable<PerfilVacante> {
    return this.http.patch<PerfilVacante>(`${this.base}/perfiles-vacante/${id}/estado`, {},
      { params: this.params({ activo }) });
  }

  // ── Areas operativas ──────────────────────────────────────────────────────
  listarAreas(activo?: boolean): Observable<AreaOperativa[]> {
    return this.http.get<AreaOperativa[]>(`${this.base}/areas`, { params: this.params({ activo }) });
  }
  crearArea(body: Partial<AreaOperativa>): Observable<AreaOperativa> {
    return this.http.post<AreaOperativa>(`${this.base}/areas`, body);
  }
  actualizarArea(id: number, body: Partial<AreaOperativa>): Observable<AreaOperativa> {
    return this.http.put<AreaOperativa>(`${this.base}/areas/${id}`, body);
  }
  estadoArea(id: number, activo: boolean): Observable<AreaOperativa> {
    return this.http.patch<AreaOperativa>(`${this.base}/areas/${id}/estado`, {}, { params: this.params({ activo }) });
  }

  // ── Esquemas de labor ─────────────────────────────────────────────────────
  /**
   * Por defecto SOLO los del Excel actual (ALIANZA, HMVE, JARDINES).
   * `incluirLegacy` añade APOYO y BLU, que existen pero están fuera del flujo nuevo.
   */
  listarEsquemas(activo?: boolean, incluirLegacy = false): Observable<EsquemaLabor[]> {
    return this.http.get<EsquemaLabor[]>(`${this.base}/esquemas`,
      { params: this.params({ activo, incluirLegacy }) });
  }
  crearEsquema(body: Partial<EsquemaLabor>): Observable<EsquemaLabor> {
    return this.http.post<EsquemaLabor>(`${this.base}/esquemas`, body);
  }
  actualizarEsquema(id: number, body: Partial<EsquemaLabor>): Observable<EsquemaLabor> {
    return this.http.put<EsquemaLabor>(`${this.base}/esquemas/${id}`, body);
  }
  estadoEsquema(id: number, activo: boolean): Observable<EsquemaLabor> {
    return this.http.patch<EsquemaLabor>(`${this.base}/esquemas/${id}/estado`, {}, { params: this.params({ activo }) });
  }
  tiposResolucion(): Observable<Array<{ codigo: TipoResolucion; nombre: string }>> {
    return this.http.get<Array<{ codigo: TipoResolucion; nombre: string }>>(`${this.base}/tipos-resolucion`);
  }

  // ── Reglas de labor ───────────────────────────────────────────────────────
  listarReglas(f: { esquemaId?: number; areaId?: number; mes?: number; activo?: boolean } = {}): Observable<ReglaLabor[]> {
    return this.http.get<ReglaLabor[]>(`${this.base}/reglas`, { params: this.params(f) });
  }
  crearRegla(body: Partial<ReglaLabor>): Observable<ReglaLabor> {
    return this.http.post<ReglaLabor>(`${this.base}/reglas`, body);
  }
  actualizarRegla(id: number, body: Partial<ReglaLabor>): Observable<ReglaLabor> {
    return this.http.put<ReglaLabor>(`${this.base}/reglas/${id}`, body);
  }
  estadoRegla(id: number, activo: boolean): Observable<ReglaLabor> {
    return this.http.patch<ReglaLabor>(`${this.base}/reglas/${id}/estado`, {}, { params: this.params({ activo }) });
  }

  // ── Cargo ↔ area ──────────────────────────────────────────────────────────
  listarCargoAreas(f: { esquemaId?: number; cargoNombre?: string } = {}): Observable<CargoArea[]> {
    return this.http.get<CargoArea[]>(`${this.base}/cargo-areas`, { params: this.params(f) });
  }
  crearCargoArea(body: Partial<CargoArea>): Observable<CargoArea> {
    return this.http.post<CargoArea>(`${this.base}/cargo-areas`, body);
  }
  actualizarCargoArea(id: number, body: Partial<CargoArea>): Observable<CargoArea> {
    return this.http.put<CargoArea>(`${this.base}/cargo-areas/${id}`, body);
  }
  /** Enlaza el mapeo legacy con tabla_cargos buscando el id por nombre. */
  conciliarCargoArea(id: number): Observable<CargoArea> {
    return this.http.patch<CargoArea>(`${this.base}/cargo-areas/${id}/conciliar`, {});
  }

  // ── Configuracion centro + cargo ──────────────────────────────────────────
  listarConfiguraciones(f: { centroCostoId?: number; esquemaId?: number; areaId?: number } = {}): Observable<ConfiguracionCentroCargo[]> {
    return this.http.get<ConfiguracionCentroCargo[]>(`${this.base}/configuraciones`, { params: this.params(f) });
  }
  crearConfiguracion(body: Partial<ConfiguracionCentroCargo>): Observable<ConfiguracionCentroCargo> {
    return this.http.post<ConfiguracionCentroCargo>(`${this.base}/configuraciones`, body);
  }
  actualizarConfiguracion(id: number, body: Partial<ConfiguracionCentroCargo>): Observable<ConfiguracionCentroCargo> {
    return this.http.put<ConfiguracionCentroCargo>(`${this.base}/configuraciones/${id}`, body);
  }
  estadoConfiguracion(id: number, activo: boolean): Observable<ConfiguracionCentroCargo> {
    return this.http.patch<ConfiguracionCentroCargo>(`${this.base}/configuraciones/${id}/estado`, {}, { params: this.params({ activo }) });
  }

  // ── Resolucion de labor ───────────────────────────────────────────────────
  /**
   * La resolucion la hace el BACKEND. Angular no decide la labor: solo pinta lo que
   * devuelve este endpoint, o el error funcional si no hay parametrizacion.
   */
  resolverLabor(q: {
    // OJO: el nombre va en camelCase porque asi lo declara @RequestParam en
    // ParametrizacionVacantesController. Mandarlo como `centro_costo_id` hacia que Spring
    // respondiera 400 ("Required request parameter 'centroCostoId' is not present") en TODAS
    // las llamadas, y el catchError de vancy-cascade lo convertia en null: la pantalla
    // resolvia siempre por la hoja cableada y la parametrizacion no se usaba nunca.
    // El snake_case de `ResolucionLabor` es otra cosa: ese es el JSON de RESPUESTA.
    centroCostoId: number; cargoId?: number; cargoNombre?: string;
    fechaIngreso: string; esquemaIdFallback?: number;
  }): Observable<ResolucionLabor> {
    return this.http.get<ResolucionLabor>(`${this.base}/resolver-labor`, { params: this.params(q) });
  }

  /** Omite null/undefined/'' para no mandar `?activo=` vacio y romper el binding del backend. */
  private params(obj: Record<string, any>): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    }
    return p;
  }
}

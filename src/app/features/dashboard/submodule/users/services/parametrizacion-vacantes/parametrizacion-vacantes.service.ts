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

// ── Grupos de pago, fechas de pago y casino (V115) ──────────────────────────

export type TipoCalendarioPago = 'RECURRENTE_MENSUAL' | 'FECHAS_ESPECIFICAS';
export type EstadoCalendarioPago = 'VIGENTE' | 'VENCIDO';
export type FormaDescuentoCasino = 'QUINCENAL_NOMINA_Y_LIQUIDACION';
export type ComidaCasino = 'DESAYUNO' | 'ALMUERZO' | 'CENA';
/** De dónde salió el casino de una vacante, igual que el origen de la labor. */
export type OrigenCasino = 'CENTRO_GRUPO' | 'GRUPO' | 'CENTRO';

/**
 * Cuándo se paga. `texto_documento` y `estado` los calcula el BACKEND: aquí no se arma
 * ningún texto ni se decide si un calendario venció.
 */
export interface CalendarioPago {
  id?: number;
  codigo: string;
  tipo: TipoCalendarioPago;
  dia_pago_1?: number | null;
  dia_pago_2?: number | null;
  /** Solo en FECHAS_ESPECIFICAS; ISO yyyy-MM-dd. */
  fechas?: string[];
  ultima_fecha?: string | null;
  texto_documento?: string;
  estado?: EstadoCalendarioPago;
  activo?: boolean;
  /** Cuántos grupos de centro lo usan: es lo que impide desactivarlo. */
  centros_asignados?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ComidaPoliticaCasino { comida: ComidaCasino; valor: number; }

/** Qué casino se ofrece y cuánto vale cada comida. El precio es de la política, no del centro. */
export interface PoliticaCasino {
  id?: number;
  codigo: string;
  ofrece_servicio: boolean;
  forma_descuento?: FormaDescuentoCasino | null;
  comidas?: ComidaPoliticaCasino[];
  texto_documento?: string;
  activo?: boolean;
  centros_asignados?: number;
  /** Números de grupo que la tienen como casino por defecto. */
  grupos_por_defecto?: number[];
  created_at?: string;
  updated_at?: string;
}

/**
 * Grupo de pago. `politica_casino_id` es su casino por defecto: un centro con este grupo
 * no puede quedar con otra política (el backend responde CASINO_CONTRADICE_GRUPO).
 */
export interface GrupoPago {
  id?: number;
  numero: number;
  nombre: string;
  descripcion?: string | null;
  politica_casino_id?: number | null;
  politica_casino_codigo?: string | null;
  activo?: boolean;
  centros_asignados?: number;
  created_at?: string;
  updated_at?: string;
}

/** Un grupo del catálogo frente a un centro: `asignada` dice si lo tiene. */
export interface CentroGrupoPago {
  grupo_pago_id: number;
  numero: number;
  nombre: string;
  asignada: boolean;
  calendario_pago_id?: number | null;
  calendario_codigo?: string | null;
  calendario_estado?: EstadoCalendarioPago | null;
  fechas_pago_texto?: string | null;
  politica_defecto_id?: number | null;
  politica_defecto_codigo?: string | null;
}

/** Una fila ACTIVA de casino del centro. `grupo_pago_id` null = todo el centro. */
export interface CentroCasino {
  grupo_pago_id: number | null;
  grupo_numero?: number | null;
  politica_casino_id: number;
  politica_codigo?: string | null;
  texto_documento?: string | null;
}

export interface ResolucionPagoCasino {
  centro_costo_id: number;
  grupo_pago_id: number;
  grupo_pago_numero: number;
  grupo_pago_nombre: string;
  calendario_pago_id: number;
  calendario_codigo: string;
  calendario_tipo: TipoCalendarioPago;
  calendario_estado: EstadoCalendarioPago;
  fechas_pago_texto: string;
  politica_casino_id: number;
  politica_casino_codigo: string;
  ofrece_servicio: boolean;
  casino_texto: string;
  casino_origen: OrigenCasino;
  /** Hoy solo CALENDARIO_VENCIDO: avisa, no impide publicar. */
  advertencias: string[];
}

/** Si Crear Vacante debe exigir grupo de pago en este centro. Lo deciden los datos. */
export interface PagoModoCentro {
  centro_costo_id: number;
  temporal_config_ref: number | null;
  exige_grupo_pago: boolean;
}

export interface ResumenGrupoCentro {
  grupo_pago_id: number;
  numero: number;
  nombre: string;
  calendario_pago_id: number | null;
  calendario_codigo: string | null;
  calendario_estado: EstadoCalendarioPago | null;
  politica_casino_id: number | null;
  politica_casino_codigo: string | null;
  casino_origen: OrigenCasino | null;
  casino_error: string | null;
}

/** Un centro habilitado en la cadena: rojo si le falta algo, ámbar si su calendario venció. */
export interface ResumenPagoCentro {
  centro_costo_id: number;
  finca: string | null;
  ccostos: string | null;
  empresa_usuaria_ref: number | null;
  empresa_nombre: string | null;
  temporal_config_ref: number | null;
  grupos: ResumenGrupoCentro[];
  casino_centro_codigo: string | null;
  sin_grupos: boolean;
  sin_casino: boolean;
  calendario_vencido: boolean;
}

export type Periodicidad = 'MENSUAL' | 'QUINCENAL';

/**
 * Un seguro funerario. Existe por sí mismo, con su nombre y su valor definidos UNA vez;
 * los centros se le asocian por la tabla intermedia. Cambiar `valor` lo cambia en todos
 * los centros que lo tengan — por eso `centros_asignados` viene del backend.
 *
 * No hay valor por defecto ni herencia: un centro tiene los seguros que diga la relación
 * y ninguno más.
 */
export interface SeguroFunerario {
  id?: number;
  nombre: string;
  valor: number;
  periodicidad: Periodicidad;
  /** true = se descuenta por nómina; false = lo asume la empresa. */
  descuento_nomina?: boolean;
  descripcion?: string | null;
  activo?: boolean;
  /** A cuántos centros alcanza cambiarle el valor. Lo calcula el backend. */
  centros_asignados?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Salario mínimo y auxilio de transporte de UN año. Los documentos de contratación
 * imprimen el del año en que se creó el contrato; un año sin fila usa el anterior.
 */
export interface SalarioMinimoAnio {
  id?: number;
  anio: number;
  salario_minimo: number;
  auxilio_transporte: number;
  observacion?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Un seguro FRENTE A un centro, marcando si lo tiene. Vienen todos los seguros activos,
 * no solo los asignados: la pantalla necesita poder marcar los que faltan.
 *
 * Un centro puede tener VARIOS: filtrar por `asignada` da la lista real, y leerla como
 * si fuera un único seguro se come el segundo.
 */
export interface CentroSeguro {
  seguro_funerario_id: number;
  nombre: string;
  valor: number;
  periodicidad: Periodicidad;
  descuento_nomina?: boolean;
  asignada: boolean;
  observaciones?: string | null;
}

/** Un centro FRENTE A un seguro. La vista simétrica de `CentroSeguro`. */
export interface SeguroCentro {
  centro_costo_id: number;
  centro_nombre: string | null;
  centro_codigo: string | null;
  empresa_nombre: string | null;
  temporal: string | null;
  asignada: boolean;
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
  /** Columna derivada: la tabla compartida pinta propiedades planas. */
  conciliadoTxt?: string;
}

export interface ConfiguracionCentroCargo {
  id?: number;
  centro_costo_id: number;
  /**
   * Cómo se llama el centro, ya desambiguado por el backend. El id sigue siendo lo que
   * se guarda, pero no es lo que se le enseña al usuario: «Centro 8149» no identifica
   * ningún sitio para quien parametriza.
   */
  centro_nombre?: string | null;
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
/** Empresa del maestro que todavía NO está en el alcance de vacantes. */
export interface EmpresaCandidata {
  empresa_usuaria_ref: number;
  nombre: string | null;
  nit: string | null;
}

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
  /**
   * Datos de contacto. Igual que `nombre` y `nit`, viven en el MAESTRO (ms-payroll) y no
   * en el alcance: se editan desde esta pantalla pero se guardan alla. null si ms-payroll
   * no respondio o la referencia quedo huerfana.
   */
  representante_legal: string | null;
  /** Cédula del representante legal. Esta SÍ es del alcance (db_admin), no del maestro. */
  representante_legal_documento: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
  /**
   * Ultima modificacion del ALCANCE de esta empresa (temporal, nombre de origen,
   * conciliacion, alta/baja). No refleja cambios de la razon social ni del NIT: eso
   * vive en el maestro (ms-payroll) y se edita en Entidades Externas.
   */
  updated_at?: string | null;
}

/** Opción del selector de centro de costo: con qué se guarda y cómo se le llama. */
export interface CentroOpcion {
  id: number;
  etiqueta: string;
  empresa_usuaria_ref: number | null;
  habilitado_vacantes: boolean;
}

/**
 * Los campos de la empresa que NO son del alcance de vacantes: viven en el maestro de
 * entidades externas (ms-payroll). ms-auth-admin los reenvia; aqui no se guarda copia.
 */
export interface DatosMaestroEmpresa {
  nombre?: string;
  nit?: string;
  representante_legal?: string;
  direccion?: string;
  telefono?: string;
  correo?: string;
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
  /** Contacto del gestor del centro. El teléfono ya se guardaba, pero el backend
   *  no lo devolvía, así que el formulario lo reabría vacío. */
  nombre_gestor: string | null;
  telefono_gestor: string | null;
  email_gestor: string | null;
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

// ── Parametrización DOCUMENTAL (documentos de contratación por empresa usuaria) ──
//
// Mismo controlador base y mismo contrato que el resto: JSON en snake_case, errores
// `{error, codigo}`. Los enumerados viajan como texto; aquí se tipan con sus valores.

/** A dónde va un ejemplar del documento. */
export type DestinoDocumento = 'ARCHIVO_TEMPORAL' | 'ESCANER_USUARIA' | 'TRABAJADOR_FINCA' | 'TRABAJADOR';
/** DIGITAL no produce papel: no suma a las copias físicas. Solo aplica a ESCANER_USUARIA. */
export type FormaDocumento = 'ORIGINAL' | 'COPIA' | 'DIGITAL';
export type NaturalezaDocumento = 'GENERADO' | 'DILIGENCIADO_MANUAL' | 'SOPORTE_CARGADO' | 'CONSULTA';
export type EtapaDocumento = 'SELECCION' | 'CONTRATACION' | 'AFILIACION' | 'INGRESO';
export type CondicionDocumento = 'NINGUNA' | 'CARGO_CRITICO' | 'SEGUN_CARGO' | 'OMITIBLE_TEMPORADA';
/** Interruptor por temporal: OFF = regex de siempre, SOMBRA = compara y registra, ON = solo parametrización. */
export type ModoDocumentos = 'OFF' | 'SOMBRA' | 'ON';

/** Una fila por empresa del alcance, con su conteo. Alimenta el aviso «sin parametrizar». */
export interface EmpresaDocumentosResumen {
  empresa_vacante_id: number;
  empresa_usuaria_ref: number;
  temporal_config_ref: number | null;
  nombre_excel: string | null;
  activo: boolean | null;
  documentos: number;
  sin_parametrizacion: boolean;
  modo_temporal: ModoDocumentos;
  /** Columnas derivadas: la tabla compartida pinta propiedades planas. */
  empresaTxt?: string;
  estadoTxt?: string;
}

/** Tipo del catálogo de documentos de contratación. */
export interface TipoDocumental {
  id?: number;
  /** UPPER_SNAKE. No se edita: lo comparten ms-documents y ms-templates. */
  codigo: string;
  nombre: string;
  nombre_listado?: string | null;
  /** Id del tipo en ms-documents. Se enlaza solo (al crear el tipo y cada 15 min). */
  tipo_documento_ref?: number | null;
  naturaleza: NaturalezaDocumento;
  /** Obligatoria cuando la naturaleza es GENERADO. */
  plantilla_codigo?: string | null;
  etapa: EtapaDocumento;
  vigencia_dias?: number | null;
  condicion?: CondicionDocumento | null;
  observacion?: string | null;
  activo?: boolean;
  /** Cuántas empresas lo llevan. Con > 0 el backend no deja desactivarlo. */
  empresas_asignadas?: number;
}

/** Cuerpo de alta/edición de un tipo. En la edición, null = no tocar y '' = borrar. */
export type TipoDocumentalRequest = Partial<Omit<TipoDocumental, 'id' | 'empresas_asignadas'>>;

/** Perfil molde (ELITE, ELITE_BLU, DEFAULT…) de una temporal. */
export interface PerfilDocumental {
  id: number;
  codigo: string;
  nombre: string;
  temporal_config_ref: number;
  version_listado: string | null;
  descripcion: string | null;
  documentos: number;
}

export interface ModoDocumentosTemporal {
  temporal_config_ref: number;
  modo: ModoDocumentos;
  observacion: string | null;
  updated_at: string | null;
}

export interface DestinoDocumental {
  destino: DestinoDocumento;
  forma: FormaDocumento;
  /** null = el backend guarda 1. */
  copias: number | null;
  orden: number | null;
}

/** Lo que del tipo viaja dentro de cada documento de la empresa. */
export interface TipoDocumentalResumen {
  id: number;
  codigo: string;
  nombre: string;
  naturaleza: NaturalezaDocumento;
  plantilla_codigo: string | null;
  etapa: EtapaDocumento;
  vigencia_dias: number | null;
  condicion: CondicionDocumento | null;
  observacion: string | null;
  tipo_documento_ref: number | null;
}

export interface DocumentoEmpresa {
  id: number | null;
  tipo: TipoDocumentalResumen;
  obligatorio: boolean | null;
  orden_archivo: number | null;
  bloque_archivo: number | null;
  version_listado: string | null;
  destinos: DestinoDocumental[];
  copias_fisicas: number;
  copias_digitales: number;
  /** EMPRESA | EXCEPCION_CENTRO. */
  origen: string;
}

export interface TotalesDocumentos {
  documentos: number;
  copias_fisicas: number;
  copias_digitales: number;
  fisicas_por_destino: Record<string, number>;
  digitales_por_destino: Record<string, number>;
}

export interface EmpresaDocumentos {
  empresa_vacante_id: number;
  empresa_usuaria_ref: number;
  temporal_config_ref: number | null;
  nombre_excel: string | null;
  /** Datos que imprimen las plantillas y no están en el maestro de nómina. */
  codigo_compania: string | null;
  representante_legal_documento: string | null;
  /** Canal de protección de datos de la empresa usuaria (Autorización de derechos de imagen). */
  correo_datos_personales: string | null;
  telefono_datos_personales: string | null;
  sin_parametrizacion: boolean;
  documentos: DocumentoEmpresa[];
  totales: TotalesDocumentos;
}

/** Una fila del PUT de reemplazo exacto. */
export interface DocumentoEmpresaRequest {
  tipo_documental_id: number;
  obligatorio: boolean;
  orden_archivo: number | null;
  bloque_archivo: number | null;
  version_listado: string | null;
  destinos: DestinoDocumental[];
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
  /**
   * Empresas del MAESTRO que aún no están en el alcance: lo que ofrece el
   * desplegable de «Habilitar empresa». Las que ya están —incluso dadas de
   * baja— no salen aquí: esas se devuelven con su interruptor en la tabla.
   */
  empresasCandidatas(): Observable<EmpresaCandidata[]> {
    return this.http.get<EmpresaCandidata[]>(`${this.base}/empresas/candidatas`);
  }
  /**
   * Mete una empresa del maestro en el alcance de vacantes.
   *
   * Las claves van en SNAKE_CASE porque los microservicios serializan así
   * (`commons/JacksonConfig` fija `PropertyNamingStrategies.SNAKE_CASE`). Este
   * método estaba escrito en camelCase y nunca se llegó a llamar desde ninguna
   * pantalla, así que el fallo no había salido: el backend habría recibido
   * `empresa_usuaria_ref` nulo y respondido 400.
   */
  habilitarEmpresa(body: {
    empresa_usuaria_ref: number;
    nombre_excel?: string;
    tipo_conciliacion?: string;
    temporal_config_ref?: number;
    activo?: boolean;
    representante_legal_documento?: string;
  } & DatosMaestroEmpresa): Observable<EmpresaVacante> {
    return this.http.post<EmpresaVacante>(`${this.base}/empresas`, body);
  }
  /**
   * Edita la empresa. Mezcla dos origenes en una sola llamada porque para el usuario es un
   * unico formulario: temporal / nombre de origen / conciliacion son del ALCANCE, y los de
   * `DatosMaestroEmpresa` los reenvia ms-auth-admin al maestro de ms-payroll. Un campo que
   * no se manda no se toca.
   */
  actualizarEmpresa(id: number, body: {
    temporal_config_ref?: number | null;
    nombre_excel?: string;
    tipo_conciliacion?: string;
    /** '' = borrarla; ausente = no tocarla. */
    representante_legal_documento?: string;
  } & DatosMaestroEmpresa): Observable<EmpresaVacante> {
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
  listarCargoAreas(
    f: { esquemaId?: number; cargoNombre?: string; incluirInactivos?: boolean } = {},
  ): Observable<CargoArea[]> {
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
  /** Baja lógica del mapeo. Era el único elemento sin forma de retirarse. */
  estadoCargoArea(id: number, activo: boolean): Observable<CargoArea> {
    return this.http.patch<CargoArea>(`${this.base}/cargo-areas/${id}/estado`, {},
      { params: this.params({ activo }) });
  }

  // ── Configuracion centro + cargo ──────────────────────────────────────────
  /**
   * Centros para el desplegable: id + etiqueta. Aparte de `listarCentros` porque aquel
   * exige empresa (es la cascada empresa → centro) y aquí hace falta la lista completa
   * para elegir el centro por su nombre sin saber antes de qué empresa es.
   */
  opcionesCentro(incluirNoHabilitados = false): Observable<CentroOpcion[]> {
    return this.http.get<CentroOpcion[]>(`${this.base}/centros/opciones`,
      { params: this.params({ incluirNoHabilitados }) });
  }
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

  // ── Seguros funerarios ───────────────────────────────────────────────────
  /** `activo` omitido = todos, para administrarlos; `true` = solo los vigentes. */
  listarSeguros(activo?: boolean): Observable<SeguroFunerario[]> {
    return this.http.get<SeguroFunerario[]>(`${this.base}/seguros-funerarios`, { params: this.params({ activo }) });
  }
  crearSeguro(body: Partial<SeguroFunerario>): Observable<SeguroFunerario> {
    return this.http.post<SeguroFunerario>(`${this.base}/seguros-funerarios`, body);
  }
  /** OJO: cambiar el valor lo cambia en TODOS los centros que tengan este seguro. */
  actualizarSeguro(id: number, body: Partial<SeguroFunerario>): Observable<SeguroFunerario> {
    return this.http.put<SeguroFunerario>(`${this.base}/seguros-funerarios/${id}`, body);
  }
  estadoSeguro(id: number, activo: boolean): Observable<SeguroFunerario> {
    return this.http.patch<SeguroFunerario>(`${this.base}/seguros-funerarios/${id}/estado`, {},
      { params: this.params({ activo }) });
  }

  // ── Salario mínimo por año ───────────────────────────────────────────────
  listarSalarioMinimo(): Observable<SalarioMinimoAnio[]> {
    return this.http.get<SalarioMinimoAnio[]>(`${this.base}/salario-minimo`);
  }
  /** Crea o corrige el año. */
  guardarSalarioMinimo(anio: number, body: Pick<SalarioMinimoAnio, 'salario_minimo' | 'auxilio_transporte' | 'observacion'>): Observable<SalarioMinimoAnio> {
    return this.http.put<SalarioMinimoAnio>(`${this.base}/salario-minimo/${anio}`, body);
  }

  /** Centros del alcance frente a un seguro, marcando cuáles lo tienen. */
  centrosDeSeguro(seguroId: number): Observable<SeguroCentro[]> {
    return this.http.get<SeguroCentro[]>(`${this.base}/seguros-funerarios/${seguroId}/centros`);
  }
  /** Fija EXACTAMENTE los centros del seguro; los que salen se dan de baja lógica. */
  fijarCentrosDeSeguro(seguroId: number, centroCostoIds: number[]): Observable<SeguroCentro[]> {
    return this.http.put<SeguroCentro[]>(`${this.base}/seguros-funerarios/${seguroId}/centros`,
      { centro_costo_ids: centroCostoIds });
  }

  /** Los seguros de un centro. Devuelve LISTA: un centro puede tener varios. */
  segurosDeCentro(centroId: number): Observable<CentroSeguro[]> {
    return this.http.get<CentroSeguro[]>(`${this.base}/centros/${centroId}/seguros-funerarios`);
  }
  /** Fija EXACTAMENTE los seguros del centro. */
  fijarSegurosDeCentro(centroId: number, seguroIds: number[]): Observable<CentroSeguro[]> {
    return this.http.put<CentroSeguro[]>(`${this.base}/centros/${centroId}/seguros-funerarios`,
      { seguro_ids: seguroIds });
  }

  // ── Parametrización documental ───────────────────────────────────────────
  /** Una fila por empresa del alcance con su conteo. `temporalConfigRef` omitido = todas. */
  resumenDocumentosEmpresas(temporalConfigRef?: number): Observable<EmpresaDocumentosResumen[]> {
    return this.http.get<EmpresaDocumentosResumen[]>(`${this.base}/documentos/empresas`,
      { params: this.params({ temporalConfigRef }) });
  }
  /** `activo` omitido = todo el catálogo, para administrarlo. */
  listarTiposDocumentales(activo?: boolean): Observable<TipoDocumental[]> {
    return this.http.get<TipoDocumental[]>(`${this.base}/documentos/tipos`, { params: this.params({ activo }) });
  }
  crearTipoDocumental(body: TipoDocumentalRequest): Observable<TipoDocumental> {
    return this.http.post<TipoDocumental>(`${this.base}/documentos/tipos`, body);
  }
  /** El código no se edita. En los opcionales, null = no tocar y '' = borrar. */
  actualizarTipoDocumental(id: number, body: TipoDocumentalRequest): Observable<TipoDocumental> {
    return this.http.put<TipoDocumental>(`${this.base}/documentos/tipos/${id}`, body);
  }
  /** Baja lógica. El backend la rechaza (EN_USO) si alguna empresa lo lleva. */
  estadoTipoDocumental(id: number, activo: boolean): Observable<TipoDocumental> {
    return this.http.patch<TipoDocumental>(`${this.base}/documentos/tipos/${id}/estado`, {},
      { params: this.params({ activo }) });
  }
  listarPerfilesDocumentales(temporalConfigRef?: number): Observable<PerfilDocumental[]> {
    return this.http.get<PerfilDocumental[]>(`${this.base}/documentos/perfiles`,
      { params: this.params({ temporalConfigRef }) });
  }
  listarModosDocumentos(): Observable<ModoDocumentosTemporal[]> {
    return this.http.get<ModoDocumentosTemporal[]>(`${this.base}/documentos/modos`);
  }
  /** Una temporal sin fila responde OFF. */
  modoDocumentos(temporalConfigRef: number): Observable<ModoDocumentosTemporal> {
    return this.http.get<ModoDocumentosTemporal>(`${this.base}/documentos/modos/${temporalConfigRef}`);
  }
  fijarModoDocumentos(temporalConfigRef: number,
                      body: { modo: ModoDocumentos; observacion?: string | null }): Observable<ModoDocumentosTemporal> {
    return this.http.put<ModoDocumentosTemporal>(`${this.base}/documentos/modos/${temporalConfigRef}`, body);
  }

  /** `empresaVacanteId` es `empresa_usuaria_vacante.id`, igual que el resto de `/empresas/{id}`. */
  documentosDeEmpresa(empresaVacanteId: number): Observable<EmpresaDocumentos> {
    return this.http.get<EmpresaDocumentos>(`${this.base}/empresas/${empresaVacanteId}/documentos`);
  }
  /** Reemplazo EXACTO y transaccional: lo que no viene se da de baja lógica. */
  fijarDocumentosDeEmpresa(empresaVacanteId: number, documentos: DocumentoEmpresaRequest[]): Observable<EmpresaDocumentos> {
    return this.http.put<EmpresaDocumentos>(`${this.base}/empresas/${empresaVacanteId}/documentos`, { documentos });
  }
  /** Sustituye por completo los documentos de la empresa por los del perfil de su temporal. */
  aplicarPerfilDocumental(empresaVacanteId: number, perfil: string): Observable<EmpresaDocumentos> {
    return this.http.post<EmpresaDocumentos>(`${this.base}/empresas/${empresaVacanteId}/documentos/aplicar-perfil`, { perfil });
  }
  /** Sustituye por completo; solo entre empresas de la misma temporal. */
  copiarDocumentosDesde(empresaVacanteId: number, otraEmpresaVacanteId: number): Observable<EmpresaDocumentos> {
    return this.http.post<EmpresaDocumentos>(
      `${this.base}/empresas/${empresaVacanteId}/documentos/copiar-desde/${otraEmpresaVacanteId}`, {});
  }
  /** null = no tocar; '' = borrar. */
  actualizarDatosDocumentales(empresaVacanteId: number, body: {
    codigo_compania?: string | null;
    representante_legal_documento?: string | null;
    correo_datos_personales?: string | null;
    telefono_datos_personales?: string | null;
  }): Observable<EmpresaDocumentos> {
    return this.http.put<EmpresaDocumentos>(`${this.base}/empresas/${empresaVacanteId}/datos-documentales`, body);
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

  // ── Grupos de pago, fechas de pago y casino (V115) ───────────────────────
  /** `activo` omitido = todo el catálogo; `true` = solo los vivos. */
  listarCalendariosPago(activo?: boolean): Observable<CalendarioPago[]> {
    return this.http.get<CalendarioPago[]>(`${this.base}/calendarios-pago`, { params: this.params({ activo }) });
  }
  crearCalendarioPago(body: Partial<CalendarioPago>): Observable<CalendarioPago> {
    return this.http.post<CalendarioPago>(`${this.base}/calendarios-pago`, body);
  }
  /** PUT = reemplazo completo: lo que no venga queda vacío (los días, las fechas). */
  actualizarCalendarioPago(id: number, body: Partial<CalendarioPago>): Observable<CalendarioPago> {
    return this.http.put<CalendarioPago>(`${this.base}/calendarios-pago/${id}`, body);
  }
  /** El backend rechaza con CALENDARIO_EN_USO si algún grupo de centro lo usa. */
  estadoCalendarioPago(id: number, activo: boolean): Observable<CalendarioPago> {
    return this.http.patch<CalendarioPago>(`${this.base}/calendarios-pago/${id}/estado`, {},
      { params: this.params({ activo }) });
  }
  /** Vista previa del texto SIN guardar: el texto lo arma siempre el backend. */
  vistaPreviaCalendarioPago(body: Partial<CalendarioPago>): Observable<{ texto_documento: string }> {
    return this.http.post<{ texto_documento: string }>(`${this.base}/calendarios-pago/vista-previa`, body);
  }

  listarPoliticasCasino(activo?: boolean): Observable<PoliticaCasino[]> {
    return this.http.get<PoliticaCasino[]>(`${this.base}/politicas-casino`, { params: this.params({ activo }) });
  }
  crearPoliticaCasino(body: Partial<PoliticaCasino>): Observable<PoliticaCasino> {
    return this.http.post<PoliticaCasino>(`${this.base}/politicas-casino`, body);
  }
  /** PUT = reemplazo completo, comidas incluidas: las que no vengan se dan de baja. */
  actualizarPoliticaCasino(id: number, body: Partial<PoliticaCasino>): Observable<PoliticaCasino> {
    return this.http.put<PoliticaCasino>(`${this.base}/politicas-casino/${id}`, body);
  }
  /** Rechazada (POLITICA_EN_USO) si la usa un centro o es el casino por defecto de un grupo. */
  estadoPoliticaCasino(id: number, activo: boolean): Observable<PoliticaCasino> {
    return this.http.patch<PoliticaCasino>(`${this.base}/politicas-casino/${id}/estado`, {},
      { params: this.params({ activo }) });
  }
  vistaPreviaPoliticaCasino(body: Partial<PoliticaCasino>): Observable<{ texto_documento: string }> {
    return this.http.post<{ texto_documento: string }>(`${this.base}/politicas-casino/vista-previa`, body);
  }

  listarGruposPago(activo?: boolean): Observable<GrupoPago[]> {
    return this.http.get<GrupoPago[]>(`${this.base}/grupos-pago`, { params: this.params({ activo }) });
  }
  crearGrupoPago(body: Partial<GrupoPago>): Observable<GrupoPago> {
    return this.http.post<GrupoPago>(`${this.base}/grupos-pago`, body);
  }
  /** `politica_casino_id: null` quita el casino por defecto del grupo. */
  actualizarGrupoPago(id: number, body: Partial<GrupoPago>): Observable<GrupoPago> {
    return this.http.put<GrupoPago>(`${this.base}/grupos-pago/${id}`, body);
  }
  estadoGrupoPago(id: number, activo: boolean): Observable<GrupoPago> {
    return this.http.patch<GrupoPago>(`${this.base}/grupos-pago/${id}/estado`, {},
      { params: this.params({ activo }) });
  }

  /** Todos los grupos activos frente al centro, marcando los asignados y su calendario. */
  gruposPagoDeCentro(centroId: number): Observable<CentroGrupoPago[]> {
    return this.http.get<CentroGrupoPago[]>(`${this.base}/centros/${centroId}/grupos-pago`);
  }
  /** Deja EXACTAMENTE esos grupos; lo que sale o cambia de calendario se da de baja. */
  fijarGruposPagoDeCentro(centroId: number,
                          items: { grupo_pago_id: number; calendario_pago_id: number }[]): Observable<CentroGrupoPago[]> {
    return this.http.put<CentroGrupoPago[]>(`${this.base}/centros/${centroId}/grupos-pago`, items);
  }
  /** Solo las filas ACTIVAS: la del centro entero (grupo null) y las de cada grupo. */
  casinoDeCentro(centroId: number): Observable<CentroCasino[]> {
    return this.http.get<CentroCasino[]>(`${this.base}/centros/${centroId}/casino`);
  }
  fijarCasinoDeCentro(centroId: number,
                      items: { grupo_pago_id: number | null; politica_casino_id: number }[]): Observable<CentroCasino[]> {
    return this.http.put<CentroCasino[]>(`${this.base}/centros/${centroId}/casino`, items);
  }
  pagoModoDeCentro(centroId: number): Observable<PagoModoCentro> {
    return this.http.get<PagoModoCentro>(`${this.base}/centros/${centroId}/pago-modo`);
  }
  /** La cadena completa: un centro habilitado por fila, con sus grupos y su casino. */
  resumenPagoCentros(): Observable<ResumenPagoCentro[]> {
    return this.http.get<ResumenPagoCentro[]>(`${this.base}/pago-casino/resumen-centros`);
  }
  /**
   * Fechas de pago y casino de (centro, grupo). Los nombres de los parámetros van en
   * camelCase porque así los declara @RequestParam; el snake_case es solo la RESPUESTA.
   */
  resolverPagoCasino(q: { centroId: number; grupoPagoId: number }): Observable<ResolucionPagoCasino> {
    return this.http.get<ResolucionPagoCasino>(`${this.base}/resolver-pago-casino`, { params: this.params(q) });
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

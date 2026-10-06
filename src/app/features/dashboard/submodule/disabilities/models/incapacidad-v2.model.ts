/**
 * Modelo TypeScript del contrato de la API de Incapacidades v2.
 *
 * Espeja 1:1 lo que expone ms-hr:
 *   POST   /Incapacidades/v2/validar        -> ValidacionResponse   [STATELESS]
 *   POST   /Incapacidades/v2                -> IncapacidadV2 (201)
 *   GET    /Incapacidades/v2                -> Page<IncapacidadResumen>
 *   GET    /Incapacidades/v2/{id}           -> IncapacidadV2
 *   PUT    /Incapacidades/v2/{id}           -> IncapacidadV2
 *   POST   /Incapacidades/v2/{id}/validar   -> 200 | 409 { motivosBloqueo }
 *   DELETE /Incapacidades/v2/{id}           -> 204
 *   GET    /Incapacidades/v2/catalogos      -> CatalogosIncapacidad
 *   POST   /Incapacidades/v2/{id}/soportes                -> SoporteIncapacidad (201)
 *   GET    /Incapacidades/v2/{id}/soportes                -> ListaSoportesResponse
 *   DELETE /Incapacidades/v2/{id}/soportes/{tipoSoporte}  -> 204
 *
 * REGLA IMPORTANTE: los union types de abajo son SOLO para tipado. Las listas
 * que alimentan los desplegables NO se hardcodean aqui: se piden a
 * `GET /Incapacidades/v2/catalogos` (ver `IncapacidadV2Service.catalogos()`),
 * que devuelve `{ codigo, etiqueta, automatico? }` y es la unica fuente de
 * verdad de las etiquetas mostradas al usuario.
 *
 * Los codigos replican exactamente los enums Java de
 * `co.tsservicios.mshr.incapacidades.domain`.
 */

// ─────────────────────────────────────────────────────────────────────────
// Union types (tipado; las opciones visibles vienen del endpoint catalogos)
// ─────────────────────────────────────────────────────────────────────────

/** Espeja `domain/TipoIncapacidad.java`. */
export type TipoIncapacidad =
  | 'ENFERMEDAD_GENERAL'
  | 'ACCIDENTE_TRABAJO'
  | 'ENFERMEDAD_LABORAL'
  | 'ACCIDENTE_TRANSITO'
  | 'LICENCIA_MATERNIDAD'
  | 'LICENCIA_PATERNIDAD';

/** Espeja `domain/EstadoIncapacidad.java`. */
export type EstadoIncapacidad =
  | 'RECIBIDA'
  | 'VALIDADA'
  | 'PENDIENTE_RADICACION'
  | 'RADICADA'
  | 'EN_REVISION_EPS'
  | 'PAGADA'
  | 'NEGADA'
  | 'RECOBRO'
  | 'NUEVA_RESPUESTA'
  | 'PENDIENTE_CONCILIACION'
  | 'CONCILIADA'
  | 'FINALIZADA'
  | 'CANCELADA';

/**
 * Espeja `domain/EstadoDocumento.java`.
 * `PRESCRITA` y `NO_CUMPLE` son AUTOMATICOS (los pone el motor de reglas,
 * el usuario no deberia poder elegirlos: el catalogo los marca con
 * `automatico: true`).
 */
export type EstadoDocumento =
  | 'OK'
  | 'INCOMPLETA'
  | 'ILEGIBLE'
  | 'FALTA_HISTORIA_CLINICA'
  | 'FALTA_FURAT'
  | 'FALTA_FURIPS'
  | 'FALTA_REGISTRO_CIVIL'
  | 'FALTA_NACIDO_VIVO'
  | 'PRESCRITA'
  | 'NO_CUMPLE'
  | 'FALSA';

/** Espeja `domain/ResponsablePago.java`. */
export type ResponsablePago =
  | 'EMPLEADOR'
  | 'EPS'
  | 'ARL'
  | 'FONDO_PENSIONES'
  | 'EPS_Y_EMPLEADOR'
  | 'ARL_Y_EMPLEADOR'
  | 'PROPORCIONAL_COTIZADO'
  | 'NO_PAGAR';

/**
 * Espeja `domain/TipoSoporte.java`.
 * Reunion 2026-08-20: `SOAT` entro a la v2 como soporte propio del accidente de
 * transito (incapacidad + historia clinica + SOAT + FURIPS).
 */
export type TipoSoporte =
  | 'INCAPACIDAD_MEDICA'
  | 'HISTORIAL_CLINICO'
  | 'REGISTRO_CIVIL'
  | 'REGISTRO_NACIDO_VIVO'
  | 'FURAT'
  | 'FURIPS'
  | 'SOAT'
  | 'FORMULARIO_SALUD_TOTAL';

/**
 * Estado de sincronizacion de un soporte ya vinculado a la incapacidad v2.
 * Lo decide el backend al hablar con ms-documents:
 *  - `SINCRONIZADO`       el archivo quedo en ms-documents;
 *  - `SINCRONIZADO_DEDUP` ms-documents ya tenia ese mismo sha256 y lo reuso;
 *  - `PENDIENTE_SYNC`     ms-documents no respondio: el archivo quedo en la
 *    cache local del servidor y en la cola de reintento. El vinculo EXISTE,
 *    asi que cuenta como soporte cargado.
 */
export type EstadoSoporte = 'SINCRONIZADO' | 'SINCRONIZADO_DEDUP' | 'PENDIENTE_SYNC';

/** Entidad que asume los dias que no paga el empleador. */
export type EntidadResponsable = 'EPS' | 'ARL';

/** Severidad de una alerta devuelta por el motor de reglas. */
export type NivelAlerta = 'INFO' | 'ADVERTENCIA' | 'CRITICA';

// ─────────────────────────────────────────────────────────────────────────
// Catalogos (GET /Incapacidades/v2/catalogos)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Opcion generica de un desplegable.
 * `automatico` solo viene poblado en `estadosDocumento`: cuando es `true`
 * el estado lo asigna el backend y la UI NO debe ofrecerlo para seleccion
 * manual.
 */
export interface OpcionCatalogo<C extends string = string> {
  codigo: C;
  etiqueta: string;
  automatico?: boolean;
}

/** Respuesta completa de `GET /Incapacidades/v2/catalogos`. */
export interface CatalogosIncapacidad {
  tiposIncapacidad: OpcionCatalogo<TipoIncapacidad>[];
  estados: OpcionCatalogo<EstadoIncapacidad>[];
  estadosDocumento: OpcionCatalogo<EstadoDocumento>[];
  responsablesPago: OpcionCatalogo<ResponsablePago>[];
  tiposSoporte: OpcionCatalogo<TipoSoporte>[];
  /** Canales de radicacion (V44). Opcional: backends anteriores no lo envian. */
  dondesRadicado?: OpcionCatalogo[];
}

// ─────────────────────────────────────────────────────────────────────────
// Validacion (POST /Incapacidades/v2/validar)  — STATELESS, no persiste
// ─────────────────────────────────────────────────────────────────────────

/**
 * Request del motor de reglas. Todas las fechas en `yyyy-MM-dd`
 * (usa `aIsoCorto` de `../utils/fechas`, NUNCA `toISOString()`).
 */
export interface ValidarIncapacidadRequest {
  cedula: string;
  /** Fecha de ingreso del trabajador, `yyyy-MM-dd`. */
  fechaIngreso: string;
  tipoIncapacidad: TipoIncapacidad;
  /** `yyyy-MM-dd`. */
  fechaInicio: string;
  /** `yyyy-MM-dd`. */
  fechaFin: string;
  codigoDiagnostico: string;
  /** Nombre de la EPS ya normalizado (con `trim()`: llega con espacios finales). */
  eps: string;
  estadoDocumento: EstadoDocumento;
  /** Soportes que el usuario ya adjunto. */
  soportesCargados: TipoSoporte[];
  /** Al editar: id de la incapacidad en curso, para que no se traslape consigo misma. */
  excluirId?: number;
}

/** Un soporte, con su visibilidad/obligatoriedad ya resueltas por las reglas. */
export interface SoporteRequerido {
  tipo: TipoSoporte;
  etiqueta: string;
  /** Si `false`, la UI no debe mostrar la casilla. */
  visible: boolean;
  /** Si `true`, sin el archivo no se puede promover a VALIDADA. */
  obligatorio: boolean;
  /** `true` si el request declaro este soporte como cargado. */
  cargado: boolean;
}

/** Alerta del motor de reglas para pintar en el panel lateral. */
export interface AlertaValidacion {
  nivel: NivelAlerta;
  /** Codigo estable de la regla (ej. `R7_SUPERADO_180`). */
  codigo: string;
  mensaje: string;
}

/** Respuesta de `POST /Incapacidades/v2/validar`. */
export interface ValidacionResponse {
  /** Dias calendario de la incapacidad (ambos extremos incluidos). */
  dias: number;
  /** Dias a cargo del empleador. */
  diasEmpresa: number;
  /** Dias a cargo de la EPS/ARL. */
  diasEntidad: number;
  entidadResponsable: EntidadResponsable;
  responsablePago: ResponsablePago;

  esProrroga: boolean;
  /** Id de la incapacidad de la que esta es prorroga, si aplica. */
  prorrogaDeId: number | null;

  tieneTraslape: boolean;
  /** Ids de incapacidades que se cruzan con el rango enviado. */
  idsTraslapados: number[];

  cumpleCotizacion: boolean;
  diasDesdeIngreso: number;

  estaPrescrita: boolean;
  diasHabilesTranscurridos: number;

  /** Dias acumulados del mismo diagnostico en la ventana legal. */
  diasAcumuladosDiagnostico: number;
  superado180: boolean;
  superado540: boolean;
  proximoA180: boolean;

  /** Estado documental que quedaria tras aplicar las reglas automaticas. */
  estadoDocumentoResultante: EstadoDocumento;
  /** Estado de gestion sugerido para la incapacidad. */
  estadoSugerido: EstadoIncapacidad;

  /** `false` => el boton "Validar" debe quedar deshabilitado. */
  puedeValidar: boolean;
  /** Razones legibles por las que no se puede validar. */
  motivosBloqueo: string[];

  soportes: SoporteRequerido[];
  alertas: AlertaValidacion[];
}

// ─────────────────────────────────────────────────────────────────────────
// Escritura (POST / PUT /Incapacidades/v2)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Payload de creacion/actualizacion.
 *
 * Contiene el mismo nucleo que `ValidarIncapacidadRequest` mas los datos
 * de contexto que el motor de reglas no necesita pero si se persisten
 * (trabajador, IPS, ARL, trazabilidad del usuario que recibe).
 *
 * `PUT /Incapacidades/v2/{id}` usa exactamente esta misma forma.
 */
export interface CrearIncapacidadV2Request {
  // ── Trabajador ──────────────────────────────────────────────────────
  cedula: string;
  tipoDocumento?: string;
  /* El backend guarda el nombre DESGLOSADO: no acepta `nombreCompleto`
     (CrearIncapacidadV2Request no lo declara y Jackson rechaza el cuerpo entero
     con 400 ante un campo desconocido). El nombre completo se arma al leer. */
  primerApellido?: string;
  segundoApellido?: string;
  primerNombre?: string;
  segundoNombre?: string;
  /** `yyyy-MM-dd`. */
  fechaIngreso: string;
  /** `yyyy-MM-dd`; puede ser null si la fecha guardada era basura. */
  fechaNacimiento?: string | null;
  /** Calculada desde `fechaNacimiento` con `calcularEdad`, nunca desde `edadTrabajador`. */
  edad?: number | null;
  /** El backend lo llama `sexo`, no `genero`. */
  sexo?: string;
  celular?: string;
  correo?: string;
  empresa?: string;
  centroCosto?: string;
  /** Etiqueta ya resuelta: "Apoyo Laboral" | "Tu Alianza" | el crudo si es desconocido. */
  temporal?: string;
  numeroContrato?: string;
  /** EPS normalizada con `trim()`. */
  eps: string;
  /** Fondo de pension obligatoria: viene de `afp.afp`, NUNCA de `afp.afc` (cesantias). */
  afp?: string;
  /** No existe como dato en ninguna tabla: se elige a mano, por defecto "ARL SURA". */
  arl?: string;

  // ── Incapacidad ─────────────────────────────────────────────────────
  tipoIncapacidad: TipoIncapacidad;
  /** `yyyy-MM-dd`. */
  fechaInicio: string;
  /** `yyyy-MM-dd`. */
  fechaFin: string;
  codigoDiagnostico: string;
  descripcionDiagnostico?: string;
  /** Numero impreso en el documento de la EPS/IPS. */
  numeroIncapacidad?: string;
  /* esProrroga, prorrogaDeId y responsablePago NO se envian: los decide el motor
     de reglas del servidor y el DTO de creacion ni siquiera los declara. */
  nitIps?: string;
  /** El backend lo llama `ipsNombre`, no `nombreIps`. */
  ipsNombre?: string;

  // ── Gestion documental ──────────────────────────────────────────────
  estadoDocumento: EstadoDocumento;
  /** Reunion 2026-08-20: si el soporte ya viene transcrito por la IPS. null = sin marcar. */
  transcrita?: boolean | null;
  soportesCargados?: TipoSoporte[];
  observaciones?: string;

  // ── Trazabilidad (autocompletado desde el usuario logueado) ─────────
  /** Sede/oficina. Obligatoria: nunca se guarda vacia. */
  oficina: string;
  /** Nombre de quien recibe: sale del usuario logueado. El backend lo llama `recibidoPor`. */
  recibidoPor: string;
  /** Id del usuario en sesion, para trazabilidad. */
  recibidoPorId?: string;
  /** Quien ejecuta la accion; hoy el gateway no inyecta los headers X-User-*. */
  actor?: string;
  actorRol?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Lectura (GET /Incapacidades/v2/{id} y GET /Incapacidades/v2)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Soporte YA VINCULADO a la incapacidad v2: espeja el `SoporteResponse` que
 * devuelven `POST` y `GET /Incapacidades/v2/{id}/soportes`.
 *
 * Los nombres son EXACTAMENTE los `@JsonProperty` del backend (no inventar:
 * un nombre de mas en una peticion se paga con un 400).
 *
 * Hay UN soporte por (incapacidad, tipo): volver a subir el mismo tipo
 * reemplaza el vinculo anterior, no acumula filas.
 */
export interface SoporteIncapacidad {
  id: number;
  incapacidadId: number;
  tipo: TipoSoporte;
  /** Etiqueta legible del tipo, ya resuelta por el backend. */
  tipoEtiqueta?: string;
  nombreArchivo?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  /** Id del documento en ms-documents; null mientras el estado sea PENDIENTE_SYNC. */
  documentId?: number | null;
  /** Puede venir relativo (`/media/...`): resolverlo con `urlAbsolutaDocumento`. */
  fileUrl?: string | null;
  versionNumber?: number | null;
  /** Actor que subio el archivo (X-User-Email o el `actor` del cuerpo). */
  subidoPor?: string | null;
  /** ISO 8601 con hora (Instant del backend). */
  subidoEn?: string;
  estado: EstadoSoporte;
}

/** Respuesta de `GET /Incapacidades/v2/{id}/soportes`. */
export interface ListaSoportesResponse {
  incapacidadId: number;
  soportes: SoporteIncapacidad[];
}

/** Detalle completo: `IncapacidadV2Response` del backend. */
/**
 * Respuesta de GET/POST/PUT /Incapacidades/v2 (`IncapacidadV2Response` del backend).
 *
 * NO extiende `CrearIncapacidadV2Request`: son contratos DISTINTOS. La peticion
 * de creacion no lleva los campos que decide el motor de reglas (esProrroga,
 * responsablePago, diasEmpresa...) y la respuesta si los trae. Heredar uno del
 * otro fue lo que produjo el 400 "Unrecognized field": el formulario enviaba
 * campos de lectura que el DTO de escritura no declara.
 *
 * Los nombres de abajo estan copiados uno a uno de los @JsonProperty del backend.
 * Casi todo es opcional a proposito: el backend puede dejar nulos los calculados
 * mientras la incapacidad esta en RECIBIDA.
 */
export interface IncapacidadV2 {
  id: number;
  /** Clave de negocio: cedula + '_' + fechaInicio(yyyyMMdd). El backend NO devuelve `consecutivoSistema`. */
  codigoUnico?: string;
  /** Codigo VISIBLE de cartera (V47): {AP|TA}{SEDE}{n}, ej. TASB018. Null en historicas. */
  codigoConsecutivo?: string | null;
  /** Sigla de la sede (MD, RS, FAP, TC, SB...). */
  codigoSede?: string | null;

  // ── Trabajador ──────────────────────────────────────────────────────
  cedula?: string;
  tipoDocumento?: string;
  primerApellido?: string;
  segundoApellido?: string;
  primerNombre?: string;
  segundoNombre?: string;
  /** Lo arma el backend; en la peticion de creacion NO se envia. */
  nombreCompleto?: string;
  fechaNacimiento?: string;
  edad?: number;
  sexo?: string;
  empresa?: string;
  centroCosto?: string;
  temporal?: string;
  numeroContrato?: string;
  fechaIngreso?: string;
  eps?: string;
  afp?: string;
  arl?: string;
  celular?: string;
  correo?: string;

  // ── Recepcion ───────────────────────────────────────────────────────
  oficina?: string;
  recibidoPor?: string;
  recibidoPorId?: string;

  // ── Incapacidad ─────────────────────────────────────────────────────
  tipoIncapacidad?: TipoIncapacidad;
  tipoIncapacidadEtiqueta?: string;
  fechaInicio?: string;
  fechaFin?: string;
  dias?: number;
  codigoDiagnostico?: string;
  descripcionDiagnostico?: string;
  nitIps?: string;
  ipsNombre?: string;
  numeroIncapacidad?: string;

  // ── Calculado por el motor de reglas (solo lectura) ─────────────────
  esProrroga?: boolean;
  prorrogaDeId?: number | null;
  tieneTraslape?: boolean;
  cumpleCotizacion?: boolean;
  diasDesdeIngreso?: number;
  estaPrescrita?: boolean;
  diasHabilesTranscurridos?: number;
  diasEmpresa?: number;
  diasEntidad?: number;
  responsablePago?: ResponsablePago;
  responsablePagoEtiqueta?: string;
  entidadResponsable?: EntidadResponsable;
  diasAcumuladosDiagnostico?: number;

  // ── Workflow ────────────────────────────────────────────────────────
  estado?: EstadoIncapacidad;
  estadoEtiqueta?: string;
  estadoDocumento?: EstadoDocumento;
  estadoDocumentoEtiqueta?: string;
  /** Reunion 2026-08-20: si el soporte ya viene transcrito por la IPS. null = sin marcar. */
  transcrita?: boolean | null;
  observaciones?: string;
  /**
   * SOLO LECTURA: desde la v2 de soportes esta lista la manda el SERVIDOR, que
   * la recalcula en cada subida/borrado a partir de las filas reales de
   * `incapacidad_soporte`. Lo que el formulario declare al crear/actualizar es
   * una intencion; esto es el estado real. De aqui salen R9 y R11.
   */
  soportesCargados?: string[];
  activo?: boolean;

  // ── Historico importado (V45) ───────────────────────────────────────
  /** `HISTORICO` = importada de los formularios viejos; null = nacida aqui. */
  origen?: string | null;
  /** Link de Drive del documento original de la fila importada. */
  docExternoUrl?: string | null;

  // ── Auditoria (ISO-8601) ────────────────────────────────────────────
  creadoPor?: string;
  creadoEn?: string;
  actualizadoPor?: string;
  actualizadoEn?: string;

  // ── Extras ──────────────────────────────────────────────────────────
  soportes?: SoporteIncapacidad[];
  validacion?: ValidacionResponse;
}

/** Fila de la tabla: `IncapacidadResumenResponse` del backend. */
export interface IncapacidadResumen {
  id: number;
  /** Lo que el backend v2 REALMENTE serializa como identificador de negocio. */
  codigoUnico?: string;
  /** Codigo VISIBLE de cartera (V47): {AP|TA}{SEDE}{n}, ej. TASB018. Null en historicas. */
  codigoConsecutivo?: string | null;
  /** Sigla de la sede (MD, RS, FAP, TC, SB...). */
  codigoSede?: string | null;
  /** Nombre del contrato viejo; el backend v2 no lo envia (se cae a codigoUnico). */
  consecutivoSistema?: string;
  cedula: string;
  tipoDocumento?: string | null;
  /** APELLIDOS primero (reunion 2026-08-20). */
  nombreCompleto: string;
  edad?: number | null;
  sexo?: string | null;
  fechaIngreso?: string | null;
  celular?: string | null;
  correo?: string | null;
  tipoIncapacidad: TipoIncapacidad;
  /** `yyyy-MM-dd`. */
  fechaInicio: string;
  /** `yyyy-MM-dd`. */
  fechaFin: string;
  dias: number;
  estado: EstadoIncapacidad;
  estadoDocumento: EstadoDocumento;
  /** Reunion 2026-08-20: marcada por el usuario; null = sin marcar. */
  transcrita?: boolean | null;
  responsablePago: ResponsablePago;
  eps: string;
  empresa?: string;
  centroCosto?: string;
  oficina?: string;
  codigoDiagnostico?: string;
  descripcionDiagnostico?: string | null;
  numeroIncapacidad?: string | null;
  ipsNombre?: string | null;
  recibidoPor?: string | null;
  esProrroga?: boolean;
  tieneTraslape?: boolean;
  estaPrescrita?: boolean;
  tieneSoportes?: boolean;
  /** Para pintar el punto rojo/amarillo en la fila. */
  nivelAlertaMaximo?: NivelAlerta | null;
  creadoEn?: string;
  // ── Radicacion (V44); opcionales para tolerar backends anteriores ────
  numeroRadicado?: string | null;
  /** `yyyy-MM-dd`. */
  fechaRadicado?: string | null;
  dondeRadicado?: DondeRadicado | null;
  dondeRadicadoEtiqueta?: string | null;
  radicadoPor?: string | null;
  semanaRadicacion?: number | null;
  entidadGrupo?: 'APOYO' | 'ALIANZA' | null;
  entidadGrupoEtiqueta?: string | null;
}

/** Filtros aceptados por `GET /Incapacidades/v2`. */
export interface FiltrosIncapacidadV2 {
  /** Texto libre: cedula, nombre o consecutivo. */
  q?: string;
  cedula?: string;
  estado?: EstadoIncapacidad;
  estadoDocumento?: EstadoDocumento;
  tipoIncapacidad?: TipoIncapacidad;
  responsablePago?: ResponsablePago;
  eps?: string;
  empresa?: string;
  centroCosto?: string;
  oficina?: string;
  /** Rango sobre `fechaInicio` (extremo inferior), `yyyy-MM-dd`. */
  desde?: string;
  /** Rango sobre `fechaInicio` (extremo superior; el backend lo aliasa a fechaInicioHasta). */
  hasta?: string;
  // ── Radicacion (V44) ─────────────────────────────────────────────────
  numeroRadicado?: string;
  semanaRadicacion?: number | string;
  entidadGrupo?: 'APOYO' | 'ALIANZA' | '';
  /** Rango sobre `fechaRadicado`, `yyyy-MM-dd`. */
  fechaRadicadoDesde?: string;
  fechaRadicadoHasta?: string;
}

/**
 * Pagina estilo Spring Data (`Page<T>`).
 * Los campos opcionales se declaran asi para tolerar respuestas recortadas.
 */
export interface Page<T> {
  content: T[];
  /** Indice de pagina, base 0. */
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first?: boolean;
  last?: boolean;
  numberOfElements?: number;
  empty?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Promocion a VALIDADA (POST /Incapacidades/v2/{id}/validar)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resultado normalizado de promover una incapacidad a VALIDADA.
 * El 409 del backend NO se propaga como error: se traduce a
 * `{ ok: false, motivosBloqueo }` para que la UI lo pinte.
 */
export interface ResultadoPromocion {
  ok: boolean;
  /** Vacio cuando `ok === true`. */
  motivosBloqueo: string[];
  /** Detalle devuelto por el backend en el 200, si lo envia. */
  incapacidad?: IncapacidadV2;
}

// ─────────────────────────────────────────────────────────────────────────
// Endpoints de contratacion reutilizados
// ─────────────────────────────────────────────────────────────────────────

/** Fila de `GET /contratacion/empleados/buscar?q=&limit=`. */
export interface EmpleadoBusqueda {
  cedula: string;
  nombreCompleto: string;
  tipoDocumento: string;
  empresa: string;
  centroCosto: string;
  /** Codigo crudo: "AL" | "TA" (a veces nulo o con ruido). */
  temporal: string;
  numeroContrato: string;
  /** `yyyy-MM-dd`. */
  fechaIngreso: string;
  /** Puede llegar con espacios finales ("NUEVA EPS "). */
  eps: string;
  afp: string;
  oficina: string;
}

/**
 * `GET /contratacion/datosIncapacidadContratacion/{cedula}`.
 * Se conservan los nombres snake_case tal cual los devuelve el backend
 * legacy; el mapeo a camelCase lo hace la vista.
 */
export interface DatosContratacionResponse {
  datos_basicos?: DatosBasicosContratacion;
  contratacion?: BloqueContratacion;
  afp?: BloqueAfp;
}

export interface DatosBasicosContratacion {
  numerodeceduladepersona?: string;
  tipodedocumento?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  primer_nombre?: string;
  segundo_nombre?: string;
  /** Contratacion lo devuelve como `genero` (el modelo de incapacidad lo llama `sexo`). */
  genero?: string;
  primercorreoelectronico?: string;
  celular?: string;
  whatsapp?: string;
  /** TEXTO en dos formatos mezclados (ISO y dd/MM/yyyy) + basura: usar `parsearFechaFlexible`. */
  fecha_nacimiento?: string;
  oficina?: string;
  /** Solo poblado en el 41% de los casos: NO usarlo, calcular desde `fecha_nacimiento`. */
  edadTrabajador?: string | number | null;
}

export interface BloqueContratacion {
  codigo_contrato?: string;
  fecha_contratacion?: string;
  /** Codigo crudo "AL" | "TA". */
  temporal?: string;
  cargo?: string;
  fechaIngreso?: string;
  centro_de_costos?: string;
  centro_costo_carnet?: string;
  /** Llega con espacios finales: normalizar con `trim()`. */
  nombre_eps_afiliada?: string;
  nombre_afp?: string;
  empresaUsuaraYCCentrodeCosto?: string;
}

export interface BloqueAfp {
  /** EPS. */
  eps?: string;
  /** Pension obligatoria: ESTE es el fondo de pensiones. */
  afp?: string;
  /** Cesantias. NO es el fondo de pension (bug del formulario viejo). */
  afc?: string;
}

/** Fila de `GET /Incapacidades/codigos-diagnostico/search`. */
export interface CodigoDiagnostico {
  codigo: string;
  descripcion: string;
}

/** Fila de `GET /Incapacidades/ips/search`. */
export interface IpsBusqueda {
  nit: string;
  nombre: string;
}

/** Respuesta de `GET /Incapacidades/traerTodaslistas`. */
export interface ListasIncapacidad {
  codigos: CodigoDiagnostico[];
  eps: unknown[];
  IPSNames: unknown[];
}

/* La antigua `SubidaSoporteResponse` (respuesta del multipart LEGACY
   `POST /Incapacidades/{consecutivo}/documentos/upload`) se elimino: ese
   endpoint resuelve el consecutivo contra la tabla vieja y devuelve 404 para
   una incapacidad del modelo nuevo. La subida ahora vive en
   `POST /Incapacidades/v2/{id}/soportes` y responde `SoporteIncapacidad`. */

// ─────────────────────────────────────────────────────────────────────────
// Mapeos auxiliares que la UI necesita y que NO vienen del backend
// ─────────────────────────────────────────────────────────────────────────

/**
 * `temporal` llega como codigo crudo. La rama por defecto devuelve el valor
 * original saneado para que nunca reviente ni muestre "undefined".
 */
export function etiquetaTemporal(codigo: string | null | undefined): string {
  const crudo = (codigo ?? '').toString().trim().toUpperCase();
  switch (crudo) {
    case 'AL':
      return 'Apoyo Laboral';
    case 'TA':
      return 'Tu Alianza';
    case '':
      return '';
    default:
      return (codigo ?? '').toString().trim();
  }
}

/**
 * ARL de la plataforma. Definicion de la funcional (2026-08): la ARL es
 * SIEMPRE Sura para todos los clientes y NO se puede cambiar en el registro.
 * El campo se muestra bloqueado y siempre se envia este valor.
 */
export const ARL_POR_DEFECTO = 'ARL SURA';

// ─────────────────────────────────────────────────────────────────────────
// Matriz de EPS (V43): lista cerrada del selector + forma de cargue
// ─────────────────────────────────────────────────────────────────────────

/** Como exige cada EPS que se le entregue la documentacion al radicar. */
export type FormaCargueEps = 'UN_SOLO_PDF' | 'PDF_POR_DOCUMENTO';

/**
 * Una EPS de la matriz oficial de cartera (`GET /Incapacidades/v2/eps-matriz`).
 * Es la lista CERRADA que ofrece el selector del registro mientras contratacion
 * corrige su base de EPS.
 */
export interface EpsMatrizItem {
  nombre: string;
  formaCargue: FormaCargueEps;
  formaCargueEtiqueta: string;
  /** Solo Salud Total hoy: exige ademas su formulario propio (sufijo Sop). */
  requiereSoporteEps: boolean;
  orden: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Radicacion (V44)
// ─────────────────────────────────────────────────────────────────────────

/** Canal por el que se radico ante la EPS/ARL. */
export type DondeRadicado = 'CORREO' | 'PAGINA' | 'PUNTO_FISICO';

/** Un PDF de radicacion generado, con el nombre EXACTO que exige el portal. */
export interface ArchivoRadicacion {
  id: number;
  tipo: string;
  tipoEtiqueta: string;
  nombreArchivo: string;
  sizeBytes: number | null;
  documentId: number | null;
  /** `true` si ya quedo guardado en la gestion documental (ms-documents). */
  sincronizado: boolean;
  generadoEn: string | null;
}

/** Estado completo de la radicacion (`GET /Incapacidades/v2/{id}/radicacion`). */
export interface RadicacionIncapacidad {
  id: number;
  codigoUnico: string;
  estado: EstadoIncapacidad;
  estadoEtiqueta: string;
  /** "ARL SURA" en accidente/enfermedad laboral; la EPS en el resto. */
  epsDestino: string | null;
  formaCargue: FormaCargueEps;
  formaCargueEtiqueta: string;
  entidadGrupo: 'APOYO' | 'ALIANZA' | null;
  entidadGrupoEtiqueta: string | null;
  semanaRadicacion: number | null;
  numeroRadicado: string | null;
  fechaRadicado: string | null;
  dondeRadicado: DondeRadicado | null;
  dondeRadicadoEtiqueta: string | null;
  radicadoPor: string | null;
  archivos: ArchivoRadicacion[];
}

/** Registrar el radicado de UNA incapacidad. */
export interface RadicarPeticion {
  numeroRadicado: string;
  /** yyyy-MM-dd; por defecto hoy (lo pone el backend). */
  fechaRadicado?: string | null;
  dondeRadicado?: DondeRadicado | null;
  actor?: string;
  actorRol?: string;
}

/** Resultado por fila de la carga masiva de radicados. */
export interface FilaCargaMasivaRadicados {
  fila: number;
  cedula: string;
  fechaInicio: string;
  numeroRadicado: string;
  ok: boolean;
  mensaje: string;
  incapacidadId: number | null;
}

export interface ResultadoCargaMasivaRadicados {
  total: number;
  exitosos: number;
  fallidos: number;
  filas: FilaCargaMasivaRadicados[];
}

/** Trabajos asincronos de exportacion masiva. */
/** ZIP_SEVENET y EXCEL_BASE_ACTUAL: reunion funcional 2026-10-05 (SEVENET y boton "Base actual"). */
export type TipoExportJob = 'ZIP_SOPORTES' | 'EXCEL_CONSOLIDADO' | 'ZIP_SEVENET' | 'EXCEL_BASE_ACTUAL';
export type EstadoExportJob = 'PENDIENTE' | 'EN_PROCESO' | 'COMPLETADO' | 'ERROR';

export interface ExportJob {
  id: string;
  tipo: TipoExportJob;
  tipoEtiqueta: string;
  estado: EstadoExportJob;
  estadoEtiqueta: string;
  totalRegistros: number | null;
  procesados: number | null;
  nombreResultado: string | null;
  tamanoBytes: number | null;
  mensajeError: string | null;
  creadoEn: string | null;
}

/** Conteos de la cabecera en UNA llamada (`GET /Incapacidades/v2/resumen`). */
export interface ResumenIncapacidades {
  total: number;
  porEstado: Record<string, number>;
  porEstadoDocumento: Record<string, number>;
  sinSoportes: number;
}

/** Informe de proximos a 180/540 dias. */
export interface FilaInformeUmbral {
  incapacidadId: number;
  cedula: string;
  nombreCompleto: string;
  empresa: string | null;
  eps: string | null;
  afp: string | null;
  codigoDiagnostico: string | null;
  descripcionDiagnostico: string | null;
  diasAcumulados: number;
  fechaFinUltima: string | null;
  responsablePago: string | null;
  responsablePagoEtiqueta: string | null;
  tramo: 'PROXIMO_180' | 'SUPERA_180' | 'PROXIMO_540' | 'SUPERA_540';
  tramoEtiqueta: string;
}

export interface InformeUmbral {
  margenDias: number;
  total: number;
  filas: FilaInformeUmbral[];
}

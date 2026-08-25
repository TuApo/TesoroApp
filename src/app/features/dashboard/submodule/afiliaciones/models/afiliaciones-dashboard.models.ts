export interface AfiliacionesDateRange {
  start: Date;
  end: Date;
}

export interface AfiliacionesKpiSummary {
  totalIngresos: number;
  ingresosHoy: number;
  totalEmpresas: number;
  totalOficinas: number;
  totalContratados: number;
  totalPendientes: number;
}

export interface ContratacionRow {
  id: number;               // = proceso_id (id de fila de la vista)
  candidato_id?: number;    // clave para las acciones de afiliación (casos)
  numero_documento: string;
  primer_nombre: string;
  segundo_nombre: string;
  primer_apellido: string;
  segundo_apellido: string;
  nombre_completo: string;
  /** Temporal que contrata: Apoyo Laboral / Tu Alianza. */
  empresa: string;
  /** Empresa USUARIA (cliente donde trabaja la persona), razón social ya limpia. */
  empresa_usuaria?: string;
  /** Texto original del formulario: razón social + centro de costo + dirección. */
  empresa_usuaria_raw?: string;
  /** Clave normalizada de la empresa usuaria (la que viaja como filtro). */
  empresa_usuaria_key?: string;
  oficina: string;
  finca: string;
  cargo: string;
  /** Firma del contrato = COALESCE(fecha_contrato, fecha_contratacion_form). Anclaje del tablero. */
  fecha_firma_contrato: string;
  fecha_ingreso: string;
  estado: string;
  usuario_responsable: string;
  contratado_at: string;
  ingreso_at: string;
  examenes_medicos_at: string;
  autorizado_at: string;
  centro_costo: string;

  // Extras de afiliaciones (vista v_afiliacion_contratos)
  codigo_contrato?: string;
  registrado_at?: string;
  activo?: boolean;
  estado_afiliacion?: string;
  // 4 validadores de confirmación de ingreso
  ingreso_confirmado?: boolean;     // Validador 1: afiliaciones
  ingreso_confirmado_canal?: string;
  coord_confirmado?: boolean;       // Validador 2: coordinador de finca
  nomina_confirmado?: boolean;      // Validador 3: nómina
  pago_confirmado?: boolean;        // Validador 4: pago de seguridad social
  arl_estado?: string;
  // Datos críticos de la persona (foto)
  tipo_documento?: string;
  sexo?: string;
  fecha_nacimiento?: string;
  direccion?: string;
  barrio?: string;
  municipio?: string;
  departamento?: string;
  // Datos que pide el formato de afiliación (V35). El lugar de nacimiento ya existía en la
  // base; localidad/nacionalidad/pais son columnas nuevas y arrancan vacías.
  localidad?: string;
  nacionalidad?: string;
  pais?: string;
  departamento_nacimiento?: string;
  municipio_nacimiento?: string;
  eps?: string;
  afp?: string;
  caja_compensacion?: string;
  correo?: string;
  celular?: string;
  whatsapp?: string;
  salario?: string;
  // ADRES del robot (último por cédula)
  adres_estado?: string;   // estado actual de la persona en ADRES (ACTIVO/RETIRADO/…)
  adres_eps?: string;      // EPS registrada en ADRES
  adres_fecha?: string;    // cuándo lo consultó el robot

  /** Resumen del expediente de la fila (se carga después de la página, ver ResumenPersona). */
  resumen?: ResumenPersona;
}

/**
 * Una opción del selector de empresa usuaria.
 * `clave` es lo que se manda como filtro (normalizada: agrupa las dos escrituras del mismo
 * cliente que conviven en los datos); `etiqueta` es la variante legible, y `total` cuántas
 * contrataciones tiene — sirve para distinguir las empresas reales del ruido del formulario
 * (hay entradas sueltas que son nombres de personas, con 1 sola fila).
 */
export interface EmpresaUsuariaOpcion {
  clave: string;
  etiqueta: string;
  total: number;
}

// ── Detalle de caso (confirmación de ingreso por los 4 validadores) ──

export type Validador = 'AFILIACIONES' | 'COORDINADOR' | 'NOMINA' | 'PAGO_SEGURIDAD';
export type Canal = 'LLAMADA' | 'CORREO' | 'WHATSAPP';

export interface ContactoIntento {
  id: number;
  validador: string;
  origen: string;      // INDIVIDUAL | MASIVO
  canal: string;
  resultado: string;
  nota?: string;
  usuario?: string;
  created_at?: string;
}

/** Estado de un validador (para pintar la bandera + tooltip). */
export interface ValidadorEstado {
  confirmado: boolean;
  canal?: string;
  por?: string;
  at?: string;
  nota?: string;
}

export interface CasoDetalle {
  candidato_id: number;
  contrato: any | null;          // fila cruda de la vista (todos los datos)
  caso: any | null;              // overlay afiliacion_caso
  intentos: ContactoIntento[];
}

export interface CedulaDoc {
  found: boolean;
  cedula?: string;
  owner_id?: string;
  documentos: any[];             // metadatos de ms-documents (incluye fileUrl)
}

// ── Expediente de la persona (documentos + ADRES + traslados de EPS) ──

export type GrupoDoc = 'CEDULA' | 'ADRES' | 'TRASLADO';

/** Un documento del expediente, ya normalizado por ms-hr. */
export interface DocumentoExpediente {
  grupo: GrupoDoc;
  document_id: number;
  /** Obligatorio para descargar la versión correcta (sin él se sirve la is_current). */
  version_id?: number | null;
  /** Cédula con la que el documento hizo match: "de quién es" el archivo. */
  owner_id?: string;
  tipo?: string;
  archivo?: string;
  mime?: string;
  tamano_bytes?: number;
  version?: number;
  vigente?: boolean;
  subido_en?: string;
  registrado_en?: string;
}

/** Lo que el robot leyó en ADRES para esta cédula. */
export interface AdresDatos {
  cedula?: string;
  tipo_documento?: string;
  /** Nombre que devolvió ADRES (sirve para verificar que la consulta es de esta persona). */
  nombre_reportado?: string;
  estado?: string;
  entidad?: string;
  regimen?: string;
  tipo_afiliacion?: string;
  fecha_afiliacion_efectiva?: string;
  fecha_finalizacion_afiliacion?: string;
  fecha_adres?: string;
  departamento?: string;
  municipio?: string;
  consultado_at?: string;
}

export interface TrasladoExpediente {
  codigo: number;
  cedula?: string;
  eps_a_trasladar?: string;
  eps_trasladada?: string;
  estado?: string;
  observacion?: string;
  radicado?: string;
  fecha_efectividad?: string;
  cantidad_beneficiarios?: string;
  responsable?: string;
  asignacion_correo?: string;
  solicitado_en?: string;
  activo?: boolean;
  documento?: DocumentoExpediente | null;
}

export interface ConteoGrupo {
  grupo: GrupoDoc;
  mostrados: number;
  total: number;
}

export interface Expediente {
  candidato_id: number;
  cedula?: string;
  nombre_completo?: string;
  /** Formas de la cédula con las que se encontró algo (con/sin prefijo 'X'). */
  owners_con_match: string[];
  adres: AdresDatos | null;
  /** Lo que se marcó en el formulario de contratación (columna traslado_eps). */
  traslado_eps_formulario?: string | null;
  traslados: TrasladoExpediente[];
  documentos: DocumentoExpediente[];
  conteos: ConteoGrupo[];
}

/** Resumen por persona para pintar la fila de la tabla sin abrir el expediente. */
export interface ResumenPersona {
  cedula: string;
  docs_cedula: number;
  docs_adres: number;
  docs_traslado: number;
  traslado_codigo?: number | null;
  traslado_estado?: string | null;
  traslado_eps_a_trasladar?: string | null;
  traslado_solicitado_en?: string | null;
  traslados_total: number;
}

export interface MasivoResult {
  solicitados: number;
  procesados: number;
  fallidos: number[];
}

export interface ResumenPorOficina {
  oficina: string;
  total: number;
  contratados: number;
  pendientes: number;
}

export interface ResumenPorEmpresa {
  empresa: string;
  total: number;
  contratados: number;
  pendientes: number;
}

// ── Agregaciones server-side (endpoints /contratos/resumen, /timeline, /catalogos) ──

/** Un punto de la serie temporal: día + etiqueta de la dimensión + conteo. */
export interface TimelinePoint {
  fecha: string;   // 'YYYY-MM-DD'
  label: string;
  total: number;
}

/** Página de la tabla consolidada (paginación server-side). */
export interface ContratacionesPage {
  rows: ContratacionRow[];
  total: number;
}

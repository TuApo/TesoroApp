import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import { isPlatformBrowser } from '@angular/common';
import { sinTildes, sinTildesDeep } from '../../shared/sin-tildes.helper';

export interface CandidatoUpsertPayload {
  tipoDoc: string;
  numeroCedula: string;

  pApellido?: string;
  sApellido?: string;
  pNombre?: string;
  sNombre?: string;
  genero?: string;

  correo?: string;
  numCelular?: string;
  numWha?: string;

  departamento?: string;
  ciudad?: string;
  estadoCivil?: string;

  direccionResidencia?: string;
  barrio?: string;

  fechaExpedicionCc?: string;
  departamentoExpedicionCc?: string;
  municipioExpedicionCc?: string;
  lugarNacimientoDepartamento?: string;
  lugarNacimientoMunicipio?: string;

  rh?: string;
  zurdoDiestro?: string;

  tiempoResidenciaZona?: string;
  lugarAnteriorResidencia?: string;
  razonCambioResidencia?: string;
  zonasConocidas?: string;
  preferenciaResidencia?: string;

  fechaNacimiento?: string;
  estudiaActualmente?: string | boolean;

  familiarEmergencia?: string;
  parentescoFamiliarEmergencia?: string;
  direccionFamiliarEmergencia?: string;
  barrioFamiliarEmergencia?: string;
  telefonoFamiliarEmergencia?: string;
  ocupacionFamiliarEmergencia?: string;

  oficina?: string;

  escolaridad?: string;
  estudiosExtra?: string;
  nombreInstitucion?: string;
  anoFinalizacion?: string; // ISO
  tituloObtenido?: string;

  chaqueta?: string | number;
  pantalon?: string | number;
  camisa?: string | number;
  calzado?: string | number;

  nombreConyugue?: string;
  apellidoConyugue?: string;
  numDocIdentidadConyugue?: string;
  viveConElConyugue?: string;
  direccionConyugue?: string;
  telefonoConyugue?: string;
  barrioMunicipioConyugue?: string;
  ocupacionConyugue?: string;

  nombrePadre?: string;
  vivePadre?: boolean;
  ocupacionPadre?: string;
  direccionPadre?: string;
  telefonoPadre?: string;
  barrioPadre?: string;

  nombreMadre?: string;
  viveMadre?: boolean;
  ocupacionMadre?: string;
  direccionMadre?: string;
  telefonoMadre?: string;
  barrioMadre?: string;

  nombreReferenciaPersonal1?: string;
  telefonoReferenciaPersonal1?: string;
  ocupacionReferenciaPersonal1?: string;
  tiempoConoceReferenciaPersonal1?: string;
  direccionReferenciaPersonal1?: string;

  nombreReferenciaPersonal2?: string;
  telefonoReferenciaPersonal2?: string;
  ocupacionReferenciaPersonal2?: string;
  tiempoConoceReferenciaPersonal2?: string;
  direccionReferenciaPersonal2?: string;

  nombreReferenciaFamiliar1?: string;
  telefonoReferenciaFamiliar1?: string;
  ocupacionReferenciaFamiliar1?: string;
  parentescoReferenciaFamiliar1?: string;
  tiempoConoceReferenciaFamiliar1?: string;
  direccionReferenciaFamiliar1?: string;

  nombreReferenciaFamiliar2?: string;
  telefonoReferenciaFamiliar2?: string;
  ocupacionReferenciaFamiliar2?: string;
  parentescoReferenciaFamiliar2?: string;
  tiempoConoceReferenciaFamiliar2?: string;
  direccionReferenciaFamiliar2?: string;

  nombreExpeLaboral1Empresa?: string;
  direccionEmpresa1?: string;
  telefonosEmpresa1?: string;
  nombreJefeEmpresa1?: string;
  fechaRetiroEmpresa1?: string;
  motivoRetiroEmpresa1?: string;
  cargoEmpresa1?: string;

  empresas_laborado?: string;
  labores_realizadas?: string;

  rendimiento?: string;
  porqueRendimiento?: string;

  familiaConUnSoloIngreso?: boolean;
  numHabitaciones?: string | number;
  numPersonasPorHabitacion?: string | number;
  tipoVivienda2p?: string;
  caracteristicasVivienda?: string;

  malentendido?: string;
  experienciaLaboral?: boolean;

  porqueLofelicitarian?: string;
  areaExperiencia?: string;
  areaCultivoPoscosecha?: string;

  laboresRealizadas?: string;
  tiempoExperiencia?: string;

  actividadesDi?: string;
  numHijosDependientes?: number;
  cuidadorHijos?: string;

  experienciaSignificativa?: string;
  motivacion?: string;

  fuenteVacante?: string;
  expectativasDeVida?: string;
  servicios?: string;
  tipoVivienda?: string;
  personasConQuienConvive?: string;
  personas_a_cargo?: string;

  hijos?: any[]; // si luego los manejas
}

export interface CandidatoUpsertResponse {
  ok: boolean;
  created: boolean;
  candidato_id: number;
  tipo_doc: string;
  numero_documento: string;
}



// ===== Listado y filtros generales =====
export interface ListOptions {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  /** Filtros adicionales (coinciden con filterset_fields del DRF o cualquier campo) */
  filters?: Record<string, any>;
}

type TipoBio = 'firma' | 'huella' | 'foto';

/** Payload aceptado por /procesos/seleccion y /procesos/seleccion-by-document */
export interface AntecedentesPayload {
  eps?: string | null;
  afp?: string | null;
  policivos?: string | null;
  procuraduria?: string | null;
  contraloria?: string | null;
  ramaJudicial?: string | null;
  sisben?: string | null;
  ofac?: string | null;
  medidasCorrectivas?: string | number | null; // "CUMPLE" | "NO CUMPLE" | número | ''
  semanasCotizadas?: number | null;
}

export interface ProcesoSeleccionResponse {
  procesoSeleccion: AntecedentesPayload;
}

// ===== Examen médico =====
/** Bloque que espera el backend (los arrays van como JSON.stringify([...])) */
export interface ExamenMedicoUpsertPayload {
  ips?: string | null;
  ips_lab?: string | null;
  /** JSON.stringify([...]) */
  examenes?: string | null;
  /** JSON.stringify([{ aptoStatus: 'APTO' | 'NO APTO' }, ...]) */
  resultados?: string | null;
}

// ===== Contrato: control de generación de código =====
/**
 * `sede_abbr` es una PISTA para elegir el rango de numeración de la oficina;
 * si no llega, el backend la resuelve desde la entrevista. Acepta tanto la
 * abreviatura (FPC, TOC, SUB...) como el nombre completo de la sede.
 *
 * La generación es idempotente: un contrato que ya tiene código lo conserva,
 * así que mandar `generar_codigo: true` siempre es seguro.
 */
export type ContratoCodigoRequest = { generar_codigo: boolean; sede_abbr?: string };

// ===== Request principal: /procesos/update-by-document/ =====
export interface ProcesoUpdateByDocumentRequest {
  numero_documento: string;
  /**
   * Proceso EXACTO a modificar. Sin esto el backend resuelve la ÚLTIMA
   * entrevista del candidato, que no siempre es la del contrato cuando la
   * persona vuelve y se le abre un turno nuevo.
   */
  proceso_id?: number | null;
  publicacion?: number | null;
  vacante_tipo?: string | null;
  vacante_salario?: string | null;
  prueba_tecnica?: boolean;
  /** Marca el resultado "no pasó la prueba técnica" (con motivo). */
  no_paso_prueba_tecnica?: boolean;
  /** Motivo por el que no pasó la prueba técnica. */
  motivo_no_paso_prueba_tecnica?: string | null;
  /** Marca el resultado "pasó la prueba técnica" (excluyente con no_paso). */
  paso_prueba_tecnica?: boolean;
  /** Motivo por el que no se presentó a la prueba técnica. */
  motivo_no_se_presento_prueba_tecnica?: string | null;
  /** Resultado del examen médico (excluyentes entre sí). */
  paso_examen_medico?: boolean;
  no_paso_examen_medico?: boolean;
  motivo_no_paso_examen_medico?: string | null;
  no_se_presento_examen_medico?: boolean;
  motivo_no_se_presento_examen_medico?: string | null;
  autorizado?: boolean;
  vacante_fecha_prueba?: string | null;

  // ✅ nuevos
  contratado?: boolean;
  contrato_detalle?: {
    forma_de_pago?: string | null;
    numero_para_pagos?: string | null;
    identification_number_tarjeta?: string | null; // New field
    seguro_funerario?: boolean | null;
    Ccentro_de_costos?: string | null;
    porcentaje_arl?: number | null;
    cesantias?: string | null;
    subcentro_de_costos?: string | null;
    grupo?: string | null;
    categoria?: string | null;
    operacion?: string | null;
    horas_extras?: boolean | null;
    desea_trasladarse?: boolean | null;
    seleccion_eps?: string | null;
    contrasenia_asignada?: string | null;
    // Datos de obra/empresa para documentos (editables; prellenados desde la vacante).
    descripcion_de_obra?: string | null;
    centro_costo_obra?: string | null;
    direccion_empresa?: string | null;
    empresa_usuaria?: string | null;
  };

  examen_medico?: ExamenMedicoUpsertPayload;
  ips?: string | null;
  ips_lab?: string | null;
  examenes?: string | null;
  resultados?: string | null;

  contrato?: ContratoCodigoRequest;

  /**
   * Override "Modificar de todas formas": edición pura de una persona con contrato
   * activo (sin darle de baja). El backend NO reinicia banderas ni abre proceso
   * nuevo, y sella la auditoría con `modificado_por` + fecha/hora del servidor.
   */
  modificacion_forzada?: boolean;
  /** Nombre del usuario que ejecuta el override (auditoría). */
  modificado_por?: string | null;
}


// ===== DTO que devuelve el backend para un Proceso =====
export interface ProcesoDto {
  id: number;
  entrevista: number; // o un objeto según tu serializer; ajusta si hace falta
  publicacion: number | null;
  vacante_tipo: string | null;
  vacante_salario: string | null;
  prueba_tecnica: boolean;
  prueba_tecnica_at: string | null;
  autorizado: boolean;
  autorizado_at: string | null;

  /** Campo inyectado por backend cuando se genera o ya existía */
  contrato_codigo?: string | null;

  /** Permite campos adicionales del serializer sin romper el tipado */
  [k: string]: any;
}

// ===== Respuesta del endpoint /procesos/update-by-document/ =====
export interface UpdateByDocumentResponse {
  message: 'updated';
  proceso: ProcesoDto;
}

export interface ProcesoMini {
  id: number;
  oficina: string | null;
  entrevista_created_at: string; // ISO
  aplica_o_no_aplica: string | null;
  motivo_no_aplica: string | null;
  motivo_espera: string | null;
  detalle: string | null;
}

export interface EnEsperaItem {
  tipo_doc: string | null;
  numero_documento: string;         // texto
  apellidos_nombres: string | null;
  tiene_experiencia: 'SI' | 'NO';
  barrio: string | null;
  area_experiencia: string | null;
  celular: string | null;
  whatsapp: string | null;
  motivo_espera: string | null;
}

/** Fuentes de antecedentes que consulta el robot (6 bloqueantes). */
export type AntecedenteFuente =
  | 'contraloria' | 'adress' | 'sisben' | 'policivo' | 'procuraduria' | 'ofac';

/** Estado por fuente tal cual lo expone EstadoRobotActual del backend. */
export type AntecedenteEstadoFuente =
  | 'SIN_CONSULTAR' | 'EN_PROGRESO' | 'FINALIZADO' | 'BLOQUEADO'
  | 'RECHAZADO_INCUMPLIMIENTO' | null;

/**
 * Estado de antecedentes del robot para una cédula (EstadosRobots).
 * Permite saber si esa cédula ya está siendo consultada o si el robot ya
 * terminó con los antecedentes (documentos del día listos).
 */
export interface AntecedentesEstado {
  // NO_REGISTRADO = la cédula aún no está en la cola del robot.
  estado_general: 'NO_REGISTRADO' | 'SIN_CONSULTAR' | 'EN_PROGRESO' | 'FINALIZADO';
  consultando: boolean;   // alguna fuente EN_PROGRESO ahora mismo
  completado: boolean;    // las 6 fuentes en estado terminal
  finalizadas: number;    // cuántas de las 6 ya terminaron
  total: number;          // 6
  fuentes: Record<AntecedenteFuente, AntecedenteEstadoFuente>;
  fecha_completado?: string | null;  // ISO; cuándo se selló completed_at
  updated_at?: string | null;        // ISO; última actualización del robot
}

export interface CandidatoRecienteItem {
  candidato_id: number;
  tipo_doc: string | null;
  numero_documento: string;
  primer_nombre: string | null;
  segundo_nombre: string | null;
  primer_apellido: string | null;
  segundo_apellido: string | null;
  apellidos_nombres: string | null;
  celular: string | null;
  whatsapp: string | null;
  oficina: string | null;
  updated_at: string | null;  // ISO
  // Datos adicionales en la tabla de turnos:
  barrio?: string | null;
  // Municipio y departamento de residencia:
  municipio?: string | null;
  departamento?: string | null;
  edad?: number | null;
  tiene_experiencia?: boolean;
  // En qué tiene experiencia (detalle, no sólo Sí/No):
  area_experiencia?: string | null;
  anios_experiencia?: number | null;
  // Estado de los antecedentes del robot para esta cédula:
  antecedentes?: AntecedentesEstado | null;
  // Progreso del formulario web (tu_alianza_web / Tu-Apo-Web):
  // 0 = sin iniciar, 1 = guardó datos básicos, 5 = envió formulario completo.
  formulario_paso?: number;
  formulario_completo?: boolean;
  // Atendido por el evaluador en TesoroApp:
  atendido_at?: string | null;  // ISO; null si nunca lo han atendido
  atendido_hoy?: boolean;       // true si atendido_at cae dentro del día local actual
  // Encolado (cola FIFO por sede):
  en_turno_at?: string | null;
  en_turno_oficina?: string | null;
  /** ¿Ya se le generó el carnet? (contrato.carnet_generado) */
  carnet_generado?: boolean;
}

export type RangoFechas = { start: string | Date; end: string | Date };

/**
 * Candidato asignado a una vacante (respuesta de
 * /procesos/candidatos-por-vacante/). snake_case tal cual lo sirve el backend.
 */
export interface CandidatoPorVacanteItem {
  proceso_id: number;
  tipo_doc: string | null;
  numero_documento: string;
  primer_nombre: string | null;
  segundo_nombre: string | null;
  primer_apellido: string | null;
  segundo_apellido: string | null;
  apellidos_nombres: string | null;
  sexo: string | null;
  fecha_nacimiento: string | null;   // ISO (YYYY-MM-DD) o null
  estado_civil: string | null;
  direccion: string | null;
  barrio: string | null;
  celular: string | null;
  whatsapp: string | null;
  formacion: string | null;
  fecha_ingreso: string | null;      // ISO (YYYY-MM-DD) o null
  vacante_tipo: string | null;
  etapa: string | null;
  /** Resultado: el candidato fue remitido a prueba técnica pero no la pasó. */
  no_paso_prueba_tecnica?: boolean;
  /** ISO datetime en que se marcó "no pasó la prueba técnica" (o null). */
  no_paso_prueba_tecnica_at?: string | null;
  /** Motivo registrado de por qué no pasó la prueba técnica. */
  motivo_no_paso_prueba_tecnica?: string | null;
  /** El candidato no se presentó a la prueba técnica. */
  no_se_presento_prueba_tecnica?: boolean;
  /** ISO datetime en que se marcó "no se presentó" (o null). */
  no_se_presento_prueba_tecnica_at?: string | null;
  /** Motivo registrado de por qué no se presentó a la prueba técnica. */
  motivo_no_se_presento_prueba_tecnica?: string | null;
  /** Resultado del examen médico (excluyentes entre sí). */
  paso_examen_medico?: boolean;
  paso_examen_medico_at?: string | null;
  no_paso_examen_medico?: boolean;
  no_paso_examen_medico_at?: string | null;
  motivo_no_paso_examen_medico?: string | null;
  no_se_presento_examen_medico?: boolean;
  no_se_presento_examen_medico_at?: string | null;
  motivo_no_se_presento_examen_medico?: string | null;

  // ── Campos adicionales para los formatos por finca (Hato/Flores/Sagaro/San Carlos).
  //    Todos opcionales; el backend los llena solo si el candidato tiene el dato.
  rh?: string | null;                  // grupo sanguíneo (RH+)
  email?: string | null;               // correo electrónico
  municipio?: string | null;           // municipio de residencia
  departamento?: string | null;
  fecha_expedicion?: string | null;    // ISO YYYY-MM-DD
  lugar_expedicion?: string | null;    // "EXPEDIDA EN"
  lugar_nacimiento?: string | null;    // ciudad/municipio de nacimiento
  num_hijos?: number | null;
  contacto_emergencia?: string | null; // teléfono
  nombre_emergencia?: string | null;
  eps?: string | null;
  afp?: string | null;                 // fondo de pensión
  cesantias?: string | null;
  salario?: string | null;             // salario de la vacante
  calzado?: number | null;             // talla de calzado (dotación)
  talla_overol?: number | null;        // talla de camisa (= overol)
}


@Injectable({ providedIn: 'root' })
export class RegistroProcesoContratacion {
  private apiUrl = (environment.apiUrl || '').replace(/\/$/, '');
  private base = `${this.apiUrl}/gestion_contratacion`;

  constructor(private http: HttpClient, @Inject(PLATFORM_ID) private platformId: Object) { }

  /**
   * POST /gestion_contratacion/candidatos/upsert/
   * - Backend: upsert idempotente (crea o actualiza, sin duplicar).
   */
  upsertCandidato(payload: CandidatoUpsertPayload): Observable<CandidatoUpsertResponse> {
    const url = `${this.base}/candidatos/upsert/`;

    // (Opcional) Evitar llamadas desde SSR si aplica
    if (!isPlatformBrowser(this.platformId)) {
      return new Observable<CandidatoUpsertResponse>((sub) => {
        sub.next({
          ok: false,
          created: false,
          candidato_id: 0,
          tipo_doc: payload.tipoDoc,
          numero_documento: payload.numeroCedula,
        });
        sub.complete();
      });
    }

    return this.http.post<CandidatoUpsertResponse>(url, sinTildesDeep(payload, new Set(['correo'])));
  }

  /**
   * GET /gestion_contratacion/reporte/contratados-del-dia/?fecha=&oficina=
   * Cédulas con contrato creado ese día (cierre de contratación).
   */
  contratadosDelDia(fecha: string, oficina?: string): Observable<any> {
    let params = new HttpParams().set('fecha', fecha);
    if (oficina?.trim()) params = params.set('oficina', oficina.trim());
    return this.http.get(`${this.base}/reporte/contratados-del-dia/`, { params });
  }

  /**
   * POST /gestion_contratacion/reporte/candidatos-excel/
   * Base del cruce (Excel) armada desde gestion_contratacion para esas cédulas
   * — la misma lógica de "sacar la base por cédula".
   */
  exportarBaseCandidatos(cedulas: string[], persona?: string): Observable<Blob> {
    return this.http.post(`${this.base}/reporte/candidatos-excel/`,
      { cedulas, persona: persona || '' },
      { responseType: 'blob' });
  }

  /** Obtiene el Excel como Blob (con filtro opcional por oficina). */
  getEntrevistasExcel(range: RangoFechas, oficina?: string | string[]): Observable<Blob> {
    const start = this.formatDate(range.start);
    const end = this.formatDate(range.end);

    let params = new HttpParams().set('start', start).set('end', end);
    if (oficina) {
      const ofi = Array.isArray(oficina) ? oficina.join(',') : oficina;
      if (ofi.trim()) params = params.set('oficina', ofi.trim());
    }

    return this.http.get(`${this.base}/reporte/entrevistas-excel`, {
      params,
      responseType: 'blob'
    });
  }

  /**
   * GET /gestion_contratacion/candidatos/recientes/?limit=N&oficina=X
   * Lista por última actividad (consulta o llenado del formulario) DESC.
   * Idempotente por día en backend.
   */
  getCandidatosRecientes(limit: number = 50, oficina?: string | string[]): Observable<CandidatoRecienteItem[]> {
    let params = new HttpParams().set('limit', String(Math.max(1, Math.min(limit, 200))));
    if (oficina) {
      const ofi = Array.isArray(oficina) ? oficina.join(',') : oficina;
      if (ofi.trim()) params = params.set('oficina', ofi.trim());
    }
    return this.http.get<CandidatoRecienteItem[]>(this.url('candidatos/recientes'), { params })
      .pipe(this.handle$());
  }

  /**
   * POST /gestion_contratacion/candidatos/mark-attended/
   * Marca al candidato como atendido hoy (atendido_at = now()).
   * Tras marcar, en la lista de recientes baja al final del día.
   */
  markAttended(payload: { tipo_doc?: string | null; numero_documento?: string | null; candidato_id?: number }): Observable<{
    ok: boolean;
    candidato_id: number;
    tipo_doc: string;
    numero_documento: string;
    atendido_at: string;
  }> {
    return this.http.post<any>(this.url('candidatos/mark-attended'), payload).pipe(this.handle$());
  }

  /**
   * POST /gestion_contratacion/candidatos/encolar/
   * Encola la cédula en la sede del operador autenticado para la cola FIFO
   * del día. Idempotente por día Y sede. Requiere JWT con sede asignada.
   *
   * `accion` dice qué hizo el backend:
   *   sin_cambio             -> ya estaba en la cola de HOY en esta sede.
   *   encolada               -> entró por primera vez hoy.
   *   reencolada_otra_sede   -> estaba en la cola de otra sede (`oficina_anterior`).
   *   reencolada_tras_atender-> ya la habían atendido hoy y volvió al desk.
   */
  encolarCandidato(payload: { tipo_doc?: string | null; numero_documento?: string | null; candidato_id?: number }): Observable<{
    ok: boolean;
    candidato_id: number;
    tipo_doc: string;
    numero_documento: string;
    en_turno_at: string | null;
    en_turno_oficina: string | null;
    ya_estaba_en_cola: boolean;
    accion?: 'sin_cambio' | 'encolada' | 'reencolada_otra_sede' | 'reencolada_tras_atender';
    oficina_anterior?: string | null;
  }> {
    return this.http.post<any>(this.url('candidatos/encolar'), payload).pipe(this.handle$());
  }

  /**
   * POST /gestion_contratacion/candidatos/asegurar-estado-robot/
   * Asegura/actualiza la fila de antecedentes del robot (EstadosRobots) para
   * tipo_doc + cédula: crea si falta (cuando el Candidato ya existe), resetea si
   * está vencida (>15 días). Se llama al BUSCAR una cédula, independiente del
   * toggle de cola. Idempotente y tolerante a fallos.
   */
  asegurarEstadoRobot(payload: { tipo_doc?: string | null; numero_documento?: string | null }): Observable<{
    ok: boolean;
    numero_documento?: string;
    tipo_documento?: string;
    action?: string;
  }> {
    return this.http.post<any>(this.url('candidatos/asegurar-estado-robot'), payload).pipe(this.handle$());
  }

  /**
   * POST /gestion_contratacion/candidatos/forzar-consulta-antecedentes/
   * Re-abre AHORA las 8 fuentes de antecedentes (SIN_CONSULTAR + limpieza de
   * fechas/locks) para que la flota vuelva a consultar y suba PDFs nuevos.
   * A diferencia de `asegurarEstadoRobot`, no espera a que la fila esté
   * vencida. Cuesta una pasada completa de robots: confirmar antes de llamar.
   */
  forzarConsultaAntecedentes(payload: { tipo_doc?: string | null; numero_documento?: string | null }): Observable<{
    ok: boolean;
    numero_documento?: string;
    tipo_documento?: string;
    action?: string;
    reabierto?: boolean;
    mensaje?: string;
  }> {
    return this.http.post<any>(this.url('candidatos/forzar-consulta-antecedentes'), payload).pipe(this.handle$());
  }

  /**
   * Re-abre UNA sola fuente de antecedentes (no las 8).
   *
   * `fuente` ∈ adress | policivo | ofac | contraloria | sisben | procuraduria |
   * fondo_pension | medidas_correctivas. Es lo que usa el botón "Forzar
   * consultar" del documento vencido: re-consultar las 8 cuesta una pasada
   * completa de la flota y 2captcha de más.
   */
  forzarConsultaFuente(payload: {
    numero_documento: string;
    tipo_doc?: string | null;
    fuente: string;
  }): Observable<{
    ok: boolean;
    numero_documento?: string;
    fuente?: string;
    action?: string;
    reabierto?: boolean;
    mensaje?: string;
  }> {
    return this.http.post<any>(this.url('candidatos/forzar-consulta-fuente'), payload).pipe(this.handle$());
  }

  getUltimosEnEspera(oficina?: string | string[]): Observable<EnEsperaItem[]> {
    let options: { params?: HttpParams } = {};

    if (oficina && oficina.length) {
      const valor = Array.isArray(oficina) ? oficina.join(',') : oficina;
      options.params = new HttpParams().set('oficina', valor);
    }

    return this.http.get<EnEsperaItem[]>(
      `${this.base}/reporte/ultimos-en-espera`,
      options
    );
  }

  /**
   * GET /reporte/turnos-excel/?start=YYYY-MM-DD&end=YYYY-MM-DD&oficina=...
   * Descarga el Excel "profesional" del listado de turnos por orden de llegada
   * (filtra por last_activity_at). Tipos de datos consistentes para que VLOOKUP
   * y comparaciones funcionen sin sorpresas.
   */
  downloadTurnosExcel(
    range: RangoFechas,
    oficina?: string | string[],
    filename?: string
  ): Observable<void> {
    const start = this.formatDate(range.start);
    const end = this.formatDate(range.end);

    let params = new HttpParams().set('start', start).set('end', end);
    if (oficina) {
      const ofi = Array.isArray(oficina) ? oficina.join(',') : oficina;
      if (ofi.trim()) params = params.set('oficina', ofi.trim());
    }

    return this.http.get(`${this.base}/reporte/turnos-excel/`, {
      params,
      responseType: 'blob'
    }).pipe(
      tap(blob => {
        if (!isPlatformBrowser(this.platformId)) return;
        const finalName = this.safeFilename(
          filename || (start === end ? `turnos_${start}.xlsx` : `turnos_${start}_a_${end}.xlsx`)
        );
        this.triggerDownload(blob, finalName);
      }),
      map(() => undefined)
    );
  }

  /** Descarga directa del Excel (sin leer headers) y con filtro opcional por oficina. */
  downloadEntrevistasExcel(
    range: RangoFechas,
    oficina?: string | string[],
    filename?: string
  ): Observable<void> {
    const start = this.formatDate(range.start);
    const end = this.formatDate(range.end);

    let params = new HttpParams().set('start', start).set('end', end);
    if (oficina) {
      const ofi = Array.isArray(oficina) ? oficina.join(',') : oficina;
      if (ofi.trim()) params = params.set('oficina', ofi.trim());
    }

    return this.http.get(`${this.base}/reporte/entrevistas-excel`, {
      params,
      responseType: 'blob'
    }).pipe(
      tap(blob => {
        if (!isPlatformBrowser(this.platformId)) return;
        const finalName = this.safeFilename(filename || `entrevistas_${start}_a_${end}.xlsx`);
        this.triggerDownload(blob, finalName);
      }),
      map(() => undefined)
    );
  }


  // ===== Helpers =====

  private formatDate(d: string | Date): string {
    if (typeof d === 'string') return d;
    const dt = new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private safeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]+/g, '_');
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // =========================================================
  // Helpers genéricos
  // =========================================================
  private url(resource: string): string {
    return `${this.base}/${resource.replace(/^\//, '')}/`;
  }

  private buildParams(opts?: ListOptions): HttpParams {
    let params = new HttpParams();
    if (!opts) return params;

    const { page, page_size, search, ordering, filters } = opts;
    if (page != null) params = params.set('page', String(page));
    if (page_size != null) params = params.set('page_size', String(page_size));
    if (search) params = params.set('search', search);
    if (ordering) params = params.set('ordering', ordering);

    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v == null) return;
        if (Array.isArray(v)) {
          v.forEach((vv) => { if (vv != null) params = params.append(k, String(vv)); });
        } else {
          params = params.set(k, String(v));
        }
      });
    }
    return params;
  }

  private handle$<T>() {
    return (source: Observable<T>) =>
      source.pipe(
        map((resp) => resp),
        catchError((err) => throwError(() => err))
      );
  }

  /**
   * EL SOBRE DE `?full=1`, ABIERTO.
   *
   * `candidatos/by-document/{doc}?full=1` no devuelve al candidato: devuelve un
   * sobre con él dentro —`{candidato:{…}, contacto:{…}, residencia:{…},
   * entrevistas:[…]}`— mientras que TODA la aplicación lee los datos de la
   * persona en la raíz: `numero_documento`, `tipo_doc`, `primer_nombre`… (438
   * usos solo del primero). El resultado era una persona a medias: la ficha
   * decía "Sin nombre registrado" y "CC · —", y cada acción con guarda por
   * cédula —firmar, subir la cédula, la foto, los documentos— respondía "busca
   * primero a la persona" con la persona en pantalla.
   *
   * Se abre aquí, en el único sitio por el que pasan todos: los campos del
   * candidato suben a la raíz y las relaciones se quedan donde estaban. La
   * clave `candidato` se conserva por si alguien ya la leía anidada.
   *
   * Sin `?full=1` el backend devuelve el candidato plano y esto no toca nada.
   */
  private abrirSobreCandidato<T>() {
    return (source: Observable<T>) =>
      source.pipe(
        map((resp: any) => {
          const dentro = resp?.candidato;
          // Solo un sobre de verdad: un objeto con los datos de la persona.
          if (!dentro || typeof dentro !== 'object' || Array.isArray(dentro)) return resp;
          // La raíz manda sobre el interior: `contacto`, `entrevistas` y demás
          // relaciones no pueden quedar pisadas por lo que traiga el candidato.
          return { ...dentro, ...resp } as T;
        }),
      );
  }

  // =========================================================
  // CANDIDATOS (incluye tu mapeo/upper original)
  // =========================================================
  /** Back-compat: usa tu mapeo + upper salvo email/password */
  guardarInfoPersonal(form: any): Observable<any> {
    return this.createCandidatoFromForm(form);
  }

  /** Crea candidato con payload mapeado desde tu form (incluye entrevistas y asignación de turno en backend) */
  createCandidatoFromForm(form: any): Observable<any> {
    const payload = this.buildCandidatoPayload(form);
    const upperPayload = this.uppercaseDeepExcept(payload, new Set(['email', 'correo_electronico', 'password']));
    return this.http.post(this.url('candidatos'), upperPayload).pipe(this.handle$());
  }

  upsertCandidatoByDocumento(data: any): Observable<any> {
    const upper = this.uppercaseDeepExcept(data, new Set(['email', 'correo_electronico', 'password']));
    return this.http.patch(this.url('candidatos/by-document-upsert'), upper).pipe(this.handle$());
  }

  /**
   * Comodín: arma el payload desde el form y opcionalmente un proceso (p.ej. {entrevistado:true}).
   *
   * `override` lleva las banderas de "Modificar de todas formas". Van al nivel
   * raíz del payload (no dentro de `proceso`) porque el backend las lee de
   * `request.data` para decidir si edita la entrevista existente o abre una nueva.
   */
  upsertCandidatoByDocumentoFromForm(form: any, proceso?: any, override?: any): Observable<any> {
    const payload = this.buildCandidatoPayload(form, proceso);
    const upper = this.uppercaseDeepExcept(payload, new Set(['email', 'correo_electronico', 'password']));
    // El override conserva su casing (nombre del usuario) pero también va sin tildes.
    return this.http.patch(this.url('candidatos/by-document-upsert'), { ...upper, ...sinTildesDeep(override || {}) }).pipe(this.handle$());
  }

  // ===================== CANDIDATOS =====================

  // contratacion/candidatos-tabla/
  listCandidatosTabla(opts?: ListOptions): Observable<any[]> {
    return this.http
      .get<any[]>(this.url('contratacion/candidatos-tabla'), { params: this.buildParams(opts) })
      .pipe(this.handle$());
  }

  // Lista básica (serializer simple)
  listCandidatos(opts?: ListOptions): Observable<any[]> {
    return this.http
      .get<any[]>(this.url('candidatos'), { params: this.buildParams(opts) })
      .pipe(this.handle$());
  }

  // Lista completa (incluye relaciones) => usa ?full=1
  listCandidatosFull(opts?: ListOptions): Observable<any[]> {
    let params = this.buildParams(opts);
    params = params.set('full', '1');
    return this.http
      .get<any[]>(this.url('candidatos'), { params })
      .pipe(this.handle$());
  }

  // Detalle por ID (básico o completo con ?full=1)
  getCandidato(id: number | string, full = false): Observable<any> {
    let params = new HttpParams();
    if (full) {
      params = params.set('full', '1');
      params = params.set('include_queue', '1');
    }
    return this.http
      .get<any>(this.url(`candidatos/${id}`), { params })
      .pipe(this.handle$(), this.abrirSobreCandidato());
  }

  //
  // 1) Versión PATH: /candidatos/by-document/<numero_documento>?full=1
  //
  getCandidatoPorDocumento(numeroDocumento: string, full = false, tipoDoc?: string | null) {
    const safe = encodeURIComponent((numeroDocumento ?? '').trim());
    let params = new HttpParams();
    if (full) {
      params = params.set('full', '1');
      params = params.set('include_queue', '1');
    }
    // Con cédula duplicada (fila CC y fila C.C/CE), sin este filtro el backend
    // devuelve "la más recientemente atendida" — que puede ser el titular que
    // el operador explícitamente NO eligió. El backend ya soporta ?tipo_doc=.
    const tipo = String(tipoDoc ?? '').trim();
    if (tipo) params = params.set('tipo_doc', tipo);

    return this.http
      .get<any>(this.url(`candidatos/by-document/${safe}`), { params })
      .pipe(this.handle$(), this.abrirSobreCandidato());
  }

  //
  // 2) Versión QUERY: /candidatos/by-document?numero_documento=<>&full=1
  //    (útil si no quieres enviar el documento en el path)
  //
  getCandidatoPorDocumentoQ(numeroDocumento: string, full = false) {
    let params = new HttpParams().set('numero_documento', (numeroDocumento ?? '').trim());
    if (full) {
      params = params.set('full', '1');
      params = params.set('include_queue', '1');
    }

    return this.http
      .get<any>(this.url('candidatos/by-document'), { params })
      .pipe(this.handle$(), this.abrirSobreCandidato());
  }

  // Crear (payload ya preparado)
  createCandidato(data: any): Observable<any> {
    return this.http.post(this.url('candidatos'), data).pipe(this.handle$());
  }

  // Actualizar total
  updateCandidato(id: number | string, data: any): Observable<any> {
    return this.http.put(this.url(`candidatos/${id}`), data).pipe(this.handle$());
  }

  // Actualización parcial
  patchCandidato(id: number | string, data: any): Observable<any> {
    return this.http.patch(this.url(`candidatos/${id}`), data).pipe(this.handle$());
  }

  // Eliminar
  deleteCandidato(id: number | string): Observable<any> {
    return this.http.delete(this.url(`candidatos/${id}`)).pipe(this.handle$());
  }


  // =========================================================
  // VIVIENDAS
  // =========================================================
  listViviendas(opts?: ListOptions) { return this.http.get(this.url('viviendas'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getVivienda(id: number | string) { return this.http.get(this.url(`viviendas/${id}`)).pipe(this.handle$()); }
  createVivienda(data: any) { return this.http.post(this.url('viviendas'), data).pipe(this.handle$()); }
  updateVivienda(id: number | string, data: any) { return this.http.put(this.url(`viviendas/${id}`), data).pipe(this.handle$()); }
  patchVivienda(id: number | string, data: any) { return this.http.patch(this.url(`viviendas/${id}`), data).pipe(this.handle$()); }
  deleteVivienda(id: number | string) { return this.http.delete(this.url(`viviendas/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // DOTACIONES
  // =========================================================
  listDotaciones(opts?: ListOptions) { return this.http.get(this.url('dotaciones'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getDotacion(id: number | string) { return this.http.get(this.url(`dotaciones/${id}`)).pipe(this.handle$()); }
  createDotacion(data: any) { return this.http.post(this.url('dotaciones'), data).pipe(this.handle$()); }
  updateDotacion(id: number | string, data: any) { return this.http.put(this.url(`dotaciones/${id}`), data).pipe(this.handle$()); }
  patchDotacion(id: number | string, data: any) { return this.http.patch(this.url(`dotaciones/${id}`), data).pipe(this.handle$()); }
  deleteDotacion(id: number | string) { return this.http.delete(this.url(`dotaciones/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // EXPERIENCIAS RESUMEN (experiencias-resumen)
  // =========================================================
  listExperienciasResumen(opts?: ListOptions) { return this.http.get(this.url('experiencias-resumen'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getExperienciaResumen(id: number | string) { return this.http.get(this.url(`experiencias-resumen/${id}`)).pipe(this.handle$()); }
  createExperienciaResumen(data: any) { return this.http.post(this.url('experiencias-resumen'), data).pipe(this.handle$()); }
  updateExperienciaResumen(id: number | string, data: any) { return this.http.put(this.url(`experiencias-resumen/${id}`), data).pipe(this.handle$()); }
  patchExperienciaResumen(id: number | string, data: any) { return this.http.patch(this.url(`experiencias-resumen/${id}`), data).pipe(this.handle$()); }
  deleteExperienciaResumen(id: number | string) { return this.http.delete(this.url(`experiencias-resumen/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // EVALUACIONES
  // =========================================================
  listEvaluaciones(opts?: ListOptions) { return this.http.get(this.url('evaluaciones'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getEvaluacion(id: number | string) { return this.http.get(this.url(`evaluaciones/${id}`)).pipe(this.handle$()); }
  createEvaluacion(data: any) { return this.http.post(this.url('evaluaciones'), data).pipe(this.handle$()); }
  updateEvaluacion(id: number | string, data: any) { return this.http.put(this.url(`evaluaciones/${id}`), data).pipe(this.handle$()); }
  patchEvaluacion(id: number | string, data: any) { return this.http.patch(this.url(`evaluaciones/${id}`), data).pipe(this.handle$()); }
  deleteEvaluacion(id: number | string) { return this.http.delete(this.url(`evaluaciones/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // CONTACTOS
  // =========================================================
  listContactos(opts?: ListOptions) { return this.http.get(this.url('contactos'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getContacto(id: number | string) { return this.http.get(this.url(`contactos/${id}`)).pipe(this.handle$()); }
  createContacto(data: any) { return this.http.post(this.url('contactos'), data).pipe(this.handle$()); }
  updateContacto(id: number | string, data: any) { return this.http.put(this.url(`contactos/${id}`), data).pipe(this.handle$()); }
  patchContacto(id: number | string, data: any) { return this.http.patch(this.url(`contactos/${id}`), data).pipe(this.handle$()); }
  deleteContacto(id: number | string) { return this.http.delete(this.url(`contactos/${id}`)).pipe(this.handle$()); }

  confirmarContacto(candidatoId: number | string, payload: { correo_confirmado?: boolean, whatsapp_confirmado?: boolean }): Observable<any> {
    return this.http.patch(this.url(`candidatos/${candidatoId}/confirmar-contacto`), payload).pipe(this.handle$());
  }

  // =========================================================
  // RESIDENCIAS
  // =========================================================
  listResidencias(opts?: ListOptions) { return this.http.get(this.url('residencias'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getResidencia(id: number | string) { return this.http.get(this.url(`residencias/${id}`)).pipe(this.handle$()); }
  createResidencia(data: any) { return this.http.post(this.url('residencias'), data).pipe(this.handle$()); }
  updateResidencia(id: number | string, data: any) { return this.http.put(this.url(`residencias/${id}`), data).pipe(this.handle$()); }
  patchResidencia(id: number | string, data: any) { return this.http.patch(this.url(`residencias/${id}`), data).pipe(this.handle$()); }
  deleteResidencia(id: number | string) { return this.http.delete(this.url(`residencias/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // INFO-CC (info-cc)
  // =========================================================
  listInfoCc(opts?: ListOptions) { return this.http.get(this.url('info-cc'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getInfoCc(id: number | string) { return this.http.get(this.url(`info-cc/${id}`)).pipe(this.handle$()); }
  createInfoCc(data: any) { return this.http.post(this.url('info-cc'), data).pipe(this.handle$()); }
  updateInfoCc(id: number | string, data: any) { return this.http.put(this.url(`info-cc/${id}`), data).pipe(this.handle$()); }
  patchInfoCc(id: number | string, data: any) { return this.http.patch(this.url(`info-cc/${id}`), data).pipe(this.handle$()); }
  deleteInfoCc(id: number | string) { return this.http.delete(this.url(`info-cc/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // FORMACIONES
  // =========================================================
  listFormaciones(opts?: ListOptions) { return this.http.get(this.url('formaciones'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getFormacion(id: number | string) { return this.http.get(this.url(`formaciones/${id}`)).pipe(this.handle$()); }
  createFormacion(data: any) { return this.http.post(this.url('formaciones'), data).pipe(this.handle$()); }
  updateFormacion(id: number | string, data: any) { return this.http.put(this.url(`formaciones/${id}`), data).pipe(this.handle$()); }
  patchFormacion(id: number | string, data: any) { return this.http.patch(this.url(`formaciones/${id}`), data).pipe(this.handle$()); }
  deleteFormacion(id: number | string) { return this.http.delete(this.url(`formaciones/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // EXPERIENCIAS (laborales)
  // =========================================================
  listExperiencias(opts?: ListOptions) { return this.http.get(this.url('experiencias'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getExperiencia(id: number | string) { return this.http.get(this.url(`experiencias/${id}`)).pipe(this.handle$()); }
  createExperiencia(data: any) { return this.http.post(this.url('experiencias'), data).pipe(this.handle$()); }
  updateExperiencia(id: number | string, data: any) { return this.http.put(this.url(`experiencias/${id}`), data).pipe(this.handle$()); }
  patchExperiencia(id: number | string, data: any) { return this.http.patch(this.url(`experiencias/${id}`), data).pipe(this.handle$()); }
  deleteExperiencia(id: number | string) { return this.http.delete(this.url(`experiencias/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // HIJOS
  // =========================================================
  listHijos(opts?: ListOptions) { return this.http.get(this.url('hijos'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getHijo(id: number | string) { return this.http.get(this.url(`hijos/${id}`)).pipe(this.handle$()); }
  createHijo(data: any) { return this.http.post(this.url('hijos'), data).pipe(this.handle$()); }
  updateHijo(id: number | string, data: any) { return this.http.put(this.url(`hijos/${id}`), data).pipe(this.handle$()); }
  patchHijo(id: number | string, data: any) { return this.http.patch(this.url(`hijos/${id}`), data).pipe(this.handle$()); }
  deleteHijo(id: number | string) { return this.http.delete(this.url(`hijos/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // FAMILIARES
  // =========================================================
  listFamiliares(opts?: ListOptions) { return this.http.get(this.url('familiares'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getFamiliar(id: number | string) { return this.http.get(this.url(`familiares/${id}`)).pipe(this.handle$()); }
  createFamiliar(data: any) { return this.http.post(this.url('familiares'), data).pipe(this.handle$()); }
  updateFamiliar(id: number | string, data: any) { return this.http.put(this.url(`familiares/${id}`), data).pipe(this.handle$()); }
  patchFamiliar(id: number | string, data: any) { return this.http.patch(this.url(`familiares/${id}`), data).pipe(this.handle$()); }
  deleteFamiliar(id: number | string) { return this.http.delete(this.url(`familiares/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // REFERENCIAS
  // =========================================================
  listReferencias(opts?: ListOptions) { return this.http.get(this.url('referencias'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getReferencia(id: number | string) { return this.http.get(this.url(`referencias/${id}`)).pipe(this.handle$()); }
  createReferencia(data: any) { return this.http.post(this.url('referencias'), data).pipe(this.handle$()); }
  updateReferencia(id: number | string, data: any) { return this.http.put(this.url(`referencias/${id}`), data).pipe(this.handle$()); }
  patchReferencia(id: number | string, data: any) { return this.http.patch(this.url(`referencias/${id}`), data).pipe(this.handle$()); }
  deleteReferencia(id: number | string) { return this.http.delete(this.url(`referencias/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // ENTREVISTAS
  // =========================================================
  listEntrevistas(opts?: ListOptions) { return this.http.get(this.url('entrevistas'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getEntrevista(id: number | string) { return this.http.get(this.url(`entrevistas/${id}`)).pipe(this.handle$()); }
  createEntrevista(data: any) { return this.http.post(this.url('entrevistas'), data).pipe(this.handle$()); }
  updateEntrevista(id: number | string, data: any) { return this.http.put(this.url(`entrevistas/${id}`), data).pipe(this.handle$()); }
  patchEntrevista(id: number | string, data: any) { return this.http.patch(this.url(`entrevistas/${id}`), data).pipe(this.handle$()); }
  deleteEntrevista(id: number | string) { return this.http.delete(this.url(`entrevistas/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // PROCESOS (ProcesoCandidato)
  // =========================================================
  listProcesos(opts?: ListOptions) { return this.http.get(this.url('procesos'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getProceso(id: number | string) { return this.http.get(this.url(`procesos/${id}`)).pipe(this.handle$()); }
  createProceso(data: any) { return this.http.post(this.url('procesos'), data).pipe(this.handle$()); }
  updateProceso(id: number | string, data: any) { return this.http.put(this.url(`procesos/${id}`), data).pipe(this.handle$()); }
  patchProceso(id: number | string, data: any) { return this.http.patch(this.url(`procesos/${id}`), data).pipe(this.handle$()); }
  deleteProceso(id: number | string) { return this.http.delete(this.url(`procesos/${id}`)).pipe(this.handle$()); }

  listProcesosMiniByDocumento(numeroDocumento: string, onlyLatest = false) {
    const params: any = { numero_documento: numeroDocumento };
    if (onlyLatest) params.latest = 1;

    // Normalizamos SIEMPRE a array de any[]
    return this.http
      .get<any | any[]>(this.url('procesos/by-document-min'), { params })
      .pipe(
        map(v => Array.isArray(v) ? v : (v ? [v] : [])),
        this.handle$() // conserva tu manejador de errores
      );
  }



  // =========================================================
  // ANTECEDENTES DE PROCESO
  // =========================================================
  listAntecedentesProceso(opts?: ListOptions) { return this.http.get(this.url('antecedentes-proceso'), { params: this.buildParams(opts) }).pipe(this.handle$()); }
  getAntecedenteProceso(id: number | string) { return this.http.get(this.url(`antecedentes-proceso/${id}`)).pipe(this.handle$()); }
  createAntecedenteProceso(data: any) { return this.http.post(this.url('antecedentes-proceso'), data).pipe(this.handle$()); }
  updateAntecedenteProceso(id: number | string, data: any) { return this.http.put(this.url(`antecedentes-proceso/${id}`), data).pipe(this.handle$()); }
  patchAntecedenteProceso(id: number | string, data: any) { return this.http.patch(this.url(`antecedentes-proceso/${id}`), data).pipe(this.handle$()); }
  deleteAntecedenteProceso(id: number | string) { return this.http.delete(this.url(`antecedentes-proceso/${id}`)).pipe(this.handle$()); }

  // =========================================================
  // BIOMETRÍA (multipart)
  // =========================================================
  /** Lista (puedes filtrar por cédula con search si quieres) */
  listBiometria(opts?: ListOptions) {
    return this.http
      .get(this.url('biometria'), { params: this.buildParams(opts) })
      .pipe(this.handle$());
  }

  /** Obtiene la biometría de un candidato por cédula */
  getBiometriaPorCedula(numero_documento: string | number) {
    return this.http
      .get(this.url(`biometria/${encodeURIComponent(String(numero_documento))}`))
      .pipe(this.handle$());
  }

  /** Upload genérico por tipo (FIRMA | HUELLA | FOTO) */
  uploadBiometria(
    tipo: TipoBio,
    numero_documento: string | number,
    file: File,
    consent?: {
      consentimiento_hash?: string;
      consentimiento_version?: string;
      consentimiento_timestamp?: string;
      user_agent?: string;
      image_hash?: string;
    },
  ) {
    const fd = new FormData();
    fd.append('numero_documento', String(numero_documento));
    fd.append('file', file);

    // Append consent metadata if provided
    if (consent) {
      Object.entries(consent).forEach(([k, v]) => {
        if (v != null) fd.append(k, v);
      });
    }

    // POST /biometria/upload/{tipo}
    return this.http
      .post(this.url(`biometria/upload/${tipo}`), fd)
      .pipe(this.handle$());
  }

  /** Azúcar sintáctico */
  uploadFirma(numero_documento: string | number, file: File) {
    return this.uploadBiometria('firma', numero_documento, file);
  }
  uploadHuella(
    numero_documento: string | number,
    file: File,
    consent?: {
      consentimiento_hash?: string;
      consentimiento_version?: string;
      consentimiento_timestamp?: string;
      user_agent?: string;
      image_hash?: string;
    },
  ) {
    return this.uploadBiometria('huella', numero_documento, file, consent);
  }
  uploadFoto(numero_documento: string | number, file: File) {
    return this.uploadBiometria('foto', numero_documento, file);
  }

  // =========================================================
  // Placeholder que tenías
  // =========================================================
  crearActualizarCandidato(_form: any): Observable<any> {
    return of({ ok: true });
  }

  // =========================================================
  // ================== MAPEOS ORIGINALES ====================
  // =========================================================
  buildCandidatoPayload(f: any, proceso?: any) {
    const get = (a: string, b?: string) => (f?.[a] ?? (b ? f?.[b] : undefined));

    // ===== Candidato base =====
    const candidatoBase = this.clean({
      tipo_doc: get('tipo_doc', 'tipoDoc'),
      numero_documento: get('numero_documento', 'numero_de_documento'),
      primer_nombre: get('primer_nombre', 'primerNombre'),
      segundo_nombre: get('segundo_nombre', 'segundoNombre'),
      primer_apellido: get('primer_apellido', 'primerApellido'),
      segundo_apellido: get('segundo_apellido', 'segundoApellido'),
      sexo: get('sexo', 'genero'),
      fecha_nacimiento: this.toYYYYMMDD(get('fecha_nacimiento', 'fechaNacimiento')),
      estado_civil: get('estado_civil', 'estadoCivil'),
      nombreReferenciaFamiliar1: get('nombreReferenciaFamiliar1'),
      parentescoReferenciaFamiliar1: get('parentescoReferenciaFamiliar1'),
      nombreReferenciaFamiliar2: get('nombreReferenciaFamiliar2'),
      parentescoReferenciaFamiliar2: get('parentescoReferenciaFamiliar2'),
      // Las personales faltaban: el form las capturaba y el backend las sabe
      // guardar, pero nunca salían de aquí, así que al reconsultar volvían vacías.
      nombreReferenciaPersonal1: get('nombreReferenciaPersonal1'),
      parentescoReferenciaPersonal1: get('parentescoReferenciaPersonal1'),
      nombreReferenciaPersonal2: get('nombreReferenciaPersonal2'),
      parentescoReferenciaPersonal2: get('parentescoReferenciaPersonal2'),
      // Los demás campos de referencia (teléfono, ocupación, dirección, tiempo)
      // entran por el formulario público; se mandan solo si el form los trae,
      // porque `clean()` descarta lo vacío y el backend no pisa lo que no llega.
      telefonoReferenciaFamiliar1: get('telefonoReferenciaFamiliar1'),
      ocupacionReferenciaFamiliar1: get('ocupacionReferenciaFamiliar1'),
      direccionReferenciaFamiliar1: get('direccionReferenciaFamiliar1'),
      tiempoConoceReferenciaFamiliar1: get('tiempoConoceReferenciaFamiliar1'),
      telefonoReferenciaFamiliar2: get('telefonoReferenciaFamiliar2'),
      ocupacionReferenciaFamiliar2: get('ocupacionReferenciaFamiliar2'),
      direccionReferenciaFamiliar2: get('direccionReferenciaFamiliar2'),
      tiempoConoceReferenciaFamiliar2: get('tiempoConoceReferenciaFamiliar2'),
      telefonoReferenciaPersonal1: get('telefonoReferenciaPersonal1'),
      ocupacionReferenciaPersonal1: get('ocupacionReferenciaPersonal1'),
      direccionReferenciaPersonal1: get('direccionReferenciaPersonal1'),
      tiempoConoceReferenciaPersonal1: get('tiempoConoceReferenciaPersonal1'),
      telefonoReferenciaPersonal2: get('telefonoReferenciaPersonal2'),
      ocupacionReferenciaPersonal2: get('ocupacionReferenciaPersonal2'),
      direccionReferenciaPersonal2: get('direccionReferenciaPersonal2'),
      tiempoConoceReferenciaPersonal2: get('tiempoConoceReferenciaPersonal2'),
    });

    // ===== Contacto =====
    const contacto = this.nonEmpty({
      email: get('correo_electronico'),
      celular: get('celular', 'numeroCelular'),
      whatsapp: get('whatsapp', 'numeroWhatsapp'),
    });

    // ===== Residencia =====
    const residencia = this.nonEmpty({
      direccion: get('direccion_de_residencia', 'direccion'),
      barrio: get('barrio'),
      hace_cuanto_vive: get('hace_cuanto_vive', 'tiempoResidencia'),
    });

    // ===== Vivienda =====
    const personasVive = get('personas_con_quien_convive', 'conQuienViveChecks');
    const vivienda = this.nonEmpty({
      personas_con_quien_convive: Array.isArray(personasVive) ? personasVive.join(', ') : personasVive,
      responsable_hijos: get('cuidadorHijos') ? String(get('cuidadorHijos')) : undefined,
      estudia_actualmente: typeof get('estudiaActualmente') === 'boolean' ? get('estudiaActualmente') : undefined,
    });

    // ===== Info CC =====
    const info_cc = this.nonEmpty({
      fecha_expedicion: this.toYYYYMMDD(get('fecha_expedicion', 'fechaExpedicion')),
      mpio_expedicion: get('mpio_expedicion', 'municipioExpedicion'),
      mpio_nacimiento: get('mpio_nacimiento', 'lugarNacimiento'),
    });

    // ===== Experiencia (resumen) =====
    const experienciaFlores = get('experienciaFlores');
    const tiene_experiencia = typeof experienciaFlores === 'string'
      ? experienciaFlores === 'Sí'
      : !!get('tiene_experiencia');

    let area: string | null =
      get('area_cultivo_poscosecha') ??
      get('area_experiencia') ??
      get('tipoExperienciaFlores') ?? null;

    if (get('tipoExperienciaFlores') === 'OTROS' && get('otroExperiencia')) {
      area = String(get('otroExperiencia'));
    }

    const experiencia_resumen = this.nonEmpty({
      tiene_experiencia,
      area_experiencia: area,
      area_cultivo_poscosecha: area,
    });

    // ===== Formaciones (simple) =====
    const formaciones = get('nivel')
      ? [{ nivel: get('nivel'), institucion: null, titulo_obtenido: null, anio_finalizacion: null }]
      : undefined;

    // ===== Experiencias (laborales) =====
    const experienciasSrc = Array.isArray(get('experiencias')) ? get('experiencias') : [];
    const experiencias = experienciasSrc
      .map((e: any) => this.clean({
        empresa: e?.empresa,
        tiempo_trabajado: e?.tiempo_trabajado ?? e?.tiempo,
        labores_realizadas: e?.labores_realizadas ?? e?.labores,
        labores_principales: e?.labores_principales,
      }))
      .filter((e: any) => !!e.empresa);

    // ===== Hijos =====
    const hijosSrc = Array.isArray(get('hijos')) ? get('hijos') : [];
    const hijos = hijosSrc
      .map((h: any) =>
        this.clean({
          numero_de_documento: h?.numero_de_documento ?? h?.numeroDocumento ?? h?.doc,
          fecha_nac: this.toYYYYMMDD(h?.fecha_nac ?? h?.fechaNacimiento),
        })
      )
      .filter((h: any) => !!h.numero_de_documento && !!h.fecha_nac);

    // ===== Entrevistas =====
    // Estos SÍ son de Entrevista en tu modelo:
    // - como_se_entero
    // - referenciado
    // - nombre_referenciado
    // (además de oficina, y opcionalmente: como_se_proyecta, cuenta_experiencia_flores, tipo_experiencia_flores)
    const entrevistas = this.compact([
      this.nonEmpty({
        oficina: get('oficina'),
        como_se_entero: get('comoSeEntero'),
        referenciado: get('referenciado'),
        nombre_referenciado: get('nombreReferenciado'),
        // opcionales soportados por el modelo
        como_se_proyecta: get('como_se_proyecta', 'proyeccion1Ano'),
        cuenta_experiencia_flores: tiene_experiencia ? 'SI' : 'NO',
        tipo_experiencia_flores: area,
      }),
    ]);

    // ===== Proceso (desde el formulario) =====
    // Campos del proceso que pueden venir “sueltos” en el form con distintos nombres.
    const procesoFromForm = this.nonEmpty({
      publicacion: get('publicacion') ?? get('publicacion_id'),
      vacante_tipo: get('vacante_tipo') ?? get('vacanteTipo'),
      vacante_salario: get('vacante_salario') ?? get('vacanteSalario'),

      nombre_evaluador: get('nombre_evaluador') ?? get('nombreEvaluador'),
      aplica_o_no_aplica: get('aplicaObservacion') ?? get('aplicaObservacion'),
      motivo_no_aplica: get('motivo_no_aplica') ?? get('motivoNoAplica'),
      motivo_espera: get('motivo_espera') ?? get('motivoEspera'),
      detalle: get('detalle'),

      // Etapas (sólo si son booleanos reales en el form)
      pre_registro: typeof get('pre_registro') === 'boolean' ? get('pre_registro') : undefined,
      entrevistado: typeof get('entrevistado') === 'boolean' ? get('entrevistado') : undefined,
      prueba_tecnica: typeof get('prueba_tecnica') === 'boolean' ? get('prueba_tecnica') : undefined,
      autorizado: typeof get('autorizado') === 'boolean' ? get('autorizado') : undefined,
      examenes_medicos: typeof get('examenes_medicos') === 'boolean' ? get('examenes_medicos') : undefined,
      contratado: typeof get('contratado') === 'boolean' ? get('contratado') : undefined,
      ingreso: typeof get('ingreso') === 'boolean' ? get('ingreso') : undefined,
      rechazado: typeof get('rechazado') === 'boolean' ? get('rechazado') : undefined,
    });

    // Mezclamos con el `proceso` que venga por parámetro (el parámetro tiene prioridad)
    const procesoMerged = (() => {
      const pArg = (proceso && Object.keys(proceso).length) ? proceso : undefined;
      if (!pArg && !procesoFromForm) return undefined;
      return { ...(procesoFromForm || {}), ...(pArg || {}) };
    })();

    // ===== Evaluacion (Opcional) =====
    const evaluacion = this.nonEmpty({
      relacion_familiar: get('relacionFamiliar'),
      rendimiento_laboral: get('desempenoLaboral'),
       porque_lo_felicitarian: get('felicitaciones'),
      malentendido: get('situacionConflictiva'),
      actividades_diarias: get('actividadesDiferentes'),
    });

    // ===== Payload final =====
    const payload: any = this.clean({
      ...candidatoBase,
      password: get('password'),
      contacto,
      residencia,
      vivienda,
      info_cc,
      experiencia_resumen,
      formaciones,
      experiencias: experiencias.length ? experiencias : undefined,
      hijos: hijos.length ? hijos : undefined,
      entrevistas,
      evaluacion,
      // solo añadimos 'proceso' si hay algo
      proceso: procesoMerged,
    });

    return payload;
  }





  // ================== HELPERS ==================
  /** Uppercase profundo + sin tildes/ñ, excepto ciertas claves (case-insensitive). */
  private uppercaseDeepExcept<T>(data: T, skipKeys: Set<string>): T {
    const skip = new Set(Array.from(skipKeys).map(k => k.toLowerCase()));

    const walk = (val: any, keyHint?: string): any => {
      if (val == null) return val;

      if (typeof val === 'string') {
        if (keyHint && skip.has(keyHint.toLowerCase())) return val;
        return sinTildes(val).toLocaleUpperCase('es-CO');
      }
      if (Array.isArray(val)) return val.map((v) => walk(v));
      if (typeof val === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(val)) out[k] = walk(v, k);
        return out;
      }
      return val;
    };

    return walk(data) as T;
  }

  /** Copia sin claves undefined */
  private clean<T extends object>(obj: T): T {
    const out: any = Array.isArray(obj) ? [] : {};
    Object.entries(obj as any).forEach(([k, v]) => {
      if (v === undefined) return;
      out[k] = v;
    });
    return out as T;
  }

  /** `undefined` si el objeto queda vacío */
  private nonEmpty<T extends object | null | undefined>(obj: T): T | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    const entries = Object.entries(obj as any).filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) as any : undefined;
  }

  /** Filtra nulos/undefined */
  private compact<T>(arr: (T | null | undefined)[]): T[] {
    return (arr || []).filter(Boolean) as T[];
  }

  /** YYYY-MM-DD */
  private toYYYYMMDD(v: any): string | undefined {
    if (!v) return undefined;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v);
    return s.length > 10 ? s.slice(0, 10) : s;
  }



  /** Obtiene los antecedentes (selección) actuales de un proceso */
  getSeleccion(procesoId: number | string) {
    return this.http
      .get<ProcesoSeleccionResponse>(this.url(`procesos/${procesoId}/seleccion`))
      .pipe(this.handle$());
  }

  /** Upsert de antecedentes por ID de proceso (POST o PATCH funcionan) */
  upsertSeleccion(
    procesoId: number | string,
    payload: AntecedentesPayload,
    method: 'post' | 'patch' = 'post'
  ) {
    const clean = this.clean(payload);
    // Evitamos tocar números; strings se van en mayúscula (útil para "CUMPLE"/"NO CUMPLE")
    const data = this.uppercaseDeepExcept(clean, new Set(['semanasCotizadas']));
    const req$ = method === 'patch'
      ? this.http.patch(this.url(`procesos/${procesoId}/seleccion`), data)
      : this.http.post(this.url(`procesos/${procesoId}/seleccion`), data);
    return req$.pipe(this.handle$());
  }

  /**
   * Upsert de antecedentes enviando el número de documento (y opcionalmente proceso_id).
   * Si no envías proceso_id, el backend abre/usa el proceso abierto de la última entrevista.
   */
  upsertSeleccionByDocumento(
    numeroDocumento: string,
    payload: AntecedentesPayload,
    procesoId?: number | string,
    override?: { modificacionForzada?: boolean; modificadoPor?: string | null }
  ) {
    const body: any = {
      numero_documento: (numeroDocumento ?? '').trim(),
      ...(procesoId != null ? { proceso_id: procesoId } : {}),
      ...this.clean(payload),
      // Override "Modificar de todas formas" (pipeline): edición pura del proceso
      // existente + auditoría (quién/cuándo la sella el servidor).
      ...(override?.modificacionForzada
        ? { modificacion_forzada: true, modificado_por: override.modificadoPor ? sinTildes(override.modificadoPor) : null }
        : {}),
    };
    // `modificado_por` NO debe ir a MAYÚSCULAS (es el nombre del usuario).
    const data = this.uppercaseDeepExcept(body, new Set(['semanasCotizadas', 'modificado_por']));
    return this.http
      .post<{ message: string; proceso_id: number; procesoSeleccion: AntecedentesPayload }>(
        this.url('procesos/seleccion-by-document'),
        data
      )
      .pipe(this.handle$());
  }

  /**
   * Borra la ENTREVISTA completa del candidato (y en cascada su proceso,
   * contrato y antecedentes) SIN tocar al candidato ni su formulario web:
   * `formulario_paso` y `formulario_completo` quedan como estaban.
   *
   * Sin `procesoId` borra la entrevista más reciente. `forzar` solo hace falta
   * cuando el contrato está activo (si no, el backend responde 409).
   */
  eliminarProceso(
    numeroDocumento: string,
    opts?: { procesoId?: number | null; forzar?: boolean },
  ) {
    return this.http.post<{
      message: string;
      eliminado: {
        entrevista_id: number;
        proceso_id: number | null;
        codigo_contrato: string | null;
        contrato_activo: boolean;
        antecedentes: number;
      };
      candidato_conservado: {
        numero_documento: string;
        formulario_paso: number | null;
        formulario_completo: boolean | null;
      };
    }>(this.url('procesos/eliminar-proceso'), {
      numero_documento: (numeroDocumento ?? '').trim(),
      ...(opts?.procesoId != null ? { proceso_id: opts.procesoId } : {}),
      ...(opts?.forzar ? { forzar: true } : {}),
    });
  }

  updateProcesoByDocumento(
    body: ProcesoUpdateByDocumentRequest,
    method: 'POST' | 'PATCH' = 'POST'
  ): Observable<UpdateByDocumentResponse> {
    const url = `${this.base}/procesos/update-by-document/`;
    // Todo lo que el pipeline guarda va sin tildes ni ñ; la contraseña
    // asignada del contrato no se toca para no corromperla.
    const data = sinTildesDeep(body, new Set(['contrasenia_asignada']));
    return method === 'POST'
      ? this.http.post<UpdateByDocumentResponse>(url, data)
      : this.http.patch<UpdateByDocumentResponse>(url, data);
  }

  /**
   * GET /gestion_contratacion/procesos/candidatos-por-vacante/?publicacion=<id>
   * Lista (sin duplicar candidato) las personas asignadas a una vacante, con
   * datos suficientes para mostrarlas, quitarles la vacante y exportarlas.
   * Solo lectura; respuesta en snake_case.
   */
  getCandidatosPorVacante(publicacionId: number | string): Observable<CandidatoPorVacanteItem[]> {
    const params = new HttpParams().set('publicacion', String(publicacionId));
    return this.http
      .get<CandidatoPorVacanteItem[]>(this.url('procesos/candidatos-por-vacante'), { params })
      .pipe(this.handle$());
  }

}

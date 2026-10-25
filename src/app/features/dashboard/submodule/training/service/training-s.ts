import { Injectable, inject } from '@angular/core';
import type { EjercicioCodigo, ResultadoCodigo } from './codigo.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

/**
 * Cliente HTTP del módulo de Capacitaciones (learning-ms).
 *
 * No implementa nada de offline: de eso ya se encarga el `offlineInterceptor` de la app, que
 * cachea las GET en IndexedDB y encola las escrituras cuando no hay red. Duplicar esa
 * maquinaria aquí significaría dos colas que se pisan.
 *
 * Lo que sí es responsabilidad de esta capa es mandar SIEMPRE el `client_event_id`: el backend
 * lo usa para no contar dos veces lo mismo cuando la cola reintenta. Ver `TrainingOffline`.
 *
 * El `Authorization` NO se pone aquí: lo inyecta `auth.interceptor` para todo lo que va a
 * `environment.apiUrl`. Ponerlo a mano además duplicaría la cabecera y ataría el módulo a
 * cómo esta app guarda el token, que ya cambió una vez.
 */
@Injectable({ providedIn: 'root' })
export class TrainingS {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/learning`;

  /** Mis cursos con avance, vencimientos y lo que falta. */
  misCursos(): Promise<ResumenCurso[]> {
    return firstValueFrom(
      this.http.get<ResumenCurso[]>(`${this.base}/me/courses`)
    );
  }

  /**
   * Dónde se explica una pregunta, según el material que ya vio.
   *
   * Complementa al atajo que el autor pone a mano: cuando la pregunta no lo trae —que es lo
   * normal— el servidor lo busca en las transcripciones, y solo hacia atrás.
   */
  dondeSeExplica(questionId: string, quizId: string): Promise<CitaMaterial[]> {
    return firstValueFrom(this.http.get<CitaMaterial[]>(
      `${this.base}/me/questions/${questionId}/donde-se-explica?quiz_id=${quizId}`));
  }

  /**
   * Cursos que aprobé y que después se actualizaron.
   *
   * Es otra cosa que el vencimiento por tiempo: aquí el contenido cambió. Va aparte de
   * `misCursos` porque cuesta más de resolver y esta pantalla se abre muchas veces al día.
   */
  cursosActualizados(): Promise<CursoDesactualizado[]> {
    return firstValueFrom(
      this.http.get<CursoDesactualizado[]>(`${this.base}/me/course-updates`));
  }

  /**
   * El curso ENTERO en una sola respuesta. Es la petición que hay que hacer mientras haya
   * señal: después el interceptor la sirve desde IndexedDB.
   */
  paqueteDelCurso(enrollmentId: string): Promise<PaqueteCurso> {
    return firstValueFrom(
      this.http.get<PaqueteCurso>(
        `${this.base}/me/enrollments/${enrollmentId}/content`)
    );
  }

  /** Avance en una lección. Idempotente por client_event_id. */
  guardarProgreso(lessonId: string, cuerpo: ProgresoRequest): Promise<any> {
    return firstValueFrom(
      this.http.put(`${this.base}/me/lessons/${lessonId}/progress`, cuerpo)
    );
  }

  /**
   * Archivo de un material de lección.
   *
   * Va por learning-ms y no directo a ms-documents porque ese exige JWT y una etiqueta
   * `<img>`/`<video>` no manda cabeceras: el navegador recibiría un 401.
   *
   * OJO: en esta app el `offlineInterceptor` deja pasar las respuestas binarias sin cachearlas
   * (`isBinaryResponse`), así que el material NO queda en IndexedDB: vive como object URL
   * mientras la pantalla siga abierta. Sin señal y tras recargar, hay que volver a bajarlo.
   */
  descargarMaterial(resourceId: string): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.base}/me/resources/${resourceId}/file`,
        { responseType: 'blob' })
    );
  }

  /**
   * La foto o el vídeo sobre el que pregunta una pregunta.
   *
   * Va por learning-ms y no directo a gestión documental porque ese exige JWT y una etiqueta
   * `<img>` no manda cabeceras. Además comprueba que esta persona alcance esa pregunta.
   */
  descargarMediaDePregunta(questionId: string): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.base}/me/questions/${questionId}/media`, { responseType: 'blob' }));
  }

  /** La imagen de una opción de respuesta. Mismo proxy con control de acceso. */
  descargarMediaDeOpcion(optionId: string): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.base}/me/options/${optionId}/media`, { responseType: 'blob' }));
  }

  misCertificados(): Promise<Certificado[]> {
    return firstValueFrom(
      this.http.get<Certificado[]>(`${this.base}/me/certificates`)
    );
  }

  /** El PDF llega como blob; no pasa por la caché offline y por eso exige conexión. */
  /** Mi boletín en un curso: nota por módulo, asistencia y qué falta para aprobar. */
  miBoletin(enrollmentId: string): Promise<Boletin> {
    return firstValueFrom(
      this.http.get<Boletin>(`${this.base}/me/enrollments/${enrollmentId}/calificacion`));
  }

  // ── Profesor ───────────────────────────────────────────────────────────────
  // Ser instructor no es un rol: es estar en la lista de instructores de un grupo. Por eso
  // todo esto cuelga de /me/instructor y lo puede pedir cualquiera con sesión; el servidor
  // responde vacío o 404 a quien no dicta nada.

  misGruposComoInstructor(): Promise<GrupoDelInstructor[]> {
    return firstValueFrom(
      this.http.get<GrupoDelInstructor[]>(`${this.base}/me/instructor/groups`));
  }

  grupoComoInstructor(groupId: string): Promise<GrupoInstructorDetalle> {
    return firstValueFrom(
      this.http.get<GrupoInstructorDetalle>(`${this.base}/me/instructor/groups/${groupId}`));
  }

  matriculadosComoInstructor(groupId: string): Promise<MatriculaDelGrupo[]> {
    return firstValueFrom(this.http.get<MatriculaDelGrupo[]>(
      `${this.base}/me/instructor/groups/${groupId}/enrollments`));
  }

  /** La planilla: nota por módulo, asistencia y pendientes de cada persona del grupo. */
  planillaComoInstructor(groupId: string): Promise<PlanillaGrupo> {
    return firstValueFrom(
      this.http.get<PlanillaGrupo>(`${this.base}/me/instructor/groups/${groupId}/students`));
  }

  boletinDeAlguien(enrollmentId: string): Promise<Boletin> {
    return firstValueFrom(
      this.http.get<Boletin>(`${this.base}/enrollments/${enrollmentId}/calificacion`));
  }

  /** Sin estado: las que esperan revisión. 'TODAS' trae también las ya revisadas. */
  entregasDeGrupo(groupId: string, estado?: string): Promise<Entrega[]> {
    const q = estado ? `?estado=${estado}` : '';
    return firstValueFrom(
      this.http.get<Entrega[]>(`${this.base}/instructor/groups/${groupId}/submissions${q}`));
  }

  revisarEntrega(submissionId: string, req: { estado: 'APROBADA' | 'RECHAZADA'; nota?: number | null; feedback?: string | null }): Promise<Entrega> {
    return firstValueFrom(
      this.http.put<Entrega>(`${this.base}/instructor/submissions/${submissionId}`, req));
  }

  /** La evidencia de una entrega, para verla antes de calificar. */
  evidenciaDeEntrega(documentId: string): Promise<Blob> {
    return firstValueFrom(this.http.get(
      `${environment.apiUrl}/api/v1/documents/${documentId}/download`, { responseType: 'blob' }));
  }

  asistenciaComoInstructor(groupId: string, fecha?: string): Promise<AsistenciaDelGrupo[]> {
    const q = fecha ? `?fecha=${fecha}` : '';
    return firstValueFrom(this.http.get<AsistenciaDelGrupo[]>(
      `${this.base}/me/instructor/groups/${groupId}/attendance${q}`));
  }

  pasarLista(groupId: string, fecha: string,
             registros: { enrollment_id: string; estado: string; observacion?: string }[]): Promise<AsistenciaDelGrupo[]> {
    return firstValueFrom(this.http.post<AsistenciaDelGrupo[]>(
      `${this.base}/groups/${groupId}/attendance`, { fecha, registros }));
  }

  // ── Comentarios de la clase ────────────────────────────────────────────────
  // Siguen al linaje de la lección: se ven los de todas las versiones del curso.

  comentarios(lessonId: string): Promise<Comentario[]> {
    return firstValueFrom(this.http.get<Comentario[]>(`${this.base}/lessons/${lessonId}/comments`));
  }

  comentar(lessonId: string, texto: string, parentId?: string | null): Promise<Comentario> {
    return firstValueFrom(this.http.post<Comentario>(`${this.base}/lessons/${lessonId}/comments`,
      { texto, parent_id: parentId ?? null }));
  }

  borrarComentario(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/comments/${id}`));
  }

  descargarCertificado(id: string): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.base}/certificates/${id}/pdf`,
        { responseType: 'blob' })
    );
  }

  /** Inicia (o reanuda) un intento de la evaluación formal. Online obligatorio. */
  iniciarIntento(assessmentId: string, clientEventId: string): Promise<Intento> {
    return firstValueFrom(
      this.http.post<Intento>(`${this.base}/me/assessments/${assessmentId}/attempts`,
        { client_event_id: clientEventId })
    );
  }

  entregarIntento(attemptId: string, respuestas: RespuestaEnviada[]): Promise<ResultadoIntento> {
    return firstValueFrom(
      this.http.put<ResultadoIntento>(`${this.base}/me/assessments/attempts/${attemptId}`,
        { respuestas })
    );
  }

  /**
   * Responde el quiz de una lección. De una sola pasada, porque se contesta offline: la app
   * guarda las respuestas y el interceptor manda esto cuando hay señal.
   */
  responderQuiz(quizId: string, clientEventId: string,
                respuestas: RespuestaEnviada[]): Promise<ResultadoIntento> {
    return firstValueFrom(
      this.http.post<ResultadoIntento>(`${this.base}/me/quizzes/${quizId}/attempts`,
        { client_event_id: clientEventId, respuestas })
    );
  }

  /** El resultado de un intento ya entregado (quiz o evaluación), para seguirlo mientras se califica el código. */
  resultadoIntento(attemptId: string): Promise<ResultadoIntento> {
    return firstValueFrom(
      this.http.get<ResultadoIntento>(`${this.base}/me/assessments/attempts/${attemptId}/resultado`)
    );
  }

  /** Mi última entrega de una actividad (404 si todavía no hay). */
  miEntrega(activityId: string): Promise<EntregaMia> {
    return firstValueFrom(
      this.http.get<EntregaMia>(`${this.base}/me/activities/${activityId}/submission`)
    );
  }

  entregarActividad(activityId: string, cuerpo: EntregaRequest): Promise<any> {
    return firstValueFrom(
      this.http.post(`${this.base}/me/activities/${activityId}/submissions`, cuerpo)
    );
  }
}

// ── Contratos (snake_case, como los serializa el backend) ────────────────────

export interface ResumenCurso {
  enrollment_id: string;
  course_version_id: string;
  curso_nombre: string;
  estado_matricula: string;
  porcentaje_curso: number;
  lecciones_completadas: number;
  lecciones_obligatorias: number;
  contenido_completo: boolean;
  requiere_evaluacion: boolean;
  lecciones: ProgresoLeccion[];
}

export interface ProgresoLeccion {
  lesson_id: string;
  lesson_nombre: string;
  estado: string;
  porcentaje: number;
  segundos_vistos: number;
  completado_at?: string;
}

export interface PaqueteCurso {
  enrollment_id: string;
  course_id: string;
  course_version_id: string;
  curso_nombre: string;
  descripcion?: string;
  version: number;
  estado_matricula: string;
  porcentaje_curso: number;
  vence_at?: string;
  requiere_evaluacion: boolean;
  assessment_id?: string;
  generado_at: string;
  modulos: ModuloOffline[];
}

export interface ModuloOffline {
  id: string;
  nombre: string;
  descripcion?: string;
  orden: number;
  lecciones: LeccionOffline[];
}

export interface LeccionOffline {
  id: string;
  nombre: string;
  tipo: 'VIDEO' | 'PDF' | 'TEXTO' | 'ENLACE';
  contenido?: string;
  duracion_min?: number;
  obligatoria: boolean;
  orden: number;
  estado: string;
  porcentaje: number;
  /** Listas planas, agrupadas por tipo y sin el orden de autor. Usa `bloques`. */
  recursos: RecursoOffline[];
  actividades: Actividad[];
  quiz?: QuizPresentacion;
  /** El recorrido en orden, con cada bloque ya resuelto. Es lo que pinta el reproductor. */
  bloques?: BloqueOffline[];
}

/**
 * Un bloque con su contenido resuelto.
 *
 * Aquí viaja TODO —el archivo, la tarea, el quiz barajado— porque este payload se cachea en el
 * teléfono y se estudia sin conexión: lo que no venga ahora no se puede pedir después.
 */
export interface BloqueOffline {
  id: string;
  tipo: 'TEXTO' | 'VIDEO' | 'DOCUMENTO' | 'PRESENTACION' | 'IMAGEN' | 'ENLACE'
      | 'ACTIVIDAD' | 'QUIZ' | 'AUDIO' | 'YOUTUBE' | 'FICHA';
  titulo?: string | null;
  /** Qué tiene que hacer la persona con este bloque. Va bajo el título. */
  descripcion?: string | null;
  orden: number;
  contenido?: string | null;
  recurso?: RecursoOffline | null;
  actividad?: Actividad | null;
  quiz?: QuizPresentacion | null;
}

export interface RecursoOffline {
  id: string;
  nombre?: string;
  tipo: string;
  document_id?: string;
  url?: string;
  orden: number;
}

export interface Actividad {
  id: string;
  tipo: string;
  titulo: string;
  instrucciones?: string;
  puntaje_max?: number;
  obligatoria: boolean;
  /** Sólo CODIGO, en su vista pública: el ejercicio con sus pruebas visibles. */
  ejercicio?: EjercicioCodigo | null;
}

export interface QuizPresentacion {
  quiz_id: string;
  lesson_id: string;
  intentos_max: number;
  feedback_inmediato: boolean;
  /** TODAS = una página con todo. UNA_POR_UNA = de a una, en ventana. */
  modo_presentacion: 'TODAS' | 'UNA_POR_UNA';
  /** Solo aplica en UNA_POR_UNA. */
  permite_volver: boolean;
  mostrar_respuesta_correcta: boolean;
  preguntas: PreguntaPresentacion[];
  /** Lo que hay que saber antes de responder: cómo se llama, qué es y cuánto pesa. */
  titulo?: string | null;
  tipo?: 'ACTIVIDAD' | 'EXAMEN_FINAL' | 'PRACTICA';
  calificable?: boolean;
  peso?: number | null;
  nota_minima?: number | null;
  /** Modo examen: sin pegar en lo escrito ni copiar el enunciado. */
  bloquea_pegado?: boolean;
}

export interface PreguntaPresentacion {
  id: string;
  enunciado: string;
  /** Texto enriquecido de apoyo, y la foto o el vídeo sobre el que se pregunta. */
  cuerpo_html?: string | null;
  media_tipo?: 'IMAGEN' | 'VIDEO' | null;
  /** El archivo NO se pide por su document_id: va por /me/questions/{id}/media, que comprueba acceso. */
  tiene_archivo?: boolean;
  media_url?: string | null;
  tipo: 'OPCION_MULTIPLE' | 'VERDADERO_FALSO' | 'EMPAREJAR' | 'TEXTO_ABIERTO' | 'NUMERO' | 'PROGRAMACION';
  opciones: OpcionPresentacion[];
  /** Sólo PROGRAMACION, en su vista pública (sin solución ni el contenido de los casos ocultos). */
  ejercicio?: EjercicioCodigo | null;
  /** Bloque de la lección donde esto se explica, y el segundo del vídeo. */
  bloque_id?: string | null;
  segundo?: number | null;
  /**
   * Las correctas y el porqué. SOLO vienen si el quiz tiene `mostrar_respuesta_correcta`:
   * viajan en el paquete porque este quiz se contesta sin conexión y no hay a quién
   * preguntarle al fallar. Es la razón de que esa bandera se pueda apagar.
   */
  opciones_correctas?: string[] | null;
  explicacion?: string | null;
}

/** Trae la correcta solo cuando el quiz lo permite; la evaluación formal nunca. */
export interface OpcionPresentacion {
  /** true si la opción lleva imagen; se pide a /me/options/{id}/media. */
  tiene_archivo?: boolean;
  /** Por qué esta opción está bien o mal. Sólo viaja si el quiz revela las correctas. */
  feedback?: string | null;
  id: string;
  texto: string;
  columna?: 'A' | 'B';
}

export interface ProgresoRequest {
  client_event_id: string;
  porcentaje?: number;
  segundos_vistos?: number;
  completada?: boolean;
  ocurrido_at: string;
}

export interface EntregaRequest {
  client_event_id: string;
  texto?: string;
  document_id?: string;
  ocurrido_at: string;
}

export interface Certificado {
  id: string;
  codigo: string;
  curso_nombre: string;
  entidad_capacitadora?: string;
  nota?: number;
  emitido_at: string;
  vence_at?: string;
  vencido: boolean;
  anulado: boolean;
  url_verificacion: string;
}

export interface Intento {
  id: string;
  assessment_id: string;
  intento_num: number;
  estado: string;
  expira_at?: string;
  segundos_restantes?: number;
  intentos_restantes?: number;
  preguntas: PreguntaPresentacion[];
}

export interface RespuestaEnviada {
  question_id: string;
  option_ids?: string[];
  parejas?: { opcion_a: string; opcion_b: string }[];
  /** Lo escrito, en TEXTO_ABIERTO y NUMERO. Lo corrige el servidor. */
  texto?: string | null;
}

export interface ResultadoIntento {
  id: string;
  estado: string;
  nota: number;
  nota_minima: number;
  aprobado: boolean;
  expirado: boolean;
  preguntas_correctas: number;
  preguntas_totales: number;
  intentos_restantes?: number;
  /** Qué pasó con cada pregunta. Dice SI acertó y por qué, no cuál era la correcta. */
  detalle?: DetalleRespuesta[];
  /** true = hay código calificándose: la nota puede subir; se vuelve a pedir el resultado. */
  calificando?: boolean;
}

export interface DetalleRespuesta {
  question_id: string;
  enunciado: string;
  correcta: boolean;
  puntaje: number;
  /** La frase del analizador en las escritas; el veredicto en las de marcar. */
  motivo?: string | null;
  /** Sólo PROGRAMACION: las pruebas caso por caso (las ocultas sin su contenido). */
  codigo?: ResultadoCodigo | null;
  /** true = el código de esta pregunta todavía se está calificando. */
  pendiente?: boolean;
}

/** Un curso que hice y que después cambió. */
export interface CursoDesactualizado {
  enrollment_id: string;
  course_id: string;
  codigo: string;
  nombre: string;
  mi_version: number;
  version_vigente: number;
  completado_at: string | null;
  publicada_at: string | null;
  notas_de_la_version: string | null;
}

/** Un trozo del material propio, con el minuto exacto para volver ahí. */
export interface CitaMaterial {
  course_id: string;
  course_version_id: string;
  course_nombre: string;
  enrollment_id: string;
  lesson_id: string;
  lesson_nombre: string;
  resource_id: string;
  segundos: number;
  extracto: string;
}

// ── Calificación ─────────────────────────────────────────────────────────────

/** Mi boletín: la nota de hoy (lo pendiente cuenta como cero) y qué falta para aprobar. */
export interface Boletin {
  enrollment_id: string;
  person_id: string;
  persona_nombre: string;
  cedula: string;
  course_version_id: string;
  curso_nombre: string;
  estado_matricula: string;
  nota: number | null;
  nota_minima: number | null;
  /** true = cumple todos los requisitos que aplican. */
  aprobado: boolean;
  /** true = no queda nada calificable sin presentar ni sin revisar. */
  nota_definitiva: boolean;
  asistencia: number | null;
  asistencia_minima: number | null;
  sesiones: number | null;
  presentes: number | null;
  lecciones_completadas: number;
  lecciones_obligatorias: number;
  requisitos: RequisitoBoletin[];
  modulos: ModuloBoletin[];
}

export interface RequisitoBoletin {
  clave: 'NOTA' | 'ITEMS' | 'MODULOS' | 'EXAMEN_FINAL' | 'EXAMEN_FORMAL' | 'ASISTENCIA' | 'CONTENIDO' | 'ACTIVIDADES';
  descripcion: string;
  /** false = este curso no lo pide; se lista igual para que se sepa. */
  aplica: boolean;
  cumplido: boolean;
  valor: string;
  requerido: string;
}

export interface ModuloBoletin {
  module_id: string;
  nombre: string;
  peso: number | null;
  nota: number | null;
  nota_minima: number | null;
  tiene_calificables: boolean;
  aprobado: boolean;
  items_pendientes: number;
  items: ItemBoletin[];
}

export interface ItemBoletin {
  id: string;
  tipo_item: 'QUIZ' | 'ACTIVIDAD';
  tipo: string;
  titulo: string;
  calificable: boolean;
  peso: number | null;
  nota: number | null;
  estado: 'SIN_PRESENTAR' | 'PENDIENTE_REVISION' | 'CALIFICADO' | 'APROBADO' | 'RECHAZADO' | 'NO_CALIFICA';
  intentos: number | null;
  nota_minima: number | null;
  cumple_minimo: boolean;
}

// ── Profesor ─────────────────────────────────────────────────────────────────

export interface GrupoDelInstructor {
  id: string;
  nombre: string;
  course_version_id: string;
  course_id: string;
  curso_nombre: string;
  version: number;
  modalidad: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado: 'ABIERTO' | 'EN_CURSO' | 'CERRADO';
  org_unit_nombre: string | null;
  principal: boolean;
  matriculados: number;
  aprobados: number;
  entregas_por_revisar: number;
  sesiones: number;
}

export interface GrupoInstructorDetalle {
  id: string;
  course_version_id: string;
  curso_nombre: string;
  nombre: string;
  modalidad: string;
  cupo?: number | null;
  matriculados: number;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  org_unit_nombre?: string | null;
  estado: string;
  instructores: { id: string; user_id: string; principal: boolean }[];
}

export interface MatriculaDelGrupo {
  id: string;
  person_id: string;
  persona_nombre: string;
  cedula: string;
  estado: string;
  porcentaje: number;
  matriculado_at: string;
  vence_at?: string | null;
}

export interface PlanillaGrupo {
  group_id: string;
  nombre: string;
  curso_nombre: string;
  course_version_id: string;
  nota_minima: number | null;
  asistencia_minima: number | null;
  sesiones: number;
  modulos: { module_id: string; nombre: string; orden: number; peso_efectivo: number | null; tiene_calificables: boolean }[];
  filas: FilaPlanilla[];
}

export interface FilaPlanilla {
  enrollment_id: string;
  person_id: string;
  persona_nombre: string;
  cedula: string;
  estado_matricula: string;
  porcentaje: number;
  nota: number | null;
  aprobado: boolean;
  nota_definitiva: boolean;
  asistencia: number | null;
  items_pendientes: number;
  entregas_por_revisar: number;
  modulos: { module_id: string; nota: number | null; aprobado: boolean }[];
}

export interface Entrega {
  id: string;
  activity_id: string;
  actividad_titulo: string;
  enrollment_id: string;
  persona_nombre: string;
  cedula: string;
  estado: 'ENVIADA' | 'APROBADA' | 'RECHAZADA';
  texto?: string | null;
  document_id?: string | null;
  nota?: number | null;
  feedback?: string | null;
  revisado_at?: string | null;
  ocurrido_at?: string | null;
  created_at: string;
}

export interface AsistenciaDelGrupo {
  id: string;
  enrollment_id: string;
  persona_nombre: string;
  cedula: string;
  fecha: string;
  estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO';
  observacion?: string | null;
}

// ── Comentarios ──────────────────────────────────────────────────────────────

export interface Comentario {
  id: string;
  lesson_id: string;
  linaje_id: string;
  parent_id: string | null;
  user_id: string;
  autor_nombre: string | null;
  autor_cedula: string | null;
  texto: string;
  created_at: string;
  editado_at: string | null;
  /** En qué versión del curso se escribió. */
  escrito_en_version: number | null;
  mio: boolean;
  puede_borrar: boolean;
  respuestas: Comentario[];
}

/** Una entrega propia de una actividad, con el resultado de las pruebas si es de código. */
export interface EntregaMia {
  id: string;
  activity_id: string;
  estado: 'ENVIADA' | 'APROBADA' | 'RECHAZADA' | string;
  texto?: string | null;
  document_id?: string | null;
  nota?: number | null;
  feedback?: string | null;
  revisado_at?: string | null;
  created_at: string;
  resultado?: ResultadoCodigo | null;
  calificando?: boolean;
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Consola de administración de Capacitaciones.
 *
 * Separado de `TrainingS` a propósito: aquel es lo que usa el colaborador (`/me/**`) y este es
 * lo que usa quien administra formación. Mezclarlos haría que un cambio en la consola pudiera
 * romper la pantalla de 5.803 operarios.
 *
 * Todos estos endpoints exigen rol de administración; el backend los rechaza si no.
 */
@Injectable({ providedIn: 'root' })
export class TrainingAdminService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/learning`;
  private documentos = `${environment.apiUrl}/api/v1/documents`;

  // ── Cursos ────────────────────────────────────────────────────────────────

  listarCursos(page = 0, size = 50): Promise<Pagina<Curso>> {
    return firstValueFrom(
      this.http.get<Pagina<Curso>>(`${this.base}/courses?page=${page}&size=${size}`)
    );
  }

  obtenerCurso(id: string): Promise<Curso> {
    return firstValueFrom(this.http.get<Curso>(`${this.base}/courses/${id}`));
  }

  crearCurso(req: CursoRequest): Promise<Curso> {
    return firstValueFrom(this.http.post<Curso>(`${this.base}/courses`, req));
  }

  actualizarCurso(id: string, req: CursoRequest): Promise<Curso> {
    return firstValueFrom(this.http.put<Curso>(`${this.base}/courses/${id}`, req));
  }

  archivarCurso(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/courses/${id}`));
  }

  // ── Versiones ─────────────────────────────────────────────────────────────

  versiones(courseId: string): Promise<Version[]> {
    return firstValueFrom(this.http.get<Version[]>(`${this.base}/courses/${courseId}/versions`));
  }

  crearVersion(courseId: string, clonarDesdeVersionId?: string): Promise<Version> {
    return firstValueFrom(this.http.post<Version>(`${this.base}/courses/${courseId}/versions`, {
      notas: 'Nueva versión', clonar_desde_version_id: clonarDesdeVersionId ?? null,
    }));
  }

  publicar(courseId: string, versionId: string): Promise<Version> {
    return firstValueFrom(
      this.http.post<Version>(`${this.base}/courses/${courseId}/versions/${versionId}/publish`, {})
    );
  }

  contenido(courseId: string, versionId: string): Promise<ContenidoVersion> {
    return firstValueFrom(this.http.get<ContenidoVersion>(
      `${this.base}/courses/${courseId}/versions/${versionId}/content`));
  }

  // ── Módulos y lecciones ───────────────────────────────────────────────────

  crearModulo(versionId: string, req: ModuloRequest): Promise<Modulo> {
    return firstValueFrom(
      this.http.post<Modulo>(`${this.base}/courses/versions/${versionId}/modules`, req));
  }

  actualizarModulo(moduleId: string, req: ModuloRequest): Promise<Modulo> {
    return firstValueFrom(
      this.http.put<Modulo>(`${this.base}/courses/modules/${moduleId}`, req));
  }

  eliminarModulo(moduleId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/courses/modules/${moduleId}`));
  }

  crearLeccion(moduleId: string, req: LeccionRequest): Promise<Leccion> {
    return firstValueFrom(
      this.http.post<Leccion>(`${this.base}/courses/modules/${moduleId}/lessons`, req));
  }

  actualizarLeccion(lessonId: string, req: LeccionRequest): Promise<Leccion> {
    return firstValueFrom(
      this.http.put<Leccion>(`${this.base}/courses/lessons/${lessonId}`, req));
  }

  eliminarLeccion(lessonId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/courses/lessons/${lessonId}`));
  }

  agregarRecurso(lessonId: string, req: RecursoRequest): Promise<Recurso> {
    return firstValueFrom(
      this.http.post<Recurso>(`${this.base}/courses/lessons/${lessonId}/resources`, req));
  }

  eliminarRecurso(resourceId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/courses/resources/${resourceId}`));
  }

  /**
   * Sube el archivo a ms-documents y devuelve su id.
   *
   * El vídeo NO pasa por learning-ms: va directo al servicio de documentos, igual que hace
   * Formularios Dinámicos. learning-ms solo guarda la referencia, así que un vídeo de 300 MB
   * no atraviesa dos servicios para acabar en el mismo sitio.
   */
  async subirArchivo(file: File, lessonId: string): Promise<string> {
    const fd = new FormData();
    fd.append('ownerId', `leccion:${lessonId}`);
    fd.append('typeCode', 'CAPACITACION_MATERIAL');
    fd.append('ownerType', 'LEARNING_LESSON');
    fd.append('sourceService', 'tesoro-capacitaciones');
    fd.append('file', file, file.name);
    const r = await firstValueFrom(
      this.http.post<{ document_id: number }>(`${this.documentos}/upload-by-owner`, fd)
        .pipe(map(x => x))
    );
    if (!r?.document_id) throw new Error('ms-documents no confirmó la subida');
    return String(r.document_id);
  }

  // ── Banco de preguntas ────────────────────────────────────────────────────

  listarBancos(courseId?: string): Promise<Pagina<Banco>> {
    const q = courseId ? `?course_id=${courseId}` : '';
    return firstValueFrom(this.http.get<Pagina<Banco>>(`${this.base}/question-banks${q}`));
  }

  crearBanco(req: { nombre: string; course_id?: string | null }): Promise<Banco> {
    return firstValueFrom(this.http.post<Banco>(`${this.base}/question-banks`, req));
  }

  actualizarBanco(id: string, req: { nombre: string; course_id?: string | null }): Promise<Banco> {
    return firstValueFrom(this.http.put<Banco>(`${this.base}/question-banks/${id}`, req));
  }

  eliminarBanco(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/question-banks/${id}`));
  }

  preguntas(bankId: string, soloActivas?: boolean): Promise<Pregunta[]> {
    const q = soloActivas ? '?activas=true' : '';
    return firstValueFrom(
      this.http.get<Pregunta[]>(`${this.base}/question-banks/${bankId}/questions${q}`));
  }

  crearPregunta(bankId: string, req: PreguntaRequest): Promise<Pregunta> {
    return firstValueFrom(
      this.http.post<Pregunta>(`${this.base}/question-banks/${bankId}/questions`, req));
  }

  actualizarPregunta(id: string, req: PreguntaRequest): Promise<Pregunta> {
    return firstValueFrom(this.http.put<Pregunta>(`${this.base}/questions/${id}`, req));
  }

  /** Para una pregunta que ya alguien respondio: crea la corregida y retira la original. */
  nuevaVersionPregunta(id: string, req: PreguntaRequest): Promise<Pregunta> {
    return firstValueFrom(
      this.http.post<Pregunta>(`${this.base}/questions/${id}/nueva-version`, req));
  }

  retirarPregunta(id: string): Promise<Pregunta> {
    return firstValueFrom(this.http.post<Pregunta>(`${this.base}/questions/${id}/retirar`, {}));
  }

  reactivarPregunta(id: string): Promise<Pregunta> {
    return firstValueFrom(this.http.post<Pregunta>(`${this.base}/questions/${id}/reactivar`, {}));
  }

  eliminarPregunta(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/questions/${id}`));
  }

  // ── Quiz de una leccion ───────────────────────────────────────────────────

  quizDeLeccion(lessonId: string): Promise<Quiz> {
    return firstValueFrom(this.http.get<Quiz>(`${this.base}/lessons/${lessonId}/quiz`));
  }

  guardarQuiz(lessonId: string, req: QuizRequest): Promise<Quiz> {
    return firstValueFrom(this.http.put<Quiz>(`${this.base}/lessons/${lessonId}/quiz`, req));
  }

  agregarPreguntasAlQuiz(quizId: string, questionIds: string[]): Promise<Quiz> {
    return firstValueFrom(
      this.http.post<Quiz>(`${this.base}/quizzes/${quizId}/questions`, { question_ids: questionIds }));
  }

  quitarPreguntaDelQuiz(quizId: string, questionId: string): Promise<Quiz> {
    return firstValueFrom(
      this.http.delete<Quiz>(`${this.base}/quizzes/${quizId}/questions/${questionId}`));
  }

  // ── Evaluacion formal de una version ──────────────────────────────────────

  evaluacion(courseVersionId: string): Promise<Evaluacion> {
    return firstValueFrom(
      this.http.get<Evaluacion>(`${this.base}/course-versions/${courseVersionId}/assessment`));
  }

  guardarEvaluacion(courseVersionId: string, req: EvaluacionRequest): Promise<Evaluacion> {
    return firstValueFrom(
      this.http.put<Evaluacion>(`${this.base}/course-versions/${courseVersionId}/assessment`, req));
  }

  eliminarEvaluacion(courseVersionId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/course-versions/${courseVersionId}/assessment`));
  }

  // ── Grupos ────────────────────────────────────────────────────────────────

  listarGrupos(courseVersionId?: string): Promise<Pagina<Grupo>> {
    const q = courseVersionId ? `?course_version_id=${courseVersionId}` : '';
    return firstValueFrom(this.http.get<Pagina<Grupo>>(`${this.base}/groups${q}`));
  }

  obtenerGrupo(id: string): Promise<Grupo> {
    return firstValueFrom(this.http.get<Grupo>(`${this.base}/groups/${id}`));
  }

  crearGrupo(req: GrupoRequest): Promise<Grupo> {
    return firstValueFrom(this.http.post<Grupo>(`${this.base}/groups`, req));
  }

  actualizarGrupo(id: string, req: GrupoRequest): Promise<Grupo> {
    return firstValueFrom(this.http.put<Grupo>(`${this.base}/groups/${id}`, req));
  }

  cambiarEstadoGrupo(id: string, estado: string): Promise<Grupo> {
    return firstValueFrom(
      this.http.put<Grupo>(`${this.base}/groups/${id}/estado?estado=${estado}`, {}));
  }

  matriculados(groupId: string): Promise<Matricula[]> {
    return firstValueFrom(this.http.get<Matricula[]>(`${this.base}/groups/${groupId}/enrollments`));
  }

  /** Matricula masiva por CEDULAS: da de alta a quien todavia no existe en el modulo. */
  matricularPorCedulas(groupId: string, cedulas: string[]): Promise<MatriculaMasiva> {
    return firstValueFrom(this.http.post<MatriculaMasiva>(
      `${this.base}/groups/${groupId}/enrollments/bulk`,
      { cedulas, group_id: groupId, origen: 'MANUAL' }));
  }

  anularMatricula(id: string): Promise<Matricula> {
    return firstValueFrom(this.http.put<Matricula>(`${this.base}/enrollments/${id}/anular`, {}));
  }

  asistencia(groupId: string, fecha?: string): Promise<Asistencia[]> {
    const q = fecha ? `?fecha=${fecha}` : '';
    return firstValueFrom(
      this.http.get<Asistencia[]>(`${this.base}/groups/${groupId}/attendance${q}`));
  }

  pasarLista(groupId: string, fecha: string,
             registros: { enrollment_id: string; estado: string; observacion?: string }[]
  ): Promise<Asistencia[]> {
    return firstValueFrom(this.http.post<Asistencia[]>(
      `${this.base}/groups/${groupId}/attendance`, { fecha, registros }));
  }

  // ── Planes de asignación ──────────────────────────────────────────────────
  // El motor decide QUIÉN recibe QUÉ curso y CUÁNDO. Todo lo de aquí exige rol de
  // administración de formación; el backend responde 403 si no.

  listarPlanes(): Promise<PlanAsignacion[]> {
    return firstValueFrom(this.http.get<PlanAsignacion[]>(`${this.base}/assignment-plans`));
  }

  obtenerPlan(id: string): Promise<PlanAsignacion> {
    return firstValueFrom(this.http.get<PlanAsignacion>(`${this.base}/assignment-plans/${id}`));
  }

  crearPlan(req: PlanRequest): Promise<PlanAsignacion> {
    return firstValueFrom(this.http.post<PlanAsignacion>(`${this.base}/assignment-plans`, req));
  }

  actualizarPlan(id: string, req: PlanRequest): Promise<PlanAsignacion> {
    return firstValueFrom(
      this.http.put<PlanAsignacion>(`${this.base}/assignment-plans/${id}`, req));
  }

  /** El backend responde 409 si se intenta activar un plan que nunca se simuló. */
  activarPlan(id: string, valor: boolean): Promise<PlanAsignacion> {
    return firstValueFrom(this.http.put<PlanAsignacion>(
      `${this.base}/assignment-plans/${id}/activo?valor=${valor}`, {}));
  }

  eliminarPlan(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/assignment-plans/${id}`).pipe(map(() => void 0)));
  }

  /** Catálogo de ejes y operadores: el constructor de audiencias no hardcodea ninguno. */
  ejesAsignacion(): Promise<EjeAsignacion[]> {
    return firstValueFrom(this.http.get<EjeAsignacion[]>(`${this.base}/assignment-axes`));
  }

  criteriosDePlan(planId: string): Promise<CriterioAudiencia[]> {
    return firstValueFrom(
      this.http.get<CriterioAudiencia[]>(`${this.base}/assignment-plans/${planId}/criteria`));
  }

  agregarCriterio(planId: string, req: CriterioRequest): Promise<CriterioAudiencia> {
    return firstValueFrom(this.http.post<CriterioAudiencia>(
      `${this.base}/assignment-plans/${planId}/criteria`, req));
  }

  quitarCriterio(criterioId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/assignment-criteria/${criterioId}`).pipe(map(() => void 0)));
  }

  itemsDePlan(planId: string): Promise<ItemPlan[]> {
    return firstValueFrom(
      this.http.get<ItemPlan[]>(`${this.base}/assignment-plans/${planId}/items`));
  }

  agregarItemPlan(planId: string, req: ItemPlanRequest): Promise<ItemPlan> {
    return firstValueFrom(
      this.http.post<ItemPlan>(`${this.base}/assignment-plans/${planId}/items`, req));
  }

  quitarItemPlan(itemId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/assignment-items/${itemId}`).pipe(map(() => void 0)));
  }

  disparadoresDePlan(planId: string): Promise<Disparador[]> {
    return firstValueFrom(
      this.http.get<Disparador[]>(`${this.base}/assignment-plans/${planId}/triggers`));
  }

  agregarDisparador(planId: string, req: DisparadorRequest): Promise<Disparador> {
    return firstValueFrom(this.http.post<Disparador>(
      `${this.base}/assignment-plans/${planId}/triggers`, req));
  }

  quitarDisparador(triggerId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/assignment-triggers/${triggerId}`).pipe(map(() => void 0)));
  }

  /** Dry-run: evalúa y escribe la bitácora persona a persona, sin matricular a nadie. */
  simularPlan(id: string): Promise<CorridaPlan> {
    return firstValueFrom(
      this.http.post<CorridaPlan>(`${this.base}/assignment-plans/${id}/simulate`, {}));
  }

  ejecutarPlan(id: string): Promise<CorridaPlan> {
    return firstValueFrom(
      this.http.post<CorridaPlan>(`${this.base}/assignment-plans/${id}/run`, {}));
  }

  corridasDePlan(id: string): Promise<CorridaPlan[]> {
    return firstValueFrom(
      this.http.get<CorridaPlan[]>(`${this.base}/assignment-plans/${id}/runs`));
  }

  /** `coincide=false` devuelve justamente a quien NO alcanzó el plan, y por qué. */
  bitacoraDeCorrida(runId: string, coincide?: boolean): Promise<LineaBitacora[]> {
    const q = coincide === undefined ? '' : `?coincide=${coincide}`;
    return firstValueFrom(
      this.http.get<LineaBitacora[]>(`${this.base}/assignment-runs/${runId}/log${q}`));
  }

  // ── Cumplimiento ──────────────────────────────────────────────────────────

  resumenCumplimiento(courseId?: string): Promise<ResumenCumplimiento> {
    const q = courseId ? `?course_id=${courseId}` : '';
    return firstValueFrom(
      this.http.get<ResumenCumplimiento>(`${this.base}/compliance/resumen${q}`));
  }

  matrizCumplimiento(courseId?: string): Promise<FilaMatriz[]> {
    const q = courseId ? `?course_id=${courseId}` : '';
    return firstValueFrom(this.http.get<FilaMatriz[]>(`${this.base}/compliance/matriz${q}`));
  }

  personasCumplimiento(estado?: string, courseId?: string, limite = 300)
    : Promise<FilaPersonaCumplimiento[]> {
    const p = new URLSearchParams();
    if (estado) p.set('estado', estado);
    if (courseId) p.set('course_id', courseId);
    p.set('limite', String(limite));
    return firstValueFrom(
      this.http.get<FilaPersonaCumplimiento[]>(`${this.base}/compliance/personas?${p}`));
  }

  /** Cargos que nadie clasificó: a esa gente ningún plan la alcanza. */
  cargosSinClasificar(): Promise<CargoSinFamilia[]> {
    return firstValueFrom(
      this.http.get<CargoSinFamilia[]>(`${this.base}/job-families/unmapped`));
  }
}

export interface Banco {
  id: string;
  nombre: string;
  course_id?: string;
  course_nombre?: string;
  transversal: boolean;
  total_preguntas: number;
  created_at: string;
}

export interface Pregunta {
  id: string;
  bank_id: string;
  enunciado: string;
  tipo: 'OPCION_MULTIPLE' | 'VERDADERO_FALSO' | 'EMPAREJAR';
  dificultad?: string;
  explicacion?: string;
  activa: boolean;
  /** true = ya la respondio alguien, asi que solo admite versionado, no edicion. */
  ya_respondida: boolean;
  editable: boolean;
  opciones: Opcion[];
}

export interface Opcion {
  id?: string;
  texto: string;
  correcta: boolean;
  pareja_clave?: string;
  feedback?: string;
  orden?: number;
}

export interface PreguntaRequest {
  enunciado: string;
  tipo: string;
  dificultad?: string;
  explicacion?: string;
  activa?: boolean;
  opciones: Opcion[];
}

export interface Quiz {
  id: string;
  lesson_id: string;
  intentos_max: number;
  feedback_inmediato: boolean;
  barajar_preguntas: boolean;
  barajar_opciones: boolean;
  total_preguntas: number;
  editable: boolean;
  preguntas: Pregunta[];
}

export interface QuizRequest {
  intentos_max?: number;
  feedback_inmediato?: boolean;
  barajar_preguntas?: boolean;
  barajar_opciones?: boolean;
}

export interface Evaluacion {
  id: string;
  course_version_id: string;
  bank_id?: string;
  nombre: string;
  num_preguntas: number;
  nota_minima: number;
  intentos_max: number;
  tiempo_limite_min?: number;
  espera_reintento_min: number;
  barajar_preguntas: boolean;
  barajar_opciones: boolean;
  requiere_supervision: boolean;
  preguntas_disponibles: number;
  editable: boolean;
}

export interface EvaluacionRequest {
  nombre: string;
  bank_id?: string | null;
  num_preguntas?: number;
  nota_minima?: number;
  intentos_max?: number;
  tiempo_limite_min?: number | null;
  espera_reintento_min?: number;
  barajar_preguntas?: boolean;
  barajar_opciones?: boolean;
  requiere_supervision?: boolean;

}

export interface Grupo {
  id: string;
  course_version_id: string;
  curso_nombre: string;
  nombre: string;
  modalidad: string;
  cupo?: number;
  matriculados: number;
  cupos_libres?: number;
  fecha_inicio?: string;
  fecha_fin?: string;
  org_unit_id?: string;
  org_unit_nombre?: string;
  estado: 'ABIERTO' | 'EN_CURSO' | 'CERRADO';
  instructores: { id: string; user_id: string; principal: boolean }[];
}

export interface GrupoRequest {
  course_version_id: string;
  nombre: string;
  modalidad: string;
  cupo?: number | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  org_unit_id?: string | null;
}

export interface Matricula {
  id: string;
  person_id: string;
  persona_nombre: string;
  cedula: string;
  curso_nombre: string;
  version: number;
  group_id?: string;
  origen: string;
  estado: string;
  porcentaje: number;
  matriculado_at: string;
  vence_at?: string;
}

export interface MatriculaMasiva {
  matriculadas: number;
  omitidas: number;
  creadas: Matricula[];
  omisiones: { person_id?: string; motivo: string }[];
}

export interface Asistencia {
  id: string;
  enrollment_id: string;
  persona_nombre: string;
  cedula: string;
  fecha: string;
  estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO';
  observacion?: string;
}

// ── Contratos ───────────────────────────────────────────────────────────────

export interface Pagina<T> {
  content: T[];
  total_elements: number;
  total_pages: number;
  page: number;
  size: number;
}

export interface Curso {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string;
  obligatorio: boolean;
  vigencia_meses?: number;
  entidad_capacitadora?: string;
  modalidad_default: string;
  estado: string;
  version_publicada?: number;
  created_at: string;
}

export interface CursoRequest {
  codigo: string;
  nombre: string;
  descripcion?: string;
  obligatorio?: boolean;
  vigencia_meses?: number;
  entidad_capacitadora?: string;
  modalidad_default?: string;
}

export interface Version {
  id: string;
  course_id: string;
  version: number;
  estado: 'BORRADOR' | 'PUBLICADA' | 'ARCHIVADA';
  notas?: string;
  publicada_at?: string;
  editable: boolean;
}

export interface ContenidoVersion {
  course_version_id: string;
  course_id: string;
  curso_nombre: string;
  version: number;
  estado: string;
  modulos: Modulo[];
}

export interface Modulo {
  id: string;
  nombre: string;
  descripcion?: string;
  orden: number;
  lecciones: Leccion[];
}

export interface ModuloRequest {
  nombre: string;
  descripcion?: string;
  orden?: number;
}

export interface Leccion {
  id: string;
  nombre: string;
  tipo: 'VIDEO' | 'PDF' | 'TEXTO' | 'ENLACE';
  contenido?: string;
  duracion_min?: number;
  obligatoria: boolean;
  orden: number;
  recursos?: Recurso[];
}

export interface LeccionRequest {
  nombre: string;
  tipo: string;
  contenido?: string;
  duracion_min?: number;
  obligatoria?: boolean;
  orden?: number;
}

export interface Recurso {
  id: string;
  titulo?: string;
  tipo: string;
  document_id?: string;
  url?: string;
  orden: number;
}

export interface RecursoRequest {
  tipo: string;
  titulo?: string;
  document_id?: string;
  url?: string;
  orden?: number;
}
// ── Planes de asignación ────────────────────────────────────────────────────

export interface PlanAsignacion {
  id: string;
  codigo?: string | null;
  nombre: string;
  descripcion?: string | null;
  activo: boolean;
  vigente_desde?: string | null;
  vigente_hasta?: string | null;
  /** Conteos, no listas: el detalle se pide aparte. */
  criterios: number;
  items: number;
  disparadores: string[];
  ultima_corrida?: CorridaPlan | null;
}

export interface PlanRequest {
  codigo?: string | null;
  nombre: string;
  descripcion?: string | null;
  vigente_desde?: string | null;
  vigente_hasta?: string | null;
}

export interface CriterioAudiencia {
  id: string;
  /** OR dentro del mismo grupo, AND entre grupos distintos. */
  grupo_orden: number;
  tipo: string;
  operador: string;
  valor: string;
  negado: boolean;
}

export interface CriterioRequest {
  grupo_orden?: number;
  tipo: string;
  operador?: string;
  valor: string;
  negado?: boolean;
}

export interface EjeAsignacion {
  eje: string;
  descripcion: string;
  operadores: string[];
  fuente: string;
}

export interface ItemPlan {
  id: string;
  course_id?: string | null;
  curso_nombre?: string | null;
  program_id?: string | null;
  programa_nombre?: string | null;
  group_id?: string | null;
  plazo_dias?: number | null;
  orden: number;
}

export interface ItemPlanRequest {
  course_id?: string | null;
  program_id?: string | null;
  group_id?: string | null;
  plazo_dias?: number | null;
  orden?: number;
}

export interface Disparador {
  id: string;
  evento: string;
  cron?: string | null;
  event_code?: string | null;
}

export interface DisparadorRequest {
  evento: string;
  cron?: string | null;
  event_code?: string | null;
}

export interface CorridaPlan {
  id: string;
  plan_id: string;
  modo: 'SIMULACION' | 'EJECUCION' | string;
  disparador?: string | null;
  estado: 'EN_CURSO' | 'OK' | 'ERROR' | string;
  evaluadas: number;
  coincidencias: number;
  matriculas: number;
  error_mensaje?: string | null;
  iniciado_at?: string | null;
  terminado_at?: string | null;
}

export interface LineaBitacora {
  id: string;
  run_id: string;
  person_id: string;
  persona_nombre?: string | null;
  cedula?: string | null;
  coincide: boolean;
  motivo?: string | null;
  enrollment_id?: string | null;
  created_at?: string | null;
}

// ── Cumplimiento ────────────────────────────────────────────────────────────

export interface ResumenCumplimiento {
  matriculas: number;
  personas: number;
  al_dia: number;
  por_vencer: number;
  vencidos: number;
  en_curso: number;
  pendientes: number;
  reprobados: number;
  porcentaje_cumplimiento: number;
  personas_activas: number;
  /** Gente activa sin una sola matrícula: no sale en ninguna fila de la matriz. */
  personas_sin_matricula: number;
  cargos_sin_clasificar: number;
  cursos_obligatorios: number;
}

export interface FilaMatriz {
  course_id: string;
  curso: string;
  codigo?: string | null;
  obligatorio: boolean;
  vigencia_meses?: number | null;
  personas: number;
  al_dia: number;
  por_vencer: number;
  vencidos: number;
  en_curso: number;
  pendientes: number;
  reprobados: number;
  porcentaje: number;
}

export interface FilaPersonaCumplimiento {
  person_id: string;
  cedula?: string | null;
  nombre: string;
  cargo?: string | null;
  course_id: string;
  curso: string;
  estado_matricula: string;
  /** Estado de CUMPLIMIENTO: AL_DIA, POR_VENCER, VENCIDO, EN_CURSO, PENDIENTE, REPROBADO. */
  estado: string;
  vence_at?: string | null;
  porcentaje?: number | null;
}

export interface CargoSinFamilia {
  id: string;
  cargo_crudo: string;
  cargo_norm?: string | null;
  sufijo_sitio?: string | null;
  job_family_id?: string | null;
  job_family_nombre?: string | null;
  excluido: boolean;
  motivo_exclusion?: string | null;
  origen?: string | null;
  /** Ordenados por esto: primero el cargo que deja a más gente sin formación. */
  contratos_activos: number;
}

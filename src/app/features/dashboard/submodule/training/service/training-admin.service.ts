import { Injectable, inject } from '@angular/core';
import type { EjercicioCodigo } from './codigo.service';
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
    // OJO con el ownerId. `upload-by-owner` agrupa por (owner, tipo): si ya hay un documento
    // de ese dueño y ese tipo, el archivo entra como una VERSIÓN NUEVA que deja la anterior
    // en is_current=false. Con el id de la lección como dueño, subir un segundo vídeo a la
    // misma lección convertía al primero en una versión vieja del mismo documento, y los dos
    // bloques acababan mostrando el mismo vídeo.
    //
    // Por eso el dueño es un id propio de ESTA subida. No se pierde la relación: quien sabe a
    // qué lección pertenece el archivo es learning-ms, que guarda el document_id en su recurso.
    // (Además `owner_id` es varchar(40): un UUID pelado cabe, "leccion:"+UUID son 44 y la
    // subida moría con "Data too long", que al usuario le llegaba como 409 "Conflicto de datos".)
    fd.append('ownerId', crypto.randomUUID());
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

  /**
   * Descarta un borrador con todo su contenido.
   *
   * Solo BORRADOR: el backend rechaza una versión publicada, porque hay gente que la cursó con
   * ese contenido exacto y su certificado lo respalda.
   */
  descartarBorrador(courseId: string, versionId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/courses/${courseId}/versions/${versionId}`));
  }

  /**
   * Apunta una pregunta al sitio de la lección donde se explica.
   *
   * Es lo que convierte un fallo en algo útil: en vez de "incorrecta", la persona recibe el
   * atajo al bloque —y al segundo del vídeo— donde está la respuesta. `blockId` nulo la quita.
   */
  referenciaDePregunta(quizId: string, questionId: string,
                       blockId: string | null, segundo: number | null): Promise<Quiz> {
    return firstValueFrom(
      this.http.put<Quiz>(`${this.base}/quizzes/${quizId}/questions/${questionId}/referencia`,
        { block_id: blockId, segundo }));
  }

  /**
   * Sube el material de apoyo de una pregunta a gestión documental y devuelve su document_id.
   *
   * No pasa por learning-ms: acabaría en gestión documental de todos modos, y mandarlo dos
   * veces solo duplica el tráfico. Igual que el material de las lecciones.
   */
  async subirMediaDePregunta(file: File, bankId: string): Promise<string> {
    const fd = new FormData();
    // Un dueño por archivo, no por banco: ver la nota de subirArchivo. Con el banco como
    // dueño, la imagen de la opción B se guardaba como versión 2 de la imagen de la opción A
    // y las dos se veían iguales — que en «une cada señal con lo que significa» deja el
    // ejercicio sin resolver.
    fd.append('ownerId', crypto.randomUUID());
    fd.append('typeCode', 'CAPACITACION_MATERIAL');
    fd.append('ownerType', 'LEARNING_QUESTION');
    fd.append('sourceService', 'tesoro-capacitaciones');
    fd.append('file', file, file.name);
    const r = await firstValueFrom(
      this.http.post<{ document_id: number }>(`${this.documentos}/upload-by-owner`, fd));
    if (!r?.document_id) throw new Error('ms-documents no confirmó la subida');
    return String(r.document_id);
  }

  /**
   * Dónde parece que se explica una pregunta, según las transcripciones del curso.
   *
   * Lo que se guarda es lo que elija la persona: una sugerencia equivocada mandaría a repasar
   * al minuto que no es, y quien falla la pregunta no tiene cómo saber que el atajo estaba mal.
   */
  sugerenciasDeReferencia(quizId: string, questionId: string): Promise<SugerenciaReferencia[]> {
    return firstValueFrom(this.http.get<SugerenciaReferencia[]>(
      `${this.base}/quizzes/${quizId}/questions/${questionId}/sugerencias-referencia`));
  }

  /**
   * Propone preguntas: de la clase, de esta lección sola o sobre un tema.
   *
   * Con material sólo mira las lecciones hasta ésta: no puede preguntar por algo que a quien lo
   * responda todavía nadie le enseñó. Sobre un tema escribe libremente, y entonces el servidor
   * busca después si el material lo respalda, para traer el atajo o avisar de que no lo hay.
   * Devuelve borradores; guardarlos es otro paso.
   */
  sugerirPreguntas(quizId: string, opts: PedidoDePreguntas = {}): Promise<PreguntaSugerida[]> {
    return firstValueFrom(this.http.post<PreguntaSugerida[]>(
      `${this.base}/quizzes/${quizId}/sugerir-preguntas`, {
        cantidad: opts.cantidad ?? 5,
        alcance: opts.alcance ?? 'HASTA_AQUI',
        // Cadena vacía = «cualquiera»: el modelo elige el tipo de cada pregunta.
        tipo: opts.tipo || null,
        tema: opts.tema?.trim() || null,
        instrucciones: opts.instrucciones?.trim() || null,
      }));
  }

  // ── Calificación: pesos, requisitos y boletines ────────────────────────────

  /**
   * Cómo se reparte la nota de una versión: módulos e items con su peso configurado y el
   * efectivo, los requisitos y las advertencias (pesos que no suman 100, examen final sin
   * mínimo...). Es lo que la consola pinta para que se vea de un vistazo qué vale cada cosa.
   */
  esquemaCalificacion(versionId: string): Promise<EsquemaCalificacion> {
    return firstValueFrom(this.http.get<EsquemaCalificacion>(
      `${this.base}/course-versions/${versionId}/calificacion`));
  }

  /** Solo en BORRADOR: los requisitos son parte de lo que se publica. */
  guardarRequisitos(versionId: string, req: RequisitosRequest): Promise<Requisitos> {
    return firstValueFrom(this.http.put<Requisitos>(
      `${this.base}/course-versions/${versionId}/requisitos`, req));
  }

  /** El boletín de alguien: para su instructor o quien tenga alcance sobre la persona. */
  boletinDeMatricula(enrollmentId: string): Promise<Boletin> {
    return firstValueFrom(this.http.get<Boletin>(
      `${this.base}/enrollments/${enrollmentId}/calificacion`));
  }

  /** La planilla del grupo: una fila por persona con su nota por módulo. */
  planillaDeGrupo(groupId: string): Promise<BoletinGrupo> {
    return firstValueFrom(this.http.get<BoletinGrupo>(
      `${this.base}/groups/${groupId}/calificaciones`));
  }

  // ── Plantillas de certificado ─────────────────────────────────────────────

  listarPlantillas(): Promise<PlantillaCertificado[]> {
    return firstValueFrom(this.http.get<PlantillaCertificado[]>(`${this.base}/certificate-templates`));
  }

  crearPlantilla(req: PlantillaRequest): Promise<PlantillaCertificado> {
    return firstValueFrom(this.http.post<PlantillaCertificado>(`${this.base}/certificate-templates`, req));
  }

  actualizarPlantilla(id: string, req: PlantillaRequest): Promise<PlantillaCertificado> {
    return firstValueFrom(
      this.http.put<PlantillaCertificado>(`${this.base}/certificate-templates/${id}`, req));
  }

  eliminarPlantilla(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/certificate-templates/${id}`).pipe(map(() => void 0)));
  }

  predeterminarPlantilla(id: string): Promise<PlantillaCertificado> {
    return firstValueFrom(this.http.put<PlantillaCertificado>(
      `${this.base}/certificate-templates/${id}/predeterminada`, {}));
  }

  /** PDF de muestra de lo que se está editando, sin guardar. */
  muestraDePlantilla(req: PlantillaRequest): Promise<Blob> {
    return firstValueFrom(this.http.post(`${this.base}/certificate-templates/preview`, req,
      { responseType: 'blob' }));
  }

  /** Sube el logo o una firma para una plantilla y devuelve su document_id. */
  async subirImagenDePlantilla(file: File): Promise<string> {
    const fd = new FormData();
    // Un dueño por archivo, por lo mismo que el material de las lecciones: con un dueño fijo
    // la segunda imagen entraría como versión de la primera.
    fd.append('ownerId', crypto.randomUUID());
    fd.append('typeCode', 'CAPACITACION_MATERIAL');
    fd.append('ownerType', 'LEARNING_CERT_TEMPLATE');
    fd.append('sourceService', 'tesoro-capacitaciones');
    fd.append('file', file, file.name);
    const r = await firstValueFrom(
      this.http.post<{ document_id: number }>(`${this.documentos}/upload-by-owner`, fd));
    if (!r?.document_id) throw new Error('ms-documents no confirmó la subida');
    return String(r.document_id);
  }

  /**
   * Marca (o desmarca) una pregunta como obligatoria dentro de este quiz.
   *
   * Va en la relación y no en la pregunta: la misma pregunta del banco puede ser
   * imprescindible en la evaluación de alturas y opcional en la de inducción.
   */
  obligatoriaDePregunta(quizId: string, questionId: string, valor: boolean): Promise<Quiz> {
    return firstValueFrom(this.http.put<Quiz>(
      `${this.base}/quizzes/${quizId}/questions/${questionId}/obligatoria?valor=${valor}`, {}));
  }

  /**
   * El tablero de administración, entero, en una sola petición.
   *
   * Va junto y no en seis llamadas porque las cifras tienen que cuadrar entre sí: pedidas por
   * separado, dos de ellas pueden venir de instantes distintos y no sumar.
   */
  tableroAdmin(orgUnitId?: string): Promise<TableroAdmin> {
    const q = orgUnitId ? `?org_unit_id=${orgUnitId}` : '';
    return firstValueFrom(this.http.get<TableroAdmin>(`${this.base}/admin/home${q}`));
  }

  /** Reordena las preguntas del quiz. El backend exige la lista completa, no el movimiento. */
  reordenarPreguntasDelQuiz(quizId: string, questionIds: string[]): Promise<Quiz> {
    return firstValueFrom(
      this.http.put<Quiz>(`${this.base}/quizzes/${quizId}/questions/order`,
        { question_ids: questionIds }));
  }

  /**
   * Las tareas de una lección.
   *
   * La tarjeta del bloque la usa para rellenar el formulario de una ACTIVIDAD: el árbol de
   * contenido trae solo el `activity_id`, porque cargar cada tarea entera engordaría el
   * payload que la app en campo se baja completo para una pantalla que solo ve administración.
   */
  actividadesDeLeccion(lessonId: string): Promise<Actividad[]> {
    return firstValueFrom(
      this.http.get<Actividad[]>(`${this.base}/lessons/${lessonId}/activities`));
  }

  // ── Bloques de lección ────────────────────────────────────────────────────

  /**
   * Agrega un bloque al final de la lección.
   *
   * Una sola llamada crea el bloque Y su contenido. Pedirle al frontend que cree primero el
   * recurso y luego el bloque dejaría bloques huérfanos cada vez que la segunda petición se
   * pierda — y en campo se pierde.
   */
  crearBloque(lessonId: string, req: BloqueRequest): Promise<Bloque> {
    return firstValueFrom(
      this.http.post<Bloque>(`${this.base}/lessons/${lessonId}/blocks`, req));
  }

  actualizarBloque(blockId: string, req: BloqueRequest): Promise<Bloque> {
    return firstValueFrom(this.http.put<Bloque>(`${this.base}/blocks/${blockId}`, req));
  }

  /** Se manda el orden COMPLETO, no "sube este uno": dos pestañas abiertas se pisarían. */
  reordenarBloques(lessonId: string, bloques: string[]): Promise<Bloque[]> {
    return firstValueFrom(
      this.http.put<Bloque[]>(`${this.base}/lessons/${lessonId}/blocks/order`, { bloques }));
  }

  eliminarBloque(blockId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/blocks/${blockId}`));
  }

  // ── Etiquetado por IA ─────────────────────────────────────────────────────

  /**
   * Estado IA de la versión: cómo va la transcripción de cada material y qué etiquetas hay
   * por revisar.
   *
   * Va en una petición aparte de `contenido()` a propósito: el árbol de contenido es el
   * mismo payload que la app en campo se baja entero, y colgarle las transcripciones lo
   * engordaría para todo el mundo por una pantalla que solo ve administración.
   */
  estadoIa(versionId: string): Promise<VersionIa> {
    return firstValueFrom(this.http.get<VersionIa>(`${this.base}/ia/versions/${versionId}`));
  }

  confirmarEtiqueta(tagId: string): Promise<EtiquetaIa> {
    return firstValueFrom(
      this.http.post<EtiquetaIa>(`${this.base}/ia/tags/${tagId}/confirmar`, {}));
  }

  descartarEtiqueta(tagId: string): Promise<EtiquetaIa> {
    return firstValueFrom(
      this.http.post<EtiquetaIa>(`${this.base}/ia/tags/${tagId}/descartar`, {}));
  }

  agregarEtiqueta(lessonId: string, etiqueta: string, tipo = 'TEMA'): Promise<EtiquetaIa> {
    return firstValueFrom(
      this.http.post<EtiquetaIa>(`${this.base}/ia/lessons/${lessonId}/tags`, { etiqueta, tipo }));
  }

  reprocesarMaterial(resourceId: string): Promise<MaterialIa> {
    return firstValueFrom(
      this.http.post<MaterialIa>(`${this.base}/ia/resources/${resourceId}/reprocesar`, {}));
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

  /**
   * Busca preguntas ya parametrizadas en TODOS los bancos.
   *
   * Es lo que convierte "agregar del banco" en "pedir la que ya existe": quien arma un quiz no
   * tiene por qué acordarse de en qué banco quedó guardada. Con `quiz_id` el servidor deja
   * fuera las que ese quiz ya tiene, para no ofrecer algo que al agregarse daría error.
   */
  buscarPreguntas(opts: {
    q?: string; bank_id?: string | null; tipo?: string | null;
    quiz_id?: string | null; limite?: number;
  }): Promise<PreguntaEncontrada[]> {
    const params = new URLSearchParams();
    if (opts.q?.trim()) params.set('q', opts.q.trim());
    if (opts.bank_id) params.set('bank_id', opts.bank_id);
    if (opts.tipo) params.set('tipo', opts.tipo);
    if (opts.quiz_id) params.set('quiz_id', opts.quiz_id);
    params.set('limite', String(opts.limite ?? 25));
    return firstValueFrom(
      this.http.get<PreguntaEncontrada[]>(`${this.base}/questions/search?${params.toString()}`));
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

  /** El primer quiz de la lección. Contrato viejo; la tarjeta usa `obtenerQuiz` por id. */
  quizDeLeccion(lessonId: string): Promise<Quiz> {
    return firstValueFrom(this.http.get<Quiz>(`${this.base}/lessons/${lessonId}/quiz`));
  }

  guardarQuiz(lessonId: string, req: QuizRequest): Promise<Quiz> {
    return firstValueFrom(this.http.put<Quiz>(`${this.base}/lessons/${lessonId}/quiz`, req));
  }

  /**
   * Un quiz por su id. Una lección admite varios —cada bloque QUIZ trae el suyo—, así que la
   * tarjeta pide el del bloque y no "el de la lección".
   */
  obtenerQuiz(quizId: string): Promise<Quiz> {
    return firstValueFrom(this.http.get<Quiz>(`${this.base}/quizzes/${quizId}`));
  }

  actualizarQuiz(quizId: string, req: QuizRequest): Promise<Quiz> {
    return firstValueFrom(this.http.put<Quiz>(`${this.base}/quizzes/${quizId}`, req));
  }

  /** El curso tal como lo verá quien lo curse, sin matrícula. Para recorrerlo antes de publicar. */
  previsualizarVersion(courseId: string, versionId: string): Promise<PaqueteCurso> {
    return firstValueFrom(this.http.get<PaqueteCurso>(
      `${this.base}/courses/${courseId}/versions/${versionId}/preview`));
  }

  /** La misma clase a lo largo de las versiones del curso, de la más vieja a la más nueva. */
  historialDeLeccion(lessonId: string): Promise<HistorialLeccion[]> {
    return firstValueFrom(this.http.get<HistorialLeccion[]>(
      `${this.base}/courses/lessons/${lessonId}/historial`));
  }

  /**
   * Mete preguntas en el quiz diciendo CÓMO entran, que es lo que después muestra la etiqueta
   * del listado: escritas aquí (NUEVA), aceptadas de una propuesta (IA) o traídas del banco.
   */
  agregarPreguntasAlQuiz(quizId: string, questionIds: string[],
                         origen: OrigenEnQuiz = 'BANCO'): Promise<Quiz> {
    return firstValueFrom(
      this.http.post<Quiz>(`${this.base}/quizzes/${quizId}/questions`,
        { question_ids: questionIds, origen }));
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
  /** Texto enriquecido de apoyo. El enunciado va en texto plano. */
  cuerpo_html?: string | null;
  /** IMAGEN | VIDEO, o null si la pregunta no lleva material. */
  media_tipo?: 'IMAGEN' | 'VIDEO' | null;
  media_document_id?: string | null;
  media_url?: string | null;
  media_mime?: string | null;
  tipo: 'OPCION_MULTIPLE' | 'VERDADERO_FALSO' | 'EMPAREJAR' | 'TEXTO_ABIERTO' | 'NUMERO' | 'PROGRAMACION';
  dificultad?: string;
  /** Sólo en las que se responden escribiendo. */
  criterio?: CriterioPregunta | null;
  /** Sólo PROGRAMACION: el ejercicio completo (con la solución). */
  ejercicio?: EjercicioCodigo | null;
  explicacion?: string;
  activa: boolean;
  /** true = ya la respondio alguien, asi que solo admite versionado, no edicion. */
  ya_respondida: boolean;
  editable: boolean;
  opciones: Opcion[];
  /**
   * Cómo nació: MANUAL | IA_MATERIAL | IA_TEMA. Falta en las anteriores a la columna, y de
   * ésas no se sabe: la consola no pinta etiqueta cuando el dato no está.
   */
  origen?: string | null;
}

export interface Opcion {
  /** Imagen de la opción. Se sirve por proxy; el document_id nunca llega al alumno. */
  media_document_id?: string | null;
  media_mime?: string | null;
  id?: string;
  texto: string;
  correcta: boolean;
  pareja_clave?: string;
  feedback?: string;
  orden?: number;
}

/** Una pregunta encontrada por la búsqueda, con el banco del que sale. */
export interface PreguntaEncontrada {
  bank_id: string;
  bank_nombre: string;
  pregunta: Pregunta;
}

/**
 * Con qué se corrige una pregunta que se responde escribiendo.
 *
 * Es el mismo criterio que usa el examen de Formularios Dinámicos: el analizador vive en
 * `commons.calificacion` y lo comparten los dos módulos. Lo que cambia es sólo el envoltorio.
 */
export interface CriterioPregunta {
  modo: 'TEXTO_CONTIENE' | 'TEXTO_SIMILITUD' | 'NUMERO_RANGO' | 'PRESENCIA' | 'MANUAL';
  contiene?: string[] | null;
  no_contiene?: string[] | null;
  minimo_aciertos?: number | null;
  respuesta_modelo?: string | null;
  umbral_similitud?: number | null;
  min?: number | null;
  max?: number | null;
}

export interface PreguntaRequest {
  enunciado: string;
  cuerpo_html?: string;
  media_tipo?: string | null;
  media_document_id?: string | null;
  media_url?: string | null;
  media_mime?: string | null;
  tipo: string;
  dificultad?: string;
  explicacion?: string;
  activa?: boolean;
  /** Sólo en las que se responden escribiendo (TEXTO_ABIERTO, NUMERO). */
  criterio?: CriterioPregunta | null;
  opciones: Opcion[];
  /** MANUAL | IA_MATERIAL | IA_TEMA. Sin esto, el servidor la da por escrita a mano. */
  origen?: string | null;
  /** Sólo PROGRAMACION. */
  ejercicio?: EjercicioCodigo | null;
}

export interface Quiz {
  id: string;
  lesson_id: string;
  intentos_max: number;
  feedback_inmediato: boolean;
  barajar_preguntas: boolean;
  barajar_opciones: boolean;
  /** Cuántas preguntas salen de las que tiene el quiz. null = todas. */
  preguntas_por_intento?: number | null;
  modo_presentacion: 'TODAS' | 'UNA_POR_UNA';
  permite_volver: boolean;
  mostrar_respuesta_correcta: boolean;
  /** Cómo se llama en el boletín. Se escribe una vez, en el título del bloque. */
  titulo?: string | null;
  /** ACTIVIDAD = suma como cualquier item · EXAMEN_FINAL = además puede exigir mínimo · PRACTICA = no califica. */
  tipo: TipoQuiz;
  /** false = se responde y se guarda, pero no suma a la nota del módulo. */
  calificable: boolean;
  /** Porcentaje dentro del módulo. null = reparto igual con los demás sin peso. */
  peso?: number | null;
  /** Nota mínima propia (0..100). Si está, hay que alcanzarla en algún intento. */
  nota_minima?: number | null;
  /** Modo examen: no se puede pegar en lo escrito ni copiar el enunciado. */
  bloquea_pegado: boolean;
  total_preguntas: number;
  editable: boolean;
  preguntas: Pregunta[];
  /** A dónde manda cada pregunta al fallar. Solo trae las que tienen referencia puesta. */
  referencias: ReferenciaPregunta[];
  /** Las que entran siempre, aunque el resto del cuestionario se sortee. */
  obligatorias: string[];
  /**
   * Cómo entró cada pregunta a ESTE quiz. Va aparte por lo mismo que las referencias: es un
   * dato de la relación, no de la pregunta del banco. Sólo trae las que lo tienen.
   */
  origenes?: OrigenDePregunta[];
}

/** Cómo entró una pregunta a este quiz. */
export interface OrigenDePregunta {
  question_id: string;
  origen: OrigenEnQuiz;
}

/** NUEVA = se escribió aquí · IA = se aceptó una propuesta · BANCO = ya existía. */
export type OrigenEnQuiz = 'NUEVA' | 'IA' | 'BANCO';

/**
 * Qué preguntas se le piden al modelo y sobre qué.
 *
 * Todo opcional a propósito: el botón tiene que funcionar sin tocar nada —lo normal es
 * «propónme preguntas de esta clase»— y los campos son para cuando hace falta apretar.
 */
export interface PedidoDePreguntas {
  cantidad?: number;
  /** LECCION = sólo esta clase · HASTA_AQUI = y las anteriores · LIBRE = sobre un tema. */
  alcance?: 'LECCION' | 'HASTA_AQUI' | 'LIBRE';
  /** Uno de los cinco tipos, o vacío para que el modelo elija en cada pregunta. */
  tipo?: string | null;
  /** De qué se pregunta. Sólo se usa con alcance LIBRE. */
  tema?: string | null;
  /**
   * Lo que quien arma el quiz quiere decirle al asistente y no cabe en un selector: «que sean
   * sobre el procedimiento, no sobre la norma», «en segunda persona», «que la correcta no sea
   * siempre la más larga». Se pasa tal cual, dentro de las reglas que no se negocian.
   */
  instrucciones?: string | null;
}

export interface ReferenciaPregunta {
  question_id: string;
  block_id: string;
  segundo?: number | null;
}

export type TipoQuiz = 'ACTIVIDAD' | 'EXAMEN_FINAL' | 'PRACTICA';

export interface QuizRequest {
  intentos_max?: number;
  feedback_inmediato?: boolean;
  modo_presentacion?: string;
  permite_volver?: boolean;
  mostrar_respuesta_correcta?: boolean;
  barajar_preguntas?: boolean;
  barajar_opciones?: boolean;
  preguntas_por_intento?: number | null;
  titulo?: string | null;
  tipo?: TipoQuiz;
  calificable?: boolean;
  /** Se manda siempre: null = reparto igual. */
  peso?: number | null;
  nota_minima?: number | null;
  bloquea_pegado?: boolean;
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
  /** Plantilla con la que se imprimen sus certificados. null = la predeterminada. */
  certificate_template_id?: string | null;
  /** Horas del curso, para el certificado. */
  intensidad_horas?: number | null;
  /** ASIGNADO = solo quien lo recibe por un grupo o matrícula; LIBRE = cualquiera se inscribe. */
  acceso?: 'ASIGNADO' | 'LIBRE';
  /** CORPORATIVO (inducción, SST, procesos) | EDUCATIVO (clases, cursos abiertos). */
  contexto?: 'CORPORATIVO' | 'EDUCATIVO';
}

export interface CursoRequest {
  codigo: string;
  nombre: string;
  descripcion?: string;
  obligatorio?: boolean;
  vigencia_meses?: number;
  entidad_capacitadora?: string;
  modalidad_default?: string;
  certificate_template_id?: string | null;
  intensidad_horas?: number | null;
  acceso?: 'ASIGNADO' | 'LIBRE';
  contexto?: 'CORPORATIVO' | 'EDUCATIVO';
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
  /** Porcentaje del módulo en la nota del curso. null = reparto igual. */
  peso?: number | null;
  /** Nota mínima propia. null = la del curso cuando se exige aprobar cada módulo. */
  nota_minima?: number | null;
  asistencia_minima?: number | null;
  lecciones: Leccion[];
}

export interface ModuloRequest {
  nombre: string;
  descripcion?: string;
  orden?: number;
  /** Se mandan siempre: null es un valor («reparto igual»), no «no lo cambies». */
  peso?: number | null;
  nota_minima?: number | null;
  asistencia_minima?: number | null;
}

export interface Leccion {
  id: string;
  nombre: string;
  tipo: 'VIDEO' | 'PDF' | 'TEXTO' | 'ENLACE';
  contenido?: string;
  duracion_min?: number;
  obligatoria: boolean;
  orden: number;
  /** Lista plana, sin orden de autor. Se conserva por compatibilidad: usa `bloques`. */
  recursos?: Recurso[];
  /** El recorrido de la lección, en el orden en que se armó. */
  bloques?: Bloque[];
  /** La misma clase a lo largo de las versiones del curso, y por cuál va. */
  linaje_id?: string;
  revision?: number;
  /** Comentarios vivos de la clase, de todas sus versiones. */
  comentarios?: number;
}

/** Una fila del historial de una clase: en qué versión del curso vivió y cómo estaba. */
export interface HistorialLeccion {
  lesson_id: string;
  linaje_id: string;
  revision: number;
  course_version_id: string;
  version: number;
  estado: 'BORRADOR' | 'PUBLICADA' | 'ARCHIVADA';
  publicada_at: string | null;
  nombre: string;
  tipo: string;
  duracion_min: number | null;
  obligatoria: boolean;
  bloques: number;
  updated_at: string | null;
  actual: boolean;
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
  /** Los manda el backend desde siempre; la tarjeta del bloque los muestra. */
  mime?: string | null;
  bytes?: number | null;
  orden: number;
}

export interface RecursoRequest {
  tipo: string;
  titulo?: string;
  document_id?: string;
  url?: string;
  orden?: number;
}
/** Tarea entregable de una lección. */
export interface Actividad {
  id: string;
  lesson_id: string;
  tipo: 'EVIDENCIA_FOTO' | 'FORMULARIO' | 'TEXTO' | 'CODIGO';
  titulo: string;
  instrucciones?: string | null;
  revision: 'MANUAL' | 'AUTOMATICA' | 'PRUEBAS';
  /** Sólo CODIGO (completo para quien administra formación). */
  ejercicio?: EjercicioCodigo | null;
  puntaje_max?: number | null;
  obligatoria: boolean;
  orden: number;
  /** false = se entrega y se revisa, pero no suma a la nota. */
  calificable: boolean;
  /** Porcentaje dentro del módulo. null = reparto igual. */
  peso?: number | null;
}

// ── Bloques de lección ──────────────────────────────────────────────────────

/**
 * Qué es un bloque. El tipo decide dónde vive su contenido: TEXTO lo lleva encima;
 * VIDEO/DOCUMENTO/PRESENTACION/IMAGEN/ENLACE lo llevan en `recurso`; ACTIVIDAD y QUIZ traen
 * solo el id, porque se editan en su propia pantalla.
 */
export type TipoBloque =
  | 'TEXTO' | 'VIDEO' | 'DOCUMENTO' | 'PRESENTACION' | 'IMAGEN' | 'ENLACE'
  | 'ACTIVIDAD' | 'QUIZ' | 'AUDIO' | 'YOUTUBE' | 'FICHA';

export interface Bloque {
  id: string;
  tipo: TipoBloque;
  titulo?: string | null;
  /** Línea de ayuda bajo el título: qué hay que hacer con este bloque. */
  descripcion?: string | null;
  orden: number;
  contenido?: string | null;
  recurso?: Recurso | null;
  activity_id?: string | null;
  quiz_id?: string | null;
}

export interface BloqueActividadRequest {
  tipo?: string;
  titulo?: string;
  instrucciones?: string;
  revision?: string;
  puntaje_max?: number;
  obligatoria?: boolean;
  calificable?: boolean;
  peso?: number | null;
  /** Sólo CODIGO: el ejercicio con sus casos de prueba. */
  ejercicio?: EjercicioCodigo | null;
}

export interface BloqueRequest {
  tipo: string;
  titulo?: string;
  descripcion?: string;
  contenido?: string;
  document_id?: string;
  url?: string;
  mime?: string;
  bytes?: number;
  actividad?: BloqueActividadRequest;
}

// ── Etiquetado por IA ───────────────────────────────────────────────────────

/**
 * Estado del procesamiento de un material audiovisual.
 *
 * `estado` recorre PENDIENTE → PROCESANDO → LISTO, y puede acabar en FALLIDO (agotó los
 * reintentos, con `ultimo_error` explicando por qué) u OMITIDO (no era audiovisual, o no
 * había pista de audio). La transcripción NO viaja: solo `tiene_transcripcion`.
 */
export interface MaterialIa {
  id: string;
  resource_id: string;
  lesson_id: string;
  estado: 'PENDIENTE' | 'PROCESANDO' | 'LISTO' | 'FALLIDO' | 'OMITIDO';
  idioma?: string | null;
  duracion_seg?: number | null;
  resumen?: string | null;
  intentos: number;
  ultimo_error?: string | null;
  procesado_at?: string | null;
  tiene_transcripcion: boolean;
}

export interface EtiquetaIa {
  id: string;
  lesson_id: string;
  resource_id?: string | null;
  etiqueta: string;
  tipo: 'TEMA' | 'COMPETENCIA' | 'PALABRA_CLAVE' | 'MODULO_SUGERIDO';
  origen: 'IA' | 'MANUAL';
  confianza?: number | null;
  estado: 'SUGERIDA' | 'CONFIRMADA' | 'DESCARTADA';
  revisado_at?: string | null;
}

export interface LeccionIa {
  lesson_id: string;
  materiales: MaterialIa[];
  etiquetas: EtiquetaIa[];
}

export interface VersionIa {
  course_version_id: string;
  etiquetado_habilitado: boolean;
  lecciones: LeccionIa[];
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

/** Dónde parece que se explica una pregunta. Se propone; la elige una persona. */
export interface SugerenciaReferencia {
  block_id: string;
  segundo: number | null;
  lesson_id: string;
  lesson_nombre: string;
  bloque_titulo: string | null;
  extracto: string;
}

/**
 * Una pregunta propuesta por el modelo, con su respaldo en el material ya resuelto.
 *
 * `relacionada` es lo que hay que mirar: true = el material dice dónde se explica y el atajo
 * viene puesto; false = se escribió sobre el tema y no se encontró respaldo. Se puede agregar
 * igual, pero quien la falle no va a tener a dónde volver.
 */
export interface PreguntaSugerida {
  enunciado: string;
  tipo: 'OPCION_MULTIPLE' | 'VERDADERO_FALSO' | 'EMPAREJAR' | 'TEXTO_ABIERTO' | 'NUMERO';
  opciones: { texto: string; correcta: boolean; pareja_clave?: string | null }[];
  /** Cómo se corrige, sólo en las que se responden escribiendo. */
  criterio?: CriterioPregunta | null;
  explicacion: string | null;
  block_id: string | null;
  segundo: number | null;
  lesson_nombre: string | null;
  extracto: string | null;
  /** true = el material de la clase la respalda, y por eso hay atajo. */
  relacionada: boolean;
  /** IA_MATERIAL | IA_TEMA, según de dónde salió. Se guarda con la pregunta. */
  origen: string;
}

// ── Tablero de administración ───────────────────────────────────────────────

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
  personas_sin_matricula: number;
  cargos_sin_clasificar: number;
  cursos_obligatorios: number;
}

/** Un curso con su gente repartida por estado. */
export interface FilaCurso {
  course_id: string;
  curso: string;
  codigo: string;
  obligatorio: boolean;
  vigencia_meses: number | null;
  personas: number;
  al_dia: number;
  por_vencer: number;
  vencidos: number;
  en_curso: number;
  pendientes: number;
  reprobados: number;
  porcentaje: number;
}

export interface PersonaActiva {
  person_id: string;
  cedula: string;
  nombre: string;
  cargo: string | null;
  lecciones_completadas: number;
  cursos_aprobados: number;
  minutos_vistos: number;
}

/** Algo que le falta por hacer a quien administra, con a dónde ir a resolverlo. */
export interface PendienteAdmin {
  clave: string;
  titulo: string;
  detalle: string;
  cantidad: number;
  severidad: 'ALTA' | 'MEDIA' | 'BAJA';
  ruta: string;
}

export interface CatalogoCifras {
  cursos: number;
  cursos_activos: number;
  cursos_obligatorios: number;
  versiones_publicadas: number;
  versiones_borrador: number;
  lecciones: number;
  preguntas: number;
  bancos: number;
  material: number;
  material_listo: number;
}

export interface TableroAdmin {
  resumen: ResumenCumplimiento;
  cursos: FilaCurso[];
  mas_activos: PersonaActiva[];
  pendientes: PendienteAdmin[];
  catalogo: CatalogoCifras;
}

// ── Calificación ─────────────────────────────────────────────────────────────

export type { Boletin, ModuloBoletin, ItemBoletin, RequisitoBoletin, PaqueteCurso } from './training-s';
import type { Boletin, PaqueteCurso } from './training-s';

export interface Requisitos {
  course_version_id: string;
  /** La configurada; null = la de por defecto cuando hay algo calificable. */
  nota_minima: number | null;
  /** La que de verdad se aplica. */
  nota_minima_efectiva: number | null;
  asistencia_minima: number | null;
  exige_todos_modulos: boolean;
  exige_contenido_completo: boolean;
  exige_actividades_aprobadas: boolean;
  /** true = la versión tiene evaluación formal: aprobarla sigue siendo obligatorio. */
  tiene_examen_formal: boolean;
  editable: boolean;
}

export interface RequisitosRequest {
  nota_minima?: number | null;
  asistencia_minima?: number | null;
  exige_todos_modulos?: boolean;
  exige_contenido_completo?: boolean;
  exige_actividades_aprobadas?: boolean;
}

export interface EsquemaCalificacion {
  course_version_id: string;
  requisitos: Requisitos;
  hay_calificables: boolean;
  modulos: ModuloEsquema[];
  advertencias: string[];
}

export interface ModuloEsquema {
  module_id: string;
  nombre: string;
  orden: number;
  peso: number | null;
  peso_efectivo: number | null;
  nota_minima: number | null;
  tiene_calificables: boolean;
  items: ItemEsquema[];
}

export interface ItemEsquema {
  id: string;
  tipo_item: 'QUIZ' | 'ACTIVIDAD';
  tipo: string;
  titulo: string;
  lesson_id: string;
  lesson_nombre: string;
  calificable: boolean;
  peso: number | null;
  peso_efectivo: number | null;
  nota_minima: number | null;
  obligatoria: boolean;
}

export interface BoletinGrupo {
  group_id: string;
  nombre: string;
  curso_nombre: string;
  course_version_id: string;
  nota_minima: number | null;
  asistencia_minima: number | null;
  sesiones: number;
  modulos: ModuloEsquema[];
  filas: FilaBoletin[];
}

export interface FilaBoletin {
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

// ── Plantillas de certificado ────────────────────────────────────────────────

export type BasePlantilla = 'CLASICA' | 'MODERNA' | 'FORMAL';

export interface PlantillaRequest {
  nombre: string;
  descripcion?: string | null;
  base?: BasePlantilla;
  color_primario?: string | null;
  color_secundario?: string | null;
  titulo?: string | null;
  subtitulo?: string | null;
  texto_principal?: string | null;
  texto_pie?: string | null;
  logo_document_id?: string | null;
  firma1_nombre?: string | null;
  firma1_cargo?: string | null;
  firma1_document_id?: string | null;
  firma2_nombre?: string | null;
  firma2_cargo?: string | null;
  firma2_document_id?: string | null;
  mostrar_nota?: boolean;
  mostrar_qr?: boolean;
  mostrar_horas?: boolean;
  mostrar_vigencia?: boolean;
  orientacion?: 'HORIZONTAL' | 'VERTICAL';
}

export interface PlantillaCertificado extends Required<Omit<PlantillaRequest, 'base' | 'orientacion'>> {
  id: string;
  base: BasePlantilla;
  orientacion: 'HORIZONTAL' | 'VERTICAL';
  predeterminada: boolean;
  /** Cuántos cursos la tienen elegida. */
  cursos_que_la_usan: number;
  created_at: string;
}

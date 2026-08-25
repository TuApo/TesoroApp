import { Injectable, inject } from '@angular/core';
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

  misCertificados(): Promise<Certificado[]> {
    return firstValueFrom(
      this.http.get<Certificado[]>(`${this.base}/me/certificates`)
    );
  }

  /** El PDF llega como blob; no pasa por la caché offline y por eso exige conexión. */
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
  recursos: RecursoOffline[];
  actividades: Actividad[];
  quiz?: QuizPresentacion;
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
}

export interface QuizPresentacion {
  quiz_id: string;
  lesson_id: string;
  intentos_max: number;
  feedback_inmediato: boolean;
  preguntas: PreguntaPresentacion[];
}

export interface PreguntaPresentacion {
  id: string;
  enunciado: string;
  tipo: 'OPCION_MULTIPLE' | 'VERDADERO_FALSO' | 'EMPAREJAR';
  opciones: OpcionPresentacion[];
}

/** Nunca trae la respuesta correcta: el backend usa un DTO distinto para eso. */
export interface OpcionPresentacion {
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
}

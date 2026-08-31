import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  AnotacionProfesional,
  EstadoCalificacion,
  Examen,
  GuardarExamen,
  ResultadoExamen,
} from '../models/exam.models';

/**
 * Exámenes de Formularios Dinámicos (ms-forms, /api/dynamic-forms).
 *
 * La hoja de respuestas se guarda sobre la ÚLTIMA versión del formulario, publicada o no:
 * corregir una clave mal marcada no obliga a publicar una versión nueva. Lo que sí hace falta
 * después de corregirla es recalificar lo ya respondido — de ahí `calificar`.
 */
@Injectable({ providedIn: 'root' })
export class ExamService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  leer(formId: number, version?: number): Observable<Examen> {
    let params = new HttpParams();
    if (version != null) params = params.set('version', String(version));
    return this.http.get<Examen>(`${this.base}/forms/${formId}/exam`, { params });
  }

  guardar(formId: number, body: GuardarExamen): Observable<Examen> {
    return this.http.put<Examen>(`${this.base}/forms/${formId}/exam`, body);
  }

  /** Cuántas lecturas firmadas por el equipo alimentan ya a esta pregunta. */
  ejemplos(formId: number, campo: string): Observable<number> {
    return this.http.get<number>(`${this.base}/forms/${formId}/exam/examples`,
      { params: new HttpParams().set('campo', campo) });
  }

  /**
   * Si la respuesta se califica, y si ya se calificó. Barato y sin la hoja de respuestas:
   * es lo que el panel de revisión consulta para saber si debe pintarse siquiera.
   */
  estado(submissionId: number): Observable<EstadoCalificacion> {
    return this.http.get<EstadoCalificacion>(`${this.base}/submissions/${submissionId}/grade/status`);
  }

  /** Califica o recalifica. Es idempotente: vuelve a correr las dos pasadas y pisa el resultado. */
  calificar(submissionId: number): Observable<ResultadoExamen> {
    return this.http.post<ResultadoExamen>(`${this.base}/submissions/${submissionId}/grade`, {});
  }

  /** El detalle completo, con el borrador del modelo. Solo para quien revisa. */
  consultar(submissionId: number): Observable<ResultadoExamen> {
    return this.http.get<ResultadoExamen>(`${this.base}/submissions/${submissionId}/grade`);
  }

  /** Corrige a mano un campo: los puntos que decide la profesional, y por qué. */
  revisar(submissionId: number, campo: string, puntos: number, motivo: string): Observable<ResultadoExamen> {
    return this.http.put<ResultadoExamen>(
      `${this.base}/submissions/${submissionId}/grade/fields/${encodeURIComponent(campo)}`,
      { puntos, motivo });
  }

  /** Firma el resultado. El servidor rechaza si queda algo pendiente. */
  firmar(submissionId: number): Observable<ResultadoExamen> {
    return this.http.post<ResultadoExamen>(`${this.base}/submissions/${submissionId}/grade/sign`, {});
  }

  anotaciones(submissionId: number): Observable<AnotacionProfesional[]> {
    return this.http.get<AnotacionProfesional[]>(`${this.base}/submissions/${submissionId}/grade/notes`);
  }

  anotar(submissionId: number, campo: string, body: Partial<AnotacionProfesional>): Observable<AnotacionProfesional> {
    return this.http.put<AnotacionProfesional>(
      `${this.base}/submissions/${submissionId}/grade/fields/${encodeURIComponent(campo)}/notes`, body);
  }
}

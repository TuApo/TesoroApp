import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * El tutor de IA de capacitaciones.
 *
 * Además del cliente HTTP guarda el **contexto de lo que la persona está viendo**: el
 * reproductor lo publica al abrir un curso y el botón flotante lo lee. Sin eso, preguntar
 * "¿y esto cómo se hace?" mientras se ve una clase obligaría al backend a rebuscar en todos
 * los cursos de la persona, y la respuesta acabaría siendo sobre otro.
 *
 * El contexto vive aquí y no en un @Input porque el botón flotante cuelga del *shell* del
 * dashboard y el reproductor es un hijo del router: no hay forma de pasarles nada entre ellos.
 */
@Injectable({ providedIn: 'root' })
export class TutorIaService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/learning/me/tutor`;

  /** Curso y lección que la persona tiene delante. null = no está en un curso. */
  readonly contexto = signal<ContextoTutor | null>(null);

  disponibilidad(): Promise<DisponibilidadTutor> {
    return firstValueFrom(this.http.get<DisponibilidadTutor>(`${this.base}/disponibilidad`));
  }

  preguntar(pregunta: string, contexto?: ContextoTutor | null): Promise<RespuestaTutor> {
    return firstValueFrom(this.http.post<RespuestaTutor>(`${this.base}/preguntas`, {
      pregunta,
      course_version_id: contexto?.course_version_id ?? null,
      lesson_id: contexto?.lesson_id ?? null,
    }));
  }
}

export interface ContextoTutor {
  course_version_id?: string | null;
  lesson_id?: string | null;
}

export interface DisponibilidadTutor {
  disponible: boolean;
  cursos_accesibles: number;
  lecciones_con_material: number;
  motivo?: string | null;
}

/**
 * Una referencia es de dónde salió la respuesta y a dónde lleva el botón "ver".
 *
 * `enrollment_id` puede venir vacío: quien administra formación ve el material sin estar
 * matriculado, y ahí el enlace tiene que ir a la consola y no al reproductor.
 */
export interface ReferenciaTutor {
  course_id: string;
  course_version_id: string;
  course_nombre: string;
  enrollment_id?: string | null;
  lesson_id: string;
  lesson_nombre: string;
  resource_id: string;
  segundos?: number | null;
  extracto?: string | null;
}

export interface RespuestaTutor {
  respuesta: string;
  referencias: ReferenciaTutor[];
  con_material: boolean;
}

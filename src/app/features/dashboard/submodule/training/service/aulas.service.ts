import { Injectable, inject } from '@angular/core';
import type { EjercicioCodigo, ResultadoCodigo } from './codigo.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';

/** Aulas en vivo (learning-ms `/aulas`). Contrato en snake_case. */

export type RolAula = 'ANFITRION' | 'COPRESENTADOR' | 'PARTICIPANTE' | 'ESPECTADOR';
export type EstadoAula = 'PROGRAMADA' | 'EN_VIVO' | 'FINALIZADA' | 'CANCELADA';
export type TipoAula = 'CLASE' | 'TALLER' | 'WEBINAR' | 'TUTORIA' | 'REUNION';

export interface AulaResumen {
  id: string; titulo: string; tipo: TipoAula; contexto: string; acceso: string; estado: EstadoAula;
  inicio_programado: string | null; duracion_min: number; codigo: string; anfitrion_nombre: string | null;
  course_id: string | null; curso_nombre: string | null; mi_rol: RolAula | null; conectados: number;
}

export interface EquipoAula { id: string; nombre: string; sala: string; orden: number; consigna: string | null; miembros: string[]; }

export interface Aula {
  id: string; titulo: string; descripcion: string | null; tipo: TipoAula; contexto: string; acceso: string; estado: EstadoAula;
  inicio_programado: string | null; duracion_min: number; codigo: string; sala: string;
  anfitrion_user_id: string | null; anfitrion_nombre: string | null; course_id: string | null; curso_nombre: string | null;
  group_id: string | null; lesson_id: string | null; max_participantes: number; permite_espectadores: boolean;
  minutos_asistencia: number | null; iniciada_at: string | null; finalizada_at: string | null;
  estado_aula: Record<string, unknown>; mi_rol: RolAula | null; soy_anfitrion: boolean;
  livekit_disponible: boolean; ejecutor_servidor: boolean; equipos: EquipoAula[]; mi_equipo: string | null;
}

export interface AulaRequest {
  titulo: string; descripcion?: string | null; tipo: TipoAula; contexto: string; acceso: string;
  course_id?: string | null; group_id?: string | null; lesson_id?: string | null;
  inicio_programado?: string | null; duracion_min?: number; max_participantes?: number;
  permite_espectadores?: boolean; minutos_asistencia?: number | null; invitados?: string[];
}

export interface Entrada { url: string; token: string; sala: string; identidad: string; nombre: string; rol: RolAula; equipo_id: string | null; }
export interface ParticipanteAula { user_id: string; nombre: string; rol: RolAula; team_id: string | null; conectado: boolean; minutos_conectado: number; primera_entrada_at: string | null; }
export interface Espacio { id: string; team_id: string | null; tipo: 'CODIGO' | 'PIZARRA' | 'NOTAS' | 'EJERCICIO'; nombre: string; lenguaje: string | null; contenido: string | null; yjs_estado: string | null; version: number; actualizado_por: string | null; updated_at: string; ejercicio?: EjercicioCodigo | null; }
export interface Encuesta { id: string; pregunta: string; opciones: string[]; correcta: number | null; anonima: boolean; estado: 'ABIERTA' | 'CERRADA'; votos: number[]; total: number; mi_voto: number | null; created_at: string; }
export interface Entrega { id: string; team_id: string | null; equipo_nombre: string | null; user_id: string; autor_nombre: string | null; titulo: string; contenido: string | null; lenguaje: string | null; nota: number | null; feedback: string | null; revisado_at: string | null; created_at: string; workspace_id?: string | null; resultado?: ResultadoCodigo | null; calificando?: boolean; }
export interface ResultadoEjecucion { ok: boolean; salida: string; errores: string; codigo: number | null; fase: string; milisegundos: number; }
export interface OpcionesAula {
  cursos: { id: string; nombre: string; version_id: string; lecciones: { id: string; nombre: string; modulo: string }[] }[];
  grupos: { id: string; nombre: string; course_id: string; curso_nombre: string }[];
}
export interface BloqueClase { id: string; tipo: string; titulo: string | null; descripcion: string | null; orden: number; contenido: string | null; recurso: { url?: string | null; titulo?: string | null; tipo?: string } | null; }
export interface ClaseAula { leccion: string | null; bloques: BloqueClase[]; }
export interface CursoLibre { id: string; nombre: string; descripcion: string | null; contexto: string; intensidad_horas: number | null; modalidad: string; version: number; lecciones: number; mi_matricula_id: string | null; }

@Injectable({ providedIn: 'root' })
export class AulasService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/learning/aulas`;
  private learning = `${environment.apiUrl}/api/v1/learning`;

  agenda(): Promise<AulaResumen[]> { return firstValueFrom(this.http.get<AulaResumen[]>(this.base)); }
  puedoCrear(): Promise<{ puede_crear: boolean }> { return firstValueFrom(this.http.get<{ puede_crear: boolean }>(`${this.base}/puedo-crear`)); }
  crear(req: AulaRequest): Promise<Aula> { return firstValueFrom(this.http.post<Aula>(this.base, req)); }
  actualizar(id: string, req: AulaRequest): Promise<Aula> { return firstValueFrom(this.http.put<Aula>(`${this.base}/${id}`, req)); }
  cancelar(id: string): Promise<Aula> { return firstValueFrom(this.http.post<Aula>(`${this.base}/${id}/cancelar`, {})); }
  porCodigo(codigo: string): Promise<{ id: string }> { return firstValueFrom(this.http.get<{ id: string }>(`${this.base}/codigo/${encodeURIComponent(codigo)}`)); }
  obtener(id: string): Promise<Aula> { return firstValueFrom(this.http.get<Aula>(`${this.base}/${id}`)); }
  entrar(id: string): Promise<Entrada> { return firstValueFrom(this.http.post<Entrada>(`${this.base}/${id}/entrar`, {})); }
  iniciar(id: string): Promise<Aula> { return firstValueFrom(this.http.post<Aula>(`${this.base}/${id}/iniciar`, {})); }
  finalizar(id: string): Promise<Aula> { return firstValueFrom(this.http.post<Aula>(`${this.base}/${id}/finalizar`, {})); }
  estado(id: string, estado: Record<string, unknown>): Promise<Record<string, unknown>> {
    return firstValueFrom(this.http.put<Record<string, unknown>>(`${this.base}/${id}/estado`, { estado }));
  }

  participantes(id: string): Promise<ParticipanteAula[]> { return firstValueFrom(this.http.get<ParticipanteAula[]>(`${this.base}/${id}/participantes`)); }
  cambiarRol(id: string, userId: string, rol: RolAula): Promise<ParticipanteAula> {
    return firstValueFrom(this.http.put<ParticipanteAula>(`${this.base}/${id}/participantes/${userId}/rol`, { rol }));
  }
  silenciar(id: string, userId: string): Promise<void> { return firstValueFrom(this.http.post<void>(`${this.base}/${id}/participantes/${userId}/silenciar`, {})); }
  sacar(id: string, userId: string): Promise<void> { return firstValueFrom(this.http.post<void>(`${this.base}/${id}/participantes/${userId}/sacar`, {})); }

  equipos(id: string): Promise<EquipoAula[]> { return firstValueFrom(this.http.get<EquipoAula[]>(`${this.base}/${id}/equipos`)); }
  crearEquipos(id: string, cantidad: number, modo: 'AUTO' | 'VACIOS', consigna?: string | null): Promise<EquipoAula[]> {
    return firstValueFrom(this.http.post<EquipoAula[]>(`${this.base}/${id}/equipos`, { cantidad, modo, consigna: consigna ?? null }));
  }
  asignar(id: string, userId: string, teamId: string | null): Promise<EquipoAula[]> {
    return firstValueFrom(this.http.put<EquipoAula[]>(`${this.base}/${id}/equipos/asignar`, { user_id: userId, team_id: teamId }));
  }
  abrirEquipos(id: string): Promise<EquipoAula[]> { return firstValueFrom(this.http.post<EquipoAula[]>(`${this.base}/${id}/equipos/abrir`, {})); }
  cerrarEquipos(id: string): Promise<void> { return firstValueFrom(this.http.post<void>(`${this.base}/${id}/equipos/cerrar`, {})); }
  avisarEquipos(id: string, texto: string): Promise<void> { return firstValueFrom(this.http.post<void>(`${this.base}/${id}/equipos/avisar`, { texto })); }
  entrarEquipo(id: string, teamId: string): Promise<Entrada> { return firstValueFrom(this.http.post<Entrada>(`${this.base}/${id}/equipos/${teamId}/entrar`, {})); }

  espacios(id: string): Promise<Espacio[]> { return firstValueFrom(this.http.get<Espacio[]>(`${this.base}/${id}/espacios`)); }
  crearEspacio(id: string, req: { tipo: string; nombre?: string | null; lenguaje?: string | null; team_id?: string | null;
    ejercicio?: EjercicioCodigo | null; enunciado?: string | null; question_id?: string | null }): Promise<Espacio> {
    return firstValueFrom(this.http.post<Espacio>(`${this.base}/${id}/espacios`, req));
  }
  guardarEspacio(id: string, espacioId: string, req: { contenido?: string | null; yjs_estado?: string | null; lenguaje?: string | null; nombre?: string | null }): Promise<Espacio> {
    return firstValueFrom(this.http.put<Espacio>(`${this.base}/${id}/espacios/${espacioId}`, req));
  }
  borrarEspacio(id: string, espacioId: string): Promise<void> { return firstValueFrom(this.http.delete<void>(`${this.base}/${id}/espacios/${espacioId}`)); }

  encuestas(id: string): Promise<Encuesta[]> { return firstValueFrom(this.http.get<Encuesta[]>(`${this.base}/${id}/encuestas`)); }
  crearEncuesta(id: string, pregunta: string, opciones: string[], correcta?: number | null): Promise<Encuesta> {
    return firstValueFrom(this.http.post<Encuesta>(`${this.base}/${id}/encuestas`, { pregunta, opciones, correcta: correcta ?? null, anonima: true }));
  }
  votar(id: string, encuestaId: string, opcion: number): Promise<Encuesta> { return firstValueFrom(this.http.post<Encuesta>(`${this.base}/${id}/encuestas/${encuestaId}/votar`, { opcion })); }
  cerrarEncuesta(id: string, encuestaId: string): Promise<Encuesta> { return firstValueFrom(this.http.post<Encuesta>(`${this.base}/${id}/encuestas/${encuestaId}/cerrar`, {})); }

  entregas(id: string): Promise<Entrega[]> { return firstValueFrom(this.http.get<Entrega[]>(`${this.base}/${id}/entregas`)); }
  entregar(id: string, req: { titulo: string; contenido?: string | null; lenguaje?: string | null; team_id?: string | null; workspace_id?: string | null }): Promise<Entrega> {
    return firstValueFrom(this.http.post<Entrega>(`${this.base}/${id}/entregas`, req));
  }
  revisar(id: string, entregaId: string, nota: number | null, feedback: string | null): Promise<Entrega> {
    return firstValueFrom(this.http.put<Entrega>(`${this.base}/${id}/entregas/${entregaId}`, { nota, feedback }));
  }

  ejecutar(lenguaje: string, archivos: { nombre: string; contenido: string }[], entrada?: string): Promise<ResultadoEjecucion> {
    return firstValueFrom(this.http.post<ResultadoEjecucion>(`${this.base}/ejecutar`, { lenguaje, archivos, entrada: entrada ?? '' }));
  }

  opciones(): Promise<OpcionesAula> { return firstValueFrom(this.http.get<OpcionesAula>(`${this.base}/opciones`)); }
  clase(id: string): Promise<ClaseAula> { return firstValueFrom(this.http.get<ClaseAula>(`${this.base}/${id}/clase`)); }

  catalogoLibre(): Promise<CursoLibre[]> { return firstValueFrom(this.http.get<CursoLibre[]>(`${this.learning}/me/catalogo-libre`)); }
  inscribirme(courseId: string): Promise<{ id: string }> { return firstValueFrom(this.http.post<{ id: string }>(`${this.learning}/courses/${courseId}/self-enroll`, {})); }
}

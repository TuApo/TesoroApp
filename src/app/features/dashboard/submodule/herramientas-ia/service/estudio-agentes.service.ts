import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Estudio de agentes — espejo de `/ia/agentes/registro/**` (ms-ai).
 *
 * OJO CON LA DIFERENCIA. Este servicio NO es `AgentesService`. Aquel habla con el puente y
 * ve los 81 agentes de ruflo, que son de solo lectura. Este habla con el REGISTRO, que es
 * la base de datos donde viven los agentes nuestros: los que se pueden escribir, versionar
 * y recuperar si alguien reinstala ruflo y se lleva el workspace por delante.
 */

export type EstadoAgente = 'borrador' | 'activo' | 'archivado';

export interface Area {
  id: string;
  clave: string;
  nombre: string;
  descripcion: string | null;
  color: string | null;
  icono: string | null;
  orden: number;
  activa: boolean;
  /** Cuántos agentes tiene dentro; el borrado se bloquea si no está vacía. */
  agentes: number;
  creadoEn: string;
}

export interface AreaReq {
  clave?: string;
  nombre: string;
  descripcion?: string | null;
  color?: string | null;
  icono?: string | null;
  orden?: number;
  activa?: boolean;
}

export interface AgenteRegistrado {
  id: string;
  clave: string;
  nombre: string;
  areaId: string | null;
  areaNombre: string | null;
  descripcion: string | null;
  /** El prompt entero: lo que el agente ES. */
  persona: string;
  capacidades: string[];
  modelo: string | null;
  herramientas: string | null;
  prioridad: string;
  estado: EstadoAgente;
  version: number;
  /** true si el fichero que lee el pool va por detrás de lo guardado. */
  desincronizado: boolean;
  origen: string;
  creadoEn: string;
  actualizadoEn: string | null;
}

export interface AgenteReq {
  clave?: string;
  nombre: string;
  areaId?: string | null;
  descripcion?: string | null;
  persona: string;
  capacidades?: string[];
  modelo?: string | null;
  herramientas?: string | null;
  prioridad?: string;
  /** Se guarda en el historial: por qué se tocó. */
  motivo?: string;
}

export interface VersionAgente {
  id: string;
  version: number;
  nombre: string;
  descripcion: string | null;
  persona: string;
  capacidades: string[];
  motivo: string | null;
  creadoEn: string;
}

export interface Sincronizacion {
  escritos: number;
  fallidos: number;
  errores: string[];
}

export interface TurnoChat {
  rol: 'persona' | 'asistente';
  texto: string;
}

/** Lo que propone el asistente tras escuchar. */
export interface Borrador {
  clave: string;
  nombre: string;
  descripcion: string;
  persona: string;
  capacidades: string[];
  areaSugerida: string;
  /** Lo que la conversación no dijo. Si viene lleno, no se inventó nada. */
  preguntas: string[];
  comentario: string;
  agentesParecidos: string[];
}

@Injectable({ providedIn: 'root' })
export class EstudioAgentesService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/ia/agentes/registro`;

  // ── Áreas ─────────────────────────────────────────────────────────────────

  areas(): Observable<Area[]> {
    return this.http.get<Area[]>(`${this.base}/areas`);
  }

  crearArea(req: AreaReq): Observable<Area> {
    return this.http.post<Area>(`${this.base}/areas`, req);
  }

  editarArea(id: string, req: Partial<AreaReq>): Observable<Area> {
    return this.http.put<Area>(`${this.base}/areas/${id}`, req);
  }

  borrarArea(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/areas/${id}`);
  }

  // ── Agentes ───────────────────────────────────────────────────────────────

  agentes(): Observable<AgenteRegistrado[]> {
    return this.http.get<AgenteRegistrado[]>(`${this.base}/agentes`);
  }

  agente(id: string): Observable<AgenteRegistrado> {
    return this.http.get<AgenteRegistrado>(`${this.base}/agentes/${id}`);
  }

  crearAgente(req: AgenteReq, origen = 'manual'): Observable<AgenteRegistrado> {
    return this.http.post<AgenteRegistrado>(`${this.base}/agentes?origen=${origen}`, req);
  }

  editarAgente(id: string, req: Partial<AgenteReq>): Observable<AgenteRegistrado> {
    return this.http.put<AgenteRegistrado>(`${this.base}/agentes/${id}`, req);
  }

  borrarAgente(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/agentes/${id}`);
  }

  /** A partir de aquí el pool puede usarlo. */
  publicar(id: string): Observable<AgenteRegistrado> {
    return this.http.post<AgenteRegistrado>(`${this.base}/agentes/${id}/publicar`, {});
  }

  /** Lo retira del workspace y lo conserva en el registro. */
  archivar(id: string): Observable<AgenteRegistrado> {
    return this.http.post<AgenteRegistrado>(`${this.base}/agentes/${id}/archivar`, {});
  }

  // ── Historial ─────────────────────────────────────────────────────────────

  versiones(id: string): Observable<VersionAgente[]> {
    return this.http.get<VersionAgente[]>(`${this.base}/agentes/${id}/versiones`);
  }

  restaurar(id: string, version: number): Observable<AgenteRegistrado> {
    return this.http.post<AgenteRegistrado>(
      `${this.base}/agentes/${id}/versiones/${version}/restaurar`, {});
  }

  /** Reescribe en el workspace todos los activos. La red contra `ruflo init`. */
  sincronizar(): Observable<Sincronizacion> {
    return this.http.post<Sincronizacion>(`${this.base}/sincronizar`, {});
  }

  // ── Asistente ─────────────────────────────────────────────────────────────

  saludAsistente(): Observable<{ disponible: boolean }> {
    return this.http.get<{ disponible: boolean }>(`${this.base}/asistente/salud`);
  }

  proponer(conversacion: TurnoChat[]): Observable<Borrador> {
    return this.http.post<Borrador>(`${this.base}/asistente/borrador`, { conversacion });
  }
}

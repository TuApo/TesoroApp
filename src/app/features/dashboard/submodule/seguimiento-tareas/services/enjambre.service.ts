import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';

/** Tarea del enjambre de agentes, tal como la devuelve el puente (vía ms-ai /ia/agentes). */
export interface TareaEnjambre {
  id: string;
  estado: 'pendiente' | 'asignada' | 'en_curso' | 'ok' | 'error' | 'limite' | 'cancelada' | 'interrumpida';
  titulo: string | null;
  objetivo: string;
  agenteNombre?: string;
  cuentaNombre?: string;
  costeUsd: number;
  duracionMs: number;
  resumen?: string | null;
  error?: string | null;
  creada: number;
  actualizada: number;
}

export interface EstadoEnjambre {
  pool: { cuentas: number; listas: number; trabajando: number; enfriando: number; sinSesion: number; pausadas: number };
  trabajo: { enCurso: number; enCola: number };
}

const VIVOS = new Set(['pendiente', 'asignada', 'en_curso', 'interrumpida']);

/**
 * Enjambre de agentes de la plataforma (puente `tuapo-agentes`, por ms-ai). Solo ADMIN:
 * para el resto ms-ai responde 403 y la vista oculta la opción.
 *
 * Desde el chat de una tarea o un ticket, los agentes trabajan para RESOLVER: pueden tocar
 * los repos (dejan commits para revisar, nunca despliegan), siguen la conversación en la
 * misma sesión y, si el servicio se cae a mitad, el puente los retoma solos.
 */
@Injectable({ providedIn: 'root' })
export class EnjambreService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ia/agentes`;

  estado(): Promise<EstadoEnjambre> {
    return firstValueFrom(this.http.get<EstadoEnjambre>(`${this.base}/estado`));
  }

  /**
   * Encargo a un agente. Por defecto es para RESOLVER (puede trabajar en los repos y dejar
   * commits para revisar; nunca despliega) y persistente: si el servicio se cae a mitad, el
   * puente lo retoma solo hasta acabar.
   */
  encargar(datos: { titulo: string; objetivo: string; contexto: string; repo?: 'TesoroApp' | 'microservices' | 'todos'; minutos?: number;
    soloLectura?: boolean; persistente?: boolean; adjuntos?: { nombre: string; contenidoBase64: string }[] }): Promise<TareaEnjambre> {
    return firstValueFrom(this.http.post<TareaEnjambre>(`${this.base}/tareas`, {
      titulo: datos.titulo,
      objetivo: datos.objetivo,
      contexto: datos.contexto,
      repo: datos.repo ?? 'todos',
      soloLectura: datos.soloLectura ?? false,
      minutos: datos.minutos ?? 45,
      prioridad: 2,
      origen: 'seguimiento-tareas',
      persistente: datos.persistente ?? true,
      // Con skills presentes ms-ai no gasta una llamada al LLM para deducirlas.
      skills: [],
      adjuntos: datos.adjuntos ?? [],
    }));
  }

  /** Sigue la conversación con un agente que ya trabajó: misma sesión, conserva todo el contexto. */
  continuar(id: string, datos: { objetivo: string; adjuntos?: { nombre: string; contenidoBase64: string }[]; minutos?: number }): Promise<TareaEnjambre> {
    return firstValueFrom(this.http.post<TareaEnjambre>(`${this.base}/tareas/${id}/continuar`, datos));
  }

  /** Todas las tareas de un hilo (encargo, continuaciones y reanudaciones), de la primera a la última. */
  hilo(id: string): Promise<TareaEnjambre[]> {
    return firstValueFrom(this.http.get<TareaEnjambre[] | { tareas: TareaEnjambre[] }>(`${this.base}/tareas/${id}/hilo`))
      .then(r => Array.isArray(r) ? r : (r?.tareas ?? []));
  }

  tarea(id: string): Promise<TareaEnjambre> {
    return firstValueFrom(this.http.get<TareaEnjambre>(`${this.base}/tareas/${id}`));
  }

  cancelar(id: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base}/tareas/${id}/cancelar`, {}));
  }

  sigueViva(t: TareaEnjambre | null | undefined): boolean { return !!t && VIVOS.has(t.estado); }
}

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
 * Una tarea de Seguimiento Tareas se le entrega como encargo de SOLO LECTURA: el agente
 * analiza, investiga en los repos si hace falta y deja una propuesta; no cambia código ni
 * datos. Lo que proponga se publica en la tarea como comentario cuando una persona lo decide.
 */
@Injectable({ providedIn: 'root' })
export class EnjambreService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ia/agentes`;

  estado(): Promise<EstadoEnjambre> {
    return firstValueFrom(this.http.get<EstadoEnjambre>(`${this.base}/estado`));
  }

  encargar(datos: { titulo: string; objetivo: string; contexto: string; repo?: 'TesoroApp' | 'microservices' | 'todos'; minutos?: number;
    adjuntos?: { nombre: string; contenidoBase64: string }[] }): Promise<TareaEnjambre> {
    return firstValueFrom(this.http.post<TareaEnjambre>(`${this.base}/tareas`, {
      titulo: datos.titulo,
      objetivo: datos.objetivo,
      contexto: datos.contexto,
      repo: datos.repo ?? 'todos',
      soloLectura: true,
      minutos: datos.minutos ?? 20,
      prioridad: 2,
      origen: 'seguimiento-tareas',
      persistente: false,
      // Con skills presentes ms-ai no gasta una llamada al LLM para deducirlas.
      skills: [],
      adjuntos: datos.adjuntos ?? [],
    }));
  }

  tarea(id: string): Promise<TareaEnjambre> {
    return firstValueFrom(this.http.get<TareaEnjambre>(`${this.base}/tareas/${id}`));
  }

  cancelar(id: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base}/tareas/${id}/cancelar`, {}));
  }

  sigueViva(t: TareaEnjambre | null | undefined): boolean { return !!t && VIVOS.has(t.estado); }
}

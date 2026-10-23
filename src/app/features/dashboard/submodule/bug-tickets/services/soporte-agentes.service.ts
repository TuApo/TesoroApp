import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { BugTicket } from './tickets.service';

/**
 * Casos de soporte del pool de agentes (puente `soporte.js`).
 *
 * Va por las rutas de /ia/agentes/tareas que ms-ai ya reenvia tal cual al puente
 * (modo `soporte`, origen `soporte-casos`, `continuar`, `hilo`): asi el modulo no
 * depende de recompilar ms-ai. Solo ADMIN llega a /ia/agentes; para el resto la
 * llamada da 403 y el panel no se muestra.
 */
export type FaseSoporte =
  | 'triaje' | 'esperando_autorizacion' | 'resolviendo'
  | 'solucion_lista' | 'para_desarrollador' | 'descartado';

export type ResolucionSoporte = 'auto' | 'agentes' | 'desarrollador';

export interface CasoSoporte {
  id: string;
  ticketId: string;
  titulo: string;
  resolucion: ResolucionSoporte;
  fase: FaseSoporte;
  creado: number;
  actualizado: number;
  plan: string | null;
  resultado?: string | null;
  desarrollador?: string | null;
  triaje: {
    tipo: 'bug' | 'mejora' | 'consulta' | 'datos';
    resolublePorAgentes: boolean;
    complejidad: 'baja' | 'media' | 'alta';
    minutosEstimados: number;
    riesgo: 'bajo' | 'medio' | 'alto';
    requiere: string[];
    repo: string;
    archivos: string[];
    causa: string;
    motivo: string;
  } | null;
  proyeccion?: { usd: number; minutos: number } | null;
  decision: { fase: FaseSoporte; motivo: string } | null;
  commits: { repo: string; hash: string; asunto: string; resumen: string }[];
  eventos: { ts: number; fase: FaseSoporte; nota: string | null; por: string }[];
  tareas: { id: string; paso: string; estado: string; agente: string; costeUsd: number }[];
  costeRealUsd: number;
  limites: { maxUsd: number; maxMinutos: number };
}

export type AccionSoporte = 'autorizar' | 'tomar' | 'descartar' | 'repetir';

@Injectable({ providedIn: 'root' })
export class SoporteAgentesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ia/agentes`;

  /** Casos de un ticket, el mas reciente primero. */
  casosDeTicket(ticketId: string): Observable<CasoSoporte[]> {
    return this.http.get<CasoSoporte[]>(`${this.base}/tareas`, {
      params: { origen: 'soporte-casos', estado: ticketId },
    });
  }

  caso(id: string): Observable<CasoSoporte> {
    return this.http.get<CasoSoporte>(`${this.base}/tareas/${id}/hilo`);
  }

  abrir(ticket: BugTicket, resolucion: ResolucionSoporte): Observable<CasoSoporte> {
    const comentarios = (ticket.comentarios || [])
      .map((c) => `${c.autor}: ${c.mensaje}`).join('\n').slice(0, 3000);
    return this.http.post<CasoSoporte>(`${this.base}/tareas`, {
      modo: 'soporte',
      resolucion,
      // ms-ai exige un objetivo en las tareas; el puente usa el ticket, no esto.
      objetivo: `Ticket de soporte: ${ticket.titulo}`,
      // Con `skills` presente ms-ai no las calcula: el puente elige los agentes de cada paso.
      skills: [],
      ticket: {
        id: ticket.id,
        titulo: ticket.titulo,
        descripcion: ticket.descripcion,
        categoria: ticket.categoria,
        prioridad: ticket.prioridad,
        url: ticket.url_actual,
        rol: ticket.rol,
        consola: ticket.console_logs,
        analisisIa: [ticket.ai_analisis, ticket.ai_sugerencia].filter(Boolean).join('\n\n') || null,
        comentarios: comentarios || null,
      },
    });
  }

  accion(id: string, accion: AccionSoporte, por: string, nota?: string): Observable<CasoSoporte> {
    return this.http.post<CasoSoporte>(`${this.base}/tareas/${id}/continuar`, { accion, por, nota: nota || null });
  }
}

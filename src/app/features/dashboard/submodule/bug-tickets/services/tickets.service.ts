import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { getLocalStorageItem } from '@/app/core/utils/safe-storage';

export interface BugTicket {
  id: string;
  titulo: string;
  descripcion: string;
  categoria: string;
  prioridad: string;
  estado: string;
  screenshot_base64: string | null;
  console_logs: string;
  url_actual: string;
  navegador: string;
  resolucion: string;
  usuario: string;
  documento: string;
  rol: string;
  sede: string;
  version_app: string;
  fecha_reporte: string;
  fecha_actualizacion: string | null;
  /** Nombre del responsable, solo para mostrar: la asignación real es asignado_id (usuario). */
  asignado_a: string | null;
  asignado_id?: string | null;
  /** Usuario que lo reportó. */
  reportado_por_id?: string | null;
  ai_analisis: string | null;
  ai_sugerencia: string | null;
  comentarios: TicketComentario[];
  historial: TicketHistorial[];
}

export interface TicketComentario {
  id: string;
  autor: string;
  autor_id?: string | null;
  mensaje: string;
  archivo: string | null;
  archivo_nombre: string;
  archivo_tipo: string;
  archivo_url: string | null;
  fecha: string;
}

export interface TicketHistorial {
  id: string;
  tipo: string;
  descripcion: string;
  valor_anterior: string;
  valor_nuevo: string;
  usuario: string;
  usuario_id?: string | null;
  fecha: string;
}

export interface TicketEstadisticas {
  total: number;
  abiertos: number;
  en_progreso: number;
  resueltos: number;
  cerrados: number;
  por_categoria: Record<string, number>;
  por_prioridad: Record<string, number>;
  por_sede: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class TicketsService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  listarTickets(params?: Record<string, string>): Observable<any> {
    const queryParams = params
      ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : '';
    return this.http.get(`${this.apiUrl}/bug_tickets/tickets/${queryParams}`);
  }

  obtenerTicket(id: string): Observable<BugTicket> {
    return this.http.get<BugTicket>(`${this.apiUrl}/bug_tickets/tickets/${id}/`);
  }

  actualizarEstado(id: string, estado: string, comentario?: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/bug_tickets/tickets/${id}/`, {
      estado,
      comentario,
    });
  }

  /** Asigna a un usuario de la plataforma (id); el nombre queda como foto. usuarioId null = sin responsable. */
  asignarTicket(id: string, usuarioId: string | null, nombre: string | null): Observable<any> {
    return this.http.patch(`${this.apiUrl}/bug_tickets/tickets/${id}/`, {
      asignado_id: usuarioId ?? '',
      asignado_nombre: nombre,
      actualizado_por: this.getNombreUsuario(),
    });
  }

  agregarComentario(ticketId: string, mensaje: string, archivo?: File): Observable<any> {
    const formData = new FormData();
    formData.append('mensaje', mensaje);
    formData.append('autor', this.getNombreUsuario());
    if (archivo) {
      formData.append('archivo', archivo, archivo.name);
    }
    return this.http.post(`${this.apiUrl}/bug_tickets/tickets/${ticketId}/comentarios/`, formData);
  }

  private getNombreUsuario(): string {
    try {
      const user = JSON.parse(getLocalStorageItem('user') || '{}');
      const nombre = [user?.datos_basicos?.nombres, user?.datos_basicos?.apellidos]
        .filter(Boolean).join(' ');
      return nombre || user?.numero_de_documento || 'Anónimo';
    } catch {
      return 'Anónimo';
    }
  }

  obtenerEstadisticas(): Observable<TicketEstadisticas> {
    return this.http.get<TicketEstadisticas>(`${this.apiUrl}/bug_tickets/estadisticas/`);
  }
}

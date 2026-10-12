import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { BugTicket } from '../../bug-tickets/services/tickets.service';
import { DirectorioService } from './directorio.service';

/** Ticket tal como llega en el listado liviano (sin captura ni logs). */
export type TicketMesa = BugTicket & { tiene_captura?: boolean; mi_rol?: 'asignado' | 'reporte' | 'ambos' };

export const ESTADOS_TICKET: { clave: string; etiqueta: string; icono: string; tono: string }[] = [
  { clave: 'Abierto', etiqueta: 'Abiertos', icono: 'inbox', tono: 'todo' },
  { clave: 'En Progreso', etiqueta: 'En progreso', icono: 'timelapse', tono: 'prog' },
  { clave: 'Resuelto', etiqueta: 'Resueltos', icono: 'task_alt', tono: 'done' },
  { clave: 'Cerrado', etiqueta: 'Cerrados', icono: 'archive', tono: 'cerrado' },
];

export const PRIORIDADES_TICKET: { clave: string; etiqueta: string; tono: string; peso: number }[] = [
  { clave: 'Critica', etiqueta: 'Crítica', tono: 'urgente', peso: 4 },
  { clave: 'Alta', etiqueta: 'Alta', tono: 'alta', peso: 3 },
  { clave: 'Media', etiqueta: 'Media', tono: 'media', peso: 2 },
  { clave: 'Baja', etiqueta: 'Baja', tono: 'baja', peso: 1 },
];

export function prioridadTicket(p: string | null | undefined) {
  const v = (p ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return PRIORIDADES_TICKET.find(x => x.clave.toLowerCase() === v) ?? PRIORIDADES_TICKET[2];
}

/**
 * Mesa de soporte dentro de Seguimiento Tareas: los tickets de "Reportar un problema"
 * (ms-tools /bug_tickets) trabajados como un tablero. Cada cambio queda firmado con el
 * nombre de quien lo hace (el historial del ticket decía "Sistema").
 */
@Injectable({ providedIn: 'root' })
export class MesaSoporteService {
  private readonly http = inject(HttpClient);
  private readonly dir = inject(DirectorioService);
  private readonly base = `${environment.apiUrl}/bug_tickets`;

  listar(): Promise<TicketMesa[]> {
    return firstValueFrom(this.http.get<TicketMesa[]>(`${this.base}/tickets`, { params: { ligero: 'true', ordering: '-fecha_reporte' } }));
  }

  detalle(id: string): Promise<BugTicket> {
    return firstValueFrom(this.http.get<BugTicket>(`${this.base}/tickets/${id}`));
  }

  /** Los tickets de la persona: los que reportó y los que tiene asignados (no exige acceso a la Mesa). */
  misTickets(): Promise<TicketMesa[]> {
    return firstValueFrom(this.http.get<TicketMesa[]>(`${this.base}/mis-tickets`));
  }

  /** `asignado_id` es el usuario (vacío = sin responsable); `asignado_nombre`, la foto para mostrar. */
  async actualizar(id: string, cambios: { estado?: string; asignado_id?: string; asignado_nombre?: string | null; prioridad?: string; comentario?: string }): Promise<BugTicket> {
    const r = await firstValueFrom(this.http.patch<{ ok: boolean; ticket: BugTicket }>(`${this.base}/tickets/${id}`,
      { ...cambios, actualizado_por: this.dir.yo.nombre }));
    return r.ticket;
  }

  comentar(id: string, mensaje: string, archivo?: File | null): Promise<unknown> {
    const fd = new FormData();
    fd.append('mensaje', mensaje);
    fd.append('autor', this.dir.yo.nombre);
    if (archivo) fd.append('archivo', archivo, archivo.name);
    return firstValueFrom(this.http.post(`${this.base}/tickets/${id}/comentarios`, fd));
  }
}

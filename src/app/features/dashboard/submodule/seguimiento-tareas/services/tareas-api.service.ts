import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import {
  Adjunto, Alcance, Comentario, Espacio, Etiqueta, EtiquetaTarea, Grupo, ItemChecklist, Lista,
  MiembroEspacio, MiembroGrupo, Parametro, RegistroAuditoria, RegistroImportacion, Resumen,
  RolEspacio, Seguidor, Tablero, Tarea, TareaDetalle, TipoLista,
} from '../models/tareas.models';

/**
 * Todas las llamadas de Seguimiento Tareas (ms-tools, /matder/**).
 *
 * Las mutaciones que generan avisos llevan `actor_name`: el backend no conoce nombres
 * (el JWT solo trae el id) y lo usa para redactar "Ana Pérez te asignó una tarea" en la
 * bandeja de Notificaciones. Es solo texto del aviso; la identidad sale del token.
 */
@Injectable({ providedIn: 'root' })
export class TareasApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/matder`;

  private get<T>(ruta: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    }
    return firstValueFrom(this.http.get<T>(`${this.base}${ruta}`, { params: p }));
  }
  private post<T>(ruta: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${this.base}${ruta}`, body));
  }
  private patch<T>(ruta: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.patch<T>(`${this.base}${ruta}`, body));
  }
  private put<T>(ruta: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.put<T>(`${this.base}${ruta}`, body));
  }
  private del(ruta: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${this.base}${ruta}`));
  }

  /** Nombre de quien hace el cambio, para el texto de los avisos. */
  private actor(): string | null {
    return obtenerUsuarioActual().nombreCompleto || null;
  }

  // ── Mis tareas ──
  misTareas(scope: Alcance, opts: { workspace?: number | null; closedDays?: number } = {}): Promise<Tarea[]> {
    return this.get<Tarea[]>('/my-tasks', { scope, workspace: opts.workspace, closed_days: opts.closedDays ?? 30 });
  }

  calendario(desde: Date, hasta: Date, scope: 'mias' | 'todas'): Promise<Tarea[]> {
    return this.get<Tarea[]>('/cards/assigned/calendar/', {
      start: desde.toISOString(), end: hasta.toISOString(), scope: scope === 'mias' ? 'mias' : null,
    });
  }

  porOrigen(tipo: string, ref: string): Promise<Tarea[]> {
    return this.get<Tarea[]>('/tasks/by-origin', { tipo, ref });
  }

  // ── Espacios ──
  espacios(): Promise<Espacio[]> { return this.get<Espacio[]>('/workspaces/'); }
  espacio(id: number): Promise<Espacio> { return this.get<Espacio>(`/workspaces/${id}/`); }
  crearEspacio(data: { name: string; description?: string | null }): Promise<Espacio> {
    return this.post<Espacio>('/workspaces/', data);
  }
  eliminarEspacio(id: number): Promise<unknown> { return this.del(`/workspaces/${id}/`); }
  miembros(espacioId: number): Promise<MiembroEspacio[]> {
    return this.get<MiembroEspacio[]>(`/workspaces/${espacioId}/members/`);
  }
  agregarMiembro(espacioId: number, user: string, role: RolEspacio): Promise<MiembroEspacio> {
    return this.post<MiembroEspacio>(`/workspaces/${espacioId}/members/`, { user, role });
  }
  actualizarMiembro(espacioId: number, miembroId: number, data: { role?: RolEspacio; active?: boolean }): Promise<MiembroEspacio> {
    return this.patch<MiembroEspacio>(`/workspaces/${espacioId}/members/${miembroId}/`, data);
  }

  // ── Tableros ──
  tableros(espacioId?: number | null): Promise<Tablero[]> {
    return this.get<Tablero[]>('/boards/', { workspace: espacioId });
  }
  tablero(id: number): Promise<Tablero> { return this.get<Tablero>(`/boards/${id}/`); }
  crearTablero(data: { workspace: number; name: string; description?: string | null; accent?: string | null }): Promise<Tablero> {
    return this.post<Tablero>('/boards/', data);
  }
  actualizarTablero(id: number, data: { name?: string; description?: string | null; accent?: string | null }): Promise<Tablero> {
    return this.patch<Tablero>(`/boards/${id}/`, data);
  }
  eliminarTablero(id: number): Promise<unknown> { return this.del(`/boards/${id}/`); }
  listas(tableroId: number): Promise<Lista[]> { return this.get<Lista[]>(`/boards/${tableroId}/lists/`); }
  favorito(kind: 'WORKSPACE' | 'BOARD', id: number): Promise<{ is_favorite: boolean }> {
    return this.post<{ is_favorite: boolean }>('/favorites/toggle/', { kind, object_id: id });
  }

  // ── Listas ──
  crearLista(tableroId: number, data: { name: string; list_type?: TipoLista | null; position?: number }): Promise<Lista> {
    return this.post<Lista>(`/boards/${tableroId}/lists/`, data);
  }
  actualizarLista(id: number, data: { name?: string; list_type?: TipoLista | null; position?: number }): Promise<Lista> {
    return this.patch<Lista>(`/lists/${id}/`, data);
  }
  eliminarLista(id: number): Promise<unknown> { return this.del(`/lists/${id}/`); }

  // ── Tareas ──
  detalle(id: number): Promise<TareaDetalle> { return this.get<TareaDetalle>(`/cards/${id}/detail/`); }

  crearTarea(listaId: number, data: {
    title: string; description?: string | null; priority?: string; due_at?: string | null;
    assignee?: string | null; assignee_name?: string | null; assignee_group?: number | null;
    watchers?: string[]; origen_tipo?: string | null; origen_ref?: string | null; origen_url?: string | null;
    status?: string;
  }): Promise<Tarea> {
    return this.post<Tarea>(`/lists/${listaId}/cards/`, { ...data, actor_name: this.actor() });
  }

  actualizarTarea(id: number, data: Record<string, unknown>): Promise<Tarea> {
    return this.patch<Tarea>(`/cards/${id}/`, { ...data, actor_name: this.actor() });
  }

  moverTarea(id: number, listaId: number, posicion: number): Promise<Tarea> {
    return this.patch<Tarea>(`/cards/${id}/move/`, { new_list_id: listaId, new_position: posicion, actor_name: this.actor() });
  }

  eliminarTarea(id: number): Promise<unknown> { return this.del(`/cards/${id}/`); }

  // ── Conversación ──
  comentar(tareaId: number, body: string, mentions: string[]): Promise<Comentario> {
    return this.post<Comentario>(`/cards/${tareaId}/comments/`, { body, mentions, actor_name: this.actor() });
  }
  editarComentario(id: number, body: string): Promise<Comentario> {
    return this.patch<Comentario>(`/comments/${id}/`, { body });
  }
  eliminarComentario(id: number): Promise<unknown> { return this.del(`/comments/${id}/`); }

  // ── Checklist ──
  agregarItem(tareaId: number, content: string): Promise<ItemChecklist> {
    return this.post<ItemChecklist>(`/cards/${tareaId}/checklist-items/`, { content });
  }
  actualizarItem(id: number, data: { content?: string; completed?: boolean }): Promise<ItemChecklist> {
    return this.patch<ItemChecklist>(`/checklist-items/${id}/`, data);
  }
  eliminarItem(id: number): Promise<unknown> { return this.del(`/checklist-items/${id}/`); }

  // ── Etiquetas ──
  etiquetas(tableroId: number): Promise<Etiqueta[]> { return this.get<Etiqueta[]>(`/boards/${tableroId}/labels/`); }
  crearEtiqueta(tableroId: number, data: { name: string; color: string }): Promise<Etiqueta> {
    return this.post<Etiqueta>(`/boards/${tableroId}/labels/`, data);
  }
  eliminarEtiqueta(id: number): Promise<unknown> { return this.del(`/labels/${id}/`); }
  ponerEtiqueta(tareaId: number, etiquetaId: number): Promise<EtiquetaTarea> {
    return this.post<EtiquetaTarea>(`/cards/${tareaId}/labels/${etiquetaId}/`, {});
  }
  quitarEtiqueta(tareaId: number, etiquetaId: number): Promise<unknown> {
    return this.del(`/cards/${tareaId}/labels/${etiquetaId}/`);
  }

  // ── Adjuntos ──
  subirAdjunto(tareaId: number, archivo: File): Promise<Adjunto> {
    const fd = new FormData();
    fd.append('file', archivo);
    fd.append('card', String(tareaId));
    return firstValueFrom(this.http.post<Adjunto>(`${this.base}/uploads/`, fd));
  }
  /** Con HttpClient (blob) para que el interceptor ponga el token: un <a href> no lo lleva. */
  descargarAdjunto(uuid: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.base}/uploads/${uuid}/file/`, { responseType: 'blob' }));
  }
  eliminarAdjunto(uuid: string): Promise<unknown> { return this.del(`/uploads/${uuid}/`); }

  // ── Seguidores ──
  alternarSeguir(tareaId: number): Promise<{ is_watching: boolean; watcher_count: number }> {
    return this.post(`/cards/${tareaId}/watch`, {});
  }
  agregarSeguidor(tareaId: number, user: string): Promise<Seguidor[]> {
    return this.post<Seguidor[]>(`/cards/${tareaId}/watchers`, { user, actor_name: this.actor() });
  }
  quitarSeguidor(tareaId: number, user: string): Promise<unknown> {
    return this.del(`/cards/${tareaId}/watchers/${user}`);
  }

  // ── Grupos ──
  grupos(): Promise<Grupo[]> { return this.get<Grupo[]>('/groups/'); }
  crearGrupo(data: { name: string; description?: string | null }): Promise<Grupo> {
    return this.post<Grupo>('/groups/', data);
  }
  actualizarGrupo(id: number, data: { name?: string; description?: string | null }): Promise<Grupo> {
    return this.patch<Grupo>(`/groups/${id}/`, data);
  }
  eliminarGrupo(id: number): Promise<unknown> { return this.del(`/groups/${id}/`); }
  miembrosGrupo(id: number): Promise<MiembroGrupo[]> { return this.get<MiembroGrupo[]>(`/groups/${id}/members/`); }
  agregarAGrupo(id: number, user: string): Promise<MiembroGrupo> {
    return this.post<MiembroGrupo>(`/groups/${id}/members/`, { user });
  }
  quitarDeGrupo(id: number, miembroId: number): Promise<unknown> {
    return this.del(`/groups/${id}/members/${miembroId}/`);
  }

  // ── Indicadores, auditoría, importación ──
  resumen(): Promise<Resumen> { return this.get<Resumen>('/dashboard/overview/'); }
  auditoria(opts: { entity?: string; entityId?: string | number; size?: number } = {}): Promise<RegistroAuditoria[]> {
    return this.get<RegistroAuditoria[]>('/audit/', { entity: opts.entity, entity_id: opts.entityId, size: opts.size ?? 200 });
  }
  importaciones(): Promise<RegistroImportacion[]> { return this.get<RegistroImportacion[]>('/import/'); }
  importar(espacioId: number, archivo: File): Promise<{ boards_created: number; cards_created: number; errors: string[] }> {
    const fd = new FormData();
    fd.append('file', archivo);
    fd.append('workspace', String(espacioId));
    return firstValueFrom(this.http.post<any>(`${this.base}/import/upload/`, fd));
  }
  plantillaImportacion(): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.base}/import/template/`, { responseType: 'blob' }));
  }

  // ── Parámetros ──
  parametros(): Promise<Parametro[]> { return this.get<Parametro[]>('/config'); }
  fijarParametro(clave: string, valor: string): Promise<Parametro> {
    return this.put<Parametro>(`/config/${encodeURIComponent(clave)}`, { valor });
  }
  ejecutarRecordatorios(): Promise<{ por_vencer: number; vencidas: number }> {
    return this.post('/config/recordatorios/ejecutar', {});
  }
}

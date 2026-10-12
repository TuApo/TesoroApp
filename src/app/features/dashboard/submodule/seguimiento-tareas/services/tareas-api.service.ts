import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEvent, HttpEventType, HttpParams } from '@angular/common/http';
import { Observable, filter, firstValueFrom, map } from 'rxjs';
import { environment } from '@/environments/environment';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import {
  Adjunto, Alcance, Comentario, DefinicionTablero, Espacio, Etiqueta, EtiquetaTarea, Grupo, IaEstado, IaTrabajo,
  AmbitoChat, ChatMensaje, ItemChecklist, Lista, MiembroEspacio, MiembroGrupo, Parametro, Plantilla, RegistroAuditoria, RegistroImportacion, ResumenCaso,
  Resumen, RolEspacio, Seguidor, Tablero, Tarea, TareaDefinida, TareaDetalle, TipoLista,
} from '../models/tareas.models';

/** Avance de una subida: porcentaje mientras sube y el adjunto al terminar. */
export type AvanceSubida = { tipo: 'progreso'; pct: number } | { tipo: 'listo'; adjunto: Adjunto };

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
  /** Cuántas tareas (abiertas, vencidas, hechas) tiene cada caso de un tipo, p.ej. TICKET. */
  resumenPorOrigen(tipo: string): Promise<ResumenCaso[]> {
    return this.get<ResumenCaso[]>('/tasks/by-origin/resumen', { tipo });
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

  /** Subida con avance (para archivos grandes). `board` = archivo del tablero (sin tarea). */
  subirConAvance(destino: { card?: number; board?: number }, archivo: File): Observable<AvanceSubida> {
    const fd = new FormData();
    fd.append('file', archivo);
    if (destino.card) fd.append('card', String(destino.card));
    if (destino.board) fd.append('board', String(destino.board));
    return this.http.post<Adjunto>(`${this.base}/uploads/`, fd, { reportProgress: true, observe: 'events' }).pipe(
      map((ev: HttpEvent<Adjunto>): AvanceSubida | null => {
        if (ev.type === HttpEventType.UploadProgress) return { tipo: 'progreso', pct: ev.total ? Math.round(ev.loaded * 100 / ev.total) : 0 };
        if (ev.type === HttpEventType.Response && ev.body) return { tipo: 'listo', adjunto: ev.body };
        return null;
      }),
      // Los demás eventos (envío, cabeceras) no le interesan a la vista.
      filter((v): v is AvanceSubida => v !== null),
    );
  }
  archivosTablero(tableroId: number): Promise<Adjunto[]> { return this.get<Adjunto[]>(`/boards/${tableroId}/uploads`); }
  textoArchivo(uuid: string): Promise<{ nombre: string; tipo: string | null; texto: string | null; recortado: boolean }> {
    return this.get(`/uploads/${uuid}/texto`);
  }

  // ── IA ──
  iaEstado(): Promise<IaEstado> { return this.get<IaEstado>('/ia/estado'); }
  iaGenerar(tipo: 'tablero' | 'tareas' | 'plantilla' | 'sugerir', datos: {
    descripcion?: string; area?: string; modo?: string; instruccion?: string;
    board_id?: number; card_id?: number; adjuntos?: string[]; archivos?: File[];
  }): Promise<IaTrabajo> {
    const fd = new FormData();
    fd.append('tipo', tipo);
    for (const [k, v] of Object.entries(datos)) {
      if (v === undefined || v === null || k === 'archivos' || k === 'adjuntos') continue;
      fd.append(k, String(v));
    }
    if (datos.adjuntos?.length) fd.append('adjuntos', datos.adjuntos.join(','));
    for (const f of datos.archivos ?? []) fd.append('archivos', f, f.name);
    return firstValueFrom(this.http.post<IaTrabajo>(`${this.base}/ia/generar`, fd));
  }
  iaTrabajo<R = unknown>(id: number): Promise<IaTrabajo<R>> { return this.get<IaTrabajo<R>>(`/ia/trabajos/${id}`); }
  /**
   * Espera a que un trabajo de IA termine (consulta cada 2,5 s). Resuelve el resultado o
   * lanza un Error con el motivo legible. `cancelado()` permite abandonar la espera.
   */
  async esperarIa<R>(id: number, opts: { maxSeg?: number; cancelado?: () => boolean } = {}): Promise<R> {
    const limite = Date.now() + (opts.maxSeg ?? 240) * 1000;
    for (;;) {
      await new Promise(r => setTimeout(r, 2500));
      if (opts.cancelado?.()) throw new Error('cancelado');
      const t = await this.iaTrabajo<R>(id);
      if (t.estado === 'LISTO' && t.resultado) return t.resultado;
      if (t.estado === 'ERROR' || t.estado === 'CANCELADO') throw new Error(t.error || 'La IA no pudo completar el pedido.');
      if (Date.now() > limite) throw new Error('La IA está tardando demasiado. Intenta de nuevo en un momento.');
    }
  }
  iaDeTarea(tareaId: number): Promise<IaTrabajo[]> { return this.get<IaTrabajo[]>(`/cards/${tareaId}/ia`); }
  registrarAgente(tareaId: number, referencia: string, solicitud: string): Promise<IaTrabajo> {
    return this.post<IaTrabajo>(`/cards/${tareaId}/ia/agente`, { referencia, solicitud });
  }
  actualizarIa(id: number, data: { estado?: string; resultado?: string; coste_usd?: number }): Promise<IaTrabajo> {
    return this.patch<IaTrabajo>(`/ia/trabajos/${id}`, data);
  }

  // ── Chat de IA (tarea o ticket) ──
  chat(ambito: AmbitoChat, ref: string | number): Promise<ChatMensaje[]> { return this.get<ChatMensaje[]>(`/chat/${ambito}/${ref}`); }
  enviarChat(ambito: AmbitoChat, ref: string | number, texto: string, adjuntos: string[]): Promise<ChatMensaje[]> {
    return this.post<ChatMensaje[]>(`/chat/${ambito}/${ref}`, { texto, adjuntos, autor_nombre: this.actor() });
  }
  chatMensaje(id: number): Promise<ChatMensaje> { return this.get<ChatMensaje>(`/chat/mensajes/${id}`); }
  /** Turno de un agente del enjambre (lo crea el front en ms-ai; solo administración). */
  registrarAgenteChat(ambito: AmbitoChat, ref: string | number, texto: string, referencia: string, adjuntos: string[]): Promise<ChatMensaje[]> {
    return this.post<ChatMensaje[]>(`/chat/${ambito}/${ref}/agente`, { texto, referencia, adjuntos, autor_nombre: this.actor() });
  }
  cerrarAgenteChat(id: number, data: { estado?: 'LISTO' | 'ERROR' | 'PENDIENTE'; contenido?: string; coste_usd?: number; referencia?: string }): Promise<ChatMensaje> {
    return this.patch<ChatMensaje>(`/chat/mensajes/${id}`, data);
  }

  // ── Plantillas ──
  /** La definición nunca llega null a la vista (si el servidor no pudo leerla, va vacía). */
  async plantillas(): Promise<Plantilla[]> {
    const l = await this.get<Plantilla[]>('/plantillas');
    return l.map(p => ({ ...p, definicion: p.definicion ?? { listas: [], etiquetas: [], tareas: [] } }));
  }
  crearPlantilla(data: { nombre: string; area: string; descripcion?: string | null; icono?: string | null;
    color?: string | null; definicion: DefinicionTablero; origen?: 'USUARIO' | 'IA' }): Promise<Plantilla> {
    return this.post<Plantilla>('/plantillas', data);
  }
  plantillaDesdeTablero(data: { board_id: number; nombre?: string; area?: string; descripcion?: string | null; incluir_tareas?: boolean }): Promise<Plantilla> {
    return this.post<Plantilla>('/plantillas/desde-tablero', data);
  }
  eliminarPlantilla(id: number): Promise<unknown> { return this.del(`/plantillas/${id}`); }
  aplicarPlantilla(data: { plantilla_id?: number; definicion?: DefinicionTablero; workspace: number; nombre: string;
    descripcion?: string | null; accent?: string | null; inicio?: string | null; responsable?: string | null }): Promise<{ board_id: number; tareas: number }> {
    return this.post('/plantillas/aplicar', data);
  }
  tareasEnLote(tableroId: number, data: { tareas: TareaDefinida[]; inicio?: string | null; responsable?: string | null;
    origen_tipo?: string | null; origen_ref?: string | null; origen_url?: string | null }): Promise<{ creadas: number }> {
    return this.post(`/boards/${tableroId}/tareas-lote`, data);
  }

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

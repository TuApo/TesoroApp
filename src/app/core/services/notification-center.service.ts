import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, shareReplay, catchError } from 'rxjs';
import { environment } from '@/environments/environment';

/** Nivel de urgencia. Ordena y realza; CRITICA no se puede silenciar. */
export type Urgencia = 'INFO' | 'IMPORTANTE' | 'URGENTE' | 'CRITICA';

/** A dónde lleva el clic. Tipado en el backend, resuelto por NotificationTargetService. */
export type DestinoTipo =
  | 'NINGUNO' | 'RUTA' | 'MODULO' | 'FORM_DINAMICO' | 'FORM_PUBLICO' | 'URL';

/**
 * Tipo del catálogo (`notif_tipo`). Es lo que sustituye a los mapas
 * TYPE_LABELS/TYPE_ICONS/TYPE_COLORS que estaban hardcodeados aquí en el front:
 * ahora un tipo nuevo aparece solo, sin tocar ni recompilar la app.
 */
export interface NotificationType {
  id: string;
  clave: string;
  nombre: string;
  descripcion: string | null;
  icono: string;
  color: string;
  urgencia_default: Urgencia;
  modulo_id: string | null;
  agrupable: boolean;
  activo: boolean;
  orden: number;
}

/**
 * Una notificación de la bandeja unificada. Trae `icono` y `color` ya resueltos
 * del tipo, así que pintarla no requiere cruzar dos listas.
 */
export interface NotificationItem {
  id: string;
  tipo_clave: string | null;
  tipo_nombre: string | null;
  icono: string;
  color: string;
  titulo: string;
  mensaje: string | null;
  urgencia: Urgencia;
  destino_tipo: DestinoTipo;
  destino_valor: string | null;
  leida: boolean;
  creada_en: string;
}

export interface NotificationPreference {
  id: string;
  tipo_clave: string | null;
  canal: 'IN_APP' | 'EMAIL' | 'PUSH';
  habilitado: boolean;
}

/**
 * Centro de notificaciones unificado.
 *
 * Antes esto vivía en `features/dashboard/services` y apostaba contra
 * `/matder/notifications` (ms-tools), así que la campana solo podía mostrar
 * notificaciones de Matder: cualquier aviso de nómina, jurídico o incapacidades
 * no tenía dónde aterrizar. Ahora apunta al hub de ms-auth-admin, que es la
 * única bandeja de la plataforma, y vive en `core` porque ya no pertenece a
 * ningún módulo.
 *
 * El usuario se resuelve del JWT en el backend: la bandeja nunca se pide por id.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenterService {
  private base = `${environment.apiUrl}/api/v1/admin/notificaciones`;

  /**
   * El catálogo cambia con muy poca frecuencia y lo necesitan la campana y la
   * página de Novedades, así que se cachea para toda la sesión en vez de
   * pedirlo en cada apertura del desplegable.
   */
  private catalogo$?: Observable<NotificationType[]>;

  constructor(private http: HttpClient) {}

  list(opts: { tipo?: string; soloNoLeidas?: boolean; page?: number; size?: number } = {}): Observable<NotificationItem[]> {
    const params: Record<string, string | number | boolean> = {};
    if (opts.tipo) params['tipo'] = opts.tipo;
    if (opts.soloNoLeidas) params['solo_no_leidas'] = true;
    if (opts.page != null) params['page'] = opts.page;
    if (opts.size != null) params['size'] = opts.size;
    return this.http.get<NotificationItem[]>(`${this.base}/mensajes/`, { params: params as any });
  }

  unreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.base}/no-leidas/`);
  }

  /** Catálogo de tipos, cacheado. Falla en silencio con lista vacía: sin catálogo
   *  la bandeja sigue siendo usable (cada mensaje ya trae su icono y color). */
  catalogo(): Observable<NotificationType[]> {
    if (!this.catalogo$) {
      this.catalogo$ = this.http.get<NotificationType[]>(`${this.base}/tipos/`).pipe(
        catchError(() => of([] as NotificationType[])),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.catalogo$;
  }

  /** Fuerza recarga del catálogo (tras editarlo en configuración). */
  invalidarCatalogo(): void {
    this.catalogo$ = undefined;
  }

  markRead(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/mensajes/${id}/leer/`, {});
  }

  markAllRead(): Observable<{ actualizadas: number }> {
    return this.http.patch<{ actualizadas: number }>(`${this.base}/mensajes/leer-todas/`, {});
  }

  /** Archiva una notificación: sale de la bandeja, permanece en el histórico. */
  archive(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/mensajes/${id}`);
  }

  archiveRead(): Observable<{ archivadas: number }> {
    return this.http.delete<{ archivadas: number }>(`${this.base}/mensajes/leidas`);
  }

  preferencias(): Observable<NotificationPreference[]> {
    return this.http.get<NotificationPreference[]>(`${this.base}/preferencias/`);
  }

  fijarPreferencia(p: { tipo_clave: string | null; canal: string; habilitado: boolean }): Observable<NotificationPreference> {
    return this.http.put<NotificationPreference>(`${this.base}/preferencias/`, p);
  }
}

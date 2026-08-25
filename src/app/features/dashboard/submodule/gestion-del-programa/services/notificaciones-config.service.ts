import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '@/environments/environment';
import { AudienceCatalogService } from '../../dynamic-forms/services/audience-catalog.service';
import {
  AudienciaModo,
  NotificationType,
  NotifRegla,
  OpcionAudiencia,
  ReglaRequest,
  SimulacionResultado,
  SimularRequest,
  TipoRequest,
} from '../models/notificacion-config.model';

/** Fila cruda de `/gestion_admin/modulos/`; el listado puede venir paginado. */
interface FilaModulo { id: string; nombre: string; ruta?: string | null; }

/**
 * Cliente HTTP de Administración → Notificaciones.
 *
 * Va contra el hub en ms-auth-admin a través del gateway (`/api/v1/admin/**`,
 * ya enrutado). El JWT lo pone el `auth.interceptor` global. El backend exige
 * rol de administrador en TODOS estos endpoints; la bandeja personal cuelga del
 * mismo prefijo pero sin `/config` y no lo exige.
 *
 * Los catálogos de audiencia se reutilizan de `AudienceCatalogService`
 * (Formularios Dinámicos) en vez de reimplementarse: son los mismos roles,
 * sedes y personas de ms-auth-admin, y duplicarlos garantizaría que los dos
 * juegos de listas terminaran divergiendo.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesConfigService {
  private http = inject(HttpClient);
  private sujetos = inject(AudienceCatalogService);

  private readonly base = `${environment.apiUrl}/api/v1/admin/notificaciones/config`;

  // ── Tipos del catálogo ───────────────────────────────────────────────────

  listarTipos(): Observable<NotificationType[]> {
    return this.http.get<NotificationType[]>(`${this.base}/tipos`);
  }

  crearTipo(data: TipoRequest): Observable<NotificationType> {
    return this.http.post<NotificationType>(`${this.base}/tipos`, data);
  }

  /** PATCH parcial. `clave` se ignora en el backend: es inmutable tras crear. */
  actualizarTipo(id: string, data: TipoRequest): Observable<NotificationType> {
    return this.http.patch<NotificationType>(`${this.base}/tipos/${id}`, data);
  }

  // ── Reglas ───────────────────────────────────────────────────────────────

  listarReglas(eventoClave?: string | null): Observable<NotifRegla[]> {
    let params = new HttpParams();
    if (eventoClave && eventoClave.trim()) params = params.set('evento_clave', eventoClave.trim());
    return this.http.get<NotifRegla[]>(`${this.base}/reglas`, { params });
  }

  /** Eventos que YA tienen alguna regla. Alimenta el autocompletado del formulario. */
  listarEventos(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/eventos`).pipe(catchError(() => of([])));
  }

  crearRegla(data: ReglaRequest): Observable<NotifRegla> {
    return this.http.post<NotifRegla>(`${this.base}/reglas`, data);
  }

  actualizarRegla(id: string, data: ReglaRequest): Observable<NotifRegla> {
    return this.http.patch<NotifRegla>(`${this.base}/reglas/${id}`, data);
  }

  /**
   * Sin `activo` el backend alterna. Se manda siempre explícito para que dos
   * clics seguidos desde pantallas distintas no se pisen.
   */
  alternarActivo(id: string, activo: boolean): Observable<NotifRegla> {
    const params = new HttpParams().set('activo', String(activo));
    return this.http.patch<NotifRegla>(`${this.base}/reglas/${id}/activo`, {}, { params });
  }

  /** Dry-run. No escribe nada: es el paso previo a activar cualquier regla. */
  simular(id: string, data: SimularRequest): Observable<SimulacionResultado> {
    return this.http.post<SimulacionResultado>(`${this.base}/reglas/${id}/simular`, data);
  }

  // ── Catálogos de audiencia ───────────────────────────────────────────────

  /**
   * Opciones del selector para el modo dado. Los modos que no piden ids
   * (PAYLOAD, TODOS) devuelven lista vacía sin pegarle a la red.
   *
   * Tolerante a fallo, igual que el catálogo de sujetos: si un catálogo no
   * responde, el selector sale vacío y el resto del formulario sigue usable.
   * Quedarse sin poder editar la plantilla porque el listado de sedes se cayó
   * sería peor que la falta.
   */
  opcionesDe(modo: AudienciaModo): Observable<OpcionAudiencia[]> {
    switch (modo) {
      case 'ROLES':
        return this.sujetos.roles().pipe(map((rs) => rs.map((r) => ({ id: r.id, nombre: r.nombre }))));
      case 'SEDE':
        return this.sujetos.sedes().pipe(map((ss) => ss.map((s) => ({ id: s.id, nombre: s.nombre }))));
      case 'USUARIOS':
        return this.sujetos.personas().pipe(
          map((ps) => ps.map((p) => ({ id: p.id, nombre: p.nombre, detalle: p.detalle }))),
        );
      case 'MODULO':
        return this.modulos();
      default:
        return of([]);
    }
  }

  /** Módulos del menú, aplanados para el selector. Sirve a audiencia y a destino. */
  modulos(): Observable<OpcionAudiencia[]> {
    return this.http
      .get<FilaModulo[] | { results?: FilaModulo[] }>(`${environment.apiUrl}/gestion_admin/modulos/`)
      .pipe(
        map((resp) => (Array.isArray(resp) ? resp : resp?.results ?? [])),
        map((ms) =>
          ms
            .map((m) => ({ id: m.id, nombre: m.nombre, detalle: m.ruta ?? undefined }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
        ),
        catchError(() => of([])),
      );
  }
}

import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom, Observable, throwError } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';
import { environment } from '@/environments/environment';

/** Asignación de rol (multi-rol V40). `vigente_hasta` null = indefinido. */
export interface RolAsignado {
  id: string;
  nombre: string;
  es_principal: boolean;
  vigente_desde?: string | null;
  vigente_hasta?: string | null;
  vigente: boolean;
}

export interface SedeAsignada {
  id: string;
  nombre: string;
  activa: boolean;
  es_principal: boolean;
}

/** Item de entrada del campo `roles` al crear/editar. */
export interface RolAsignacionPayload {
  rol_id: string;
  es_principal?: boolean;
  vigente_hasta?: string | null;
}

export interface SedeAsignacionPayload {
  sede_id: string;
  es_principal?: boolean;
}

export interface UsuarioDetail {
  id: string;
  numero_de_documento: string;
  tipo_documento: string;
  correo_electronico: string;
  estado_solicitudes: boolean;
  empresa?: { id: string; nombre: string } | null;
  // `sede`/`rol` singulares = asignación PRINCIPAL (compat); las listas traen todas.
  sede?: { id: string; nombre: string; activa: boolean } | null;
  rol?: { id: string; nombre: string } | null;
  roles?: RolAsignado[];
  sedes?: SedeAsignada[];
  datos_basicos?: { usuario: string; nombres: string; apellidos: string; celular?: string | null } | null;
  /** Otros correos con los que ESTA misma cédula puede iniciar sesión (usuario_credencial). */
  correos_adicionales?: Array<{ id: string; correo: string; etiqueta: string; activo: boolean }>;
  permisos_efectivos?: Array<{ id: string; nombre: string; modulo: string; accion: string }>;
  permisos_tree?: any[];
  /** El listado sólo trae el booleano; la foto se pide por usuario con `obtenerFoto`. */
  tiene_foto?: boolean;
  fecha_registro?: string | null;
}

export interface AuthResponse {
  token: string;
  user: UsuarioDetail;
}

export type CrearUsuarioPayload = {
  numero_de_documento: string;
  tipo_documento: 'CC' | 'CE' | 'TI' | 'PA' | string;
  correo_electronico: string;
  password: string;
  // opcionales
  nombres?: string;
  apellidos?: string;
  celular?: string | null;
  empresa?: string | null; // acepta alias empresa o empresa_id
  sede?: string | null;
  rol?: string | null;
  estado_solicitudes?: boolean;
  /** data-URL ya reescalada; opcional, se guarda junto con el alta. */
  foto?: string | null;
  // Asignaciones múltiples (V40). Si vienen, ganan sobre `rol`/`sede` singulares.
  roles?: RolAsignacionPayload[];
  sedes?: SedeAsignacionPayload[];
};

export type ActualizarUsuarioPayload = Partial<CrearUsuarioPayload>;

export interface EliminarUsuarioResponse {
  ok: boolean;
  deleted: boolean;
  id: string;
  correo: string;
}

export interface EstadoUsuarioResponse {
  ok: boolean;
  estado_solicitudes: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AdminService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }


  // Traer sucursales (cacheadas: las sedes solo cambian desde el admin de
  // Django y varias pantallas las piden al abrirse; mismo patrón que
  // UtilityServiceService.traerSucursales).
  traerSucursales(): any {
    const ahora = Date.now();
    if (!this.sedesCache || ahora - this.sedesCacheTs > AdminService.SEDES_TTL_MS) {
      this.sedesCache = this.http.get(`${this.apiUrl}/gestion_admin/sedes/`).pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.sedesCacheTs = ahora;
      this.sedesCache.subscribe({ error: () => { this.sedesCache = null; } });
    }
    return this.sedesCache;
  }

  private sedesCache: Observable<any> | null = null;
  private sedesCacheTs = 0;
  private static readonly SEDES_TTL_MS = 5 * 60_000;

  // Subir cedulas

  cambiarContrasenaMe(oldPassword: string, newPassword: string) {
    const url = `${this.apiUrl}/gestion_admin/usuarios/cambiar_contrasena/`;
    const body = { old_password: oldPassword, new_password: newPassword };
    return this.http.post<{ ok: boolean; message: string }>(url, body);
  }

  /** Quita sólo keys con `undefined` (conserva null o '') */
  private compact<T extends Record<string, any>>(obj: T): T {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined)
    ) as T;
  }

  /**
   * Crear usuario desde el panel de administración.
   *
   * Pega al endpoint admin (requiere JWT), NO a /gestion_admin/auth/register/: ese es el
   * registro PÚBLICO y por seguridad ignora el rol que le manden, forzando SIN-ASIGNAR.
   * Con este el rol, la empresa, la sede y el estado se guardan en la misma llamada.
   */
  crear(body: CrearUsuarioPayload): Observable<UsuarioDetail> {
    return this.http.post<UsuarioDetail>(`${this.apiUrl}/gestion_admin/usuarios/`, this.compact(body));
  }

  /** Detalle de un usuario (incluye permisos efectivos y árbol de permisos). */
  detalle(id: string): Observable<UsuarioDetail> {
    return this.http.get<UsuarioDetail>(`${this.apiUrl}/gestion_admin/usuarios/${id}/`);
  }

  /**
   * Actualizar usuario (PATCH por defecto). Devuelve UsuarioDetail.
   * OJO: `compact` conserva los `null` a propósito — el backend interpreta
   * `empresa: null` / `sede: null` / `rol: null` como "quitar la asignación".
   */
  actualizar(id: string, body: ActualizarUsuarioPayload, partial = true): Observable<UsuarioDetail> {
    const url = `${this.apiUrl}/gestion_admin/usuarios/${id}/`;
    const payload = this.compact(body);
    return partial
      ? this.http.patch<UsuarioDetail>(url, payload)
      : this.http.put<UsuarioDetail>(url, payload);
  }

  /** Borrado DEFINITIVO: elimina la fila y sus dependientes (permisos, datos básicos, MFA). */
  eliminar(id: string): Observable<EliminarUsuarioResponse> {
    return this.http.delete<EliminarUsuarioResponse>(`${this.apiUrl}/gestion_admin/usuarios/${id}/`);
  }

  /**
   * Foto de perfil. Vive en su propio endpoint a propósito: el listado devuelve las 8.000
   * filas de golpe y meter ahí una data-URL por usuario daría una respuesta de cientos de MB.
   */
  obtenerFoto(id: string): Observable<{ foto: string | null }> {
    return this.http.get<{ foto: string | null }>(`${this.apiUrl}/gestion_admin/usuarios/${id}/foto/`);
  }

  /** `foto` en null quita la existente. */
  guardarFoto(id: string, foto: string | null): Observable<{ ok: boolean; tiene_foto: boolean }> {
    return this.http.put<{ ok: boolean; tiene_foto: boolean }>(
      `${this.apiUrl}/gestion_admin/usuarios/${id}/foto/`, { foto }
    );
  }

  /** Baja/alta reversible: conserva la fila y su historial, solo conmuta estado_solicitudes. */
  setActivo(id: string, activo: boolean): Observable<EstadoUsuarioResponse> {
    return this.http.post<EstadoUsuarioResponse>(
      `${this.apiUrl}/gestion_admin/usuarios/${id}/inactivar/`,
      { activo }
    );
  }

  // Extras útiles con tus acciones del ViewSet:

  actualizarDatosBasicos(
    id: string,
    payload: { nombres?: string; apellidos?: string; celular?: string | null }
  ): Observable<{ ok: boolean; created: boolean; datos_basicos: UsuarioDetail['datos_basicos'] }> {
    return this.http.post<{ ok: boolean; created: boolean; datos_basicos: any }>(
      `${this.apiUrl}/gestion_admin/usuarios/${id}/actualizar_datos_basicos/`,
      this.compact(payload)
    );
  }

  asignarPermisos(
    id: string,
    payload: { otorgados?: string[]; revocados?: string[] }
  ): Observable<{ ok: boolean; otorgados: number; revocados: number; no_encontrados: string[] }> {
    return this.http.post<{ ok: boolean; otorgados: number; revocados: number; no_encontrados: string[] }>(
      `${this.apiUrl}/gestion_admin/usuarios/${id}/asignar_permisos/`,
      { otorgados: payload.otorgados ?? [], revocados: payload.revocados ?? [] }
    );
  }

  cambiarRol(id: string, rolId: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/gestion_admin/usuarios/${id}/cambiar_rol/`,
      { rol_id: rolId }
    );
  }

}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * GRUPOS y ETIQUETAS de usuario (ms-auth-admin V41).
 *
 * Un grupo NO da permisos: es una etiqueta de AUDIENCIA que responde "a quién va
 * dirigido esto". Quién puede hacer qué lo sigue diciendo el ROL.
 *
 * `tipo` dice qué representa y `clase` de dónde sale:
 *  - FIJO viene del catálogo de centros de costo (fincas y empresas usuarias) y se
 *    re-sincroniza con un botón; la sincronización solo crea y reactiva, nunca borra.
 *  - TAG es una etiqueta libre que alguien crea para marcar a varias personas.
 *
 * "Oficina" no es un tipo: en esta plataforma la oficina es la SEDE, que el usuario ya
 * tiene asignada.
 */
export type GrupoTipo = 'FINCA' | 'EMPRESA_USUARIA' | 'LIBRE';
export type GrupoClase = 'FIJO' | 'TAG';

export interface Grupo {
  id: string;
  nombre: string;
  descripcion?: string | null;
  tipo: GrupoTipo;
  clase: GrupoClase;
  color?: string | null;
  origen_ref?: string | null;
  activo: boolean;
  /** Cuántos usuarios lo tienen puesto. */
  usuarios: number;
  fecha_creacion: string;
}

export interface MiembroGrupo {
  id: string;
  nombre_completo: string;
  numero_de_documento: string;
  correo_electronico: string;
}

export interface GrupoDetalle {
  grupo: Grupo;
  miembros: MiembroGrupo[];
}

export interface SincronizacionGrupos {
  creados: number;
  reactivados: number;
  ya_existian: number;
  avisos: string[];
}

/** Etiqueta legible del tipo, para chips y selectores. */
export const NOMBRE_TIPO_GRUPO: Record<GrupoTipo, string> = {
  FINCA: 'Finca',
  EMPRESA_USUARIA: 'Empresa usuaria',
  LIBRE: 'Etiqueta',
};

@Injectable({ providedIn: 'root' })
export class GruposService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/gestion_admin/grupos`;
  private usuarios = `${environment.apiUrl}/gestion_admin/usuarios`;

  list(opts: { tipo?: GrupoTipo; q?: string; activo?: boolean } = {}): Observable<Grupo[]> {
    let params = new HttpParams();
    if (opts.tipo) params = params.set('tipo', opts.tipo);
    if (opts.q?.trim()) params = params.set('q', opts.q.trim());
    if (opts.activo != null) params = params.set('activo', String(opts.activo));
    return this.http.get<Grupo[]>(`${this.base}/`, { params });
  }

  detail(id: string): Observable<GrupoDetalle> {
    return this.http.get<GrupoDetalle>(`${this.base}/${id}/`);
  }

  create(body: {
    nombre: string; descripcion?: string | null; tipo?: GrupoTipo; clase?: GrupoClase; color?: string | null;
  }): Observable<Grupo> {
    return this.http.post<Grupo>(`${this.base}/`, body);
  }

  update(id: string, body: {
    nombre?: string; descripcion?: string | null; color?: string | null; activo?: boolean;
  }): Observable<Grupo> {
    return this.http.patch<Grupo>(`${this.base}/${id}/`, body);
  }

  /** Con miembros dentro el backend DESACTIVA; `force` sobre un grupo vacío sí lo borra. */
  remove(id: string, force = false): Observable<Grupo> {
    return this.http.delete<Grupo>(`${this.base}/${id}/`, {
      params: new HttpParams().set('force', String(force)),
    });
  }

  /** Alta y baja de miembros en una sola llamada. */
  cambiarMiembros(id: string, cambios: { agregar?: string[]; quitar?: string[] }): Observable<GrupoDetalle> {
    return this.http.post<GrupoDetalle>(`${this.base}/${id}/usuarios/`, {
      agregar: cambios.agregar ?? [],
      quitar: cambios.quitar ?? [],
    });
  }

  /** Siembra fincas y empresas usuarias desde el catálogo de centros de costo. */
  sincronizarCatalogo(): Observable<SincronizacionGrupos> {
    return this.http.post<SincronizacionGrupos>(`${this.base}/sincronizar-catalogo/`, {});
  }

  // ---------- Desde el usuario ----------

  gruposDeUsuario(usuarioId: string): Observable<Grupo[]> {
    return this.http.get<Grupo[]>(`${this.usuarios}/${usuarioId}/grupos/`);
  }

  /** Reemplazo TOTAL de los grupos del usuario (mismo patrón que roles y sedes). */
  asignarAUsuario(usuarioId: string, grupos: string[]): Observable<Grupo[]> {
    return this.http.put<Grupo[]>(`${this.usuarios}/${usuarioId}/grupos/`, { grupos });
  }
}

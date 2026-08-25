import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import { SubjectKind } from '../models/process.models';

/**
 * CATÁLOGO DE SUJETOS a los que se le pueden dar permisos sobre un formulario.
 *
 * Los cuatro salen de ms-auth-admin, que es donde vive la identidad:
 *  · roles   — /gestion_admin/roles
 *  · grupos  — /gestion_admin/grupos  (finca, empresa usuaria y etiquetas libres, V41)
 *  · sedes   — /gestion_admin/sedes   (aquí la OFICINA es la sede)
 *  · personas— /gestion_admin/usuarios
 *
 * Todas las lecturas son TOLERANTES a fallo: si un catálogo no responde, su pestaña sale
 * vacía y el resto de la pantalla de permisos sigue sirviendo. Quedarse sin poder
 * configurar nada porque un catálogo secundario se cayó sería peor que la falta.
 */
export interface Sujeto {
  kind: SubjectKind;
  id: string;
  nombre: string;
  /** Segunda línea del selector: tipo de grupo, documento de la persona… */
  detalle?: string;
}

interface FilaRol { id: string; nombre: string; }
interface FilaSede { id: string; nombre: string; activa?: boolean; }
interface FilaGrupo { id: string; nombre: string; tipo: string; activo: boolean; usuarios?: number; }
interface FilaUsuario {
  id: string;
  numero_de_documento?: string;
  correo_electronico?: string;
  datos_basicos?: { nombres?: string; apellidos?: string } | null;
}

/** Etiqueta legible del tipo de grupo (el enum viaja en mayúsculas). */
const TIPO_GRUPO: Record<string, string> = {
  FINCA: 'Finca',
  EMPRESA_USUARIA: 'Empresa usuaria',
  LIBRE: 'Etiqueta',
};

@Injectable({ providedIn: 'root' })
export class AudienceCatalogService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/gestion_admin`;

  roles(): Observable<Sujeto[]> {
    return this.http.get<FilaRol[]>(`${this.base}/roles/`).pipe(
      map(rs => (rs ?? []).map(r => ({ kind: 'ROL' as const, id: r.id, nombre: r.nombre }))),
      catchError(() => of([])),
    );
  }

  /** Solo los grupos ACTIVOS: dar permisos a uno desactivado sería configurar un hueco. */
  grupos(): Observable<Sujeto[]> {
    return this.http.get<FilaGrupo[]>(`${this.base}/grupos/`, {
      params: new HttpParams().set('activo', 'true'),
    }).pipe(
      map(gs => (gs ?? []).filter(g => g.activo).map(g => ({
        kind: 'GRUPO' as const,
        id: g.id,
        nombre: g.nombre,
        detalle: TIPO_GRUPO[g.tipo] ?? g.tipo,
      }))),
      catchError(() => of([])),
    );
  }

  sedes(): Observable<Sujeto[]> {
    return this.http.get<FilaSede[]>(`${this.base}/sedes/`).pipe(
      map(ss => (ss ?? [])
        .filter(s => s.activa !== false)
        .map(s => ({ kind: 'SEDE' as const, id: s.id, nombre: s.nombre }))),
      catchError(() => of([])),
    );
  }

  /**
   * Personas. El listado del panel de administración no está paginado, así que se pide
   * entero una vez y el filtrado por texto se hace en pantalla (es lo que ya hacen las
   * otras pantallas de usuarios).
   */
  personas(): Observable<Sujeto[]> {
    return this.http.get<FilaUsuario[] | { results?: FilaUsuario[] }>(`${this.base}/usuarios/`).pipe(
      map(resp => (Array.isArray(resp) ? resp : resp?.results ?? []).map(u => ({
        kind: 'USUARIO' as const,
        id: u.id,
        nombre: [u.datos_basicos?.nombres, u.datos_basicos?.apellidos]
          .filter(Boolean).join(' ').trim() || (u.correo_electronico ?? u.id),
        detalle: [u.numero_de_documento, u.correo_electronico].filter(Boolean).join(' · '),
      }))),
      catchError(() => of([])),
    );
  }
}

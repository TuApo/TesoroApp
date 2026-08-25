import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/** Rol de la plataforma (ms-auth-admin) tal como lo sirve /gestion_admin/roles. */
export interface RolResumen {
  id: string;
  nombre: string;
}

/**
 * Roles disponibles para asignar permisos de llenado a un formulario dinámico
 * (fill_role_ids del BuilderRequest). Solo lectura: el CRUD de roles vive en
 * el submódulo de usuarios.
 */
@Injectable({ providedIn: 'root' })
export class RolesService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/gestion_admin/roles`;

  list(): Observable<RolResumen[]> {
    // Trailing slash: convención de todos los endpoints gestion_admin del proyecto.
    return this.http.get<RolResumen[]>(`${this.base}/`);
  }
}

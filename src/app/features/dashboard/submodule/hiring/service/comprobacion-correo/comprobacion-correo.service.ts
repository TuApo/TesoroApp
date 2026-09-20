import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/** Estado de un correo de comprobación (ms-auth-admin, snake_case). */
export interface EstadoComprobacionCorreo {
  id: string;
  correo: string;
  confirmado: boolean;
  /** CODIGO = lo tecleó quien contrata; ENLACE = la persona pulsó el botón del correo. */
  confirmado_por: 'CODIGO' | 'ENLACE' | null;
  confirmado_en: string | null;
  expira_en: string;
  /** false = venció o se envió otro más reciente. */
  vigente: boolean;
  intentos_restantes: number;
}

/**
 * Comprobación del correo del candidato: un correo con un código de 6 dígitos y un botón.
 * Cualquiera de los dos deja `correo_confirmado` marcado en la ficha (lo hace el backend).
 */
@Injectable({ providedIn: 'root' })
export class ComprobacionCorreoService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/admin/comprobacion-correo`;

  enviar(numeroDocumento: string, correo: string): Observable<EstadoComprobacionCorreo> {
    return this.http.post<EstadoComprobacionCorreo>(`${this.base}/enviar`,
      { numero_documento: numeroDocumento, correo });
  }

  estado(id: string): Observable<EstadoComprobacionCorreo> {
    return this.http.get<EstadoComprobacionCorreo>(`${this.base}/${encodeURIComponent(id)}`);
  }

  verificar(id: string, codigo: string): Observable<EstadoComprobacionCorreo> {
    return this.http.post<EstadoComprobacionCorreo>(`${this.base}/${encodeURIComponent(id)}/verificar`, { codigo });
  }
}

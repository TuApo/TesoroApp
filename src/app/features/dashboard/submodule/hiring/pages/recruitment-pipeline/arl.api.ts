import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { AfiliacionArl, SaltoArl } from './arl.rules';

/** Estado del paso ARL de un proceso, según ms-hr. */
export interface EstadoArlApi {
  proceso_id: number;
  arl: AfiliacionArl | null;
  aplica: boolean;
  habilitado: boolean;
  /** Lo que falta del paso en sí (certificado y datos). */
  faltantes_carga: string[];
  /** Lo anterior más la comparación con la fecha de ingreso del contrato. */
  faltantes: string[];
  /** Fecha contra la que se compara: la del contrato o, si aún no hay, la de la vacante. */
  fecha_ingreso_referencia: string | null;
  fecha_ingreso_origen: 'CONTRATO' | 'VACANTE' | null;
  fechas_coinciden: boolean | null;
  salto: (SaltoArl & { id: number; rol: string | null; faltantes: string | null }) | null;
  bloqueo_desde: string;
  puede_saltar: boolean;
}

/**
 * Endpoints del paso ARL (ms-hr, `/gestion_contratacion/arl`, V74).
 */
@Injectable({ providedIn: 'root' })
export class ArlApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gestion_contratacion/arl`;

  estado(procesoId: number): Observable<EstadoArlApi> {
    return this.http.get<EstadoArlApi>(`${this.base}/proceso/${procesoId}/`);
  }

  /** Guardado parcial: solo se tocan las claves que lleguen. */
  guardar(procesoId: number, cambios: Partial<AfiliacionArl>): Observable<EstadoArlApi> {
    return this.http.put<EstadoArlApi>(`${this.base}/proceso/${procesoId}/`, cambios);
  }

  /** Solo ADMIN (el backend responde 403 a los demás). Motivo obligatorio. */
  saltarBloqueo(procesoId: number, motivo: string): Observable<{ ok: boolean; salto: EstadoArlApi['salto'] }> {
    return this.http.post<{ ok: boolean; salto: EstadoArlApi['salto'] }>(
      `${this.base}/salto-bloqueo/`, { proceso_id: procesoId, motivo });
  }
}

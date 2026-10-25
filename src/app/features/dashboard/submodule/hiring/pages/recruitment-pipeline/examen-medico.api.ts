import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/** Lo que falta para contratar un proceso, según el backend. */
export interface RequisitosExamen {
  proceso_id: number;
  aplica: boolean;
  habilitado: boolean;
  faltantes: string[];
  concepto: string | null;
  pdf_cargado: boolean;
  salto: { id: number; por: string | null; rol: string | null; motivo: string; faltantes: string | null; at: string | null } | null;
  bloqueo_desde: string;
  puede_saltar: boolean;
}

/**
 * Endpoints del examen médico requerido para contratar (ms-hr,
 * `/gestion_contratacion/examen-medico`, pedido #10).
 */
@Injectable({ providedIn: 'root' })
export class ExamenMedicoApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gestion_contratacion/examen-medico`;

  requisitos(procesoId: number): Observable<RequisitosExamen> {
    return this.http.get<RequisitosExamen>(`${this.base}/requisitos/`, {
      params: new HttpParams().set('proceso_id', String(procesoId)),
    });
  }

  /** Solo ADMIN (el backend responde 403 a los demás). Motivo obligatorio. */
  saltarBloqueo(procesoId: number, motivo: string): Observable<{ ok: boolean; salto: RequisitosExamen['salto'] }> {
    return this.http.post<{ ok: boolean; salto: RequisitosExamen['salto'] }>(
      `${this.base}/salto-bloqueo/`, { proceso_id: procesoId, motivo });
  }
}

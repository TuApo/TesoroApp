import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';

export interface CambioPendiente {
  id: number;
  candidato_id: number;
  numero_documento?: string;
  nombre?: string;
  oficina?: string | null;
  estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
  creado_en: string;
  revisado_en?: string | null;
  revisado_por?: string | null;
  nota?: string | null;
}

export interface CambioDetalle extends CambioPendiente {
  /** Lo que propuso el formulario público, tal cual llegó. */
  payload: Record<string, any>;
  /** Lo que hay hoy en la ficha, para poder comparar. */
  actual?: Record<string, any>;
}

/**
 * Cambios que el formulario público propuso sobre fichas que YA pasaron por contratación.
 *
 * Esas fichas no se sobreescriben solas: alguien las verificó con el documento en la mano y
 * sobre ellas se firmó un contrato. Lo que llega del formulario espera aquí hasta que la
 * oficina lo aprueba.
 */
@Injectable({ providedIn: 'root' })
export class CambiosPendientesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gestion_contratacion/cambios-pendientes`;

  listar(estado = 'PENDIENTE', oficina?: string, page = 0, size = 25) {
    let params = new HttpParams().set('estado', estado)
      .set('page', String(page)).set('size', String(size));
    if (oficina) params = params.set('oficina', oficina);
    return firstValueFrom(this.http.get<{
      results: CambioPendiente[]; count: number; page: number; size: number;
    }>(this.base, { params }));
  }

  detalle(id: number) {
    return firstValueFrom(this.http.get<CambioDetalle>(`${this.base}/${id}`));
  }

  aprobar(id: number, nota?: string) {
    return firstValueFrom(this.http.post<{ ok: boolean; estado: string }>(
      `${this.base}/${id}/aprobar`, { nota: nota ?? null }));
  }

  rechazar(id: number, nota?: string) {
    return firstValueFrom(this.http.post<{ ok: boolean; estado: string }>(
      `${this.base}/${id}/rechazar`, { nota: nota ?? null }));
  }
}

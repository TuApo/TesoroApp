import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import { FiltrosPresentados, RespuestaPresentados, paramsPresentados } from './reporte-presentados.util';

/** ms-hr `GET /gestion_contratacion/reporte/presentados` (pedido #8). */
@Injectable({ providedIn: 'root' })
export class ReportePresentadosService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl.replace(/\/$/, '')}/gestion_contratacion/reporte/presentados/`;

  /** Una página de la tabla (base 0) con los KPIs del rango. */
  consultar(f: FiltrosPresentados, page: number, size: number): Observable<RespuestaPresentados> {
    return this.http.get<RespuestaPresentados>(this.url, { params: paramsPresentados(f, { page, size }) });
  }

  /** El Excel con TODAS las filas filtradas (sin paginar) y la hoja de resumen. */
  excel(f: FiltrosPresentados): Observable<HttpResponse<Blob>> {
    return this.http.get(this.url, {
      params: paramsPresentados(f, { formato: 'xlsx' }),
      responseType: 'blob',
      observe: 'response',
    });
  }
}

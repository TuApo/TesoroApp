import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  FilaContratado, FilaEspera, FilaInscrito, FilaRechazo, FiltrosEstado, ListaEstado, ResumenEstado, Vista, paramsEstado,
} from './estado-candidatos.util';

type Extra = Record<string, string | number | boolean | null | undefined>;

/** ms-hr `GET /gestion_contratacion/reporte/estado-candidatos/*` (Estado de candidatos). */
@Injectable({ providedIn: 'root' })
export class EstadoCandidatosService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl.replace(/\/$/, '')}/gestion_contratacion/reporte/estado-candidatos`;

  resumen(f: FiltrosEstado): Observable<ResumenEstado> {
    return this.http.get<ResumenEstado>(`${this.base}/resumen/`, { params: paramsEstado(f) });
  }

  enEspera(f: FiltrosEstado, extra: Extra): Observable<ListaEstado<FilaEspera>> {
    return this.http.get<ListaEstado<FilaEspera>>(`${this.base}/en-espera/`, { params: paramsEstado(f, extra) });
  }

  rechazados(f: FiltrosEstado, extra: Extra): Observable<ListaEstado<FilaRechazo>> {
    return this.http.get<ListaEstado<FilaRechazo>>(`${this.base}/rechazados/`, { params: paramsEstado(f, extra) });
  }

  contratados(f: FiltrosEstado, extra: Extra): Observable<ListaEstado<FilaContratado>> {
    return this.http.get<ListaEstado<FilaContratado>>(`${this.base}/contratados/`, { params: paramsEstado(f, extra) });
  }

  inscritos(f: FiltrosEstado, extra: Extra): Observable<ListaEstado<FilaInscrito>> {
    return this.http.get<ListaEstado<FilaInscrito>>(`${this.base}/inscritos/`, { params: paramsEstado(f, extra) });
  }

  /** El Excel de una lista con TODAS las filas filtradas (sin paginar). */
  excel(vista: Exclude<Vista, 'resumen'>, f: FiltrosEstado, extra: Extra): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.base}/${vista}/`, {
      params: paramsEstado(f, { ...extra, formato: 'xlsx', page: null, size: null }),
      responseType: 'blob',
      observe: 'response',
    });
  }
}

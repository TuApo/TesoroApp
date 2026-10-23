import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { Alcance, Ficha, Informe, InformeResumen, Linea, Personas } from './actividad.models';

type Params = Record<string, string | number | boolean | string[] | null | undefined>;

/** Actividad del personal e Informes IA (ms-seguimiento). */
@Injectable({ providedIn: 'root' })
export class ActividadApiService {
  private readonly http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1/seguimiento`;

  private params(params?: Params): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v)) v.forEach(x => (p = p.append(k, x)));
      else p = p.set(k, String(v));
    }
    return p;
  }
  private get<T>(ruta: string, params?: Params): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.base}${ruta}`, { params: this.params(params) }));
  }

  alcance() { return this.get<Alcance>('/actividad/alcance'); }
  personas(f: { q?: string | null; rol?: string | null; sede?: string | null; desde?: string; hasta?: string; soloConActividad?: boolean; orden?: string | null; pagina?: number; tamano?: number }) {
    return this.get<Personas>('/actividad/personas', f);
  }
  persona(id: string, desde: string, hasta: string) { return this.get<Ficha>(`/actividad/personas/${id}`, { desde, hasta }); }
  linea(id: string, f: { desde: string; hasta: string; fuentes?: string[]; modulo?: string | null; tipo?: string | null; q?: string | null; antes?: string | null; limite?: number }) {
    return this.get<Linea>(`/actividad/personas/${id}/linea`, f);
  }
  urlCsv(id: string, f: { desde: string; hasta: string; tipo?: string | null; modulo?: string | null; q?: string | null }): string {
    return `${this.base}/actividad/personas/${id}/linea.csv?${this.params(f).toString()}`;
  }

  informes(f: { sujeto?: string | null; tipo?: string | null; mios?: boolean; pagina?: number; tamano?: number }) {
    return this.get<{ items: InformeResumen[]; total: number }>('/informes', f);
  }
  informe(id: string) { return this.get<Informe>(`/informes/${id}`); }
  crearInforme(b: { tipo: string; sujeto_id?: string | null; rol?: string | null; sede?: string | null; personas?: string[]; desde?: string; hasta?: string; enfoque?: string | null }) {
    return firstValueFrom(this.http.post<Informe>(`${this.base}/informes`, b));
  }
  actualizarInforme(id: string) { return firstValueFrom(this.http.post<Informe>(`${this.base}/informes/${id}/actualizar`, {})); }
  preguntar(id: string, pregunta: string) { return firstValueFrom(this.http.post<Informe>(`${this.base}/informes/${id}/preguntas`, { pregunta })); }
  eliminarInforme(id: string) { return firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.base}/informes/${id}`)); }
}

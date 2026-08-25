import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { AnalyticsGranularity, FormAnalytics } from '../models/dynamic-forms.models';

/** Analítica de un formulario (totales, línea de tiempo, distribución por campo). */
@Injectable({ providedIn: 'root' })
export class FormAnalyticsService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  /**
   * `from`/`to` admiten día (yyyy-MM-dd) o día y hora (yyyy-MM-ddTHH:mm); el backend
   * cierra el rango al final de la unidad escrita. `granularity` decide si la línea de
   * tiempo viene por día o por día y hora.
   */
  analytics(formId: number,
            opts: { from?: string; to?: string; granularity?: AnalyticsGranularity } = {}): Observable<FormAnalytics> {
    let params = new HttpParams();
    if (opts.from) params = params.set('from', opts.from);
    if (opts.to) params = params.set('to', opts.to);
    if (opts.granularity) params = params.set('granularity', opts.granularity);
    return this.http.get<FormAnalytics>(`${this.base}/forms/${formId}/analytics`, { params });
  }
}

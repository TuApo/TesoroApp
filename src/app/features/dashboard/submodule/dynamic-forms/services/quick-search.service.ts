import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { QuickSearchResult } from '../models/quick-search.models';

/**
 * Buscador rápido del menú inteligente del header: formularios por nombre y registros
 * por su contenido, en una sola llamada a ms-forms. El JWT lo agrega el interceptor;
 * el backend ya filtra por lo que el usuario puede ver.
 */
@Injectable({ providedIn: 'root' })
export class QuickSearchService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  search(q: string, limit = 6): Observable<QuickSearchResult> {
    const params = new HttpParams().set('q', q).set('limit', String(limit));
    return this.http.get<QuickSearchResult>(`${this.base}/quick-search`, { params });
  }
}

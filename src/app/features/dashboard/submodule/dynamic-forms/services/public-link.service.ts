import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import { PublicLink, PublicLinkCreateRequest } from '../models/dynamic-forms.models';

/** Links públicos compartibles (expiración, cupo, revocación). */
@Injectable({ providedIn: 'root' })
export class PublicLinkService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;

  create(formId: number, req: PublicLinkCreateRequest): Observable<PublicLink> {
    return this.http.post<PublicLink>(`${this.base}/forms/${formId}/public-links`, req);
  }

  list(formId: number): Observable<PublicLink[]> {
    return this.http.get<PublicLink[]>(`${this.base}/forms/${formId}/public-links`);
  }

  revoke(linkId: number): Observable<PublicLink> {
    return this.http.delete<PublicLink>(`${this.base}/public-links/${linkId}`);
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '@/environments/environment';
import { FieldTypeInfo } from '../models/dynamic-forms.models';

/**
 * Catálogo de tipos de campo servido por el backend (GET /field-types) y cacheado en
 * memoria de la sesión: agregar un tipo NO exige redesplegar el front.
 */
@Injectable({ providedIn: 'root' })
export class FieldTypeService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/dynamic-forms`;
  private cache$?: Observable<FieldTypeInfo[]>;

  fieldTypes(): Observable<FieldTypeInfo[]> {
    if (!this.cache$) {
      this.cache$ = this.http
        .get<FieldTypeInfo[]>(`${this.base}/field-types`)
        .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    }
    return this.cache$;
  }

  /** Fuerza recarga (p. ej. tras sembrar un tipo nuevo). */
  refresh(): void {
    this.cache$ = undefined;
  }
}

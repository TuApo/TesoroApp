import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '@/environments/environment';
import { SalarioMinimoVigencia } from '../../components/generate-contracting-documents/salario.util';

/**
 * Salario mínimo y auxilio por año (Parametrización de vacantes › Salario mínimo).
 *
 * Lo usan los documentos de contratación: el salario impreso es el mínimo del año en
 * que se creó el contrato. Sin caché a propósito: se pide al abrir el generador, así
 * que un año recién corregido llega sin recargar la aplicación.
 */
@Injectable({ providedIn: 'root' })
export class SalarioMinimoService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/api/v1/admin/parametrizacion/vacantes/salario-minimo`;

  /** Todos los años configurados. Si no carga, lista vacía: los documentos usan el salario de la vacante. */
  vigencias(): Observable<SalarioMinimoVigencia[]> {
    return this.http.get<SalarioMinimoVigencia[]>(this.url).pipe(
      catchError((e) => {
        console.warn('[salario-minimo] no se pudo cargar la configuración por año', e);
        return of([] as SalarioMinimoVigencia[]);
      }),
    );
  }
}

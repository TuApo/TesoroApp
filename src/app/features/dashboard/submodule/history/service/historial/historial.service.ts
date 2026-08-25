import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '@/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class HistorialService {

  private apiUrl = environment.apiUrl;

  private readonly TRANSACCIONES_URL = `${this.apiUrl}/gestion_tesoreria/transacciones/`;
  private readonly PERSONAS_URL = `${this.apiUrl}/gestion_tesoreria/personas/`;

  constructor(private http: HttpClient, @Inject(PLATFORM_ID) private platformId: Object) { }

  private handleError(error: any): Observable<never> {
    throw error;
  }

  // Traer estado de PersonaTesoreria por documento.
  // El backend responde camelCase (fechaBloqueo, observacionBloqueo, bloqueado,
  // activo). El front lee snake_case (fecha_bloqueo, observacion_bloqueo), así
  // que sin normalizar la fecha y el motivo del bloqueo salían siempre vacíos
  // ("fecha desconocida" / "Sin motivo"). Agregamos alias snake_case.
  getPersonaTesoreriaStatus(numeroDocumento: string): Observable<any> {
    return this.http.get(`${this.PERSONAS_URL}${encodeURIComponent(numeroDocumento)}/status/`).pipe(
      map((s: any) => this.addSnakeAliases(s)),
      catchError(this.handleError)
    );
  }

  private addSnakeAliases(obj: any): any {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const out: any = { ...obj };
    for (const k of Object.keys(obj)) {
      const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (snake !== k && !(snake in out)) out[snake] = obj[k];
    }
    return out;
  }

  // Traer historial de transacciones por documento
  getHistorialTransaccionesPorDocumento(numeroDocumento: string): Observable<any> {
    return this.http.get(`${this.TRANSACCIONES_URL}?numero_documento=${encodeURIComponent(numeroDocumento)}`).pipe(
      catchError(this.handleError)
    );
  }

  // Traer historial de auditoría unificado
  getHistorialComercializadoraTesorero(): Observable<any> {
    return this.http.get(`${this.apiUrl}/gestion_tesoreria/auditoria/`).pipe(
      catchError(this.handleError)
    );
  }

}

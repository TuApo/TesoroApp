import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '@/environments/environment';
import { Carnet, EscaneoCarnet, VerificacionCarnet } from '../models/carnet.model';

/**
 * Carnet digital contra ms-hr.
 *
 * Todo cuelga de `/gestion_contratacion/carnet` porque es el prefijo que el gateway ya
 * rutea a ms-hr; el backend explica por qué no se estrenó uno propio.
 *
 * El token del JWT lo pone `auth.interceptor`, así que aquí no se arma ninguna cabecera.
 */
@Injectable({ providedIn: 'root' })
export class CarnetService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gestion_contratacion/carnet`;

  /** Carnet del usuario logueado. La cédula la saca el backend del JWT, no se envía. */
  miCarnet(): Observable<Carnet> {
    return this.http.get<Carnet>(`${this.base}/mi-carnet`);
  }

  /** Ficha de un tercero por cédula tecleada. Queda registrada como consulta MANUAL. */
  porCedula(cedula: string): Observable<Carnet> {
    return this.http.get<Carnet>(`${this.base}/persona/${encodeURIComponent(cedula.trim())}`);
  }

  /** Verifica el texto leído del QR. Un carnet falso responde 200 con `valido: false`. */
  verificar(token: string): Observable<VerificacionCarnet> {
    return this.http.post<VerificacionCarnet>(`${this.base}/verificar`, { token });
  }

  /** Últimas verificaciones de una persona. Falla en silencio: es contexto, no el dato principal. */
  historial(cedula: string): Observable<EscaneoCarnet[]> {
    return this.http
      .get<EscaneoCarnet[]>(`${this.base}/persona/${encodeURIComponent(cedula.trim())}/historial`)
      .pipe(catchError(() => of([] as EscaneoCarnet[])));
  }

  /**
   * Descarga la foto biométrica como data-URL.
   *
   * POR QUÉ NO UN `<img src>` DIRECTO: el endpoint está detrás del gateway y exige
   * `Authorization`; una etiqueta `<img>` no manda cabeceras y devolvería 401. Se baja como
   * blob (el interceptor sí pone el token) y se convierte a data-URL, que además sobrevive a
   * la exportación a imagen del carnet — un `blob:` no siempre.
   *
   * Devuelve null ante cualquier fallo: sin foto el carnet pinta las iniciales.
   */
  async fotoDataUrl(fotoUrl: string): Promise<string | null> {
    if (!fotoUrl) return null;
    const url = fotoUrl.startsWith('http') ? fotoUrl : `${environment.apiUrl}${fotoUrl}`;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        this.http.get(url, { responseType: 'blob' }).subscribe({ next: resolve, error: reject });
      });
      if (!blob || blob.size === 0) return null;
      return await new Promise<string | null>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Cliente del CANAL DEL AGENTE de ms-devicemgmt (dispositivo supervisado ↔ plataforma).
 * Se autentica con el token de máquina (header X-Agente-Token), NO con el JWT de usuario.
 * La ruta es pública en el gateway. Sólo reporta METADATOS (nunca contenido privado, ni
 * audio/cámara ambiental, ni pulsaciones): esas capacidades no existen en el backend.
 */
const BASE = `${environment.apiUrl}/api/v1/devicemgmt/agente`;

export interface EnrolarOut {
  dispositivo_id: string; token: string; supervisado: boolean;
  consentimiento_version: number; aviso_supervision: string;
  politica: unknown;
}
export interface ComandoOut { id: string; tipo: string; payload_json: string | null; }

@Injectable({ providedIn: 'root' })
export class AgenteService {
  private http = inject(HttpClient);
  private h(token: string) { return { 'X-Agente-Token': token }; }

  enrolar(pin: string, info: Record<string, unknown>): Observable<EnrolarOut> {
    return this.http.post<EnrolarOut>(`${BASE}/enrolar`, { pin, ...info });
  }
  consentimiento(token: string, versionAviso: number, aceptadoPor: string): Observable<unknown> {
    return this.http.post(`${BASE}/consentimiento`, { version_aviso: versionAviso, aceptado_por: aceptadoPor }, { headers: this.h(token) });
  }
  telemetria(token: string, t: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${BASE}/telemetria`, t, { headers: this.h(token) });
  }
  ubicacion(token: string, u: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${BASE}/ubicacion`, u, { headers: this.h(token) });
  }
  comandos(token: string): Observable<ComandoOut[]> {
    return this.http.get<ComandoOut[]>(`${BASE}/comandos`, { headers: this.h(token) });
  }
  resultado(token: string, id: string, estado: string, resultado?: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${BASE}/comandos/${id}/resultado`, { estado, resultado_json: resultado ? JSON.stringify(resultado) : null }, { headers: this.h(token) });
  }
  politica(token: string): Observable<unknown> {
    return this.http.get(`${BASE}/politica`, { headers: this.h(token) });
  }
}

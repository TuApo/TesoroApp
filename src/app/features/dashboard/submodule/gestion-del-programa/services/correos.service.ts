import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  CorreoCuenta,
  CorreoCuentaUpsert,
  CuotaResumen,
  EnvioRequest,
  EnvioResultado,
  EstadoVerificacionCorreo,
  ProveedorCorreo,
  VerificacionCorreo,
} from '../models/correo-cuenta.model';
import {
  DireccionRebotada,
  EnvioRebotado,
  EstadoRebotes,
  ResumenRebotes,
} from '../models/correo-rebote.model';

/**
 * Cliente HTTP del submódulo Correos electrónicos (cuentas remitentes).
 *
 * Va contra ms-auth-admin a través del gateway: el prefijo `/api/v1/admin/**`
 * ya está enrutado allí. El JWT lo agrega el `auth.interceptor` global, igual
 * que en el resto de servicios de la app.
 *
 * Los errores del backend llegan como `{ error: "mensaje" }` (400/404/409/422);
 * cada pantalla los muestra con snackbar, mismo patrón que Entidades Externas.
 */
@Injectable({ providedIn: 'root' })
export class CorreosService {
  private readonly base = `${environment.apiUrl}/api/v1/admin/correos`;

  constructor(private http: HttpClient) {}

  /**
   * @param activo true=activas, false=inactivas, null/undefined=todas.
   * Los filtros se resuelven en el backend; el buscador libre además se aplica
   * en cliente sobre lo ya cargado (como en Entidades Externas).
   */
  listar(
    opts: {
      q?: string | null;
      proveedor?: ProveedorCorreo | null;
      activo?: boolean | null;
      estadoVerificacion?: EstadoVerificacionCorreo | null;
      proposito?: string | null;
    } = {},
  ): Observable<CorreoCuenta[]> {
    const params: Record<string, string> = {};
    if (opts.q && opts.q.trim()) params['q'] = opts.q.trim();
    if (opts.proveedor) params['proveedor'] = opts.proveedor;
    if (opts.activo !== undefined && opts.activo !== null) params['activo'] = String(opts.activo);
    if (opts.estadoVerificacion) params['estado_verificacion'] = opts.estadoVerificacion;
    if (opts.proposito && opts.proposito.trim()) params['proposito'] = opts.proposito.trim();
    return this.http.get<CorreoCuenta[]>(this.base, { params });
  }

  obtener(id: string): Observable<CorreoCuenta> {
    return this.http.get<CorreoCuenta>(`${this.base}/${id}`);
  }

  crear(data: CorreoCuentaUpsert): Observable<CorreoCuenta> {
    return this.http.post<CorreoCuenta>(this.base, data);
  }

  /** Si `smtp_password` va vacío/omitido, el backend conserva la credencial actual. */
  actualizar(id: string, data: CorreoCuentaUpsert): Observable<CorreoCuenta> {
    return this.http.put<CorreoCuenta>(`${this.base}/${id}`, data);
  }

  desactivar(id: string): Observable<CorreoCuenta> {
    return this.http.patch<CorreoCuenta>(`${this.base}/${id}/desactivar`, {});
  }

  reactivar(id: string): Observable<CorreoCuenta> {
    return this.http.patch<CorreoCuenta>(`${this.base}/${id}/reactivar`, {});
  }

  /** Prueba conexión + autenticación SMTP. No envía correo de prueba. */
  verificar(id: string): Observable<VerificacionCorreo> {
    return this.http.post<VerificacionCorreo>(`${this.base}/${id}/verificar`, {});
  }

  /**
   * Envía un correo REAL por una cuenta remitente y consume cuota. Sin
   * `cuenta_id` el backend reparte eligiendo la de más cupo restante.
   */
  enviar(data: EnvioRequest): Observable<EnvioResultado> {
    return this.http.post<EnvioResultado>(`${this.base}/enviar`, data);
  }

  resumenCuota(): Observable<CuotaResumen> {
    return this.http.get<CuotaResumen>(`${this.base}/cuota/resumen`);
  }

  // ── Rebotes (fase 1: solo marcar) ────────────────────────────────────────

  estadoRebotes(): Observable<EstadoRebotes> {
    return this.http.get<EstadoRebotes>(`${this.base}/rebotes/estado`);
  }

  /** Lee el buzón de rebotes ahora, sin esperar a la tarea programada. */
  revisarRebotes(): Observable<{ resumen: ResumenRebotes; estado: EstadoRebotes }> {
    return this.http.post<{ resumen: ResumenRebotes; estado: EstadoRebotes }>(`${this.base}/rebotes/revisar`, {});
  }

  enviosRebotados(q?: string | null): Observable<EnvioRebotado[]> {
    const params: Record<string, string> = {};
    if (q && q.trim()) params['q'] = q.trim();
    return this.http.get<EnvioRebotado[]>(`${this.base}/rebotes/envios`, { params });
  }

  direccionesRebotadas(soloInvalidas = false): Observable<DireccionRebotada[]> {
    return this.http.get<DireccionRebotada[]>(`${this.base}/rebotes/direcciones`, {
      params: { solo_invalidas: String(soloInvalidas) },
    });
  }

  /** La persona corrigió su buzón: deja de figurar como inválida (el historial queda). */
  desmarcarDireccion(id: number): Observable<DireccionRebotada> {
    return this.http.patch<DireccionRebotada>(`${this.base}/rebotes/direcciones/${id}/desmarcar`, {});
  }
}

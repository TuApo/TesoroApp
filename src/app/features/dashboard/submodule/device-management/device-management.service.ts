import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';

/**
 * Cliente del panel de Gestión de Equipos (ms-devicemgmt, capa móvil/MDM/anti-robo).
 * El servidor sirve snake_case, así que las interfaces lo respetan. El canal del AGENTE
 * (enrolar/telemetría/comandos) NO se llama desde aquí: eso lo hace el agente del
 * dispositivo con su token de máquina. Aquí solo el canal de administración (JWT, que
 * añade el auth.interceptor).
 */

const BASE = `${environment.apiUrl}/api/v1/devicemgmt`;

export interface Cuenta {
  id: string; nombre: string; plan: string; max_dispositivos: number;
  dispositivos_usados: number; prueba_fin_en: string | null; licencia_fin_en: string | null; estado: string;
}
export interface Tablero {
  total: number; activos: number; bloqueados: number; robados: number;
  incumplen: number; sin_latido_24h: number; alertas_sin_ver: number;
  max_dispositivos: number; plan: string;
}
export interface Ubicacion {
  capturado_en: string; lat: number; lon: number; precision_m: number | null; origen: string | null; bateria_pct: number | null;
}
export interface Dispositivo {
  id: string; etiqueta: string; plataforma: string; fabricante: string | null; modelo: string | null;
  os_version: string | null; serie: string | null; estado: string; supervisado: boolean; cumple: boolean;
  usuario_asignado: string | null; ultimo_latido_en: string | null; asset_endpoint_id: string | null;
  ultima_ubicacion: Ubicacion | null;
}
export interface DispositivoCreado {
  id: string; etiqueta: string; pin_enrolamiento: string; pin_expira_en: string; supervisado: boolean;
}
export interface Telemetria {
  capturado_en: string; bateria_pct: number | null; cargando: boolean | null;
  almacen_libre_mb: number | null; almacen_total_mb: number | null; red_tipo: string | null;
  ssid: string | null; operador: string | null; roaming: boolean | null;
  bloqueo_pantalla: boolean | null; cifrado: boolean | null; cumple: boolean | null;
}
export interface AppInstalada {
  paquete: string; nombre: string | null; version: string | null; estado: string;
  primera_vez_en: string | null; ultimo_visto_en: string | null;
}
export interface Navegacion { visitado_en: string; dominio: string; url: string | null; titulo: string | null; bloqueado: boolean; }
export interface EventoMon {
  id: number; dispositivo_id: string; tipo: string; severidad: string; detalle_json: string | null; visto: boolean; creado_en: string;
}
export interface Comando {
  id: string; tipo: string; estado: string; payload_json: string | null;
  creado_en: string; enviado_en: string | null; ejecutado_en: string | null; resultado_json: string | null;
}
export interface Politica {
  id: string; nombre: string; apps_bloqueadas: string[]; apps_permitidas: string[]; wifi_corp: string[];
  requiere_bloqueo: boolean; requiere_cifrado: boolean; version: number; activa: boolean;
}
export interface Geocerca {
  id: string; nombre: string; centro_lat: number; centro_lon: number; radio_m: number; tipo: string; activa: boolean;
}
export interface Regla {
  id: string; nombre: string; disparador: string; condicion_json: string | null; accion: string; accion_payload: string | null; activa: boolean;
}
export interface Respaldo {
  id: string; destino: string; estado: string; bytes_total: number | null; archivos_total: number | null; iniciado_en: string; completado_en: string | null;
}

export type TipoComando =
  'LOCALIZAR' | 'ALARMA' | 'BLOQUEAR' | 'DESBLOQUEAR' | 'MENSAJE' | 'WIPE_CORP' | 'RESPALDAR' | 'SINCRONIZAR' | 'APLICAR_POLITICA';

@Injectable({ providedIn: 'root' })
export class DeviceManagementService {
  private http = inject(HttpClient);

  // Cuenta / licencia
  cuenta(): Observable<Cuenta> { return this.http.get<Cuenta>(`${BASE}/cuenta`); }
  activarLicencia(body: { plan?: string; max_dispositivos?: number; licencia_fin_en?: string }): Observable<Cuenta> {
    return this.http.post<Cuenta>(`${BASE}/cuenta/licencia`, body);
  }
  tablero(): Observable<Tablero> { return this.http.get<Tablero>(`${BASE}/tablero`); }

  // Dispositivos
  flota(): Observable<Dispositivo[]> { return this.http.get<Dispositivo[]>(`${BASE}/dispositivos`); }
  crear(body: { etiqueta: string; plataforma: string; usuario_asignado?: string }): Observable<DispositivoCreado> {
    return this.http.post<DispositivoCreado>(`${BASE}/dispositivos`, body);
  }
  dispositivo(id: string): Observable<Dispositivo> { return this.http.get<Dispositivo>(`${BASE}/dispositivos/${id}`); }
  editar(id: string, body: { etiqueta?: string; usuario_asignado?: string; estado?: string }): Observable<Dispositivo> {
    return this.http.put<Dispositivo>(`${BASE}/dispositivos/${id}`, body);
  }
  retirar(id: string): Observable<{ ok: boolean }> { return this.http.delete<{ ok: boolean }>(`${BASE}/dispositivos/${id}`); }

  telemetria(id: string): Observable<Telemetria> { return this.http.get<Telemetria>(`${BASE}/dispositivos/${id}/telemetria`); }
  ubicaciones(id: string): Observable<Ubicacion[]> { return this.http.get<Ubicacion[]>(`${BASE}/dispositivos/${id}/ubicaciones`); }
  apps(id: string): Observable<AppInstalada[]> { return this.http.get<AppInstalada[]>(`${BASE}/dispositivos/${id}/apps`); }
  navegacion(id: string): Observable<Navegacion[]> { return this.http.get<Navegacion[]>(`${BASE}/dispositivos/${id}/navegacion`); }
  eventos(id: string): Observable<EventoMon[]> { return this.http.get<EventoMon[]>(`${BASE}/dispositivos/${id}/eventos`); }
  respaldos(id: string): Observable<Respaldo[]> { return this.http.get<Respaldo[]>(`${BASE}/dispositivos/${id}/respaldos`); }

  // Comandos anti-robo (todos visibles en el dispositivo)
  emitirComando(id: string, tipo: TipoComando, payload?: Record<string, unknown>): Observable<Comando> {
    return this.http.post<Comando>(`${BASE}/dispositivos/${id}/comandos`,
      { tipo, payload_json: payload ? JSON.stringify(payload) : null });
  }
  comandos(id: string): Observable<Comando[]> { return this.http.get<Comando[]>(`${BASE}/dispositivos/${id}/comandos`); }

  // Políticas
  politicas(): Observable<Politica[]> { return this.http.get<Politica[]>(`${BASE}/politicas`); }
  crearPolitica(body: Partial<Politica>): Observable<Politica> { return this.http.post<Politica>(`${BASE}/politicas`, body); }
  editarPolitica(id: string, body: Partial<Politica>): Observable<Politica> { return this.http.put<Politica>(`${BASE}/politicas/${id}`, body); }
  asignarPolitica(dispositivoId: string, politicaId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/dispositivos/${dispositivoId}/politica`, { politica_id: politicaId });
  }

  // Geocercas
  geocercas(): Observable<Geocerca[]> { return this.http.get<Geocerca[]>(`${BASE}/geocercas`); }
  crearGeocerca(body: Partial<Geocerca>): Observable<Geocerca> { return this.http.post<Geocerca>(`${BASE}/geocercas`, body); }
  eliminarGeocerca(id: string): Observable<{ ok: boolean }> { return this.http.delete<{ ok: boolean }>(`${BASE}/geocercas/${id}`); }

  // Reglas
  reglas(): Observable<Regla[]> { return this.http.get<Regla[]>(`${BASE}/reglas`); }
  crearRegla(body: Partial<Regla>): Observable<Regla> { return this.http.post<Regla>(`${BASE}/reglas`, body); }
  eliminarRegla(id: string): Observable<{ ok: boolean }> { return this.http.delete<{ ok: boolean }>(`${BASE}/reglas/${id}`); }

  // Alertas
  alertas(): Observable<EventoMon[]> { return this.http.get<EventoMon[]>(`${BASE}/alertas`); }
  marcarVisto(eventoId: number): Observable<{ ok: boolean }> { return this.http.post<{ ok: boolean }>(`${BASE}/eventos/${eventoId}/visto`, {}); }
}

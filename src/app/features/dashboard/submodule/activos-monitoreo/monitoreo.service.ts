import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';

/**
 * Cliente de Monitoreo de equipos (ms-assets, dominio endpoint). El servidor sirve snake_case,
 * así que las interfaces lo respetan. El canal del agente (enrolar/latido/…) NO se llama desde
 * aquí: eso lo hace el agente de escritorio con el token de la máquina.
 */

export type EstadoEndpoint = 'ONLINE' | 'OFFLINE' | 'INACTIVO' | 'ALERTA' | 'DESCONOCIDO';

export interface EndpointMon {
  id: number; activoId: number | null; activoCodigo: string | null; activoNombre: string | null;
  responsableRef: string | null; responsableNombre: string | null; responsableDoc: string | null; tieneFoto: boolean;
  machineUid: string; hostname: string | null; so: string | null; soVersion: string | null;
  arquitectura: string | null; cpu: string | null; ramMb: number | null; discoMb: number | null;
  agenteVersion: string | null; politicaId: number | null; estado: EstadoEndpoint;
  usuarioActivo: string | null; ipLan: string | null; revocado: boolean;
  enroladoEn: string | null; ultimoLatido: string | null;
}

export interface Tablero {
  total: number; online: number; offline: number; inactivos: number; alertasHoy: number;
  recientes: EndpointMon[];
}

export interface Politica {
  id: number; nombre: string; descripcion: string | null;
  capInventario: boolean; capProcesos: boolean; capUso: boolean; capEventos: boolean; capCaptura: boolean;
  capTexto: boolean; guardarTitulos: boolean;
  ventanaInicio: string | null; ventanaFin: string | null; retencionDias: number;
  consentimientoTxt: string | null; activa: boolean;
}

export interface Auditoria {
  id: number; endpointId: number; fecha: string; severidad: 'INFO' | 'AVISO' | 'ALERTA';
  resumen: string | null; hallazgos: Array<Record<string, unknown>>; origen: string;
  tareaRef: string | null; creado: string;
}

export interface Comando {
  id: number; endpointId: number; tipo: string; params: Record<string, unknown> | null;
  estado: string; creadoPor: string | null; creado: string; entregado: string | null;
  resuelto: string | null; resultado: Record<string, unknown> | null;
}

export interface Soporte {
  id: number; endpointId: number; solicitante: string | null; motivo: string | null;
  estado: string; iniciado: string; aceptadoEn: string | null; cerrado: string | null;
}

export interface EnrolamientoPin { pin: string; expira: string; }

// ── Levantamiento de procesos (sub-módulo) ────────────────────────────
export interface ProcNodo { clave: string; tipo: string; etiqueta: string | null; peso: number; veces: number; }
export interface ProcArista { desde: string; hacia: string; tipo: string; conteo: number; peso: number; }
export interface ProcGrafo { persona: string | null; nodos: ProcNodo[]; aristas: ProcArista[]; }
export interface ProcPersona { persona: string; nombre: string; endpointId: number; }
export interface Hallazgo {
  id: number; tipo: string; titulo: string; detalle: string | null;
  fuente: string | null; fuenteRef: string | null; fechaFuente: string | null; confianza: number; creado: string;
}
export interface Comunicacion {
  id: number; ts: string | null; deNombre: string | null; destino: string | null;
  canal: string; asunto: string | null; fuente: string | null;
}
export interface Fragmento {
  id: number; ts: string | null; origen: string; app: string | null; tituloVentana: string | null;
  resumen: string | null; contenido: string | null; bytes: number; sensible: boolean;
}

export interface MetricaPunto { ts: string | null; cpu: number | null; ram: number | null; online: boolean; }
export interface ReporteEquipo {
  generado: string; desde: string; hasta: string;
  endpoint: EndpointMon;
  politica: Politica | null;
  consentimiento: { versionTxt: string | null; aceptadoEn: string | null; ip: string | null } | null;
  inventario: { ts: string | null; hardware: Record<string, unknown> | null; software: unknown } | null;
  metricas: { muestras: number; onlinePct: number; serie: MetricaPunto[] };
  // Agregados de la analítica (formas de ActividadDtos); se consumen laxos en la plantilla.
  actividad: any; mapa: any; perfil: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  grafo: ProcGrafo; hallazgos: Hallazgo[]; comunicaciones: Comunicacion[]; fragmentos: Fragmento[];
  auditorias: Auditoria[];
  eventos: Array<{ ts: string | null; tipo: string; detalle: unknown }>;
  capturas: Array<{ ts: string | null; motivo: string | null; docRef: string | null; porUsuario: string | null; consentida: boolean }>;
  procesosUltimo: { ts: string | null; total: number; top: Array<{ name: string; pid: unknown; mem: unknown }> } | null;
}

@Injectable({ providedIn: 'root' })
export class MonitoreoService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/assets`;

  tablero(): Observable<Tablero> { return this.http.get<Tablero>(`${this.base}/tablero-endpoints`); }

  endpoints(q?: string, estado?: string): Observable<EndpointMon[]> {
    const params: Record<string, string> = {};
    if (q) params['q'] = q;
    if (estado) params['estado'] = estado;
    return this.http.get<EndpointMon[]>(`${this.base}/endpoints`, { params });
  }

  endpoint(id: number): Observable<EndpointMon> { return this.http.get<EndpointMon>(`${this.base}/endpoints/${id}`); }

  revocar(id: number): Observable<void> { return this.http.post<void>(`${this.base}/endpoints/${id}/revocar`, {}); }

  // ── Responsable (de quién es el equipo) + foto ──────────────────────
  asignarResponsable(id: number, ref: string | null, nombre: string | null, doc: string | null): Observable<EndpointMon> {
    return this.http.put<EndpointMon>(`${this.base}/endpoints/${id}/responsable`, { responsableRef: ref, responsableNombre: nombre, responsableDoc: doc });
  }
  subirFoto(id: number, archivo: File): Observable<EndpointMon> {
    const fd = new FormData(); fd.append('archivo', archivo);
    return this.http.post<EndpointMon>(`${this.base}/endpoints/${id}/foto`, fd);
  }
  foto(id: number): Observable<{ data_url: string | null }> {
    return this.http.get<{ data_url: string | null }>(`${this.base}/endpoints/${id}/foto`);
  }
  /** Búsqueda de usuarios de la plataforma (ms-auth-admin) para asignar el dueño del equipo. */
  buscarUsuarios(q: string): Observable<Array<Record<string, unknown>>> {
    return this.http.get<Array<Record<string, unknown>>>(`${environment.apiUrl}/api/v1/admin/usuarios`, { params: { q, size: '8' } });
  }

  auditoriasDe(id: number): Observable<Auditoria[]> { return this.http.get<Auditoria[]>(`${this.base}/endpoints/${id}/auditorias`); }
  auditoriasDia(fecha?: string): Observable<Auditoria[]> {
    return this.http.get<Auditoria[]>(`${this.base}/auditorias`, { params: fecha ? { fecha } : {} });
  }
  correrAuditoria(fecha?: string, forzar = false): Observable<{ fecha: string; equipos: number }> {
    const params: Record<string, string> = { forzar: String(forzar) };
    if (fecha) params['fecha'] = fecha;
    return this.http.post<{ fecha: string; equipos: number }>(`${this.base}/auditorias/correr`, {}, { params });
  }
  /** Devuelve {objetivo, contexto, soloLectura} para lanzar una misión del pool desde Agentes IA. */
  profundizar(id: number, fecha?: string): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(`${this.base}/endpoints/${id}/profundizar`, {}, { params: fecha ? { fecha } : {} });
  }

  comandos(id: number): Observable<Comando[]> { return this.http.get<Comando[]>(`${this.base}/endpoints/${id}/comandos`); }
  crearComando(id: number, tipo: string, params?: Record<string, unknown>): Observable<Comando> {
    return this.http.post<Comando>(`${this.base}/endpoints/${id}/comandos`, { tipo, params: params ?? {} });
  }

  soporteDe(id: number): Observable<Soporte[]> { return this.http.get<Soporte[]>(`${this.base}/endpoints/${id}/soporte`); }
  pedirSoporte(id: number, motivo?: string): Observable<Soporte> {
    return this.http.post<Soporte>(`${this.base}/endpoints/${id}/soporte`, { motivo });
  }
  cambiarEstadoSoporte(id: number, estado: string): Observable<Soporte> {
    return this.http.post<Soporte>(`${this.base}/soporte/${id}/estado`, {}, { params: { estado } });
  }

  politicas(): Observable<Politica[]> { return this.http.get<Politica[]>(`${this.base}/politicas`); }
  crearPolitica(p: Partial<Politica>): Observable<Politica> { return this.http.post<Politica>(`${this.base}/politicas`, p); }
  actualizarPolitica(id: number, p: Partial<Politica>): Observable<Politica> { return this.http.put<Politica>(`${this.base}/politicas/${id}`, p); }

  generarPin(activoId?: number, politicaId?: number): Observable<EnrolamientoPin> {
    return this.http.post<EnrolamientoPin>(`${this.base}/enrolamiento`, { activo_id: activoId, politica_id: politicaId });
  }

  // ── Levantamiento de procesos ───────────────────────────────────────
  procPersonas(): Observable<ProcPersona[]> { return this.http.get<ProcPersona[]>(`${this.base}/proceso/personas`); }
  procGrafo(persona?: string): Observable<ProcGrafo> {
    return this.http.get<ProcGrafo>(`${this.base}/proceso/grafo`, { params: persona ? { persona } : {} });
  }
  procHallazgos(persona?: string): Observable<Hallazgo[]> {
    return this.http.get<Hallazgo[]>(`${this.base}/proceso/hallazgos`, { params: persona ? { persona } : {} });
  }
  procComunicaciones(persona?: string): Observable<Comunicacion[]> {
    return this.http.get<Comunicacion[]>(`${this.base}/proceso/comunicaciones`, { params: persona ? { persona } : {} });
  }
  procFragmentos(persona?: string): Observable<Fragmento[]> {
    return this.http.get<Fragmento[]>(`${this.base}/proceso/fragmentos`, { params: persona ? { persona } : {} });
  }
  procLevantar(fecha?: string): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(`${this.base}/proceso/levantar`, {}, { params: fecha ? { fecha } : {} });
  }

  // ── Reporte integral del equipo ─────────────────────────────────────
  reporte(id: number, desde?: string, hasta?: string): Observable<ReporteEquipo> {
    const params: Record<string, string> = {};
    if (desde) params['desde'] = desde;
    if (hasta) params['hasta'] = hasta;
    return this.http.get<ReporteEquipo>(`${this.base}/endpoints/${id}/reporte`, { params });
  }
}

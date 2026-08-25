import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Servicio del submódulo "Analítica Nómina IA".
 *
 * Habla con DOS backends a través del gateway:
 *   • ms-payroll  → GET /api/nomina/analitica-ia/analisis  (datos + anomalías)
 *   • ms-ai       → /ia/nomina/*  (informe IA, chat, transcripción, capacidades)
 *
 * El interceptor de auth añade el JWT a ambos (mismo host `apiUrl`). Para los
 * dropdowns de empresa/ceco/periodo se reutiliza NominaService.
 */

// ── Modelo del análisis (mirror de AnaliticaIaDtos, JSON camelCase) ──────────
export interface MetaAnalisis {
  desde: string | null; hasta: string | null; clienteId: number | null;
  cecos: number[] | null; estado: string | null; granularidad: string;
  periodos: number; empleadosUltimoPeriodo: number; totalAnomalias: number;
}
export interface ComparativoPunto {
  clave: string; etiqueta: string; empleados: number; nominas: number;
  devengado: number; deducido: number; neto: number; ibc: number; aportes: number;
  netoPromedio: number; novedadesConteo: number; novedadesValor: number;
}
export interface KpiComparado {
  metrica: string; etiqueta: string; formato: 'MONEDA' | 'ENTERO';
  valorActual: number; valorAnterior: number | null;
  deltaAbs: number | null; deltaPct: number | null; direccion: 'SUBE' | 'BAJA' | 'IGUAL';
}
export interface Anomalia {
  id: string; dimension: 'GLOBAL' | 'EMPRESA' | 'CECO' | 'NOVEDAD';
  entidadId: number | null; entidad: string; metrica: string; metricaEtiqueta: string;
  periodoClave: string; periodoEtiqueta: string; valor: number; esperado: number;
  desviacionPct: number; zScore: number; severidad: 'ALTA' | 'MEDIA' | 'BAJA';
  direccion: 'SUBE' | 'BAJA'; mensaje: string;
}
export interface DistribucionItemIA { id: number | null; etiqueta: string; conteo: number; valor: number; }
export interface FacturacionPunto {
  clave: string; etiqueta: string; factura: number; costo: number;
  provisiones: number; ssPatronal: number; margen: number;
}
export interface BloqueFacturacion {
  disponible: boolean; totalFactura: number; totalCosto: number;
  totalProvisiones: number; totalSsPatronal: number; margen: number; margenPct: number;
  serie: FacturacionPunto[];
}
export interface AnalisisNomina {
  meta: MetaAnalisis;
  kpis: KpiComparado[];
  serie: ComparativoPunto[];
  anomalias: Anomalia[];
  topEmpresas: DistribucionItemIA[];
  topCecos: DistribucionItemIA[];
  topNovedades: DistribucionItemIA[];
  facturacion: BloqueFacturacion | null;
}

// ── Modelo del chat ──────────────────────────────────────────────────────────
// Contrato camelCase: ms-ai serializa estos DTOs en camelCase (verificado en
// prod). La property-naming-strategy SNAKE_CASE global del servicio NO se aplica
// a los Java records, así que salen con sus nombres de componente (camelCase),
// igual que el análisis de ms-payroll. `createdAt/updatedAt` llegan como epoch
// numérico; no se usan en plantilla, se tipan laxo.
export interface FolderDto { id: number; nombre: string; color: string | null; orden: number | null; conversaciones: number; }
export interface ConversacionDto {
  id: number; folderId: number | null; titulo: string; modelo: string | null;
  archivada: boolean; createdAt: number | string; updatedAt: number | string;
}
export interface MensajeDto { id: number; rol: 'user' | 'assistant' | 'system'; contenido: string; adjuntosJson: string | null; createdAt: number | string; }
export interface ConversacionDetalle { conversacion: ConversacionDto; mensajes: MensajeDto[]; }
export interface RespuestaChat { conversacionId: number; mensaje: MensajeDto; modeloUsado: string; }
export interface Adjunto { nombre: string; tipo: string; tamano: number; textoExtraido?: string | null; }
export interface ScopeChat { clienteId: number | null; cecos: number[]; anio: number | null; }
export interface EnviarMensajeReq { contenido: string; adjuntos?: Adjunto[]; contexto?: string | null; webSearch?: boolean; model?: string | null; scope?: ScopeChat; }
export interface InformeResp { narrativa: string; resumen: string; modeloUsado: string; }
export interface Capacidades { transcripcion: boolean; webSearch: boolean; }

@Injectable({ providedIn: 'root' })
export class AnaliticaIaService {
  private http = inject(HttpClient);
  private baseAnalitica = `${environment.apiUrl}/api/nomina/analitica-ia`;
  private baseAi = `${environment.apiUrl}/ia/nomina`;

  // ── Datos / anomalías (ms-payroll) ─────────────────────────────────────────
  getAnalisis(params: any = {}): Observable<AnalisisNomina> {
    return this.http.get<AnalisisNomina>(`${this.baseAnalitica}/analisis`, { params });
  }

  // ── Informe IA (ms-ai) ──────────────────────────────────────────────────────
  generarInforme(body: { analisis: AnalisisNomina; contexto?: string; model?: string }): Observable<InformeResp> {
    return this.http.post<InformeResp>(`${this.baseAi}/informe`, body);
  }

  capacidades(): Observable<Capacidades> {
    return this.http.get<Capacidades>(`${this.baseAi}/capacidades`);
  }

  transcribir(file: Blob, filename = 'audio.webm'): Observable<{ texto: string }> {
    const fd = new FormData();
    fd.append('file', file, filename);
    return this.http.post<{ texto: string }>(`${this.baseAi}/transcribir`, fd);
  }

  // ── Chat: carpetas ──────────────────────────────────────────────────────────
  listarFolders(): Observable<FolderDto[]> { return this.http.get<FolderDto[]>(`${this.baseAi}/chat/folders`); }
  crearFolder(nombre: string, color?: string): Observable<FolderDto> {
    return this.http.post<FolderDto>(`${this.baseAi}/chat/folders`, { nombre, color });
  }
  actualizarFolder(id: number, body: { nombre?: string; color?: string; orden?: number }): Observable<FolderDto> {
    return this.http.put<FolderDto>(`${this.baseAi}/chat/folders/${id}`, body);
  }
  eliminarFolder(id: number): Observable<void> { return this.http.delete<void>(`${this.baseAi}/chat/folders/${id}`); }

  // ── Chat: conversaciones ────────────────────────────────────────────────────
  listarConversaciones(folderId?: number | null): Observable<ConversacionDto[]> {
    const params: any = {};
    if (folderId != null) params.folderId = folderId;
    return this.http.get<ConversacionDto[]>(`${this.baseAi}/chat/conversaciones`, { params });
  }
  obtenerConversacion(id: number): Observable<ConversacionDetalle> {
    return this.http.get<ConversacionDetalle>(`${this.baseAi}/chat/conversaciones/${id}`);
  }
  crearConversacion(body: { titulo?: string; folderId?: number | null; contextoJson?: string; modelo?: string }): Observable<ConversacionDto> {
    return this.http.post<ConversacionDto>(`${this.baseAi}/chat/conversaciones`, body);
  }
  moverConversacion(id: number, folderId: number | null): Observable<ConversacionDto> {
    return this.http.put<ConversacionDto>(`${this.baseAi}/chat/conversaciones/${id}/mover`, { folderId });
  }
  renombrarConversacion(id: number, titulo: string): Observable<ConversacionDto> {
    return this.http.put<ConversacionDto>(`${this.baseAi}/chat/conversaciones/${id}/renombrar`, { titulo });
  }
  eliminarConversacion(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseAi}/chat/conversaciones/${id}`);
  }

  // ── Chat: turno ──────────────────────────────────────────────────────────────
  enviarMensaje(conversacionId: number, body: EnviarMensajeReq): Observable<RespuestaChat> {
    return this.http.post<RespuestaChat>(`${this.baseAi}/chat/conversaciones/${conversacionId}/mensajes`, body);
  }
  enviarMensajeNuevo(body: EnviarMensajeReq): Observable<RespuestaChat> {
    return this.http.post<RespuestaChat>(`${this.baseAi}/chat/mensajes`, body);
  }
}

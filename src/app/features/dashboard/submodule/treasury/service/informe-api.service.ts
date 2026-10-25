import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Cliente del informe de tesorería (ms-payroll, `/gestion_tesoreria/informe`).
 *
 * <p>Todo llega en snake_case, como el resto de tesorería. Las cifras de capacidad salen de
 * un <b>corte</b>: la foto diaria de lo que el motor de reglas le respondería a cada activo
 * si pidiera mercado o préstamo. El histórico de uso sale de las transacciones.
 */

export interface ResumenConcepto {
  elegibles: number;
  con_cupo: number;
  cupo_agotado: number;
  sin_tope: number;
  no_elegibles: number;
  capacidad: number;
  cupo_disponible: number;
  utilizacion: number | null;
  cupo_promedio: number | null;
  motivos: Record<string, number>;
}

export interface ResumenCorte {
  fecha_corte: string;
  personas_activas: number;
  bloqueadas: number;
  con_deuda: number;
  deuda_total: number;
  deuda_mercado: number;
  deuda_prestamo: number;
  comprometido_total: number;
  con_comprometido: number;
  mercado: ResumenConcepto;
  prestamo: ResumenConcepto;
  uso: { usaron_30d: number; usaron_90d: number; nunca_usaron: number; penetracion_90d: number | null };
  oportunidad: { personas: number; cupo_mercado: number };
  reglas_omitidas?: string[];
  errores_evaluacion?: number;
}

export interface CorteInforme {
  id: number;
  fecha_corte: string;
  generado_en: string;
  generado_por: string | null;
  origen: 'MANUAL' | 'AUTOMATICO';
  duracion_ms: number | null;
  personas_evaluadas: number;
  reglas_omitidas: string | null;
  detalle_disponible: boolean;
  resumen: ResumenCorte | null;
}

export interface EstadoInforme {
  corte: CorteInforme | null;
  padron: {
    total: number;
    activos: number;
    bloqueados: number;
    ultima_actualizacion: string | null;
    activos_desactualizados: number;
  };
  pendientes: {
    autorizaciones: number;
    personas: number;
    monto: number;
    viejas_30d: number;
    personas_viejas_30d: number;
    monto_viejas_30d: number;
    sin_vencimiento: number;
    montos_atipicos: number;
    mas_antigua: string | null;
  };
  nombres_reglas: Record<string, string>;
  monto_atipico: number;
  generando: boolean;
  ultimo_error: string | null;
}

export type DimensionSegmento = 'FINCA' | 'TEMPORAL' | 'ANTIGUEDAD' | 'CUPO_MERCADO';

export interface FilaSegmento {
  segmento: string;
  personas: number;
  bloqueadas: number;
  con_deuda: number;
  deuda: number;
  mercado_elegibles: number;
  mercado_con_cupo: number;
  mercado_capacidad: number;
  mercado_cupo: number;
  mercado_utilizacion: number | null;
  prestamo_con_cupo: number;
  prestamo_cupo: number;
  usaron_30d: number;
  usaron_90d: number;
  penetracion_90d: number | null;
  oportunidad_personas: number;
  oportunidad_cupo: number;
}

export type SegmentoPersonas =
  | 'OPORTUNIDAD' | 'AGOTADOS' | 'SOBREENDEUDADOS' | 'NO_ELEGIBLES' | 'BLOQUEADOS' | 'TODOS';

export interface PersonaInforme {
  numero_documento: string;
  nombre: string | null;
  codigo: string | null;
  finca: string | null;
  temporal: string | null;
  fecha_ingreso: string | null;
  meses_trabajados: number | null;
  bloqueado: boolean;
  deuda_total: number;
  deuda_mercado: number;
  deuda_prestamo: number;
  comprometido: number;
  mercado_elegible: boolean;
  mercado_tope: number | null;
  mercado_cupo: number | null;
  mercado_motivo: string | null;
  prestamo_elegible: boolean;
  prestamo_tope: number | null;
  prestamo_cupo: number | null;
  prestamo_motivo: string | null;
  ultima_operacion: string | null;
}

export interface PendienteVieja {
  numero_documento: string;
  nombre: string | null;
  activo: boolean | null;
  autorizaciones: number;
  monto: number;
  montos_atipicos: number;
  mas_antigua: string;
  conceptos: string;
}

/**
 * Cifras de las pendientes que cumplen la regla de anulación (ms-payroll
 * `/transacciones/anular-viejas/simular`). `monto` excluye los montos atípicos (> $10 M),
 * igual que el resto del informe; `en_cero` son autorizaciones de $0.
 */
export interface SimulacionAnulacion {
  dias: number;
  dias_minimos: number;
  autorizadas_antes_de: string;
  documentos_filtrados: number | null;
  autorizaciones: number;
  personas: number;
  monto: number;
  montos_atipicos: number;
  en_cero: number;
  personas_activas: number;
  autorizaciones_activas: number;
  monto_activas: number;
  mas_antigua: string | null;
  mas_reciente: string | null;
}

export interface ResultadoAnulacion {
  ok: boolean;
  lote: string | null;
  anuladas: number;
  motivo: string | null;
  anulado_por: string;
  anulado_en: string | null;
  mensaje?: string;
  autorizadas_antes_de: string;
  resumen: Omit<SimulacionAnulacion, 'dias' | 'dias_minimos' | 'autorizadas_antes_de' | 'documentos_filtrados'>;
}

export type PeriodoHistorico = 'MES' | 'QUINCENA' | 'SEMANA';

export interface CeldaHistorico {
  ejecutadas?: number;
  monto_ejecutado?: number;
  personas?: number;
  autorizadas?: number;
  monto_autorizado?: number;
  anuladas?: number;
  siguen_pendientes?: number;
  personas_nuevas?: number;
  ticket_promedio?: number | null;
}

export interface PeriodoUso {
  periodo: string;
  total: CeldaHistorico;
  mercado?: CeldaHistorico;
  prestamo?: CeldaHistorico;
  otro?: CeldaHistorico;
}

export interface GrupoUso {
  grupo: string;
  clase: 'MERCADO' | 'PRESTAMO' | 'OTRO';
  operaciones: number;
  monto: number;
  personas: number;
}

export interface HistoricoUso {
  desde: string;
  hasta: string;
  periodo: PeriodoHistorico;
  periodos: PeriodoUso[];
  por_origen: GrupoUso[];
  por_sede: GrupoUso[];
  atipicos: { registros: number; ids: string; umbral: number };
}

@Injectable({ providedIn: 'root' })
export class InformeTesoreriaApi {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/gestion_tesoreria/informe`;

  estado(corteId?: number | null): Observable<EstadoInforme> {
    let params = new HttpParams();
    if (corteId) params = params.set('corte_id', corteId);
    return this.http.get<EstadoInforme>(`${this.base}/estado`, { params });
  }

  cortes(limite = 400): Observable<CorteInforme[]> {
    return this.http.get<CorteInforme[]>(`${this.base}/cortes`, { params: { limite } });
  }

  /** Arranca el corte en segundo plano (202). Se sabe que terminó cuando /estado deja de decir `generando`. */
  generarCorte(): Observable<{ iniciado: boolean }> {
    return this.http.post<{ iniciado: boolean }>(`${this.base}/cortes`, {});
  }

  segmentos(dimension: DimensionSegmento, corteId?: number | null, limite = 60): Observable<FilaSegmento[]> {
    let params = new HttpParams().set('dimension', dimension).set('limite', limite);
    if (corteId) params = params.set('corte_id', corteId);
    return this.http.get<FilaSegmento[]>(`${this.base}/segmentos`, { params });
  }

  personas(segmento: SegmentoPersonas, filtros: {
    corteId?: number | null; motivo?: string | null; finca?: string | null; temporal?: string | null; limite?: number;
  } = {}): Observable<{ total: number; fecha_corte?: string; filas: PersonaInforme[] }> {
    let params = new HttpParams().set('segmento', segmento).set('limite', filtros.limite ?? 20000);
    if (filtros.corteId) params = params.set('corte_id', filtros.corteId);
    if (filtros.motivo) params = params.set('motivo', filtros.motivo);
    if (filtros.finca) params = params.set('finca', filtros.finca);
    if (filtros.temporal) params = params.set('temporal', filtros.temporal);
    return this.http.get<any>(`${this.base}/personas`, { params });
  }

  pendientesViejas(dias = 30): Observable<PendienteVieja[]> {
    return this.http.get<PendienteVieja[]>(`${this.base}/pendientes-viejas`, { params: { dias, limite: 20000 } });
  }

  historico(desde: string, hasta: string, periodo: PeriodoHistorico): Observable<HistoricoUso> {
    return this.http.get<HistoricoUso>(`${this.base}/historico`, { params: { desde, hasta, periodo } });
  }

  // ── Anulación de pendientes viejas (solo ADMIN y GERENCIA) ──────────────────

  private anulacion = `${environment.apiUrl}/gestion_tesoreria/transacciones/anular-viejas`;

  /** Cuántas autorizaciones cumplen la regla. Sin `documentos`: todas las personas. */
  simularAnulacion(dias = 30, documentos?: string[]): Observable<SimulacionAnulacion> {
    return this.http.post<SimulacionAnulacion>(`${this.anulacion}/simular`, documentos ? { dias, documentos } : { dias });
  }

  /**
   * Anula lo que cumple la regla. `cantidad_esperada` es lo que mostró la vista previa: si
   * no coincide, el servidor no toca nada y responde 409 con la simulación nueva.
   */
  anularViejas(cuerpo: {
    dias: number; motivo: string; cantidad_esperada: number; documentos?: string[]; lote?: string;
  }): Observable<ResultadoAnulacion> {
    return this.http.post<ResultadoAnulacion>(this.anulacion, cuerpo);
  }
}

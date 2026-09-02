import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Cliente de los endpoints nuevos de tesorería (ms-payroll, V45).
 *
 * <p>Todo llega en snake_case: ms-payroll serializa en camelCase por configuración del
 * contenedor, así que estos controladores construyen el mapa a mano para respetar el
 * contrato que el frontend histórico ya sabe leer. Las interfaces de aquí lo respetan tal
 * cual — renombrar a camelCase obligaría a un mapeo en cada pantalla y, en cuanto uno se
 * olvide, el campo llega `undefined` sin que nada falle a la vista.
 *
 * <p>Este servicio reemplaza la lógica de topes que vivía en `autorizaciones.service.ts`.
 * Ahí las reglas estaban escritas a mano en TypeScript; el servidor no las hacía cumplir
 * y GERENCIA/ADMIN se saltaban incluso la validación del navegador. Ahora el veredicto es
 * del servidor y esta capa solo lo transporta.
 */

// ── Reglas ──────────────────────────────────────────────────────────────────

export type ConceptoRegla = 'MERCADO' | 'PRESTAMO' | 'TODOS';
export type SeveridadRegla = 'BLOQUEA' | 'ADVIERTE' | 'INFORMA';

export interface TramoRegla {
  id?: number;
  orden?: number;
  desde: number | null;
  hasta: number | null;
  valor: number;
  etiqueta: string | null;
}

export interface AjusteRegla {
  id?: number;
  orden?: number;
  nombre: string | null;
  tipo_sujeto: 'TODOS' | 'ROL' | 'CORREO' | 'SEDE';
  sujeto: string | null;
  min_dias: number | null;
  max_dias: number | null;
  operacion: 'SUMA' | 'RESTA' | 'FIJA' | 'FACTOR';
  valor: number;
  excluye: string | null;
  activo: boolean;
}

export interface Regla {
  id?: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  concepto: ConceptoRegla;
  tipo: string;
  severidad: SeveridadRegla;
  prioridad: number;
  activa: boolean;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  /** Que esté activa no significa que aplique hoy: puede estar programada al futuro. */
  aplica_hoy?: boolean;
  parametros: Record<string, any>;
  mensaje_rechazo: string | null;
  creado_por?: string | null;
  actualizado_por?: string | null;
  actualizado_en?: string | null;
  tramos: TramoRegla[];
  ajustes: AjusteRegla[];
  comentario?: string;
}

export interface TipoDeRegla {
  tipo: string;
  nombre: string;
  descripcion: string;
  usa_tramos: boolean;
  usa_ajustes: boolean;
  parametros_ejemplo: Record<string, any>;
  campos_persona: string[];
}

export interface CatalogoReglas {
  tipos: TipoDeRegla[];
  conceptos: ConceptoRegla[];
  severidades: { codigo: SeveridadRegla; nombre: string; descripcion: string }[];
  operaciones_ajuste: string[];
  tipos_sujeto: string[];
  campos_persona: string[];
}

export interface CambioDeRegla {
  id: number;
  regla_codigo: string;
  accion: string;
  usuario: string | null;
  fecha: string;
  comentario: string | null;
  snapshot_antes: string | null;
  snapshot_despues: string | null;
}

export interface ParametroTesoreria {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  grupo: string;
  tipo_valor: string;
  valor: string;
  editable: boolean;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

// ── Evaluación y ficha ──────────────────────────────────────────────────────

export type EstadoRegla = 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA' | 'SIN_DATOS';

export interface VeredictoRegla {
  codigo: string;
  nombre: string;
  tipo: string;
  severidad: SeveridadRegla | null;
  estado: EstadoRegla;
  mensaje: string;
  bloquea: boolean;
  advierte?: boolean;
  detalle: Record<string, any>;
}

export interface Evaluacion {
  concepto: string;
  aprobado: boolean;
  motivo: string | null;
  tope_base: number | null;
  tope_aplicado: number | null;
  origen_tope: string | null;
  origen_tope_texto?: string | null;
  saldo_pendiente: number;
  monto_comprometido: number;
  cupo_disponible: number | null;
  monto_solicitado: number | null;
  dias_trabajados: number | null;
  meses_trabajados?: number | null;
  con_excepcion_de_rol: boolean;
  rol_excepcion?: string | null;
  advertencias: string[];
  reglas: VeredictoRegla[];
}

export interface ResultadoBusqueda {
  numero_documento: string;
  nombre: string | null;
  codigo: string | null;
  finca: string | null;
  temporal: string | null;
  ingreso: string | null;
  activo: boolean;
  bloqueado: boolean;
  observacion_bloqueo: string | null;
  en_padron_activos: boolean;
  paz_y_salvo: boolean | null;
  saldo_pendiente: number;
  estado: 'HABILITADO' | 'BLOQUEADO' | 'RETIRADO' | 'EN_MORA';
}

export interface SolicitudHistorica {
  id: number;
  codigo_autorizacion: string;
  codigo_ejecucion: string | null;
  concepto: string;
  monto_autorizado: number;
  monto_ejecutado: number | null;
  cuotas: number | null;
  estado: 'PENDIENTE' | 'EJECUTADA' | 'ANULADA';
  estado_texto: string;
  vencida: boolean;
  es_reversa: boolean;
  dias_para_vencer?: number;
  autorizado_por: string | null;
  autorizado_en: string | null;
  sede_autorizacion: string | null;
  ejecutado_por: string | null;
  ejecutado_en: string | null;
  sede_ejecucion: string | null;
  forma_pago: string | null;
  numero_pago: string | null;
  nombre_quien_entrego: string | null;
  observacion: string | null;
  motivo_anulacion: string | null;
  vence_en: string | null;
  origen: string | null;
}

export interface AlertaFicha {
  nivel: 'critica' | 'aviso';
  titulo: string;
  detalle: string;
}

export interface Ficha {
  numero_documento: string;
  existe: boolean;
  mensaje?: string;
  persona?: {
    numero_documento: string; nombre: string | null; codigo: string | null;
    finca: string | null; temporal: string | null; salario: number | null;
    ingreso_texto: string | null; ingreso: string | null;
    dias_trabajados: number; meses_trabajados: number;
    activo: boolean; bloqueado: boolean;
    observacion_bloqueo: string | null; fecha_bloqueo: string | null;
    observacion_desbloqueo: string | null; fecha_desbloqueo: string | null;
    actualizado_en: string | null;
    /** La fecha de ingreso no se pudo interpretar: sin ella no hay tope por antigüedad. */
    ingreso_ilegible: boolean;
    /** Copia del padrón vigente, para el semáforo de la cabecera. */
    en_padron_activos: boolean;
    paz_y_salvo: boolean | null;
    tope_padron: number | null;
  };
  deuda?: {
    total: number;
    desglose: Record<string, number>;
    comprometido: number;
    cuotas: Record<string, number | null>;
  };
  evaluacion?: Evaluacion;
  evaluacion_alterna?: {
    concepto: string; aprobado: boolean; motivo: string | null;
    tope_aplicado: number | null; cupo_disponible: number | null;
  };
  solicitudes?: SolicitudHistorica[];
  resumen_solicitudes?: {
    pendientes: number; ejecutadas: number; anuladas: number; monto_comprometido: number;
  };
  padron?: any;
  incapacidades?: Record<string, any>;
  alertas?: AlertaFicha[];
}

// ── Padrón ──────────────────────────────────────────────────────────────────

export interface CargaPadron {
  id: number;
  nombre_archivo: string | null;
  origen: string;
  fecha_corte: string;
  cargado_por: string | null;
  cargado_en: string;
  filas_totales: number;
  filas_ok: number;
  filas_error: number;
  estado: 'PROCESADA' | 'CON_ERRORES' | 'ANULADA';
  vigente: boolean;
  observacion: string | null;
}

export interface ResultadoCargaPadron extends CargaPadron {
  ok: boolean;
  avisos: string[];
  errores: { row: number; error: string }[];
  personas_cruzadas: number;
  activada: boolean;
}

export interface FormatoPadron {
  obligatorias: { columna: string; descripcion: string }[];
  recomendadas: { columna: string; descripcion: string }[];
  opcionales: { columna: string; descripcion: string }[];
  notas: string[];
}

@Injectable({ providedIn: 'root' })
export class TesoreriaApiService {

  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/gestion_tesoreria`;

  // ── Buscador y ficha ──────────────────────────────────────────────────────

  /**
   * Buscador del mostrador: cédula, nombre o código de contrato.
   * Siempre devuelve lista; con menos de dos caracteres el servidor responde vacío.
   */
  buscarPersonas(q: string, limite = 15): Observable<ResultadoBusqueda[]> {
    const params = new HttpParams().set('q', q ?? '').set('limite', limite);
    return this.http.get<ResultadoBusqueda[]>(`${this.base}/personas/buscar`, { params });
  }

  /** La ficha 360. Devuelve 200 incluso si la persona no existe, con `existe: false`. */
  ficha(documento: string, concepto: ConceptoRegla = 'MERCADO',
        monto?: number | null, cuotas?: number | null, sede?: string | null): Observable<Ficha> {
    let params = new HttpParams().set('concepto', concepto);
    if (monto != null) params = params.set('monto', monto);
    if (cuotas != null) params = params.set('cuotas', cuotas);
    if (sede) params = params.set('sede', sede);
    return this.http.get<Ficha>(
      `${this.base}/personas/${encodeURIComponent(documento)}/ficha`, { params });
  }

  /**
   * Evaluación suelta, sin el historial alrededor. La usa la pantalla mientras se teclea
   * el monto: recargar la ficha entera en cada pulsación sería traerse el historial de la
   * persona una vez por tecla.
   */
  evaluar(documento: string, concepto: ConceptoRegla, monto?: number | null,
          cuotas?: number | null, sede?: string | null): Observable<Evaluacion> {
    let params = new HttpParams().set('documento', documento).set('concepto', concepto);
    if (monto != null) params = params.set('monto', monto);
    if (cuotas != null) params = params.set('cuotas', cuotas);
    if (sede) params = params.set('sede', sede);
    return this.http.get<Evaluacion>(`${this.base}/evaluar`, { params });
  }

  // ── Reglas ────────────────────────────────────────────────────────────────

  listarReglas(): Observable<Regla[]> {
    return this.http.get<Regla[]>(`${this.base}/reglas`);
  }

  catalogoDeReglas(): Observable<CatalogoReglas> {
    return this.http.get<CatalogoReglas>(`${this.base}/reglas/catalogo`);
  }

  crearRegla(r: Partial<Regla>): Observable<Regla> {
    return this.http.post<Regla>(`${this.base}/reglas`, r);
  }

  actualizarRegla(codigo: string, r: Partial<Regla>): Observable<Regla> {
    return this.http.put<Regla>(`${this.base}/reglas/${encodeURIComponent(codigo)}`, r);
  }

  cambiarEstadoRegla(codigo: string, activa: boolean, comentario?: string): Observable<Regla> {
    return this.http.post<Regla>(
      `${this.base}/reglas/${encodeURIComponent(codigo)}/estado`, { activa, comentario });
  }

  programarRegla(codigo: string, vigente_desde: string | null,
                 vigente_hasta: string | null, comentario?: string): Observable<Regla> {
    return this.http.post<Regla>(
      `${this.base}/reglas/${encodeURIComponent(codigo)}/vigencia`,
      { vigente_desde, vigente_hasta, comentario });
  }

  eliminarRegla(codigo: string, comentario?: string): Observable<any> {
    let params = new HttpParams();
    if (comentario) params = params.set('comentario', comentario);
    return this.http.delete(`${this.base}/reglas/${encodeURIComponent(codigo)}`, { params });
  }

  historialDeRegla(codigo: string): Observable<CambioDeRegla[]> {
    return this.http.get<CambioDeRegla[]>(
      `${this.base}/reglas/${encodeURIComponent(codigo)}/historial`);
  }

  listarParametros(): Observable<ParametroTesoreria[]> {
    return this.http.get<ParametroTesoreria[]>(`${this.base}/reglas/parametros`);
  }

  actualizarParametro(codigo: string, valor: string): Observable<ParametroTesoreria> {
    return this.http.put<ParametroTesoreria>(
      `${this.base}/reglas/parametros/${encodeURIComponent(codigo)}`, { valor });
  }

  // ── Padrón de activos ─────────────────────────────────────────────────────

  /**
   * Sube el Excel de personal activo. Por defecto NO se activa: primero se revisa el
   * resumen, porque activar cambia el tope de miles de personas a la vez.
   */
  subirPadron(archivo: File, fechaCorte: string,
              activar = false, observacion?: string): Observable<ResultadoCargaPadron> {
    const form = new FormData();
    form.append('file', archivo);
    let params = new HttpParams().set('fecha_corte', fechaCorte).set('activar', activar);
    if (observacion) params = params.set('observacion', observacion);
    return this.http.post<ResultadoCargaPadron>(
      `${this.base}/padron/import-excel`, form, { params });
  }

  cargasDePadron(): Observable<CargaPadron[]> {
    return this.http.get<CargaPadron[]>(`${this.base}/padron/cargas`);
  }

  padronVigente(): Observable<CargaPadron | { vigente: false; mensaje: string }> {
    return this.http.get<any>(`${this.base}/padron/vigente`);
  }

  resumenDeCarga(id: number): Observable<any> {
    return this.http.get(`${this.base}/padron/cargas/${id}/resumen`);
  }

  activarCarga(id: number): Observable<any> {
    return this.http.post(`${this.base}/padron/cargas/${id}/activar`, {});
  }

  anularCarga(id: number, motivo: string): Observable<CargaPadron> {
    return this.http.post<CargaPadron>(`${this.base}/padron/cargas/${id}/anular`, { motivo });
  }

  formatoDelPadron(): Observable<FormatoPadron> {
    return this.http.get<FormatoPadron>(`${this.base}/padron/formato`);
  }

  // ── Operaciones sobre solicitudes ─────────────────────────────────────────

  /**
   * Anula una autorización pendiente y libera su cupo. Hasta la V45 no había forma de
   * llegar al estado ANULADA y se acumularon 3.851 pendientes de meses.
   */
  anularAutorizacion(transaccionId: number, motivo: string): Observable<any> {
    return this.http.post(`${this.base}/transacciones/anular`,
      { transaccion_id: transaccionId, motivo });
  }
}

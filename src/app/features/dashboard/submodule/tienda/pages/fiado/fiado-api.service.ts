import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ECO_API_BASE } from '../kanban/eco-portable';

/** Cuenta de fiado de una persona en un comercio (ms-store V44, `store_fiado`). */
export interface CuentaFiado {
  id: string; negocio_id: string; tienda_id: string; cliente_cedula: string; cliente_nombre: string | null; cliente_telefono: string | null;
  cupo: number | null; saldo: number; estado: 'ACTIVA' | 'BLOQUEADA' | 'CERRADA'; dias_plazo: number;
  ultimo_cargo_en: string | null; ultimo_abono_en: string | null; nota: string | null; creado_en: string; actualizado_en: string | null;
}
export interface MovimientoFiado {
  id: string; fiado_id: string; tipo: 'CARGO' | 'ABONO' | 'AJUSTE'; monto: number; saldo_despues: number;
  pedido_id: string | null; venta_id: string | null; medio: string | null; referencia: string | null; nota: string | null;
  registrado_por_nombre: string | null; creado_en: string;
}
export interface RecordatorioFiado { id: string; tipo: string; canal: string; estado: string; texto: string; programado_para: string; enviado_en: string | null; motivo_omision: string | null; ultimo_error: string | null; }
export interface ResumenFiado { cuenta: CuentaFiado; disponible: number | null; en_mora: boolean; dias_mora: number; tienda_nombre: string | null; }
export interface DetalleFiado extends ResumenFiado { movimientos: MovimientoFiado[]; recordatorios: RecordatorioFiado[]; }

/** Cliente del fiado. Portable (solo `ECO_API_BASE`). */
@Injectable({ providedIn: 'root' })
export class FiadoApi {
  private http = inject(HttpClient);
  private base = inject(ECO_API_BASE);

  cuentas(tienda: string, filtros: { estado?: string; mora?: boolean } = {}): Observable<ResumenFiado[]> {
    let p = new HttpParams().set('tienda', tienda);
    if (filtros.estado) p = p.set('estado', filtros.estado);
    if (filtros.mora) p = p.set('mora', 'true');
    return this.http.get<ResumenFiado[]>(`${this.base}/fiado/cuentas`, { params: p });
  }
  abrir(tienda: string, datos: { cedula: string; nombre?: string; telefono?: string; cupo?: number | null; dias_plazo?: number | null; nota?: string }): Observable<CuentaFiado> {
    return this.http.post<CuentaFiado>(`${this.base}/fiado/cuentas`, datos, { params: { tienda } });
  }
  detalle(id: string): Observable<DetalleFiado> { return this.http.get<DetalleFiado>(`${this.base}/fiado/cuentas/${id}`); }
  cargar(id: string, monto: number, extra: { pedido_id?: string; venta_id?: string; nota?: string } = {}): Observable<MovimientoFiado> {
    return this.http.post<MovimientoFiado>(`${this.base}/fiado/cuentas/${id}/cargos`, { monto, ...extra });
  }
  abonar(id: string, monto: number, extra: { medio?: string; referencia?: string; nota?: string } = {}): Observable<MovimientoFiado> {
    return this.http.post<MovimientoFiado>(`${this.base}/fiado/cuentas/${id}/abonos`, { monto, ...extra });
  }
  ajustar(id: string, saldo: number, motivo: string): Observable<MovimientoFiado> {
    return this.http.post<MovimientoFiado>(`${this.base}/fiado/cuentas/${id}/ajustes`, { saldo, motivo });
  }
  estado(id: string, estado: 'ACTIVA' | 'BLOQUEADA' | 'CERRADA', nota?: string): Observable<CuentaFiado> {
    return this.http.post<CuentaFiado>(`${this.base}/fiado/cuentas/${id}/estado`, { estado, nota });
  }
  recordar(id: string, texto?: string): Observable<RecordatorioFiado> {
    return this.http.post<RecordatorioFiado>(`${this.base}/fiado/cuentas/${id}/recordar`, { texto });
  }
  /** Lo que la persona del token debe en cada comercio. */
  misCuentas(): Observable<ResumenFiado[]> { return this.http.get<ResumenFiado[]>(`${this.base}/fiado/mis-cuentas`); }
}

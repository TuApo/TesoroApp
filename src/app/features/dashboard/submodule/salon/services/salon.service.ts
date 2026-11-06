import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Alerta, AlcanceSalon, Analitica, Camara, CamaraForm, Espera, EsperaForm, EstadoEspera, EstadoMesa, FiltroAlertas, Mesa,
  MesaForm, Plano, PoligonoForm, PoligonoMesa, Prediccion, PropuestasPoligono, PruebaCamara, Reglas, Salon, SalonForm, Salud,
} from '../models/salon.models';
import { SALON_ALCANCE_URL, SALON_API_BASE } from './salon-api.token';

/**
 * Cliente HTTP del salón (§4 del contrato). Una función por endpoint, sin lógica: la base
 * llega por `SALON_API_BASE` para que la misma clase sirva en TesoroApp y en la app del
 * comercio. El JWT lo pone el interceptor de la app que lo monte.
 */
@Injectable({ providedIn: 'root' })
export class SalonService {
  private http = inject(HttpClient);
  private base = inject(SALON_API_BASE);
  private alcanceUrl = inject(SALON_ALCANCE_URL);

  private t(id: string) { return `${this.base}/tiendas/${encodeURIComponent(id)}`; }

  // ── Alcance ─────────────────────────────────────────────────────────────
  alcance(): Observable<AlcanceSalon> { return this.http.get<AlcanceSalon>(this.alcanceUrl); }

  // ── §4.1 Estructura ──────────────────────────────────────────────────────
  salones(tiendaId: string) { return this.http.get<Salon[]>(`${this.t(tiendaId)}/salones`); }
  crearSalon(tiendaId: string, body: SalonForm) { return this.http.post<Salon>(`${this.t(tiendaId)}/salones`, body); }
  editarSalon(id: string, body: SalonForm) { return this.http.put<Salon>(`${this.base}/salones/${id}`, body); }
  /** 409 si el salón aún tiene mesas activas. */
  borrarSalon(id: string) { return this.http.delete<void>(`${this.base}/salones/${id}`); }

  mesas(salonId: string) { return this.http.get<Mesa[]>(`${this.base}/salones/${salonId}/mesas`); }
  crearMesa(salonId: string, body: MesaForm) { return this.http.post<Mesa>(`${this.base}/salones/${salonId}/mesas`, body); }
  editarMesa(id: string, body: MesaForm) { return this.http.put<Mesa>(`${this.base}/mesas/${id}`, body); }
  /** Desactiva (no borra). */
  borrarMesa(id: string) { return this.http.delete<void>(`${this.base}/mesas/${id}`); }

  // ── §4.2 Cámaras y calibración ───────────────────────────────────────────
  camaras(tiendaId: string) { return this.http.get<Camara[]>(`${this.t(tiendaId)}/camaras`); }
  crearCamara(tiendaId: string, body: CamaraForm) { return this.http.post<Camara>(`${this.t(tiendaId)}/camaras`, body); }
  editarCamara(id: string, body: CamaraForm) { return this.http.put<Camara>(`${this.base}/camaras/${id}`, body); }
  borrarCamara(id: string) { return this.http.delete<void>(`${this.base}/camaras/${id}`); }
  probarCamara(url_rtsp: string) { return this.http.post<PruebaCamara>(`${this.base}/camaras/probar`, { url_rtsp }); }
  /** Último cuadro JPEG; el llamador lo convierte en `URL.createObjectURL`. */
  fotograma(camaraId: string) {
    return this.http.get(`${this.base}/camaras/${camaraId}/fotograma`, { responseType: 'blob' });
  }
  proponerPoligonos(camaraId: string) {
    return this.http.post<PropuestasPoligono>(`${this.base}/camaras/${camaraId}/proponer-poligonos`, {});
  }
  poligonos(camaraId: string) { return this.http.get<PoligonoMesa[]>(`${this.base}/camaras/${camaraId}/poligonos`); }
  guardarPoligono(mesaId: string, body: PoligonoForm) {
    return this.http.put<PoligonoMesa>(`${this.base}/mesas/${mesaId}/poligono`, body);
  }

  // ── §4.3 Plano y operación ───────────────────────────────────────────────
  plano(tiendaId: string) { return this.http.get<Plano>(`${this.t(tiendaId)}/plano`); }
  urlStream(tiendaId: string) { return `${this.t(tiendaId)}/stream`; }
  cambiarEstado(mesaId: string, estado: EstadoMesa, motivo: string) {
    return this.http.post<void>(`${this.base}/mesas/${mesaId}/estado`, { estado, motivo });
  }
  marcarAtendida(mesaId: string) { return this.http.post<void>(`${this.base}/mesas/${mesaId}/atendida`, {}); }
  marcarLimpia(mesaId: string) { return this.http.post<void>(`${this.base}/mesas/${mesaId}/limpia`, {}); }
  reglas(tiendaId: string) { return this.http.get<Reglas>(`${this.t(tiendaId)}/reglas`); }
  guardarReglas(tiendaId: string, body: Reglas) { return this.http.put<Reglas>(`${this.t(tiendaId)}/reglas`, body); }
  salud(tiendaId: string) { return this.http.get<Salud>(`${this.t(tiendaId)}/salud`); }

  // ── §4.4 Alertas ─────────────────────────────────────────────────────────
  alertas(tiendaId: string, f: FiltroAlertas = {}) {
    let params = new HttpParams();
    if (f.estado) params = params.set('estado', f.estado);
    if (f.desde) params = params.set('desde', f.desde);
    if (f.hasta) params = params.set('hasta', f.hasta);
    return this.http.get<Alerta[]>(`${this.t(tiendaId)}/alertas`, { params });
  }
  atenderAlerta(id: string) { return this.http.post<void>(`${this.base}/alertas/${id}/atender`, {}); }
  falsoPositivo(id: string, motivo: string) { return this.http.post<void>(`${this.base}/alertas/${id}/falso-positivo`, { motivo }); }

  // ── §4.5 Predicción y espera ─────────────────────────────────────────────
  prediccion(tiendaId: string) { return this.http.get<Prediccion[]>(`${this.t(tiendaId)}/prediccion`); }
  espera(tiendaId: string, estado?: EstadoEspera | null) {
    const params = estado ? new HttpParams().set('estado', estado) : undefined;
    return this.http.get<Espera[]>(`${this.t(tiendaId)}/espera`, { params });
  }
  crearEspera(tiendaId: string, body: EsperaForm) { return this.http.post<Espera>(`${this.t(tiendaId)}/espera`, body); }
  avisarEspera(id: string) { return this.http.post<Espera>(`${this.base}/espera/${id}/avisar`, {}); }
  sentarEspera(id: string, mesa_id: string) { return this.http.post<Espera>(`${this.base}/espera/${id}/sentar`, { mesa_id }); }
  cancelarEspera(id: string) { return this.http.post<Espera>(`${this.base}/espera/${id}/cancelar`, {}); }
  noLlegoEspera(id: string) { return this.http.post<Espera>(`${this.base}/espera/${id}/no-llego`, {}); }

  // ── §4.6 Analítica ───────────────────────────────────────────────────────
  analitica(tiendaId: string, desde: string, hasta: string) {
    const params = new HttpParams().set('desde', desde).set('hasta', hasta);
    return this.http.get<Analitica>(`${this.t(tiendaId)}/analitica`, { params });
  }
}

/** Texto corto para un toast a partir de cualquier error HTTP. */
export function mensajeError(e: unknown, porDefecto = 'No se pudo completar la operación'): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'Sin conexión con el servidor.';
    if (e.status === 403) return 'No tienes permiso sobre esta sede.';
    if (e.status === 409) return (e.error?.mensaje ?? e.error?.message) || 'Conflicto: la operación no es válida en este estado.';
    const m = e.error?.mensaje ?? e.error?.message ?? e.error?.error;
    if (typeof m === 'string' && m.trim()) return m;
    return `${porDefecto} (HTTP ${e.status})`;
  }
  return porDefecto;
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import {
  BannerAdmin, BannerItem, BannerPeticion, CatalogoBanners, EventoTipo, MetricasBanner,
  OcurrenciaEvento, Orientacion, PersonaEvento, PlantillaBanner, PuntoSerie, ResultadoSimulacion,
  TipoInteraccion,
} from './carrusel.models';

/**
 * Cliente del carrusel del home (ms-marketing).
 *
 * El feed lo pide CUALQUIER persona con sesión; lo demás es de administración de Marketing
 * y el backend lo corta por rol (403), no esta clase.
 */
@Injectable({ providedIn: 'root' })
export class CarruselService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl.replace(/\/$/, '');
  private readonly base = `${this.api}/api/v1/marketing`;

  /** URL absoluta de un medio (el backend la manda relativa y firmada). */
  urlMedio(relativa: string | null | undefined): string {
    if (!relativa) return '';
    // Absolutas y locales (blob: de la vista previa del editor) van tal cual.
    return /^(https?:|blob:|data:)/i.test(relativa) ? relativa : `${this.api}${relativa}`;
  }

  // ── home ──────────────────────────────────────────────────────────────────

  /** Nunca falla hacia la pantalla: sin carrusel, el home se ve igual que antes. */
  feed(superficie = 'TESORO'): Observable<BannerItem[]> {
    return this.http
      .get<BannerItem[]>(`${this.base}/carrusel`, { params: { superficie } })
      .pipe(catchError(() => of([])));
  }

  /** Telemetría: se dispara y se olvida. */
  interaccion(bannerId: string, tipo: TipoInteraccion): void {
    this.http.post(`${this.base}/carrusel/${bannerId}/interaccion`, { tipo })
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  // ── administración ────────────────────────────────────────────────────────

  catalogo(): Observable<CatalogoBanners> {
    return this.http.get<CatalogoBanners>(`${this.base}/banners/catalogo`);
  }

  listar(estado?: string): Observable<BannerAdmin[]> {
    const params: Record<string, string> = estado ? { estado } : {};
    return this.http.get<BannerAdmin[]>(`${this.base}/banners`, { params });
  }

  detalle(id: string): Observable<BannerAdmin> {
    return this.http.get<BannerAdmin>(`${this.base}/banners/${id}`);
  }

  crear(b: BannerPeticion): Observable<BannerAdmin> {
    return this.http.post<BannerAdmin>(`${this.base}/banners`, b);
  }

  editar(id: string, b: BannerPeticion): Observable<BannerAdmin> {
    return this.http.put<BannerAdmin>(`${this.base}/banners/${id}`, b);
  }

  subirMedio(id: string, orientacion: Orientacion, archivo: File): Observable<BannerAdmin> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    return this.http.post<BannerAdmin>(`${this.base}/banners/${id}/media`, fd, { params: { orientacion } });
  }

  cambiarEstado(id: string, estado: string): Observable<BannerAdmin> {
    return this.http.post<BannerAdmin>(`${this.base}/banners/${id}/estado`, { estado });
  }

  duplicar(id: string): Observable<BannerAdmin> {
    return this.http.post<BannerAdmin>(`${this.base}/banners/${id}/duplicar`, {});
  }

  archivar(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/banners/${id}`);
  }

  reordenar(ids: string[]): Observable<BannerAdmin[]> {
    return this.http.put<BannerAdmin[]>(`${this.base}/banners/prioridades`, { ids });
  }

  metricas(id: string, dias = 30): Observable<{ totales: MetricasBanner; serie: PuntoSerie[] }> {
    return this.http.get<{ totales: MetricasBanner; serie: PuntoSerie[] }>(
      `${this.base}/banners/${id}/metricas`, { params: { dias: String(dias) } });
  }

  simular(req: { usuario_id?: string | null; documento?: string | null; superficie?: string; fecha_hora?: string | null }):
      Observable<ResultadoSimulacion> {
    return this.http.post<ResultadoSimulacion>(`${this.base}/banners/simular`, req);
  }

  plantillas(): Observable<PlantillaBanner[]> {
    return this.http.get<PlantillaBanner[]>(`${this.base}/banners/plantillas`);
  }

  crearPlantilla(p: Partial<PlantillaBanner>): Observable<PlantillaBanner> {
    return this.http.post<PlantillaBanner>(`${this.base}/banners/plantillas`, p);
  }

  editarPlantilla(id: string, p: Partial<PlantillaBanner>): Observable<PlantillaBanner> {
    return this.http.put<PlantillaBanner>(`${this.base}/banners/plantillas/${id}`, p);
  }

  // ── eventos de plataforma ─────────────────────────────────────────────────

  eventos(): Observable<EventoTipo[]> {
    return this.http.get<EventoTipo[]>(`${this.base}/eventos-plataforma/tipos`);
  }

  crearEvento(e: Partial<EventoTipo>): Observable<EventoTipo> {
    return this.http.post<EventoTipo>(`${this.base}/eventos-plataforma/tipos`, e);
  }

  editarEvento(codigo: string, e: Partial<EventoTipo>): Observable<EventoTipo> {
    return this.http.put<EventoTipo>(`${this.base}/eventos-plataforma/tipos/${codigo}`, e);
  }

  ocurrencias(codigo: string): Observable<OcurrenciaEvento[]> {
    return this.http.get<OcurrenciaEvento[]>(`${this.base}/eventos-plataforma/${codigo}/ocurrencias`);
  }

  asignarEvento(req: { codigo: string; personas: PersonaEvento[]; desde?: string | null; hasta?: string | null }):
      Observable<{ creadas: number; omitidas: number; desde: string; hasta: string }> {
    return this.http.post<{ creadas: number; omitidas: number; desde: string; hasta: string }>(
      `${this.base}/eventos-plataforma/asignar`, req);
  }

  quitarOcurrencia(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/eventos-plataforma/ocurrencias/${id}`);
  }
}

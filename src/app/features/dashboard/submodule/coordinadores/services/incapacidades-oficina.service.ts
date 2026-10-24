import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { environment } from '@/environments/environment';
import { inicioDeMes } from './coordinadores-formularios.service';

/**
 * KPIs de incapacidades para el inicio de Coordinadores, YA recortados por la oficina del
 * usuario (el recorte lo hace ms-hr con el JWT — AlcanceIncapacidades —, nunca el cliente).
 *
 * Es una interfaz propia a propósito: el inicio no debe depender del modelo del módulo
 * Incapacidades (otra sesión lo está cambiando) ni de cuál de los dos endpoints exista.
 */
export interface KpisIncapacidadesOficina {
  fuente: 'inicio' | 'resumen';
  /** "Viendo: la oficina SUBA" (solo con /inicio). */
  alcance: string | null;
  /** Total del periodo por defecto de /inicio, o histórico total con /resumen. */
  total: number;
  activasHoy: number | null;
  delMes: number | null;
  mesAnterior: number | null;
  variacionMesPct: number | null;
  sinSoporte: number | null;
  porEstado: { clave: string; etiqueta: string; cantidad: number }[];
}

/** Serie {clave, etiqueta, cantidad} de ms-hr. */
interface SerieHr { clave: string; etiqueta?: string | null; cantidad: number }

/** Lo que usamos de GET /Incapacidades/v2/inicio (InicioIncapacidadesResponse). */
interface InicioHr {
  alcance?: { restringido: boolean; etiqueta?: string | null; texto?: string | null } | null;
  kpis?: {
    total: number;
    activasHoy?: number | null;
    mesActual?: { cantidad: number } | null;
    mesAnterior?: { cantidad: number } | null;
    variacionMesPct?: number | null;
    sinSoporte?: number | null;
    porEstado?: SerieHr[] | null;
  } | null;
}

/** Lo que usamos de GET /Incapacidades/v2/resumen (ResumenIncapacidadesResponse). */
interface ResumenHr {
  total: number;
  porEstado?: Record<string, number> | null;
  sinSoportes?: number | null;
}

/** Etiquetas de EstadoIncapacidad (ms-hr) para el respaldo /resumen, que solo trae claves. */
const ETIQUETA_ESTADO: Record<string, string> = {
  RECIBIDA: 'Recibida',
  VALIDADA: 'Validada',
  PENDIENTE_RADICACION: 'Pendiente de radicación',
  RADICADA: 'Radicada',
  EN_REVISION_EPS: 'En revisión por la EPS',
  PAGADA: 'Pagada',
  NEGADA: 'Negada',
  RECOBRO: 'En recobro',
  NUEVA_RESPUESTA: 'Nueva respuesta',
  PENDIENTE_CONCILIACION: 'Pendiente de conciliación',
  CONCILIADA: 'Conciliada',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
};

@Injectable({ providedIn: 'root' })
export class IncapacidadesOficinaService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/Incapacidades/v2`;

  /**
   * Intenta `/inicio` (2026-10-23); si no existe todavía en el ms-hr desplegado o falla,
   * cae a `/resumen` (total + del mes por fecha de registro). null = sin acceso o sin
   * servicio: el bloque se oculta.
   */
  kpis(): Observable<KpisIncapacidadesOficina | null> {
    return this.http.get<InicioHr>(`${this.base}/inicio`).pipe(
      map((r) => (r?.kpis ? this.desdeInicio(r) : null)),
      catchError(() => of(null)),
      switchMap((k) => (k ? of(k) : this.desdeResumen())),
    );
  }

  private desdeInicio(r: InicioHr): KpisIncapacidadesOficina {
    const k = r.kpis!;
    return {
      fuente: 'inicio',
      alcance: r.alcance?.texto ?? null,
      total: Number(k.total) || 0,
      activasHoy: k.activasHoy ?? null,
      delMes: k.mesActual?.cantidad ?? null,
      mesAnterior: k.mesAnterior?.cantidad ?? null,
      variacionMesPct: k.variacionMesPct ?? null,
      sinSoporte: k.sinSoporte ?? null,
      porEstado: (k.porEstado ?? [])
        .filter((s) => Number(s.cantidad) > 0)
        .map((s) => ({
          clave: s.clave,
          etiqueta: s.etiqueta || ETIQUETA_ESTADO[s.clave] || s.clave,
          cantidad: Number(s.cantidad) || 0,
        })),
    };
  }

  private desdeResumen(): Observable<KpisIncapacidadesOficina | null> {
    const mes = new HttpParams().set('registradoDesde', inicioDeMes());
    return forkJoin({
      todo: this.http.get<ResumenHr>(`${this.base}/resumen`),
      mes: this.http.get<ResumenHr>(`${this.base}/resumen`, { params: mes }).pipe(catchError(() => of(null))),
    }).pipe(
      map(({ todo, mes: delMes }) => ({
        fuente: 'resumen' as const,
        alcance: null,
        total: Number(todo?.total) || 0,
        activasHoy: null,
        delMes: delMes ? Number(delMes.total) || 0 : null,
        mesAnterior: null,
        variacionMesPct: null,
        sinSoporte: todo?.sinSoportes ?? null,
        porEstado: Object.entries(todo?.porEstado ?? {})
          .filter(([, n]) => Number(n) > 0)
          .map(([clave, n]) => ({ clave, etiqueta: ETIQUETA_ESTADO[clave] ?? clave, cantidad: Number(n) || 0 }))
          .sort((a, b) => b.cantidad - a.cantidad),
      })),
      catchError(() => of(null)),
    );
  }
}

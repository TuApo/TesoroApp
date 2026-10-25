import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import { normalizarBusqueda } from '../../shared/busqueda-vacantes.util';

/**
 * ABREVIATURA DE UNA VACANTE = código de costo de su centro (AR2INV, PRIPOM…).
 *
 * La publicación no lo trae: solo guarda la finca (texto libre) y, las del
 * parametrizador, `configuracion_centro_cargo_id`. Aquí se cruza:
 *   1. configuración → centro → ccostos (exacto, vacantes nuevas);
 *   2. si no hay configuración, por el nombre de la finca, y solo cuando esa
 *      finca tiene UN código real. Si tiene varios (JARDINES DE COLOMBIA tiene
 *      siete) no se adivina: sale sin abreviatura.
 * Los códigos de relleno `CC<id>` (V75) y los que son una razón social pegada
 * en la columna no son abreviaturas y no se muestran.
 *
 * Los dos maestros se piden una vez por sesión: son ~1.000 filas cada uno.
 */
export type ResolverCodigoCentro = (v: any) => string | null;

@Injectable({ providedIn: 'root' })
export class CodigoCentroVacanteService {
  private http = inject(HttpClient);
  private base = environment.apiUrl.replace(/\/$/, '');
  private maestros$?: Observable<[any[], any[]]>;
  private cache$?: Observable<ResolverCodigoCentro>;
  private telefono$?: Observable<ResolverCodigoCentro>;

  /** Centros y configuraciones, una vez por sesión (los comparten los dos resolvers). */
  private maestros(): Observable<[any[], any[]]> {
    if (!this.maestros$) {
      const centros$ = this.http.get<any>(`${this.base}/gestion_centros_costos/`).pipe(
        map((r) => (Array.isArray(r) ? r : r?.results ?? [])),
        catchError(() => of([] as any[])),
      );
      const configs$ = this.http
        .get<any[]>(`${this.base}/api/v1/admin/parametrizacion/vacantes/configuraciones`)
        .pipe(catchError(() => of([] as any[])));

      this.maestros$ = forkJoin([centros$, configs$]).pipe(
        map(([centros, configs]) => {
          // Sin maestro de centros no se cachea: se reintenta al volver.
          if (!centros.length) this.maestros$ = this.cache$ = this.telefono$ = undefined;
          return [centros, Array.isArray(configs) ? configs : []] as [any[], any[]];
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.maestros$;
  }

  resolver(): Observable<ResolverCodigoCentro> {
    if (!this.cache$) {
      this.cache$ = this.maestros().pipe(
        map(([centros, configs]) => construirResolver(centros, configs)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.cache$;
  }

  /**
   * Teléfono del GESTOR del centro de costo de la vacante (`telefono_gestor`),
   * el que va en "Contacto Coordinador de la Temporal" del carnet.
   */
  resolverTelefonoGestor(): Observable<ResolverCodigoCentro> {
    if (!this.telefono$) {
      this.telefono$ = this.maestros().pipe(
        map(([centros, configs]) => construirResolverTelefonoGestor(centros, configs)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.telefono$;
  }
}

/**
 * Mismo cruce que `construirResolver`, pero para el teléfono del gestor:
 *   1. configuración → centro → telefono_gestor (exacto);
 *   2. por finca: primero entre los centros canónicos (habilitados para
 *      vacantes) y, si no hay, entre todos; solo si esa finca tiene UN teléfono.
 *      Si tiene varios no se adivina: null (el carnet cae al fijo).
 */
export function construirResolverTelefonoGestor(centros: any[], configs: any[]): ResolverCodigoCentro {
  const tel = (c: any) => String(c?.telefono_gestor ?? c?.telefonoGestor ?? '').trim();
  const telPorCentro = new Map<number, string>();
  const canonicos = new Map<string, Set<string>>();
  const todos = new Map<string, Set<string>>();
  const agregar = (m: Map<string, Set<string>>, k: string, v: string) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(v);
  };

  for (const c of centros) {
    const t = tel(c);
    if (!t) continue;
    const id = Number(c?.id);
    if (Number.isFinite(id)) telPorCentro.set(id, t);
    const finca = normalizarBusqueda(c?.finca).trim();
    if (!finca) continue;
    agregar(todos, finca, t);
    if (c?.habilitado_vacantes === true || c?.habilitadoVacantes === true) agregar(canonicos, finca, t);
  }

  const centroPorConfig = new Map<number, number>();
  for (const k of configs) {
    const id = Number(k?.id);
    const centro = Number(k?.centro_costo_id ?? k?.centroCostoId);
    if (Number.isFinite(id) && Number.isFinite(centro)) centroPorConfig.set(id, centro);
  }

  return (v: any) => {
    const cfg = Number(v?.configuracion_centro_cargo_id ?? v?.configuracionCentroCargoId);
    if (Number.isFinite(cfg) && cfg > 0) {
      const centro = centroPorConfig.get(cfg);
      const t = centro != null ? telPorCentro.get(centro) : undefined;
      if (t) return t;
    }
    const finca = normalizarBusqueda(v?.finca).trim();
    if (!finca) return null;
    const set = canonicos.get(finca) ?? todos.get(finca);
    return set && set.size === 1 ? [...set][0] : null;
  };
}

/** Una abreviatura de verdad: corta, sin espacios y que no sea el relleno `CC<id>`. */
export function esCodigoReal(c: unknown): boolean {
  const s = String(c ?? '').trim().toUpperCase();
  return /^[A-Z0-9_-]{2,12}$/.test(s) && !/^CC\d+$/.test(s);
}

export function construirResolver(centros: any[], configs: any[]): ResolverCodigoCentro {
  const codigoPorCentro = new Map<number, string>();
  const codigosPorFinca = new Map<string, Set<string>>();

  for (const c of centros) {
    const cod = String(c?.ccostos ?? c?.Ccostos ?? '').trim().toUpperCase();
    if (!esCodigoReal(cod)) continue;
    const id = Number(c?.id);
    if (Number.isFinite(id)) codigoPorCentro.set(id, cod);
    const finca = normalizarBusqueda(c?.finca).trim();
    if (!finca) continue;
    if (!codigosPorFinca.has(finca)) codigosPorFinca.set(finca, new Set());
    codigosPorFinca.get(finca)!.add(cod);
  }

  const centroPorConfig = new Map<number, number>();
  for (const k of configs) {
    const id = Number(k?.id);
    const centro = Number(k?.centro_costo_id ?? k?.centroCostoId);
    if (Number.isFinite(id) && Number.isFinite(centro)) centroPorConfig.set(id, centro);
  }

  return (v: any) => {
    const cfg = Number(v?.configuracion_centro_cargo_id ?? v?.configuracionCentroCargoId);
    if (Number.isFinite(cfg) && cfg > 0) {
      const centro = centroPorConfig.get(cfg);
      const cod = centro != null ? codigoPorCentro.get(centro) : undefined;
      if (cod) return cod;
    }
    const set = codigosPorFinca.get(normalizarBusqueda(v?.finca).trim());
    return set && set.size === 1 ? [...set][0] : null;
  };
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { NetworkStatusService } from './network-status.service';
import { PermissionsService } from './permissions.service';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/safe-storage';
import {
  CatalogEndpoint,
  META_TABLAS_PATH,
  MODULE_CATALOGS,
  metaValoresPath,
} from '../utils/catalog-endpoints';

export interface CatalogPreloadProgress {
  current: number;
  total: number;
  /** Qué se está bajando ahora mismo, para mostrarlo en el diálogo. */
  label: string;
}

export interface CatalogPreloadResult {
  ok: number;
  fallidos: number;
  total: number;
  /** Motivo por el que no se hizo nada (null si sí corrió). */
  omitido: string | null;
}

/** Descriptor interno: URL absoluta + etiqueta para el progreso. */
interface Objetivo {
  url: string;
  label: string;
}

/** Semillas que además figuran en MODULE_CATALOGS (se piden una sola vez). */
const SEMILLA_LEGAL = '/legal/catalogos/tipos';
const SEMILLA_ORIGENES = '/api/dynamic-forms/option-sources?include_inactive=false';
const SEMILLA_ORGANIZACIONES = '/api/nomina/organizaciones/';

/**
 * Precarga TODA la parametrización (catálogos / tablas maestras) para que los
 * módulos funcionen sin conexión.
 *
 * El caché offline es reactivo: guarda lo que el usuario ya pidió. Eso basta
 * para los datos de trabajo, pero no para los catálogos — un formulario que
 * nunca se abrió en línea aparece sin tipos de documento, sin sedes y sin
 * cargos, y no se puede ni diligenciar. Aquí se bajan todos de una, aunque
 * nadie haya entrado a la pantalla.
 *
 * Qué se baja (ver `catalog-endpoints.ts`):
 *   · Tablas parametrizadas genéricas: se DESCUBREN llamando a
 *     /gestion_catalogos/meta/tablas/ y se baja el valor de cada una. Así una
 *     tabla nueva creada en "Gestión de Parametrización" queda disponible
 *     offline sin tocar el frontend.
 *   · Catálogos propios de cada módulo (nómina, jurídico, salud, documental…).
 *   · Derivados que dependen de un padre: estados/checklist por tipo de
 *     proceso jurídico, y opciones de cada origen de Formularios Dinámicos.
 *
 * Cada GET pasa por el offlineInterceptor, que es quien guarda la respuesta en
 * el caché local con la misma clave que usará la pantalla al pedirla sin
 * conexión.
 */
@Injectable({ providedIn: 'root' })
export class CatalogPreloadService {
  private readonly http = inject(HttpClient);
  private readonly networkService = inject(NetworkStatusService);
  private readonly permissions = inject(PermissionsService);

  private readonly apiBase = (environment.apiUrl || '').replace(/\/$/, '');
  private preloading = false;

  /** Progreso en vivo mientras corre; null en reposo. */
  public readonly progress$ = new BehaviorSubject<CatalogPreloadProgress | null>(null);
  /** ISO de la última precarga completada (persistida entre sesiones). */
  public readonly lastRun$ = new BehaviorSubject<string | null>(null);

  private static readonly LAST_RUN_KEY = 'catalogPreload:lastRun';
  /** La parametrización cambia poco: se refresca como mucho cada 6 h. */
  private static readonly TTL_MS = 6 * 60 * 60 * 1000;
  /** Mismo ritmo que refreshCache(): 3 peticiones cada 150 ms ≈ 20 req/s,
   *  por debajo del límite de 50 req/s por usuario del gateway. */
  private static readonly LOTE = 3;
  private static readonly PAUSA_MS = 150;
  private static readonly PAUSA_TRAS_429_MS = 3000;
  /** Margen para que syncQueue() y refreshCache() vayan primero al reconectar. */
  private static readonly RETRASO_ARRANQUE_MS = 8000;

  constructor() {
    this.lastRun$.next(getLocalStorageItem(CatalogPreloadService.LAST_RUN_KEY));

    this.networkService.isOnline$.subscribe(isOnline => {
      if (!isOnline) return;
      setTimeout(() => { void this.preload(); }, CatalogPreloadService.RETRASO_ARRANQUE_MS);
    });
  }

  /** True si la última precarga es lo bastante reciente como para no repetirla. */
  get estaAlDia(): boolean {
    const last = this.lastRun$.value;
    if (!last) return false;
    const t = new Date(last).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() - t < CatalogPreloadService.TTL_MS;
  }

  /**
   * Fuerza la precarga ignorando el TTL. Es lo que dispara el botón
   * "Actualizar parametrización" del diálogo de sincronización.
   */
  public preloadNow(): Promise<CatalogPreloadResult> {
    return this.preload({ force: true });
  }

  public async preload({ force = false }: { force?: boolean } = {}): Promise<CatalogPreloadResult> {
    const vacio = (omitido: string | null): CatalogPreloadResult =>
      ({ ok: 0, fallidos: 0, total: 0, omitido });

    if (this.preloading) return vacio('ya en curso');
    if (!this.networkService.isOnline) return vacio('sin conexión');
    if (!this.haySesion()) return vacio('sin sesión');
    if (!force && this.estaAlDia) return vacio('al día');

    this.preloading = true;
    let ok = 0;
    let fallidos = 0;

    try {
      const hayLegal = this.permiteRuta('/dashboard/gestion-legal');
      const hayNomina = this.permiteRuta('/dashboard/nomina');

      // Fase 1 — semillas: los listados de los que salen más URLs. Se piden
      // primero porque sin ellos no se sabe qué tablas, qué tipos de proceso,
      // qué orígenes de opciones ni qué empresas existen.
      const [tablas, tiposLegales, origenes, organizaciones] = await Promise.all([
        this.pedirJson<any[]>(META_TABLAS_PATH),
        hayLegal ? this.pedirJson<any[]>(SEMILLA_LEGAL) : Promise.resolve(null),
        this.pedirJson<any[]>(SEMILLA_ORIGENES),
        hayNomina ? this.pedirJson<any[]>(SEMILLA_ORGANIZACIONES) : Promise.resolve(null),
      ]);

      // Las semillas también quedan cacheadas: cuentan en el resumen.
      const semillas = [
        { datos: tablas, pedida: true },
        { datos: tiposLegales, pedida: hayLegal },
        { datos: origenes, pedida: true },
        { datos: organizaciones, pedida: hayNomina },
      ].filter(s => s.pedida);
      ok += semillas.filter(s => s.datos !== null).length;
      fallidos += semillas.filter(s => s.datos === null).length;

      // Fase 2 — catálogos fijos permitidos + todo lo derivado de las semillas.
      const objetivos: Objetivo[] = [
        ...this.permitidos().map(c => ({ url: this.abs(c.path), label: c.label })),
        ...this.objetivosMeta(tablas),
        ...this.objetivosLegales(tiposLegales),
        ...this.objetivosOrigenes(origenes),
        ...this.objetivosCentrosCosto(organizaciones),
      ];

      // Las semillas ya se bajaron: no se repiten.
      const yaPedidas = new Set(
        [META_TABLAS_PATH, SEMILLA_LEGAL, SEMILLA_ORIGENES, SEMILLA_ORGANIZACIONES].map(p => this.abs(p))
      );
      const pendientes = this.deduplicar(objetivos).filter(o => !yaPedidas.has(o.url));

      console.log(`[Catálogos] Precargando ${pendientes.length} catálogo(s) para uso sin conexión…`);
      const res = await this.bajarTodos(pendientes);
      ok += res.ok;
      fallidos += res.fallidos;

      // El sello de "al día" solo se pone si se recorrió TODA la lista. Si se
      // cortó a mitad por perder la conexión, el TTL dejaría el equipo seis
      // horas con media parametrización creyendo que está completa.
      if (res.completo) {
        const iso = new Date().toISOString();
        setLocalStorageItem(CatalogPreloadService.LAST_RUN_KEY, iso);
        this.lastRun$.next(iso);
      }

      console.log(`[Catálogos] Precarga ${res.completo ? 'completada' : 'interrumpida'}: `
        + `${ok} ok, ${fallidos} sin bajar.`);
      return { ok, fallidos, total: semillas.length + pendientes.length, omitido: null };
    } catch (e) {
      console.warn('[Catálogos] Error en la precarga de parametrización:', e);
      return { ok, fallidos, total: ok + fallidos, omitido: null };
    } finally {
      this.preloading = false;
      this.progress$.next(null);
    }
  }

  // ── Construcción de objetivos ────────────────────────────────────────────

  /** Catálogos fijos que el usuario actual puede leer. */
  private permitidos(): CatalogEndpoint[] {
    return MODULE_CATALOGS.filter(c => this.permiteRuta(c.ruta));
  }

  /**
   * Una entrada por cada tabla parametrizada existente. Se descubren en
   * caliente: lo que haya en meta_tablas se precarga, sin lista fija.
   */
  private objetivosMeta(tablas: any[] | null): Objetivo[] {
    if (!Array.isArray(tablas)) return [];
    return tablas
      .filter(t => t?.codigo && t?.activo !== false)
      .map(t => ({
        url: this.abs(metaValoresPath(String(t.codigo))),
        label: String(t.codigo).replace(/_/g, ' '),
      }));
  }

  /** Estados y checklist dependen del tipo de proceso: uno por tipo. */
  private objetivosLegales(tipos: any[] | null): Objetivo[] {
    if (!Array.isArray(tipos)) return [];
    return tipos
      .filter(t => t?.id != null)
      .flatMap(t => [
        { url: this.abs(`/legal/catalogos/estados?tipoId=${t.id}`), label: `Estados: ${t.nombre ?? t.id}` },
        { url: this.abs(`/legal/catalogos/checklist?tipoId=${t.id}`), label: `Checklist: ${t.nombre ?? t.id}` },
      ]);
  }

  /**
   * Opciones ya resueltas de cada origen de Formularios Dinámicos. Solo los
   * que NO cuelgan de otro: en una cascada las opciones del hijo dependen del
   * valor que elija el usuario en el padre y no se pueden precargar todas.
   */
  private objetivosOrigenes(origenes: any[] | null): Objetivo[] {
    if (!Array.isArray(origenes)) return [];
    return origenes
      .filter(o => o?.code && o?.active !== false && o?.parent_source_id == null)
      .map(o => ({
        url: this.abs(`/api/dynamic-forms/option-sources/${encodeURIComponent(String(o.code))}/options`),
        label: `Opciones: ${o.name ?? o.code}`,
      }));
  }

  /**
   * Centros de costo por empresa. Las pantallas de nómina piden
   * `?id_cliente=N` en cuanto el usuario elige la empresa, así que se precarga
   * uno por organización en vez de solo la lista completa.
   */
  private objetivosCentrosCosto(organizaciones: any[] | null): Objetivo[] {
    if (!Array.isArray(organizaciones)) return [];
    return organizaciones
      .map(o => o?.id_entidad ?? o?.id_org)
      .filter(id => id != null)
      .map(id => ({
        url: this.abs(`/api/nomina/centros-costos/?id_cliente=${id}`),
        label: `Centros de costo (empresa ${id})`,
      }));
  }

  private deduplicar(objetivos: Objetivo[]): Objetivo[] {
    const vistos = new Set<string>();
    return objetivos.filter(o => {
      if (vistos.has(o.url)) return false;
      vistos.add(o.url);
      return true;
    });
  }

  // ── Descarga ─────────────────────────────────────────────────────────────

  /**
   * Baja los objetivos en tandas cortas con pausa entre ellas. Un catálogo que
   * falle (permiso, endpoint caído) no aborta el resto: se cuenta y se sigue.
   */
  private async bajarTodos(
    objetivos: Objetivo[],
  ): Promise<{ ok: number; fallidos: number; completo: boolean }> {
    const { LOTE, PAUSA_MS, PAUSA_TRAS_429_MS } = CatalogPreloadService;
    const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const total = objetivos.length;
    let ok = 0;
    let fallidos = 0;
    let completo = true;

    for (let i = 0; i < objetivos.length; i += LOTE) {
      if (!this.networkService.isOnline) {
        console.warn('[Catálogos] Conexión perdida durante la precarga. Se retoma al reconectar.');
        completo = false;
        break;
      }

      const tanda = objetivos.slice(i, i + LOTE);
      this.progress$.next({ current: i + 1, total, label: tanda[0].label });

      const resultados = await Promise.all(
        tanda.map(o =>
          firstValueFrom(this.http.get(o.url))
            .then(() => ({ ok: true, status: 200 }))
            // El status se conserva para distinguir "no se pudo" de "me están
            // limitando", que exigen reacciones distintas.
            .catch((e: any) => ({ ok: false, status: e?.status ?? 0 }))
        )
      );

      ok += resultados.filter(r => r.ok).length;
      fallidos += resultados.filter(r => !r.ok).length;

      if (resultados.some(r => r.status === 429)) {
        await esperar(PAUSA_TRAS_429_MS);
      } else if (i + LOTE < objetivos.length) {
        await esperar(PAUSA_MS);
      }
    }

    return { ok, fallidos, completo };
  }

  /** GET suelto que devuelve null en vez de reventar (las semillas son opcionales). */
  private pedirJson<T>(path: string): Promise<T | null> {
    return firstValueFrom(this.http.get<T>(this.abs(path))).catch(() => null);
  }

  // ── Utilidades ───────────────────────────────────────────────────────────

  private abs(path: string): string {
    return `${this.apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /** Sin `ruta` declarada = transversal. Con ruta, manda el árbol de permisos. */
  private permiteRuta(ruta?: string): boolean {
    if (!ruta) return true;
    return this.permissions.canReadRoute(ruta);
  }

  private haySesion(): boolean {
    return !!getLocalStorageItem('user') && !!getLocalStorageItem('token');
  }
}

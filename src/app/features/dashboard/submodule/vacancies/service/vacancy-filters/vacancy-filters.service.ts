import { Injectable, inject, signal } from '@angular/core';

import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { SedeScopeService } from '../../../../../../shared/services/sede-scope/sede-scope.service';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import {
  OpcionesFiltro,
  VacancyFilters,
  VacanteRow,
  ViewMode,
  aFecha,
  normalizarTexto,
  soloFecha,
} from '../../models/vacante.model';

/**
 * Estado y reglas de filtrado del submódulo Vacantes.
 *
 * Antes vivía dentro de la pantalla única. Al partirla en "Listado" e
 * "Indicadores" había dos salidas: duplicar las reglas (y arriesgar que la
 * tabla y los KPIs dejaran de cuadrar) o subirlas a un sitio común. Es esto.
 *
 * El estado es COMPARTIDO a propósito: filtrar por una oficina en el listado y
 * pasar a indicadores conserva el filtro, que es lo que se espera al analizar
 * lo que se acaba de mirar.
 *
 * `filtros` se deja como objeto mutable —y no como signal— para que los
 * `[(ngModel)]` de la plantilla sigan funcionando igual que antes. Quien lo
 * cambia llama a `notificar()`, y las pantallas recalculan leyendo la señal
 * `cambios` dentro de un `computed`.
 */
@Injectable({ providedIn: 'root' })
export class VacancyFiltersService {
  private readonly util = inject(UtilityServiceService);
  private readonly sedeScope = inject(SedeScopeService);

  /** Criterios activos. Mutable: lo escriben los `[(ngModel)]` del panel. */
  readonly filtros: VacancyFilters = {
    oficina: '',
    finca: '',
    empresa: '',
    cargo: '',
    municipio: '',
    tipo: '',
    antiguedad: 0,
    desde: null,
    hasta: null,
  };

  /** Pestaña activa (Todos / Faltantes / Completados / Inactivas). */
  viewMode: ViewMode = 'table';
  /** Panel de filtros desplegado. */
  filtrosAbiertos = true;

  // ── Alcance por sede (multi-sede V62) ──
  sede = '';
  sedesAlcance: string[] = [];
  /** true si su rol no se recorta por sede (ADMIN/GERENCIA). */
  sinLimiteSede = false;
  /** true si puede elegir oficina en el desplegable. */
  puedeElegirOficina = false;
  /**
   * Catálogo de oficinas para el selector.
   *
   * Señal propia y no parte de `cambios`: llenar el desplegable NO cambia el
   * universo filtrado, y bumpear `cambios` recalcularía `visibleRows` (array
   * nuevo → la tabla pierde página y selección) sin motivo.
   */
  private readonly _oficinas = signal<string[]>([]);
  readonly oficinas = this._oficinas.asReadonly();

  /** ADMIN/GERENCIA: habilita eliminar en el listado. */
  permitido = false;

  /** Se incrementa en cada cambio; es la dependencia de los `computed`. */
  private readonly _cambios = signal(0);
  readonly cambios = this._cambios.asReadonly();

  private iniciado = false;

  /**
   * Lee usuario, sede y preferencias guardadas. Idempotente: las dos pantallas
   * la llaman en su `ngOnInit` y solo la primera hace trabajo.
   */
  init(): void {
    if (this.iniciado) return;
    this.iniciado = true;

    const saved =
      typeof window !== 'undefined'
        ? (getLocalStorageItem('vacantes:viewMode') as ViewMode | null)
        : null;
    if (saved) this.viewMode = saved;

    const user = this.util.getUser();
    this.sede = this.sedeScope.activa() || user?.sede?.nombre || '';
    this.permitido = this.isManager(user);
    this.sinLimiteSede = this.sedeScope.sinLimite();
    this.sedesAlcance = this.sedeScope.nombres();
    // Multi-sede (V62): el selector de oficina se abre para quien no se recorta por
    // sede (Gerencia/Admin) Y para quien tiene varias asignadas; con una sola el
    // filtro queda anclado, igual que antes de existir el multi-sede.
    this.puedeElegirOficina = this.sedeScope.puedeElegirOficina();

    if (this.puedeElegirOficina) {
      // "" = todas las oficinas de su alcance (todo el catálogo si no se recorta).
      const guardada = typeof window !== 'undefined' ? getLocalStorageItem('vacantes:oficina') : null;
      this.filtros.oficina = guardada && this.sedeScope.alcanza(guardada) ? guardada : '';
      this.cargarOficinas();
    } else {
      this.filtros.oficina = this.sede;
    }
  }

  /** Catálogo de sedes para el selector (cacheado en el utility service). */
  private cargarOficinas(): void {
    this.util.traerSucursales().subscribe({
      next: (data: any) => {
        const arr = Array.isArray(data) ? data : (data?.results ?? []);
        const catalogo = arr
          .filter((s: any) => s?.activa !== false)
          .map((s: any) => String(s?.nombre ?? '').trim())
          .filter((n: string) => !!n)
          .sort((a: string, b: string) => a.localeCompare(b));
        // Quien se recorta por sede solo puede elegir entre las suyas.
        const propias = this.sedeScope.opciones(catalogo);
        this._oficinas.set(propias);

        // La oficina recordada puede haberse borrado del catálogo: si ya no
        // existe, el selector saldría en blanco filtrando por un nombre muerto.
        // Solo en ese caso cambia lo que se ve, y solo ahí se notifica.
        if (this.filtros.oficina && !propias.includes(this.filtros.oficina)) {
          this.filtros.oficina = '';
          try { setLocalStorageItem('vacantes:oficina', ''); } catch { }
          this.notificar();
        }
      },
      error: () => { },
    });
  }

  // ================== Mutaciones ==================

  /** Avisa a las pantallas de que hay que repintar. */
  notificar(): void {
    this._cambios.update((n) => n + 1);
  }

  /**
   * Cambia de pestaña y lo recuerda.
   * Devuelve true si hay que pedir OTRO conjunto al backend (activas ↔ inactivas).
   */
  setViewMode(mode: ViewMode): boolean {
    const cruzaLimite = (mode === 'inactivas') !== (this.viewMode === 'inactivas');
    this.viewMode = mode;
    try { setLocalStorageItem('vacantes:viewMode', mode); } catch { }
    this.notificar();
    return cruzaLimite;
  }

  /** true cuando la pestaña activa pide el conjunto de inactivas. */
  get pideInactivas(): boolean {
    return this.viewMode === 'inactivas';
  }

  onOficinaChange(): void {
    // Al cambiar de oficina los desplegables cambian de universo: lo que ya no
    // exista se queda "colgado" filtrando de más, así que se limpian.
    this.filtros.finca = '';
    this.filtros.empresa = '';
    this.filtros.cargo = '';
    this.filtros.municipio = '';
    this.filtros.tipo = '';
    try { setLocalStorageItem('vacantes:oficina', this.filtros.oficina); } catch { }
    this.notificar();
  }

  limpiarFiltros(): void {
    this.filtros.oficina = this.puedeElegirOficina ? '' : this.sede;
    this.filtros.finca = '';
    this.filtros.empresa = '';
    this.filtros.cargo = '';
    this.filtros.municipio = '';
    this.filtros.tipo = '';
    this.filtros.antiguedad = 0;
    this.filtros.desde = null;
    this.filtros.hasta = null;
    if (this.puedeElegirOficina) {
      try { setLocalStorageItem('vacantes:oficina', ''); } catch { }
    }
    this.notificar();
  }

  toggleFiltros(): void {
    // Sin `notificar()`: es estado visual del panel, no acota nada. Notificar
    // aquí recalculaba `visibleRows` y la tabla perdía página y selección solo
    // por plegar los filtros.
    this.filtrosAbiertos = !this.filtrosAbiertos;
  }

  /**
   * Vuelve al estado de recién entrado. Lo llama el shell al SALIR del módulo.
   *
   * El servicio es de raíz para que las dos pantallas compartan filtros, pero
   * eso los haría sobrevivir a irse de Vacantes y volver, que no es lo que
   * hacía la pantalla única (se recreaba con filtros vacíos). Oficina y pestaña
   * no se pierden de verdad: `init()` las vuelve a leer de localStorage.
   */
  reiniciar(): void {
    this.iniciado = false;
    this.filtros.oficina = '';
    this.filtros.finca = '';
    this.filtros.empresa = '';
    this.filtros.cargo = '';
    this.filtros.municipio = '';
    this.filtros.tipo = '';
    this.filtros.antiguedad = 0;
    this.filtros.desde = null;
    this.filtros.hasta = null;
    this._oficinas.set([]);
    this.notificar();
  }

  get filtrosActivos(): number {
    const f = this.filtros;
    let n = 0;
    if (this.puedeElegirOficina && f.oficina) n++;
    if (f.finca) n++;
    if (f.empresa) n++;
    if (f.cargo) n++;
    if (f.municipio) n++;
    if (f.tipo) n++;
    if (f.antiguedad > 0) n++;
    if (f.desde) n++;
    if (f.hasta) n++;
    return n;
  }

  // ================== Reglas de filtrado ==================

  /**
   * Recalcula lo que se ve: primero la pestaña (Todos / Faltantes /
   * Completados / Inactivas) y encima los filtros de la cabecera. Es LA función
   * que comparten tabla e indicadores, así los dos cuentan siempre lo mismo.
   */
  aplicar(rows: readonly VacanteRow[]): VacanteRow[] {
    const base = this.porVista(rows ?? []);
    return this.aplicarFiltros(base);
  }

  /** Recorte por pestaña. */
  private porVista(rows: readonly VacanteRow[]): VacanteRow[] {
    if (this.viewMode === 'inactivas') {
      return rows.filter((r) => r.activo === false);
    }
    const activas = rows.filter((r) => r.activo !== false);
    if (this.viewMode === 'faltantes') {
      return activas.filter((r) => (Number(r?.falt) || 0) > 0);
    }
    if (this.viewMode === 'completados') {
      return activas.filter((r) => (Number(r?.req) || 0) > 0 && (Number(r?.falt) || 0) === 0);
    }
    return activas;
  }

  /** Aplica los filtros de la cabecera sobre un conjunto ya acotado por vista. */
  private aplicarFiltros(rows: VacanteRow[]): VacanteRow[] {
    const f = this.filtros;
    const desde = soloFecha(f.desde);
    const hasta = soloFecha(f.hasta);

    return rows.filter((r) => {
      // "Todas las oficinas" significa todas las SUYAS: sin este recorte, alguien
      // con varias sedes vería también las vacantes de las oficinas ajenas.
      if (!this.dentroDelAlcance(r)) return false;
      if (f.oficina && !this.matchesSede(r, f.oficina)) return false;
      if (f.finca && normalizarTexto(r?.finca) !== normalizarTexto(f.finca)) return false;
      if (f.empresa && normalizarTexto(r?.empresa_usuaria_solicita) !== normalizarTexto(f.empresa)) return false;
      if (f.cargo && normalizarTexto(r?.cargo) !== normalizarTexto(f.cargo)) return false;
      if (f.tipo && normalizarTexto(r?.tipo_contratacion) !== normalizarTexto(f.tipo)) return false;

      if (f.municipio) {
        const arr = Array.isArray(r?.municipio) ? r.municipio : [];
        if (!arr.some((m: any) => normalizarTexto(m) === normalizarTexto(f.municipio))) return false;
      }

      if (desde || hasta) {
        const pub = aFecha(r?.fecha_publicado);
        if (!pub) return false;
        if (desde && pub.getTime() < desde.getTime()) return false;
        if (hasta && pub.getTime() > hasta.getTime()) return false;
      }

      if (f.antiguedad > 0) {
        const dias = this.diasPublicada(r);
        if (dias === null || dias < f.antiguedad) return false;
      }

      return true;
    });
  }

  /** Los desplegables listan sólo lo que existe dentro de la oficina elegida. */
  opciones(rows: readonly VacanteRow[]): OpcionesFiltro {
    const base = (rows ?? []).filter(
      (r) => this.dentroDelAlcance(r)
        && (!this.filtros.oficina || this.matchesSede(r, this.filtros.oficina)),
    );

    const municipios = new Set<string>();
    for (const r of base) {
      const arr = Array.isArray(r?.municipio) ? r.municipio : [];
      for (const m of arr) {
        const t = String(m ?? '').trim();
        if (t) municipios.add(t);
      }
    }

    return {
      fincas: this.valoresUnicos(base, (r) => r?.finca),
      empresas: this.valoresUnicos(base, (r) => r?.empresa_usuaria_solicita),
      cargos: this.valoresUnicos(base, (r) => r?.cargo),
      tipos: this.valoresUnicos(base, (r) => r?.tipo_contratacion),
      municipios: [...municipios].sort((a, b) => a.localeCompare(b)),
    };
  }

  private valoresUnicos(rows: readonly VacanteRow[], get: (r: VacanteRow) => any): string[] {
    const set = new Set<string>();
    for (const r of rows) {
      const t = String(get(r) ?? '').trim();
      if (t) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /**
   * true si la vacante toca alguna de las oficinas del usuario. Quien no se recorta
   * por sede pasa siempre; una vacante sin oficina declarada tampoco se esconde,
   * porque no hay dato por el que excluirla.
   */
  private dentroDelAlcance(vac: any): boolean {
    if (this.sinLimiteSede) return true;
    const arr = Array.isArray(vac?.oficinas_que_contratan) ? vac.oficinas_que_contratan : [];
    if (!arr.length) return true;
    return arr.some((o: any) => this.sedeScope.alcanza(typeof o === 'string' ? o : o?.nombre));
  }

  private matchesSede(vac: any, sede: string): boolean {
    const wanted = normalizarTexto(sede);
    if (!wanted) return true;

    const arr = Array.isArray(vac?.oficinas_que_contratan) ? vac.oficinas_que_contratan : [];
    return arr.some((o: any) => {
      const name = typeof o === 'string' ? o : o?.nombre;
      return normalizarTexto(name) === wanted;
    });
  }

  /** Días desde que se publicó (pidió) la vacante. */
  private diasPublicada(row: any): number | null {
    const f = aFecha(row?.fecha_publicado);
    if (!f) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((hoy.getTime() - f.getTime()) / 86_400_000));
  }

  private isManager(user: any): boolean {
    const raw = user?.rol ?? user?.roles ?? [];
    const roleNames: string[] = Array.isArray(raw)
      ? raw.map((r: any) => (typeof r === 'string' ? r : r?.nombre)).filter((v: any): v is string => !!v)
      : [typeof raw === 'string' ? raw : raw?.nombre].filter(Boolean) as string[];
    const upper = roleNames.map((r) => r.toUpperCase());
    return upper.includes('GERENCIA') || upper.includes('ADMIN');
  }
}

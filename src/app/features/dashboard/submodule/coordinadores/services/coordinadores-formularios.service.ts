import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '@/environments/environment';
import { PermissionsService } from '../../../../../core/services/permissions.service';
import { PlacementService } from '../../dynamic-forms/services/placement.service';
import { ProcessRecord } from '../../dynamic-forms/models/process.models';
import {
  AlcanceResumen,
  COLUMNA_ESTADO_CASO,
  CasoPendiente,
  ConteoEstado,
  EstadisticaFormulario,
  FormularioCoordinador,
  ORDEN_ESTADOS_CASO,
  PuntoDia,
  RAIZ_COORDINADORES,
  ResumenCategoriaApi,
  ResumenFormularioApi,
  SIN_ESTADO,
} from '../models/coordinadores.models';

/** Categoría de ms-forms de los formularios de Coordinadores. */
const CATEGORIA = 'COORDINADORES';
/** Días que muestra la línea de tiempo. */
const DIAS_LINEA = 90;

/** Lo que pinta el inicio a partir del resumen por categoría. */
export interface ResumenCoordinadores {
  stats: Map<number, EstadisticaFormulario>;
  pendientes: CasoPendiente[];
  /** Pendientes sin el tope de la lista (el backend devuelve como mucho 50). */
  pendientesTotal: number;
  alcance: AlcanceResumen | null;
}

/**
 * Datos del inicio de Coordinadores.
 *
 *  · QUÉ formularios: los nodos del árbol de permisos (menú) bajo /dashboard/coordinadores.
 *    `GET /forms` no sirve: no filtra por categoría y a un COORDINADOR solo le lista los
 *    propios y los públicos.
 *  · QUÉ PUEDE: `GET /forms/resolve?route_path=…` devuelve el form_id y el acceso efectivo
 *    (`access`, el mismo objeto de `/access/mine`) en una sola llamada por formulario.
 *  · ESTADÍSTICAS Y PENDIENTES: UNA llamada a
 *    `GET /api/dynamic-forms/categories/COORDINADORES/summary`, que agrega en el motor
 *    (total, del mes, tuyos, estado del caso de todo el histórico, serie de 90 días si
 *    hay analítica) y lista los pendientes del usuario de TODO el histórico. El backend
 *    ya recorta por oficina a COORDINADOR / JEFE-DE-AREA y dice con qué alcance.
 *    Un 403/404 (o cualquier fallo) deja los bloques de cifras ocultos, nunca rompe la pantalla.
 */
@Injectable({ providedIn: 'root' })
export class CoordinadoresFormulariosService {
  private readonly http = inject(HttpClient);
  private readonly permisos = inject(PermissionsService);
  private readonly placement = inject(PlacementService);
  private readonly base = `${environment.apiUrl}/api/dynamic-forms`;

  /**
   * Formularios del menú del usuario bajo /dashboard/coordinadores/<grupo>/<slug>.
   * Devuelve también los nombres de grupo que trae el árbol (por si hay uno nuevo).
   */
  formulariosDelMenu(): { formularios: FormularioCoordinador[]; nombresGrupo: Map<string, string> } {
    const prefijo = `/dashboard/${RAIZ_COORDINADORES}/`;
    const formularios: FormularioCoordinador[] = [];
    const nombresGrupo = new Map<string, string>();
    for (const m of this.permisos.listReadableModules()) {
      if (!m.ruta.startsWith(prefijo)) continue;
      const resto = m.ruta.slice(prefijo.length).split('/').filter(Boolean);
      if (resto.length === 1) {
        nombresGrupo.set(resto[0], m.nombre);
        continue;
      }
      if (resto.length !== 2) continue;   // vistas con sufijo (/respuestas…) u otras profundidades
      formularios.push({
        ruta: m.ruta,
        rutaRelativa: m.ruta.slice('/dashboard/'.length),
        nombre: m.nombre,
        icono: m.icono || 'description',
        grupo: resto[0],
        formId: null,
        acceso: null,
      });
    }
    return { formularios, nombresGrupo };
  }

  /** Resuelve cada ruta a su formulario + acceso. Las que no resuelven se descartan. */
  resolver(formularios: FormularioCoordinador[]): Observable<FormularioCoordinador[]> {
    if (!formularios.length) return of([]);
    return forkJoin(formularios.map((f) =>
      this.placement.resolveRoute(f.rutaRelativa).pipe(
        map((r): FormularioCoordinador | null =>
          (r?.form_id ? { ...f, formId: r.form_id, acceso: r.access ?? null } : null)),
        catchError(() => of(null as FormularioCoordinador | null)),
      ),
    )).pipe(map((lista) => lista.filter((f): f is FormularioCoordinador => !!f)));
  }

  /**
   * Estadísticas y pendientes de los formularios de Coordinadores en una sola llamada.
   * Emite `null` si el backend no lo deja ver (403), aún no tiene el endpoint (404) o falla:
   * la pantalla oculta entonces los bloques de cifras.
   *
   * `formularios` (los del menú, ya resueltos) solo se usa para enlazar cada pendiente con
   * la ruta del menú; los que no están en el menú usan el route_path del backend.
   */
  estadisticas(formularios: FormularioCoordinador[]): Observable<ResumenCoordinadores | null> {
    return this.http.get<ResumenCategoriaApi>(`${this.base}/categories/${CATEGORIA}/summary`).pipe(
      map((r) => this.deResumen(r, formularios)),
      catchError(ignorar403<ResumenCoordinadores>),
    );
  }

  // ---------------------------------------------------------------------------

  private deResumen(r: ResumenCategoriaApi, formularios: FormularioCoordinador[]): ResumenCoordinadores {
    const rutaPorForm = new Map<number, FormularioCoordinador>();
    for (const f of formularios) if (f.formId != null) rutaPorForm.set(f.formId, f);

    const stats = new Map<number, EstadisticaFormulario>();
    for (const f of r.formularios ?? []) stats.set(f.form_id, statDeResumen(f));

    const pendientes: CasoPendiente[] = (r.pendientes ?? []).map((p) => {
      const delMenu = rutaPorForm.get(p.form_id);
      const ruta = delMenu?.ruta ?? (p.route_path ? `/dashboard/${p.route_path.replace(/^\/+/, '')}` : null);
      return {
        formId: p.form_id,
        formulario: delMenu?.nombre ?? p.nombre_formulario ?? `Formulario ${p.form_id}`,
        rutaProceso: ruta ? `${ruta}/proceso` : '/dashboard/coordinadores',
        submissionId: p.id,
        llave: p.record_key ?? null,
        estado: p.estado || SIN_ESTADO,
        fecha: fechaLocal(p.submitted_at),
      };
    });

    return {
      stats,
      pendientes,
      pendientesTotal: Math.max(r.pendientes_total ?? 0, pendientes.length),
      alcance: r.alcance ?? null,
    };
  }
}

/** Formulario del resumen → estadística de la tarjeta. */
export function statDeResumen(f: ResumenFormularioApi): EstadisticaFormulario {
  const conteo = new Map<string, number>();
  for (const e of f.por_estado_caso ?? []) {
    const estado = (e.estado ?? '').trim() || SIN_ESTADO;
    conteo.set(estado, (conteo.get(estado) ?? 0) + (Number(e.total) || 0));
  }
  const serie = (f.ultimos_90_dias ?? []).map((d) => ({ dia: String(d.dia).slice(0, 10), total: Number(d.total) || 0 }));
  return {
    formId: f.form_id,
    fuente: 'resumen',
    total: f.total ?? 0,
    delMes: f.del_mes ?? 0,
    delMesParcial: false,
    mios: f.mios ?? 0,
    estados: ordenarEstados(conteo),
    alcanceEstados: 'todo',
    lineaTiempo: f.puede_ver_analitica ? rellenarDias(serie, DIAS_LINEA) : [],
    ultimoRegistro: fechaLocal(f.ultimo_registro),
  };
}

// ---------------------------------------------------------------------------
// Utilidades puras (exportadas para poder probarlas)

/** 403/404 → null (el bloque se oculta); cualquier otro error también, sin romper. */
function ignorar403<T>(e: unknown): Observable<T | null> {
  if (e instanceof HttpErrorResponse && e.status !== 403 && e.status !== 404) {
    console.warn('[coordinadores] estadística no disponible', e.status, e.url);
  }
  return of(null);
}

/** Primer día del mes en curso, yyyy-MM-dd en hora local. */
export function inicioDeMes(hoy = new Date()): string {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
}

/** yyyy-MM-dd local de una fecha. */
function diaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Fecha del backend a "yyyy-MM-ddTHH:mm" local. ms-forms serializa LocalDateTime y, según
 * el ObjectMapper que gane, llega como texto ISO o como arreglo [y, M, d, h, m, s, ns]
 * (ver la trampa del ObjectMapper de KafkaConfig): se aceptan las dos y el epoch.
 */
export function fechaLocal(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) {
    const [y, mo, d, h = 0, mi = 0] = v.map(Number);
    if (!y || !mo || !d) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}`;
  }
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : `${diaLocal(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.replace(' ', 'T').slice(0, 16) : null;
}

/** UUID comparable: minúsculas y sin guiones (hay datos de db_admin en ambos formatos). */
export function normalizarId(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/-/g, '').trim();
}

/** Valor del "Estado del caso" de un registro (vacío = Sin estado). */
export function estadoDe(fila: ProcessRecord): string {
  const crudo = fila.values?.[COLUMNA_ESTADO_CASO] as unknown;
  const valor = Array.isArray(crudo) ? crudo[0] : crudo;
  const texto = valor == null ? '' : String(valor).trim();
  return texto || SIN_ESTADO;
}

export function ordenarEstados(conteo: Map<string, number>): ConteoEstado[] {
  const pos = (e: string) => {
    const i = ORDEN_ESTADOS_CASO.indexOf(e);
    return i < 0 ? ORDEN_ESTADOS_CASO.length - 1 : i;   // desconocidos antes de "Sin estado"
  };
  return [...conteo.entries()]
    .filter(([, n]) => n > 0)
    .map(([estado, total]) => ({ estado, total }))
    .sort((a, b) => pos(a.estado) - pos(b.estado) || b.total - a.total);
}

/** Últimos `dias` días con los huecos en cero (la línea no debe saltarse días). */
export function rellenarDias(puntos: PuntoDia[], dias: number, hoy = new Date()): PuntoDia[] {
  const porDia = new Map(puntos.map((p) => [p.dia, p.total]));
  const out: PuntoDia[] = [];
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  d.setDate(d.getDate() - (dias - 1));
  for (let i = 0; i < dias; i++) {
    const k = diaLocal(d);
    out.push({ dia: k, total: porDia.get(k) ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}


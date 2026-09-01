import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import {
  CargoAutorizado,
  CentroVacante,
  EmpresaVacante,
  ModoCentro,
  ParametrizacionVacantesService,
  ResolucionLabor,
} from '../../../users/services/parametrizacion-vacantes/parametrizacion-vacantes.service';
import { Temporal, TemporalesService } from '../../../users/services/parametrizacion-vacantes/temporales.service';
import { FincaItem, FincasService, etiquetaFinca } from '../fincas/fincas.service';

/** Opción de temporal para el primer selector del formulario. */
export interface OpcionTemporal {
  /** Lo que se muestra: el nombre del catálogo de ms-hr ("TU ALIANZA SAS"). */
  label: string;
  /**
   * Lo que se GUARDA en la vacante. Es el valor canónico de siempre
   * ('APOYO LABORAL SAS' | 'TU ALIANZA SAS'), no el del catálogo: de él dependen
   * la hoja de labores y los documentos que se generan después. Cambiarlo por el
   * `nombre_display` habría roto los dos sin avisar.
   */
  valor: string;
  /** id de `afiliacion_temporal_config`; es por lo que el alcance liga las empresas. */
  configRef: number | null;
  /** true si esta temporal tiene empresas dentro del alcance de vacantes. */
  parametrizada: boolean;
}

/** Centro de costo ya normalizado, venga del parametrizador o del maestro. */
export interface OpcionCentro {
  /**
   * Clave ÚNICA de la opción dentro de la lista. Es por lo que se selecciona.
   *
   * No se usa `finca` porque el nombre se repite dentro de una misma temporal
   * —ADMINISTRACIÓN CENTRAL está en tres empresas de Apoyo, SAGARO en dos de Tu
   * Alianza— y son sitios distintos, con otra dirección y otro pago. Resolver la
   * opción por el nombre habría llenado la vacante con los datos de la empresa
   * equivocada, en silencio.
   */
  clave: string;
  /** id del parametrizador; `null` cuando la opción viene del maestro. */
  id: number | null;
  /** Nombre limpio, que es lo que se guarda en la vacante. */
  finca: string;
  /** Lo que se muestra; desambigua los nombres repetidos entre empresas. */
  label: string;
  empresa: string | null;
  direccion: string | null;
  temporal: string | null;
  salario: number | null;
  auxilio_transporte: boolean | null;
}

/** Empresa del alcance, ya recortada a lo que el formulario necesita. */
export interface OpcionEmpresa {
  ref: number;
  nombre: string;
}

/**
 * Resultado de resolver la labor. Discriminado a proposito: quien llama TIENE que
 * distinguir "resuelta" de "no hay parametrizacion", porque en el flujo nuevo lo segundo
 * es un error que se muestra, no un hueco que se rellena con la hoja cableada.
 */
export type ResultadoLabor =
  | { ok: true; resolucion: ResolucionLabor }
  | { ok: false; codigo: string; mensaje: string };

/**
 * Cascada de datos de Crear/Editar Vacante.
 *
 * El formulario ahora arranca por TEMPORAL, que es como la propia cadena de
 * parametrización está pensada ("primer eslabón", según el servicio de
 * temporales), y de ahí baja: empresa → centro de costo → (área) → cargo.
 *
 * DOS FUENTES, ELEGIDAS POR LOS DATOS
 * -----------------------------------
 * El parametrizador (`/api/v1/admin/parametrizacion/vacantes`) es la fuente
 * buena: dice qué empresas, centros, áreas y cargos están autorizados, y
 * resuelve la labor. Pero su alcance hoy cubre UNA temporal: las 19 empresas
 * registradas apuntan todas a Tu Alianza, y Apoyo Laboral no tiene ni un centro
 * habilitado — aunque sí tiene vacantes vivas.
 *
 * Publicar solo desde el parametrizador habría dejado a Apoyo Laboral sin poder
 * crear vacantes. Así que la temporal que no tenga alcance cae al maestro de
 * centros de costo, que es de donde salían los datos hasta ahora.
 *
 * La elección la hacen los DATOS, no una lista de nombres: en cuanto se
 * registren empresas de Apoyo en el alcance, esa temporal pasa sola al camino
 * parametrizado sin tocar este código.
 */
@Injectable({ providedIn: 'root' })
export class VacancyCascadeService {
  private readonly param = inject(ParametrizacionVacantesService);
  private readonly temporales = inject(TemporalesService);
  private readonly fincas = inject(FincasService);

  /** Catálogo de temporales + alcance, cacheado mientras viva la sesión. */
  private temporalesCache?: Observable<OpcionTemporal[]>;

  /**
   * Temporales del catálogo de ms-hr, marcando cuáles tienen alcance en el
   * parametrizador. Si alguna de las dos llamadas falla se sigue adelante con lo
   * que haya: quedarse sin el primer selector dejaría el formulario inservible.
   */
  listarTemporales(): Observable<OpcionTemporal[]> {
    if (!this.temporalesCache) {
      this.temporalesCache = forkJoin({
        catalogo: this.temporales.listar().pipe(catchError(() => of([] as Temporal[]))),
        empresas: this.param.listarEmpresas(true).pipe(catchError(() => of([] as EmpresaVacante[]))),
      }).pipe(
        map(({ catalogo, empresas }) => {
          const conAlcance = new Set(
            empresas.map((e) => e.temporal_config_ref).filter((r): r is number => r != null),
          );
          return (catalogo ?? [])
            .filter((t) => t?.activa !== false && !!t?.nombre_display)
            .map((t) => ({
              label: t.nombre_display,
              valor: canonicalTemporal(t.nombre_display) ?? t.nombre_display,
              configRef: t.id ?? null,
              parametrizada: t.id != null && conAlcance.has(t.id),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, 'es'));
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.temporalesCache.subscribe({ error: () => { this.temporalesCache = undefined; } });
    }
    return this.temporalesCache;
  }

  /**
   * Empresas del alcance para una temporal. Vacío = esa temporal no está
   * parametrizada y quien llame debe usar el maestro.
   */
  empresasDe(configRef: number | null): Observable<OpcionEmpresa[]> {
    if (configRef == null) return of([]);
    return this.param.listarEmpresas(true).pipe(
      map((lista) =>
        (lista ?? [])
          .filter((e) => e.temporal_config_ref === configRef && !!e.nombre)
          .map((e) => ({ ref: e.empresa_usuaria_ref, nombre: String(e.nombre) }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      ),
      catchError(() => of([] as OpcionEmpresa[])),
    );
  }

  /** Centros habilitados de una empresa del alcance. */
  centrosDe(empresaRef: number): Observable<OpcionCentro[]> {
    return this.param.listarCentros(empresaRef).pipe(
      map((lista) =>
        (lista ?? [])
          .filter((c) => c.habilitado_vacantes !== false)
          .map((c) => this.desdeParametrizador(c)),
      ),
      map((lista) => this.desambiguarEtiquetas(lista)),
      map((lista) => [...lista].sort((a, b) => a.label.localeCompare(b.label, 'es'))),
      catchError(() => of([] as OpcionCentro[])),
    );
  }

  /**
   * Añade la empresa a la etiqueta de los centros cuyo nombre se repite en la
   * lista. Sin esto el desplegable muestra dos opciones idénticas y no hay forma
   * de saber cuál es cuál.
   */
  private desambiguarEtiquetas(lista: OpcionCentro[]): OpcionCentro[] {
    const veces = new Map<string, number>();
    for (const c of lista) veces.set(c.label, (veces.get(c.label) ?? 0) + 1);
    return lista.map((c) =>
      (veces.get(c.label) ?? 0) > 1 && c.empresa
        ? { ...c, label: `${c.label} (${c.empresa})` }
        : c,
    );
  }

  /**
   * Centros del MAESTRO para una temporal sin alcance parametrizado.
   *
   * Se filtra por temporal para que el desplegable no ofrezca los 55 centros de
   * la otra: el maestro los tiene todos juntos y el nombre se repite entre
   * empresas (SAN CARLOS está en las dos y son sitios distintos).
   */
  centrosDelMaestro(temporalCanonica: string): Observable<OpcionCentro[]> {
    return this.fincas.listFincas().pipe(
      map((items) =>
        (items ?? [])
          .filter((i) => canonicalTemporal(i.temporal) === temporalCanonica)
          .map((i) => this.desdeMaestro(i)),
      ),
      map((lista) => this.desambiguarEtiquetas(lista)),
      map((lista) => [...lista].sort((a, b) => a.label.localeCompare(b.label, 'es'))),
      catchError(() => of([] as OpcionCentro[])),
    );
  }

  /** Si el centro encadena por área o va directo al cargo. */
  modoDe(centroId: number): Observable<ModoCentro | null> {
    return this.param.modoDeCentro(centroId).pipe(catchError(() => of(null)));
  }

  /** Áreas permitidas del centro (solo las asignadas). */
  areasDe(centroId: number): Observable<Array<{ id: number; codigo: string; nombre: string | null }>> {
    return this.param.areasDeCentro(centroId).pipe(
      map((lista) =>
        (lista ?? [])
          .filter((a) => a.asignada)
          .map((a) => ({ id: a.area_id, codigo: a.codigo, nombre: a.nombre })),
      ),
      catchError(() => of([])),
    );
  }

  /**
   * Cargos autorizados en (centro, área). Se descartan los inactivos y los que
   * no tienen esquema (`completa = false`): el resolutor de labor los rechaza,
   * así que ofrecerlos solo lleva a una vacante que no puede resolver su labor.
   */
  cargosDe(centroId: number, areaId?: number): Observable<CargoAutorizado[]> {
    return this.param.cargosDeCentro(centroId, areaId).pipe(
      map((lista) =>
        (lista ?? [])
          .filter((c) => c.activo !== false && c.completa)
          .sort((a, b) => (a.cargo_nombre || '').localeCompare(b.cargo_nombre || '', 'es')),
      ),
      catchError(() => of([] as CargoAutorizado[])),
    );
  }

  /**
   * Labor resuelta por el BACKEND, con el motivo cuando no puede resolverla.
   *
   * ANTES devolvía `null` ante cualquier fallo, y quien llamaba no podía distinguir
   * "no hay parametrización" de "se cayó la red". Con eso, `crear-editar-vacante` caía a
   * la hoja cableada y la vacante parecía funcionar aunque faltara la configuración: es
   * justo la caída silenciosa que el flujo nuevo no puede tener.
   *
   * El backend nunca devuelve una labor aproximada: responde 409 con un código estable
   * (CONFIGURACION_NO_ENCONTRADA / REGLA_LABOR_NO_ENCONTRADA / LABOR_FIJA_NO_CONFIGURADA)
   * en el cuerpo `{error, codigo}`. Aquí ese código se propaga tal cual.
   */
  resolverLabor(q: { centroId: number; cargoId?: number | null; cargoNombre?: string; fechaIngreso: string })
    : Observable<ResultadoLabor> {
    return this.param
      .resolverLabor({
        centroCostoId: q.centroId,
        cargoId: q.cargoId ?? undefined,
        cargoNombre: q.cargoNombre,
        fechaIngreso: q.fechaIngreso,
      })
      .pipe(
        map((resolucion) => ({ ok: true, resolucion }) as ResultadoLabor),
        catchError((e: unknown) => {
          const err = e as { error?: { codigo?: string; error?: string }; status?: number };
          return of({
            ok: false,
            codigo: err?.error?.codigo ?? (err?.status === 0 ? 'SIN_CONEXION' : 'ERROR_RESOLUCION'),
            mensaje: err?.error?.error ?? 'No se pudo resolver la labor.',
          } as ResultadoLabor);
        }),
      );
  }

  // ================== Normalización ==================

  private desdeParametrizador(c: CentroVacante): OpcionCentro {
    const nombre = (c.finca ?? c.centro_de_costo ?? '').trim();
    return {
      clave: `p:${c.id}`,
      id: c.id,
      finca: nombre,
      label: nombre,
      empresa: c.empresa_nombre,
      direccion: c.direccion,
      temporal: canonicalTemporal(c.temporal),
      salario: c.salario,
      auxilio_transporte: c.auxilio_transporte,
    };
  }

  private desdeMaestro(i: FincaItem): OpcionCentro {
    const nombre = (i.finca ?? '').trim();
    return {
      // El maestro no da id: la clave se arma con nombre + empresa, que es lo
      // que de verdad distingue dos fincas homónimas.
      clave: `m:${nombre}|${(i.empresa ?? '').trim()}`,
      id: null,
      finca: nombre,
      label: etiquetaFinca(i),
      empresa: i.empresa ?? null,
      direccion: i.direccion ?? null,
      temporal: canonicalTemporal(i.temporal),
      salario: i.salario ?? null,
      auxilio_transporte: i.auxilio_transporte ?? null,
    };
  }
}

/**
 * Nombre canónico de la temporal, el que se guarda en la vacante.
 *
 * Los datos traen 83 variantes para dos temporales reales ("Apoyo Laboral TS",
 * "APOYO LABORAL TS S.A.S", "AL"...), así que se reconoce por la palabra clave.
 * Vive aquí —y no dentro del diálogo— porque ahora lo necesitan el selector de
 * temporal, el filtro del maestro y el propio formulario.
 */
export function canonicalTemporal(raw: string | null | undefined): 'APOYO LABORAL SAS' | 'TU ALIANZA SAS' | null {
  if (!raw) return null;

  const norm = String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (/(^|[^a-z])apoyo([^a-z]|$)/.test(norm)) return 'APOYO LABORAL SAS';
  if (/(^|[^a-z])alianza([^a-z]|$)/.test(norm)) return 'TU ALIANZA SAS';

  return null;
}

import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject, debounceTime, switchMap, catchError, of, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReportesApiService } from './reportes-api.service';
import {
  CalculatedSpec, CampoCatalogo, ConfigVisualizacion, DatasetCatalogo, FieldSpec,
  FilterNode, JoinSpec, RelacionCatalogo, ReportDefinition, ReporteDetalle,
  ResultadoConsulta, SortSpec, TransformacionFecha, Agregacion,
} from '../models/reportes.models';

/**
 * Estado del constructor visual de reportes.
 *
 * Vive en un store y no dentro del componente por dos razones concretas:
 *  · el constructor son cuatro paneles que editan la MISMA definición (explorador,
 *    columnas, filtros, visualización) y necesitan verse los cambios entre sí;
 *  · la vista previa se re-dispara sola con cada cambio, con rebote, y ese ciclo
 *    tiene que estar en un solo sitio o acaba habiendo cuatro suscripciones
 *    peleándose por pedir lo mismo.
 *
 * No se provee en root: se declara en el componente del constructor, así cada vez
 * que se entra a la pantalla el estado nace limpio.
 */
@Injectable()
export class ConstructorStore {

  private api = inject(ReportesApiService);

  // ─────────────────────────────── estado ───────────────────────────────

  /** Reporte que se está editando (null = reporte nuevo sin guardar). */
  readonly reporteId = signal<string | null>(null);
  readonly nombre = signal('Reporte sin titulo');
  readonly descripcion = signal<string | null>(null);
  readonly categoria = signal<string | null>(null);
  readonly estado = signal<'BORRADOR' | 'PUBLICADO' | 'ARCHIVADO'>('BORRADOR');
  readonly visibilidad = signal<'PRIVADO' | 'ROL' | 'USUARIOS' | 'ORGANIZACION'>('PRIVADO');
  readonly puedeEditar = signal(true);

  readonly root = signal<string | null>(null);
  readonly joins = signal<JoinSpec[]>([]);
  readonly fields = signal<FieldSpec[]>([]);
  readonly calculated = signal<CalculatedSpec[]>([]);
  readonly filtros = signal<FilterNode | null>(null);
  readonly orden = signal<SortSpec[]>([]);
  readonly topN = signal<number | null>(null);
  readonly distinct = signal(false);

  readonly visualizacion = signal<ConfigVisualizacion>({
    tipo: 'TABLA', leyenda: true, etiquetas: false, mostrar_totales: false,
  });

  // ─────────────────────────── resultado y estado de UI ───────────────────────────

  readonly resultado = signal<ResultadoConsulta | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly advertencias = signal<string[]>([]);
  readonly sucio = signal(false);

  private readonly disparo$ = new Subject<void>();

  constructor() {
    // Vista previa reactiva con rebote: mientras el usuario arrastra campos y
    // escribe filtros no tiene sentido consultar en cada tecla.
    this.disparo$.pipe(
      debounceTime(450),
      switchMap(() => {
        const def = this.definicion();
        if (!def.root || !def.fields.length) {
          this.resultado.set(null);
          this.error.set(null);
          this.cargando.set(false);
          return of(null);
        }
        this.cargando.set(true);
        this.error.set(null);
        return this.api.vistaPrevia(def).pipe(
          catchError(err => {
            this.error.set(mensajeDeError(err));
            this.resultado.set(null);
            this.cargando.set(false);
            return of(null);
          }),
        );
      }),
      tap(res => {
        if (res) {
          this.resultado.set(res);
          this.advertencias.set(res.advertencias ?? []);
        }
        this.cargando.set(false);
      }),
      takeUntilDestroyed(),
    ).subscribe();
  }

  // ─────────────────────────── definición derivada ───────────────────────────

  readonly definicion = computed<ReportDefinition>(() => ({
    root: this.root(),
    joins: this.joins(),
    fields: this.fields(),
    calculated: this.calculated(),
    filters: this.filtros(),
    sort: this.orden(),
    limit: this.topN(),
    distinct: this.distinct(),
  }));

  /** Claves de las tablas que participan: raíz + extremos de las relaciones activas. */
  readonly datasetsUsados = computed(() => {
    const claves = new Set<string>();
    const raiz = this.root();
    if (raiz) claves.add(raiz);
    const relaciones = this.api.relacionesPorClave();
    for (const j of this.joins()) {
      if (!j.activo) continue;
      const rel = relaciones.get(j.relacion);
      if (rel) { claves.add(rel.dataset_izq); claves.add(rel.dataset_der); }
    }
    return [...claves];
  });

  readonly tablas = computed<DatasetCatalogo[]>(() => {
    const mapa = this.api.datasetsPorClave();
    return this.datasetsUsados().map(c => mapa.get(c)).filter((d): d is DatasetCatalogo => !!d);
  });

  /** Campos disponibles para columnas y filtros: los de las tablas ya agregadas. */
  readonly camposDisponibles = computed<CampoCatalogo[]>(() =>
    this.tablas().flatMap(d => d.campos));

  readonly tieneAgregaciones = computed(() => this.fields().some(f => !!f.agregacion));

  readonly relacionesActivas = computed<RelacionCatalogo[]>(() => {
    const mapa = this.api.relacionesPorClave();
    return this.joins().map(j => mapa.get(j.relacion)).filter((r): r is RelacionCatalogo => !!r);
  });

  // ─────────────────────────────── acciones ───────────────────────────────

  /** Punto de entrada del paso 1: elegir la fuente de datos. */
  fijarRaiz(clave: string): void {
    if (this.root() === clave) return;
    this.root.set(clave);
    this.joins.set([]);
    this.fields.set([]);
    this.calculated.set([]);
    this.filtros.set(null);
    this.orden.set([]);
    this.marcarSucio();
  }

  /**
   * Agrega una tabla al reporte eligiendo automáticamente cómo relacionarla (§6).
   *
   * Se busca una relación del catálogo entre la tabla nueva y alguna de las que ya
   * están. Si no existe ninguna, no se agrega: unirlas sería un producto cartesiano
   * y el backend lo rechazaría igual, así que es mejor decirlo aquí y ya.
   *
   * @returns la relación usada, o null si no hay forma de conectarla
   */
  agregarTabla(clave: string): RelacionCatalogo | null {
    if (this.datasetsUsados().includes(clave)) return null;
    const rel = this.relacionSugerida(clave);
    if (!rel) return null;
    this.joins.update(js => [...js, { relacion: rel.clave, tipo: rel.tipo_default, activo: true }]);
    this.marcarSucio();
    return rel;
  }

  /** Relación del catálogo que conecta `clave` con alguna tabla ya presente. */
  relacionSugerida(clave: string): RelacionCatalogo | null {
    const presentes = new Set(this.datasetsUsados());
    const candidatas = (this.api.catalogo()?.relaciones ?? []).filter(r =>
      (r.dataset_izq === clave && presentes.has(r.dataset_der))
      || (r.dataset_der === clave && presentes.has(r.dataset_izq)));
    // Las deducidas de una llave foránea real van primero: son las fiables.
    candidatas.sort((a, b) => (a.origen === 'FK' ? -1 : 1) - (b.origen === 'FK' ? -1 : 1));
    return candidatas[0] ?? null;
  }

  /** Todas las relaciones posibles para una tabla (el usuario elige otra si quiere). */
  relacionesPosibles(clave: string): RelacionCatalogo[] {
    const presentes = new Set(this.datasetsUsados());
    return (this.api.catalogo()?.relaciones ?? []).filter(r =>
      (r.dataset_izq === clave && presentes.has(r.dataset_der))
      || (r.dataset_der === clave && presentes.has(r.dataset_izq)));
  }

  quitarTabla(clave: string): void {
    if (clave === this.root()) return;
    const relaciones = this.api.relacionesPorClave();
    this.joins.update(js => js.filter(j => {
      const rel = relaciones.get(j.relacion);
      return !rel || (rel.dataset_izq !== clave && rel.dataset_der !== clave);
    }));
    // Las columnas y los filtros de esa tabla dejan de tener sentido.
    const quitados = new Set(
      this.fields().filter(f => f.campo?.startsWith(clave + '.')).map(f => f.id));
    this.fields.update(fs => fs.filter(f => !quitados.has(f.id)));
    this.orden.update(os => os.filter(o => !quitados.has(o.ref)));
    this.filtros.update(f => podarFiltrosDe(f, clave));
    this.marcarSucio();
  }

  cambiarTipoJoin(relacion: string, tipo: 'INNER' | 'LEFT'): void {
    this.joins.update(js => js.map(j => j.relacion === relacion ? { ...j, tipo } : j));
    this.marcarSucio();
  }

  alternarJoin(relacion: string): void {
    this.joins.update(js => js.map(j => j.relacion === relacion ? { ...j, activo: !j.activo } : j));
    this.marcarSucio();
  }

  // ── columnas ──

  /** @returns el id del FieldSpec creado (o el del existente, si ya estaba). */
  agregarCampo(campo: CampoCatalogo): string {
    const yaEsta = this.fields().find(f => f.campo === campo.clave && !f.agregacion);
    if (yaEsta) return yaEsta.id;
    const id = nuevoId('f');
    this.fields.update(fs => [...fs, {
      id,
      campo: campo.clave,
      calculado: null,
      alias: campo.nombre,
      agregacion: null,
      transformacion: null,
      agrupar: null,
      visible: true,
      formato: campo.formato,
      ancho: campo.ancho,
      alineacion: campo.alineacion,
      orden: fs.length,
    }]);
    this.marcarSucio();
    return id;
  }

  /**
   * Añade una métrica agregada: es el gesto de "quiero contar/sumar esto".
   * @returns el id del FieldSpec, para poder asignarlo a la gráfica al vuelo.
   */
  agregarMetrica(campo: CampoCatalogo, agregacion: Agregacion): string {
    const id = nuevoId('m');
    this.fields.update(fs => [...fs, {
      id,
      campo: campo.clave,
      calculado: null,
      alias: etiquetaMetrica(agregacion, campo.nombre),
      agregacion,
      transformacion: null,
      agrupar: null,
      visible: true,
      formato: agregacion === 'COUNT' || agregacion === 'COUNT_DISTINCT' ? 'integer' : campo.formato,
      ancho: null,
      alineacion: 'right',
      orden: fs.length,
    }]);
    this.marcarSucio();
    return id;
  }

  /**
   * Métrica «cantidad de registros» = COUNT(*).
   *
   * Es la métrica que pide el 90 % de los reportes ("cuántos por oficina", "cuántas
   * contrataciones por empresa") y no cuelga de ninguna columna. Contar una columna
   * concreta daría otro número: ignoraría las filas con ese valor vacío.
   *
   * Solo puede haber una: dos COUNT(*) en el mismo reporte serían la misma columna
   * repetida.
   */
  agregarConteoRegistros(): string {
    const yaEsta = this.fields().find(f => !f.campo && !f.calculado && f.agregacion === 'COUNT');
    if (yaEsta) return yaEsta.id;
    const id = nuevoId('m');
    this.fields.update(fs => [...fs, {
      id,
      campo: null,
      calculado: null,
      alias: 'Cantidad de registros',
      agregacion: 'COUNT' as Agregacion,
      transformacion: null,
      agrupar: null,
      visible: true,
      formato: 'integer' as const,
      ancho: null,
      alineacion: 'right',
      orden: fs.length,
    }]);
    this.marcarSucio();
    return id;
  }

  quitarCampo(id: string): void {
    this.fields.update(fs => fs.filter(f => f.id !== id));
    this.orden.update(os => os.filter(o => o.ref !== id));
    // La gráfica puede estar apuntando a esta columna: si se queda con la referencia
    // colgando, deja de pintar sin decir por qué.
    this.visualizacion.update(v => ({
      ...v,
      dimension: v.dimension === id ? null : v.dimension,
      serie: v.serie === id ? null : v.serie,
      metricas: (v.metricas ?? []).filter(m => m !== id),
      kpi_metrica: v.kpi_metrica === id ? null : v.kpi_metrica,
      kpi_comparacion: v.kpi_comparacion === id ? null : v.kpi_comparacion,
    }));
    this.marcarSucio();
  }

  /**
   * Deja en el reporte solo las columnas que usa la gráfica.
   *
   * Con una agregación, TODA columna sin cálculo entra al GROUP BY —esté visible o
   * no—, así que una columna de más parte los datos en más grupos y la gráfica sale
   * con decenas de barras diminutas. Esto es el arreglo de un clic para ese caso.
   */
  dejarSoloLoDeLaGrafica(): void {
    const v = this.visualizacion();
    const usados = new Set<string>(
      [v.dimension, v.serie, v.kpi_metrica, v.kpi_comparacion, ...(v.metricas ?? [])]
        .filter((x): x is string => !!x));
    if (!usados.size) return;
    this.fields.update(fs => fs.filter(f => usados.has(f.id) || !!f.agregacion));
    this.orden.update(os => os.filter(o => usados.has(o.ref)));
    this.marcarSucio();
  }

  actualizarCampo(id: string, cambios: Partial<FieldSpec>): void {
    this.fields.update(fs => fs.map(f => f.id === id ? { ...f, ...cambios } : f));
    this.marcarSucio();
  }

  moverCampo(desde: number, hasta: number): void {
    this.fields.update(fs => {
      const copia = [...fs];
      const [item] = copia.splice(desde, 1);
      copia.splice(hasta, 0, item);
      return copia.map((f, i) => ({ ...f, orden: i }));
    });
    this.marcarSucio();
  }

  // ── campos calculados ──

  agregarCalculado(spec: Omit<CalculatedSpec, 'id'>): string {
    const id = nuevoId('c');
    this.calculated.update(cs => [...cs, { ...spec, id }]);
    this.fields.update(fs => [...fs, {
      id: nuevoId('f'),
      campo: null,
      calculado: id,
      alias: spec.alias,
      agregacion: null,
      transformacion: null,
      agrupar: null,
      visible: true,
      formato: spec.formato,
      ancho: null,
      alineacion: null,
      orden: fs.length,
    }]);
    this.marcarSucio();
    return id;
  }

  actualizarCalculado(id: string, cambios: Partial<CalculatedSpec>): void {
    this.calculated.update(cs => cs.map(c => c.id === id ? { ...c, ...cambios } : c));
    if (cambios.alias) {
      this.fields.update(fs => fs.map(f => f.calculado === id ? { ...f, alias: cambios.alias! } : f));
    }
    this.marcarSucio();
  }

  quitarCalculado(id: string): void {
    this.calculated.update(cs => cs.filter(c => c.id !== id));
    this.fields.update(fs => fs.filter(f => f.calculado !== id));
    this.marcarSucio();
  }

  // ── filtros / orden / visualización ──

  fijarFiltros(nodo: FilterNode | null): void {
    this.filtros.set(nodo);
    this.marcarSucio();
  }

  alternarOrden(ref: string): void {
    const actual = this.orden().find(o => o.ref === ref);
    if (!actual) this.orden.set([{ ref, direccion: 'ASC' }]);
    else if (actual.direccion === 'ASC') this.orden.set([{ ref, direccion: 'DESC' }]);
    else this.orden.set([]);
    this.marcarSucio();
  }

  fijarOrden(orden: SortSpec[]): void {
    this.orden.set(orden);
    this.marcarSucio();
  }

  fijarVisualizacion(cfg: Partial<ConfigVisualizacion>): void {
    this.visualizacion.update(v => ({ ...v, ...cfg }));
    this.marcarSucio();
  }

  // ── ciclo de vida ──

  /** Vuelca un reporte guardado al constructor. */
  cargarDesde(detalle: ReporteDetalle): void {
    this.reporteId.set(detalle.id);
    this.nombre.set(detalle.nombre);
    this.descripcion.set(detalle.descripcion);
    this.categoria.set(detalle.categoria);
    this.estado.set(detalle.estado);
    this.visibilidad.set(detalle.visibilidad);
    this.puedeEditar.set(detalle.puede_editar);

    const d = detalle.definicion;
    this.root.set(d.root);
    this.joins.set(d.joins ?? []);
    this.fields.set(d.fields ?? []);
    this.calculated.set(d.calculated ?? []);
    this.filtros.set(d.filters ?? null);
    this.orden.set(d.sort ?? []);
    this.topN.set(d.limit ?? null);
    this.distinct.set(!!d.distinct);
    this.visualizacion.set(detalle.visualizacion ?? { tipo: 'TABLA', leyenda: true });
    this.advertencias.set(detalle.advertencias ?? []);
    this.sucio.set(false);
    this.refrescar();
  }

  /** Reemplaza la definición completa (usado por el asistente de IA, §33). */
  aplicarDefinicion(def: ReportDefinition): void {
    this.root.set(def.root);
    this.joins.set(def.joins ?? []);
    this.fields.set(def.fields ?? []);
    this.calculated.set(def.calculated ?? []);
    this.filtros.set(def.filters ?? null);
    this.orden.set(def.sort ?? []);
    this.topN.set(def.limit ?? null);
    this.distinct.set(!!def.distinct);
    this.marcarSucio();
  }

  reiniciar(): void {
    this.reporteId.set(null);
    this.nombre.set('Reporte sin titulo');
    this.descripcion.set(null);
    this.categoria.set(null);
    this.estado.set('BORRADOR');
    this.visibilidad.set('PRIVADO');
    this.puedeEditar.set(true);
    this.root.set(null);
    this.joins.set([]);
    this.fields.set([]);
    this.calculated.set([]);
    this.filtros.set(null);
    this.orden.set([]);
    this.topN.set(null);
    this.distinct.set(false);
    this.visualizacion.set({ tipo: 'TABLA', leyenda: true });
    this.resultado.set(null);
    this.advertencias.set([]);
    this.error.set(null);
    this.sucio.set(false);
  }

  /** Pide la vista previa ya (sin esperar al rebote). */
  refrescar(): void { this.disparo$.next(); }

  private marcarSucio(): void {
    this.sucio.set(true);
    this.disparo$.next();
  }
}

// ─────────────────────────────── utilidades ───────────────────────────────

let contador = 0;
/** Id local y estable dentro de la sesión de edición. No sale de aquí como dato. */
function nuevoId(prefijo: string): string {
  contador += 1;
  return `${prefijo}${Date.now().toString(36)}${contador}`;
}

function etiquetaMetrica(agg: Agregacion, campo: string): string {
  switch (agg) {
    case 'COUNT': return `Cantidad de ${campo.toLowerCase()}`;
    case 'COUNT_DISTINCT': return `${campo} distintos`;
    case 'SUM': return `Total ${campo.toLowerCase()}`;
    case 'AVG': return `Promedio de ${campo.toLowerCase()}`;
    case 'MIN': return `Minimo de ${campo.toLowerCase()}`;
    case 'MAX': return `Maximo de ${campo.toLowerCase()}`;
  }
}

/** Quita del árbol de filtros las condiciones de una tabla que ya no está. */
function podarFiltrosDe(nodo: FilterNode | null, datasetClave: string): FilterNode | null {
  if (!nodo) return null;
  if (nodo.tipo === 'GRUPO') {
    const hijos = (nodo.hijos ?? [])
      .map(h => podarFiltrosDe(h, datasetClave))
      .filter((h): h is FilterNode => !!h);
    return hijos.length ? { ...nodo, hijos } : null;
  }
  return nodo.campo?.startsWith(datasetClave + '.') ? null : nodo;
}

/** Mensaje legible de un error HTTP del módulo. */
export function mensajeDeError(err: unknown): string {
  const e = err as { error?: { message?: string; detail?: string }; status?: number; message?: string };
  if (e?.error?.message) return e.error.message;
  if (e?.error?.detail) return e.error.detail;
  if (e?.status === 403) return 'No tienes permiso para consultar estos datos.';
  if (e?.status === 504) return 'La consulta tardo demasiado. Agrega filtros para acotarla.';
  if (e?.status === 0) return 'Sin conexion con el servidor.';
  return e?.message ?? 'No se pudo ejecutar la consulta.';
}

/** Transformaciones temporales ofrecidas para un campo de fecha. */
export const TRANSFORMACIONES_FECHA: { valor: TransformacionFecha; etiqueta: string }[] = [
  { valor: 'FECHA', etiqueta: 'Fecha exacta' },
  { valor: 'DIA', etiqueta: 'Por dia' },
  { valor: 'SEMANA', etiqueta: 'Por semana' },
  { valor: 'MES', etiqueta: 'Por mes' },
  { valor: 'TRIMESTRE', etiqueta: 'Por trimestre' },
  { valor: 'ANIO', etiqueta: 'Por anio' },
  { valor: 'HORA', etiqueta: 'Por hora' },
  { valor: 'DIA_SEMANA', etiqueta: 'Por dia de la semana' },
];

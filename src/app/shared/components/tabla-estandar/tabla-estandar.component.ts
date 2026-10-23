import { NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { ImagenAmpliableComponent } from '../imagen-ampliable/imagen-ampliable.component';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Injector,
  OnInit,
  Output,
  PLATFORM_ID,
  TemplateRef,
  afterNextRender,
  computed,
  effect,
  contentChild,
  contentChildren,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { HerramientasPantallaService } from '../../../core/services/operador/herramientas-pantalla.service';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { getLocalStorageItem, setLocalStorageItem } from '../../../core/utils/safe-storage';
import { NavegacionService } from '../../../core/services/navegacion.service';
import { FiltroColumnaComponent } from './filtro-columna.component';
import { copiarBloque, descargarExcel, registrarCopia } from './tabla.copiar';
import { casarPegado, normalizarClave, partirBloque, type ResultadoPegado } from './tabla.pegado';
import {
  TablaAccionesDirective,
  TablaCeldaDirective,
  TablaEncabezadoDirective,
  TablaTarjetaDirective,
  TablaVacioDirective,
} from './tabla-plantillas.directive';
import {
  AccionMasiva,
  BadgeCelda,
  BloqueCopiado,
  ColumnaTabla,
  ContextoFila,
  DireccionOrden,
  FiltroColumna,
  FormatoFecha,
  OrdenTabla,
  PieTabla,
  RangoSeleccion,
  ResultadoAccionMasiva,
  RolTarjeta,
  TipoFecha,
  ValorCelda,
  Vista,
  textoDeValor,
  type SugerenciaBusqueda,
} from './tabla.tipos';
import { aFecha, escribirFecha, limiteDelRango, tipoDeFechas } from './tabla.fechas';
import { fichaDeRegistro } from './tabla.revision';

type Tamano = 'xs' | 'sm' | 'lg';
type Origen = 'seleccion' | 'todo' | 'marcadas';

const OPCIONES_PAGINA = [25, 50, 100, 250, 0];
/** Aire que se deja entre la celda activa y el borde al seguir la selección. */
const MARGEN_SCROLL = 24;
/** Franja del borde donde arrastrar empieza a mover la vista (estilo Excel). */
const ZONA_ARRASTRE = 48;
const COLLATOR = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const FILTRO_VACIO: FiltroColumna = Object.freeze({ texto: '', valores: null }) as FiltroColumna;

function normalizar(r: RangoSeleccion) {
  return {
    r1: Math.min(r.filaInicio, r.filaFin),
    r2: Math.max(r.filaInicio, r.filaFin),
    c1: Math.min(r.colInicio, r.colFin),
    c2: Math.max(r.colInicio, r.colFin),
  };
}

/** Ancestro que hace el scroll vertical (el wrapper del dashboard). null = la ventana. */
function ancestroVertical(el: HTMLElement | null): HTMLElement | null {
  let padre = el?.parentElement ?? null;
  while (padre && padre !== document.body) {
    const overflow = window.getComputedStyle(padre).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && padre.scrollHeight > padre.clientHeight) return padre;
    padre = padre.parentElement;
  }
  return null;
}

function limitesVerticales(vertical: HTMLElement | null) {
  if (!vertical) return { arriba: 0, abajo: window.innerHeight };
  const r = vertical.getBoundingClientRect();
  return { arriba: r.top, abajo: r.bottom };
}

/** Siempre instantáneo: con `scroll-behavior: smooth` global la selección se quedaría atrás. */
function desplazarVertical(vertical: HTMLElement | null, delta: number) {
  if (!delta) return;
  const opciones: ScrollToOptions = { top: delta, behavior: 'instant' as ScrollBehavior };
  if (vertical) vertical.scrollBy(opciones);
  else window.scrollBy(opciones);
}

/**
 * Tabla estándar de la plataforma.
 *
 * Cada pantalla describe sus columnas (`ColumnaTabla<T>[]`) y la tabla resuelve
 * lo demás igual en todas partes: búsqueda global, filtro por columna estilo
 * Excel (con valores en cascada), orden, paginación, columnas que se ocultan
 * por prioridad según el ancho, vista Tabla ⇄ Tarjetas (recordada por pantalla),
 * selección tipo hoja de cálculo, copiar a Excel (TSV + HTML) y descarga .xlsx.
 *
 * Pipeline, en este orden: datos → búsqueda → filtros por columna → orden →
 * paginación. «Copiar tabla» y «Excel» usan todo lo filtrado (todas las
 * páginas); la selección trabaja sobre la página visible.
 *
 * Con `totalServidor` la tabla pasa a MODO SERVIDOR: `datos` ya es la página
 * pedida, y búsqueda / página / orden se avisan por eventos para que la
 * pantalla consulte al backend.
 */
@Component({
  selector: 'app-tabla-estandar',
  standalone: true,
  imports: [NgTemplateOutlet, MatIconModule, FiltroColumnaComponent, ImagenAmpliableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.te-completa]': 'pantallaCompleta()' },
  templateUrl: './tabla-estandar.component.html',
  styleUrl: './tabla-estandar.component.css',
})
export class TablaEstandarComponent<T = any> implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  // ── Entradas ────────────────────────────────────────────────────────────────
  /** Clave estable: recuerda la vista (tabla/tarjetas) de esta pantalla. */
  readonly id = input.required<string>();
  readonly datos = input<T[] | null | undefined>([]);
  readonly columnas = input.required<ColumnaTabla<T>[]>();
  /** Clave única de cada fila (para el track). Por defecto, la posición. */
  readonly filaId = input<((fila: T, indice: number) => unknown) | null>(null);
  /** Nombre humano: título del Excel, nombre de su hoja y del registro de copias. */
  readonly titulo = input('Tabla');
  readonly modulo = input('Sistema');
  readonly entidad = input<string | undefined>(undefined);
  /** 'auto' = tarjetas bajo 768 px, tabla arriba. Si el usuario eligió, manda lo guardado. */
  readonly vistaInicial = input<Vista | 'auto'>('auto');
  /** Ancho mínimo de cada tarjeta en la rejilla. */
  readonly minAnchoTarjeta = input('280px');
  /** La tarjeta propia (`tablaTarjeta`) trae su marco; la tabla no pinta el suyo. */
  readonly tarjetaSinMarco = input(false);
  readonly textoDetalle = input('Ver');
  /** Fuerza (o apaga) el botón «Ver». Por defecto aparece si alguien escucha `filaClick`. */
  readonly detalle = input<boolean | null>(null);
  readonly anchoAcciones = input<string | null>(null);
  /** false oculta el buscador; un texto cambia el placeholder. */
  readonly busqueda = input<boolean | string>(true);
  /** 0 = sin paginación (cuando el servidor ya pagina o son pocas filas). */
  readonly filasPorPagina = input(50);
  readonly copiable = input(true);
  readonly descargable = input(true);
  /**
   * Clase por fila. El CSS de la pantalla no alcanza las filas (son de este
   * componente), así que usar las de la tabla: 'te-fila--atenuada',
   * 'te-fila--alerta', 'te-fila--peligro', 'te-fila--ok', 'te-fila--info',
   * 'te-fila--destacada'. Una clase propia necesita una regla global.
   */
  readonly filaClase = input<((fila: T) => string) | null>(null);
  readonly pie = input<PieTabla<T> | null>(null);
  readonly cargando = input(false);
  /** Mensaje propio cuando no hay filas (o usar la plantilla `tablaVacio`). */
  readonly vacio = input<string | null>(null);
  /** Línea de ayuda de atajos bajo la tabla. */
  readonly ayuda = input(true);
  /** Modo servidor: total de registros en el backend. null = todo en cliente. */
  readonly totalServidor = input<number | null>(null);
  /**
   * Selección de filas con casillas (acciones masivas). La pantalla crea el
   * `SelectionModel` y lo conserva: así lo lee o lo limpia cuando quiera.
   * Si no pasa ninguno, la tabla usa el suyo: marcar filas y pegar una lista
   * de Excel son parte del estándar, no algo que cada pantalla deba montar.
   */
  readonly seleccion = input<SelectionModel<T> | null>(null);
  /** Apaga las casillas en tablas donde marcar filas no significa nada. */
  readonly seleccionable = input(true);
  /**
   * Columna por la que se casa lo que se pega desde Excel (id de columna). Sin
   * declararla se toma la que parezca documento, cédula o código.
   */
  readonly claveMasiva = input<string | null>(null);
  /** Apaga «Pegar lista» en pantallas que ya traen su propio pegado masivo. */
  readonly pegable = input(true);
  /**
   * Acciones sobre lo marcado, declaradas (ver `AccionMasiva`). La tabla pone
   * el botón con el conteo, la confirmación con el carrusel de registros, la
   * ejecución uno a uno y el cierre: la pantalla solo dice qué hace con cada
   * fila. Lo que se proyecte en `[tablaAccionesSeleccion]` se sigue pintando
   * al lado, para casos que no quepan en el contrato.
   */
  readonly accionesMasivas = input<AccionMasiva<T, any>[] | null>(null);
  /**
   * Modo servidor: página (base 0) que la pantalla pidió al backend. Cuando un
   * filtro de negocio devuelve la pantalla a la primera página, la tabla se
   * entera por aquí.
   */
  readonly paginaServidor = input<number | null>(null);
  /** Tamaños ofrecidos en el paginador. Por defecto 25/50/100/250/Todas. */
  readonly opcionesPorPagina = input<number[] | null>(null);
  /**
   * Sugerencias bajo el buscador. Con un array (aunque vacío) la tabla emite
   * `busquedaCambio` también en modo cliente, para que la pantalla las pida al
   * backend, y muestra la lista para elegir con clic o con ↑ ↓ Enter.
   * null (por defecto) = buscador normal, sin lista.
   */
  readonly sugerencias = input<SugerenciaBusqueda[] | null>(null);

  // ── Salidas ─────────────────────────────────────────────────────────────────
  /** Botón «Ver», doble clic en la fila o clic en la tarjeta. */
  @Output() readonly filaClick = new EventEmitter<T>();
  readonly paginaCambio = output<{ pagina: number; porPagina: number }>();
  readonly busquedaCambio = output<string>();
  /** Se eligió una sugerencia del buscador (la búsqueda se vacía sola). */
  readonly sugerenciaElegida = output<SugerenciaBusqueda>();
  readonly ordenCambio = output<OrdenTabla | null>();
  /** Resultado de pegar una lista: lo que se marcó y lo que no apareció. */
  readonly pegadoMasivo = output<{ encontradas: number; noEncontradas: string[] }>();
  /** Terminó una acción masiva declarada (ya se llamó a su `alTerminar`). */
  readonly loteTerminado = output<{ accion: string; hechos: number; fallidos: number; cancelado: boolean }>();

  // ── Plantillas proyectadas ──────────────────────────────────────────────────
  private readonly celdasTpl = contentChildren(TablaCeldaDirective, { descendants: true });
  private readonly encabezadosTpl = contentChildren(TablaEncabezadoDirective, { descendants: true });
  readonly accionesTpl = contentChild(TablaAccionesDirective, { descendants: true });
  readonly tarjetaTpl = contentChild(TablaTarjetaDirective, { descendants: true });
  readonly vacioTpl = contentChild(TablaVacioDirective, { descendants: true });

  readonly plantillaCelda = computed(() => {
    const m = new Map<string, TemplateRef<ContextoFila<T>>>();
    for (const d of this.celdasTpl()) m.set(d.columna(), d.tpl as TemplateRef<ContextoFila<T>>);
    return m;
  });
  readonly plantillaEncabezado = computed(() => {
    const m = new Map<string, TemplateRef<unknown>>();
    for (const d of this.encabezadosTpl()) m.set(d.columna(), d.tpl);
    return m;
  });

  private readonly contenedor = viewChild<ElementRef<HTMLElement>>('contenedor');
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly navegacion = inject(NavegacionService);

  /** A pantalla completa se dice de dónde es la tabla: módulo y nombre. Si la
   *  pantalla no los declara, se toman de la barra superior. */
  readonly moduloVisible = computed(() => {
    const propio = this.modulo();
    if (propio && propio !== 'Sistema') return propio;
    return this.navegacion.modulo() || this.navegacion.titulo() || 'Tu Apo';
  });

  readonly tituloVisible = computed(() => {
    const propio = this.titulo();
    if (propio && propio !== 'Tabla') return propio;
    return this.navegacion.titulo() || 'Tabla';
  });

  // ── Estado ──────────────────────────────────────────────────────────────────
  readonly montado = signal(false);
  readonly tamano = signal<Tamano>('lg');
  readonly vista = signal<Vista>('tabla');
  readonly q = signal('');
  /** Lista de sugerencias abierta y la resaltada con el teclado. */
  readonly sugerenciasAbiertas = signal(false);
  readonly sugerenciaActiva = signal(0);
  readonly filtros = signal<Record<string, FiltroColumna>>({});
  readonly orden = signal<OrdenTabla | null>(null);
  readonly pagina = signal(0);
  private readonly porPaginaElegida = signal<number | null>(null);
  readonly sel = signal<RangoSeleccion | null>(null);
  readonly aviso = signal('');
  readonly descargando = signal(false);
  /** Una acción masiva corriendo: los botones de lo marcado se bloquean. */
  readonly loteEnCurso = signal(false);
  /** La tabla ocupa toda la ventana (sin API de fullscreen: así los menús de
   *  filtro y los diálogos, que viven en el overlay del CDK, se siguen viendo). */
  readonly pantallaCompleta = signal(false);
  /** Cómo se escriben las fechas. Es del equipo: se guarda con las demás
   *  preferencias de tabla y vale para todas las pantallas. */
  readonly formatoFecha = signal<FormatoFecha>('dd/mm/aaaa');

  /** Columnas que traen fechas (y si incluyen hora): se deduce de los datos. */
  readonly tiposFecha = computed<Map<string, TipoFecha>>(() => {
    const filas = this.filas();
    const mapa = new Map<string, TipoFecha>();
    if (!filas.length) return mapa;
    const muestra = filas.slice(0, 40);
    for (const c of this.columnas()) {
      const tipo = tipoDeFechas(muestra.map((f) => c.valor(f)));
      if (tipo) mapa.set(c.id, tipo);
    }
    return mapa;
  });

  /** Milisegundos de cada celda de fecha, para filtrar por rango sin re-parsear. */
  private readonly milisPorColumna = computed<Map<string, (number | null)[]>>(() => {
    const tipos = this.tiposFecha();
    const mapa = new Map<string, (number | null)[]>();
    if (!tipos.size) return mapa;
    const filas = this.filas();
    for (const c of this.columnas()) {
      if (!tipos.has(c.id)) continue;
      mapa.set(c.id, filas.map((f) => aFecha(c.valor(f))?.getTime() ?? null));
    }
    return mapa;
  });
  private readonly conOyenteDetalle = signal(false);


  private ancla: { fila: number; col: number } | null = null;
  private arrastrando = false;
  private puntero: { x: number; y: number } | null = null;
  private autoScroll: number | null = null;
  private temporizadorAviso: ReturnType<typeof setTimeout> | null = null;
  private temporizadorBusqueda: ReturnType<typeof setTimeout> | null = null;

  /** El SelectionModel no es una señal: se cuenta cada cambio para repintar. */
  readonly versionSeleccion = signal(0);

  /** Selección de la propia tabla, para las pantallas que no traen la suya. */
  private readonly selPropia = new SelectionModel<T>(true, []);

  /** El modelo que manda: el de la pantalla si lo hay, si no el de la tabla. */
  readonly modeloSeleccion = computed<SelectionModel<T> | null>(() =>
    this.seleccionable() ? (this.seleccion() ?? this.selPropia) : null);

  private readonly dialogo = inject(MatDialog);
  private readonly herramientasPantalla = inject(HerramientasPantallaService);

  /** Tablas vivas que ofrecen herramientas al asistente: la primera es «tabla», las demás «tabla2», «tabla3»… */
  private static readonly numerosEnUso = new Set<number>();

  constructor() {
    // Casillas: repintar cuando cambie la selección (también si la limpia la
    // pantalla) y soltar las filas que ya no están en los datos.
    effect((onCleanup) => {
      const sm = this.modeloSeleccion();
      if (!sm) return;
      const sub = sm.changed.subscribe(() => this.versionSeleccion.update((v) => v + 1));
      onCleanup(() => sub.unsubscribe());
    });
    effect(() => {
      const p = this.paginaServidor();
      if (p !== null && p >= 0) untracked(() => this.pagina.set(p));
    });
    effect(() => {
      const sm = this.modeloSeleccion();
      const filas = this.filas();
      if (!sm || !sm.selected.length) return;
      const vivas = new Set(filas);
      const fuera = sm.selected.filter((f) => !vivas.has(f));
      if (fuera.length) sm.deselect(...fuera);
    });
    if (!this.isBrowser) return;
    const calcular = () => {
      const w = window.innerWidth;
      this.tamano.set(w >= 1024 ? 'lg' : w >= 640 ? 'sm' : 'xs');
    };
    calcular();
    // Encabezado e índice fijos: el alto de la tabla y dónde empieza cada
    // columna fija se miden aquí (la de acciones no tiene ancho fijo).
    effect(() => {
      this.vista();
      this.filasPagina();
      this.modeloSeleccion();
      this.pantallaCompleta();
      afterNextRender(() => this.ajustarFijas(), { injector: this.injector });
    });
    const remedir = () => this.ajustarFijas();
    window.addEventListener('resize', remedir);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', remedir));
    const soltar = () => {
      this.arrastrando = false;
      this.detenerAutoScroll();
    };
    const mover = (e: MouseEvent) => {
      this.puntero = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('resize', calcular);
    window.addEventListener('mouseup', soltar);
    window.addEventListener('mousemove', mover);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', calcular);
      window.removeEventListener('mouseup', soltar);
      window.removeEventListener('mousemove', mover);
      this.detenerAutoScroll();
      if (this.temporizadorAviso) clearTimeout(this.temporizadorAviso);
      if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    });
  }

  /**
   * Herramientas de pantalla (estilo WebMCP) para el asistente IA: buscar, leer lo visible,
   * limpiar filtros y cambiar de página. Ninguna cambia datos, así que no piden confirmación.
   * Si la pantalla tiene varias tablas, la primera es «tabla_*» y las demás «tabla2_*», «tabla3_*».
   */
  private ofrecerHerramientas(): void {
    let n = 1;
    while (TablaEstandarComponent.numerosEnUso.has(n)) n++;
    TablaEstandarComponent.numerosEnUso.add(n);
    this.destroyRef.onDestroy(() => TablaEstandarComponent.numerosEnUso.delete(n));
    const p = n === 1 ? 'tabla' : `tabla${n}`;
    const cual = () => `la tabla «${this.titulo()}»`;
    const lectura = { readOnlyHint: true };
    this.herramientasPantalla.registrarEnPantalla(this.destroyRef, [
      {
        name: `${p}_buscar`, title: `Buscar en ${this.titulo()}`, annotations: lectura,
        description: `Escribe un texto en el buscador de ${cual()} y la filtra (nombre, cédula, código…). Vacío = quitar la búsqueda.`,
        inputSchema: { type: 'object', properties: { texto: { type: 'string', description: 'Lo que se busca' } }, required: ['texto'] },
        execute: (i) => {
          this.buscar(String(i['texto'] ?? ''));
          return this.modoServidor()
            ? { ok: true, nota: 'La búsqueda se envió al servidor; usa la herramienta de leer en un momento para ver las filas.' }
            : { ok: true, filas: this.totalFiltradas() };
        },
      },
      {
        name: `${p}_leer`, title: `Leer ${this.titulo()}`, annotations: lectura,
        description: `Devuelve lo que se ve en ${cual()}: columnas, las filas de la página actual (como texto) y el total con los filtros aplicados.`,
        inputSchema: { type: 'object', properties: { max: { type: 'integer', minimum: 1, maximum: 50, description: 'Filas a devolver (por defecto 20)' } } },
        execute: (i) => this.resumenParaIa(Math.min(Math.max(Number(i['max']) || 20, 1), 50)),
      },
      {
        name: `${p}_limpiar_filtros`, title: `Limpiar filtros de ${this.titulo()}`, annotations: lectura,
        description: `Quita la búsqueda, los filtros por columna y el orden de ${cual()}.`,
        inputSchema: { type: 'object', properties: {} },
        execute: () => { this.limpiarTodo(); return { ok: true }; },
      },
      {
        name: `${p}_ir_a_pagina`, title: `Cambiar de página en ${this.titulo()}`, annotations: lectura,
        description: `Va a una página de ${cual()} (la primera es 1).`,
        inputSchema: { type: 'object', properties: { pagina: { type: 'integer', minimum: 1 } }, required: ['pagina'] },
        execute: (i) => {
          this.irAPagina((Number(i['pagina']) || 1) - 1);
          return { ok: true, pagina: this.paginaActual() + 1, paginas: this.totalPaginas() };
        },
      },
    ]);
    // Contexto de pantalla: el asistente siempre sabe qué muestra esta tabla (15 filas visibles).
    this.herramientasPantalla.contextoEnPantalla(this.destroyRef, p, () => this.resumenParaIa(15));
  }

  /** Lo que se ve en la tabla, como texto: columnas, filas de la página, total, búsqueda y marcadas. */
  private resumenParaIa(max: number): Record<string, unknown> {
    const cols = this.columnasVisibles();
    const filas = this.filasPagina().slice(0, max).map((f) => {
      const o: Record<string, string> = {};
      for (const c of cols) o[c.header || c.id] = this.textoCelda(c, f);
      return o;
    });
    return {
      tabla: this.titulo(), columnas: cols.map((c) => c.header || c.id), filas,
      total: this.totalFiltradas(), pagina: this.paginaActual() + 1, paginas: this.totalPaginas(),
      busqueda: this.q() || null, hayFiltros: this.hayFiltros(), marcadas: this.marcadas(),
    };
  }

  /** Si la pantalla se destruye con la tabla fuera de su sitio, se devuelve. */
  private registrarLimpieza(): void {
    this.destroyRef.onDestroy(() => {
      this.devolverASuSitio();
      for (const el of this.ancestrosSoltados) el.classList.remove('te-sin-marco');
      this.ancestrosSoltados = [];
    });
  }

  ngOnInit(): void {
    this.registrarLimpieza();
    this.conOyenteDetalle.set(this.filaClick.observed);
    if (!this.isBrowser) return;
    this.montado.set(true);
    this.ofrecerHerramientas();
    const fmt = getLocalStorageItem('tabla:formatoFecha');
    if (fmt === 'dd/mm/aaaa' || fmt === 'mm/dd/aaaa' || fmt === 'aaaa-mm-dd') this.formatoFecha.set(fmt);
    const guardada = getLocalStorageItem(`tabla:${this.id()}:vista`);
    if (guardada === 'tabla' || guardada === 'tarjetas') {
      this.vista.set(guardada);
    } else if (this.vistaInicial() === 'auto') {
      this.vista.set(window.innerWidth < 768 ? 'tarjetas' : 'tabla');
    } else {
      this.vista.set(this.vistaInicial() as Vista);
    }
  }

  // ── Derivados ───────────────────────────────────────────────────────────────
  readonly modoServidor = computed(() => this.totalServidor() !== null);
  readonly filas = computed<T[]>(() => this.datos() ?? []);
  readonly porPagina = computed(() => {
    // A pantalla completa se ve todo de una: la paginación ahí estorba.
    if (this.pantallaCompleta() && !this.modoServidor()) return 0;
    return this.porPaginaElegida() ?? this.filasPorPagina();
  });
  readonly conDetalle = computed(() => this.detalle() ?? this.conOyenteDetalle());
  readonly hayAcciones = computed(() => !!this.accionesTpl() || this.conDetalle());

  /** Columnas según el ancho. Tiene que ser en JS y no con CSS: la selección y
   *  el copiado trabajan sobre estos índices, y con CSS un rango copiaría
   *  columnas que en pantalla no se ven. */
  readonly columnasVisibles = computed(() => {
    const cols = this.columnas();
    if (!this.montado()) return cols;
    const t = this.tamano();
    return cols.filter((c) => {
      const p = c.prioridad ?? 1;
      if (p === 1) return true;
      if (p === 2) return t !== 'xs';
      return t === 'lg';
    });
  });

  /** Texto de cada celda (filas × columnas), una sola vez por cambio de datos. */
  private readonly matriz = computed(() => {
    const cols = this.columnas();
    const tipos = this.tiposFecha();
    const formato = this.formatoFecha();
    return this.filas().map((f) => cols.map((c) => {
      const tipo = tipos.get(c.id);
      if (tipo) {
        const fecha = aFecha(c.valor(f));
        if (fecha) return escribirFecha(fecha, formato, tipo);
      }
      return textoDeValor(c.valor(f));
    }));
  });
  /** Una fecha suelta con el formato elegido; null si el valor no es fecha. */
  private textoDeFecha(v: ValorCelda): string | null {
    const f = aFecha(v);
    if (!f) return null;
    const conHora = !!(f.getHours() || f.getMinutes() || f.getSeconds());
    return escribirFecha(f, this.formatoFecha(), conHora ? 'fecha-hora' : 'fecha');
  }

  private readonly textosBusqueda = computed(() => this.matriz().map((r) => r.join(' ').toLowerCase()));
  private readonly indiceColumna = computed(() => new Map(this.columnas().map((c, i) => [c.id, i])));

  private pasaFiltro(i: number, excepto?: string): boolean {
    const fila = this.matriz()[i];
    const idx = this.indiceColumna();
    const fs = this.filtros();
    for (const id in fs) {
      if (id === excepto) continue;
      const f = fs[id];
      const ci = idx.get(id);
      if (ci === undefined) continue;
      const v = fila[ci];
      const t = f.texto.trim().toLowerCase();
      if (t && !v.toLowerCase().includes(t)) return false;
      if (f.valores && !f.valores.includes(v)) return false;
      if (f.desde || f.hasta) {
        const ms = this.milisPorColumna().get(id)?.[i] ?? null;
        if (ms === null) return false;
        const desde = limiteDelRango(f.desde, 'desde');
        const hasta = limiteDelRango(f.hasta, 'hasta');
        if (desde !== null && ms < desde) return false;
        if (hasta !== null && ms > hasta) return false;
      }
    }
    return true;
  }

  /** Índices de las filas que pasan búsqueda + filtros. */
  private readonly filtradas = computed<number[]>(() => {
    const n = this.filas().length;
    const todos = Array.from({ length: n }, (_, i) => i);
    if (this.modoServidor()) return todos;
    const busca = this.q().trim().toLowerCase();
    const textos = this.textosBusqueda();
    this.filtros(); // dependencia explícita
    return todos.filter((i) => (!busca || textos[i].includes(busca)) && this.pasaFiltro(i));
  });

  private readonly ordenadas = computed<number[]>(() => {
    const base = this.filtradas();
    const o = this.orden();
    if (!o || this.modoServidor()) return base;
    const ci = this.indiceColumna().get(o.columna);
    if (ci === undefined) return base;
    const col = this.columnas()[ci];
    const filas = this.filas();
    const textos = this.matriz();
    const signo = o.direccion === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const va = col.valor(filas[a]);
      const vb = col.valor(filas[b]);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * signo;
      if (va instanceof Date && vb instanceof Date) return (va.getTime() - vb.getTime()) * signo;
      const ta = textos[a][ci];
      const tb = textos[b][ci];
      // Los vacíos siempre al final, sea cual sea la dirección.
      if (ta === '' && tb !== '') return 1;
      if (tb === '' && ta !== '') return -1;
      return COLLATOR.compare(ta, tb) * signo;
    });
  });

  readonly totalFiltradas = computed(() =>
    this.modoServidor() ? this.totalServidor() ?? 0 : this.ordenadas().length,
  );

  readonly totalPaginas = computed(() => {
    const pp = this.porPagina();
    if (pp <= 0) return 1;
    return Math.max(1, Math.ceil(this.totalFiltradas() / pp));
  });
  readonly paginaActual = computed(() => Math.min(this.pagina(), this.totalPaginas() - 1));

  /** Índices (sobre `filas`) de lo que se pinta. */
  private readonly indicesPagina = computed<number[]>(() => {
    const ord = this.ordenadas();
    const pp = this.porPagina();
    if (this.modoServidor() || pp <= 0) return ord;
    const p = this.paginaActual();
    return ord.slice(p * pp, (p + 1) * pp);
  });
  readonly filasPagina = computed<T[]>(() => {
    const filas = this.filas();
    return this.indicesPagina().map((i) => filas[i]);
  });

  readonly hayFiltros = computed(
    () => this.q().trim() !== ''
      || Object.values(this.filtros()).some((f) => f.texto || f.valores || f.desde || f.hasta),
  );
  readonly columnasCopiables = computed(() => this.columnasVisibles().filter((c) => c.copiable !== false));
  readonly mostrarPaginador = computed(() => {
    const minimo = Math.min(...(this.opcionesPorPagina() ?? OPCIONES_PAGINA).filter((n) => n > 0));
    return this.porPagina() > 0 && this.totalFiltradas() > minimo;
  });
  readonly pieValores = computed(() => {
    const pie = this.pie();
    if (!pie) return null;
    const filas = this.filas();
    return pie(this.ordenadas().map((i) => filas[i]));
  });
  /** Las opciones de siempre más el tamaño en uso si no está entre ellas
   *  (una pantalla en modo servidor puede pedir 10 o 20). */
  readonly opcionesPagina = computed(() => {
    const actual = this.porPagina();
    const propias = this.opcionesPorPagina();
    const base = propias?.length
      ? propias
      : this.modoServidor() ? OPCIONES_PAGINA.filter((n) => n > 0) : OPCIONES_PAGINA;
    if (base.includes(actual)) return base;
    return [...base.filter((n) => n > 0), actual].sort((a, b) => a - b).concat(base.includes(0) ? [0] : []);
  });
  readonly desdeFila = computed(() => this.paginaActual() * Math.max(this.porPagina(), 0));
  readonly placeholderBusqueda = computed(() => {
    const b = this.busqueda();
    return typeof b === 'string' ? b : 'Buscar…';
  });

  // ── Acciones de barra ───────────────────────────────────────────────────────
  cambiarVista(nueva: Vista): void {
    this.vista.set(nueva);
    this.sel.set(null);
    setLocalStorageItem(`tabla:${this.id()}:vista`, nueva);
  }

  buscar(texto: string): void {
    this.q.set(texto);
    this.reiniciar();
    if (this.modoServidor() || this.sugerencias() !== null) {
      if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
      this.temporizadorBusqueda = setTimeout(() => this.busquedaCambio.emit(texto.trim()), 350);
    }
    this.sugerenciasAbiertas.set(true);
    this.sugerenciaActiva.set(0);
  }

  elegirSugerencia(s: SugerenciaBusqueda): void {
    this.sugerenciasAbiertas.set(false);
    this.buscar('');
    this.sugerenciaElegida.emit(s);
  }

  /** ↑ ↓ recorren la lista, Enter elige, Escape la cierra. */
  teclaBuscador(ev: KeyboardEvent): void {
    const lista = this.sugerencias() ?? [];
    if (!lista.length || !this.sugerenciasAbiertas()) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const paso = ev.key === 'ArrowDown' ? 1 : -1;
      this.sugerenciaActiva.set((this.sugerenciaActiva() + paso + lista.length) % lista.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      this.elegirSugerencia(lista[Math.min(this.sugerenciaActiva(), lista.length - 1)]);
    } else if (ev.key === 'Escape') {
      this.sugerenciasAbiertas.set(false);
    }
  }

  /** Al salir del buscador la lista se cierra (tras dejar pasar el clic en ella). */
  cerrarSugerencias(): void {
    setTimeout(() => this.sugerenciasAbiertas.set(false), 150);
  }

  cambiarFiltro(colId: string, f: FiltroColumna): void {
    this.filtros.update((prev) => {
      const siguiente = { ...prev };
      // Un filtro vacío se borra del estado: así `hayFiltros` es exacto.
      if (!f.texto && f.valores === null && !f.desde && !f.hasta) delete siguiente[colId];
      else siguiente[colId] = f;
      return siguiente;
    });
    this.reiniciar();
  }

  cambiarOrden(colId: string, dir: DireccionOrden | null): void {
    const o = dir ? { columna: colId, direccion: dir } : null;
    this.orden.set(o);
    this.reiniciar();
    // Se avisa siempre: en cliente es informativo (hay pantallas que reordenan
    // también en el servidor para exportar); en servidor es quien manda.
    this.ordenCambio.emit(o);
  }

  cambiarPorPagina(n: number): void {
    this.porPaginaElegida.set(n);
    this.reiniciar();
    if (this.modoServidor()) this.paginaCambio.emit({ pagina: 0, porPagina: n });
  }

  irAPagina(p: number): void {
    const destino = Math.max(0, Math.min(p, this.totalPaginas() - 1));
    this.pagina.set(destino);
    this.sel.set(null);
    if (this.modoServidor()) this.paginaCambio.emit({ pagina: destino, porPagina: this.porPagina() });
  }

  /** Vuelve a la primera página sin emitir nada (la pantalla ya va a consultar). */
  reiniciarPagina(): void {
    this.pagina.set(0);
    this.sel.set(null);
  }

  /**
   * Mide dónde empieza cada columna fija y cuánto alto le queda a la tabla.
   * El alto se calcula desde su sitio en la pantalla: así el encabezado se
   * queda arriba sin tapar el paginador ni dejar la tabla enana.
   */
  private ajustarFijas(): void {
    const cont = this.contenedor()?.nativeElement;
    if (!cont) return;

    const ancho = (sel: string) => cont.querySelector<HTMLElement>(sel)?.getBoundingClientRect().width ?? 0;
    const xMarca = ancho('thead .te-num');
    const xAcciones = xMarca + ancho('thead .te-marca');
    cont.style.setProperty('--te-x-marca', `${Math.round(xMarca)}px`);
    cont.style.setProperty('--te-x-acciones', `${Math.round(xAcciones)}px`);
    cont.dataset['ultimaFija'] = cont.querySelector('thead .te-th--acciones') ? 'acciones'
      : cont.querySelector('thead .te-marca') ? 'marca' : 'num';

    if (this.pantallaCompleta()) {
      cont.style.removeProperty('--te-alto-max');
    } else {
      const arriba = cont.getBoundingClientRect().top;
      const libre = Math.round(window.innerHeight - arriba - 92);   // deja ver el paginador
      cont.style.setProperty('--te-alto-max', `${Math.max(320, libre)}px`);
    }

    if (!this.oyenteScrollFijas) {
      this.oyenteScrollFijas = () => cont.classList.toggle('te-contenedor--desplazada', cont.scrollLeft > 0);
      cont.addEventListener('scroll', this.oyenteScrollFijas, { passive: true });
      this.destroyRef.onDestroy(() => {
        if (this.oyenteScrollFijas) cont.removeEventListener('scroll', this.oyenteScrollFijas);
      });
    }
    this.oyenteScrollFijas();
  }

  private oyenteScrollFijas?: () => void;

  alternarPantallaCompleta(): void {
    const activar = !this.pantallaCompleta();
    this.pantallaCompleta.set(activar);
    // La clase se aplica también a mano: si la pantalla tiene un error de JS, la
    // detección de cambios se queda atascada y el `host` binding no llega a
    // pintarse; entonces el botón «parecía» no hacer nada.
    this.hostRef.nativeElement.classList.toggle('te-completa', activar);
    this.soltarAncestros(activar);
    if (!activar) this.devolverASuSitio();
    afterNextRender(() => {
      this.hostRef.nativeElement.classList.toggle('te-completa', this.pantallaCompleta());
      this.soltarAncestros(this.pantallaCompleta());
      if (this.pantallaCompleta()) {
        this.asegurarQueCubre();
        this.hacerTirasArrastrables();
      }
      this.respaldoDeCabecera(this.pantallaCompleta());
      this.ajustarFijas();
    }, { injector: this.injector });
  }

  /**
   * Respaldo para pantallas rotas: si la detección de cambios está atascada por
   * un error ajeno, la cabecera «módulo · tabla» y el botón de salir no llegan a
   * pintarse y la tabla se queda ocupando todo sin salida visible. Cuando falta,
   * se pintan a mano.
   */
  private respaldoDeCabecera(activar: boolean): void {
    if (!this.isBrowser) return;
    const host = this.hostRef.nativeElement;
    const puesto = host.querySelector<HTMLElement>('.te-donde--respaldo');
    if (!activar) { puesto?.remove(); return; }
    if (puesto || host.querySelector('.te-donde')) return;
    const caja = document.createElement('div');
    caja.className = 'te-donde te-donde--respaldo';
    const modulo = document.createElement('span');
    modulo.className = 'te-donde__modulo';
    modulo.textContent = this.moduloVisible();
    const sep = document.createElement('span');
    sep.className = 'te-donde__sep';
    sep.textContent = '·';
    const titulo = document.createElement('span');
    titulo.className = 'te-donde__titulo';
    titulo.textContent = this.tituloVisible();
    const salir = document.createElement('button');
    salir.type = 'button';
    salir.className = 'te-btn te-donde__salir';
    salir.textContent = 'Salir de pantalla completa';
    salir.addEventListener('click', () => this.salirDePantallaCompleta());
    caja.append(modulo, sep, titulo, salir);
    host.prepend(caja);
  }

  /**
   * A pantalla completa, la barra de herramientas y la de lo marcado van en
   * UNA línea y se desplazan de lado. Con el dedo ya deslizan solas; con ratón
   * se arrastran y la rueda las mueve. Se escucha en el host (y no en cada
   * tira) porque la barra de lo marcado aparece y desaparece con la selección.
   */
  private tirasArrastrables = false;
  private static readonly TIRAS = '.te-barra__der, .te-masivas';

  private hacerTirasArrastrables(): void {
    if (this.tirasArrastrables || !this.isBrowser) return;
    this.tirasArrastrables = true;
    const host = this.hostRef.nativeElement;
    const tiraDe = (e: Event): HTMLElement | null => {
      if (!this.pantallaCompleta()) return null;
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>(TablaEstandarComponent.TIRAS) ?? null;
      return t && t.scrollWidth > t.clientWidth ? t : null;
    };
    let tira: HTMLElement | null = null;
    let x0 = 0;
    let scroll0 = 0;
    host.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const t = tiraDe(e);
      if (!t || (e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
      tira = t;
      x0 = e.clientX;
      scroll0 = t.scrollLeft;
      t.classList.add('te-tira--arrastrando');
      t.setPointerCapture(e.pointerId);
    });
    host.addEventListener('pointermove', (e) => {
      if (tira) tira.scrollLeft = scroll0 - (e.clientX - x0);
    });
    const soltar = (e: PointerEvent) => {
      if (!tira) return;
      tira.classList.remove('te-tira--arrastrando');
      try { tira.releasePointerCapture(e.pointerId); } catch { /* ya soltado */ }
      tira = null;
    };
    host.addEventListener('pointerup', soltar);
    host.addEventListener('pointercancel', soltar);
    // La rueda vertical mueve la tira: es lo natural cuando no cabe de ancho.
    host.addEventListener('wheel', (e) => {
      const t = tiraDe(e);
      if (!t || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      t.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  /** Dónde estaba la tabla antes de sacarla al cuerpo de la página. */
  private anclaOriginal: Comment | null = null;

  /**
   * Último recurso: si tras neutralizar los ancestros la caja sigue sin cubrir
   * la ventana (hay pantallas con contenedores que siguen haciendo de marco),
   * la tabla se cuelga del `body` y se deja una marca para devolverla al salir.
   */
  private asegurarQueCubre(): void {
    if (!this.isBrowser || this.anclaOriginal) return;
    const host = this.hostRef.nativeElement;
    const r = host.getBoundingClientRect();
    const cubre = Math.abs(r.left) <= 1 && Math.abs(r.top) <= 1
      && Math.abs(r.width - window.innerWidth) <= 2 && Math.abs(r.height - window.innerHeight) <= 2;
    if (cubre) return;
    const ancla = document.createComment('tabla-estandar a pantalla completa');
    host.parentNode?.insertBefore(ancla, host);
    this.anclaOriginal = ancla;
    document.body.appendChild(host);
  }

  private devolverASuSitio(): void {
    const ancla = this.anclaOriginal;
    if (!ancla) return;
    this.anclaOriginal = null;
    ancla.parentNode?.insertBefore(this.hostRef.nativeElement, ancla);
    ancla.remove();
  }

  /** Ancestros neutralizados mientras la tabla está a pantalla completa. */
  private ancestrosSoltados: HTMLElement[] = [];

  /**
   * `position: fixed` se mide contra la ventana… salvo si algún ancestro tiene
   * `transform`, `filter`, `perspective`, `backdrop-filter` o `contain`: ese
   * pasa a ser el marco y la tabla queda encajada en su trozo de pantalla (es
   * lo que pasaba en Nómina › Empleados). Mientras dure la pantalla completa se
   * les quita esa propiedad, y al salir se les devuelve.
   */
  private soltarAncestros(activar: boolean): void {
    for (const el of this.ancestrosSoltados) el.classList.remove('te-sin-marco');
    this.ancestrosSoltados = [];
    if (!activar || !this.isBrowser) return;
    const host = this.hostRef.nativeElement;
    for (let e = host.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const encajona = (cs.transform && cs.transform !== 'none')
        || (cs.filter && cs.filter !== 'none')
        || (cs.perspective && cs.perspective !== 'none')
        || (cs.backdropFilter && cs.backdropFilter !== 'none')
        || (cs.contain && /paint|layout|strict|content/.test(cs.contain))
        || cs.willChange.includes('transform') || cs.willChange.includes('filter');
      if (!encajona) continue;
      e.classList.add('te-sin-marco');
      this.ancestrosSoltados.push(e);
    }
  }

  @HostListener('document:keydown.escape')
  salirDePantallaCompleta(): void {
    if (!this.pantallaCompleta()) return;
    this.pantallaCompleta.set(false);
    this.hostRef.nativeElement.classList.remove('te-completa');
    this.soltarAncestros(false);
    this.devolverASuSitio();
    this.respaldoDeCabecera(false);
  }

  /**
   * Los filtros puestos, a la vista junto al buscador: cada uno se quita por
   * separado y «Limpiar todo» los borra de una vez.
   */
  readonly filtrosActivos = computed<{ id: string; etiqueta: string; valor: string }[]>(() => {
    const lista: { id: string; etiqueta: string; valor: string }[] = [];
    const texto = this.q().trim();
    if (texto) lista.push({ id: '__busqueda', etiqueta: 'Búsqueda', valor: texto });
    const columnas = this.columnas();
    for (const [id, filtro] of Object.entries(this.filtros())) {
      if (!filtro?.texto && !filtro?.valores?.length && !filtro?.desde && !filtro?.hasta) continue;
      const columna = columnas.find((c) => c.id === id);
      const valores = filtro.valores ?? [];
      const tipo = this.tiposFecha().get(id);
      const enFormato = (iso: string) => {
        const f = aFecha(iso);
        return f ? escribirFecha(f, this.formatoFecha(), tipo ?? 'fecha') : iso;
      };
      const valor = filtro.desde || filtro.hasta
        ? `${filtro.desde ? enFormato(filtro.desde) : '…'} → ${filtro.hasta ? enFormato(filtro.hasta) : '…'}`
        : filtro.texto
          ? filtro.texto
          : valores.length <= 2 ? valores.join(', ') : `${valores.length} valores`;
      lista.push({ id, etiqueta: columna?.header ?? id, valor });
    }
    return lista;
  });

  quitarFiltro(id: string): void {
    if (id === '__busqueda') {
      this.buscar('');
      return;
    }
    this.filtros.update((prev) => {
      const siguiente = { ...prev };
      delete siguiente[id];
      return siguiente;
    });
    this.reiniciar();
  }

  limpiarTodo(): void {
    const habiaBusqueda = this.q() !== '';
    const habiaOrden = !!this.orden();
    this.q.set('');
    this.filtros.set({});
    this.orden.set(null);
    this.reiniciar();
    if (habiaOrden) this.ordenCambio.emit(null);
    if ((this.modoServidor() || this.sugerencias() !== null) && habiaBusqueda) this.busquedaCambio.emit('');
  }

  /** Cambiar búsqueda, filtros, orden o filas por página vuelve a la página 1.
   *  En modo servidor no se emite página aquí: quien escucha la búsqueda o el
   *  orden ya vuelve a la primera al consultar, y emitir daría dos consultas. */
  private reiniciar(): void {
    this.pagina.set(0);
    this.sel.set(null);
  }

  /** Valores distintos de una columna con los DEMÁS filtros aplicados (cascada). */
  valoresDe(col: ColumnaTabla<T>): () => string[] {
    return () => {
      const ci = this.indiceColumna().get(col.id);
      if (ci === undefined) return [];
      const busca = this.q().trim().toLowerCase();
      const textos = this.textosBusqueda();
      const m = this.matriz();
      const set = new Set<string>();
      for (let i = 0; i < m.length; i++) {
        if (busca && !textos[i].includes(busca)) continue;
        if (!this.pasaFiltro(i, col.id)) continue;
        set.add(m[i][ci]);
      }
      return [...set].sort((a, b) => COLLATOR.compare(a, b));
    };
  }

  /** Una función por columna, estable mientras no cambien las columnas. */
  readonly obtenedores = computed(() => new Map(this.columnas().map((c) => [c.id, this.valoresDe(c)])));

  filtroDe(colId: string): FiltroColumna {
    return this.filtros()[colId] ?? FILTRO_VACIO;
  }

  ordenDe(colId: string): DireccionOrden | null {
    const o = this.orden();
    return o?.columna === colId ? o.direccion : null;
  }

  // ── Celdas ──────────────────────────────────────────────────────────────────
  textoCelda(col: ColumnaTabla<T>, fila: T): string {
    const tipo = this.tiposFecha().get(col.id);
    if (tipo) {
      // Si la pantalla ya da un texto propio, manda el suyo salvo que también
      // sea una fecha (entonces se respeta el formato elegido aquí).
      const propio = col.formato?.(fila);
      const fecha = aFecha(propio ?? col.valor(fila));
      if (fecha) return escribirFecha(fecha, this.formatoFecha(), tipo);
      if (propio !== undefined) return propio;
    } else if (col.formato) {
      return col.formato(fila);
    }
    return textoDeValor(col.valor(fila));
  }

  cambiarFormatoFecha(formato: FormatoFecha): void {
    this.formatoFecha.set(formato);
    setLocalStorageItem('tabla:formatoFecha', formato);
  }

  tipoFechaDe(id: string): TipoFecha | null {
    return this.tiposFecha().get(id) ?? null;
  }

  badgeDe(col: ColumnaTabla<T>, fila: T): BadgeCelda | null {
    return col.badge ? col.badge(fila) ?? null : null;
  }

  claseCelda(col: ColumnaTabla<T>, fila: T): string {
    const c = col.clase;
    return typeof c === 'function' ? c(fila) : c ?? '';
  }

  claseFila(fila: T): string {
    return this.filaClase()?.(fila) ?? '';
  }

  track = (i: number, fila: T): unknown => {
    const fn = this.filaId();
    return fn ? fn(fila, i) : i;
  };

  contexto(fila: T, indice: number): ContextoFila<T> {
    return { $implicit: fila, fila, indice };
  }

  private textoParaCopiar(col: ColumnaTabla<T>, fila: T): string {
    if (col.copiaTexto) return col.copiaTexto(fila);
    const v = col.valor(fila);
    // Una fecha se copia como se ve (con hora si el formato la trae), no con
    // el texto corto por defecto del Date.
    if (v instanceof Date && col.formato) return col.formato(fila);
    return textoDeValor(v);
  }

  // ── Tarjeta automática ──────────────────────────────────────────────────────
  /** Columnas agrupadas por rol. Sin rol: 1.ª título, 2.ª subtítulo, resto meta. */
  readonly roles = computed(() => {
    const grupos: Record<RolTarjeta, ColumnaTabla<T>[]> = {
      titulo: [], subtitulo: [], badge: [], meta: [], cuerpo: [], oculto: [],
    };
    this.columnas().forEach((c, i) => {
      const rol: RolTarjeta = c.tarjeta ?? (i === 0 ? 'titulo' : i === 1 ? 'subtitulo' : 'meta');
      grupos[rol].push(c);
    });
    return grupos;
  });

  /** Una etiqueta sin valor («Cargo:» y nada más) solo mete ruido en la tarjeta. */
  conValor(cols: ColumnaTabla<T>[], fila: T): ColumnaTabla<T>[] {
    return cols.filter((c) => this.plantillaCelda().has(c.id) || textoDeValor(c.valor(fila)).trim() !== '');
  }

  // ── Copiado y descarga ──────────────────────────────────────────────────────
  private armarBloque(origen: Origen): BloqueCopiado | null {
    const filas = this.filas();
    const sel = this.sel();
    // Casillas marcadas: van completas y en el orden en que se ven.
    if (origen === 'marcadas') {
      const sm = this.modeloSeleccion();
      const cols = this.columnasCopiables();
      if (!sm || !cols.length) return null;
      const elegidas = this.ordenadas().map((i) => filas[i]).filter((f) => sm.isSelected(f));
      if (!elegidas.length) return null;
      return {
        encabezados: cols.map((c) => c.header),
        filas: elegidas.map((f) => cols.map((c) => this.textoParaCopiar(c, f))),
      };
    }
    if (origen === 'todo' || !sel) {
      const cols = this.columnasCopiables();
      const ord = this.ordenadas();
      if (!ord.length || !cols.length) return null;
      return {
        encabezados: cols.map((c) => c.header),
        filas: ord.map((i) => cols.map((c) => this.textoParaCopiar(c, filas[i]))),
      };
    }
    const { r1, r2, c1, c2 } = normalizar(sel);
    const cols = this.columnasVisibles().slice(c1, c2 + 1).filter((c) => c.copiable !== false);
    const pagina = this.filasPagina();
    const elegidas = pagina.slice(r1, r2 + 1);
    if (!cols.length || !elegidas.length) return null;
    // Al seleccionar columnas completas se copian también los encabezados.
    const columnaCompleta = r1 === 0 && r2 === pagina.length - 1;
    return {
      encabezados: columnaCompleta ? cols.map((c) => c.header) : [],
      filas: elegidas.map((f) => cols.map((c) => this.textoParaCopiar(c, f))),
    };
  }

  private anunciar(mensaje: string): void {
    this.aviso.set(mensaje);
    if (this.temporizadorAviso) clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = setTimeout(() => this.aviso.set(''), 2200);
  }

  async copiar(origen: Origen): Promise<void> {
    const bloque = this.armarBloque(origen);
    if (!bloque) return;
    // «Copiar marcadas» lleva solo el contenido de las filas (para pegar bajo un
    // encabezado que ya existe); el Excel de lo marcado sí conserva el encabezado.
    if (origen === 'marcadas') bloque.encabezados = [];
    const ok = await copiarBloque(bloque);
    if (!ok) {
      this.anunciar('No se pudo copiar');
      return;
    }
    this.anunciar(`${bloque.filas.length} fila(s) copiadas`);
    void registrarCopia({
      modulo: this.modulo(),
      entidad: this.entidad(),
      titulo: this.titulo(),
      filas: bloque.filas.length,
      columnas: bloque.encabezados.length ? bloque.encabezados : this.columnasCopiables().map((c) => c.header),
      origen: this.sel() && origen === 'seleccion' ? 'seleccion' : 'todo',
    });
  }

  async descargar(soloMarcadas = false): Promise<void> {
    const bloque = this.armarBloque(soloMarcadas ? 'marcadas' : 'todo');
    if (!bloque) return;
    this.descargando.set(true);
    try {
      await descargarExcel(bloque, this.titulo().toLowerCase().replace(/\s+/g, '_'), this.titulo());
      this.anunciar('Excel descargado');
    } catch {
      this.anunciar('No se pudo generar el Excel');
      return;
    } finally {
      this.descargando.set(false);
    }
    void registrarCopia({
      modulo: this.modulo(),
      entidad: this.entidad(),
      titulo: this.titulo(),
      filas: bloque.filas.length,
      columnas: bloque.encabezados,
      origen: 'descarga',
    });
  }

  // ── Selección con mouse y teclado ───────────────────────────────────────────
  enSeleccion(fila: number, col: number): boolean {
    const s = this.sel();
    if (!s) return false;
    const { r1, r2, c1, c2 } = normalizar(s);
    return fila >= r1 && fila <= r2 && col >= c1 && col <= c2;
  }

  private celdaDom(fila: number, col: number): HTMLElement | null {
    return this.contenedor()?.nativeElement.querySelector<HTMLElement>(`[data-celda="${fila}:${col}"]`) ?? null;
  }

  /** Mueve lo mínimo para dejar la celda a la vista, como una hoja de cálculo. */
  private acercarCelda(fila: number, col: number, ejes: 'ambos' | 'horizontal'): void {
    const contenedor = this.contenedor()?.nativeElement;
    const celda = this.celdaDom(fila, col);
    if (!contenedor || !celda) return;
    const c = contenedor.getBoundingClientRect();
    const e = celda.getBoundingClientRect();
    if (e.left < c.left + MARGEN_SCROLL) contenedor.scrollLeft += e.left - c.left - MARGEN_SCROLL;
    else if (e.right > c.right - MARGEN_SCROLL) contenedor.scrollLeft += e.right - c.right + MARGEN_SCROLL;
    if (ejes === 'horizontal') return;
    const vertical = ancestroVertical(contenedor);
    const { arriba, abajo } = limitesVerticales(vertical);
    if (e.top < arriba + MARGEN_SCROLL) desplazarVertical(vertical, e.top - arriba - MARGEN_SCROLL);
    else if (e.bottom > abajo - MARGEN_SCROLL) desplazarVertical(vertical, e.bottom - abajo + MARGEN_SCROLL);
  }

  /** La vista sigue a la celda activa después de pintar la nueva selección. */
  private seguir(fila: number, col: number, ejes: 'ambos' | 'horizontal' = 'ambos'): void {
    afterNextRender(() => this.acercarCelda(fila, col, ejes), { injector: this.injector });
  }

  private fijarSel(r: RangoSeleccion): void {
    const s = this.sel();
    if (s && s.filaInicio === r.filaInicio && s.colInicio === r.colInicio && s.filaFin === r.filaFin && s.colFin === r.colFin) return;
    this.sel.set(r);
  }

  onCeldaMouseDown(ev: MouseEvent, fila: number, col: number, colDef: ColumnaTabla<T>): void {
    // Las celdas con controles no entran en la selección: el clic es del control.
    if (colDef.interactiva || ev.button !== 0) return;
    this.arrastrando = true;
    this.puntero = { x: ev.clientX, y: ev.clientY };
    if (ev.shiftKey && this.ancla) {
      this.fijarSel({ filaInicio: this.ancla.fila, colInicio: this.ancla.col, filaFin: fila, colFin: col });
    } else {
      this.ancla = { fila, col };
      this.fijarSel({ filaInicio: fila, colInicio: col, filaFin: fila, colFin: col });
    }
    this.seguir(fila, col);
    this.contenedor()?.nativeElement.focus({ preventScroll: true });
    this.iniciarAutoScroll();
  }

  onCeldaMouseEnter(fila: number, col: number, colDef: ColumnaTabla<T>): void {
    if (colDef.interactiva || !this.arrastrando || !this.ancla) return;
    this.fijarSel({ filaInicio: this.ancla.fila, colInicio: this.ancla.col, filaFin: fila, colFin: col });
  }

  seleccionarColumna(col: number): void {
    const n = this.filasPagina().length;
    if (!n) return;
    this.ancla = { fila: 0, col };
    this.fijarSel({ filaInicio: 0, colInicio: col, filaFin: n - 1, colFin: col });
    // Solo en horizontal: al marcar una columna la vista no debe saltar de fila.
    this.seguir(0, col, 'horizontal');
    this.contenedor()?.nativeElement.focus({ preventScroll: true });
  }

  seleccionarFila(fila: number): void {
    this.ancla = { fila, col: 0 };
    this.fijarSel({ filaInicio: fila, colInicio: 0, filaFin: fila, colFin: this.columnasVisibles().length - 1 });
    this.seguir(fila, 0);
    this.contenedor()?.nativeElement.focus({ preventScroll: true });
  }

  seleccionarTodo(): void {
    const n = this.filasPagina().length;
    if (!n) return;
    this.ancla = { fila: 0, col: 0 };
    this.fijarSel({ filaInicio: 0, colInicio: 0, filaFin: n - 1, colFin: this.columnasVisibles().length - 1 });
  }

  onTecla(e: KeyboardEvent): void {
    // Dentro de un control de celda (input, select, textarea) las teclas son
    // suyas: Ctrl+A selecciona su texto y las flechas mueven el cursor.
    const destino = e.target as HTMLElement | null;
    if (destino && (destino.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(destino.tagName))) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.seleccionarTodo();
      return;
    }
    if (e.key === 'Escape') {
      this.sel.set(null);
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'c') {
      // Las celdas no son texto seleccionable: el navegador no dispara `copy`
      // solo, así que se copia a mano desde la tecla.
      if (!this.copiable() || !this.sel()) return;
      e.preventDefault();
      void this.copiar('seleccion');
      return;
    }
    const s = this.sel();
    if (!s) return;
    const mover = (df: number, dc: number) => {
      e.preventDefault();
      const fila = Math.min(Math.max(0, s.filaFin + df), Math.max(0, this.filasPagina().length - 1));
      const col = Math.min(Math.max(0, s.colFin + dc), this.columnasVisibles().length - 1);
      if (e.shiftKey && this.ancla) {
        this.fijarSel({ filaInicio: this.ancla.fila, colInicio: this.ancla.col, filaFin: fila, colFin: col });
      } else {
        this.ancla = { fila, col };
        this.fijarSel({ filaInicio: fila, colInicio: col, filaFin: fila, colFin: col });
      }
      this.seguir(fila, col);
    };
    if (e.key === 'ArrowDown') mover(1, 0);
    else if (e.key === 'ArrowUp') mover(-1, 0);
    else if (e.key === 'ArrowRight') mover(0, 1);
    else if (e.key === 'ArrowLeft') mover(0, -1);
  }

  /** Respaldo por si el navegador sí dispara `copy` (menú contextual, etc.). */
  onCopy(e: ClipboardEvent): void {
    if (!this.copiable() || !this.sel()) return;
    const bloque = this.armarBloque('seleccion');
    if (!bloque || !e.clipboardData) return;
    e.preventDefault();
    const filas = bloque.encabezados.length ? [bloque.encabezados, ...bloque.filas] : bloque.filas;
    e.clipboardData.setData('text/plain', filas.map((f) => f.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n'));
    this.anunciar(`${bloque.filas.length} fila(s) copiadas`);
  }

  // ── Auto-scroll al arrastrar cerca del borde ────────────────────────────────
  private detenerAutoScroll(): void {
    if (this.autoScroll !== null) {
      cancelAnimationFrame(this.autoScroll);
      this.autoScroll = null;
    }
  }

  /** Extiende la selección hasta la celda que hay bajo un punto de la pantalla. */
  private extenderHastaPunto(x: number, y: number): void {
    if (!this.ancla) return;
    const celda = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-celda]');
    const dato = celda?.dataset['celda'];
    if (!dato || celda?.dataset['interactiva'] === '1') return;
    const [fila, col] = dato.split(':').map(Number);
    this.fijarSel({ filaInicio: this.ancla.fila, colInicio: this.ancla.col, filaFin: fila, colFin: col });
  }

  /** Con el botón apretado cerca del borde la vista avanza sola y la selección
   *  la sigue: así se puede marcar más allá de lo que se ve. */
  private iniciarAutoScroll(): void {
    if (this.autoScroll !== null) return;
    const paso = () => {
      this.autoScroll = null;
      if (!this.arrastrando) return;
      const contenedor = this.contenedor()?.nativeElement;
      const p = this.puntero;
      if (contenedor && p) {
        const c = contenedor.getBoundingClientRect();
        const vertical = ancestroVertical(contenedor);
        const limites = limitesVerticales(vertical);
        const arriba = Math.max(c.top, limites.arriba);
        const abajo = Math.min(c.bottom, limites.abajo);
        const velocidad = (d: number) => Math.min(40, Math.round(4 + d / 3));
        // En tablas cortas o angostas la franja se encoge: si no, todo el
        // arrastre caería dentro de la zona de borde y la vista se iría sola.
        const zonaX = Math.min(ZONA_ARRASTRE, (c.right - c.left) / 4);
        const zonaY = Math.min(ZONA_ARRASTRE, Math.max(0, (abajo - arriba) / 4));
        let dx = 0;
        let dy = 0;
        if (p.x > c.right - zonaX) dx = velocidad(p.x - (c.right - zonaX));
        else if (p.x < c.left + zonaX) dx = -velocidad(c.left + zonaX - p.x);
        if (p.y > abajo - zonaY) dy = velocidad(p.y - (abajo - zonaY));
        else if (p.y < arriba + zonaY) dy = -velocidad(arriba + zonaY - p.y);
        const antesX = contenedor.scrollLeft;
        const antesY = vertical ? vertical.scrollTop : window.scrollY;
        if (dx) contenedor.scrollLeft += dx;
        if (dy) desplazarVertical(vertical, dy);
        const despuesY = vertical ? vertical.scrollTop : window.scrollY;
        if (contenedor.scrollLeft !== antesX || despuesY !== antesY) {
          this.extenderHastaPunto(
            Math.min(Math.max(p.x, c.left + 4), c.right - 4),
            Math.min(Math.max(p.y, arriba + 4), abajo - 4),
          );
        }
      }
      this.autoScroll = requestAnimationFrame(paso);
    };
    this.autoScroll = requestAnimationFrame(paso);
  }

  // ── Pegado masivo (traer una lista de Excel y marcar esas filas) ────────────
  /**
   * Columnas por las que tiene sentido casar un pegado, en orden de preferencia:
   * primero la que declare la pantalla, luego las que parecen identificar a
   * alguien (cédula, documento) y después códigos, placas o radicados.
   */
  readonly columnasClave = computed<ColumnaTabla<T>[]>(() => {
    const cols = this.columnas().filter((c) => c.copiable !== false);
    if (!cols.length) return [];
    const pedida = this.claveMasiva() ? cols.find((c) => c.id === this.claveMasiva()) : null;
    const persona = /c[eé]dula|documento|identificaci|n[uú]m.*doc|nit/i;
    const codigo = /c[oó]digo|codigo|placa|serial|radicado|consecutivo|^id$/i;
    const casa = (c: ColumnaTabla<T>, re: RegExp) => re.test(c.id) || re.test(c.header);
    const orden = [
      ...(pedida ? [pedida] : []),
      ...cols.filter((c) => casa(c, persona)),
      ...cols.filter((c) => casa(c, codigo)),
      ...cols,
    ];
    return [...new Set(orden)];
  });

  /** La columna que encabeza el botón «Pegar lista». */
  readonly columnaClave = computed<ColumnaTabla<T> | null>(() => this.columnasClave()[0] ?? null);

  /** Índice clave → fila de una columna, sobre TODO lo cargado. */
  private indiceDe(col: ColumnaTabla<T>): Map<string, T> {
    const mapa = new Map<string, T>();
    for (const fila of this.filas()) {
      const clave = normalizarClave(col.valor(fila));
      if (clave && !mapa.has(clave)) mapa.set(clave, fila);
    }
    return mapa;
  }

  /** Filas que quedaron casadas en el último pegado, listas para marcar. */
  private filasPegadas: T[] = [];

  /**
   * Casa el bloque pegado contra la tabla. No se adivina la columna: se prueban
   * las candidatas y gana la que más registros encuentre, así da igual si lo
   * que pegaron son cédulas o códigos.
   */
  private casarTexto(texto: string): ResultadoPegado {
    const lineas = partirBloque(texto);
    const vacio: ResultadoPegado = { encontradas: [], noEncontradas: [], duplicadas: 0, leidas: lineas.length };
    if (!lineas.length) { this.filasPegadas = []; this.ultimasNoEncontradas = []; return vacio; }
    let mejor: { res: ResultadoPegado; indice: Map<string, T>; col: ColumnaTabla<T> } | null = null;
    for (const col of this.columnasClave()) {
      const indice = this.indiceDe(col);
      if (!indice.size) continue;
      const res = casarPegado(lineas, new Set(indice.keys()));
      if (!mejor || res.encontradas.length > mejor.res.encontradas.length) mejor = { res, indice, col };
      if (res.noEncontradas.length === 0) break;
    }
    if (!mejor) { this.filasPegadas = []; this.ultimasNoEncontradas = []; return vacio; }
    this.filasPegadas = mejor.res.encontradas
      .map((c) => mejor!.indice.get(c))
      .filter((f): f is T => !!f);
    this.ultimasNoEncontradas = mejor.res.noEncontradas;
    return { ...mejor.res, columna: mejor.col.header };
  }

  /**
   * Abre el diálogo de pegar desde Excel. Lo que aparezca en la tabla se marca
   * (sumándose a lo que ya estuviera marcado) y lo que no, se informa.
   */
  async abrirPegadoMasivo(): Promise<void> {
    const sm = this.modeloSeleccion();
    if (!sm || !this.columnasClave().length) return;
    const { PegarSeleccionDialogComponent } = await import('./pegar-seleccion-dialog.component');
    const ref = this.dialogo.open(PegarSeleccionDialogComponent, {
      data: {
        titulo: this.tituloVisible(),
        columnas: this.columnasClave().slice(0, 4).map((c) => c.header),
        filasCargadas: this.filas().length,
        modoServidor: this.modoServidor(),
        casar: (texto: string) => this.casarTexto(texto),
      },
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe((aceptado?: boolean) => {
      const filas = this.filasPegadas;
      this.filasPegadas = [];
      if (!aceptado || !filas.length) return;
      sm.select(...filas);
      this.versionSeleccion.update((v) => v + 1);
      this.anunciar(`${filas.length} fila(s) marcadas desde el pegado`);
      this.pegadoMasivo.emit({ encontradas: filas.length, noEncontradas: this.ultimasNoEncontradas });
      this.ultimasNoEncontradas = [];
    });
  }

  /** Lo que no apareció en el último pegado (se pasa a la pantalla al aceptar). */
  private ultimasNoEncontradas: string[] = [];

  /**
   * Abre la vista estándar de revisión: el detalle completo de cada registro
   * marcado (fotos, documentos y todos sus campos) con un carrusel para pasar
   * de uno a otro. Lo que se descarte ahí sale de la selección.
   */
  async abrirRevisionSeleccion(): Promise<void> {
    const sm = this.modeloSeleccion();
    if (!sm?.selected.length) return;
    // El orden de la tabla manda: revisar salta como se ve, no como se marcó.
    const filas = this.filas();
    const enOrden = this.ordenadas().map((i) => filas[i]).filter((f) => sm.isSelected(f));
    const marcadas = enOrden.length ? enOrden : [...sm.selected];
    const { RevisarSeleccionDialogComponent } = await import('./revisar-seleccion-dialog.component');
    const ref = this.dialogo.open(RevisarSeleccionDialogComponent, {
      data: {
        titulo: this.tituloVisible(),
        modulo: this.moduloVisible(),
        filas: marcadas,
        columnas: this.columnas(),
        formatoFecha: (v: ValorCelda) => this.textoDeFecha(v),
        acciones: this.accionesMasivas() ?? [],
      },
      panelClass: ['te-panel', 'te-revision-panel'],
      maxWidth: '96vw',
      autoFocus: true,
      restoreFocus: true,
    });
    ref.afterClosed().subscribe((r?: { descartadas: T[]; accion?: string }) => {
      if (r?.descartadas.length) {
        sm.deselect(...r.descartadas);
        this.versionSeleccion.update((v) => v + 1);
        this.anunciar(`${r.descartadas.length} fila(s) fuera de la selección`);
      }
      // «Revisar → aplicar»: la acción elegida en la ficha arranca con lo que quedó.
      const accion = r?.accion ? this.accionesMasivas()?.find((a) => a.id === r.accion) : null;
      if (accion) void this.correrAccionMasiva(accion);
    });
  }

  // ── Acciones masivas declaradas ─────────────────────────────────────────────
  /**
   * Las acciones con algo sobre lo que actuar, en el orden declarado. El
   * rótulo de grupo («Pasar a:») va solo en la primera de cada grupo.
   */
  readonly accionesVisibles = computed(() => {
    this.versionSeleccion();
    const sm = this.modeloSeleccion();
    const acciones = this.accionesMasivas();
    if (!sm || !acciones?.length || !sm.selected.length) return [];
    const lista: { accion: AccionMasiva<T, any>; cuantas: number; grupo: string | null }[] = [];
    let grupoAnterior: string | undefined;
    for (const accion of acciones) {
      const cuantas = accion.aplicaA ? sm.selected.filter(accion.aplicaA).length : sm.selected.length;
      if (!cuantas) continue;
      const grupo = accion.grupo && accion.grupo !== grupoAnterior ? accion.grupo : null;
      grupoAnterior = accion.grupo;
      lista.push({ accion, cuantas, grupo });
    }
    return lista;
  });

  /** Las marcadas en el orden en que se ven, filtradas por `aplicaA`. */
  private filasPara(accion: AccionMasiva<T, any>, base?: T[]): T[] {
    const sm = this.modeloSeleccion();
    if (!sm) return [];
    let filas = base;
    if (!filas) {
      const todas = this.filas();
      const enOrden = this.ordenadas().map((i) => todas[i]).filter((f) => sm.isSelected(f));
      filas = enOrden.length ? enOrden : [...sm.selected];
    }
    return accion.aplicaA ? filas.filter(accion.aplicaA) : filas;
  }

  /**
   * Corre una acción masiva con el flujo estándar: `preparar` → confirmación
   * con el carrusel de registros → uno a uno con avance y parada → cierre con
   * lo que salió y lo que no. Es pública para que una pantalla pueda lanzarla
   * desde un botón propio (o sobre unas filas concretas) sin montar nada más.
   */
  async correrAccionMasiva(accion: AccionMasiva<T, any>, filasBase?: T[]): Promise<void> {
    const sm = this.modeloSeleccion();
    if (!sm || this.loteEnCurso()) return;
    const filas = this.filasPara(accion, filasBase);
    if (!filas.length) return;
    let datos: unknown;
    if (accion.preparar) {
      datos = await accion.preparar(filas);
      if (datos === undefined) return;
    }
    const columnas = this.columnas();
    const fichas = filas.map((f) => {
      const ficha = fichaDeRegistro(f, columnas, (v) => this.textoDeFecha(v));
      return { nombre: ficha.nombre, id: ficha.id, portada: ficha.portada };
    });
    this.loteEnCurso.set(true);
    const { AccionMasivaDialogComponent } = await import('./accion-masiva-dialog.component');
    const ref = this.dialogo.open(AccionMasivaDialogComponent, {
      data: { accion, filas, fichas, titulo: this.tituloVisible(), modulo: this.moduloVisible(), datos },
      panelClass: ['te-panel', 'te-lote-panel'],
      maxWidth: '96vw',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe((r?: ResultadoAccionMasiva<T> & { mantenerFallidas: boolean }) => {
      this.loteEnCurso.set(false);
      if (!r) return;
      // Lo procesado sale de la selección; lo que no se alcanzó (si se paró) se
      // queda marcado para seguir. «Dejar marcados los que fallaron» deja solo esos.
      if (r.mantenerFallidas && r.fallidos.length) {
        sm.clear();
        sm.select(...r.fallidos);
      } else {
        sm.deselect(...r.hechos, ...r.fallidos);
      }
      this.versionSeleccion.update((v) => v + 1);
      const verbo = accion.verbo ?? 'procesada(s)';
      this.anunciar(`${r.hechos.length} ${verbo}${r.fallidos.length ? ` · ${r.fallidos.length} sin poder` : ''}`);
      accion.alTerminar?.(r);
      this.loteTerminado.emit({
        accion: accion.id, hechos: r.hechos.length, fallidos: r.fallidos.length, cancelado: r.cancelado,
      });
    });
  }

  // ── Selección de filas (casillas) ───────────────────────────────────────────
  estaMarcada(fila: T): boolean {
    this.versionSeleccion();
    return this.modeloSeleccion()?.isSelected(fila) ?? false;
  }

  alternarFila(fila: T, ev?: Event): void {
    ev?.stopPropagation();
    this.modeloSeleccion()?.toggle(fila);
  }

  /** Estado de la casilla del encabezado sobre TODO lo filtrado (todas las páginas). */
  readonly estadoMarcaTodas = computed<'todas' | 'algunas' | 'ninguna'>(() => {
    this.versionSeleccion();
    const sm = this.modeloSeleccion();
    if (!sm || !sm.selected.length) return 'ninguna';
    const filas = this.filas();
    const visibles = this.ordenadas().map((i) => filas[i]);
    const n = visibles.filter((f) => sm.isSelected(f)).length;
    return n === 0 ? 'ninguna' : n === visibles.length ? 'todas' : 'algunas';
  });

  /** Cuántas filas hay marcadas (la selección la lleva la pantalla). */
  readonly marcadas = computed(() => {
    this.versionSeleccion();
    return this.modeloSeleccion()?.selected.length ?? 0;
  });

  soltarSeleccion(): void {
    this.modeloSeleccion()?.clear();
    this.versionSeleccion.update((v) => v + 1);
  }

  alternarTodas(): void {
    const sm = this.modeloSeleccion();
    if (!sm) return;
    const filas = this.filas();
    const visibles = this.ordenadas().map((i) => filas[i]);
    if (this.estadoMarcaTodas() === 'todas') sm.deselect(...visibles);
    else sm.select(...visibles);
  }

  // ── Detalle ─────────────────────────────────────────────────────────────────
  abrirDetalle(fila: T, ev?: Event): void {
    ev?.stopPropagation();
    if (this.conDetalle()) this.filaClick.emit(fila);
  }

  /** Utilidad para plantillas: evita que un clic en la columna de acciones inicie selección. */
  detener(ev: Event): void {
    ev.stopPropagation();
  }

  valorPlano(v: ValorCelda): string {
    return textoDeValor(v);
  }
}

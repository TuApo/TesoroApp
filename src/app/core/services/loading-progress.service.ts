import { Injectable, computed, signal, untracked } from '@angular/core';

/**
 * Estado de cada cosa que la plataforma está cargando.
 *  - 'activa' → en vuelo.
 *  - 'lista'  → terminó bien.
 *  - 'fallo'  → terminó mal (se cuenta como terminada: el porcentaje debe llegar a 100
 *               igual, si no la barra se queda clavada esperando algo que ya no va a volver).
 */
export type PasoEstado = 'activa' | 'lista' | 'fallo';

export interface PasoCarga {
  readonly clave: string;
  readonly etiqueta: string;
  /** Peso relativo dentro del total. Una consulta pesada cuenta más que un catálogo. */
  readonly peso: number;
  readonly estado: PasoEstado;
  /** epoch ms de inicio — para mostrar los segundos que lleva un paso lento. */
  readonly inicio: number;
  readonly fin: number | null;
}

/**
 * Registro central de la carga de la plataforma.
 *
 * El porcentaje que se pinta es REAL: sale de peso_terminado / peso_total. Lo alimenta el
 * `loadingProgressInterceptor` (cada GET a la API se registra solo) y cualquier vista que
 * quiera declarar pasos propios que no son HTTP (parsear un Excel, render de un PDF...).
 *
 * Dos decisiones que importan:
 *
 * 1. MONOTÓNICO. El total crece según van apareciendo peticiones (la vista pide el resumen,
 *    y ese resumen dispara la tabla). Si pintáramos el cociente crudo, la barra retrocedería
 *    cada vez que entra un paso nuevo, que es justo lo que hace sentir rota una carga. Aquí el
 *    valor mostrado nunca baja: se queda quieto hasta que el progreso real lo alcanza.
 *
 * 2. NO MIENTE AL LLEGAR AL FINAL. El "creep" (avance mientras un paso sigue en vuelo) sólo
 *    puede recorrer la franja del paso pendiente y se frena asintóticamente. Nunca declara
 *    100% con algo todavía cargando; el 100% sólo lo da el cierre real del último paso.
 */
@Injectable({ providedIn: 'root' })
export class LoadingProgressService {
  private readonly _pasos = signal<PasoCarga[]>([]);

  /** Pasos en el orden en que entraron, para pintar la lista. */
  readonly pasos = this._pasos.asReadonly();

  /** Porcentaje suavizado 0..100 que consume la vista. */
  private readonly _porcentaje = signal(0);
  readonly porcentaje = this._porcentaje.asReadonly();

  readonly activos = computed(() => this._pasos().filter(p => p.estado === 'activa'));
  readonly terminados = computed(() => this._pasos().filter(p => p.estado !== 'activa'));

  /** Hay algo cargando ahora mismo. */
  readonly cargando = computed(() => this.activos().length > 0);

  /** Texto del paso que manda: el activo más antiguo (el que realmente está frenando). */
  readonly pasoActual = computed(() => {
    const act = this.activos();
    if (!act.length) return '';
    return act.reduce((a, b) => (a.inicio <= b.inicio ? a : b)).etiqueta;
  });

  readonly totalPasos = computed(() => this._pasos().length);
  readonly listosPasos = computed(() => this.terminados().length);

  // ── Anclaje del indicador ─────────────────────────────────────────────────
  /**
   * Cuántas esferas de carga hay montadas en la interfaz (la del top bar).
   *
   * Si hay alguna, la barra superior global se calla: son el mismo dato y pintarlo dos
   * veces es ruido. La barra sigue siendo el indicador de las pantallas sin top bar
   * (login, formularios públicos), donde no hay dónde anclar la esfera.
   */
  private readonly _anclajes = signal(0);
  readonly orbeAnclado = computed(() => this._anclajes() > 0);

  anclarOrbe(): void {
    this._anclajes.update(n => n + 1);
  }

  desanclarOrbe(): void {
    this._anclajes.update(n => Math.max(0, n - 1));
  }

  // ── Motor de animación ────────────────────────────────────────────────────
  private rafId: number | null = null;
  private ultimoFrame = 0;
  /** Momento en que terminó de vaciarse la cola; sirve para el retardo de cierre. */
  private vacioDesde = 0;

  /**
   * Registra un paso. Si la clave ya existe y sigue activa no duplica: devuelve la
   * misma (dos vistas pidiendo el mismo endpoint son un solo paso para el usuario).
   */
  iniciar(clave: string, etiqueta: string, peso = 1): void {
    // untracked: el interceptor llama esto SÍNCRONO al suscribirse el HTTP. Si el
    // HTTP nace dentro de un effect(), una lectura rastreada de _pasos suscribe a
    // ese effect a la señal — y como terminar() la muta en CADA respuesta, el
    // effect se re-dispara en bucle infinito (tormenta de 429 del 2026-08-19).
    const actuales = untracked(this._pasos);
    if (actuales.some(p => p.clave === clave && p.estado === 'activa')) return;

    this._pasos.set([
      ...actuales.filter(p => p.clave !== clave),
      { clave, etiqueta, peso, estado: 'activa', inicio: Date.now(), fin: null },
    ]);
    this.arrancarAnimacion();
  }

  /** Cierra un paso. `ok=false` lo marca como fallo pero igual suma al total. */
  terminar(clave: string, ok = true): void {
    let tocado = false;
    // untracked por la misma razón que iniciar(): finalize() puede ejecutarse
    // dentro de un contexto reactivo ajeno y no debe crearle dependencias.
    const siguientes = untracked(this._pasos).map(p => {
      if (p.clave !== clave || p.estado !== 'activa') return p;
      tocado = true;
      return { ...p, estado: (ok ? 'lista' : 'fallo') as PasoEstado, fin: Date.now() };
    });
    if (!tocado) return;
    this._pasos.set(siguientes);
    this.arrancarAnimacion();
  }

  /**
   * Vacía el registro y vuelve a 0. Lo llama la vista cuando ya mostró el 100%,
   * para que la siguiente carga empiece limpia.
   */
  reiniciar(): void {
    this._pasos.set([]);
    this._porcentaje.set(0);
    this.vacioDesde = 0;
    this.detenerAnimacion();
  }

  // ── Cálculo ───────────────────────────────────────────────────────────────

  /**
   * Progreso crudo 0..1.
   *
   * Los pasos terminados suman su peso entero. Los activos aportan una fracción de su
   * propio peso que tiende a 0.9 sin llegar nunca: `1 - e^(-t/τ)`. Así la barra siempre
   * se mueve durante una consulta de varios segundos, pero la franja del paso pendiente
   * no se puede consumir del todo — el salto final lo da el cierre real.
   */
  private objetivo(): number {
    const pasos = this._pasos();
    if (!pasos.length) return 0;

    const total = pasos.reduce((s, p) => s + p.peso, 0);
    if (total <= 0) return 0;

    const ahora = Date.now();
    const TAU = 2500; // ms — a los ~2.5s un paso activo va por el 57% de su franja

    const hecho = pasos.reduce((s, p) => {
      if (p.estado !== 'activa') return s + p.peso;
      const transcurrido = ahora - p.inicio;
      return s + p.peso * 0.9 * (1 - Math.exp(-transcurrido / TAU));
    }, 0);

    return Math.min(1, hecho / total);
  }

  private arrancarAnimacion(): void {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.ultimoFrame = Date.now();
    this.rafId = requestAnimationFrame(() => this.frame());
  }

  private detenerAnimacion(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  private frame(): void {
    this.rafId = null;

    const ahora = Date.now();
    const dt = Math.min(100, ahora - this.ultimoFrame) / 1000;
    this.ultimoFrame = ahora;

    const objetivo = this.objetivo() * 100;
    const actual = this._porcentaje();

    // Sólo sube. El objetivo puede bajar cuando entra un paso nuevo (crece el
    // denominador); en ese caso la barra espera quieta a que el real la alcance.
    if (objetivo > actual) {
      // Aproximación exponencial: rápida cuando falta mucho, suave al final.
      const resto = objetivo - actual;
      const suave = resto * (1 - Math.exp(-6 * dt));
      // PASO MÍNIMO. El valor se guarda redondeado a una décima; en el último tramo el
      // avance exponencial por frame cae por debajo de 0,05 y el redondeo se lo come:
      // el porcentaje se quedaba clavado en 99,x —con todo cargado— y el indicador no
      // llegaba nunca a la condición de cierre. Nunca sobrepasa el objetivo.
      const siguiente = actual + Math.min(resto, Math.max(suave, 0.1));
      this._porcentaje.set(Math.min(100, Math.round(siguiente * 10) / 10));
    }

    const quedanActivos = this._pasos().some(p => p.estado === 'activa');

    if (quedanActivos) {
      this.vacioDesde = 0;
      this.arrancarAnimacion();
      return;
    }

    // Ya no queda nada en vuelo: rematamos hasta 100 y dejamos que la vista cierre.
    if (this._porcentaje() < 100) {
      this.arrancarAnimacion();
      return;
    }

    if (!this.vacioDesde) this.vacioDesde = ahora;
  }
}

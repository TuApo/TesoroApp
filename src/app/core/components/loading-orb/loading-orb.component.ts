import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { LoadingProgressService } from '../../services/loading-progress.service';

/**
 * Esfera de carga del top bar (a la izquierda del chip de versión).
 *
 * Sustituye al panel flotante: la carga de datos es información de fondo, no un aviso
 * que merezca ocupar una esquina de la pantalla. Aquí sólo se ve un punto que se llena
 * con el avance REAL y desaparece solo al terminar.
 *
 *  - Cerrada (lo normal): la esfera y nada más. Ni texto ni caja.
 *  - Al pulsarla: el desglose de qué está cargando, para cuando una espera se hace larga
 *    y el usuario quiere saber en qué se está yendo el tiempo.
 *
 * Nunca bloquea, y se va sola: al quedar la cola vacía remata el círculo, lo mantiene un
 * instante para que el cierre se vea, y se desmonta llevándose el desglose si estaba abierto.
 */

/** Espera antes de aparecer: una consulta de 150 ms no debe hacer parpadear la esfera. */
const RETARDO_APARICION = 220;
/** Tiempo que el círculo lleno queda visible antes de irse. */
const RETARDO_CIERRE = 620;
/**
 * Margen para limpiar el registro cuando la esfera ni llegó a aparecer.
 *
 * No es 0 a propósito: una pantalla suele encadenar peticiones con milisegundos de por
 * medio (el resumen dispara la tabla). Sin este margen cada hueco reiniciaría el conteo
 * y la carga se leería como varias cargas distintas.
 */
const RETARDO_LIMPIEZA = 260;

@Component({
  selector: 'app-loading-orb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './loading-orb.component.html',
  styleUrl: './loading-orb.component.css',
  host: {
    // El top bar es un flex con gap: un host vacío seguiría contando como item y
    // dejaría un hueco permanente entre los controles. Sin nada que mostrar, no existe.
    '[class.lo-oculta]': '!visible()',
  },
})
export class LoadingOrbComponent implements OnDestroy {
  private readonly progreso = inject(LoadingProgressService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly pasos = this.progreso.pasos;
  readonly pasoActual = this.progreso.pasoActual;
  readonly listos = this.progreso.listosPasos;
  readonly total = this.progreso.totalPasos;

  readonly visible = signal(false);
  /** Desglose desplegado. Sólo por clic: nunca se abre solo. */
  readonly abierto = signal(false);

  /**
   * Terminado = no queda nada en vuelo. A propósito NO depende de que el porcentaje
   * animado haya tocado el 100 exacto: atar el cierre a un número que va suavizado es
   * lo que dejaba el indicador clavado en pantalla cuando la animación se quedaba corta.
   */
  readonly completo = computed(() => !this.progreso.cargando() && this.total() > 0);

  /** Al terminar se pinta el círculo entero aunque la animación venga por 99,x. */
  readonly porcentaje = computed(() =>
    this.completo() ? 100 : Math.min(100, this.progreso.porcentaje()),
  );
  readonly porcentajeEntero = computed(() => Math.round(this.porcentaje()));

  /** Circunferencia del arco (r=13) para animarlo con stroke-dashoffset. */
  private readonly CIRC = 2 * Math.PI * 13;
  readonly dashArray = this.CIRC;
  readonly dashOffset = computed(() => this.CIRC * (1 - this.porcentaje() / 100));

  /** El núcleo crece con el avance: la esfera se "llena" de dentro hacia afuera. */
  readonly radioNucleo = computed(() => 2.6 + 7.2 * (this.porcentaje() / 100));

  /** Texto del tooltip y del aria-label: la esfera sola no dice nada por sí misma. */
  readonly resumen = computed(() => {
    if (this.completo()) return 'Carga completa';
    const paso = this.pasoActual();
    const base = `Cargando ${this.porcentajeEntero()}% · ${this.listos()} de ${this.total()}`;
    return paso ? `${base} · ${paso}` : base;
  });

  private timerAparicion: ReturnType<typeof setTimeout> | null = null;
  private timerCierre: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Mientras esta esfera exista, la barra superior global se calla: dos indicadores
    // del mismo dato son ruido, no redundancia útil.
    this.progreso.anclarOrbe();

    effect(() => {
      if (this.progreso.cargando()) {
        this.cancelar('cierre');
        if (!this.visible() && this.timerAparicion === null) {
          this.timerAparicion = setTimeout(() => {
            this.timerAparicion = null;
            if (this.progreso.cargando()) this.visible.set(true);
          }, RETARDO_APARICION);
        }
        return;
      }

      this.cancelar('aparicion');

      // La limpieza corre AUNQUE la esfera no haya llegado a aparecer (carga corta):
      // si no, los pasos se irían acumulando toda la sesión y la siguiente carga
      // arrancaría con un porcentaje heredado que no significa nada.
      if (this.total() > 0 && this.timerCierre === null) {
        const espera = this.visible() ? RETARDO_CIERRE : RETARDO_LIMPIEZA;
        this.timerCierre = setTimeout(() => {
          this.timerCierre = null;
          this.visible.set(false);
          this.abierto.set(false);
          this.progreso.reiniciar();
        }, espera);
      }
    });
  }

  alternar(): void {
    this.abierto.update(v => !v);
  }

  cerrarDetalle(): void {
    this.abierto.set(false);
  }

  /** Un clic fuera cierra el desglose; la carga sigue igual. */
  @HostListener('document:pointerdown', ['$event'])
  onClicFuera(evento: Event): void {
    if (!this.abierto()) return;
    const destino = evento.target as Node | null;
    if (destino && !this.host.nativeElement.contains(destino)) this.cerrarDetalle();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cerrarDetalle();
  }

  /** Segundos que lleva un paso, para que una espera larga se explique sola. */
  segundos(inicio: number, fin: number | null): string {
    const ms = (fin ?? Date.now()) - inicio;
    if (ms < 950) return '';
    return `${(ms / 1000).toFixed(1)} s`;
  }

  ngOnDestroy(): void {
    this.cancelar('aparicion');
    this.cancelar('cierre');
    this.progreso.desanclarOrbe();
  }

  private cancelar(cual: 'aparicion' | 'cierre'): void {
    if (cual === 'aparicion' && this.timerAparicion !== null) {
      clearTimeout(this.timerAparicion);
      this.timerAparicion = null;
    }
    if (cual === 'cierre' && this.timerCierre !== null) {
      clearTimeout(this.timerCierre);
      this.timerCierre = null;
    }
  }
}

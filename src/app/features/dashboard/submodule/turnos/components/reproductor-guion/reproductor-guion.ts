import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DisenoResuelto, Paso, Transicion, Vista } from '../../service/turnos.service';
import { DatosVista, EmisionPieza, VistaRender } from '../vista-render/vista-render';

interface Capa { clave: number; vista: Vista; transicion: Transicion; ms: number; sale: boolean; }

/**
 * Reproduce un guion: pasa de vista en vista con la transición y el tiempo de
 * cada paso, y al cantar un turno salta a la vista de llamado (si el guion la
 * tiene) para volver después a donde iba.
 *
 * <p>Mismo componente en el televisor y en "Probar" del diseñador: lo que se
 * prueba es lo que se emite. Las transiciones son dos capas (la que sale y la
 * que entra) animadas por CSS; al terminar la animación la saliente se retira.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-reproductor-guion',
  imports: [CommonModule, VistaRender],
  template: `
    @for (c of capas(); track c.clave) {
      <div class="capa" [class.capa--sale]="c.sale" [attr.data-t]="c.transicion" [style.--ms]="c.ms + 'ms'">
        <app-vista-render [vista]="c.vista" [datos]="datos()" [reportar]="reportar() && !c.sale" (emision)="emision.emit($event)" />
      </div>
    }
    @if (!capas().length) { <div class="capa capa--nada"></div> }
  `,
  styleUrl: './reproductor-guion.css',
})
export class ReproductorGuion {
  readonly diseno = input.required<DisenoResuelto>();
  readonly datos = input.required<DatosVista>();
  readonly reportar = input(false);
  readonly emision = output<EmisionPieza>();
  /** Índice del paso en curso (el diseñador lo muestra). */
  readonly paso = signal(0);
  readonly enLlamado = signal(false);

  private destroyRef = inject(DestroyRef);
  readonly capas = signal<Capa[]>([]);

  private readonly vistasPorId = computed(() => new Map(this.diseno().vistas.map(v => [v.id, v])));
  readonly pasos = computed<Paso[]>(() => (this.diseno().guion?.pasos ?? []).filter(p => this.vistasPorId().has(p.vista_id)));
  private readonly llamadoId = computed(() => this.datos().llamado?.id ?? null);

  private clave = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private retiro: ReturnType<typeof setTimeout> | null = null;
  private temporizadorLlamado: ReturnType<typeof setTimeout> | null = null;
  private firma = '';

  constructor() {
    // Un diseño nuevo (otra firma) arranca desde el primer paso.
    effect(() => {
      const d = this.diseno();
      const f = `${d.firma}|${this.pasos().length}`;
      untracked(() => { if (f !== this.firma) { this.firma = f; this.arrancar(); } });
    });
    // Al cantar un turno: si el guion tiene vista de llamado, se salta a ella un rato.
    effect(() => {
      const id = this.llamadoId();
      untracked(() => { if (id) this.saltoDeLlamado(); });
    });
    this.destroyRef.onDestroy(() => this.limpiar());
  }

  private limpiar(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.retiro) clearTimeout(this.retiro);
    if (this.temporizadorLlamado) clearTimeout(this.temporizadorLlamado);
    this.temporizador = this.retiro = this.temporizadorLlamado = null;
  }

  private arrancar(): void {
    this.limpiar();
    this.enLlamado.set(false);
    this.paso.set(0);
    const p = this.pasos()[0];
    if (!p) { this.capas.set([]); return; }
    this.mostrar(this.vistasPorId().get(p.vista_id)!, 'NINGUNA', 0);
    this.programar();
  }

  private programar(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    const pasos = this.pasos();
    if (pasos.length < 2) return;
    const p = pasos[this.paso()];
    this.temporizador = setTimeout(() => this.avanzar(), Math.max(3, p.duracion_seg) * 1000);
  }

  private avanzar(): void {
    const pasos = this.pasos();
    if (!pasos.length) return;
    const i = (this.paso() + 1) % pasos.length;
    this.paso.set(i);
    const p = pasos[i];
    this.mostrar(this.vistasPorId().get(p.vista_id)!, p.transicion ?? 'FUNDIDO', p.transicion_ms ?? 600);
    this.programar();
  }

  private saltoDeLlamado(): void {
    const g = this.diseno().guion;
    const vista = g?.al_llamar_vista_id ? this.vistasPorId().get(g.al_llamar_vista_id) : null;
    if (!g || !vista) return;
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.temporizadorLlamado) clearTimeout(this.temporizadorLlamado);
    if (!this.enLlamado()) this.mostrar(vista, 'FUNDIDO', 400);
    this.enLlamado.set(true);
    this.temporizadorLlamado = setTimeout(() => {
      this.enLlamado.set(false);
      const p = this.pasos()[this.paso()];
      if (p) this.mostrar(this.vistasPorId().get(p.vista_id)!, 'FUNDIDO', 400);
      this.programar();
    }, Math.max(3, g.al_llamar_seg || 12) * 1000);
  }

  /** Cambia de vista: la actual pasa a "saliente" y se retira al terminar la animación. */
  private mostrar(vista: Vista, transicion: Transicion, ms: number): void {
    if (this.retiro) clearTimeout(this.retiro);
    const entrante: Capa = { clave: ++this.clave, vista, transicion, ms, sale: false };
    const actual = this.capas().find(c => !c.sale);
    if (!actual || transicion === 'NINGUNA' || ms <= 0) { this.capas.set([entrante]); return; }
    this.capas.set([{ ...actual, transicion, ms, sale: true }, entrante]);
    this.retiro = setTimeout(() => this.capas.set([entrante]), ms + 50);
  }
}

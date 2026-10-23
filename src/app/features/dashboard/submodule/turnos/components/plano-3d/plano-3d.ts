import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, PLATFORM_ID, afterNextRender, effect, inject,
  input, output, signal, untracked, viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import type { Area, MetaArea, PisoCroquis } from '../../service/turnos.service';
import type { Calidad3D, CambioPlano, DestinoPlano, ModoMotor, MotorPlano3D, SeleccionPlano, VistaCamara } from './motor-plano-3d';

/**
 * El plano de la oficina en 3D. Envuelve `MotorPlano3D` (three.js, cargado con import()
 * dinámico) y lo alimenta con las mismas áreas y pisos del croquis. Sirve para editar
 * (`modo="editor"`), para el televisor (`modo="tv"`, con el llamado resaltado) y para mirar.
 *
 * <p>Si el equipo no tiene WebGL (TV viejo, navegador sin aceleración) emite `fallo` y quien
 * lo usa muestra el plano 2D: nadie se queda sin plano.
 */
@Component({
  selector: 'app-plano-3d',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="caja" #caja></div>
    <div class="hud" #hud aria-hidden="true"></div>
    @if (cargando()) { <div class="cargando">Armando el plano en 3D…</div> }
  `,
  styles: [`
    :host { display: block; position: relative; width: 100%; height: 100%; min-height: 240px; overflow: hidden; border-radius: inherit; }
    .caja { position: absolute; inset: 0; }
    .hud { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .cargando { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted, #64748b); font-weight: 700; font-size: 13px; }
    :host ::ng-deep .rot { position: absolute; left: 0; top: 0; will-change: transform; white-space: nowrap; font-family: Manrope, system-ui, sans-serif; }
    :host ::ng-deep .rot-area { translate: -50% -100%; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 3px 9px; border-radius: 9px;
      background: rgba(255,255,255,.9); color: #0f1b2d; border: 1.5px solid var(--c, #2b59f0); box-shadow: 0 2px 8px rgba(15,27,45,.15); font-size: 11.5px; }
    :host ::ng-deep .rot-area b { font-weight: 800; color: var(--c, #2b59f0); }
    :host ::ng-deep .rot-area span { font-size: 10px; opacity: .75; font-weight: 700; }
    :host ::ng-deep .rot-area i { font-style: normal; font-size: 10.5px; font-weight: 800; color: #92400e; }
    :host ::ng-deep .rot-area.rot--sel { background: var(--c, #2b59f0); color: #fff; }
    :host ::ng-deep .rot-area.rot--sel b, :host ::ng-deep .rot-area.rot--sel i { color: #fff; }
    :host ::ng-deep .rot-area.rot--llamado { background: #9bd441; border-color: #21263c; transform-origin: 50% 100%; }
    :host ::ng-deep .rot-area.rot--llamado b { color: #21263c; }
    :host ::ng-deep .rot-texto { translate: -50% -50%; font-weight: 800; font-size: 13px; color: var(--c, #0f1b2d); text-shadow: 0 1px 2px rgba(255,255,255,.8); }
    :host ::ng-deep .rot-icono { translate: -50% -50%; color: var(--c, #44526a); }
    :host ::ng-deep .rot-icono .material-icons { font-size: 22px; }
    :host ::ng-deep .rot-medida { translate: -50% -130%; padding: 2px 7px; border-radius: 6px; background: #2b59f0; color: #fff; font-size: 11px; font-weight: 800; }
    :host ::ng-deep .rot-destino { translate: -50% -100%; display: flex; flex-direction: column; align-items: center; padding: 8px 18px; border-radius: 14px;
      background: #21263c; color: #fff; border: 3px solid #9bd441; box-shadow: 0 0 0 6px rgba(155,212,65,.25), 0 10px 30px rgba(0,0,0,.4);
      animation: tn3d-latido 1.1s ease-in-out infinite; }
    :host ::ng-deep .rot-destino b { font-size: clamp(18px, 3.2vw, 44px); font-weight: 900; letter-spacing: .02em; color: #9bd441; }
    :host ::ng-deep .rot-destino span { font-size: clamp(12px, 1.6vw, 22px); font-weight: 800; }
    @keyframes tn3d-latido { 0%, 100% { box-shadow: 0 0 0 6px rgba(155,212,65,.25), 0 10px 30px rgba(0,0,0,.4); } 50% { box-shadow: 0 0 0 16px rgba(155,212,65,.08), 0 10px 30px rgba(0,0,0,.4); } }
    :host-context(html[data-theme='dark']) ::ng-deep .rot-area { background: rgba(21,31,52,.92); color: #e5eaf2; }
    @media (prefers-reduced-motion: reduce) { :host ::ng-deep .rot-destino { animation: none; } }
  `],
})
export class Plano3d {
  private readonly zona = inject(NgZone);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly pisos = input<PisoCroquis[]>([]);
  readonly areas = input<Area[]>([]);
  readonly meta = input<Record<string, MetaArea>>({});
  readonly escala = input<number>(2);
  readonly pisoId = input<string | null>(null);
  readonly fondo = input<string | null>(null);
  readonly modo = input<ModoMotor>('vista');
  readonly calidad = input<Calidad3D>('alta');
  readonly seleccion = input<SeleccionPlano | null>(null);
  readonly herramienta = input<string | null>(null);
  readonly tamanoHerramienta = input<[number, number] | null>(null);
  readonly ajustar = input(true);
  readonly destino = input<DestinoPlano | null>(null);
  readonly estadosEquipos = input<Map<string, string> | null>(null);
  /** Estado en vivo de Seguridad por `ref` (puertas, ventanas, cámaras): ABIERTO, CERRADO, ALARMA… */
  readonly estadosSeguridad = input<Map<string, string> | null>(null);
  /** Paredes a media altura, para editar sin que tapen. */
  readonly paredesBajas = input(false);

  readonly seleccionar = output<SeleccionPlano | null>();
  readonly cambio = output<{ sel: SeleccionPlano; patch: CambioPlano }>();
  readonly colocar = output<{ tipo: string; x: number; y: number }>();
  readonly pared = output<{ x1: number; y1: number; x2: number; y2: number }>();
  readonly fallo = output<string>();
  /** Clic en una cámara ligada a Seguridad: `ref` es el id de la cámara en ms-seguridad. */
  readonly elegirCamara = output<{ ref: string; id: string }>();

  private readonly cajaRef = viewChild.required<ElementRef<HTMLDivElement>>('caja');
  private readonly hudRef = viewChild.required<ElementRef<HTMLDivElement>>('hud');
  readonly cargando = signal(true);
  private motor: MotorPlano3D | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => { if (this.esNavegador) this.zona.runOutsideAngular(() => void this.montar()); });
    destroyRef.onDestroy(() => { this.motor?.destruir(); this.motor = null; });

    effect(() => {
      const datos = { pisos: this.pisos(), areas: this.areas(), meta: this.meta(), escala: this.escala(), pisoId: this.pisoId() ?? this.pisos()[0]?.id ?? 'p1', fondo: this.fondo() };
      if (!this.listo()) return;
      untracked(() => this.motor?.cargar(datos));
    });
    effect(() => { const s = this.seleccion(); if (this.listo()) untracked(() => this.motor?.seleccionar(s)); });
    effect(() => { const h = this.herramienta(); const t = this.tamanoHerramienta(); if (this.listo()) untracked(() => this.motor?.usarHerramienta(h, t ?? undefined)); });
    effect(() => { const a = this.ajustar(); if (this.listo()) untracked(() => this.motor?.ajustarACuadricula(a)); });
    effect(() => { const d = this.destino(); if (this.listo()) untracked(() => this.motor?.resaltar(d)); });
    effect(() => { const c = this.calidad(); if (this.listo()) untracked(() => this.motor?.setCalidad(c)); });
    effect(() => { const m = this.estadosEquipos(); if (this.listo() && m) untracked(() => this.motor?.setEstadosEquipos(m)); });
    effect(() => { const m = this.estadosSeguridad(); if (this.listo() && m) untracked(() => this.motor?.setEstadosSeguridad(m)); });
    effect(() => { const b = this.paredesBajas(); if (this.listo()) untracked(() => this.motor?.setParedesBajas(b)); });

    const obsTema = new MutationObserver(() => this.motor?.setTema(this.oscuro()));
    if (this.esNavegador) obsTema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    destroyRef.onDestroy(() => obsTema.disconnect());
  }

  private readonly listo = signal(false);

  private oscuro(): boolean {
    return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  }

  private async montar(): Promise<void> {
    try {
      const prueba = document.createElement('canvas');
      if (!(prueba.getContext('webgl2') || prueba.getContext('webgl'))) throw new Error('sin WebGL');
      const { MotorPlano3D } = await import('./motor-plano-3d');
      this.motor = new MotorPlano3D(this.cajaRef().nativeElement, {
        modo: this.modo(), calidad: this.calidad(), oscuro: this.oscuro(), hud: this.hudRef().nativeElement,
        onSeleccion: s => this.zona.run(() => this.seleccionar.emit(s)),
        onCambio: (sel, patch) => this.zona.run(() => this.cambio.emit({ sel, patch })),
        onColocar: (tipo, x, y) => this.zona.run(() => this.colocar.emit({ tipo, x, y })),
        onPared: (x1, y1, x2, y2) => this.zona.run(() => this.pared.emit({ x1, y1, x2, y2 })),
        onElegirCamara: (ref, id) => this.zona.run(() => this.elegirCamara.emit({ ref, id })),
      });
      this.zona.run(() => { this.cargando.set(false); this.listo.set(true); });
    } catch (e) {
      this.zona.run(() => { this.cargando.set(false); this.fallo.emit('Este equipo no puede mostrar 3D (WebGL desactivado o sin aceleración gráfica).'); });
      console.warn('[plano-3d]', e);
    }
  }

  // ── Mandos para quien lo contiene ──────────────────────────────────────
  vista(v: VistaCamara): void { this.motor?.vista(v); }
  enfocar(id: string): void { this.motor?.enfocar(id); }
  usarPreview(canvas: HTMLCanvasElement | null): void { this.motor?.usarPreview(canvas); }
  previsualizarCamara(id: string | null): void { this.motor?.previsualizarCamara(id); }
  get lienzo(): HTMLCanvasElement | null { return this.motor?.canvas ?? null; }
}

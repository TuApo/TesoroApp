import {
  ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CelebracionDelDia, PersonaCelebrada, PlantillaCelebracionAdmin } from './celebracion.models';
import { CelebracionEscenaComponent } from './celebracion-escena.component';
import { CelebracionService } from './celebracion.service';
import { armarLocal, personasDemo } from './demo';
import { prepararCelebracion } from './preparar';

type Dispositivo = 'celular' | 'tablet' | 'portatil' | 'escritorio';
type ModoPersonas = 'reales' | '1' | '3' | '8';

const DISPOSITIVOS: Record<Dispositivo, { ancho: number; alto: number; nombre: string }> = {
  celular: { ancho: 390, alto: 844, nombre: 'Celular' },
  tablet: { ancho: 820, alto: 1180, nombre: 'Tablet' },
  portatil: { ancho: 1366, alto: 768, nombre: 'Portátil' },
  escritorio: { ancho: 1920, alto: 1080, nombre: 'Escritorio' },
};

/**
 * Probador de Marketing: la celebración dentro de un celular, una tablet, un portátil o un
 * escritorio a escala, con la plantilla, la cantidad de personas y el punto de vista
 * (todo el mundo / quien cumple) que se quieran. Nada de esto apunta vistas ni guarda nada.
 */
@Component({
  selector: 'app-celebracion-probador',
  standalone: true,
  imports: [FormsModule, CelebracionEscenaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pr" role="dialog" aria-modal="true" aria-label="Probar la celebración">
      <div class="pr-barra">
        <div class="pr-grupo" role="group" aria-label="Dispositivo">
          @for (d of dispositivos; track d) {
            <button type="button" class="pr-seg" [class.on]="dispositivo() === d" (click)="dispositivo.set(d); repetir()">
              {{ nombreDe(d) }}</button>
          }
        </div>
        <label class="pr-campo"><span>Plantilla</span>
          <select [ngModel]="plantillaId()" (ngModelChange)="plantillaId.set($event); repetir()">
            @for (p of plantillas(); track p.id) {
              <option [value]="p.id">{{ p.nombre }}{{ p.activo ? '' : ' (apagada)' }}</option>
            }
          </select>
        </label>
        <div class="pr-grupo" role="group" aria-label="Personas">
          @if (base().personas.length) {
            <button type="button" class="pr-seg" [class.on]="modoPersonas() === 'reales'" (click)="modoPersonas.set('reales'); repetir()">
              Las reales ({{ base().personas.length }})</button>
          }
          @for (n of ['1', '3', '8']; track n) {
            <button type="button" class="pr-seg" [class.on]="modoPersonas() === n" (click)="modoPersonas.set($any(n)); repetir()">
              {{ n }} de muestra</button>
          }
        </div>
        <label class="pr-check"><input type="checkbox" [ngModel]="comoCumpleanero()" (ngModelChange)="comoCumpleanero.set($event); repetir()" />
          Como la ve quien cumple</label>
        <span class="pr-espacio"></span>
        <button type="button" class="pr-btn" (click)="repetir()">↻ Repetir</button>
        <button type="button" class="pr-btn" (click)="pantallaCompleta.set(true)">⛶ Pantalla completa</button>
        <button type="button" class="pr-btn pr-btn--cerrar" (click)="cerrar.emit()">Cerrar</button>
      </div>

      <div class="pr-lienzo" #area>
        <div class="pr-equipo" [class]="'pr-equipo pr-equipo--' + dispositivo()"
             [style.width.px]="medida().ancho * escala()" [style.height.px]="medida().alto * escala()">
          <div class="pr-pantalla" [style.width.px]="medida().ancho" [style.height.px]="medida().alto"
               [style.transform]="'scale(' + escala() + ')'">
            @if (listo()) {
              @for (k of [clave()]; track k) {
                <app-celebracion-escena [datos]="datos()" modo="marco" [sinCierreAutomatico]="true"
                                        (cerrada)="repetir()" (repetir)="repetir()" />
              }
            }
          </div>
        </div>
        <p class="pr-nota">{{ nombreDe(dispositivo()) }} · {{ medida().ancho }} × {{ medida().alto }} · {{ datos().plantilla?.duracion_segundos }} s
          · al terminar se cerraría sola</p>
      </div>
    </div>

    @if (pantallaCompleta()) {
      <app-celebracion-escena [datos]="datos()" (cerrada)="pantallaCompleta.set(false); repetir()" />
    }
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1200; }
    .pr { position: absolute; inset: 0; display: flex; flex-direction: column; background: rgb(10 14 30 / .88);
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); color: #fff; }
    .pr-barra { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 16px;
      background: rgb(255 255 255 / .06); border-bottom: 1px solid rgb(255 255 255 / .1); }
    .pr-grupo { display: inline-flex; background: rgb(255 255 255 / .08); border-radius: 10px; padding: 3px; gap: 2px; flex-wrap: wrap; }
    .pr-seg { min-height: 34px !important; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: #dfe4ff;
      font-weight: 600; font-size: 13px; line-height: 1; font-family: inherit; cursor: pointer; white-space: nowrap; }
    .pr-seg.on { background: #fff; color: #1b2040; }
    .pr-campo { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #c9cff5; }
    .pr-campo select { min-height: 38px; border-radius: 9px; border: 1px solid rgb(255 255 255 / .2); background: #1b2040;
      color: #fff; padding: 0 10px; font: inherit; max-width: 230px; }
    .pr-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #dfe4ff; cursor: pointer; }
    .pr-espacio { flex: 1 1 0; }
    .pr-btn { min-height: 38px !important; padding: 0 14px; border-radius: 10px; border: 1px solid rgb(255 255 255 / .25);
      background: rgb(255 255 255 / .08); color: #fff; font-weight: 600; font-size: 13px; line-height: 1; font-family: inherit; cursor: pointer; white-space: nowrap; }
    .pr-btn:hover { background: rgb(255 255 255 / .16); }
    .pr-btn--cerrar { background: #fff; color: #1b2040; }
    .pr-lienzo { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; padding: 16px; overflow: hidden; }
    .pr-equipo { position: relative; flex: none; border-radius: 18px; box-shadow: 0 0 0 10px #05070f, 0 0 0 11px rgb(255 255 255 / .18),
      0 40px 80px -20px rgb(0 0 0 / .8); overflow: hidden; background: #000; }
    .pr-equipo--celular { border-radius: 34px; }
    .pr-equipo--portatil, .pr-equipo--escritorio { border-radius: 10px; }
    .pr-pantalla { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; }
    .pr-nota { margin: 0; font-size: 12px; color: #aab2e6; text-align: center; }
    @media (max-width: 700px) {
      .pr-barra { gap: 8px; padding: 10px; }
      .pr-espacio { display: none; }
      .pr-campo select { max-width: 160px; }
    }
  `],
})
export class CelebracionProbadorComponent {
  /** Lo que se vería ese día (personas reales con sus fotos, plantilla y textos del día). */
  readonly base = input.required<CelebracionDelDia>();
  readonly plantillas = input.required<PlantillaCelebracionAdmin[]>();
  /** Textos propios del día (si Marketing los cambió); null = los de la plantilla. */
  readonly textosDia = input<{ titulo: string | null; mensaje: string | null } | null>(null);
  readonly cerrar = output<void>();

  private readonly api = inject(CelebracionService);

  readonly dispositivos = Object.keys(DISPOSITIVOS) as Dispositivo[];
  readonly dispositivo = signal<Dispositivo>(typeof window !== 'undefined' && window.innerWidth < 760 ? 'celular' : 'portatil');
  readonly plantillaId = signal('');
  readonly modoPersonas = signal<ModoPersonas>('reales');
  readonly comoCumpleanero = signal(false);
  readonly pantallaCompleta = signal(false);
  readonly clave = signal(0);
  readonly listo = signal(false);
  private readonly ventana = signal({ ancho: 1280, alto: 800 });

  readonly medida = computed(() => DISPOSITIVOS[this.dispositivo()]);
  readonly orientacion = computed<'h' | 'v'>(() => (this.medida().ancho >= this.medida().alto ? 'h' : 'v'));
  readonly escala = computed(() => {
    const m = this.medida();
    const v = this.ventana();
    const barra = v.ancho < 700 ? 190 : 120;
    return Math.min(1, (v.ancho - 48) / m.ancho, (v.alto - barra - 60) / m.alto);
  });

  readonly plantilla = computed(() =>
    this.plantillas().find((p) => p.id === this.plantillaId()) ?? this.plantillas()[0]);

  readonly datos = computed<CelebracionDelDia>(() => {
    const b = this.base();
    const p = this.plantilla();
    const modo = this.modoPersonas();
    const personas: PersonaCelebrada[] = modo === 'reales' && b.personas.length ? b.personas : personasDemo(Number(modo === 'reales' ? 1 : modo));
    if (!p) return { ...b, personas };
    const t = this.textosDia();
    return armarLocal({ fecha: b.fecha, plantilla: p, personas, titulo: t?.titulo, mensaje: t?.mensaje, comoCumpleanero: this.comoCumpleanero() });
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const b = this.base();
      this.plantillaId.set(b.plantilla?.id || this.plantillas()[0]?.id || '');
      if (!b.personas.length) this.modoPersonas.set('1');
      const medir = () => this.ventana.set({ ancho: window.innerWidth, alto: window.innerHeight });
      medir();
      window.addEventListener('resize', medir);
      const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !this.pantallaCompleta()) this.cerrar.emit(); };
      document.addEventListener('keydown', tecla);
      destroyRef.onDestroy(() => { window.removeEventListener('resize', medir); document.removeEventListener('keydown', tecla); });
      // Tipografía y fotos antes del primer arranque: si no, la primera vuelta sale sin ellas.
      void prepararCelebracion(this.datos(), (u) => this.api.urlFoto(u), this.orientacion()).then(() => this.listo.set(true));
    });
  }

  nombreDe(d: Dispositivo): string { return DISPOSITIVOS[d].nombre; }

  repetir(): void {
    const d = this.datos();
    void prepararCelebracion(d, (u) => this.api.urlFoto(u), this.orientacion()).then(() => this.clave.update((k) => k + 1));
  }
}

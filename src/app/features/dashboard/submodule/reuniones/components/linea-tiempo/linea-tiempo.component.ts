import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { HablanteInsight, SegmentoTranscripcion, Tema } from '../../models/reunion.model';
import { AvatarHablanteComponent } from '../avatar-hablante/avatar-hablante.component';
import { bandasTemas, calcularCarriles, msDesdeFraccion, pctDe } from '../../utils/carriles';
import { colorIdxDe, colorVar } from '../../utils/hablantes';
import { nombreCorto } from '../../utils/texto';
import { reloj } from '../../utils/tiempo';

/**
 * Línea de tiempo por hablante: un carril por persona con los tramos en que habló, las
 * bandas de temas encima y el cabezal del audio. Se lee de un vistazo quién llevó la
 * reunión, en qué tema y cuándo intervino cada quien; un clic salta a ese momento.
 *
 * Accesible con teclado: la zona de carriles es un control deslizante (flechas ±5 s,
 * RePág/AvPág ±1 min, Inicio/Fin).
 */
@Component({
  selector: 'app-reu-linea-tiempo',
  standalone: true,
  imports: [AvatarHablanteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './linea-tiempo.component.html',
  styleUrls: ['../../estilos/base.css', './linea-tiempo.component.css'],
})
export class LineaTiempoComponent {
  readonly segmentos = input<SegmentoTranscripcion[]>([]);
  readonly hablantes = input<HablanteInsight[]>([]);
  readonly temas = input<Tema[]>([]);
  readonly duracionMs = input<number | null>(null);
  readonly posicionMs = input(0);
  readonly filtroHablantes = input<string[]>([]);
  readonly filtroTema = input<string | null>(null);

  readonly saltar = output<number>();
  readonly elegirTema = output<string>();

  /** Posición del puntero sobre los carriles (0..100), para la guía y la hora flotante. */
  readonly guiaPct = signal<number | null>(null);

  readonly duracion = computed(() => {
    const d = this.duracionMs() ?? 0;
    const fin = this.segmentos().reduce((m, s) => Math.max(m, s.end_ms), 0);
    return Math.max(d, fin);
  });

  readonly carriles = computed(() => {
    const hs = this.hablantes();
    const info = new Map(hs.map((h, i) => [h.id, { nombre: h.display_name, color: colorIdxDe(h, i) }]));
    return calcularCarriles(this.segmentos(), hs.map(h => h.id), this.duracion()).map(c => {
      const i = c.speakerId ? info.get(c.speakerId) : undefined;
      return {
        ...c,
        nombre: i?.nombre ?? 'Sin identificar',
        corto: i ? nombreCorto(i.nombre) : 'Sin identificar',
        color: i?.color ?? null,
      };
    });
  });

  readonly bandas = computed(() => bandasTemas(this.temas(), this.duracion()));

  readonly cabezalPct = computed(() => pctDe(this.posicionMs(), this.duracion()));

  readonly temaActual = computed(() => {
    const ms = this.posicionMs();
    return this.temas().find(t => ms >= t.start_ms && ms < t.end_ms)?.id ?? null;
  });

  readonly marcas = computed(() => {
    const d = this.duracion();
    return [0, 0.25, 0.5, 0.75, 1].map(f => ({ pct: f * 100, texto: reloj(f * d) }));
  });

  readonly guiaTexto = computed(() => {
    const g = this.guiaPct();
    return g == null ? '' : reloj(msDesdeFraccion(g / 100, this.duracion()));
  });

  readonly colorVar = colorVar;
  readonly reloj = reloj;

  atenuado(id: string | null): boolean {
    const f = this.filtroHablantes();
    return f.length > 0 && (id === null || !f.includes(id));
  }

  clic(ev: MouseEvent): void {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    this.saltar.emit(msDesdeFraccion((ev.clientX - r.left) / r.width, this.duracion()));
  }

  mover(ev: MouseEvent): void {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    if (!r.width) return;
    this.guiaPct.set(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)));
  }

  tecla(ev: KeyboardEvent): void {
    const d = this.duracion();
    const pos = this.posicionMs();
    const pasos: Record<string, number> = {
      ArrowRight: 5000, ArrowUp: 5000, ArrowLeft: -5000, ArrowDown: -5000,
      PageUp: 60000, PageDown: -60000,
    };
    let destino: number | null = null;
    if (ev.key in pasos) destino = pos + pasos[ev.key];
    else if (ev.key === 'Home') destino = 0;
    else if (ev.key === 'End') destino = d;
    if (destino == null) return;
    ev.preventDefault();
    this.saltar.emit(Math.min(d, Math.max(0, destino)));
  }
}

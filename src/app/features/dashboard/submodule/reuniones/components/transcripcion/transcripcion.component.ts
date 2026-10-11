import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect,
  inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ReunionesService } from '../../services/reuniones.service';
import {
  Acuerdo, HablanteInsight, SegmentoTranscripcion, TIPO_ACUERDO_LABEL, Tema, TipoAcuerdo,
} from '../../models/reunion.model';
import { AvatarHablanteComponent } from '../avatar-hablante/avatar-hablante.component';
import { acuerdosPorSegmento, agruparTurnos, indiceSegmentoEn, segmentosEnRango } from '../../utils/turnos';
import { colorIdxDe, colorVar } from '../../utils/hablantes';
import { Parte, contiene, mensajeError, normalizar, partirCoincidencias } from '../../utils/texto';
import { reloj } from '../../utils/tiempo';

export const ICONO_ACUERDO: Record<TipoAcuerdo, string> = {
  DECISION: 'gavel',
  COMPROMISO: 'assignment_ind',
  PENDIENTE: 'pending_actions',
  RIESGO: 'warning_amber',
};

/**
 * La transcripción como conversación: turnos de palabra con avatar y nombre, cada frase
 * con su minuto, la que suena resaltada, búsqueda con anterior/siguiente, filtros por
 * persona y tema, corrección en línea y las decisiones y compromisos marcados donde se
 * dijeron.
 *
 * Rendimiento: una reunión de 4 h son ~3 000 segmentos. No se virtualiza (los turnos
 * tienen alto variable y la búsqueda del navegador debe encontrar todo); cada turno lleva
 * `content-visibility: auto`, así el navegador sólo pinta lo que está en pantalla.
 */
@Component({
  selector: 'app-reu-transcripcion',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, AvatarHablanteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transcripcion.component.html',
  styleUrls: ['../../estilos/base.css', './transcripcion.component.css'],
})
export class TranscripcionComponent {
  private readonly api = inject(ReunionesService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly segmentos = input<SegmentoTranscripcion[]>([]);
  readonly hablantes = input<HablanteInsight[]>([]);
  readonly acuerdos = input<Acuerdo[]>([]);
  readonly temas = input<Tema[]>([]);
  readonly posicionMs = input(0);
  readonly reproduciendo = input(false);
  readonly filtroHablantes = input<string[]>([]);
  readonly filtroTema = input<string | null>(null);
  readonly cargando = input(false);
  readonly totalEsperado = input<number | null>(null);

  readonly saltar = output<number>();
  readonly quitarFiltroHablante = output<string>();
  readonly quitarFiltroTema = output<void>();
  readonly limpiarFiltros = output<void>();
  readonly segmentoActualizado = output<SegmentoTranscripcion>();
  readonly verAcuerdo = output<string>();

  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');

  // ── Búsqueda ──────────────────────────────────────────────────────────────
  readonly consulta = signal('');
  readonly consultaAplicada = signal('');
  readonly indiceCoincidencia = signal(0);
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  // ── Seguimiento del audio y edición ──────────────────────────────────────
  readonly seguirAudio = signal(true);
  readonly editandoId = signal<number | null>(null);
  readonly textoEditado = signal('');
  readonly guardando = signal(false);
  readonly errorEdicion = signal('');
  readonly destello = signal<number | null>(null);
  private temporizadorDestello: ReturnType<typeof setTimeout> | null = null;
  private destruido = false;

  readonly reloj = reloj;
  readonly colorVar = colorVar;
  readonly ICONO = ICONO_ACUERDO;

  readonly mapaHablantes = computed(() =>
    new Map(this.hablantes().map((h, i) => [h.id, { h, color: colorIdxDe(h, i) }])));

  readonly temaFiltrado = computed(() => this.temas().find(t => t.id === this.filtroTema()) ?? null);

  /** Turnos visibles: primero se recorta por tema (rango), luego se agrupa, luego se filtra por persona. */
  readonly turnos = computed(() => {
    const tema = this.temaFiltrado();
    const base = tema ? segmentosEnRango(this.segmentos(), tema.start_ms, tema.end_ms) : this.segmentos();
    const filtro = this.filtroHablantes();
    const mapa = this.mapaHablantes();
    return agruparTurnos(base)
      .filter(t => !filtro.length || (t.speakerId !== null && filtro.includes(t.speakerId)))
      .map(t => {
        const info = t.speakerId ? mapa.get(t.speakerId) : undefined;
        const primero = t.segmentos[0];
        return {
          ...t,
          nombre: info?.h.display_name || primero.speaker_name || primero.speaker_label || 'Sin identificar',
          rol: info ? (info.h.participant_id ? null : info.h.suggested_role) : null,
          color: info?.color ?? null,
        };
      });
  });

  readonly totalVisibles = computed(() => this.turnos().reduce((n, t) => n + t.segmentos.length, 0));

  readonly segmentoActivo = computed(() => {
    const segs = this.segmentos();
    const i = indiceSegmentoEn(segs, this.posicionMs(), 1500);
    return i >= 0 ? segs[i].id : null;
  });

  readonly coincidencias = computed<number[]>(() => {
    const q = this.consultaAplicada();
    if (normalizar(q).length < 2) return [];
    const ids: number[] = [];
    for (const t of this.turnos()) for (const s of t.segmentos) if (contiene(s.text, q)) ids.push(s.id);
    return ids;
  });

  readonly partes = computed(() => {
    const ids = new Set(this.coincidencias());
    const mapa = new Map<number, Parte[]>();
    if (!ids.size) return mapa;
    const q = this.consultaAplicada();
    for (const s of this.segmentos()) if (ids.has(s.id)) mapa.set(s.id, partirCoincidencias(s.text, q));
    return mapa;
  });

  readonly coincidenciaActual = computed(() => this.coincidencias()[this.indiceCoincidencia()] ?? null);

  readonly acuerdosSeg = computed(() =>
    acuerdosPorSegmento(this.segmentos(), this.acuerdos().filter(a => a.status !== 'DESCARTADO')));

  readonly hayFiltros = computed(() => this.filtroHablantes().length > 0 || !!this.filtroTema());

  constructor() {
    // Seguir el audio: con el audio sonando, la frase actual se mantiene a la vista.
    effect(() => {
      const id = this.segmentoActivo();
      if (id == null || !this.seguirAudio() || !this.reproduciendo()) return;
      if (untracked(this.editandoId) !== null) return;
      untracked(() => this.llevarAVista(id, false));
    });
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true;
      if (this.temporizador) clearTimeout(this.temporizador);
      if (this.temporizadorDestello) clearTimeout(this.temporizadorDestello);
    });
  }

  // ── API pública para la ficha ─────────────────────────────────────────────

  /** Lleva a la vista la frase que suena en `ms` y la destaca un momento. */
  mostrarMinuto(ms: number): void {
    const segs = this.segmentos();
    const i = indiceSegmentoEn(segs, ms, Number.POSITIVE_INFINITY);
    if (i < 0) return;
    const id = segs[i].id;
    this.destacar(id);
    this.llevarAVista(id, true);
  }

  // ── Búsqueda ──────────────────────────────────────────────────────────────

  alEscribir(valor: string): void {
    this.consulta.set(valor);
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      if (this.destruido) return;
      this.consultaAplicada.set(valor.trim());
      this.indiceCoincidencia.set(0);
      const primera = this.coincidencias()[0];
      if (primera != null) this.llevarAVista(primera, true);
    }, 200);
  }

  limpiarBusqueda(): void {
    this.consulta.set('');
    this.consultaAplicada.set('');
    this.indiceCoincidencia.set(0);
  }

  alEnter(ev: Event): void {
    ev.preventDefault();
    if ((ev as KeyboardEvent).shiftKey) this.anterior(); else this.siguiente();
  }

  siguiente(): void { this.moverCoincidencia(1); }
  anterior(): void { this.moverCoincidencia(-1); }

  private moverCoincidencia(paso: number): void {
    const n = this.coincidencias().length;
    if (!n) return;
    const i = (this.indiceCoincidencia() + paso + n) % n;
    this.indiceCoincidencia.set(i);
    this.llevarAVista(this.coincidencias()[i], true);
  }

  // ── Edición en línea ──────────────────────────────────────────────────────

  editar(s: SegmentoTranscripcion): void {
    this.editandoId.set(s.id);
    this.textoEditado.set(s.text);
    this.errorEdicion.set('');
    afterNextRender(() => {
      const ta = this.host.nativeElement.querySelector<HTMLTextAreaElement>(`#edit-${s.id}`);
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }, { injector: this.injector });
  }

  cancelarEdicion(): void {
    this.editandoId.set(null);
    this.errorEdicion.set('');
  }

  guardar(s: SegmentoTranscripcion): void {
    const texto = this.textoEditado().trim();
    if (!texto || texto === s.text) { this.cancelarEdicion(); return; }
    this.guardando.set(true);
    this.api.editarSegmento(s.id, texto).subscribe({
      next: (actualizado) => {
        this.guardando.set(false);
        this.editandoId.set(null);
        this.segmentoActualizado.emit(actualizado);
      },
      error: (e) => {
        this.guardando.set(false);
        this.errorEdicion.set(mensajeError(e, 'No se pudo guardar la corrección'));
      },
    });
  }

  teclaEdicion(ev: KeyboardEvent, s: SegmentoTranscripcion): void {
    if (ev.key === 'Escape') { ev.preventDefault(); this.cancelarEdicion(); }
    else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.guardar(s); }
  }

  // ── Presentación ──────────────────────────────────────────────────────────

  etiquetaTipo(k: TipoAcuerdo): string { return TIPO_ACUERDO_LABEL[k]?.uno ?? k; }

  nombreHablante(id: string): string { return this.mapaHablantes().get(id)?.h.display_name ?? 'Persona'; }

  colorHablante(id: string): number | null { return this.mapaHablantes().get(id)?.color ?? null; }

  private destacar(id: number): void {
    this.destello.set(id);
    if (this.temporizadorDestello) clearTimeout(this.temporizadorDestello);
    this.temporizadorDestello = setTimeout(() => this.destello.set(null), 1800);
  }

  /**
   * Desplaza hasta la frase. Con `forzar` (un salto pedido) siempre centra; siguiendo el
   * audio sólo se mueve si la frase se está saliendo de la vista, para que el texto no
   * "baile" con cada frase nueva.
   */
  private llevarAVista(id: number, forzar: boolean): void {
    if (this.destruido) return;
    afterNextRender(() => {
      const el = this.host.nativeElement.querySelector<HTMLElement>(`#seg-${id}`);
      if (!el) return;
      if (!forzar && this.estaVisible(el)) return;
      const reducido = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: forzar || reducido ? 'auto' : 'smooth' });
      // `content-visibility` estima el alto de los turnos que no se han pintado: tras el
      // primer salto el navegador los pinta y la frase puede quedar corrida. Se corrige.
      if (forzar) setTimeout(() => { if (!this.destruido && !this.estaVisible(el)) el.scrollIntoView({ block: 'center' }); }, 250);
    }, { injector: this.injector });
  }

  private estaVisible(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    const cont = this.lista()?.nativeElement;
    let arriba = 0;
    let abajo = typeof window !== 'undefined' ? window.innerHeight : 800;
    let margenArriba = 0.3;
    if (cont && cont.scrollHeight > cont.clientHeight + 4) {
      const c = cont.getBoundingClientRect();
      arriba = c.top;
      abajo = c.bottom;
      margenArriba = 0.12;
    }
    const alto = abajo - arriba;
    return r.top >= arriba + alto * margenArriba && r.bottom <= abajo - alto * 0.12;
  }
}

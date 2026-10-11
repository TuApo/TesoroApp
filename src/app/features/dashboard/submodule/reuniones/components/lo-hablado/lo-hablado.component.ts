import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input,
  model, output, signal, untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ReunionesService } from '../../services/reuniones.service';
import {
  Acuerdo, EstadoAcuerdo, GuardarAcuerdo, HablanteInsight, InsightsReunion, Participante,
  TIPOS_ACUERDO, TIPO_ACUERDO_LABEL, TipoAcuerdo,
} from '../../models/reunion.model';
import { AvatarHablanteComponent } from '../avatar-hablante/avatar-hablante.component';
import { ICONO_ACUERDO } from '../transcripcion/transcripcion.component';
import { responsableDe } from '../../utils/acta';
import { claveDePersona, colorIdxDe, colorVar } from '../../utils/hablantes';
import { mensajeError } from '../../utils/texto';
import { duracionHumana, fechaHora, porcentaje, reloj } from '../../utils/tiempo';
import { analisisEnCurso } from '../../utils/estado';
import { cuerpoDe, ordenEstado } from '../../utils/acuerdos';
import { TareasDialogosService } from '../../../seguimiento-tareas/services/tareas-dialogos.service';

export type PestanaHablado = 'resumen' | 'temas' | 'acuerdos' | 'personas';

interface Formulario {
  modo: 'nuevo' | 'editar';
  id?: string;
  kind: TipoAcuerdo;
  text: string;
  /** `s:<speakerId>` | `p:<participantId>` | `o` (otra persona) | '' (nadie). */
  responsable: string;
  otro: string;
  due: string;
  anclar: boolean;
  start_ms: number | null;
  status: EstadoAcuerdo;
}

/**
 * "Lo que se habló": resumen, temas, acuerdos y el aporte de cada persona. Los acuerdos
 * se gestionan aquí (marcar hecho, descartar, editar, agregar a mano); los cambios se
 * avisan a la ficha para que la transcripción muestre las marcas al día.
 */
@Component({
  selector: 'app-reu-lo-hablado',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatMenuModule, MatTooltipModule, AvatarHablanteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lo-hablado.component.html',
  styleUrls: ['../../estilos/base.css', './lo-hablado.component.css'],
})
export class LoHabladoComponent {
  private readonly api = inject(ReunionesService);
  private readonly injector = inject(Injector);
  private readonly tareas = inject(TareasDialogosService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly insights = input.required<InsightsReunion>();
  readonly hablantes = input<HablanteInsight[]>([]);
  readonly participantes = input<Participante[]>([]);
  readonly reunionId = input.required<string>();
  readonly posicionMs = input(0);
  readonly filtroTema = input<string | null>(null);
  readonly filtroHablantes = input<string[]>([]);
  /** Acuerdo a destacar (desde una marca de la transcripción). `vez` fuerza el cambio. */
  readonly resaltado = input<{ id: string; vez: number } | null>(null);
  readonly reanalizando = input(false);
  readonly pestana = model<PestanaHablado>('resumen');

  readonly saltar = output<number>();
  readonly filtrarTema = output<string>();
  readonly filtrarHablante = output<string>();
  readonly reanalizar = output<void>();
  readonly acuerdoGuardado = output<Acuerdo>();
  readonly acuerdoEliminado = output<string>();

  readonly formulario = signal<Formulario | null>(null);
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly ocupado = signal<string | null>(null);
  readonly confirmandoEliminar = signal<string | null>(null);

  readonly TIPOS = TIPOS_ACUERDO;
  readonly ICONO = ICONO_ACUERDO;
  readonly reloj = reloj;
  readonly colorVar = colorVar;
  readonly porcentaje = porcentaje;
  readonly duracionHumana = duracionHumana;
  readonly fechaHora = fechaHora;

  readonly mapa = computed(() => new Map(this.hablantes().map((h, i) => [h.id, { h, color: colorIdxDe(h, i) }])));
  private readonly mapaH = computed(() => new Map(this.hablantes().map(h => [h.id, h])));

  readonly analisis = computed(() => this.insights().analysis);
  readonly estadoAnalisis = computed<'sin' | 'curso' | 'error' | 'lista'>(() => {
    const a = this.analisis();
    if (this.reanalizando() || analisisEnCurso(a?.status)) return 'curso';
    if (!a) return 'sin';
    return a.status === 'ERROR' ? 'error' : 'lista';
  });
  readonly parrafos = computed(() =>
    (this.analisis()?.summary ?? '').split(/\n+/).map(p => p.trim()).filter(Boolean));

  readonly items = computed(() => this.insights().items);
  readonly abiertos = computed(() =>
    this.items().filter(a => a.status === 'ABIERTO' && (a.kind === 'COMPROMISO' || a.kind === 'PENDIENTE')).length);

  readonly hechos = computed(() => {
    const ins = this.insights();
    const cuenta = (k: TipoAcuerdo) => ins.items.filter(i => i.kind === k && i.status !== 'DESCARTADO').length;
    const out: string[] = [];
    if (ins.duration_ms) out.push(duracionHumana(ins.duration_ms));
    if (ins.speakers.length) out.push(`${ins.speakers.length} ${ins.speakers.length === 1 ? 'persona' : 'personas'}`);
    if (ins.topics.length) out.push(`${ins.topics.length} ${ins.topics.length === 1 ? 'tema' : 'temas'}`);
    const d = cuenta('DECISION');
    if (d) out.push(`${d} ${d === 1 ? 'decisión' : 'decisiones'}`);
    const c = cuenta('COMPROMISO');
    if (c) out.push(`${c} ${c === 1 ? 'compromiso' : 'compromisos'}`);
    return out;
  });

  readonly temaActual = computed(() => {
    const ms = this.posicionMs();
    return this.insights().topics.find(t => ms >= t.start_ms && ms < t.end_ms)?.id ?? null;
  });

  readonly temas = computed(() => {
    const mapa = this.mapa();
    return [...this.insights().topics].sort((a, b) => a.start_ms - b.start_ms).map(t => {
      const dur = Math.max(1, t.end_ms - t.start_ms);
      const reparto = [...(t.speakers ?? [])]
        .sort((a, b) => b.talk_ms - a.talk_ms)
        .map(s => {
          const info = mapa.get(s.speaker_id);
          return { id: s.speaker_id, nombre: info?.h.display_name ?? 'Sin identificar', color: info?.color ?? null,
            pct: Math.min(100, (s.talk_ms / dur) * 100) };
        });
      return { t, dur, reparto, quienes: reparto.map(r => r.nombre).join(', ') };
    });
  });

  readonly grupos = computed(() => {
    const mapa = this.mapa();
    const mapaH = this.mapaH();
    const ps = this.participantes();
    return this.TIPOS.map(kind => ({
      kind,
      etiqueta: TIPO_ACUERDO_LABEL[kind].varios,
      items: this.items()
        .filter(a => a.kind === kind)
        .sort((a, b) => ordenEstado(a.status) - ordenEstado(b.status) || (a.start_ms ?? 0) - (b.start_ms ?? 0))
        .map(a => ({
          a,
          responsable: responsableDe(a, mapaH, ps),
          colorResponsable: a.owner_speaker_id ? mapa.get(a.owner_speaker_id)?.color ?? null : null,
          dijo: a.speaker_id ? mapa.get(a.speaker_id)?.h.display_name ?? null : null,
          colorDijo: a.speaker_id ? mapa.get(a.speaker_id)?.color ?? null : null,
        })),
    })).filter(g => g.items.length);
  });

  readonly porPersona = computed(() => {
    const ps = this.participantes();
    const items = this.items().filter(i => i.status !== 'DESCARTADO');
    return this.hablantes().map((h, i) => {
      const participante = h.participant_id ? ps.find(p => p.id === h.participant_id) ?? null : null;
      return {
        h,
        color: colorIdxDe(h, i),
        decisiones: items.filter(x => x.kind === 'DECISION' && x.speaker_id === h.id).length,
        aCargo: items.filter(x => x.kind === 'COMPROMISO' && x.owner_speaker_id === h.id).length,
        participante,
        /** Clave de persona que manda el backend: sin ella no hay enlace a la ficha. */
        clave: h.participant_id ? claveDePersona(h, participante) : null,
      };
    });
  });

  /** Responsables posibles: quienes hablaron y los participantes que no hablaron. */
  readonly opcionesResponsable = computed(() => {
    const hs = this.hablantes();
    const asignados = new Set(hs.map(h => h.participant_id).filter(Boolean));
    return [
      ...hs.map(h => ({ valor: `s:${h.id}`, texto: h.display_name })),
      ...this.participantes().filter(p => !asignados.has(p.id))
        .map(p => ({ valor: `p:${p.id}`, texto: `${p.display_name} (no habló)` })),
    ];
  });

  readonly resaltadoId = computed(() => this.resaltado()?.id ?? null);

  constructor() {
    effect(() => {
      const r = this.resaltado();
      if (!r) return;
      untracked(() => {
        this.pestana.set('acuerdos');
        afterNextRender(() => {
          this.host.nativeElement.querySelector(`#acuerdo-${r.id}`)?.scrollIntoView({ block: 'nearest' });
        }, { injector: this.injector });
      });
    });
  }

  enFiltro(id: string): boolean { return this.filtroHablantes().includes(id); }
  etiquetaTipo(k: TipoAcuerdo): string { return TIPO_ACUERDO_LABEL[k].uno; }

  // ── Formulario ────────────────────────────────────────────────────────────

  nuevo(): void {
    this.error.set('');
    this.formulario.set({
      modo: 'nuevo', kind: 'COMPROMISO', text: '', responsable: '', otro: '', due: '',
      anclar: this.posicionMs() > 0, start_ms: null, status: 'ABIERTO',
    });
  }

  editar(a: Acuerdo): void {
    this.error.set('');
    this.formulario.set({
      modo: 'editar', id: a.id, kind: a.kind, text: a.text,
      responsable: a.owner_speaker_id ? `s:${a.owner_speaker_id}`
        : a.owner_participant_id ? `p:${a.owner_participant_id}` : (a.owner_text ? 'o' : ''),
      otro: a.owner_text ?? '', due: a.due_text ?? '', anclar: false, start_ms: a.start_ms, status: a.status,
    });
  }

  actualizar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.formulario.update(f => (f ? { ...f, [campo]: valor } : f));
  }

  guardarFormulario(): void {
    const f = this.formulario();
    if (!f) return;
    const texto = f.text.trim();
    if (!texto) { this.error.set('Escribe qué se acordó.'); return; }
    if (f.responsable === 'o' && !f.otro.trim()) { this.error.set('Escribe el nombre del responsable.'); return; }
    const body: GuardarAcuerdo = {
      kind: f.kind,
      text: texto,
      owner_speaker_id: f.responsable.startsWith('s:') ? f.responsable.slice(2) : null,
      owner_participant_id: f.responsable.startsWith('p:') ? f.responsable.slice(2) : null,
      owner_text: f.responsable === 'o' ? f.otro.trim() : null,
      due_text: f.due.trim() || null,
      start_ms: f.modo === 'nuevo' ? (f.anclar ? this.posicionMs() : null) : f.start_ms,
      status: f.status,
    };
    this.guardando.set(true);
    this.error.set('');
    const peticion = f.modo === 'nuevo'
      ? this.api.crearAcuerdo(this.reunionId(), body)
      : this.api.actualizarAcuerdo(f.id!, body);
    peticion.subscribe({
      next: (a) => {
        this.guardando.set(false);
        this.formulario.set(null);
        this.acuerdoGuardado.emit(a);
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(mensajeError(e, f.modo === 'nuevo' ? 'No se pudo agregar el acuerdo' : 'No se pudo guardar el acuerdo'));
      },
    });
  }

  // ── Estado y borrado ──────────────────────────────────────────────────────

  cambiarEstado(a: Acuerdo, status: EstadoAcuerdo): void {
    this.ocupado.set(a.id);
    this.error.set('');
    this.api.actualizarAcuerdo(a.id, cuerpoDe(a, { status })).subscribe({
      next: (x) => { this.ocupado.set(null); this.acuerdoGuardado.emit(x); },
      error: (e) => { this.ocupado.set(null); this.error.set(mensajeError(e, 'No se pudo cambiar el estado')); },
    });
  }

  eliminar(a: Acuerdo): void {
    this.ocupado.set(a.id);
    this.api.eliminarAcuerdo(a.id).subscribe({
      next: () => { this.ocupado.set(null); this.confirmandoEliminar.set(null); this.acuerdoEliminado.emit(a.id); },
      error: (e) => { this.ocupado.set(null); this.error.set(mensajeError(e, 'No se pudo eliminar el acuerdo')); },
    });
  }

  /**
   * Un compromiso se vuelve tarea de Seguimiento Tareas: con responsable (si es usuario de
   * la plataforma), avisos, fecha y seguimiento compartido. La tarea queda enlazada a esta
   * reunión para volver a la conversación de donde salió.
   */
  async crearTarea(a: Acuerdo): Promise<void> {
    const participante = a.owner_participant_id
      ? this.participantes().find(p => p.id === a.owner_participant_id) : null;
    const detalle = [
      a.quote ? `«${a.quote}»` : '',
      a.due_text ? `Plazo dicho en la reunión: ${a.due_text}` : '',
    ].filter(Boolean).join('\n');
    const t = await this.tareas.nuevaTarea({
      titulo: a.text,
      descripcion: detalle,
      responsable: participante?.usuario_id ?? null,
      origen: { tipo: 'REUNION', ref: a.id, url: `reuniones/${this.reunionId()}`, etiqueta: 'Compromiso de reunión' },
    });
    if (t) this.router.navigate(['/dashboard/tareas/tarea', t.id]);
  }
}

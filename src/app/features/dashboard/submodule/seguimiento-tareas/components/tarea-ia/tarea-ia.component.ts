import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TareasApiService } from '../../services/tareas-api.service';
import { Sugerencia, TareaDefinida, TareaDetalle } from '../../models/tareas.models';
import { hace, mensajeError, prioridadInfo } from '../../utils/tareas-ui';
import { IaChatComponent } from '../ia-chat/ia-chat.component';

type ModoSugerencia = Sugerencia['modo'];

const ACCIONES: { modo: ModoSugerencia; etiqueta: string; icono: string; ayuda: string }[] = [
  { modo: 'pasos', etiqueta: 'Proponer pasos', icono: 'checklist', ayuda: 'Pasos de checklist que faltan para terminarla' },
  { modo: 'descripcion', etiqueta: 'Redactar descripción', icono: 'edit_note', ayuda: 'Objetivo, alcance y criterio de terminado' },
  { modo: 'resumen', etiqueta: 'Resumir avance', icono: 'summarize', ayuda: 'En qué va, qué falta y qué se decidió en los comentarios' },
  { modo: 'siguientes', etiqueta: 'Siguientes pasos', icono: 'next_plan', ayuda: 'Qué hacer ahora y qué riesgos vigilar' },
  { modo: 'desglosar', etiqueta: 'Dividir en subtareas', icono: 'account_tree', ayuda: 'Subtareas independientes para repartir' },
];


/**
 * IA dentro de una tarea:
 *  - Asistente (LLM de ms-ai): propone pasos, redacta la descripción, resume el avance,
 *    sugiere siguientes pasos o divide la tarea en subtareas. Nada se aplica sin confirmar.
 *  - Chat de la tarea: conversación con el asistente (documentos reales, archivos que se suben)
 *    y con los agentes, que trabajan para resolver y siguen hasta terminar (ver IaChatComponent).
 */
@Component({
  selector: 'app-tarea-ia',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule, MatSnackBarModule, IaChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tarea-ia.component.html',
  styleUrls: ['./tarea-ia.component.css'],
})
export class TareaIaComponent implements OnInit, OnDestroy {
  private readonly api = inject(TareasApiService);
  private readonly snack = inject(MatSnackBar);

  readonly tarea = input.required<TareaDetalle>();
  readonly puedeEditar = input(true);
  readonly puedeTrabajar = input(true);
  readonly cambio = output<void>();

  readonly acciones = ACCIONES;
  readonly disponible = signal(false);
  readonly modo = signal<ModoSugerencia | null>(null);
  readonly pensando = signal(false);
  readonly sugerencia = signal<Sugerencia | null>(null);
  readonly elegidos = signal<Set<number>>(new Set());
  readonly aplicando = signal(false);
  readonly error = signal<string | null>(null);
  instruccion = '';
  private destruido = false;

  readonly accionActual = computed(() => ACCIONES.find(a => a.modo === this.modo()) ?? null);
  readonly prioridadInfo = prioridadInfo;
  readonly hace = hace;

  async ngOnInit(): Promise<void> {
    try {
      const e = await this.api.iaEstado();
      this.disponible.set(e.disponible);
    } catch { /* sin IA: la sección se oculta */ }
  }

  ngOnDestroy(): void { this.destruido = true; }

  // ── Asistente ──
  async sugerir(modo: ModoSugerencia): Promise<void> {
    if (this.pensando()) return;
    this.modo.set(modo);
    this.pensando.set(true);
    this.sugerencia.set(null);
    this.error.set(null);
    try {
      const t = await this.api.iaGenerar('sugerir', {
        card_id: this.tarea().id, modo, instruccion: this.instruccion.trim() || undefined,
      });
      const s = await this.api.esperarIa<Sugerencia>(t.id, { cancelado: () => this.destruido });
      this.sugerencia.set(s);
      const n = modo === 'desglosar' ? (s.tareas?.length ?? 0) : s.pasos.length;
      this.elegidos.set(new Set(Array.from({ length: n }, (_, i) => i)));
    } catch (e: any) {
      if (e?.message !== 'cancelado') this.error.set(e instanceof Error ? e.message : mensajeError(e, 'La IA no pudo responder.'));
    } finally {
      this.pensando.set(false);
    }
  }

  alternar(i: number): void {
    this.elegidos.update(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }

  descartar(): void { this.sugerencia.set(null); this.modo.set(null); }

  async agregarPasos(): Promise<void> {
    const s = this.sugerencia();
    if (!s) return;
    const pasos = s.pasos.filter((_, i) => this.elegidos().has(i));
    await this.aplicar(async () => {
      for (const p of pasos) await this.api.agregarItem(this.tarea().id, p);
    }, pasos.length === 1 ? 'Paso agregado al checklist' : `${pasos.length} pasos agregados al checklist`);
  }

  async usarDescripcion(como: 'reemplazar' | 'agregar'): Promise<void> {
    const s = this.sugerencia();
    if (!s?.texto) return;
    const actual = (this.tarea().description ?? '').trim();
    const nueva = como === 'agregar' && actual ? `${actual}\n\n${s.texto}` : s.texto;
    await this.aplicar(() => this.api.actualizarTarea(this.tarea().id, { description: nueva }), 'Descripción actualizada');
  }

  async publicar(): Promise<void> {
    const s = this.sugerencia();
    if (!s) return;
    const titulo = this.accionActual()?.etiqueta ?? 'Sugerencia';
    const cuerpo = [`[IA · ${titulo}]`, s.texto, ...s.pasos.map(p => `• ${p}`)].filter(Boolean).join('\n');
    await this.aplicar(() => this.api.comentar(this.tarea().id, cuerpo, []), 'Publicado como comentario');
  }

  async crearSubtareas(): Promise<void> {
    const t = this.tarea();
    const sel = (this.sugerencia()?.tareas ?? []).filter((_, i) => this.elegidos().has(i));
    if (!t.board_id || !sel.length) return;
    await this.aplicar(() => this.api.tareasEnLote(t.board_id!, {
      tareas: sel.map((x: TareaDefinida) => ({ ...x, lista_id: t.board_list ?? undefined, etiqueta_ids: [] })),
      responsable: t.assignee ?? null,
      origen_tipo: 'TAREA', origen_ref: `#${t.id} ${t.title}`.slice(0, 120),
      origen_url: `/dashboard/tareas/tarea/${t.id}`,
    }), sel.length === 1 ? 'Subtarea creada' : `${sel.length} subtareas creadas`);
  }

  private async aplicar(fn: () => Promise<unknown>, ok: string): Promise<void> {
    this.aplicando.set(true);
    try {
      await fn();
      this.snack.open(ok, undefined, { duration: 2500 });
      this.descartar();
      this.cambio.emit();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    } finally {
      this.aplicando.set(false);
    }
  }

  /** Contexto del caso para los agentes (el asistente del chat lo arma el servidor). */
  readonly contextoAgentes = (): string => this.contexto();

  private contexto(): string {
    const t = this.tarea();
    const l: string[] = [
      `Tarea #${t.id}: ${t.title}`,
      `Espacio: ${t.workspace_name ?? ''} · Tablero: ${t.board_name ?? ''} · Columna: ${t.list_name ?? ''}`,
      `Estado: ${t.status} · Prioridad: ${t.priority}${t.due_at ? ' · Vence: ' + t.due_at.slice(0, 10) : ''}`,
    ];
    if (t.origen_tipo) l.push(`Origen: ${t.origen_tipo} ${t.origen_ref ?? ''}`);
    if (t.description) l.push('', 'Descripción:', t.description);
    if (t.checklist_items?.length) {
      l.push('', 'Checklist:', ...t.checklist_items.map(i => `${i.completed ? '[x]' : '[ ]'} ${i.content}`));
    }
    const cs = (t.comments ?? []).slice(-12);
    if (cs.length) l.push('', 'Comentarios recientes:', ...cs.map(c => `- ${c.body.replace(/\s+/g, ' ').slice(0, 400)}`));
    if (t.uploads?.length) l.push('', 'Archivos de la tarea: ' + t.uploads.map(u => u.original_name).join(', '));
    return l.join('\n');
  }
}

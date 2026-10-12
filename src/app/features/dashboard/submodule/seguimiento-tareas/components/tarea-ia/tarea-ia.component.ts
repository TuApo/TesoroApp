import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TareasApiService } from '../../services/tareas-api.service';
import { EnjambreService, EstadoEnjambre, TareaEnjambre } from '../../services/enjambre.service';
import { IaTrabajo, Sugerencia, TareaDefinida, TareaDetalle } from '../../models/tareas.models';
import { hace, mensajeError, prioridadInfo } from '../../utils/tareas-ui';

type ModoSugerencia = Sugerencia['modo'];

const ACCIONES: { modo: ModoSugerencia; etiqueta: string; icono: string; ayuda: string }[] = [
  { modo: 'pasos', etiqueta: 'Proponer pasos', icono: 'checklist', ayuda: 'Pasos de checklist que faltan para terminarla' },
  { modo: 'descripcion', etiqueta: 'Redactar descripción', icono: 'edit_note', ayuda: 'Objetivo, alcance y criterio de terminado' },
  { modo: 'resumen', etiqueta: 'Resumir avance', icono: 'summarize', ayuda: 'En qué va, qué falta y qué se decidió en los comentarios' },
  { modo: 'siguientes', etiqueta: 'Siguientes pasos', icono: 'next_plan', ayuda: 'Qué hacer ahora y qué riesgos vigilar' },
  { modo: 'desglosar', etiqueta: 'Dividir en subtareas', icono: 'account_tree', ayuda: 'Subtareas independientes para repartir' },
];

const MAX_ADJUNTOS_AGENTE = 8 * 1024 * 1024;

/**
 * IA dentro de una tarea:
 *  - Asistente (LLM de ms-ai): propone pasos, redacta la descripción, resume el avance,
 *    sugiere siguientes pasos o divide la tarea en subtareas. Nada se aplica sin confirmar.
 *  - Enjambre de agentes (solo ADMIN): encarga un análisis de solo lectura; el resultado se
 *    registra en la tarea y se publica como comentario cuando la persona lo decide.
 */
@Component({
  selector: 'app-tarea-ia',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule, MatSnackBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tarea-ia.component.html',
  styleUrls: ['./tarea-ia.component.css'],
})
export class TareaIaComponent implements OnInit, OnDestroy {
  private readonly api = inject(TareasApiService);
  private readonly enjambre = inject(EnjambreService);
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

  // Enjambre
  readonly estadoEnjambre = signal<EstadoEnjambre | null>(null);
  readonly corridas = signal<IaTrabajo[]>([]);
  readonly vivas = signal<Map<string, TareaEnjambre>>(new Map());
  readonly abiertaCorrida = signal<number | null>(null);
  readonly encargando = signal(false);
  readonly mostrarEncargo = signal(false);
  objetivo = '';
  minutos = 20;
  repo: 'ninguno' | 'TesoroApp' | 'microservices' | 'todos' = 'ninguno';
  conAdjuntos = true;
  private sondeo: ReturnType<typeof setInterval> | null = null;

  readonly accionActual = computed(() => ACCIONES.find(a => a.modo === this.modo()) ?? null);
  readonly hayAgentes = computed(() => (this.estadoEnjambre()?.pool.listas ?? 0) > 0);
  readonly prioridadInfo = prioridadInfo;
  readonly hace = hace;

  async ngOnInit(): Promise<void> {
    try {
      const e = await this.api.iaEstado();
      this.disponible.set(e.disponible);
      if (e.puede_usar_agentes && e.agentes_habilitados) {
        // ms-ai responde 403 a quien no es ADMIN: entonces la sección no aparece.
        const est = await this.enjambre.estado().catch(() => null);
        this.estadoEnjambre.set(est);
        if (est) await this.cargarCorridas();
      }
    } catch { /* sin IA: la sección se oculta */ }
  }

  ngOnDestroy(): void {
    this.destruido = true;
    if (this.sondeo) clearInterval(this.sondeo);
  }

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

  // ── Enjambre ──
  abrirEncargo(): void {
    const t = this.tarea();
    this.objetivo = this.objetivo || `Analiza la tarea «${t.title}» y propone cómo resolverla: pasos concretos, `
      + 'datos o accesos necesarios, riesgos y, si aplica, qué módulo o código de la plataforma intervenir.';
    this.mostrarEncargo.set(true);
  }

  async encargar(): Promise<void> {
    const t = this.tarea();
    if (!this.objetivo.trim() || this.encargando()) return;
    this.encargando.set(true);
    try {
      const adjuntos = this.conAdjuntos ? await this.adjuntosEnBase64() : [];
      const r = await this.enjambre.encargar({
        titulo: `Seguimiento Tareas · #${t.id} ${t.title}`.slice(0, 140),
        objetivo: this.objetivo.trim(),
        contexto: this.contexto(),
        repo: this.repo === 'ninguno' ? undefined : this.repo,
        minutos: this.minutos,
        adjuntos,
      });
      await this.api.registrarAgente(t.id, r.id, this.objetivo.trim());
      this.mostrarEncargo.set(false);
      this.snack.open('Encargo enviado al enjambre. El resultado quedará en esta tarea.', undefined, { duration: 3500 });
      await this.cargarCorridas();
      this.cambio.emit();
    } catch (e) {
      this.snack.open(mensajeError(e, 'El enjambre no recibió el encargo.'), 'Cerrar', { duration: 5000 });
    } finally {
      this.encargando.set(false);
    }
  }

  async cancelarCorrida(c: IaTrabajo): Promise<void> {
    if (!c.referencia_externa) return;
    try {
      await this.enjambre.cancelar(c.referencia_externa);
      await this.api.actualizarIa(c.id, { estado: 'CANCELADO' });
      await this.cargarCorridas();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 });
    }
  }

  async publicarCorrida(c: IaTrabajo): Promise<void> {
    const texto = typeof c.resultado === 'string' ? c.resultado : this.vivas().get(c.referencia_externa ?? '')?.resumen;
    if (!texto) return;
    await this.aplicar(() => this.api.comentar(this.tarea().id, `[Enjambre de agentes]\n${texto}`, []), 'Resultado publicado como comentario');
  }

  textoCorrida(c: IaTrabajo): string {
    if (typeof c.resultado === 'string' && c.resultado) return c.resultado;
    const v = this.vivas().get(c.referencia_externa ?? '');
    return v?.resumen || v?.error || c.error || '';
  }

  estadoCorrida(c: IaTrabajo): { texto: string; tono: string; icono: string } {
    const v = this.vivas().get(c.referencia_externa ?? '');
    if (c.estado === 'LISTO') return { texto: 'Terminado', tono: 'ok', icono: 'task_alt' };
    if (c.estado === 'ERROR') return { texto: 'Falló', tono: 'error', icono: 'error_outline' };
    if (c.estado === 'CANCELADO') return { texto: 'Cancelado', tono: 'gris', icono: 'cancel' };
    if (!v) return { texto: 'Consultando…', tono: 'curso', icono: 'hourglass_top' };
    const m: Record<string, string> = { pendiente: 'En cola', asignada: 'Asignado', en_curso: 'Trabajando', interrumpida: 'Reintentando' };
    return { texto: m[v.estado] ?? v.estado, tono: 'curso', icono: v.estado === 'en_curso' ? 'smart_toy' : 'schedule' };
  }

  private async cargarCorridas(): Promise<void> {
    const todas = await this.api.iaDeTarea(this.tarea().id).catch(() => []);
    this.corridas.set(todas.filter(t => t.tipo === 'AGENTE'));
    const pendientes = this.corridas().filter(c => c.estado === 'EN_CURSO' || c.estado === 'PENDIENTE');
    if (pendientes.length && !this.sondeo) {
      this.sondeo = setInterval(() => this.refrescarVivas(), 8000);
      this.refrescarVivas();
    }
    if (!pendientes.length && this.sondeo) { clearInterval(this.sondeo); this.sondeo = null; }
  }

  /** Consulta al puente las corridas abiertas y cierra en ms-tools las que terminaron. */
  private async refrescarVivas(): Promise<void> {
    let cambio = false;
    for (const c of this.corridas().filter(x => x.estado === 'EN_CURSO' || x.estado === 'PENDIENTE')) {
      if (!c.referencia_externa) continue;
      try {
        const v = await this.enjambre.tarea(c.referencia_externa);
        this.vivas.update(m => new Map(m).set(c.referencia_externa!, v));
        if (!this.enjambre.sigueViva(v)) {
          const estado = v.estado === 'ok' ? 'LISTO' : v.estado === 'cancelada' ? 'CANCELADO' : 'ERROR';
          await this.api.actualizarIa(c.id, { estado, resultado: v.resumen || v.error || undefined, coste_usd: v.costeUsd });
          cambio = true;
        }
      } catch { /* el puente puede no estar disponible; se reintenta en el próximo ciclo */ }
    }
    if (cambio) await this.cargarCorridas();
  }

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
    l.push('', 'Entrega: un informe en español con el diagnóstico, la propuesta paso a paso y lo que requiere decisión humana. No modifiques código ni datos.');
    return l.join('\n');
  }

  /** Adjuntos de la tarea para el agente, hasta ~8 MB en total (los más recientes primero). */
  private async adjuntosEnBase64(): Promise<{ nombre: string; contenidoBase64: string }[]> {
    const out: { nombre: string; contenidoBase64: string }[] = [];
    let total = 0;
    for (const a of this.tarea().uploads ?? []) {
      if (total + a.size_bytes > MAX_ADJUNTOS_AGENTE) continue;
      try {
        const blob = await this.api.descargarAdjunto(a.uuid);
        out.push({ nombre: a.original_name, contenidoBase64: await this.base64(blob) });
        total += a.size_bytes;
      } catch { /* se omite el que no se pueda leer */ }
    }
    return out;
  }

  private base64(blob: Blob): Promise<string> {
    return new Promise((ok, mal) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] ?? '');
      r.onerror = () => mal(r.error);
      r.readAsDataURL(blob);
    });
  }
}

import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService, Persona } from '../../services/directorio.service';
import {
  Comentario, DependenciasTarea, Estado, Etiqueta, Grupo, Lista, MiembroEspacio, Prioridad, RegistroAuditoria, Tarea, TareaDetalle,
} from '../../models/tareas.models';
import {
  COLORES_ETIQUETA, ESTADOS, PRIORIDADES, aIsoFinDeJornada, atajosFecha, estadoInfo, etiquetaOrigen, hace,
  mensajeError, prioridadInfo, vencimiento, RUTA_TICKETS, rutaDeCaso,
} from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../avatar/avatar.component';
import { Eleccion, PersonaPickerComponent } from '../persona-picker/persona-picker.component';
import { AdjuntosComponent } from '../adjuntos/adjuntos.component';
import { MesaSoporteService } from '../../services/mesa-soporte.service';
import { PermissionsService } from '@/app/core/services/permissions.service';
import { TareaIaComponent } from '../tarea-ia/tarea-ia.component';
import { AvisoDialogComponent } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';

interface EventoHistorial { id: string; quien: string | null; texto: string; cuando: string; icono: string }

/**
 * Detalle de una tarea: todo lo que se necesita para trabajarla y darle seguimiento.
 *
 * Se usa dentro del panel lateral (TareaDetalleDialogComponent) y como página propia
 * (/dashboard/tareas/tarea/:id, que es a donde llevan las notificaciones). Emite `cambio`
 * cada vez que algo se guarda, para que la vista de atrás se refresque al cerrar.
 */
@Component({
  selector: 'app-tarea-detalle',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule, MatMenuModule, MatDatepickerModule,
    MatNativeDateModule, MatProgressBarModule, MatProgressSpinnerModule, MatSnackBarModule,
    TareaAvatarComponent, PersonaPickerComponent, AdjuntosComponent, TareaIaComponent,
  ],
  templateUrl: './tarea-detalle.component.html',
  styleUrls: ['./tarea-detalle.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TareaDetalleComponent implements OnInit {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);

  readonly tareaId = input.required<number>();
  readonly enPanel = input(true);
  readonly cambio = output<void>();
  readonly cerrar = output<void>();

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly t = signal<TareaDetalle | null>(null);
  readonly listas = signal<Lista[]>([]);
  readonly etiquetas = signal<Etiqueta[]>([]);
  readonly miembros = signal<MiembroEspacio[]>([]);
  readonly grupos = signal<Grupo[]>([]);
  readonly historial = signal<RegistroAuditoria[]>([]);
  readonly pestana = signal<'comentarios' | 'historial'>('comentarios');
  readonly guardando = signal(false);
  readonly eligiendoResponsable = signal(false);
  readonly agregandoSeguidor = signal(false);

  // Edición en línea
  titulo = '';
  descripcion = '';
  nuevoItem = '';
  nuevaEtiqueta = '';
  colorEtiqueta = COLORES_ETIQUETA[5];
  readonly coloresEtiqueta = COLORES_ETIQUETA;

  // Comentario con menciones
  comentario = '';
  readonly enviandoComentario = signal(false);
  readonly sugerenciasMencion = signal<Persona[]>([]);
  readonly indiceMencion = signal(0);
  private mencionados = new Map<string, string>(); // nombre → id
  private inicioMencion = -1;
  readonly cajaComentario = viewChild<ElementRef<HTMLTextAreaElement>>('cajaComentario');

  readonly estados = ESTADOS;
  readonly prioridades = PRIORIDADES;
  readonly atajos = atajosFecha();

  readonly estado = computed(() => estadoInfo(this.t()?.status));
  readonly prioridad = computed(() => prioridadInfo(this.t()?.priority));
  readonly venc = computed(() => { const t = this.t(); return t ? vencimiento(t) : null; });
  readonly fechaVence = computed(() => { const d = this.t()?.due_at; return d ? new Date(d) : null; });
  readonly fechaInicio = computed(() => { const d = this.t()?.start_at; return d ? new Date(d) : null; });

  // ── Dependencias: lo que esta tarea espera y lo que la espera a ella ──
  readonly deps = signal<DependenciasTarea>({ requisitos: [], dependientes: [] });
  readonly requisitosAbiertos = computed(() => this.deps().requisitos.filter(r => r.status !== 'DONE'));
  readonly agregandoDep = signal(false);
  readonly resultadosDep = signal<Tarea[]>([]);
  readonly buscandoDep = signal(false);
  textoDep = '';
  private temporizadorDep: ReturnType<typeof setTimeout> | null = null;
  readonly cercanos = computed(() => this.miembros().filter(m => m.active).map(m => m.user));
  /** Editar contenido (título, responsable, fechas...) exige no ser VIEWER del espacio. */
  readonly puedeEditar = computed(() => (this.t()?.workspace_role ?? 'MEMBER') !== 'VIEWER');
  /** Trabajarla (estado, checklist, comentarios) también lo puede su responsable/creador. */
  readonly puedeTrabajar = computed(() => this.t()?.can_edit !== false);
  readonly progreso = computed(() => {
    const items = this.t()?.checklist_items ?? [];
    if (!items.length) return null;
    const hechos = items.filter(i => i.completed).length;
    return { hechos, total: items.length, pct: Math.round(hechos * 100 / items.length) };
  });
  readonly etiquetasPuestas = computed(() => new Set((this.t()?.card_labels ?? []).map(l => l.label)));
  readonly seguidores = computed(() => (this.t()?.watchers ?? []).map(w => w.usuario_id));
  readonly comentarios = computed(() => this.t()?.comments ?? []);
  readonly origen = computed(() => etiquetaOrigen(this.t()?.origen_tipo));
  /** Caso de origen cuando es un ticket: su título y estado (control de estado tarea ↔ caso). */
  readonly caso = signal<{ titulo: string; estado: string } | null>(null);
  private readonly mesa = inject(MesaSoporteService);
  private readonly veTickets = inject(PermissionsService).canReadRoute(RUTA_TICKETS);
  readonly eventos = computed<EventoHistorial[]>(() => this.historial().map(h => this.describir(h)));

  async ngOnInit(): Promise<void> {
    this.dir.cargar();
    await this.cargar();
  }

  async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.cargando.set(true);
    this.error.set(null);
    try {
      const t = await this.api.detalle(this.tareaId());
      this.aplicar(t);
      if (!silencioso) {
        const [listas, etiquetas, miembros, grupos] = await Promise.all([
          t.board_id ? this.api.listas(t.board_id).catch(() => []) : Promise.resolve([]),
          t.board_id ? this.api.etiquetas(t.board_id).catch(() => []) : Promise.resolve([]),
          t.workspace_id ? this.api.miembros(t.workspace_id).catch(() => []) : Promise.resolve([]),
          this.api.grupos().catch(() => []),
        ]);
        this.listas.set(listas.map(l => ({ ...l, cards: [] })));
        this.etiquetas.set(etiquetas);
        this.miembros.set(miembros);
        this.grupos.set(grupos);
      }
      this.cargarHistorial();
      this.cargarDependencias();
    } catch (e: any) {
      this.error.set(e?.status === 404 ? 'Esta tarea ya no existe: la eliminaron o se movió fuera de tu alcance.'
                                       : mensajeError(e, 'No se pudo cargar la tarea.'));
    } finally {
      this.cargando.set(false);
    }
  }

  private aplicar(t: TareaDetalle): void {
    this.t.set(t);
    this.titulo = t.title;
    this.descripcion = t.description ?? '';
    if ((t.origen_tipo ?? '').toUpperCase() === 'TICKET' && t.origen_ref && this.veTickets) {
      this.mesa.detalle(t.origen_ref).then(k => this.caso.set({ titulo: k.titulo, estado: k.estado })).catch(() => this.caso.set(null));
    }
  }

  private async cargarHistorial(): Promise<void> {
    try {
      this.historial.set(await this.api.auditoria({ entity: 'card', entityId: this.tareaId(), size: 60 }));
    } catch { this.historial.set([]); }
  }

  /** Guarda un cambio, recarga el detalle y avisa a la vista de atrás. */
  private async guardar(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
    this.guardando.set(true);
    try {
      await fn();
      await this.cargar(true);
      this.cambio.emit();
      if (ok) this.snack.open(ok, undefined, { duration: 2200 });
      return true;
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
      await this.cargar(true);
      return false;
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Título y descripción ──
  guardarTitulo(): void {
    const t = this.t();
    const nuevo = this.titulo.trim();
    if (!t || !nuevo || nuevo === t.title) { this.titulo = t?.title ?? ''; return; }
    this.guardar(() => this.api.actualizarTarea(t.id, { title: nuevo }));
  }

  guardarDescripcion(): void {
    const t = this.t();
    if (!t || this.descripcion === (t.description ?? '')) return;
    this.guardar(() => this.api.actualizarTarea(t.id, { description: this.descripcion }), 'Descripción guardada');
  }

  // ── Estado ──
  /** El backend mueve la tarea a la columna de ese estado si el tablero la tiene. */
  cambiarEstado(e: Estado): void {
    const t = this.t();
    if (!t || t.status === e) return;
    const msg = e === 'DONE' ? 'Tarea completada' : `Ahora: ${estadoInfo(e).etiqueta}`;
    this.guardar(() => this.api.actualizarTarea(t.id, { status: e }), msg);
  }

  moverA(listaId: number): void {
    const t = this.t();
    if (!t || t.board_list === listaId) return;
    const l = this.listas().find(x => x.id === listaId);
    this.guardar(() => this.api.moverTarea(t.id, listaId, 0), l ? `Movida a «${l.name}»` : undefined);
  }

  // ── Responsable ──
  asignar(el: Eleccion): void {
    const t = this.t();
    if (!t) return;
    this.eligiendoResponsable.set(false);
    if (el.tipo === 'persona') {
      this.guardar(() => this.api.actualizarTarea(t.id, { assignee: el.id, assignee_name: el.nombre, assignee_group: null }),
        `Asignada a ${el.nombre}`);
    } else {
      this.guardar(() => this.api.actualizarTarea(t.id, { assignee: null, assignee_group: el.id }),
        `Asignada al grupo ${el.nombre}`);
    }
  }

  asignarme(): void {
    this.asignar({ tipo: 'persona', id: this.dir.yo.id, nombre: this.dir.yo.nombre });
  }

  quitarResponsable(): void {
    const t = this.t();
    if (!t) return;
    this.guardar(() => this.api.actualizarTarea(t.id, { assignee: null, assignee_group: null }), 'Sin responsable');
  }

  // ── Prioridad y fecha ──
  cambiarPrioridad(p: Prioridad): void {
    const t = this.t();
    if (!t || t.priority === p) return;
    this.guardar(() => this.api.actualizarTarea(t.id, { priority: p }));
  }

  cambiarFecha(d: Date | null): void {
    const t = this.t();
    if (!t) return;
    this.guardar(() => this.api.actualizarTarea(t.id, { due_at: aIsoFinDeJornada(d) }), d ? 'Fecha actualizada' : 'Sin fecha');
  }

  cambiarInicio(d: Date | null): void {
    const t = this.t();
    if (!t) return;
    const iso = d ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0, 0).toISOString() : null;
    this.guardar(() => this.api.actualizarTarea(t.id, { start_at: iso }), d ? 'Inicio actualizado' : 'Sin fecha de inicio');
  }

  // ── Dependencias ──
  async cargarDependencias(): Promise<void> {
    try { this.deps.set(await this.api.dependencias(this.tareaId())); } catch { this.deps.set({ requisitos: [], dependientes: [] }); }
  }

  buscarDependencia(q: string): void {
    this.textoDep = q;
    if (this.temporizadorDep) clearTimeout(this.temporizadorDep);
    if (q.trim().length < 2) { this.resultadosDep.set([]); return; }
    this.temporizadorDep = setTimeout(async () => {
      const t = this.t();
      if (!t) return;
      this.buscandoDep.set(true);
      try {
        const ya = new Set([t.id, ...this.deps().requisitos.map(r => r.id), ...this.deps().dependientes.map(r => r.id)]);
        // Primero del mismo espacio; si no hay, de cualquiera que se pueda ver.
        let r = await this.api.buscarTareas(q.trim(), t.workspace_id);
        if (!r.length) r = await this.api.buscarTareas(q.trim());
        this.resultadosDep.set(r.filter(x => !ya.has(x.id)).slice(0, 8));
      } catch { this.resultadosDep.set([]); }
      finally { this.buscandoDep.set(false); }
    }, 250);
  }

  async agregarDependencia(r: Tarea): Promise<void> {
    const t = this.t();
    if (!t) return;
    try {
      this.deps.set(await this.api.agregarDependencia(t.id, r.id));
      this.textoDep = '';
      this.resultadosDep.set([]);
      this.agregandoDep.set(false);
      this.snack.open(`Ahora espera a «${r.title}»`, undefined, { duration: 2600 });
      await this.cargar(true);
      this.cambio.emit();
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo enlazar.'), 'Cerrar', { duration: 4500 });
    }
  }

  async quitarDependencia(requisito: Tarea, desde?: Tarea): Promise<void> {
    const t = this.t();
    if (!t) return;
    // desde = tarea dependiente (cuando se quita desde "Bloquea a"); si no, es esta.
    const tarea = desde ?? t;
    try {
      await this.api.quitarDependencia(tarea.id, requisito.id);
      await this.cargarDependencias();
      await this.cargar(true);
      this.cambio.emit();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  abrirOtra(id: number): void {
    this.cerrar.emit();
    this.router.navigate(['/dashboard/tareas/tarea', id]);
  }

  // ── Etiquetas ──
  alternarEtiqueta(e: Etiqueta): void {
    const t = this.t();
    if (!t) return;
    const puesta = this.etiquetasPuestas().has(e.id);
    this.guardar(() => puesta ? this.api.quitarEtiqueta(t.id, e.id) : this.api.ponerEtiqueta(t.id, e.id));
  }

  async crearEtiqueta(): Promise<void> {
    const t = this.t();
    const nombre = this.nuevaEtiqueta.trim();
    if (!t?.board_id || !nombre) return;
    try {
      const e = await this.api.crearEtiqueta(t.board_id, { name: nombre, color: this.colorEtiqueta });
      this.etiquetas.update(l => [...l, e]);
      this.nuevaEtiqueta = '';
      await this.guardar(() => this.api.ponerEtiqueta(t.id, e.id));
    } catch (err) {
      this.snack.open(mensajeError(err), 'Cerrar', { duration: 4000 });
    }
  }

  // ── Seguimiento ──
  alternarSeguir(): void {
    const t = this.t();
    if (!t) return;
    this.guardar(() => this.api.alternarSeguir(t.id), t.is_watching ? 'Dejaste de seguir la tarea' : 'Ahora sigues la tarea');
  }

  agregarSeguidor(el: Eleccion): void {
    const t = this.t();
    this.agregandoSeguidor.set(false);
    if (!t || el.tipo !== 'persona') return;
    this.guardar(() => this.api.agregarSeguidor(t.id, el.id), `${el.nombre} sigue la tarea`);
  }

  quitarSeguidor(id: string): void {
    const t = this.t();
    if (!t) return;
    this.guardar(() => this.api.quitarSeguidor(t.id, id));
  }

  // ── Checklist ──
  agregarItem(): void {
    const t = this.t();
    const texto = this.nuevoItem.trim();
    if (!t || !texto) return;
    this.nuevoItem = '';
    this.guardar(() => this.api.agregarItem(t.id, texto));
  }

  alternarItem(id: number, completed: boolean): void {
    this.guardar(() => this.api.actualizarItem(id, { completed }));
  }

  eliminarItem(id: number): void {
    this.guardar(() => this.api.eliminarItem(id));
  }

  // ── Adjuntos e IA: los componentes hijos guardan; aquí solo se recarga y se avisa ──
  async alCambiarAdjuntos(): Promise<void> {
    await this.cargar(true);
    this.cambio.emit();
  }

  async alCambiarPorIa(): Promise<void> {
    await this.cargar(true);
    this.cambio.emit();
    this.cargarHistorial();
  }

  // ── Comentarios con @menciones ──
  alEscribir(ev: Event): void {
    const caja = ev.target as HTMLTextAreaElement;
    const antes = caja.value.slice(0, caja.selectionStart ?? caja.value.length);
    const m = /(^|\s)@([\p{L}\d][\p{L}\d .]{0,30})?$/u.exec(antes);
    if (!m) { this.cerrarMenciones(); return; }
    this.inicioMencion = antes.length - (m[2]?.length ?? 0) - 1;
    const q = m[2] ?? '';
    // Con menos de 2 letras se sugieren los miembros del espacio; luego, todo el directorio.
    this.sugerenciasMencion.set(this.dir.buscar(q, this.cercanos(), 6));
    this.indiceMencion.set(0);
  }

  teclaComentario(ev: KeyboardEvent): void {
    const s = this.sugerenciasMencion();
    if (s.length) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); this.indiceMencion.set((this.indiceMencion() + 1) % s.length); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); this.indiceMencion.set((this.indiceMencion() - 1 + s.length) % s.length); return; }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); this.mencionar(s[this.indiceMencion()]); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); this.cerrarMenciones(); return; }
    }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.comentar(); }
  }

  mencionar(p: Persona): void {
    const caja = this.cajaComentario()?.nativeElement;
    if (!caja || this.inicioMencion < 0) return;
    const fin = caja.selectionStart ?? caja.value.length;
    const insertado = `@${p.nombre} `;
    this.comentario = caja.value.slice(0, this.inicioMencion) + insertado + caja.value.slice(fin);
    this.mencionados.set(p.nombre, p.id);
    this.cerrarMenciones();
    queueMicrotask(() => {
      caja.focus();
      const pos = this.inicioMencion + insertado.length;
      caja.setSelectionRange(pos, pos);
      this.inicioMencion = -1;
    });
  }

  cerrarMenciones(): void {
    this.sugerenciasMencion.set([]);
  }

  async comentar(): Promise<void> {
    const t = this.t();
    const texto = this.comentario.trim();
    if (!t || !texto || this.enviandoComentario()) return;
    // Solo cuentan las menciones que siguen escritas en el texto final.
    const mentions = [...this.mencionados.entries()]
      .filter(([nombre]) => texto.includes(`@${nombre}`)).map(([, id]) => id);
    this.enviandoComentario.set(true);
    try {
      await this.api.comentar(t.id, texto, mentions);
      this.comentario = '';
      this.mencionados.clear();
      await this.cargar(true);
      this.cambio.emit();
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo enviar el comentario.'), 'Cerrar', { duration: 4500 });
    } finally {
      this.enviandoComentario.set(false);
    }
  }

  esMio(c: Comentario): boolean { return !!c.author && c.author === this.dir.yo.id; }

  async borrarComentario(c: Comentario): Promise<void> {
    if (!(await this.confirmar('¿Eliminar el comentario?', 'Se borra de la conversación de la tarea.', 'Eliminar'))) return;
    this.guardar(() => this.api.eliminarComentario(c.id));
  }

  /** Resalta las @menciones de un comentario sin interpretar HTML del usuario. */
  partes(texto: string): { t: string; m: boolean }[] {
    const out: { t: string; m: boolean }[] = [];
    const re = /@([\p{Lu}][\p{L}]+(?:\s[\p{Lu}][\p{L}]+){0,3})/gu;
    let ultimo = 0;
    for (const m of texto.matchAll(re)) {
      if (m.index! > ultimo) out.push({ t: texto.slice(ultimo, m.index), m: false });
      out.push({ t: m[0], m: true });
      ultimo = m.index! + m[0].length;
    }
    if (ultimo < texto.length) out.push({ t: texto.slice(ultimo), m: false });
    return out;
  }

  // ── Acciones generales ──
  copiarEnlace(): void {
    const url = `${location.origin}${location.pathname}#/dashboard/tareas/tarea/${this.tareaId()}`;
    this.clipboard.copy(url);
    this.snack.open('Enlace copiado: al abrirlo, la otra persona llega directo a la tarea', undefined, { duration: 2600 });
  }

  irAlTablero(): void {
    const t = this.t();
    if (!t?.board_id) return;
    this.cerrar.emit();
    this.router.navigate(['/dashboard/tareas/tableros', t.board_id], { queryParams: { tarea: t.id } });
  }

  irAlOrigen(): void {
    const t = this.t();
    const url = t ? rutaDeCaso(t) : null;
    if (!url) return;
    if (/^https?:\/\//i.test(url)) { window.open(url, '_blank', 'noopener'); return; }
    this.cerrar.emit();
    this.router.navigateByUrl(url);
  }

  async eliminar(): Promise<void> {
    const t = this.t();
    if (!t) return;
    if (!(await this.confirmar('¿Eliminar la tarea?', `Se borra <b>${this.escapar(t.title)}</b> con su checklist, comentarios y adjuntos. No se puede deshacer.`, 'Eliminar'))) return;
    try {
      await this.api.eliminarTarea(t.id);
      this.cambio.emit();
      this.snack.open('Tarea eliminada', undefined, { duration: 2200 });
      this.cerrar.emit();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  // ── Historial ──
  private describir(h: RegistroAuditoria): EventoHistorial {
    const md = (h.metadata ?? {}) as Record<string, any>;
    const accion = h.action;
    let texto = 'actualizó la tarea';
    let icono = 'edit';
    if (accion === 'create') { texto = 'creó la tarea'; icono = 'add_task'; }
    else if (accion === 'move') { texto = `la movió de «${md['from_list'] ?? '?'}» a «${md['to_list'] ?? '?'}»`; icono = 'swap_horiz'; }
    else if (accion === 'delete') { texto = 'eliminó la tarea'; icono = 'delete'; }
    else if (accion === 'watch_add') { texto = `agregó a ${this.dir.nombre(md['watcher'])} al seguimiento`; icono = 'visibility'; }
    else if (accion === 'update') {
      const partes: string[] = [];
      if (md['status']) partes.push(`estado → ${estadoInfo(md['status']).etiqueta}`);
      if (md['priority'] && String(md['changed'] ?? '').includes('prioridad')) partes.push(`prioridad → ${prioridadInfo(md['priority']).etiqueta}`);
      if (md['assignee']) partes.push(`responsable → ${md['assignee']}`);
      if (md['assignee_group']) partes.push(`grupo → ${md['assignee_group']}`);
      const resto = String(md['changed'] ?? '').split(',').map(s => s.trim())
        .filter(s => s && !['estado', 'prioridad', 'responsable', 'grupo responsable'].includes(s));
      if (resto.length) partes.push(`cambió ${resto.join(', ')}`);
      texto = partes.length ? partes.join(' · ') : 'actualizó la tarea';
      icono = md['status'] === 'DONE' ? 'task_alt' : 'edit';
    }
    return { id: String(h.id), quien: h.user, texto, cuando: h.created_at, icono };
  }

  // ── Utilidades ──
  hace = hace;

  private escapar(t: string): string {
    return (t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }

  private async confirmar(titulo: string, html: string, ok: string): Promise<boolean> {
    const ref = this.dialog.open(AvisoDialogComponent, {
      data: { icono: 'warning', titulo, html, textoConfirmar: ok, textoCancelar: 'Cancelar' },
      autoFocus: false,
    });
    return !!(await firstValueFrom(ref.afterClosed()));
  }
}

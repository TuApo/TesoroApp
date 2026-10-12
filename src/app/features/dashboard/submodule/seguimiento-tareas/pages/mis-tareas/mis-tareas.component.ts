import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { skip } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService, sinTildes } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { TareasEventosService } from '../../services/tareas-eventos.service';
import { MesaSoporteService, TicketMesa, prioridadTicket } from '../../services/mesa-soporte.service';
import { PermissionsService } from '@/app/core/services/permissions.service';
import { Alcance, Estado, Tarea } from '../../models/tareas.models';
import {
  ESTADOS, GRUPOS_VENCIMIENTO, PRIORIDADES, RUTA_TICKETS, compararTareas, estadoInfo, etiquetaOrigen, grupoVencimiento, hace, mensajeError,
} from '../../utils/tareas-ui';
import { TareaItemComponent } from '../../components/tarea-item/tarea-item.component';
import { TareaAvatarComponent } from '../../components/avatar/avatar.component';

type Agrupar = 'vencimiento' | 'tablero' | 'responsable' | 'estado';
interface Seccion { clave: string; titulo: string; icono: string; tareas: Tarea[]; plegada: boolean; avatar?: string | null; acento?: string | null }

type Vista = Exclude<Alcance, 'todas'>;

const ALCANCES: { clave: Vista; titulo: string; icono: string; vacio: string }[] = [
  { clave: 'asignadas', titulo: 'Asignadas a mí', icono: 'assignment_ind',
    vacio: 'No tienes tareas pendientes. Cuando alguien te asigne una (a ti o a uno de tus grupos) aparecerá aquí y te llegará un aviso.' },
  { clave: 'delegadas', titulo: 'Delegadas por mí', icono: 'forward_to_inbox',
    vacio: 'Aquí ves el avance de lo que pediste a otras personas. Crea una tarea y asígnasela a alguien para darle seguimiento.' },
  { clave: 'sigo', titulo: 'Las que sigo', icono: 'visibility',
    vacio: 'Sigue una tarea (botón «Seguir» en su detalle) para recibir sus comentarios, cambios y el cierre aunque no seas el responsable.' },
  { clave: 'areas', titulo: 'De mis áreas', icono: 'groups',
    vacio: 'Aquí ves el trabajo de los espacios (áreas y equipos) de los que eres miembro, aunque no esté a tu nombre.' },
];

/**
 * "Mis tareas": el tablero personal de trabajo diario. Responde sin abrir tableros qué tengo
 * que hacer (asignadas a mí o a mis grupos), cómo va lo que pedí (delegadas), qué sigo y qué
 * se mueve en mis áreas. Al lado, los casos de los procesos (tickets a mi cargo y tareas que
 * nacen de un ticket, una reunión...) con su estado y el acceso directo al caso.
 */
@Component({
  selector: 'app-mis-tareas',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule, TareaItemComponent, TareaAvatarComponent,
  ],
  templateUrl: './mis-tareas.component.html',
  styleUrls: ['./mis-tareas.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MisTareasComponent implements OnInit {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly mesa = inject(MesaSoporteService);
  readonly veTickets = inject(PermissionsService).canReadRoute(RUTA_TICKETS);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly alcances = ALCANCES;
  readonly prioridades = PRIORIDADES;
  readonly estados = ESTADOS;

  readonly alcance = signal<Vista>('asignadas');
  readonly datos = signal<Record<string, Tarea[]>>({ asignadas: [], delegadas: [], sigo: [], areas: [] });
  readonly tickets = signal<TicketMesa[]>([]);
  readonly soloCasos = signal(false);
  readonly filtrosAbiertos = signal(false);
  /** En pantallas angostas el panel de casos arranca plegado para no empujar la lista. */
  readonly casosPlegados = signal(typeof window !== 'undefined' && window.innerWidth <= 1200);
  readonly prioridadTicket = prioridadTicket;
  readonly hace = hace;
  readonly etiquetaOrigen = etiquetaOrigen;
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly busqueda = signal('');
  readonly espacio = signal<number | null>(null);
  readonly prioridad = signal<string | null>(null);
  readonly agrupar = signal<Agrupar>('vencimiento');
  private readonly plegadas = signal<Set<string>>(new Set(['hechas']));

  readonly tareas = computed(() => this.datos()[this.alcance()] ?? []);

  readonly espacios = computed(() => {
    const m = new Map<number, string>();
    for (const t of this.tareas()) if (t.workspace_id) m.set(t.workspace_id, t.workspace_name ?? '');
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  });

  readonly filtradas = computed(() => {
    const q = sinTildes(this.busqueda().trim());
    const ws = this.espacio();
    const p = this.prioridad();
    const casos = this.soloCasos();
    return this.tareas().filter(t =>
      (!q || sinTildes(`${t.title} ${t.board_name ?? ''} ${t.workspace_name ?? ''} ${t.origen_ref ?? ''}`).includes(q)) &&
      (!ws || t.workspace_id === ws) &&
      (!p || t.priority === p) &&
      (!casos || !!t.origen_tipo));
  });

  /** Estado de cada ticket (para el chip "Ticket · En Progreso" de las tareas que nacen de uno). */
  readonly estadosTicket = computed(() => new Map(this.tickets().map(t => [t.id, t.estado])));

  /** Tickets a mi cargo que siguen abiertos (asignado_a guarda el nombre de la persona). */
  readonly misTickets = computed(() => {
    const yo = sinTildes(this.dir.yo.nombre);
    return this.tickets()
      .filter(t => (t.estado === 'Abierto' || t.estado === 'En Progreso') && sinTildes(t.asignado_a ?? '') === yo)
      .sort((a, b) => prioridadTicket(b.prioridad).peso - prioridadTicket(a.prioridad).peso);
  });

  /** Tareas abiertas que nacen de un proceso (ticket, reunión, otra tarea...), de todas mis vistas. */
  readonly tareasDeCasos = computed(() => {
    const vistas = new Map<number, Tarea>();
    for (const k of ['asignadas', 'delegadas', 'sigo'] as const) {
      for (const t of this.datos()[k] ?? []) if (t.origen_tipo && t.status !== 'DONE') vistas.set(t.id, t);
    }
    return [...vistas.values()].sort(compararTareas);
  });

  readonly saludo = computed(() => {
    const a = (this.datos()['asignadas'] ?? []).filter(t => t.status !== 'DONE');
    const venc = a.filter(t => grupoVencimiento(t) === 'vencidas').length;
    const hoy = a.filter(t => grupoVencimiento(t) === 'hoy').length;
    const nombre = (this.dir.yo.nombre || '').split(' ')[0];
    const partes = [venc ? `${venc} vencida${venc === 1 ? '' : 's'}` : '', hoy ? `${hoy} para hoy` : ''].filter(Boolean);
    return { nombre, texto: partes.length ? `Tienes ${partes.join(' y ')}.` : a.length ? 'Vas al día.' : 'No tienes pendientes asignados.' };
  });

  readonly conteos = computed(() => {
    const out: Record<string, number> = {};
    for (const a of ALCANCES) out[a.clave] = (this.datos()[a.clave] ?? []).filter(t => t.status !== 'DONE').length;
    return out;
  });

  readonly kpis = computed(() => {
    const ts = this.tareas();
    const abiertas = ts.filter(t => t.status !== 'DONE');
    const g = (k: string) => abiertas.filter(t => grupoVencimiento(t) === k).length;
    return [
      { clave: 'abiertas', etiqueta: 'Abiertas', valor: abiertas.length, tono: 'base', icono: 'pending_actions' },
      { clave: 'vencidas', etiqueta: 'Vencidas', valor: g('vencidas'), tono: 'peligro', icono: 'running_with_errors' },
      { clave: 'hoy', etiqueta: 'Para hoy', valor: g('hoy'), tono: 'aviso', icono: 'today' },
      { clave: 'semana', etiqueta: 'Próx. 7 días', valor: g('semana'), tono: 'info', icono: 'date_range' },
      { clave: 'bloqueadas', etiqueta: 'Bloqueadas', valor: abiertas.filter(t => t.status === 'BLOCKED').length, tono: 'peligro', icono: 'block' },
      { clave: 'hechas', etiqueta: 'Completadas (30 d)', valor: ts.filter(t => t.status === 'DONE').length, tono: 'ok', icono: 'task_alt' },
    ];
  });

  readonly secciones = computed<Seccion[]>(() => {
    const ts = [...this.filtradas()];
    const plegadas = this.plegadas();
    const modo = this.agrupar();
    const abiertas = ts.filter(t => t.status !== 'DONE');
    const hechas = ts.filter(t => t.status === 'DONE')
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
    const out: Seccion[] = [];
    const empujar = (clave: string, titulo: string, icono: string, lista: Tarea[], extra: Partial<Seccion> = {}) => {
      if (lista.length) out.push({ clave, titulo, icono, tareas: lista.sort(compararTareas), plegada: plegadas.has(clave), ...extra });
    };
    if (modo === 'vencimiento') {
      for (const g of GRUPOS_VENCIMIENTO.filter(x => x.clave !== 'hechas')) {
        empujar(g.clave, g.titulo, g.icono, abiertas.filter(t => grupoVencimiento(t) === g.clave));
      }
    } else if (modo === 'estado') {
      for (const e of ESTADOS.filter(x => x.clave !== 'DONE')) empujar(e.clave, e.etiqueta, e.icono, abiertas.filter(t => t.status === e.clave));
    } else if (modo === 'tablero') {
      const m = new Map<string, Tarea[]>();
      for (const t of abiertas) { const k = String(t.board_id ?? 0); m.set(k, [...(m.get(k) ?? []), t]); }
      for (const [k, lista] of [...m.entries()].sort((a, b) => (a[1][0].board_name ?? '').localeCompare(b[1][0].board_name ?? '', 'es'))) {
        empujar(`b-${k}`, `${lista[0].board_name ?? 'Tablero'} · ${lista[0].workspace_name ?? ''}`, 'view_kanban', lista, { acento: lista[0].board_accent });
      }
    } else {
      const m = new Map<string, Tarea[]>();
      for (const t of abiertas) {
        const k = t.assignee ? `u-${t.assignee}` : t.assignee_group ? `g-${t.assignee_group}` : 'sin';
        m.set(k, [...(m.get(k) ?? []), t]);
      }
      const nombre = (k: string, t: Tarea) => k === 'sin' ? 'Sin responsable'
        : k.startsWith('g-') ? `Grupo ${t.assignee_group_name ?? ''}` : this.dir.nombre(t.assignee);
      this.dir.personas();
      for (const [k, lista] of [...m.entries()].sort((a, b) => nombre(a[0], a[1][0]).localeCompare(nombre(b[0], b[1][0]), 'es'))) {
        empujar(k, nombre(k, lista[0]), k === 'sin' ? 'person_off' : 'person', lista, { avatar: lista[0].assignee });
      }
    }
    if (hechas.length) {
      out.push({ clave: 'hechas', titulo: 'Completadas recientemente', icono: 'task_alt', tareas: hechas, plegada: plegadas.has('hechas') });
    }
    return out;
  });

  readonly info = computed(() => ALCANCES.find(a => a.clave === this.alcance())!);

  constructor() {
    toObservable(inject(TareasEventosService).version).pipe(skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.cargar(true));
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(q => {
      const v = q.get('vista');
      if (v === 'asignadas' || v === 'delegadas' || v === 'sigo' || v === 'areas') this.alcance.set(v);
      if (v === 'delegadas') this.agrupar.set('responsable');
      if (v === 'areas') this.agrupar.set('tablero');
    });
  }

  ngOnInit(): void { this.cargar(); }

  async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.cargando.set(true);
    this.error.set(null);
    try {
      const [asignadas, delegadas, sigo, areas] = await Promise.all([
        this.api.misTareas('asignadas'), this.api.misTareas('delegadas'), this.api.misTareas('sigo'),
        this.api.misTareas('areas').catch(() => [] as Tarea[]),
      ]);
      this.datos.set({ asignadas, delegadas, sigo, areas });
      if (this.veTickets) this.mesa.listar().then(t => this.tickets.set(t)).catch(() => this.tickets.set([]));
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar tus tareas.'));
    } finally {
      this.cargando.set(false);
    }
  }

  elegirAlcance(a: Vista): void {
    this.alcance.set(a);
    this.agrupar.set(a === 'delegadas' ? 'responsable' : a === 'areas' ? 'tablero' : 'vencimiento');
    this.router.navigate([], { relativeTo: this.route, queryParams: { vista: a }, replaceUrl: true });
  }

  alternarSeccion(clave: string): void {
    this.plegadas.update(s => { const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n; });
  }

  limpiarFiltros(): void {
    this.busqueda.set(''); this.espacio.set(null); this.prioridad.set(null); this.soloCasos.set(false);
  }

  hayFiltros(): boolean { return !!(this.busqueda() || this.espacio() || this.prioridad() || this.soloCasos()); }

  estadoCaso(t: Tarea): string | null {
    return (t.origen_tipo ?? '').toUpperCase() === 'TICKET' && t.origen_ref ? this.estadosTicket().get(t.origen_ref) ?? null : null;
  }

  /** Ver en la lista solo las tareas que vienen de un caso, en la vista de lo asignado. */
  verCasos(): void {
    if (this.alcance() !== 'asignadas') this.elegirAlcance('asignadas');
    this.soloCasos.set(true);
  }

  async abrir(t: Tarea): Promise<void> {
    if (await this.dialogos.abrirTarea(t.id)) this.cargar(true);
  }

  async nueva(): Promise<void> {
    const prefill = this.alcance() === 'asignadas' ? { responsable: this.dir.yo.id } : {};
    if (await this.dialogos.nuevaTarea(prefill)) this.cargar(true);
  }

  completar(t: Tarea): void {
    this.cambiarEstado({ tarea: t, estado: t.status === 'DONE' ? 'TODO' : 'DONE' });
  }

  async cambiarEstado(ev: { tarea: Tarea; estado: Estado }): Promise<void> {
    const { tarea, estado } = ev;
    const antes = tarea.status;
    this.parchear(tarea.id, { status: estado, completed_at: estado === 'DONE' ? new Date().toISOString() : null });
    try {
      await this.api.actualizarTarea(tarea.id, { status: estado });
      const ref = this.snack.open(estado === 'DONE' ? `Completada: ${tarea.title}` : `«${tarea.title}» → ${estadoInfo(estado).etiqueta}`,
        'Deshacer', { duration: 5000 });
      ref.onAction().subscribe(async () => {
        await this.api.actualizarTarea(tarea.id, { status: antes }).catch(() => undefined);
        this.cargar(true);
      });
      this.cargar(true);
    } catch (e) {
      this.parchear(tarea.id, { status: antes });
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  /** Cambio optimista en todas las listas donde aparezca la tarea. */
  private parchear(id: number, cambios: Partial<Tarea>): void {
    this.datos.update(d => {
      const n: Record<string, Tarea[]> = {};
      for (const [k, v] of Object.entries(d)) n[k] = v.map(t => t.id === id ? { ...t, ...cambios } : t);
      return n;
    });
  }
}

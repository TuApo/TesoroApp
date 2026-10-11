import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
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
import { Alcance, Estado, Tarea } from '../../models/tareas.models';
import {
  ESTADOS, GRUPOS_VENCIMIENTO, PRIORIDADES, compararTareas, estadoInfo, grupoVencimiento, mensajeError,
} from '../../utils/tareas-ui';
import { TareaItemComponent } from '../../components/tarea-item/tarea-item.component';
import { TareaAvatarComponent } from '../../components/avatar/avatar.component';

type Agrupar = 'vencimiento' | 'tablero' | 'responsable' | 'estado';
interface Seccion { clave: string; titulo: string; icono: string; tareas: Tarea[]; plegada: boolean; avatar?: string | null; acento?: string | null }

const ALCANCES: { clave: Exclude<Alcance, 'todas'>; titulo: string; icono: string; vacio: string }[] = [
  { clave: 'asignadas', titulo: 'Asignadas a mí', icono: 'assignment_ind',
    vacio: 'No tienes tareas pendientes. Cuando alguien te asigne una (a ti o a uno de tus grupos) aparecerá aquí y te llegará un aviso.' },
  { clave: 'delegadas', titulo: 'Delegadas por mí', icono: 'forward_to_inbox',
    vacio: 'Aquí ves el avance de lo que pediste a otras personas. Crea una tarea y asígnasela a alguien para darle seguimiento.' },
  { clave: 'sigo', titulo: 'Las que sigo', icono: 'visibility',
    vacio: 'Sigue una tarea (botón «Seguir» en su detalle) para recibir sus comentarios, cambios y el cierre aunque no seas el responsable.' },
];

/**
 * "Mis tareas": la vista de trabajo diario. Responde a tres preguntas sin abrir tableros:
 * qué tengo que hacer (asignadas a mí o a mis grupos), cómo va lo que pedí (delegadas) y
 * qué estoy siguiendo. Agrupa por urgencia y deja completar o cambiar estado en un clic.
 */
@Component({
  selector: 'app-mis-tareas',
  standalone: true,
  imports: [
    FormsModule, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule, TareaItemComponent, TareaAvatarComponent,
  ],
  templateUrl: './mis-tareas.component.html',
  styleUrls: ['./mis-tareas.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MisTareasComponent implements OnInit {
  private readonly api = inject(TareasApiService);
  private readonly dir = inject(DirectorioService);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly alcances = ALCANCES;
  readonly prioridades = PRIORIDADES;
  readonly estados = ESTADOS;

  readonly alcance = signal<Exclude<Alcance, 'todas'>>('asignadas');
  readonly datos = signal<Record<string, Tarea[]>>({ asignadas: [], delegadas: [], sigo: [] });
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
    return this.tareas().filter(t =>
      (!q || sinTildes(`${t.title} ${t.board_name ?? ''} ${t.workspace_name ?? ''}`).includes(q)) &&
      (!ws || t.workspace_id === ws) &&
      (!p || t.priority === p));
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
      if (v === 'asignadas' || v === 'delegadas' || v === 'sigo') this.alcance.set(v);
      if (v === 'delegadas') this.agrupar.set('responsable');
    });
  }

  ngOnInit(): void { this.cargar(); }

  async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.cargando.set(true);
    this.error.set(null);
    try {
      const [asignadas, delegadas, sigo] = await Promise.all([
        this.api.misTareas('asignadas'), this.api.misTareas('delegadas'), this.api.misTareas('sigo'),
      ]);
      this.datos.set({ asignadas, delegadas, sigo });
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar tus tareas.'));
    } finally {
      this.cargando.set(false);
    }
  }

  elegirAlcance(a: Exclude<Alcance, 'todas'>): void {
    this.alcance.set(a);
    this.agrupar.set(a === 'delegadas' ? 'responsable' : 'vencimiento');
    this.router.navigate([], { relativeTo: this.route, queryParams: { vista: a }, replaceUrl: true });
  }

  alternarSeccion(clave: string): void {
    this.plegadas.update(s => { const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n; });
  }

  limpiarFiltros(): void {
    this.busqueda.set(''); this.espacio.set(null); this.prioridad.set(null);
  }

  hayFiltros(): boolean { return !!(this.busqueda() || this.espacio() || this.prioridad()); }

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

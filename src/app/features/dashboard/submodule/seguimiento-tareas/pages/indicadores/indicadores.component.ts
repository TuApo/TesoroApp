import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import { Espacio, Resumen, Tarea } from '../../models/tareas.models';
import { grupoVencimiento, mensajeError } from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../../components/avatar/avatar.component';

interface Carga { clave: string; usuario: string | null; grupo: string | null; nombre: string; abiertas: number; vencidas: number; bloqueadas: number; hechas: number }

/**
 * Indicadores para quien coordina: avance, vencidas y carga por persona. La carga se
 * calcula con las tareas abiertas de cada responsable (las de grupo cuentan para el grupo),
 * así se ve a quién se le está acumulando el trabajo antes de asignarle más.
 */
@Component({
  selector: 'app-indicadores-tareas',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatTooltipModule, MatProgressSpinnerModule, TareaAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './indicadores.component.html',
  styleUrls: ['./indicadores.component.css'],
})
export class IndicadoresComponent {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);

  readonly resumen = signal<Resumen | null>(null);
  readonly espacios = signal<Espacio[]>([]);
  readonly tareas = signal<Tarea[] | null>(null);
  readonly espacio = signal<number | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly sinPermisoGlobal = signal(false);

  readonly kpis = computed(() => {
    const r = this.resumen();
    if (!r) return [];
    return [
      { etiqueta: 'Tareas', valor: r.total_tasks, detalle: `${r.total_boards} tableros · ${r.total_workspaces} espacios`, icono: 'assignment', tono: 'base' },
      { etiqueta: 'Completadas', valor: `${r.completion_rate}%`, detalle: `${r.completed_tasks} de ${r.total_tasks}`, icono: 'task_alt', tono: 'ok' },
      { etiqueta: 'Vencidas', valor: r.overdue_tasks, detalle: 'abiertas con fecha pasada', icono: 'running_with_errors', tono: r.overdue_tasks ? 'peligro' : 'base' },
      { etiqueta: 'Por vencer', valor: r.due_soon_tasks, detalle: `próximos ${r.due_soon_window_days} días`, icono: 'event_upcoming', tono: 'aviso' },
      { etiqueta: 'Bloqueadas', valor: r.blocked_tasks, detalle: 'esperando algo', icono: 'block', tono: r.blocked_tasks ? 'peligro' : 'base' },
      { etiqueta: 'Sin responsable', valor: r.unassigned_tasks, detalle: `${r.assignment_coverage_rate}% asignadas`, icono: 'person_off', tono: r.unassigned_tasks ? 'aviso' : 'base' },
    ];
  });

  readonly distribucion = computed(() => {
    const r = this.resumen();
    if (!r || !r.total_tasks) return [];
    const pct = (n: number) => Math.round(n * 1000 / r.total_tasks) / 10;
    return [
      { etiqueta: 'Por hacer', n: r.todo_tasks, pct: pct(r.todo_tasks), tono: 'todo' },
      { etiqueta: 'En progreso', n: r.in_progress_tasks, pct: pct(r.in_progress_tasks), tono: 'prog' },
      { etiqueta: 'Bloqueadas', n: r.blocked_tasks, pct: pct(r.blocked_tasks), tono: 'block' },
      { etiqueta: 'Completadas', n: r.completed_tasks, pct: pct(r.completed_tasks), tono: 'done' },
    ];
  });

  readonly tablerosOrdenados = computed(() =>
    [...(this.resumen()?.board_indicators ?? [])].filter(b => b.task_count > 0)
      .sort((a, b) => b.overdue_task_count - a.overdue_task_count || (b.task_count - b.completed_task_count) - (a.task_count - a.completed_task_count)));

  readonly espaciosOrdenados = computed(() =>
    [...(this.resumen()?.workspace_indicators ?? [])].sort((a, b) => b.task_count - a.task_count));

  readonly carga = computed<Carga[]>(() => {
    const ts = this.tareas();
    if (!ts) return [];
    this.dir.personas();
    const m = new Map<string, Carga>();
    for (const t of ts) {
      const k = t.assignee ? `u-${t.assignee}` : t.assignee_group ? `g-${t.assignee_group}` : 'sin';
      const c = m.get(k) ?? {
        clave: k, usuario: t.assignee, grupo: !t.assignee && t.assignee_group ? (t.assignee_group_name ?? 'Grupo') : null,
        nombre: t.assignee ? this.dir.nombre(t.assignee) : t.assignee_group ? `Grupo ${t.assignee_group_name ?? ''}` : 'Sin responsable',
        abiertas: 0, vencidas: 0, bloqueadas: 0, hechas: 0,
      };
      if (t.status === 'DONE') c.hechas++;
      else {
        c.abiertas++;
        if (t.status === 'BLOCKED') c.bloqueadas++;
        if (grupoVencimiento(t) === 'vencidas') c.vencidas++;
      }
      m.set(k, c);
    }
    return [...m.values()].sort((a, b) => b.abiertas - a.abiertas || b.vencidas - a.vencidas);
  });
  readonly maxCarga = computed(() => Math.max(1, ...this.carga().map(c => c.abiertas)));

  constructor() {
    this.dir.cargar();
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [r, es] = await Promise.all([this.api.resumen(), this.api.espacios().catch(() => [])]);
      this.resumen.set(r);
      this.espacios.set(es);
      await this.cargarCarga();
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los indicadores.'));
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarCarga(): Promise<void> {
    try {
      this.tareas.set(await this.api.misTareas('todas', { workspace: this.espacio(), closedDays: 30 }));
      this.sinPermisoGlobal.set(false);
    } catch (e: any) {
      this.tareas.set(null);
      this.sinPermisoGlobal.set(e?.status === 403);
    }
  }

  elegirEspacio(id: number | null): void {
    this.espacio.set(id);
    this.cargarCarga();
  }
}

import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { skip } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TareasApiService } from '../../services/tareas-api.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { TareasEventosService } from '../../services/tareas-eventos.service';
import { Cronograma, Espacio } from '../../models/tareas.models';
import { mensajeError } from '../../utils/tareas-ui';
import { AgruparGantt, CambioFechas, GanttComponent } from '../../components/gantt/gantt.component';

const CLAVE_ESPACIO = 'tareas.cronogramaEspacio';
const CLAVE_AGRUPAR = 'tareas.cronogramaAgrupar';

/**
 * Cronograma de un espacio: todas sus tareas en un Gantt (inicio → vencimiento), con las
 * dependencias entre ellas, el avance del proyecto y lo que está atrasado o esperando.
 * Quien puede editar mueve y estira las barras para reprogramar.
 */
@Component({
  selector: 'app-cronograma',
  standalone: true,
  imports: [DatePipe, RouterLink, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatProgressSpinnerModule,
    MatSnackBarModule, GanttComponent],
  templateUrl: './cronograma.component.html',
  styleUrls: ['./cronograma.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CronogramaComponent {
  private readonly api = inject(TareasApiService);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly espacios = signal<Espacio[]>([]);
  readonly espacioId = signal<number | null>(null);
  readonly tablero = signal<number | null>(null);
  readonly datos = signal<Cronograma | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly agrupar = signal<AgruparGantt>(this.leer(CLAVE_AGRUPAR, 'tablero') as AgruparGantt);
  readonly ocultarHechas = signal(false);
  readonly soloConFechas = signal(false);

  readonly espacio = computed(() => this.espacios().find(e => e.id === this.espacioId()) ?? null);
  readonly editable = computed(() => {
    const r = this.espacio()?.current_user_role;
    return !!r && r !== 'VIEWER';
  });

  readonly tareas = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const tb = this.tablero();
    return d.tareas.filter(t =>
      (!tb || t.board_id === tb) &&
      (!this.ocultarHechas() || t.status !== 'DONE') &&
      (!this.soloConFechas() || !!(t.start_at || t.due_at)));
  });

  readonly dependencias = computed(() => {
    const ids = new Set(this.tareas().map(t => t.id));
    return (this.datos()?.dependencias ?? []).filter(d => ids.has(d.card_id) && ids.has(d.requisito_id));
  });

  /** Indicadores del proyecto (sobre lo que se ve). */
  readonly kpis = computed(() => {
    const ts = this.datos()?.tareas.filter(t => !this.tablero() || t.board_id === this.tablero()) ?? [];
    const ahora = Date.now();
    const total = ts.length;
    const hechas = ts.filter(t => t.status === 'DONE').length;
    const atrasadas = ts.filter(t => t.status !== 'DONE' && t.due_at && new Date(t.due_at).getTime() < ahora).length;
    const esperando = ts.filter(t => t.status !== 'DONE' && (t.requisitos_abiertos ?? 0) > 0).length;
    const enCurso = ts.filter(t => t.status === 'IN_PROGRESS').length;
    const sinFecha = ts.filter(t => !t.due_at && !t.start_at && t.status !== 'DONE').length;
    // Avance ponderado por checklist: una tarea a medio checklist cuenta a medias.
    const avance = total ? ts.reduce((n, t) => n + (t.status === 'DONE' ? 1 : (t.checklist_total ?? 0) > 0 ? (t.checklist_done ?? 0) / t.checklist_total! : 0), 0) / total : 0;
    const fines = ts.filter(t => t.due_at && t.status !== 'DONE').map(t => new Date(t.due_at!).getTime());
    const fin = fines.length ? new Date(Math.max(...fines)) : null;
    return { total, hechas, atrasadas, esperando, enCurso, sinFecha, avance: Math.round(avance * 100), fin };
  });

  constructor() {
    this.iniciar();
    toObservable(inject(TareasEventosService).version).pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.cargar());
  }

  private async iniciar(): Promise<void> {
    try {
      const es = await this.api.espacios();
      this.espacios.set(es);
      const pedido = Number(this.route.snapshot.queryParamMap.get('espacio')) || Number(this.leer(CLAVE_ESPACIO, '')) || null;
      const id = es.find(e => e.id === pedido)?.id ?? es.find(e => e.board_count > 0)?.id ?? es[0]?.id ?? null;
      this.tablero.set(Number(this.route.snapshot.queryParamMap.get('tablero')) || null);
      this.espacioId.set(id);
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los espacios.'));
      this.cargando.set(false);
    }
  }

  async cargar(): Promise<void> {
    const id = this.espacioId();
    if (!id) { this.cargando.set(false); this.datos.set(null); return; }
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.datos.set(await this.api.cronograma({ workspace: id }));
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo cargar el cronograma.'));
    } finally {
      this.cargando.set(false);
    }
  }

  elegirEspacio(id: number): void {
    this.espacioId.set(id);
    this.tablero.set(null);
    this.guardar(CLAVE_ESPACIO, String(id));
    this.router.navigate([], { relativeTo: this.route, queryParams: { espacio: id }, replaceUrl: true });
    this.cargar();
  }

  elegirTablero(id: number | null): void {
    this.tablero.set(id);
    this.router.navigate([], { relativeTo: this.route, queryParams: { espacio: this.espacioId(), tablero: id }, replaceUrl: true });
  }

  cambiarAgrupar(a: AgruparGantt): void { this.agrupar.set(a); this.guardar(CLAVE_AGRUPAR, a); }

  async abrir(id: number): Promise<void> {
    if (await this.dialogos.abrirTarea(id)) this.cargar();
  }

  /** Reprogramar arrastrando: se guarda y se recarga (el servidor valida inicio ≤ vencimiento). */
  async reprogramar(c: CambioFechas): Promise<void> {
    const d = this.datos();
    if (d) {
      this.datos.set({ ...d, tareas: d.tareas.map(t => t.id === c.tarea.id ? { ...t, start_at: c.start_at, due_at: c.due_at } : t) });
    }
    try {
      await this.api.actualizarTarea(c.tarea.id, { start_at: c.start_at, due_at: c.due_at });
      const f = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
      this.snack.open(`«${c.tarea.title}»: ${f(c.start_at)} → ${f(c.due_at)}`, undefined, { duration: 2600 });
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo reprogramar.'), 'Cerrar', { duration: 4500 });
    }
    this.cargar();
  }

  private leer(k: string, porDefecto: string): string {
    try { return localStorage.getItem(k) ?? porDefecto; } catch { return porDefecto; }
  }
  private guardar(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ }
  }
}

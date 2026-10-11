import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { skip } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { TareasEventosService } from '../../services/tareas-eventos.service';
import { Tarea } from '../../models/tareas.models';
import { compararTareas, mensajeError, vencimiento } from '../../utils/tareas-ui';
import { TareaItemComponent } from '../../components/tarea-item/tarea-item.component';

interface Dia { fecha: Date; clave: string; delMes: boolean; hoy: boolean; tareas: Tarea[] }

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function clave(d: Date): string { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

/**
 * Vencimientos del mes. Por defecto solo las tareas donde participo (responsable, grupo,
 * creador o seguidor); "Todas" muestra las de toda la plataforma. Un día se abre con un
 * clic para ver su lista completa.
 */
@Component({
  selector: 'app-calendario-tareas',
  standalone: true,
  imports: [DatePipe, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressSpinnerModule, TareaItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendario.component.html',
  styleUrls: ['./calendario.component.css'],
})
export class CalendarioComponent {
  private readonly api = inject(TareasApiService);
  private readonly dialogos = inject(TareasDialogosService);
  readonly dir = inject(DirectorioService);

  readonly dias = DIAS;
  readonly mes = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly alcance = signal<'mias' | 'todas'>('mias');
  readonly tareas = signal<Tarea[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly diaElegido = signal<string | null>(clave(new Date()));

  /** Semanas que se pintan: de lunes a domingo, cubriendo el mes completo. */
  readonly rango = computed(() => {
    const m = this.mes();
    const inicio = new Date(m);
    inicio.setDate(1 - ((m.getDay() + 6) % 7));
    const fin = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    fin.setDate(fin.getDate() + (7 - ((fin.getDay() + 6) % 7) - 1) + 1);
    return { inicio, fin };
  });

  readonly celdas = computed<Dia[]>(() => {
    const { inicio, fin } = this.rango();
    const porDia = new Map<string, Tarea[]>();
    for (const t of this.tareas()) {
      if (!t.due_at) continue;
      const k = clave(new Date(t.due_at));
      porDia.set(k, [...(porDia.get(k) ?? []), t]);
    }
    const hoy = clave(new Date());
    const out: Dia[] = [];
    for (let d = new Date(inicio); d < fin; d.setDate(d.getDate() + 1)) {
      const k = clave(d);
      out.push({ fecha: new Date(d), clave: k, delMes: d.getMonth() === this.mes().getMonth(), hoy: k === hoy,
                 tareas: (porDia.get(k) ?? []).sort(compararTareas) });
    }
    return out;
  });

  readonly elegido = computed(() => this.celdas().find(c => c.clave === this.diaElegido()) ?? null);
  readonly resumen = computed(() => {
    const ts = this.tareas().filter(t => t.status !== 'DONE');
    return { abiertas: ts.length, vencidas: ts.filter(t => vencimiento(t).tono === 'vencida').length };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.cargar();
    toObservable(inject(TareasEventosService).version).pipe(skip(1), takeUntilDestroyed(destroyRef)).subscribe(() => this.cargar());
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    const { inicio, fin } = this.rango();
    try {
      this.tareas.set(await this.api.calendario(inicio, fin, this.alcance()));
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo cargar el calendario.'));
    } finally {
      this.cargando.set(false);
    }
  }

  mover(delta: number): void {
    const m = this.mes();
    this.mes.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
    this.diaElegido.set(null);
    this.cargar();
  }

  hoy(): void {
    const h = new Date();
    this.mes.set(new Date(h.getFullYear(), h.getMonth(), 1));
    this.diaElegido.set(clave(h));
    this.cargar();
  }

  cambiarAlcance(a: 'mias' | 'todas'): void {
    if (this.alcance() === a) return;
    this.alcance.set(a);
    this.cargar();
  }

  async abrir(t: Tarea): Promise<void> {
    if (await this.dialogos.abrirTarea(t.id)) this.cargar();
  }

  async nuevaEn(d: Dia): Promise<void> {
    if (await this.dialogos.nuevaTarea({ vence: d.fecha, responsable: this.dir.yo.id })) this.cargar();
  }

  async completar(t: Tarea): Promise<void> {
    await this.api.actualizarTarea(t.id, { status: t.status === 'DONE' ? 'TODO' : 'DONE' }).catch(() => undefined);
    this.cargar();
  }

  tono(t: Tarea): string { return vencimiento(t).tono; }
}

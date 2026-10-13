import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { Adjunto, AreaSolicitud, Prioridad, Tarea } from '../../models/tareas.models';
import { PRIORIDADES, iconoArchivo, mensajeError, tamano } from '../../utils/tareas-ui';
import { TareaItemComponent } from '../../components/tarea-item/tarea-item.component';

/**
 * Solicitudes: pedirle algo a un área (Nómina, Selección, Soporte…) sin saber a quién. Cada
 * área publica su bandeja (Configuración › Automatizaciones) y la solicitud llega como tarea
 * a su espacio, repartida o asignada según la regla. Quien pide la sigue desde aquí.
 */
@Component({
  selector: 'app-solicitudes',
  standalone: true,
  imports: [FormsModule, RouterLink, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressSpinnerModule, MatProgressBarModule,
    MatSnackBarModule, TareaItemComponent],
  templateUrl: './solicitudes.component.html',
  styleUrls: ['./solicitudes.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolicitudesComponent {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly snack = inject(MatSnackBar);

  readonly areas = signal<AreaSolicitud[]>([]);
  readonly mias = signal<Tarea[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly elegida = signal<AreaSolicitud | null>(null);
  readonly enviando = signal(false);
  readonly subiendo = signal(0);
  readonly adjuntos = signal<Adjunto[]>([]);
  readonly enviada = signal<Tarea | null>(null);
  readonly verHechas = signal(false);
  readonly prioridades = PRIORIDADES.slice().reverse();

  titulo = '';
  descripcion = '';
  prioridad: Prioridad = 'MEDIUM';
  buscar = '';
  readonly filtro = signal('');

  readonly areasVisibles = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    return q ? this.areas().filter(a => `${a.nombre} ${a.area ?? ''} ${a.descripcion ?? ''}`.toLowerCase().includes(q)) : this.areas();
  });
  readonly abiertas = computed(() => this.mias().filter(t => t.status !== 'DONE'));
  readonly hechas = computed(() => this.mias().filter(t => t.status === 'DONE'));

  constructor() {
    this.dir.cargar();
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [a, m] = await Promise.all([this.api.areasSolicitud(), this.api.misSolicitudes().catch(() => [])]);
      this.areas.set(a);
      this.mias.set([...m].sort((x, y) => (y.created_at ?? '').localeCompare(x.created_at ?? '')));
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar las áreas.'));
    } finally {
      this.cargando.set(false);
    }
  }

  elegir(a: AreaSolicitud): void {
    this.elegida.set(a);
    this.enviada.set(null);
    queueMicrotask(() => document.getElementById('sol-titulo')?.focus());
  }

  async subir(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    for (const f of archivos) {
      this.subiendo.update(n => n + 1);
      try {
        const a = await this.api.subirSuelto(f);
        this.adjuntos.update(l => [...l, a]);
      } catch (e) {
        this.snack.open(mensajeError(e, `No se pudo subir ${f.name}.`), 'Cerrar', { duration: 4000 });
      } finally {
        this.subiendo.update(n => n - 1);
      }
    }
  }

  quitarAdjunto(a: Adjunto): void {
    this.adjuntos.update(l => l.filter(x => x.uuid !== a.uuid));
    this.api.eliminarAdjunto(a.uuid).catch(() => undefined);
  }

  async enviar(): Promise<void> {
    const a = this.elegida();
    if (!a || !this.titulo.trim() || this.enviando()) return;
    this.enviando.set(true);
    try {
      const r = await this.api.enviarSolicitud({
        automatizacion_id: a.id, titulo: this.titulo.trim(), descripcion: this.descripcion.trim() || null,
        prioridad: this.prioridad, adjuntos: this.adjuntos().map(x => x.uuid),
      });
      this.enviada.set(r.tareas[0] ?? null);
      this.titulo = '';
      this.descripcion = '';
      this.prioridad = 'MEDIUM';
      this.adjuntos.set([]);
      this.cargar();
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo enviar la solicitud.'), 'Cerrar', { duration: 4500 });
    } finally {
      this.enviando.set(false);
    }
  }

  otra(): void { this.enviada.set(null); }
  cancelar(): void { this.elegida.set(null); this.enviada.set(null); }

  async abrir(id: number): Promise<void> {
    if (await this.dialogos.abrirTarea(id)) this.cargar();
  }

  quienAtiende(a: AreaSolicitud): string {
    switch (a.responsable_modo) {
      case 'REPARTIR': return 'La toma quien tenga menos carga en el equipo';
      case 'PERSONA': return 'La atiende la persona encargada';
      case 'GRUPO': return 'La atiende el grupo del área';
      case 'SIN': return 'Llega a la bandeja del área';
      default: return 'Llega al área';
    }
  }

  icono = iconoArchivo;
  tamano = tamano;
}

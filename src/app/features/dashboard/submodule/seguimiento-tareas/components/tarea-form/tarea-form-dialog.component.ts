import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import { Grupo, Lista, MiembroEspacio, NuevaTareaPrefill, Prioridad, Tablero, Tarea } from '../../models/tareas.models';
import { PRIORIDADES, aIsoFinDeJornada, atajosFecha, etiquetaOrigen, mensajeError } from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../avatar/avatar.component';
import { Eleccion, PersonaPickerComponent } from '../persona-picker/persona-picker.component';

const CLAVE_ULTIMO_TABLERO = 'tareas.ultimoTablero';

function leerUltimo(): number | null {
  try { const v = Number(localStorage.getItem(CLAVE_ULTIMO_TABLERO)); return v > 0 ? v : null; } catch { return null; }
}
function guardarUltimo(id: number): void {
  try { localStorage.setItem(CLAVE_ULTIMO_TABLERO, String(id)); } catch { /* sin almacenamiento */ }
}

/**
 * Crear una tarea con todo lo necesario para que alguien la reciba bien: responsable
 * (persona o grupo), fecha, prioridad, quién más debe enterarse y los pasos.
 *
 * Lo pueden abrir otros módulos (TareasDialogosService.nuevaTarea) con un `origen`: la
 * tarea queda enlazada al registro de donde salió (p.ej. un compromiso de reunión).
 */
@Component({
  selector: 'app-tarea-form-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatDatepickerModule, MatNativeDateModule, MatTooltipModule, MatProgressSpinnerModule,
    TareaAvatarComponent, PersonaPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tarea-form-dialog.component.html',
  styleUrls: ['./tarea-form-dialog.component.css'],
})
export class TareaFormDialogComponent implements OnInit {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly ref = inject(MatDialogRef<TareaFormDialogComponent, Tarea | null>);
  readonly data = inject<NuevaTareaPrefill>(MAT_DIALOG_DATA, { optional: true }) ?? {};

  readonly tableros = signal<Tablero[]>([]);
  readonly listas = signal<Lista[]>([]);
  readonly miembros = signal<MiembroEspacio[]>([]);
  readonly grupos = signal<Grupo[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  titulo = this.data.titulo ?? '';
  descripcion = this.data.descripcion ?? '';
  tableroId: number | null = null;
  listaId: number | null = null;
  prioridad: Prioridad = this.data.prioridad ?? 'MEDIUM';
  vence: Date | null = this.data.vence ?? null;
  readonly responsable = signal<Eleccion | null>(null);
  readonly seguidores = signal<string[]>([]);
  pasos: string[] = [];
  nuevoPaso = '';

  readonly prioridades = PRIORIDADES;
  readonly atajos = atajosFecha();
  readonly origen = this.data.origen ?? null;
  readonly origenTexto = etiquetaOrigen(this.data.origen?.tipo);

  readonly porEspacio = computed(() => {
    const m = new Map<string, Tablero[]>();
    for (const t of this.tableros().filter(x => x.can_manage_content)) {
      const k = t.workspace_name || 'Sin espacio';
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()].map(([espacio, tableros]) => ({ espacio, tableros }));
  });
  readonly cercanos = computed(() => this.miembros().filter(m => m.active).map(m => m.user));

  async ngOnInit(): Promise<void> {
    this.dir.cargar();
    if (this.data.responsable) {
      this.responsable.set({ tipo: 'persona', id: this.data.responsable, nombre: this.dir.nombre(this.data.responsable) });
    } else if (this.data.grupo) {
      this.responsable.set({ tipo: 'grupo', id: this.data.grupo, nombre: 'Grupo' });
    }
    try {
      const [tableros, grupos] = await Promise.all([this.api.tableros(), this.api.grupos().catch(() => [])]);
      this.tableros.set(tableros);
      this.grupos.set(grupos);
      const g = this.data.grupo ? grupos.find(x => x.id === this.data.grupo) : null;
      if (g) this.responsable.set({ tipo: 'grupo', id: g.id, nombre: g.name });
      const editables = tableros.filter(t => t.can_manage_content);
      const elegido = editables.find(t => t.id === this.data.tableroId)
        ?? editables.find(t => t.id === leerUltimo())
        ?? editables.find(t => t.is_favorite)
        ?? editables[0];
      if (elegido) await this.elegirTablero(elegido.id, this.data.listaId ?? null);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los tableros.'));
    } finally {
      this.cargando.set(false);
    }
  }

  async elegirTablero(id: number, listaPreferida: number | null = null): Promise<void> {
    this.tableroId = id;
    const t = this.tableros().find(x => x.id === id);
    try {
      const [listas, miembros] = await Promise.all([
        this.api.listas(id),
        t ? this.api.miembros(t.workspace).catch(() => []) : Promise.resolve([]),
      ]);
      this.listas.set(listas);
      this.miembros.set(miembros);
      this.listaId = listas.find(l => l.id === listaPreferida)?.id
        ?? listas.find(l => l.list_type === 'TODO')?.id
        ?? listas[0]?.id ?? null;
    } catch {
      this.listas.set([]);
      this.listaId = null;
    }
  }

  elegirResponsable(el: Eleccion): void { this.responsable.set(el); }
  asignarme(): void { this.responsable.set({ tipo: 'persona', id: this.dir.yo.id, nombre: this.dir.yo.nombre }); }

  agregarSeguidor(el: Eleccion): void {
    if (el.tipo !== 'persona') return;
    this.seguidores.update(s => s.includes(el.id) ? s : [...s, el.id]);
  }
  quitarSeguidor(id: string): void { this.seguidores.update(s => s.filter(x => x !== id)); }

  agregarPaso(): void {
    const p = this.nuevoPaso.trim();
    if (p) this.pasos = [...this.pasos, p];
    this.nuevoPaso = '';
  }
  quitarPaso(i: number): void { this.pasos = this.pasos.filter((_, j) => j !== i); }

  puedeGuardar(): boolean {
    return !!this.titulo.trim() && !!this.listaId && !this.guardando();
  }

  async guardar(): Promise<void> {
    if (!this.puedeGuardar()) return;
    this.guardando.set(true);
    this.error.set(null);
    const r = this.responsable();
    try {
      const tarea = await this.api.crearTarea(this.listaId!, {
        title: this.titulo.trim(),
        description: this.descripcion.trim() || null,
        priority: this.prioridad,
        due_at: aIsoFinDeJornada(this.vence),
        assignee: r?.tipo === 'persona' ? r.id : null,
        assignee_name: r?.tipo === 'persona' ? r.nombre : null,
        assignee_group: r?.tipo === 'grupo' ? r.id : null,
        watchers: this.seguidores(),
        origen_tipo: this.origen?.tipo ?? null,
        origen_ref: this.origen?.ref ?? null,
        origen_url: this.origen?.url ?? null,
      });
      for (const paso of this.pasos) await this.api.agregarItem(tarea.id, paso);
      if (this.tableroId) guardarUltimo(this.tableroId);
      this.ref.close(tarea);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo crear la tarea.'));
    } finally {
      this.guardando.set(false);
    }
  }

  cancelar(): void { this.ref.close(null); }
}

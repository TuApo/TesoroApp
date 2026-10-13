import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { filter, lastValueFrom } from 'rxjs';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { Adjunto, Grupo, Lista, MiembroEspacio, NuevaTareaPrefill, Prioridad, Tablero, Tarea } from '../../models/tareas.models';
import { PRIORIDADES, aIsoFinDeJornada, atajosFecha, etiquetaOrigen, mensajeError, prioridadInfo } from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../avatar/avatar.component';
import { Eleccion, PersonaPickerComponent } from '../persona-picker/persona-picker.component';
import { ZonaArchivosComponent } from '../zona-archivos/zona-archivos.component';
import { Aplicador, AsistenteIaComponent } from '../asistente-ia/asistente-ia.component';

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
    MatProgressBarModule, MatSnackBarModule, TareaAvatarComponent, PersonaPickerComponent, ZonaArchivosComponent, AsistenteIaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tarea-form-dialog.component.html',
  styleUrls: ['./tarea-form-dialog.component.css'],
})
export class TareaFormDialogComponent implements OnInit {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly ref = inject(MatDialogRef<TareaFormDialogComponent, Tarea | null>);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly snack = inject(MatSnackBar);
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
  pasos: string[] = [...(this.data.pasos ?? [])];
  nuevoPaso = '';

  // Adjuntos: se suben al crear la tarea (con avance) y la IA también los lee.
  readonly archivos = signal<File[]>([]);
  readonly maxMb = signal(100);
  readonly subida = signal<{ n: number; total: number; pct: number; nombre: string } | null>(null);

  // IA: chat que va completando el formulario (se pliega y se amplía al lado)
  readonly iaDisponible = signal(false);
  readonly iaAbierta = signal(false);
  readonly iaAmplia = signal(false);
  /** Archivos subidos en el chat: quedan en la tarea al crearla. */
  readonly adjuntosIa = signal<Adjunto[]>([]);
  inicia: Date | null = null;
  /** Persona que la IA entendió como responsable y que se puede confirmar con un toque. */
  readonly sugeridoResponsable = signal<{ id: string; nombre: string } | null>(null);
  readonly prioridadInfo = prioridadInfo;

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

  constructor() {
    // Lado a lado: el diálogo se ensancha para trabajar el formulario junto al chat.
    effect(() => {
      const amplio = this.iaAmplia();
      this.ref.updateSize(amplio ? 'min(1280px, 98vw)' : 'min(720px, 96vw)');
    });
  }

  async ngOnInit(): Promise<void> {
    this.dir.cargar();
    this.api.iaEstado().then(e => { this.iaDisponible.set(e.disponible); this.maxMb.set(e.max_mb_adjuntos); }).catch(() => undefined);
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

  verArchivo(i: number): void {
    this.dialogos.verArchivos(this.archivos().map(f => ({ nombre: f.name, mime: f.type, tamano: f.size, archivo: f })), i);
  }

  /** Foto del formulario para la IA (lo que ya está lleno). */
  readonly estadoFormulario = () => {
    const r = this.responsable();
    const t = this.tableros().find(x => x.id === this.tableroId);
    return {
      titulo: this.titulo.trim() || null,
      descripcion: this.descripcion.trim() || null,
      pasos: this.pasos,
      prioridad: this.prioridad,
      vence: this.vence ? this.vence.toISOString().slice(0, 10) : null,
      inicia: this.inicia ? this.inicia.toISOString().slice(0, 10) : null,
      responsable: r ? (r.tipo === 'grupo' ? `Grupo ${r.nombre}` : this.dir.nombre(r.id)) : null,
      tablero: t ? `${t.workspace_name} › ${t.name}` : null,
      columna: this.listas().find(l => l.id === this.listaId)?.name ?? null,
      seguidores: this.seguidores().map(id => this.dir.nombre(id)),
      archivos: [...this.archivos().map(f => f.name), ...this.adjuntosIa().map(a => a.original_name)],
      origen: this.origen ? (this.origen.etiqueta || this.origenTexto) : null,
    };
  };

  /** Aplica lo que propone la IA, guardando lo anterior para poder deshacer. */
  readonly aplicarIa: Aplicador = r => {
    const c = r.campos ?? {};
    const antes = { titulo: this.titulo, descripcion: this.descripcion, pasos: [...this.pasos], prioridad: this.prioridad, vence: this.vence, inicia: this.inicia };
    const hecho: string[] = [];
    const hoy = new Date();
    const dia = (n: number) => new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n);
    if (c.titulo && c.titulo !== this.titulo.trim()) { this.titulo = c.titulo; hecho.push('título'); }
    if (c.descripcion && c.descripcion !== this.descripcion.trim()) { this.descripcion = c.descripcion; hecho.push('descripción'); }
    if (c.pasos?.length) {
      const nuevos = c.pasos.filter(p => !this.pasos.some(x => x.trim().toLowerCase() === p.trim().toLowerCase()));
      if (nuevos.length) { this.pasos = [...this.pasos, ...nuevos]; hecho.push(nuevos.length === 1 ? '1 paso' : `${nuevos.length} pasos`); }
    }
    if (c.prioridad && c.prioridad !== this.prioridad) { this.prioridad = c.prioridad; hecho.push(`prioridad ${prioridadInfo(c.prioridad).etiqueta.toLowerCase()}`); }
    if (c.dias !== undefined && c.dias !== null) {
      const v = dia(c.dias);
      if (!this.vence || this.vence.toDateString() !== v.toDateString()) {
        this.vence = v; hecho.push(`vence ${v.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}`);
      }
    }
    if (c.inicio_dias !== undefined && c.inicio_dias !== null && c.inicio_dias > 0) {
      const v = dia(c.inicio_dias);
      if (!this.vence || v <= this.vence) { this.inicia = v; hecho.push(`inicia ${v.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}`); }
    }
    if (c.responsable && !this.responsable()) {
      const p = this.dir.buscar(c.responsable, this.cercanos(), 1)[0];
      if (p) this.sugeridoResponsable.set({ id: p.id, nombre: p.nombre });
    }
    return {
      aplicado: hecho,
      deshacer: hecho.length ? () => {
        this.titulo = antes.titulo; this.descripcion = antes.descripcion; this.pasos = antes.pasos;
        this.prioridad = antes.prioridad; this.vence = antes.vence; this.inicia = antes.inicia;
      } : undefined,
    };
  };

  aceptarResponsable(): void {
    const p = this.sugeridoResponsable();
    if (p) this.responsable.set({ tipo: 'persona', id: p.id, nombre: p.nombre });
    this.sugeridoResponsable.set(null);
  }

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
        start_at: this.inicia ? new Date(this.inicia.getFullYear(), this.inicia.getMonth(), this.inicia.getDate(), 8, 0, 0).toISOString() : null,
        adjuntos: this.adjuntosIa().map(a => a.uuid),
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
      const fallidos = await this.subirAdjuntos(tarea.id);
      if (fallidos.length) {
        this.snack.open(`La tarea se creó, pero no se pudo subir: ${fallidos.join(', ')}. Adjúntalo desde la tarea.`, 'Cerrar', { duration: 8000 });
      }
      this.ref.close(tarea);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo crear la tarea.'));
    } finally {
      this.guardando.set(false);
    }
  }

  /** Sube los adjuntos uno a uno mostrando el avance. Devuelve los nombres que fallaron. */
  private async subirAdjuntos(tareaId: number): Promise<string[]> {
    const lista = this.archivos();
    const fallidos: string[] = [];
    for (let i = 0; i < lista.length; i++) {
      const f = lista[i];
      this.subida.set({ n: i + 1, total: lista.length, pct: 0, nombre: f.name });
      try {
        await lastValueFrom(this.api.subirConAvance({ card: tareaId }, f).pipe(
          filter(ev => { if (ev.tipo === 'progreso') this.subida.update(s => s && { ...s, pct: ev.pct }); return ev.tipo === 'listo'; })));
      } catch {
        fallidos.push(f.name);
      }
    }
    this.subida.set(null);
    return fallidos;
  }

  cancelar(): void {
    // Lo subido en el chat sin llegar a crear la tarea no debe quedar suelto.
    for (const a of this.adjuntosIa()) this.api.eliminarAdjunto(a.uuid).catch(() => undefined);
    this.ref.close(null);
  }
}

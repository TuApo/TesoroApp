import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService, sinTildes } from '../../services/directorio.service';
import { Espacio, MiembroEspacio, Plantilla, TareaDefinida } from '../../models/tareas.models';
import { COLORES_TABLERO, PRIORIDADES, mensajeError } from '../../utils/tareas-ui';
import { Eleccion, PersonaPickerComponent } from '../persona-picker/persona-picker.component';
import { TareaAvatarComponent } from '../avatar/avatar.component';

export interface NuevoTableroData { espacioId?: number | null; plantillaId?: number | null }

/** Lo que devuelve: el tablero creado, o el pedido de seguir con la IA. */
export type NuevoTableroResultado = { tableroId: number } | { conIa: true; espacioId: number | null; area: string | null } | null;

type Seleccion = { tipo: 'blanco' } | { tipo: 'plantilla'; plantilla: Plantilla };

/**
 * Galería para crear un tablero: en blanco, desde una plantilla del área (con vista previa
 * de columnas, etiquetas y tareas) o con IA. Las plantillas del sistema cubren los procesos
 * de cada área; las del equipo salen de "Guardar como plantilla" o de la IA.
 */
@Component({
  selector: 'app-nuevo-tablero-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatTooltipModule, MatDatepickerModule, MatNativeDateModule, MatProgressSpinnerModule, MatSnackBarModule,
    PersonaPickerComponent, TareaAvatarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nuevo-tablero-dialog.component.html',
  styleUrls: ['./nuevo-tablero-dialog.component.css'],
})
export class NuevoTableroDialogComponent implements OnInit {
  readonly data = inject<NuevoTableroData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<NuevoTableroDialogComponent, NuevoTableroResultado>);
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  readonly colores = COLORES_TABLERO;
  readonly esAdmin = ['ADMIN', 'GERENCIA'].includes((obtenerUsuarioActual().rol || '').toUpperCase());

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly plantillas = signal<Plantilla[]>([]);
  readonly espacios = signal<Espacio[]>([]);
  readonly miembros = signal<MiembroEspacio[]>([]);

  readonly busqueda = signal('');
  readonly area = signal<string>('todas');
  readonly seleccion = signal<Seleccion | null>(null);
  readonly guardando = signal(false);

  // Formulario
  espacioId: number | null = this.data.espacioId ?? null;
  nombre = '';
  descripcion = '';
  color = COLORES_TABLERO[0];
  inicio: Date = new Date();
  readonly responsable = signal<Eleccion | null>(null);

  readonly areas = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.plantillas()) m.set(p.area, (m.get(p.area) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([nombre, n]) => ({ nombre, n }));
  });
  readonly delEquipo = computed(() => this.plantillas().filter(p => p.origen !== 'SISTEMA').length);

  readonly visibles = computed(() => {
    const q = sinTildes(this.busqueda().trim());
    const a = this.area();
    return this.plantillas().filter(p =>
      (a === 'todas' || (a === 'equipo' ? p.origen !== 'SISTEMA' : p.area === a)) &&
      (!q || sinTildes(`${p.nombre} ${p.area} ${p.descripcion ?? ''} ${p.definicion.tareas.map(t => t.titulo).join(' ')}`).includes(q)));
  });

  readonly plantilla = computed(() => { const s = this.seleccion(); return s?.tipo === 'plantilla' ? s.plantilla : null; });
  readonly columnas = computed(() => {
    const p = this.plantilla();
    if (!p) return [];
    return p.definicion.listas.map((l, i) => ({ ...l, tareas: p.definicion.tareas.filter(t => t.lista === i) }));
  });
  readonly conFechas = computed(() => !!this.plantilla()?.definicion.tareas.some(t => t.dias !== null && t.dias !== undefined));
  readonly cercanos = computed(() => this.miembros().filter(m => m.active).map(m => m.user));
  readonly puedeBorrar = computed(() => {
    const p = this.plantilla();
    return !!p && (this.esAdmin || (p.origen !== 'SISTEMA' && p.creado_por === this.dir.yo.id));
  });

  async ngOnInit(): Promise<void> {
    this.dir.cargar();
    try {
      const [plantillas, espacios] = await Promise.all([this.api.plantillas(), this.api.espacios()]);
      this.plantillas.set(plantillas);
      this.espacios.set(espacios.filter(e => e.can_create_boards));
      if (!this.espacioId || !this.espacios().some(e => e.id === this.espacioId)) this.espacioId = this.espacios()[0]?.id ?? null;
      if (this.espacioId) this.cargarMiembros(this.espacioId);
      const pre = this.data.plantillaId ? plantillas.find(p => p.id === this.data.plantillaId) : null;
      if (pre) this.elegir(pre);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar las plantillas.'));
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarMiembros(id: number): Promise<void> {
    this.miembros.set(await this.api.miembros(id).catch(() => []));
  }

  elegir(p: Plantilla): void {
    this.nombre = p.nombre;
    this.descripcion = p.descripcion ?? '';
    this.color = p.color || COLORES_TABLERO[0];
    this.seleccion.set({ tipo: 'plantilla', plantilla: p });
  }

  enBlanco(): void {
    this.nombre = '';
    this.descripcion = '';
    this.color = COLORES_TABLERO[0];
    this.seleccion.set({ tipo: 'blanco' });
  }

  conIa(): void {
    const a = this.area();
    this.ref.close({ conIa: true, espacioId: this.espacioId, area: a === 'todas' || a === 'equipo' ? null : a });
  }

  volver(): void { this.seleccion.set(null); }

  totalTareas(p: Plantilla): number { return p.definicion.tareas.length; }
  pasos(p: Plantilla): number { return p.definicion.tareas.reduce((s, t) => s + (t.checklist?.length ?? 0), 0); }
  prioridad(t: TareaDefinida) { return PRIORIDADES.find(x => x.clave === t.prioridad) ?? PRIORIDADES[2]; }
  origen(p: Plantilla): string { return p.origen === 'SISTEMA' ? 'Tu-Apo' : p.origen === 'IA' ? 'Creada con IA' : 'Del equipo'; }
  creador(p: Plantilla): string { return p.creado_por ? this.dir.nombre(p.creado_por, '') : ''; }

  async crear(): Promise<void> {
    const s = this.seleccion();
    if (!s || !this.espacioId || !this.nombre.trim() || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    try {
      let id: number;
      if (s.tipo === 'blanco') {
        const t = await this.api.crearTablero({
          workspace: this.espacioId, name: this.nombre.trim(), description: this.descripcion.trim() || null, accent: this.color,
        });
        id = t.id;
      } else {
        const r = this.responsable();
        const res = await this.api.aplicarPlantilla({
          plantilla_id: s.plantilla.id, workspace: this.espacioId, nombre: this.nombre.trim(),
          descripcion: this.descripcion.trim() || null, accent: this.color, inicio: this.iso(this.inicio),
          responsable: r?.tipo === 'persona' ? r.id : null,
        });
        id = res.board_id;
        this.snack.open(res.tareas ? `Tablero creado con ${res.tareas} tareas` : 'Tablero creado', undefined, { duration: 2500 });
      }
      this.ref.close({ tableroId: id });
      this.router.navigate(['/dashboard/tareas/tableros', id]);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo crear el tablero.'));
    } finally {
      this.guardando.set(false);
    }
  }

  async borrar(): Promise<void> {
    const p = this.plantilla();
    if (!p || !confirm(`¿Retirar la plantilla «${p.nombre}»? Los tableros ya creados con ella no cambian.`)) return;
    try {
      await this.api.eliminarPlantilla(p.id);
      this.plantillas.update(l => l.filter(x => x.id !== p.id));
      this.seleccion.set(null);
      this.snack.open('Plantilla retirada', undefined, { duration: 2500 });
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 });
    }
  }

  cerrar(): void { this.ref.close(null); }

  private iso(d: Date | null): string | null {
    if (!d) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

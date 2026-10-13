import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService, sinTildes } from '../../services/directorio.service';
import { RecientesService } from '../../services/recientes.service';
import { Espacio, Grupo, MiembroEspacio, MiembroGrupo, RolEspacio, Tablero } from '../../models/tareas.models';
import { mensajeError } from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../../components/avatar/avatar.component';
import { Eleccion, PersonaPickerComponent } from '../../components/persona-picker/persona-picker.component';
import { AvisoDialogComponent } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';

const ROLES: { clave: RolEspacio; etiqueta: string; ayuda: string }[] = [
  { clave: 'OWNER', etiqueta: 'Dueño', ayuda: 'Todo, incluso eliminar el espacio' },
  { clave: 'MANAGER', etiqueta: 'Gestor', ayuda: 'Tareas, tableros y miembros' },
  { clave: 'MEMBER', etiqueta: 'Miembro', ayuda: 'Crear y trabajar tareas' },
  { clave: 'VIEWER', etiqueta: 'Lector', ayuda: 'Solo ver (y trabajar lo que le asignen)' },
];

/**
 * Espacios de trabajo y sus equipos. Antes eran tres pantallas (Workspaces, Grupos y el
 * panel de grupos dentro de cada tablero); ahora en una: a la izquierda los espacios, a la
 * derecha el elegido con sus tableros, miembros (con rol) y los grupos para asignar
 * tareas a varias personas a la vez.
 */
@Component({
  selector: 'app-espacios',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatTooltipModule, MatProgressSpinnerModule, MatSnackBarModule, TareaAvatarComponent, PersonaPickerComponent,
  ],
  templateUrl: './espacios.component.html',
  styleUrls: ['./espacios.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EspaciosComponent {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly recientes = inject(RecientesService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  /** :id opcional de la ruta. */
  readonly id = input<string | undefined>();

  readonly espacios = signal<Espacio[]>([]);
  readonly cargando = signal(true);
  readonly busqueda = signal('');
  readonly seleccionado = signal<Espacio | null>(null);
  readonly tableros = signal<Tablero[]>([]);
  readonly miembros = signal<MiembroEspacio[]>([]);
  readonly grupos = signal<Grupo[]>([]);
  readonly miembrosGrupo = signal<Record<number, MiembroGrupo[]>>({});
  readonly grupoAbierto = signal<number | null>(null);
  readonly cargandoDetalle = signal(false);
  readonly pestana = signal<'miembros' | 'grupos' | 'tableros'>('miembros');

  readonly roles = ROLES;
  rolNuevo: RolEspacio = 'MEMBER';
  readonly creando = signal(false);
  nombreNuevo = '';
  descNueva = '';
  /** Los espacios nuevos nacen privados (solo quien tenga ingreso los ve). */
  privadoNuevo = true;
  readonly cambiandoPrivacidad = signal(false);
  readonly creandoGrupo = signal(false);
  nombreGrupo = '';
  descGrupo = '';

  readonly filtrados = computed(() => {
    const q = sinTildes(this.busqueda().trim());
    return this.espacios().filter(e => !q || sinTildes(`${e.name} ${e.description ?? ''}`).includes(q));
  });
  readonly activos = computed(() => this.miembros().filter(m => m.active));
  readonly inactivos = computed(() => this.miembros().filter(m => !m.active));
  readonly idsMiembros = computed(() => this.miembros().map(m => m.user));
  readonly idsActivos = computed(() => this.activos().map(m => m.user));

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.cargar();
    toObservable(this.id).pipe(takeUntilDestroyed(destroyRef)).subscribe(id => {
      if (id) this.elegirPorId(Number(id));
    });
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.espacios.set(await this.api.espacios());
      const sel = this.seleccionado();
      if (sel) this.seleccionado.set(this.espacios().find(e => e.id === sel.id) ?? null);
      else if (!this.id() && this.espacios().length && typeof window !== 'undefined' && window.innerWidth > 900) this.elegir(this.espacios()[0], false);
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudieron cargar los espacios.'), 'Cerrar', { duration: 4500 });
    } finally {
      this.cargando.set(false);
    }
  }

  private async elegirPorId(id: number): Promise<void> {
    const e = this.espacios().find(x => x.id === id) ?? await this.api.espacio(id).catch(() => null);
    if (e) this.elegir(e, false);
  }

  async elegir(e: Espacio, navegar = true): Promise<void> {
    if (navegar) this.router.navigate(['/dashboard/tareas/espacios', e.id]);
    this.seleccionado.set(e);
    this.recientes.anotar({ tipo: 'espacio', id: e.id, nombre: e.name });
    this.cargandoDetalle.set(true);
    try {
      const [tableros, miembros, grupos] = await Promise.all([
        this.api.tableros(e.id), this.api.miembros(e.id), this.api.grupos().catch(() => []),
      ]);
      this.tableros.set(tableros);
      this.miembros.set(miembros);
      this.grupos.set(grupos);
    } catch (err) {
      this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 });
    } finally {
      this.cargandoDetalle.set(false);
    }
  }

  // ── Espacios ──
  async crear(): Promise<void> {
    const nombre = this.nombreNuevo.trim();
    if (!nombre) return;
    try {
      const e = await this.api.crearEspacio({ name: nombre, description: this.descNueva.trim() || null, privado: this.privadoNuevo });
      this.creando.set(false);
      this.nombreNuevo = ''; this.descNueva = ''; this.privadoNuevo = true;
      await this.cargar();
      this.elegir(e);
      this.snack.open('Espacio creado: ahora agrega a tu equipo', undefined, { duration: 3000 });
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  /** Privado ↔ público. Al volverlo privado, quien no es miembro deja de verlo (salvo sus propias tareas). */
  async cambiarPrivacidad(e: Espacio): Promise<void> {
    const privado = !e.privado;
    if (privado && !(await this.confirmar(`¿Hacer privado «${e.name}»?`,
      `Solo lo verán su dueño y sus <b>${this.activos().length} miembros</b>. Quien no sea miembro dejará de ver sus tableros; ` +
      'si tiene una tarea asignada allí, seguirá viendo solo esa tarea.', 'Hacer privado'))) return;
    this.cambiandoPrivacidad.set(true);
    try {
      const n = await this.api.actualizarEspacio(e.id, { privado });
      this.seleccionado.set({ ...e, ...n });
      this.espacios.update(l => l.map(x => x.id === e.id ? { ...x, privado: n.privado } : x));
      this.snack.open(privado ? 'Ahora es privado: solo lo ven sus miembros' : 'Ahora es público para la oficina', undefined, { duration: 3000 });
    } catch (err) {
      this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 });
    } finally {
      this.cambiandoPrivacidad.set(false);
    }
  }

  async eliminar(e: Espacio): Promise<void> {
    if (!(await this.confirmar(`¿Eliminar el espacio «${e.name}»?`,
      `Se eliminan sus <b>${e.board_count} tableros</b> con todas sus tareas, comentarios y adjuntos. No se puede deshacer.`, 'Eliminar espacio'))) return;
    try {
      await this.api.eliminarEspacio(e.id);
      this.recientes.quitar('espacio', e.id);
      this.seleccionado.set(null);
      this.router.navigate(['/dashboard/tareas/espacios']);
      await this.cargar();
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  async favorito(e: Espacio): Promise<void> {
    try {
      const r = await this.api.favorito('WORKSPACE', e.id);
      this.espacios.update(l => l.map(x => x.id === e.id ? { ...x, is_favorite: r.is_favorite } : x));
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4000 }); }
  }

  // ── Miembros ──
  async agregarMiembro(el: Eleccion): Promise<void> {
    const e = this.seleccionado();
    if (!e || el.tipo !== 'persona') return;
    const existente = this.miembros().find(m => m.user === el.id);
    try {
      if (existente) await this.api.actualizarMiembro(e.id, existente.id, { active: true, role: this.rolNuevo });
      else await this.api.agregarMiembro(e.id, el.id, this.rolNuevo);
      this.miembros.set(await this.api.miembros(e.id));
      this.snack.open(`${el.nombre} ahora es parte de «${e.name}» (le llegó un aviso)`, undefined, { duration: 3000 });
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  async cambiarRol(m: MiembroEspacio, rol: RolEspacio): Promise<void> {
    const e = this.seleccionado();
    if (!e || m.role === rol) return;
    try {
      await this.api.actualizarMiembro(e.id, m.id, { role: rol });
      this.miembros.set(await this.api.miembros(e.id));
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  async alternarActivo(m: MiembroEspacio): Promise<void> {
    const e = this.seleccionado();
    if (!e) return;
    try {
      await this.api.actualizarMiembro(e.id, m.id, { active: !m.active });
      this.miembros.set(await this.api.miembros(e.id));
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  rolDe(r: string): string { return ROLES.find(x => x.clave === r)?.etiqueta ?? r; }

  // ── Grupos ──
  async abrirGrupo(g: Grupo): Promise<void> {
    if (this.grupoAbierto() === g.id) { this.grupoAbierto.set(null); return; }
    this.grupoAbierto.set(g.id);
    if (!this.miembrosGrupo()[g.id]) await this.recargarGrupo(g.id);
  }

  private async recargarGrupo(id: number): Promise<void> {
    try {
      const m = await this.api.miembrosGrupo(id);
      this.miembrosGrupo.update(x => ({ ...x, [id]: m }));
      this.grupos.update(l => l.map(g => g.id === id ? { ...g, member_count: m.length } : g));
    } catch { this.miembrosGrupo.update(x => ({ ...x, [id]: [] })); }
  }

  async crearGrupo(): Promise<void> {
    const nombre = this.nombreGrupo.trim();
    if (!nombre) return;
    try {
      const g = await this.api.crearGrupo({ name: nombre, description: this.descGrupo.trim() || null });
      this.grupos.update(l => [...l, g]);
      this.creandoGrupo.set(false);
      this.nombreGrupo = ''; this.descGrupo = '';
      this.abrirGrupo(g);
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  async agregarAGrupo(g: Grupo, el: Eleccion): Promise<void> {
    if (el.tipo !== 'persona') return;
    try {
      await this.api.agregarAGrupo(g.id, el.id);
      await this.recargarGrupo(g.id);
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  async quitarDeGrupo(g: Grupo, m: MiembroGrupo): Promise<void> {
    try {
      await this.api.quitarDeGrupo(g.id, m.id);
      await this.recargarGrupo(g.id);
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  async eliminarGrupo(g: Grupo): Promise<void> {
    if (!(await this.confirmar(`¿Eliminar el grupo «${g.name}»?`,
      'Las tareas asignadas a este grupo quedan sin responsable.', 'Eliminar grupo'))) return;
    try {
      await this.api.eliminarGrupo(g.id);
      this.grupos.update(l => l.filter(x => x.id !== g.id));
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4500 }); }
  }

  integrantes(id: number): MiembroGrupo[] { return this.miembrosGrupo()[id] ?? []; }

  idsGrupo(id: number): string[] { return (this.miembrosGrupo()[id] ?? []).map(m => m.user); }

  private async confirmar(titulo: string, html: string, ok: string): Promise<boolean> {
    const ref = this.dialog.open(AvisoDialogComponent, {
      data: { icono: 'warning', titulo, html, textoConfirmar: ok, textoCancelar: 'Cancelar' }, autoFocus: false,
    });
    return !!(await firstValueFrom(ref.afterClosed()));
  }
}

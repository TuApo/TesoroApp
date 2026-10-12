import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { skip, firstValueFrom } from 'rxjs';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService, sinTildes } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { TareasEventosService } from '../../services/tareas-eventos.service';
import { RecientesService } from '../../services/recientes.service';
import { Estado, Etiqueta, Lista, MiembroEspacio, Tablero, Tarea, TipoLista } from '../../models/tareas.models';
import {
  COLORES_ETIQUETA, COLORES_TABLERO, ESTADOS, PRIORIDADES, TIPOS_LISTA, compararTareas, estadoInfo, grupoVencimiento,
  mensajeError, prioridadInfo, vencimiento,
} from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../../components/avatar/avatar.component';
import { TareaItemComponent } from '../../components/tarea-item/tarea-item.component';
import { AvisoDialogComponent } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';

type Vista = 'columnas' | 'lista';
const CLAVE_VISTA = 'tareas.vistaTablero';

/**
 * Un tablero: columnas con arrastrar y soltar (mover cambia el estado según la columna),
 * vista de lista para revisar en bloque, filtros por persona/prioridad/etiqueta/fecha y
 * alta rápida al pie de cada columna (escribir y Enter, sin formularios).
 */
@Component({
  selector: 'app-tablero',
  standalone: true,
  imports: [
    FormsModule, RouterLink, DragDropModule, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatSnackBarModule,
    TareaAvatarComponent, TareaItemComponent,
  ],
  templateUrl: './tablero.component.html',
  styleUrls: ['./tablero.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableroComponent implements OnInit {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly recientes = inject(RecientesService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** :id de la ruta (withComponentInputBinding). */
  readonly id = input.required<string>();

  readonly tablero = signal<Tablero | null>(null);
  readonly nArchivos = signal(0);
  readonly listas = signal<Lista[]>([]);
  readonly etiquetas = signal<Etiqueta[]>([]);
  readonly miembros = signal<MiembroEspacio[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly vista = signal<Vista>(this.leerVista());

  // Filtros
  readonly busqueda = signal('');
  readonly responsable = signal<string | null>(null); // 'yo' | 'sin' | uuid
  readonly prioridad = signal<string | null>(null);
  readonly etiqueta = signal<number | null>(null);
  readonly fecha = signal<string | null>(null); // vencidas | hoy | semana | sin-fecha
  readonly ocultarHechas = signal(false);
  /** En el celular los filtros ocupan media pantalla: van plegados tras un botón. */
  readonly filtrosAbiertos = signal(false);
  readonly cuantosFiltros = computed(() =>
    [this.responsable(), this.prioridad(), this.etiqueta(), this.fecha()].filter(v => v !== null).length + Number(this.ocultarHechas()));

  // Edición
  readonly altaRapida = signal<Record<number, string>>({});
  readonly listaEditando = signal<number | null>(null);
  nombreLista = '';
  readonly creandoLista = signal(false);
  nuevaLista = '';
  nuevaListaTipo: TipoLista = 'TODO';
  readonly editandoTablero = signal(false);
  edNombre = '';
  edDesc = '';
  edColor = COLORES_TABLERO[0];
  nuevaEtiqueta = '';
  colorEtiqueta = COLORES_ETIQUETA[5];

  readonly estados = ESTADOS;
  readonly prioridades = PRIORIDADES;
  readonly tiposLista = TIPOS_LISTA;
  readonly coloresTablero = COLORES_TABLERO;
  readonly coloresEtiqueta = COLORES_ETIQUETA;

  readonly puedeEditar = computed(() => !!this.tablero()?.can_manage_content);
  readonly totalTareas = computed(() => this.listas().reduce((n, l) => n + l.cards.length, 0));
  readonly abiertas = computed(() => this.listas().reduce((n, l) => n + l.cards.filter(c => c.status !== 'DONE').length, 0));
  readonly vencidas = computed(() => this.listas().reduce((n, l) => n + l.cards.filter(c => grupoVencimiento(c) === 'vencidas').length, 0));
  readonly miembrosActivos = computed(() => this.miembros().filter(m => m.active));
  readonly personasEnTablero = computed(() => {
    const ids = new Set<string>();
    for (const l of this.listas()) for (const c of l.cards) if (c.assignee) ids.add(c.assignee);
    for (const m of this.miembrosActivos()) ids.add(m.user);
    this.dir.personas();
    return [...ids].map(id => ({ id, nombre: this.dir.nombre(id) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  });

  readonly hayFiltros = computed(() => !!(this.busqueda() || this.responsable() || this.prioridad() || this.etiqueta() || this.fecha() || this.ocultarHechas()));

  /** Listas con las tarjetas que pasan los filtros (el orden real se conserva). */
  readonly listasVisibles = computed(() => {
    const q = sinTildes(this.busqueda().trim());
    const r = this.responsable();
    const p = this.prioridad();
    const e = this.etiqueta();
    const f = this.fecha();
    const ocultar = this.ocultarHechas();
    const yo = this.dir.yo.id;
    const pasa = (c: Tarea) =>
      (!q || sinTildes(c.title).includes(q)) &&
      (!r || (r === 'yo' ? c.assignee === yo : r === 'sin' ? !c.assignee && !c.assignee_group : c.assignee === r)) &&
      (!p || c.priority === p) &&
      (!e || (c.labels ?? []).some(l => l.label === e)) &&
      (!f || grupoVencimiento(c) === f) &&
      (!ocultar || c.status !== 'DONE');
    return this.listas().map(l => ({ ...l, cards: this.hayFiltros() ? l.cards.filter(pasa) : l.cards }));
  });

  readonly idsListas = computed(() => this.listas().map(l => `lista-${l.id}`));

  constructor() {
    toObservable(inject(TareasEventosService).version).pipe(skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recargarListas());
    // El router reutiliza este componente al saltar de un tablero a otro: se recarga por id.
    toObservable(this.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.alEntrar());
  }

  ngOnInit(): void { /* la carga la dispara el cambio de id */ }

  private async alEntrar(): Promise<void> {
    this.limpiarFiltros();
    await this.cargar();
    // ?tarea=ID (desde Mis tareas, una notificación o "Abrir en el tablero") abre su detalle.
    const tarea = Number(this.route.snapshot.queryParamMap.get('tarea'));
    if (tarea) {
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      this.abrir(tarea);
    }
  }

  async cargar(): Promise<void> {
    const id = Number(this.id());
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [t, listas, etiquetas] = await Promise.all([this.api.tablero(id), this.api.listas(id), this.api.etiquetas(id).catch(() => [])]);
      this.tablero.set(t);
      this.listas.set(this.ordenar(listas));
      this.etiquetas.set(etiquetas);
      this.recientes.anotar({ tipo: 'tablero', id: t.id, nombre: t.name, detalle: t.workspace_name, acento: t.accent });
      this.api.miembros(t.workspace).then(m => this.miembros.set(m)).catch(() => this.miembros.set([]));
      this.contarArchivos();
    } catch (e: any) {
      this.error.set(e?.status === 404 ? 'Este tablero ya no existe.' : mensajeError(e, 'No se pudo cargar el tablero.'));
    } finally {
      this.cargando.set(false);
    }
  }

  async recargarListas(): Promise<void> {
    const t = this.tablero();
    if (!t) return;
    try { this.listas.set(this.ordenar(await this.api.listas(t.id))); } catch { /* se queda lo que hay */ }
  }

  private ordenar(ls: Lista[]): Lista[] {
    return ls.map(l => ({ ...l, cards: [...(l.cards ?? [])].sort((a, b) => a.position - b.position) }))
      .sort((a, b) => a.position - b.position);
  }

  // ── Vista ──
  cambiarVista(v: Vista): void {
    this.vista.set(v);
    try { localStorage.setItem(CLAVE_VISTA, v); } catch { /* sin almacenamiento */ }
  }
  private leerVista(): Vista {
    try { return localStorage.getItem(CLAVE_VISTA) === 'lista' ? 'lista' : 'columnas'; } catch { return 'columnas'; }
  }

  limpiarFiltros(): void {
    this.busqueda.set(''); this.responsable.set(null); this.prioridad.set(null);
    this.etiqueta.set(null); this.fecha.set(null); this.ocultarHechas.set(false);
  }

  // ── Tareas ──
  async abrir(id: number): Promise<void> {
    if (await this.dialogos.abrirTarea(id)) this.recargarListas();
  }

  async nueva(lista?: Lista): Promise<void> {
    const t = this.tablero();
    if (!t) return;
    if (await this.dialogos.nuevaTarea({ tableroId: t.id, listaId: lista?.id })) this.recargarListas();
  }

  /** Nada suelto: tomar una tarea sin responsable. */
  async tomar(t: Tarea): Promise<void> {
    try {
      await this.api.actualizarTarea(t.id, { assignee: this.dir.yo.id, assignee_name: this.dir.yo.nombre });
      this.snack.open(`Ahora estás a cargo de «${t.title}»`, undefined, { duration: 3000 });
      this.recargarListas();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  /** La IA propone tareas para este tablero (desde una descripción y/o documentos). */
  async conIa(): Promise<void> {
    const t = this.tablero();
    if (!t) return;
    const r = await this.dialogos.generarConIa({ modo: 'tareas', tableroId: t.id, tableroNombre: t.name });
    if (r?.creadas) {
      this.snack.open(r.creadas === 1 ? 'Se creó 1 tarea' : `Se crearon ${r.creadas} tareas`, undefined, { duration: 3000 });
      this.recargarListas();
    }
  }

  async archivos(): Promise<void> {
    const t = this.tablero();
    if (!t) return;
    if (await this.dialogos.archivosTablero({ id: t.id, nombre: t.name, puedeEditar: t.can_manage_content })) {
      this.recargarListas();
      this.contarArchivos();
    }
  }

  async comoPlantilla(): Promise<void> {
    const t = this.tablero();
    if (!t) return;
    const p = await this.dialogos.guardarComoPlantilla({ id: t.id, nombre: t.name, descripcion: t.description });
    if (p) this.snack.open(`Plantilla «${p.nombre}» guardada. Aparece al crear un tablero nuevo.`, undefined, { duration: 4000 });
  }

  /** Cuántos archivos tiene el tablero (para el botón de la barra). */
  async contarArchivos(): Promise<void> {
    const t = this.tablero();
    if (!t) return;
    this.nArchivos.set((await this.api.archivosTablero(t.id).catch(() => [])).length);
  }

  textoAlta(listaId: number): string { return this.altaRapida()[listaId] ?? ''; }
  ponerAlta(listaId: number, v: string): void { this.altaRapida.update(m => ({ ...m, [listaId]: v })); }

  /** Alta rápida: título + Enter crea la tarea en esa columna; el resto se completa en el detalle. */
  async crearRapida(lista: Lista): Promise<void> {
    const titulo = this.textoAlta(lista.id).trim();
    if (!titulo) return;
    this.ponerAlta(lista.id, '');
    try {
      await this.api.crearTarea(lista.id, { title: titulo });
      await this.recargarListas();
    } catch (e) {
      this.ponerAlta(lista.id, titulo);
      this.snack.open(mensajeError(e, 'No se pudo crear la tarea.'), 'Cerrar', { duration: 4500 });
    }
  }

  async soltar(ev: CdkDragDrop<Tarea[]>, destino: Lista): Promise<void> {
    if (this.hayFiltros()) return;
    const tarea = ev.item.data as Tarea;
    if (ev.previousContainer === ev.container && ev.previousIndex === ev.currentIndex) return;
    // Movimiento optimista: la tarjeta queda donde se soltó mientras el servidor confirma.
    this.listas.update(ls => {
      const copia = ls.map(l => ({ ...l, cards: [...l.cards] }));
      const origen = copia.find(l => `lista-${l.id}` === ev.previousContainer.id)!;
      const dest = copia.find(l => l.id === destino.id)!;
      if (origen === dest) moveItemInArray(dest.cards, ev.previousIndex, ev.currentIndex);
      else transferArrayItem(origen.cards, dest.cards, ev.previousIndex, ev.currentIndex);
      if (destino.list_type && destino.list_type !== 'UNASSIGNED') {
        dest.cards = dest.cards.map(c => c.id === tarea.id ? { ...c, status: destino.list_type as Estado } : c);
      }
      return copia;
    });
    try {
      await this.api.moverTarea(tarea.id, destino.id, ev.currentIndex);
      if (destino.list_type === 'DONE' && tarea.status !== 'DONE') this.snack.open(`Completada: ${tarea.title}`, undefined, { duration: 2500 });
      this.recargarListas();
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo mover la tarea.'), 'Cerrar', { duration: 4500 });
      this.recargarListas();
    }
  }

  async cambiarEstado(ev: { tarea: Tarea; estado: Estado }): Promise<void> {
    try {
      await this.api.actualizarTarea(ev.tarea.id, { status: ev.estado });
      this.snack.open(`«${ev.tarea.title}» → ${estadoInfo(ev.estado).etiqueta}`, undefined, { duration: 2200 });
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
    this.recargarListas();
  }

  completar(t: Tarea): void {
    this.cambiarEstado({ tarea: t, estado: t.status === 'DONE' ? 'TODO' : 'DONE' });
  }

  // ── Columnas ──
  editarLista(l: Lista): void { this.listaEditando.set(l.id); this.nombreLista = l.name; }

  async guardarLista(l: Lista): Promise<void> {
    const nombre = this.nombreLista.trim();
    this.listaEditando.set(null);
    if (!nombre || nombre === l.name) return;
    await this.ejecutar(() => this.api.actualizarLista(l.id, { name: nombre }));
  }

  async tipoLista(l: Lista, tipo: TipoLista): Promise<void> {
    await this.ejecutar(() => this.api.actualizarLista(l.id, { list_type: tipo }), 'Las tareas que entren a esta columna tomarán ese estado');
  }

  async moverLista(l: Lista, delta: number): Promise<void> {
    const ls = [...this.listas()];
    const i = ls.findIndex(x => x.id === l.id);
    const j = i + delta;
    if (j < 0 || j >= ls.length) return;
    [ls[i], ls[j]] = [ls[j], ls[i]];
    this.listas.set(ls);
    try {
      await Promise.all(ls.map((x, pos) => x.position !== pos ? this.api.actualizarLista(x.id, { position: pos }) : Promise.resolve()));
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 });
    }
    this.recargarListas();
  }

  async eliminarLista(l: Lista): Promise<void> {
    const n = l.cards.length;
    const ok = await this.confirmar(`¿Eliminar la columna «${l.name}»?`,
      n ? `También se eliminan sus <b>${n} tareas</b> con sus comentarios y adjuntos. Si quieres conservarlas, muévelas antes a otra columna.`
        : 'La columna está vacía.', 'Eliminar');
    if (ok) await this.ejecutar(() => this.api.eliminarLista(l.id), 'Columna eliminada');
  }

  async crearLista(): Promise<void> {
    const t = this.tablero();
    const nombre = this.nuevaLista.trim();
    if (!t || !nombre) return;
    this.creandoLista.set(false);
    this.nuevaLista = '';
    await this.ejecutar(() => this.api.crearLista(t.id, { name: nombre, list_type: this.nuevaListaTipo, position: this.listas().length }));
  }

  // ── Tablero ──
  abrirEdicion(): void {
    const t = this.tablero();
    if (!t) return;
    this.edNombre = t.name;
    this.edDesc = t.description ?? '';
    this.edColor = t.accent || COLORES_TABLERO[0];
    this.editandoTablero.set(true);
  }

  async guardarTablero(): Promise<void> {
    const t = this.tablero();
    if (!t || !this.edNombre.trim()) return;
    try {
      this.tablero.set(await this.api.actualizarTablero(t.id, { name: this.edNombre.trim(), description: this.edDesc.trim() || null, accent: this.edColor }));
      this.editandoTablero.set(false);
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  async favorito(): Promise<void> {
    const t = this.tablero();
    if (!t) return;
    try {
      const r = await this.api.favorito('BOARD', t.id);
      this.tablero.set({ ...t, is_favorite: r.is_favorite });
    } catch (e) { this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 }); }
  }

  async eliminarTablero(): Promise<void> {
    const t = this.tablero();
    if (!t) return;
    const ok = await this.confirmar(`¿Eliminar el tablero «${t.name}»?`,
      `Se eliminan sus <b>${this.totalTareas()} tareas</b>, columnas, etiquetas y adjuntos. No se puede deshacer.`, 'Eliminar tablero');
    if (!ok) return;
    try {
      await this.api.eliminarTablero(t.id);
      this.recientes.quitar('tablero', t.id);
      this.router.navigate(['/dashboard/tareas/tableros']);
    } catch (e) { this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 }); }
  }

  async crearEtiqueta(): Promise<void> {
    const t = this.tablero();
    const nombre = this.nuevaEtiqueta.trim();
    if (!t || !nombre) return;
    try {
      const e = await this.api.crearEtiqueta(t.id, { name: nombre, color: this.colorEtiqueta });
      this.etiquetas.update(l => [...l, e]);
      this.nuevaEtiqueta = '';
    } catch (e) { this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 }); }
  }

  async eliminarEtiqueta(e: Etiqueta): Promise<void> {
    if (!(await this.confirmar(`¿Eliminar la etiqueta «${e.name}»?`, 'Se quita de todas las tareas del tablero.', 'Eliminar'))) return;
    try {
      await this.api.eliminarEtiqueta(e.id);
      this.etiquetas.update(l => l.filter(x => x.id !== e.id));
      if (this.etiqueta() === e.id) this.etiqueta.set(null);
      this.recargarListas();
    } catch (err) { this.snack.open(mensajeError(err), 'Cerrar', { duration: 4000 }); }
  }

  // ── Helpers de plantilla ──
  venc = vencimiento;
  prio = prioridadInfo;
  estadoDe = estadoInfo;
  tipoDe(t: TipoLista | null): string { return TIPOS_LISTA.find(x => x.clave === t)?.etiqueta ?? 'Libre'; }
  ordenadas(cards: Tarea[]): Tarea[] { return [...cards].sort(compararTareas); }

  private async ejecutar(fn: () => Promise<unknown>, ok?: string): Promise<void> {
    try {
      await fn();
      if (ok) this.snack.open(ok, undefined, { duration: 2500 });
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
    await this.recargarListas();
  }

  private async confirmar(titulo: string, html: string, ok: string): Promise<boolean> {
    const ref = this.dialog.open(AvisoDialogComponent, {
      data: { icono: 'warning', titulo, html, textoConfirmar: ok, textoCancelar: 'Cancelar' }, autoFocus: false,
    });
    return !!(await firstValueFrom(ref.afterClosed()));
  }
}

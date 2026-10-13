import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { filter, lastValueFrom } from 'rxjs';
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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import {
  Adjunto, DefinicionTablero, Espacio, IaTrabajo, MiembroEspacio, Prioridad, PropuestaTablero, PropuestaTareas, TareaDefinida,
} from '../../models/tareas.models';
import { AREAS_TAREAS, PRIORIDADES, TIPOS_LISTA, mensajeError } from '../../utils/tareas-ui';
import { ZonaArchivosComponent } from '../zona-archivos/zona-archivos.component';
import { Eleccion, PersonaPickerComponent } from '../persona-picker/persona-picker.component';
import { TareaAvatarComponent } from '../avatar/avatar.component';
import { Aplicador, AsistenteIaComponent } from '../asistente-ia/asistente-ia.component';

export type ModoIa = 'tablero' | 'tareas' | 'plantilla';

export interface IaGenerarData {
  modo: ModoIa;
  tableroId?: number;
  tableroNombre?: string;
  espacioId?: number | null;
  area?: string | null;
  /** Archivos ya subidos (p.ej. los del tablero) que la IA debe leer. */
  guardados?: { uuid: string; nombre: string; mime: string | null; tamano: number }[];
}


const EJEMPLOS: Record<ModoIa, string[]> = {
  tablero: [
    'Ingreso de 25 operarios de cultivo para un cliente floricultor el 20 de octubre',
    'Cierre de nómina de la segunda quincena con novedades de 3 clientes',
    'Auditoría de expedientes de contratación de la sede Madrid',
  ],
  tareas: [
    'Convierte el acta adjunta en tareas con responsables y fechas',
    'Tareas para preparar la visita del Ministerio de Trabajo',
    'Pasos para radicar las incapacidades pendientes del mes',
  ],
  plantilla: [
    'Plantilla para atender un requerimiento de una entidad (UGPP, Ministerio, EPS)',
    'Plantilla para la apertura de una nueva sede',
    'Plantilla de onboarding de personal administrativo',
  ],
};

const FASES = ['Leyendo los documentos', 'Entendiendo el pedido', 'Diseñando columnas y etiquetas', 'Redactando tareas y pasos', 'Revisando fechas y prioridades'];

/**
 * "Crear con IA": de una descripción y documentos (actas, correos, Excel, PDF...) a un
 * tablero, a tareas para un tablero existente o a una plantilla. Tres pasos: pedir →
 * generar (en segundo plano, con avance) → revisar y editar la propuesta. Nada se crea hasta
 * que la persona confirma.
 */
@Component({
  selector: 'app-ia-generar-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatTooltipModule, MatDatepickerModule, MatNativeDateModule, MatProgressBarModule,
    ZonaArchivosComponent, PersonaPickerComponent, TareaAvatarComponent, AsistenteIaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ia-generar-dialog.component.html',
  styleUrls: ['./ia-generar-dialog.component.css'],
})
export class IaGenerarDialogComponent implements OnInit, OnDestroy {
  readonly data = inject<IaGenerarData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<IaGenerarDialogComponent, unknown>);
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly router = inject(Router);

  readonly areas = AREAS_TAREAS;
  readonly ejemplos = EJEMPLOS[this.data.modo];
  readonly prioridades = PRIORIDADES;
  readonly tiposLista = TIPOS_LISTA;

  readonly paso = signal<'pedido' | 'generando' | 'propuesta'>('pedido');
  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly segundos = signal(0);
  readonly fase = computed(() => FASES[Math.min(FASES.length - 1, Math.floor(this.segundos() / 4))]);

  // Pedido
  descripcion = '';
  area = this.data.area ?? (this.data.modo === 'plantilla' ? 'General' : '');
  readonly archivos = signal<File[]>([]);
  readonly guardados = signal(this.data.guardados ?? []);
  readonly maxMb = signal(100);

  // Destino
  readonly espacios = signal<Espacio[]>([]);
  espacioId: number | null = this.data.espacioId ?? null;
  inicio: Date = new Date();
  readonly responsable = signal<Eleccion | null>(null);
  readonly miembros = signal<MiembroEspacio[]>([]);

  // Propuesta (editable)
  nombre = '';
  descripcionTablero = '';
  color = '#2B59F0';
  readonly definicion = signal<DefinicionTablero | null>(null);
  readonly columnas = signal<{ id: number; nombre: string }[]>([]);
  readonly incluidas = signal<Set<number>>(new Set());
  readonly abierta = signal<number | null>(null);
  /** Etiquetas reales del tablero (modo tareas): los índices de la propuesta apuntan aquí. */
  etiquetasTablero: { id: number; nombre: string; color: string }[] = [];

  // Chat con la IA para armar y ajustar el tablero conversando (con archivos que quedan en él).
  readonly conChat = this.data.modo !== 'tareas';
  readonly chatAbierto = signal(false);
  readonly chatAmplio = signal(false);
  readonly adjuntosChat = signal<Adjunto[]>([]);
  readonly subiendoArchivos = signal<string | null>(null);

  private sondeo: ReturnType<typeof setInterval> | null = null;
  private reloj: ReturnType<typeof setInterval> | null = null;

  readonly titulo = computed(() => ({
    tablero: 'Crear tablero con IA', tareas: 'Agregar tareas con IA', plantilla: 'Crear plantilla con IA',
  }[this.data.modo]));
  readonly tareas = computed(() => this.definicion()?.tareas ?? []);
  readonly totalIncluidas = computed(() => this.incluidas().size);
  readonly cercanos = computed(() => this.miembros().filter(m => m.active).map(m => m.user));

  constructor() {
    effect(() => this.ref.updateSize(this.chatAmplio() ? 'min(1360px, 98vw)' : 'min(920px, 96vw)'));
  }

  /** Lo que la IA debe saber del tablero en curso: el pedido y la propuesta tal como va (editada). */
  readonly estadoTablero = () => {
    const d = this.definicion();
    return {
      pedido: this.descripcion.trim() || null,
      area: this.area || null,
      nombre: this.nombre || null,
      descripcion: this.descripcionTablero || null,
      ...(d ? { listas: d.listas, etiquetas: d.etiquetas, tareas: d.tareas.filter((_, i) => this.incluidas().has(i)) } : {}),
      archivos: [...this.archivos().map(f => f.name), ...this.guardados().map(g => g.nombre), ...this.adjuntosChat().map(a => a.original_name)],
    };
  };

  /** En pantallas anchas el chat se abre al lado de la propuesta. */
  abrirChat(): void {
    this.chatAbierto.set(true);
    this.chatAmplio.set(window.innerWidth >= 1100);
  }

  /** La propuesta del chat reemplaza la actual (con deshacer). */
  readonly aplicarChat: Aplicador = r => {
    const p = r.propuesta;
    if (!p) return { aplicado: [] };
    const antes = { paso: this.paso(), nombre: this.nombre, desc: this.descripcionTablero, color: this.color, area: this.area,
      definicion: this.definicion(), incluidas: this.incluidas() };
    const previa = this.definicion();
    this.nombre = p.nombre || this.nombre;
    this.descripcionTablero = p.descripcion ?? this.descripcionTablero;
    this.color = p.color || this.color;
    if (p.area) this.area = this.areaDelCatalogo(p.area);
    this.definicion.set(p.definicion);
    this.incluidas.set(new Set(p.definicion.tareas.map((_, i) => i)));
    this.paso.set('propuesta');
    const hecho: string[] = [];
    if (!previa) hecho.push('propuesta nueva');
    hecho.push(`${p.definicion.listas.length} columnas`, `${p.definicion.tareas.length} tareas`);
    if (p.definicion.etiquetas.length) hecho.push(`${p.definicion.etiquetas.length} etiquetas`);
    return {
      aplicado: hecho,
      deshacer: () => {
        this.paso.set(antes.paso); this.nombre = antes.nombre; this.descripcionTablero = antes.desc; this.color = antes.color;
        this.area = antes.area; this.definicion.set(antes.definicion); this.incluidas.set(antes.incluidas);
      },
    };
  };

  async ngOnInit(): Promise<void> {
    this.dir.cargar();
    this.api.iaEstado().then(e => this.maxMb.set(e.max_mb_adjuntos)).catch(() => undefined);
    if (this.data.modo === 'tablero') {
      const es = await this.api.espacios().catch(() => []);
      this.espacios.set(es.filter(e => e.can_create_boards));
      if (!this.espacioId) this.espacioId = this.espacios()[0]?.id ?? null;
      if (this.espacioId) this.cargarMiembros(this.espacioId);
    }
  }

  ngOnDestroy(): void { this.parar(); }

  async cargarMiembros(espacioId: number): Promise<void> {
    this.miembros.set(await this.api.miembros(espacioId).catch(() => []));
  }

  usarEjemplo(e: string): void { this.descripcion = e; }

  verArchivo(i: number): void {
    this.dialogos.verArchivos(this.archivos().map(f => ({ nombre: f.name, mime: f.type, tamano: f.size, archivo: f })), i);
  }

  verGuardado(i: number): void {
    this.dialogos.verArchivos(this.guardados().map(g => ({ nombre: g.nombre, mime: g.mime, tamano: g.tamano, uuid: g.uuid })), i);
  }
  quitarGuardado(uuid: string): void { this.guardados.update(l => l.filter(g => g.uuid !== uuid)); }

  puedeGenerar(): boolean {
    return (!!this.descripcion.trim() || this.archivos().length > 0 || this.guardados().length > 0)
      && (this.data.modo !== 'tablero' || !!this.espacioId);
  }

  // ── Generar ──
  async generar(): Promise<void> {
    if (!this.puedeGenerar()) return;
    this.error.set(null);
    this.paso.set('generando');
    this.segundos.set(0);
    this.reloj = setInterval(() => this.segundos.update(s => s + 1), 1000);
    try {
      const t = await this.api.iaGenerar(this.data.modo, {
        descripcion: this.descripcion.trim() || undefined,
        area: this.area || undefined,
        board_id: this.data.tableroId,
        archivos: this.archivos(),
        adjuntos: this.guardados().map(g => g.uuid),
      });
      this.sondeo = setInterval(() => this.consultar(t.id), 2500);
    } catch (e) {
      this.fallo(mensajeError(e, 'No se pudo iniciar la generación.'));
    }
  }

  private async consultar(id: number): Promise<void> {
    try {
      const t = await this.api.iaTrabajo<PropuestaTablero | PropuestaTareas>(id);
      if (t.estado === 'LISTO') { this.parar(); this.recibir(t); }
      else if (t.estado === 'ERROR' || t.estado === 'CANCELADO') this.fallo(t.error || 'La IA no pudo generar la propuesta.');
      else if (this.segundos() > 240) this.fallo('La IA está tardando demasiado. Intenta con menos documentos o un pedido más concreto.');
    } catch (e) {
      this.fallo(mensajeError(e));
    }
  }

  private recibir(t: IaTrabajo<PropuestaTablero | PropuestaTareas>): void {
    const r = t.resultado;
    if (this.data.modo === 'tareas') {
      const p = r as PropuestaTareas;
      this.columnas.set(p.columnas);
      this.definicion.set({ listas: p.columnas.map(c => ({ nombre: c.nombre, tipo: 'TODO' })), etiquetas: p.etiquetas.map(e => ({ nombre: e.nombre, color: e.color })), tareas: p.tareas });
      this.etiquetasTablero = p.etiquetas;
    } else {
      const p = r as PropuestaTablero;
      this.nombre = p.nombre;
      this.descripcionTablero = p.descripcion ?? '';
      this.color = p.color || '#2B59F0';
      if (!this.area || this.area === 'General') this.area = this.areaDelCatalogo(p.area);
      this.definicion.set(p.definicion);
    }
    this.incluidas.set(new Set(this.tareas().map((_, i) => i)));
    this.paso.set('propuesta');
  }

  /** La IA puede devolver "Contratación y afiliaciones": se toma la del catálogo que aparezca, o General. */
  private areaDelCatalogo(a: string | null | undefined): string {
    const n = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const v = n(a ?? '');
    return AREAS_TAREAS.find(x => n(x) === v) ?? AREAS_TAREAS.find(x => x !== 'General' && v.includes(n(x))) ?? 'General';
  }

  private fallo(msg: string): void {
    this.parar();
    this.error.set(msg);
    this.paso.set('pedido');
  }

  private parar(): void {
    if (this.sondeo) clearInterval(this.sondeo);
    if (this.reloj) clearInterval(this.reloj);
    this.sondeo = this.reloj = null;
  }

  cancelarGeneracion(): void {
    this.parar();
    this.paso.set('pedido');
  }

  // ── Editar la propuesta ──
  alternar(i: number): void {
    this.incluidas.update(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }
  todas(on: boolean): void { this.incluidas.set(on ? new Set(this.tareas().map((_, i) => i)) : new Set()); }

  editarTarea(i: number, cambios: Partial<TareaDefinida>): void {
    this.definicion.update(d => d ? { ...d, tareas: d.tareas.map((t, j) => j === i ? { ...t, ...cambios } : t) } : d);
  }
  quitarPaso(i: number, p: number): void {
    this.editarTarea(i, { checklist: this.tareas()[i].checklist.filter((_, k) => k !== p) });
  }
  renombrarLista(i: number, nombre: string): void {
    this.definicion.update(d => d ? { ...d, listas: d.listas.map((l, j) => j === i ? { ...l, nombre } : l) } : d);
  }
  tareasDeLista(i: number): { t: TareaDefinida; i: number }[] {
    return this.tareas().map((t, j) => ({ t, i: j })).filter(x => x.t.lista === i);
  }
  prioridadDe(p: Prioridad) { return PRIORIDADES.find(x => x.clave === p) ?? PRIORIDADES[2]; }
  tipoDe(t: string) { return TIPOS_LISTA.find(x => x.clave === t)?.etiqueta ?? t; }

  volverAPedir(): void {
    this.paso.set('pedido');
  }

  // ── Confirmar ──
  async confirmar(): Promise<void> {
    const d = this.definicion();
    if (!d || this.guardando()) return;
    const sel = this.tareas().filter((_, i) => this.incluidas().has(i));
    this.guardando.set(true);
    this.error.set(null);
    const r = this.responsable();
    try {
      if (this.data.modo === 'tareas') {
        const cols = this.columnas();
        const res = await this.api.tareasEnLote(this.data.tableroId!, {
          tareas: sel.map(t => ({ ...t, lista_id: cols[t.lista]?.id ?? cols[0].id,
            etiqueta_ids: t.etiquetas.map(e => this.etiquetasTablero[e]?.id).filter((x): x is number => !!x) })),
          inicio: this.iso(this.inicio),
          responsable: r?.tipo === 'persona' ? r.id : null,
        });
        this.ref.close({ creadas: res.creadas });
      } else if (this.data.modo === 'plantilla') {
        const p = await this.api.crearPlantilla({
          nombre: this.nombre.trim() || 'Plantilla', area: this.area || 'General', descripcion: this.descripcionTablero || null,
          color: this.color, definicion: { ...d, tareas: sel }, origen: 'IA',
        });
        this.ref.close({ plantilla: p });
      } else {
        const res = await this.api.aplicarPlantilla({
          definicion: { ...d, tareas: sel }, workspace: this.espacioId!, nombre: this.nombre.trim() || 'Tablero',
          descripcion: this.descripcionTablero || null, accent: this.color, inicio: this.iso(this.inicio),
          responsable: r?.tipo === 'persona' ? r.id : null, adjuntos: this.adjuntosChat().map(a => a.uuid),
        });
        // Los documentos con que se armó quedan como archivos del tablero.
        await this.subirAlTablero(res.board_id);
        this.ref.close({ tableroId: res.board_id });
        this.router.navigate(['/dashboard/tareas/tableros', res.board_id]);
      }
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo crear.'));
    } finally {
      this.guardando.set(false);
    }
  }

  cerrar(): void {
    for (const a of this.adjuntosChat()) this.api.eliminarAdjunto(a.uuid).catch(() => undefined);
    this.ref.close(null);
  }

  private async subirAlTablero(tableroId: number): Promise<void> {
    for (const f of this.archivos()) {
      this.subiendoArchivos.set(f.name);
      try {
        await lastValueFrom(this.api.subirConAvance({ board: tableroId }, f).pipe(filter(ev => ev.tipo === 'listo')));
      } catch { /* el tablero ya existe; el archivo se puede subir luego desde Archivos */ }
    }
    this.subiendoArchivos.set(null);
  }

  private iso(d: Date | null): string | null {
    if (!d) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

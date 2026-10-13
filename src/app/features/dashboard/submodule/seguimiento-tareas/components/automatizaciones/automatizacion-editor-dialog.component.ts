import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import {
  Automatizacion, CondicionAuto, Espacio, EventoCatalogo, Grupo, Lista, ModoResponsable, OperadorCondicion, Prioridad, Tablero,
} from '../../models/tareas.models';
import { AREAS_TAREAS, PRIORIDADES, mensajeError } from '../../utils/tareas-ui';
import { Eleccion, PersonaPickerComponent } from '../persona-picker/persona-picker.component';
import { TareaAvatarComponent } from '../avatar/avatar.component';

export interface EditorAutoData { regla?: Automatizacion | null; tipo?: 'solicitud' | 'evento'; eventos: EventoCatalogo[] }

const SOLICITUD = 'tareas.solicitud';

export const MODOS_RESPONSABLE: { clave: ModoResponsable; etiqueta: string; ayuda: string; icono: string }[] = [
  { clave: 'REPARTIR', etiqueta: 'Repartir en el equipo', ayuda: 'Al miembro del espacio con menos tareas abiertas.', icono: 'diversity_3' },
  { clave: 'PERSONA', etiqueta: 'Una persona', ayuda: 'Siempre la misma persona.', icono: 'person' },
  { clave: 'GRUPO', etiqueta: 'Un grupo', ayuda: 'Al grupo; cualquiera de sus integrantes la toma.', icono: 'groups' },
  { clave: 'DESTINATARIO', etiqueta: 'A quien le llega el evento', ayuda: 'La persona a la que el módulo le avisa (p.ej. a quien le asignaron algo).', icono: 'person_pin' },
  { clave: 'ACTOR', etiqueta: 'A quien lo provocó', ayuda: 'Quien hizo la acción en el otro módulo.', icono: 'touch_app' },
  { clave: 'SIN', etiqueta: 'Sin responsable', ayuda: 'Queda en el área; se avisa a quienes la gestionan para que alguien la tome.', icono: 'inbox' },
];

export const OPERADORES: { clave: OperadorCondicion; etiqueta: string }[] = [
  { clave: 'igual', etiqueta: 'es igual a' }, { clave: 'distinto', etiqueta: 'es distinto de' },
  { clave: 'contiene', etiqueta: 'contiene' }, { clave: 'no_contiene', etiqueta: 'no contiene' },
  { clave: 'empieza', etiqueta: 'empieza por' }, { clave: 'existe', etiqueta: 'tiene valor' }, { clave: 'no_existe', etiqueta: 'está vacío' },
];

/**
 * Editor de una regla de Automatizaciones: qué la dispara (una solicitud al área o un evento
 * de otro módulo), dónde cae la tarea, quién la atiende, con qué título y bajo qué condiciones.
 */
@Component({
  selector: 'app-automatizacion-editor-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatSlideToggleModule, MatTooltipModule, MatProgressBarModule, PersonaPickerComponent, TareaAvatarComponent,
  ],
  templateUrl: './automatizacion-editor-dialog.component.html',
  styleUrls: ['./automatizacion-editor-dialog.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutomatizacionEditorDialogComponent {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly ref = inject(MatDialogRef<AutomatizacionEditorDialogComponent, Automatizacion | null>);
  readonly data = inject<EditorAutoData>(MAT_DIALOG_DATA);

  readonly areas = AREAS_TAREAS;
  readonly modos = MODOS_RESPONSABLE;
  readonly operadores = OPERADORES;
  readonly prioridades = PRIORIDADES;

  readonly tipo = signal<'solicitud' | 'evento'>(
    this.data.regla ? (this.data.regla.evento_clave === SOLICITUD ? 'solicitud' : 'evento') : (this.data.tipo ?? 'solicitud'));
  readonly espacios = signal<Espacio[]>([]);
  readonly tableros = signal<Tablero[]>([]);
  readonly listas = signal<Lista[]>([]);
  readonly grupos = signal<Grupo[]>([]);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly eligiendoPersona = signal(false);

  // Formulario (ngModel)
  nombre = this.data.regla?.nombre ?? '';
  descripcion = this.data.regla?.descripcion ?? '';
  area: string | null = this.data.regla?.area ?? null;
  evento = this.data.regla && this.data.regla.evento_clave !== SOLICITUD ? this.data.regla.evento_clave : '';
  eventoLibre = '';
  readonly espacioId = signal<number | null>(this.data.regla?.workspace_id ?? null);
  readonly tableroId = signal<number | null>(this.data.regla?.board_id ?? null);
  listaId: number | null = this.data.regla?.list_id ?? null;
  readonly modo = signal<ModoResponsable>(this.data.regla?.responsable_modo ?? (this.tipo() === 'solicitud' ? 'REPARTIR' : 'DESTINATARIO'));
  readonly persona = signal<{ id: string; nombre: string } | null>(
    this.data.regla?.responsable_id ? { id: this.data.regla.responsable_id, nombre: '' } : null);
  grupoId: number | null = this.data.regla?.grupo_id ?? null;
  porDestinatario = this.data.regla?.por_destinatario ?? true;
  prioridad: Prioridad | null = (this.data.regla?.prioridad as Prioridad) ?? null;
  dias: number | null = this.data.regla?.dias_vencimiento ?? (this.data.regla ? null : 3);
  plantillaTitulo = this.data.regla?.plantilla_titulo ?? '{{titulo}}';
  plantillaDescripcion = this.data.regla?.plantilla_descripcion ?? '';
  seguirActor = this.data.regla?.seguir_actor ?? true;
  evitarDuplicados = this.data.regla?.evitar_duplicados ?? true;
  readonly condiciones = signal<CondicionAuto[]>(this.data.regla?.condiciones?.map(c => ({ ...c })) ?? []);

  /** Eventos de módulos (sin la solicitud), agrupados por módulo. */
  readonly modulos = computed(() => {
    const m = new Map<string, EventoCatalogo[]>();
    for (const e of this.data.eventos.filter(x => x.clave !== SOLICITUD)) {
      const k = e.modulo || 'Otros';
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  });

  readonly eventoElegido = signal<string>(this.evento);
  readonly infoEvento = computed(() => this.data.eventos.find(e => e.clave === (this.tipo() === 'solicitud' ? SOLICITUD : this.eventoElegido())) ?? null);
  /** Variables para plantillas y condiciones: los campos del evento + las comunes. */
  readonly variables = computed(() => {
    const base = this.infoEvento()?.campos ?? ['titulo', 'mensaje', 'link'];
    return [...new Set([...base, 'evento', 'fecha', 'regla', 'area'])].filter(v => v !== 'adjuntos');
  });

  readonly espacioActual = computed(() => this.espacios().find(e => e.id === this.espacioId()) ?? null);

  constructor() {
    this.dir.cargar();
    this.cargarBase();
  }

  private async cargarBase(): Promise<void> {
    try {
      const [es, gs] = await Promise.all([this.api.espacios(), this.api.grupos().catch(() => [])]);
      this.espacios.set(es.filter(e => e.can_manage_members));
      this.grupos.set(gs);
      if (this.espacioId()) await this.cargarTableros(false);
      if (this.persona()) {
        const p = this.persona()!;
        this.persona.set({ id: p.id, nombre: this.dir.nombre(p.id) });
      }
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los espacios.'));
    }
  }

  async elegirEspacio(id: number): Promise<void> {
    this.espacioId.set(id);
    this.tableroId.set(null);
    this.listaId = null;
    await this.cargarTableros(true);
  }

  private async cargarTableros(elegirPrimero: boolean): Promise<void> {
    const id = this.espacioId();
    if (!id) return;
    const ts = await this.api.tableros(id).catch(() => [] as Tablero[]);
    this.tableros.set(ts);
    if (elegirPrimero && ts.length) this.tableroId.set(ts[0].id);
    if (this.tableroId()) await this.cargarListas();
  }

  async elegirTablero(id: number): Promise<void> {
    this.tableroId.set(id);
    this.listaId = null;
    await this.cargarListas();
  }

  private async cargarListas(): Promise<void> {
    const id = this.tableroId();
    this.listas.set(id ? await this.api.listas(id).catch(() => []) : []);
  }

  elegirEvento(clave: string): void {
    this.evento = clave;
    this.eventoElegido.set(clave);
    const e = this.data.eventos.find(x => x.clave === clave);
    if (e && !this.nombre.trim()) this.nombre = e.nombre;
  }

  usarEventoLibre(): void {
    const v = this.eventoLibre.trim();
    if (v) this.elegirEvento(v);
  }

  elegirPersona(el: Eleccion): void {
    this.eligiendoPersona.set(false);
    if (el.tipo === 'persona') this.persona.set({ id: el.id, nombre: el.nombre });
    else { this.modo.set('GRUPO'); this.grupoId = el.id; }
  }

  insertar(campo: 'titulo' | 'descripcion', v: string): void {
    const token = `{{${v}}}`;
    if (campo === 'titulo') this.plantillaTitulo = `${this.plantillaTitulo.trim()} ${token}`.trim();
    else this.plantillaDescripcion = `${this.plantillaDescripcion}${this.plantillaDescripcion && !this.plantillaDescripcion.endsWith('\n') ? ' ' : ''}${token}`;
  }

  token(v: string): string { return '{{' + v + '}}'; }

  agregarCondicion(): void { this.condiciones.update(c => [...c, { campo: this.variables()[0] ?? 'titulo', op: 'contiene', valor: '' }]); }
  quitarCondicion(i: number): void { this.condiciones.update(c => c.filter((_, j) => j !== i)); }
  cambiarCondicion(i: number, cambio: Partial<CondicionAuto>): void {
    this.condiciones.update(c => c.map((x, j) => j === i ? { ...x, ...cambio } : x));
  }
  sinValor(op: OperadorCondicion): boolean { return op === 'existe' || op === 'no_existe'; }

  /** Vista previa del título con datos de ejemplo. */
  readonly ejemplo = computed(() => this.infoEvento()?.nombre ?? 'Evento');
  previa(plantilla: string): string {
    const datos: Record<string, string> = {
      titulo: this.tipo() === 'solicitud' ? 'Certificado laboral con salario' : `Ejemplo de ${this.ejemplo()}`,
      mensaje: 'Detalle que trae el evento', evento: this.ejemplo(), regla: this.nombre || 'Esta regla', area: this.area ?? '',
      fecha: new Date().toLocaleDateString('es-CO'), solicitante: 'Quien la envía', prioridad: 'Alta', modulo: 'Nómina', link: 'enlace al caso',
    };
    return (plantilla || '').replace(/\{\{\s*([\w.]+)\s*}}/g, (_, k) => datos[k] ?? `‹${k}›`).trim() || '—';
  }


  async guardar(): Promise<void> {
    this.error.set(null);
    const evento = this.tipo() === 'solicitud' ? SOLICITUD : this.evento.trim();
    if (!this.nombre.trim()) { this.error.set('Ponle un nombre a la regla.'); return; }
    if (!evento) { this.error.set('Elige el evento que dispara la regla.'); return; }
    if (!this.tableroId()) { this.error.set('Elige el espacio y el tablero donde caen las tareas.'); return; }
    if (this.modo() === 'PERSONA' && !this.persona()) { this.error.set('Elige la persona responsable.'); return; }
    if (this.modo() === 'GRUPO' && !this.grupoId) { this.error.set('Elige el grupo responsable.'); return; }
    const cuerpo: Record<string, unknown> = {
      nombre: this.nombre.trim(), descripcion: this.descripcion.trim() || null, area: this.area,
      evento_clave: evento, board_id: this.tableroId(), list_id: this.listaId,
      responsable_modo: this.modo(), responsable_id: this.persona()?.id ?? null, grupo_id: this.grupoId,
      por_destinatario: this.porDestinatario, prioridad: this.prioridad, dias_vencimiento: this.dias ?? null,
      plantilla_titulo: this.plantillaTitulo.trim() || '{{titulo}}', plantilla_descripcion: this.plantillaDescripcion.trim() || null,
      seguir_actor: this.seguirActor, evitar_duplicados: this.evitarDuplicados,
      condiciones: this.condiciones().filter(c => c.campo.trim()),
    };
    this.guardando.set(true);
    try {
      const r = this.data.regla
        ? await this.api.actualizarAutomatizacion(this.data.regla.id, cuerpo as Partial<Automatizacion>)
        : await this.api.crearAutomatizacion(cuerpo as Partial<Automatizacion>);
      this.ref.close(r);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo guardar la regla.'));
    } finally {
      this.guardando.set(false);
    }
  }

  cerrar(): void { this.ref.close(null); }
}

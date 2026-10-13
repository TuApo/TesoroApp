import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import { AvisoDialogComponent } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';
import { TareasApiService } from '../../services/tareas-api.service';
import { DirectorioService } from '../../services/directorio.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { Automatizacion, EjecucionAuto, EventoCatalogo, PlanAuto } from '../../models/tareas.models';
import { estadoInfo, hace, mensajeError, prioridadInfo } from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../avatar/avatar.component';
import { AutomatizacionEditorDialogComponent, EditorAutoData, MODOS_RESPONSABLE, OPERADORES } from './automatizacion-editor-dialog.component';

/**
 * Configuración › Automatizaciones: reglas que convierten hechos de la plataforma y solicitudes
 * en tareas del área que corresponde, con su bitácora (qué llegó, qué se creó, qué se omitió)
 * y una prueba con datos de ejemplo antes de dejarlas andar.
 */
@Component({
  selector: 'app-automatizaciones',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatIconModule, MatButtonModule, MatMenuModule, MatSlideToggleModule, MatTooltipModule,
    MatProgressSpinnerModule, MatSnackBarModule, TareaAvatarComponent,
  ],
  templateUrl: './automatizaciones.component.html',
  styleUrls: ['./automatizaciones.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutomatizacionesComponent {
  private readonly api = inject(TareasApiService);
  readonly dir = inject(DirectorioService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogos = inject(TareasDialogosService);
  private readonly snack = inject(MatSnackBar);

  readonly esAdmin = ['ADMIN', 'GERENCIA'].includes((obtenerUsuarioActual().rol || '').toUpperCase());
  readonly reglas = signal<Automatizacion[]>([]);
  readonly eventos = signal<EventoCatalogo[]>([]);
  readonly bitacora = signal<EjecucionAuto[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly vista = signal<'reglas' | 'bitacora' | 'eventos'>('reglas');
  readonly filtroBitacora = signal<number | null>(null);

  // Prueba
  readonly probando = signal<number | null>(null);
  readonly planes = signal<{ cumple: boolean; planes: PlanAuto[] } | null>(null);
  pruebaTitulo = '';
  pruebaMensaje = '';
  readonly pruebaDestinatarios = signal<string[]>([]);
  readonly ejecutandoPrueba = signal(false);

  readonly solicitudes = computed(() => this.reglas().filter(r => r.evento_clave === 'tareas.solicitud'));
  readonly deEventos = computed(() => this.reglas().filter(r => r.evento_clave !== 'tareas.solicitud'));
  readonly reglaFiltrada = computed(() => this.reglas().find(r => r.id === this.filtroBitacora()) ?? null);
  readonly bitacoraVisible = computed(() => {
    const f = this.filtroBitacora();
    return f ? this.bitacora().filter(b => b.automatizacion_id === f) : this.bitacora();
  });
  readonly eventosOrdenados = computed(() => [...this.eventos()].sort((a, b) => (b.veces - a.veces) || a.nombre.localeCompare(b.nombre, 'es')));

  constructor() {
    this.dir.cargar();
    this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [r, e, b] = await Promise.all([this.api.automatizaciones(), this.api.catalogoEventos(), this.api.ejecuciones(null, 120).catch(() => [])]);
      this.reglas.set(r);
      this.eventos.set(e);
      this.bitacora.set(b);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar las automatizaciones.'));
    } finally {
      this.cargando.set(false);
    }
  }

  evento(clave: string): EventoCatalogo | null { return this.eventos().find(e => e.clave === clave) ?? null; }

  async nueva(tipo: 'solicitud' | 'evento'): Promise<void> {
    await this.editar(null, tipo);
  }

  async editar(regla: Automatizacion | null, tipo?: 'solicitud' | 'evento'): Promise<void> {
    const ref = this.dialog.open<AutomatizacionEditorDialogComponent, EditorAutoData, Automatizacion | null>(AutomatizacionEditorDialogComponent, {
      data: { regla, tipo, eventos: this.eventos() }, width: 'min(860px, 98vw)', maxWidth: '98vw', autoFocus: false, panelClass: 'ae-panel',
    });
    const r = await firstValueFrom(ref.afterClosed());
    if (r) {
      this.snack.open(regla ? 'Regla guardada' : `Regla «${r.nombre}» creada y activa`, undefined, { duration: 2600 });
      this.cargar();
    }
  }

  async activar(r: Automatizacion, activo: boolean): Promise<void> {
    try {
      const n = await this.api.activarAutomatizacion(r.id, activo);
      this.reglas.update(l => l.map(x => x.id === r.id ? n : x));
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 });
    }
  }

  async eliminar(r: Automatizacion): Promise<void> {
    const ref = this.dialog.open(AvisoDialogComponent, {
      data: { icono: 'warning', titulo: `¿Eliminar «${r.nombre}»?`, html: 'Las tareas que ya creó se quedan; deja de actuar desde ahora.',
        textoConfirmar: 'Eliminar', textoCancelar: 'Cancelar' }, autoFocus: false,
    });
    if (!(await firstValueFrom(ref.afterClosed()))) return;
    try {
      await this.api.eliminarAutomatizacion(r.id);
      this.reglas.update(l => l.filter(x => x.id !== r.id));
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 });
    }
  }

  verBitacora(r: Automatizacion): void {
    this.filtroBitacora.set(r.id);
    this.vista.set('bitacora');
  }

  // ── Prueba ──
  abrirPrueba(r: Automatizacion): void {
    this.probando.set(this.probando() === r.id ? null : r.id);
    this.planes.set(null);
    this.pruebaTitulo = r.evento_clave === 'tareas.solicitud' ? 'Solicitud de prueba' : `Prueba de ${r.evento_nombre}`;
    this.pruebaMensaje = '';
    this.pruebaDestinatarios.set(r.responsable_modo === 'DESTINATARIO' ? [this.dir.yo.id] : []);
  }

  async probar(r: Automatizacion, crear: boolean): Promise<void> {
    this.ejecutandoPrueba.set(true);
    try {
      const res = await this.api.probarAutomatizacion(r.id, {
        datos: { titulo: this.pruebaTitulo, mensaje: this.pruebaMensaje }, destinatarios: this.pruebaDestinatarios(), crear,
      });
      this.planes.set({ cumple: res.cumple_condiciones, planes: res.planes });
      if (crear && res.creadas?.length) {
        const ref = this.snack.open(res.creadas.length === 1 ? 'Se creó la tarea de prueba' : `Se crearon ${res.creadas.length} tareas de prueba`, 'Abrir', { duration: 5000 });
        const id = res.creadas[0];
        ref.onAction().subscribe(() => this.dialogos.abrirTarea(id));
        this.cargar();
      }
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo probar.'), 'Cerrar', { duration: 4500 });
    } finally {
      this.ejecutandoPrueba.set(false);
    }
  }

  abrirTarea(id: number | null): void { if (id) this.dialogos.abrirTarea(id); }

  // ── Textos ──
  modo(r: Automatizacion): string {
    const m = MODOS_RESPONSABLE.find(x => x.clave === r.responsable_modo);
    if (r.responsable_modo === 'PERSONA' && r.responsable_id) return this.dir.nombre(r.responsable_id);
    if (r.responsable_modo === 'GRUPO' && r.grupo_name) return `Grupo ${r.grupo_name}`;
    if (r.responsable_modo === 'DESTINATARIO' && r.por_destinatario) return 'Una por cada destinatario';
    return m?.etiqueta ?? r.responsable_modo;
  }
  iconoModo(r: Automatizacion): string { return MODOS_RESPONSABLE.find(x => x.clave === r.responsable_modo)?.icono ?? 'person'; }
  condicion(c: { campo: string; op: string; valor: string }): string {
    const o = OPERADORES.find(x => x.clave === c.op)?.etiqueta ?? c.op;
    return c.op === 'existe' || c.op === 'no_existe' ? `${c.campo} ${o}` : `${c.campo} ${o} «${c.valor}»`;
  }
  resultado(r: EjecucionAuto['resultado']): { texto: string; icono: string } {
    switch (r) {
      case 'CREADA': return { texto: 'Tarea creada', icono: 'add_task' };
      case 'DUPLICADA': return { texto: 'Ya tenía tarea', icono: 'content_copy' };
      case 'PRUEBA': return { texto: 'Prueba', icono: 'science' };
      case 'ERROR': return { texto: 'Error', icono: 'error_outline' };
      default: return { texto: 'Omitida', icono: 'block' };
    }
  }
  hace = hace;
  estado = estadoInfo;
  prio = prioridadInfo;
}

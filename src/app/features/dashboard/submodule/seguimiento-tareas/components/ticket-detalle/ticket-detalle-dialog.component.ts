import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BugTicket } from '../../../bug-tickets/services/tickets.service';
import { PanelAgentesTicketComponent } from '../../../bug-tickets/components/panel-agentes-ticket/panel-agentes-ticket.component';
import { ESTADOS_TICKET, MesaSoporteService, PRIORIDADES_TICKET, prioridadTicket } from '../../services/mesa-soporte.service';
import { TareasApiService } from '../../services/tareas-api.service';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { DirectorioService } from '../../services/directorio.service';
import { Sugerencia, Tarea } from '../../models/tareas.models';
import { estadoInfo, hace, mensajeError, prioridadInfo, vencimiento } from '../../utils/tareas-ui';
import { Eleccion, PersonaPickerComponent } from '../persona-picker/persona-picker.component';
import { TareaAvatarComponent } from '../avatar/avatar.component';
import { IaChatComponent } from '../ia-chat/ia-chat.component';

/** Prioridad del ticket → prioridad de la tarea de seguimiento. */
const PRIORIDAD_TAREA: Record<string, 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW'> = { Critica: 'URGENT', Alta: 'HIGH', Media: 'MEDIUM', Baja: 'LOW' };

/**
 * Un ticket de soporte trabajado como tarea: estado, prioridad y responsable; la captura y
 * los logs con vista previa; plan de solución con IA que se convierte en tarea de
 * seguimiento; el panel del enjambre de agentes; y la conversación con quien lo reportó.
 */
@Component({
  selector: 'app-ticket-detalle-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule, MatProgressSpinnerModule,
    MatSnackBarModule, PersonaPickerComponent, PanelAgentesTicketComponent, TareaAvatarComponent, IaChatComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ticket-detalle-dialog.component.html',
  styleUrls: ['./ticket-detalle-dialog.component.css'],
})
export class TicketDetalleDialogComponent implements OnInit, OnDestroy {
  readonly data = inject<{ id: string; modo?: 'soporte' | 'reportante' }>(MAT_DIALOG_DATA);
  /** Quien lo reportó ve el estado, el responsable y la conversación; no lo administra. */
  readonly soporte = (this.data.modo ?? 'soporte') === 'soporte';
  private readonly ref = inject(MatDialogRef<TicketDetalleDialogComponent, boolean>);
  private readonly mesa = inject(MesaSoporteService);
  private readonly api = inject(TareasApiService);
  private readonly dialogos = inject(TareasDialogosService);
  readonly dir = inject(DirectorioService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly estados = ESTADOS_TICKET;
  readonly prioridades = PRIORIDADES_TICKET;
  readonly prioridadTicket = prioridadTicket;
  readonly hace = hace;
  readonly estadoTarea = estadoInfo;
  readonly prioridadTarea = prioridadInfo;
  readonly venc = vencimiento;

  readonly t = signal<BugTicket | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly tareas = signal<Tarea[]>([]);
  readonly verLogs = signal(false);
  readonly verHistorial = signal(false);
  readonly asignando = signal(false);
  private cambios = false;
  private destruido = false;

  // Plan con IA
  readonly iaDisponible = signal(false);
  readonly planeando = signal(false);
  readonly plan = signal<Sugerencia | null>(null);

  // Comentario
  comentario = '';
  readonly archivo = signal<File | null>(null);
  readonly enviando = signal(false);

  readonly captura = computed(() => {
    const b = this.t()?.screenshot_base64;
    if (!b) return null;
    return b.startsWith('data:') ? b : `data:image/png;base64,${b}`;
  });

  async ngOnInit(): Promise<void> {
    this.ref.backdropClick().subscribe(() => this.cerrar());
    this.ref.keydownEvents().subscribe(e => { if (e.key === 'Escape') this.cerrar(); });
    this.ref.disableClose = true;
    this.dir.cargar();
    if (this.soporte) this.api.iaEstado().then(e => this.iaDisponible.set(e.disponible)).catch(() => undefined);
    await this.cargar();
  }

  ngOnDestroy(): void { this.destruido = true; }

  async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.cargando.set(true);
    try {
      this.t.set(await this.mesa.detalle(this.data.id));
      this.error.set(null);
      if (this.soporte) this.cargarTareas();
    } catch (e: any) {
      this.error.set(e?.status === 404 ? 'Este ticket ya no existe.' : mensajeError(e, 'No se pudo cargar el ticket.'));
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarTareas(): Promise<void> {
    this.tareas.set(await this.api.porOrigen('TICKET', this.data.id).catch(() => []));
  }

  // ── Estado, prioridad, responsable ──
  async cambiar(cambios: { estado?: string; prioridad?: string; asignado_id?: string; asignado_nombre?: string | null }, ok: string): Promise<void> {
    this.guardando.set(true);
    try {
      this.t.set(await this.mesa.actualizar(this.data.id, cambios));
      this.cambios = true;
      this.snack.open(ok, undefined, { duration: 2200 });
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    } finally {
      this.guardando.set(false);
    }
  }

  asignarme(): void {
    this.cambiar({ asignado_id: this.dir.yo.id, asignado_nombre: this.dir.yo.nombre,
      estado: this.t()?.estado === 'Abierto' ? 'En Progreso' : undefined }, 'Te asignaste el ticket');
  }
  asignar(el: Eleccion): void {
    if (el.tipo !== 'persona') return;
    this.asignando.set(false);
    this.cambiar({ asignado_id: el.id, asignado_nombre: el.nombre }, `Asignado a ${el.nombre}`);
  }
  quitarAsignado(): void { this.cambiar({ asignado_id: '' }, 'Ticket sin responsable'); }

  /** Nombre del responsable: el del directorio por su usuario; la foto guardada si no está. */
  responsableNombre(t: BugTicket): string {
    return t.asignado_id ? this.dir.nombre(t.asignado_id, t.asignado_a || 'Usuario') : (t.asignado_a || '');
  }

  // ── Captura ──
  verCaptura(): void {
    const src = this.captura();
    if (src) this.verDataUrl(src, `captura-${this.data.id.slice(0, 6)}.png`);
  }

  /** Captura y adjuntos de comentarios llegan como data: URL; el visor los abre como archivo local. */
  async verDataUrl(src: string, nombre: string): Promise<void> {
    const blob = await (await fetch(src)).blob();
    const archivo = new File([blob], nombre || 'archivo', { type: blob.type || 'application/octet-stream' });
    this.dialogos.verArchivos([{ nombre: archivo.name, mime: archivo.type, tamano: archivo.size, archivo }]);
  }

  // ── Plan con IA ──
  async planificar(): Promise<void> {
    const t = this.t();
    if (!t || this.planeando()) return;
    this.planeando.set(true);
    this.plan.set(null);
    try {
      const contexto = [
        `Ticket de soporte: ${t.titulo}`,
        `Categoría: ${t.categoria} · Prioridad: ${t.prioridad} · Estado: ${t.estado}`,
        `Reportado por: ${t.rol || 'usuario'} en la sede ${t.sede || 'sin sede'}, pantalla ${t.url_actual || 'desconocida'}`,
        `Descripción del usuario: ${t.descripcion}`,
        t.ai_analisis ? `Análisis automático previo: ${t.ai_analisis}` : '',
        t.console_logs ? `Errores de consola (recorte): ${t.console_logs.slice(0, 3000)}` : '',
        ...(t.comentarios ?? []).slice(-8).map(c => `Comentario de ${c.autor}: ${c.mensaje}`),
      ].filter(Boolean).join('\n');
      const job = await this.api.iaGenerar('sugerir', {
        descripcion: contexto, modo: 'borrador', area: 'Soporte',
        instruccion: 'Es un ticket de soporte de la plataforma. En la descripción da el diagnóstico probable y cómo verificarlo; '
          + 'en los pasos, el plan de solución y la respuesta al usuario. No pidas datos personales.',
      });
      this.plan.set(await this.api.esperarIa<Sugerencia>(job.id, { cancelado: () => this.destruido }));
    } catch (e: any) {
      if (e?.message !== 'cancelado') this.snack.open(e instanceof Error ? e.message : mensajeError(e, 'La IA no pudo armar el plan.'), 'Cerrar', { duration: 5000 });
    } finally {
      this.planeando.set(false);
    }
  }

  async publicarPlan(): Promise<void> {
    const p = this.plan();
    if (!p) return;
    await this.enviarComentario([`Plan propuesto (IA):`, p.texto, ...p.pasos.map((x, i) => `${i + 1}. ${x}`)].filter(Boolean).join('\n'));
  }

  /** Tarea de seguimiento enlazada al ticket (con el plan de la IA si lo hay). */
  async crearTarea(): Promise<void> {
    const t = this.t();
    if (!t) return;
    const p = this.plan();
    const vence = p?.dias !== undefined && p?.dias !== null ? new Date(Date.now() + p.dias * 86_400_000) : null;
    const descripcion = [
      `Ticket #${t.id.slice(0, 8)} · ${t.categoria} · reportado por ${t.usuario || 'usuario'}${t.sede ? ' (' + t.sede + ')' : ''}.`,
      t.descripcion,
      p?.texto ? `\nDiagnóstico (IA):\n${p.texto}` : '',
    ].filter(Boolean).join('\n');
    const tarea = await this.dialogos.nuevaTarea({
      titulo: `Soporte: ${t.titulo}`.slice(0, 500),
      descripcion,
      prioridad: p?.prioridad ?? PRIORIDAD_TAREA[prioridadTicket(t.prioridad).clave] ?? 'MEDIUM',
      vence,
      pasos: p?.pasos ?? [],
      responsable: t.asignado_id ?? null,
      origen: { tipo: 'TICKET', ref: t.id, url: `/dashboard/tareas/soporte?ticket=${t.id}`, etiqueta: 'Ticket de soporte' },
    });
    if (tarea) {
      // El estado lo controla ms-tools: un ticket «Abierto» pasa solo a «En Progreso».
      this.cambios = true;
      await this.cargar(true);
      this.snack.open(t.estado === 'Abierto' ? 'Tarea creada: el ticket pasó a En Progreso' : 'Tarea de seguimiento creada', undefined, { duration: 3000 });
    }
  }

  /** Al volver de la tarea se recarga el ticket: completarla puede haberlo resuelto. */
  abrirTarea(id: number): void { this.dialogos.abrirTarea(id).then(c => { if (c) { this.cambios = true; this.cargar(true); } }); }

  // ── Conversación ──
  elegirArchivo(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    this.archivo.set(el.files?.[0] ?? null);
    el.value = '';
  }

  async comentar(): Promise<void> {
    const m = this.comentario.trim();
    if (!m && !this.archivo()) return;
    if (await this.enviarComentario(m || '(archivo adjunto)', this.archivo())) {
      this.comentario = '';
      this.archivo.set(null);
    }
  }

  private async enviarComentario(mensaje: string, archivo: File | null = null): Promise<boolean> {
    this.enviando.set(true);
    try {
      await this.mesa.comentar(this.data.id, mensaje, archivo);
      this.cambios = true;
      await this.cargar(true);
      this.snack.open('Comentario publicado', undefined, { duration: 2000 });
      return true;
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo publicar.'), 'Cerrar', { duration: 4500 });
      return false;
    } finally {
      this.enviando.set(false);
    }
  }

  marcarCambio(): void { this.cambios = true; }

  /** Contexto del ticket para los agentes del chat. */
  readonly contextoAgentes = (): string => {
    const t = this.t();
    if (!t) return '';
    return [
      `Ticket de soporte #${t.id.slice(0, 8)}: ${t.titulo}`,
      `Categoría: ${t.categoria} · Prioridad: ${t.prioridad} · Estado: ${t.estado}`,
      `Reportado por: ${t.usuario || 'usuario'} (${t.rol || 'sin rol'}, sede ${t.sede || 'sin sede'}) en ${t.url_actual || 'pantalla desconocida'}`,
      `Navegador: ${t.navegador || ''} · Versión: ${t.version_app || ''}`,
      '', 'Descripción:', t.descripcion,
      t.ai_analisis ? `\nAnálisis automático previo:\n${t.ai_analisis}` : '',
      t.console_logs ? `\nErrores de consola (recorte):\n${t.console_logs.slice(0, 4000)}` : '',
      ...(t.comentarios ?? []).slice(-10).map(c => `- ${c.autor}: ${c.mensaje}`),
    ].filter(x => x !== '').join('\n');
  };

  irAlModuloClasico(): void {
    if (!this.soporte) return;
    this.ref.close(this.cambios);
    this.router.navigate(['/dashboard/bug-tickets/tickets']);
  }

  cerrar(): void { this.ref.close(this.cambios); }
}

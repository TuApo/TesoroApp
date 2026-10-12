import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { Adjunto, NuevaTareaPrefill, Plantilla, Tarea } from '../models/tareas.models';
import type { ArchivoVisor } from '../components/visor-archivo/visor-archivo-dialog.component';
import type { IaGenerarData } from '../components/ia-generar/ia-generar-dialog.component';
import type { ElegirPersonaData, ElegirPersonaResultado } from '../components/elegir-persona/elegir-persona-dialog.component';

/**
 * Puerta de entrada a los diálogos del módulo, también para OTROS módulos: un compromiso
 * de reunión, un ticket o cualquier registro puede convertirse en tarea con
 * `nuevaTarea({ titulo, origen: { tipo, ref, url } })` sin conocer los componentes.
 * Los componentes se cargan bajo demanda para no inflar el bundle de quien solo los abre.
 */
@Injectable({ providedIn: 'root' })
export class TareasDialogosService {
  private readonly dialog = inject(MatDialog);

  /** Abre el panel lateral de una tarea. Resuelve `true` si se cambió algo. */
  async abrirTarea(tareaId: number): Promise<boolean> {
    const { TareaDetalleDialogComponent } = await import('../components/tarea-detalle/tarea-detalle-dialog.component');
    const ref = this.dialog.open(TareaDetalleDialogComponent, {
      data: { tareaId },
      position: { right: '0', top: '0' },
      height: '100dvh',
      width: 'min(780px, 100vw)',
      maxWidth: '100vw',
      maxHeight: '100dvh',
      panelClass: 'tt-drawer',
      autoFocus: false,
      disableClose: true, // el panel cierra solo para poder reportar si hubo cambios
    });
    return !!(await firstValueFrom(ref.afterClosed()));
  }

  /** Formulario de nueva tarea. Resuelve la tarea creada, o null si se canceló. */
  async nuevaTarea(prefill: NuevaTareaPrefill = {}): Promise<Tarea | null> {
    const { TareaFormDialogComponent } = await import('../components/tarea-form/tarea-form-dialog.component');
    const ref = this.dialog.open(TareaFormDialogComponent, {
      data: prefill,
      width: 'min(720px, 96vw)',
      maxWidth: '96vw',
      autoFocus: 'first-tabbable',
    });
    return (await firstValueFrom(ref.afterClosed())) ?? null;
  }

  /** Vista previa de archivos (subidos o locales) con navegación entre ellos. */
  async verArchivos(archivos: ArchivoVisor[], indice = 0): Promise<void> {
    if (!archivos.length) return;
    const { VisorArchivoDialogComponent } = await import('../components/visor-archivo/visor-archivo-dialog.component');
    this.dialog.open(VisorArchivoDialogComponent, {
      data: { archivos, indice },
      width: 'min(1100px, 96vw)',
      maxWidth: '96vw',
      height: 'min(860px, 92dvh)',
      panelClass: 'tt-visor',
      autoFocus: false,
    });
  }

  /**
   * "Crear con IA": tablero, tareas para un tablero o plantilla. Resuelve lo creado
   * (`{ tableroId }`, `{ creadas }` o `{ plantilla }`), o null si se canceló.
   */
  async generarConIa(data: IaGenerarData): Promise<{ tableroId?: number; creadas?: number; plantilla?: Plantilla } | null> {
    const { IaGenerarDialogComponent } = await import('../components/ia-generar/ia-generar-dialog.component');
    const ref = this.dialog.open(IaGenerarDialogComponent, {
      data,
      width: 'min(920px, 96vw)',
      maxWidth: '96vw',
      autoFocus: 'first-tabbable',
      disableClose: true, // una generación en curso no se pierde por un clic fuera
    });
    return (await firstValueFrom(ref.afterClosed())) ?? null;
  }

  /**
   * Nuevo tablero: en blanco, desde una plantilla del área (con vista previa) o con IA.
   * Resuelve el id del tablero creado, o null.
   */
  async nuevoTablero(opts: { espacioId?: number | null; plantillaId?: number | null } = {}): Promise<number | null> {
    const { NuevoTableroDialogComponent } = await import('../components/nuevo-tablero/nuevo-tablero-dialog.component');
    const ref = this.dialog.open(NuevoTableroDialogComponent, {
      data: opts,
      width: 'min(1180px, 97vw)',
      maxWidth: '97vw',
      height: 'min(820px, 94dvh)',
      autoFocus: false,
    });
    const r = await firstValueFrom(ref.afterClosed());
    if (r?.conIa) {
      const ia = await this.generarConIa({ modo: 'tablero', espacioId: r.espacioId ?? opts.espacioId ?? null, area: r.area ?? null });
      return ia?.tableroId ?? null;
    }
    return r?.tableroId ?? null;
  }

  /**
   * Archivos del tablero. Si desde ahí se pide "Crear tareas con IA", abre la IA con esos
   * archivos ya cargados. Resuelve true si cambió algo (archivos o tareas).
   */
  async archivosTablero(t: { id: number; nombre: string; puedeEditar: boolean }): Promise<boolean> {
    const { ArchivosTableroDialogComponent } = await import('../components/archivos-tablero/archivos-tablero-dialog.component');
    const ref = this.dialog.open(ArchivosTableroDialogComponent, {
      data: { tableroId: t.id, nombre: t.nombre, puedeEditar: t.puedeEditar },
      width: 'min(860px, 96vw)',
      maxWidth: '96vw',
      autoFocus: false,
    });
    const r = await firstValueFrom(ref.afterClosed()) as boolean | { conIa: Adjunto[] } | undefined;
    if (r && typeof r === 'object') {
      await this.generarConIa({
        modo: 'tareas', tableroId: t.id, tableroNombre: t.nombre,
        guardados: r.conIa.map(a => ({ uuid: a.uuid, nombre: a.original_name, mime: a.mime_type, tamano: a.size_bytes })),
      });
      return true; // aunque se cancele la IA, los archivos pudieron cambiar
    }
    return !!r;
  }

  /** Guarda la estructura del tablero como plantilla. Resuelve la plantilla creada, o null. */
  async guardarComoPlantilla(t: { id: number; nombre: string; descripcion: string | null }): Promise<Plantilla | null> {
    const { GuardarPlantillaDialogComponent } = await import('../components/guardar-plantilla/guardar-plantilla-dialog.component');
    const ref = this.dialog.open(GuardarPlantillaDialogComponent, {
      data: { tableroId: t.id, nombre: t.nombre, descripcion: t.descripcion },
      width: 'min(540px, 96vw)',
    });
    return (await firstValueFrom(ref.afterClosed())) ?? null;
  }

  /**
   * Elegir un usuario real (para asignar tickets, casos...). Resuelve `{ id, nombre }`,
   * `{ quitar: true }` si se pidió dejarlo sin responsable, o null si se canceló.
   */
  async elegirPersona(data: ElegirPersonaData): Promise<ElegirPersonaResultado> {
    const { ElegirPersonaDialogComponent } = await import('../components/elegir-persona/elegir-persona-dialog.component');
    const ref = this.dialog.open(ElegirPersonaDialogComponent, { data, width: 'min(520px, 96vw)', autoFocus: 'first-tabbable' });
    return (await firstValueFrom(ref.afterClosed())) ?? null;
  }

  /**
   * Abre un ticket de soporte. `soporte` = quien atiende (estado, responsable, plan, tareas);
   * `reportante` = quien lo reportó o lo sigue (estado, responsable y conversación).
   * Resuelve true si cambió algo.
   */
  async abrirTicket(id: string, modo: 'soporte' | 'reportante' = 'soporte'): Promise<boolean> {
    const { TicketDetalleDialogComponent } = await import('../components/ticket-detalle/ticket-detalle-dialog.component');
    const ref = this.dialog.open(TicketDetalleDialogComponent, {
      data: { id, modo },
      position: { right: '0', top: '0' },
      height: '100dvh',
      width: 'min(820px, 100vw)',
      maxWidth: '100vw',
      maxHeight: '100dvh',
      panelClass: 'tt-drawer',
      autoFocus: false,
    });
    return !!(await firstValueFrom(ref.afterClosed()));
  }
}

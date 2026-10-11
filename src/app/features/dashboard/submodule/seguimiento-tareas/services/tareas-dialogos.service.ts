import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { NuevaTareaPrefill, Tarea } from '../models/tareas.models';

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
}

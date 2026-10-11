import { Injectable, signal } from '@angular/core';

/**
 * Señal de "algo cambió en las tareas" compartida por las vistas del módulo: cuando se
 * crea una tarea desde la cabecera, la vista abierta (Mis tareas, tablero, calendario)
 * se recarga sola sin que cada una tenga que conocer a las demás.
 */
@Injectable({ providedIn: 'root' })
export class TareasEventosService {
  readonly version = signal(0);
  avisarCambio(): void { this.version.update(v => v + 1); }
}

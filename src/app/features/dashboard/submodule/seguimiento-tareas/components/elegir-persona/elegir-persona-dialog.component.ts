import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DirectorioService } from '../../services/directorio.service';
import { Eleccion, PersonaPickerComponent } from '../persona-picker/persona-picker.component';
import { TareaAvatarComponent } from '../avatar/avatar.component';

export interface ElegirPersonaData { titulo: string; ayuda?: string; actualId?: string | null; permitirQuitar?: boolean }
/** Persona elegida, o `{ quitar: true }` si se pidió dejarlo sin responsable. */
export type ElegirPersonaResultado = { id: string; nombre: string } | { quitar: true } | null;

/**
 * Elegir un usuario real de la plataforma (no un nombre escrito a mano): lo usan la Mesa de
 * soporte y el módulo de tickets para asignar, y cualquier otro módulo que lo necesite.
 */
@Component({
  selector: 'app-elegir-persona-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatButtonModule, PersonaPickerComponent, TareaAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.titulo }}</h2>
    <mat-dialog-content class="ep">
      @if (data.ayuda) { <p class="ep-ayuda">{{ data.ayuda }}</p> }
      @if (data.actualId) {
        <p class="ep-actual"><app-tarea-avatar [usuario]="data.actualId" [tam]="26" />Ahora: <strong>{{ dir.nombre(data.actualId) }}</strong></p>
      }
      <app-persona-picker placeholder="Buscar por nombre, correo o cédula" (elegido)="elegir($event)" />
      <button mat-stroked-button class="ep-yo" (click)="elegir({ tipo: 'persona', id: dir.yo.id, nombre: dir.yo.nombre })">
        <mat-icon>front_hand</mat-icon>Asignármelo
      </button>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (data.permitirQuitar && data.actualId) {
        <button mat-button class="ep-quitar" (click)="ref.close({ quitar: true })">Dejar sin responsable</button>
      }
      <button mat-button mat-dialog-close>Cancelar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .ep { display: flex; flex-direction: column; gap: 10px; min-width: min(440px, 80vw); padding-bottom: 8px; }
    .ep-ayuda { margin: 0; color: var(--muted); font-size: 13px; }
    .ep-actual { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13.5px; color: var(--text-2); }
    .ep-yo { align-self: flex-start; min-height: 40px !important; }
    .ep-quitar { color: var(--danger) !important; margin-right: auto; }
  `],
})
export class ElegirPersonaDialogComponent {
  readonly data = inject<ElegirPersonaData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<ElegirPersonaDialogComponent, ElegirPersonaResultado>);
  readonly dir = inject(DirectorioService);

  constructor() { this.dir.cargar(); }

  elegir(e: Eleccion): void {
    if (e.tipo !== 'persona') return;
    this.ref.close({ id: e.id, nombre: e.nombre });
  }
}

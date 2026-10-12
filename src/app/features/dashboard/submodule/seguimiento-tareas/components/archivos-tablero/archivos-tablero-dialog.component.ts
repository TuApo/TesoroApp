import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TareasApiService } from '../../services/tareas-api.service';
import { Adjunto } from '../../models/tareas.models';
import { mensajeError } from '../../utils/tareas-ui';
import { AdjuntosComponent } from '../adjuntos/adjuntos.component';

export interface ArchivosTableroData { tableroId: number; nombre: string; puedeEditar: boolean }

/**
 * Archivos del tablero (no de una tarea): procedimientos, bases, actas, formatos… Se ven con
 * el visor y, con un clic, la IA los convierte en tareas para este tablero.
 */
@Component({
  selector: 'app-archivos-tablero-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, AdjuntosComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="at">
      <header class="at-cab">
        <span class="at-ico"><mat-icon>folder_open</mat-icon></span>
        <div><p class="at-eyebrow">Archivos del tablero</p><h2>{{ data.nombre }}</h2></div>
        <button mat-icon-button (click)="ref.close(cambios)" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="at-cuerpo">
        <p class="at-ayuda">Documentos de referencia de todo el tablero: procedimientos, bases de datos, actas, formatos. Los de cada tarea se adjuntan dentro de la tarea.</p>
        @if (cargando()) {
          <div class="at-centro"><mat-spinner diameter="32" /></div>
        } @else if (error()) {
          <p class="at-error"><mat-icon>error_outline</mat-icon>{{ error() }}</p>
        } @else {
          <app-adjuntos [adjuntos]="archivos()" [destino]="{ board: data.tableroId }" [puedeEditar]="data.puedeEditar" (cambio)="cargar(true)" />
        }
      </div>
      @if (data.puedeEditar && archivos().length) {
        <footer class="at-pie">
          <span>La IA puede leer estos archivos y proponer tareas.</span>
          <button mat-flat-button class="at-ia" (click)="conIa()"><mat-icon>auto_awesome</mat-icon>Crear tareas con IA</button>
        </footer>
      }
    </div>
  `,
  styles: [`
    :host { display: block; font-family: var(--font-sans); color: var(--text); }
    .at { display: flex; flex-direction: column; max-height: 88vh; }
    .at-cab { display: flex; align-items: center; gap: 12px; padding: 16px 18px 8px; }
    .at-cab > div { flex: 1; min-width: 0; }
    .at-cab h2 { margin: 0; font-size: 19px; font-weight: 800; color: var(--navy-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .at-eyebrow { margin: 0; font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--primary); }
    .at-ico { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--blue-soft); color: var(--brand-blue-strong); flex: none; }
    .at-cuerpo { padding: 4px 18px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .at-cuerpo > * { flex-shrink: 0; }
    .at-ayuda { margin: 0; font-size: 13px; color: var(--muted); }
    .at-centro { display: flex; justify-content: center; padding: 30px; }
    .at-error { display: flex; gap: 6px; align-items: center; color: var(--danger-fg); background: var(--danger-bg); padding: 8px 12px; border-radius: 10px; margin: 0; }
    .at-pie { display: flex; align-items: center; gap: 10px; padding: 12px 18px 16px; border-top: 1px solid var(--border); flex-wrap: wrap; }
    .at-pie span { flex: 1; font-size: 12.5px; color: var(--muted); min-width: 180px; }
    .at-ia { background: linear-gradient(135deg, #7c3aed, #2B59F0) !important; color: #fff !important; min-height: 40px !important; }
  `],
})
export class ArchivosTableroDialogComponent implements OnInit {
  readonly data = inject<ArchivosTableroData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<ArchivosTableroDialogComponent, boolean | { conIa: Adjunto[] }>);
  private readonly api = inject(TareasApiService);

  readonly archivos = signal<Adjunto[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  cambios = false;

  ngOnInit(): void { this.cargar(); }

  async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.cargando.set(true);
    else this.cambios = true;
    try {
      this.archivos.set(await this.api.archivosTablero(this.data.tableroId));
      this.error.set(null);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los archivos.'));
    } finally {
      this.cargando.set(false);
    }
  }

  conIa(): void { this.ref.close({ conIa: this.archivos() }); }
}

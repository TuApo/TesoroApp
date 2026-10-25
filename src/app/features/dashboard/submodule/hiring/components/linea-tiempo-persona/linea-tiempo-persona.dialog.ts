import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  LineaTiempoPersonaComponent, PersonaLineaTiempo,
} from './linea-tiempo-persona.component';

export interface LineaTiempoDialogData {
  /** Cédula de la persona. */
  documento: string;
  /** Nombre para el título mientras carga; si no viene, se toma de la respuesta. */
  nombre?: string | null;
}

/**
 * Abre la línea de tiempo en un diálogo con el tamaño de siempre. Lo usan la
 * ficha del candidato y (en la ola 2) el Historial laboral del pipeline, para
 * que las dos puertas abran exactamente lo mismo.
 */
export function abrirLineaTiempoPersona(dialog: MatDialog, data: LineaTiempoDialogData) {
  return dialog.open<LineaTiempoPersonaDialogComponent, LineaTiempoDialogData, void>(
    LineaTiempoPersonaDialogComponent,
    {
      data,
      width: '780px',
      maxWidth: '96vw',
      height: '88vh',
      maxHeight: '96vh',
      autoFocus: false,
      restoreFocus: true,
    },
  );
}

/** Contenedor de {@link LineaTiempoPersonaComponent}: título, persona y cerrar. */
@Component({
  selector: 'app-linea-tiempo-persona-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatTooltipModule, LineaTiempoPersonaComponent],
  template: `
    <header class="ltd-cab">
      <span class="ltd-icono" aria-hidden="true"><mat-icon>timeline</mat-icon></span>
      <div class="ltd-cab-txt">
        <h2 class="ltd-titulo" mat-dialog-title>Línea de tiempo</h2>
        <p class="ltd-sub">
          @if (nombre(); as n) { <strong>{{ n }}</strong> · }
          <span class="ltd-doc">{{ documento() }}</span>
        </p>
      </div>
      <button type="button" class="ltd-cerrar" matTooltip="Cerrar" aria-label="Cerrar" (click)="cerrar()">
        <mat-icon>close</mat-icon>
      </button>
    </header>

    <div class="ltd-cuerpo">
      <app-linea-tiempo-persona [documento]="data.documento" (personaCargada)="alCargar($event)" />
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--surface);
      color: var(--text);
    }

    .ltd-cab {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: none;
      padding: 16px 16px 12px 20px;
      border-bottom: 1px solid var(--border);
    }

    .ltd-icono {
      display: grid;
      place-items: center;
      flex: none;
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: var(--info-bg);
      color: var(--info-fg);
    }

    .ltd-cab-txt { flex: 1; min-width: 0; }

    /* mat-dialog-title trae márgenes y alto propios: aquí manda la cabecera. */
    .ltd-titulo {
      margin: 0 !important;
      padding: 0 !important;
      color: var(--navy-ink);
      font-size: 1.02rem;
      font-weight: 800;
      line-height: 1.3;
    }

    .ltd-titulo::before { display: none; }

    .ltd-sub {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: .8rem;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .ltd-sub strong { color: var(--text-2); font-weight: 700; }

    .ltd-doc { font-family: var(--font-mono); }

    .ltd-cerrar {
      display: grid;
      place-items: center;
      flex: none;
      width: 34px;
      height: 34px;
      min-height: 0 !important;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }

    .ltd-cerrar:hover { background: var(--surface-3); }
    .ltd-cerrar:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

    .ltd-cuerpo {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      padding: 12px 16px 12px 20px;
    }

    @media (max-width: 600px) {
      .ltd-cab { padding: 12px 10px 10px 12px; }
      .ltd-cuerpo { padding: 10px 10px 8px 12px; }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineaTiempoPersonaDialogComponent {
  readonly data = inject<LineaTiempoDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<LineaTiempoPersonaDialogComponent, void>>(MatDialogRef);

  readonly nombre = signal<string | null>(this.data.nombre?.trim() || null);
  readonly documento = signal<string>(String(this.data.documento ?? '').trim());

  /** El servidor conoce el nombre y el documento canónico (p. ej. sin la X). */
  alCargar(p: PersonaLineaTiempo): void {
    if (!this.nombre() && p.nombre) this.nombre.set(p.nombre);
    if (p.numero_documento) this.documento.set(p.numero_documento);
  }

  cerrar(): void {
    this.ref.close();
  }
}

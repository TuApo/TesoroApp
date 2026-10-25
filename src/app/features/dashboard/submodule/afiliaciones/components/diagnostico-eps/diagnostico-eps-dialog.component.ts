import { Component, Inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { DiagnosticoGeneracion } from '../../models/plantilla-eps.models';

/** Con qué se abre: el diagnóstico de cada proceso y si es individual o masivo. */
export interface DiagnosticoEpsDialogData {
  diagnosticos: DiagnosticoGeneracion[];
  /** true = un solo proceso (no hay nada que descargar si no puede). */
  individual?: boolean;
}

/** Lo que devuelve al cerrar: los procesos que se pueden generar, si el usuario siguió. */
export type DiagnosticoEpsDialogResult = number[] | undefined;

/**
 * Antes del documento EPS masivo (o cuando el individual no se pudo): quién sale, quién no y
 * por qué, agrupado por motivo para que se vea de un vistazo qué falta arreglar
 * ("12 sin plantilla para FAMISANAR", "3 sin EPS registrada").
 */
@Component({
  selector: 'app-diagnostico-eps-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <h2 mat-dialog-title class="diag-titulo">
      <mat-icon>{{ noPueden().length ? 'report' : 'task_alt' }}</mat-icon>
      {{ data.individual ? 'Documento EPS' : 'Documento EPS de la selección' }}
    </h2>

    <mat-dialog-content class="diag-contenido">
      @if (!data.individual) {
        <div class="diag-resumen">
          <span class="ok"><mat-icon>check_circle</mat-icon> {{ pueden().length }} se pueden generar</span>
          <span class="no"><mat-icon>block</mat-icon> {{ noPueden().length }} no se pueden</span>
          @if (conAvisos().length) {
            <span class="aviso"><mat-icon>warning</mat-icon> {{ conAvisos().length }} salen con huecos</span>
          }
        </div>
      }

      @for (g of grupos(); track g.motivo) {
        <section class="diag-grupo">
          <h3>
            <mat-icon class="no">block</mat-icon>
            {{ g.motivo }}
            @if (g.filas.length > 1) { <span class="cuantos">({{ g.filas.length }})</span> }
          </h3>
          @if (!data.individual || g.filas[0].nombre) {
            <ul>
              @for (d of g.filas; track d.procesoId) {
                <li>
                  <strong>{{ d.nombre || 'Proceso ' + d.procesoId }}</strong>
                  @if (d.cedula) { · {{ d.cedula }} }
                  @if (d.eps) { · EPS {{ d.eps }} }
                  @if (d.temporal) { · {{ d.temporal === 'TU_ALIANZA' ? 'Tu Alianza' : d.temporal === 'APOYO_LABORAL' ? 'Apoyo Laboral' : d.temporal }} }
                </li>
              }
            </ul>
          }
        </section>
      }

      @if (conAvisos().length) {
        <section class="diag-grupo avisos">
          <h3><mat-icon class="aviso">warning</mat-icon> Se generan, pero con huecos</h3>
          <ul>
            @for (d of conAvisos(); track d.procesoId) {
              <li>
                <strong>{{ d.nombre || 'Proceso ' + d.procesoId }}</strong> ({{ d.plantillaNombre }}):
                {{ d.avisos.join(' ') }}
              </li>
            }
          </ul>
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (noPueden().length) {
        <button mat-button (click)="copiar()" matTooltip="Copia la lista para pegarla en Excel o en un correo">
          <mat-icon>content_copy</mat-icon> {{ copiado() ? 'Copiado' : 'Copiar motivos' }}
        </button>
      }
      <button mat-button mat-dialog-close>Cerrar</button>
      @if (pueden().length) {
        <button mat-flat-button color="primary" (click)="seguir()">
          <mat-icon>picture_as_pdf</mat-icon>
          {{ data.individual ? 'Generar' : 'Generar PDF (' + pueden().length + ')' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .diag-titulo { display: flex; align-items: center; gap: 8px; }
    .diag-contenido { min-width: min(640px, 86vw); max-height: 64vh; }
    .diag-resumen { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 12px; font-weight: 500; }
    .diag-resumen span { display: inline-flex; align-items: center; gap: 4px; }
    .diag-grupo { border-left: 3px solid var(--mat-sys-error, #c62828); padding: 4px 0 4px 12px; margin: 10px 0; }
    .diag-grupo.avisos { border-left-color: #f59e0b; }
    .diag-grupo h3 { display: flex; align-items: flex-start; gap: 6px; font-size: 14px; line-height: 1.4; margin: 0 0 6px; font-weight: 600; }
    .diag-grupo h3 mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }
    .diag-grupo ul { margin: 0; padding-left: 18px; font-size: 13px; }
    .diag-grupo li { margin: 2px 0; }
    .cuantos { font-weight: 400; opacity: .75; }
    .ok { color: #15803d; } .no { color: var(--mat-sys-error, #c62828); } .aviso { color: #b45309; }
  `]
})
export class DiagnosticoEpsDialogComponent {
  readonly copiado = signal(false);
  readonly pueden    = computed(() => this.data.diagnosticos.filter(d => d.puedeGenerar));
  readonly noPueden  = computed(() => this.data.diagnosticos.filter(d => !d.puedeGenerar));
  readonly conAvisos = computed(() => this.pueden().filter(d => d.avisos?.length));

  /** Los que no pueden, agrupados por el motivo exacto (mismo texto = misma causa). */
  readonly grupos = computed(() => {
    const m = new Map<string, DiagnosticoGeneracion[]>();
    for (const d of this.noPueden()) {
      const k = d.motivo || 'No se pudo generar';
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return [...m.entries()].map(([motivo, filas]) => ({ motivo, filas }))
      .sort((a, b) => b.filas.length - a.filas.length);
  });

  constructor(
    private ref: MatDialogRef<DiagnosticoEpsDialogComponent, DiagnosticoEpsDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: DiagnosticoEpsDialogData,
  ) {}

  seguir() {
    this.ref.close(this.pueden().map(d => d.procesoId));
  }

  copiar() {
    const filas = this.noPueden().map(d =>
      [d.cedula ?? '', d.nombre ?? '', d.eps ?? '', d.temporal ?? '', d.motivo ?? ''].join('\t'));
    const texto = ['Cédula\tNombre\tEPS\tTemporal\tMotivo', ...filas].join('\n');
    navigator.clipboard?.writeText(texto).then(() => this.copiado.set(true)).catch(() => undefined);
  }
}

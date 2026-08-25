import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ProcessControlService } from '../../services/process-control.service';
import { ApiProblem } from '../../models/dynamic-forms.models';
import { Revision } from '../../models/process.models';

export interface RecordHistoryData {
  submissionId: number;
  recordKey?: string | null;
}

/**
 * HISTORIAL DE UN REGISTRO: todo lo que le pasó, del cambio más reciente al más antiguo.
 *
 * Es la respuesta a "¿esto quién lo cambió y qué decía antes?", que es justo lo que no se
 * podía contestar cuando la respuesta solo guardaba su último estado. Cada entrada dice
 * QUIÉN, CUÁNDO, POR DÓNDE (pantalla, carga masiva, link público) y, campo a campo, el
 * valor anterior y el nuevo.
 */
@Component({
  selector: 'app-record-history-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title class="rhd-titulo">
      <mat-icon aria-hidden="true">history</mat-icon>
      Historial del registro {{ data.submissionId }}
      @if (data.recordKey) {
        <span class="rhd-llave">· {{ data.recordKey }}</span>
      }
    </h2>

    @if (cargando()) {
      <mat-progress-bar mode="indeterminate"></mat-progress-bar>
    }

    <mat-dialog-content class="rhd-contenido">
      @if (error()) {
        <div class="rhd-error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span>{{ error() }}</span>
        </div>
      } @else if (!cargando() && revisiones().length === 0) {
        <p class="rhd-vacio">Este registro no tiene movimientos registrados.</p>
      } @else {
        <ol class="rhd-linea">
          @for (r of revisiones(); track r.id) {
            <li class="rhd-item">
              <span class="rhd-punto" [class]="clasePunto(r.action)" aria-hidden="true">
                <mat-icon>{{ icono(r.action) }}</mat-icon>
              </span>
              <div class="rhd-cuerpo">
                <div class="rhd-cabecera">
                  <span class="rhd-accion">{{ etiquetaAccion(r.action) }}</span>
                  <span class="rhd-chip">{{ etiquetaOrigen(r.source) }}</span>
                  @if (r.batch_id) {
                    <span class="rhd-chip rhd-chip--lote" [matTooltip]="'Lote de carga masiva ' + r.batch_id">
                      lote {{ r.batch_id }}
                    </span>
                  }
                  <span class="rhd-grow"></span>
                  <span class="rhd-fecha">{{ r.changed_at | date:'dd/MM/yyyy HH:mm' }}</span>
                </div>

                <div class="rhd-autor">
                  <mat-icon aria-hidden="true">person</mat-icon>
                  {{ r.changed_by || 'Envío anónimo' }}
                  <span class="rhd-rev">rev. {{ r.revision_no }}</span>
                </div>

                @if (r.status_before && r.status_after && r.status_before !== r.status_after) {
                  <p class="rhd-estado">
                    Estado: <b>{{ estado(r.status_before) }}</b>
                    <mat-icon aria-hidden="true">arrow_right_alt</mat-icon>
                    <b>{{ estado(r.status_after) }}</b>
                  </p>
                }

                @if (r.note) {
                  <p class="rhd-nota">“{{ r.note }}”</p>
                }

                @if (r.changes?.length) {
                  <table class="rhd-cambios">
                    <thead>
                      <tr><th>Campo</th><th>Antes</th><th>Después</th></tr>
                    </thead>
                    <tbody>
                      @for (c of r.changes; track c.field) {
                        <tr>
                          <td class="rhd-campo">{{ c.label || c.field }}</td>
                          <td class="rhd-antes">{{ c.before || '—' }}</td>
                          <td class="rhd-despues">{{ c.after || '—' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            </li>
          }
        </ol>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .rhd-titulo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--navy, #21263c);
    }
    .rhd-llave { font-weight: 500; color: var(--muted, #64748b); }
    .rhd-contenido { padding-top: 8px !important; max-height: 68vh; }
    .rhd-vacio { color: var(--muted, #64748b); }

    /* Línea de tiempo: el hilo vertical hace evidente que es una secuencia y no una lista
       de cosas sueltas — es lo primero que se pregunta al auditar un registro. */
    .rhd-linea {
      list-style: none;
      margin: 0;
      padding: 0 0 0 6px;
    }
    .rhd-item {
      display: flex;
      gap: 12px;
      padding-bottom: 18px;
      position: relative;
    }
    .rhd-item:not(:last-child)::before {
      content: '';
      position: absolute;
      left: 15px;
      top: 32px;
      bottom: 0;
      width: 2px;
      background: var(--slate-200, #e2e8f0);
    }
    .rhd-punto {
      flex: 0 0 auto;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--slate-100, #eef2f7);
      color: var(--slate-700, #475569);
      z-index: 1;
    }
    .rhd-punto mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .rhd-punto--crear { background: #dcfce7; color: #166534; }
    .rhd-punto--editar { background: #fef3c7; color: #92400e; }
    .rhd-punto--estado { background: #e0f2fe; color: #075985; }

    .rhd-cuerpo { flex: 1 1 auto; min-width: 0; }
    .rhd-cabecera {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .rhd-grow { flex: 1 1 auto; }
    .rhd-accion { font-weight: 700; color: var(--navy, #21263c); font-size: 0.9rem; }
    .rhd-chip {
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--slate-100, #eef2f7);
      color: var(--slate-700, #475569);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .rhd-chip--lote { background: #ede9fe; color: #5b21b6; }
    .rhd-fecha {
      font-size: 0.78rem;
      color: var(--muted, #64748b);
      font-variant-numeric: tabular-nums;
    }
    .rhd-autor {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 2px;
      font-size: 0.78rem;
      color: var(--muted, #64748b);
    }
    .rhd-autor mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .rhd-rev { margin-left: 6px; opacity: 0.75; }
    .rhd-estado {
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 6px 0 0;
      font-size: 0.82rem;
      color: var(--slate-700, #334155);
    }
    .rhd-estado mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .rhd-nota {
      margin: 6px 0 0;
      font-size: 0.82rem;
      font-style: italic;
      color: var(--slate-700, #334155);
    }

    .rhd-cambios {
      width: 100%;
      margin-top: 8px;
      border-collapse: collapse;
      font-size: 0.8rem;
      border: 1px solid var(--slate-200, #e8edf3);
      border-radius: 8px;
      overflow: hidden;
    }
    .rhd-cambios th {
      text-align: left;
      padding: 6px 10px;
      background: var(--slate-50, #f8fafc);
      color: var(--muted, #64748b);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .rhd-cambios td {
      padding: 6px 10px;
      border-top: 1px solid var(--slate-100, #f1f5f9);
      vertical-align: top;
      word-break: break-word;
    }
    .rhd-campo { font-weight: 600; color: var(--slate-700, #334155); width: 32%; }
    .rhd-antes { color: #991b1b; text-decoration: line-through; text-decoration-thickness: 1px; }
    .rhd-despues { color: #166534; font-weight: 600; }

    .rhd-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #fee2e2;
      color: #991b1b;
      font-size: 0.85rem;
    }
  `],
})
export class RecordHistoryDialogComponent {
  readonly data = inject<RecordHistoryData>(MAT_DIALOG_DATA);
  private svc = inject(ProcessControlService);
  private destroyRef = inject(DestroyRef);

  readonly revisiones = signal<Revision[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.svc.history(this.data.submissionId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: rs => {
        this.revisiones.set(rs);
        this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.cargando.set(false);
        const p = e?.error as ApiProblem | undefined;
        this.error.set(p?.detail || p?.title || 'No se pudo cargar el historial.');
      },
    });
  }

  etiquetaAccion(a: string): string {
    switch (a) {
      case 'CREATE': return 'Registro creado';
      case 'UPDATE': return 'Datos modificados';
      case 'STATUS': return 'Cambio de estado';
      case 'DELETE': return 'Registro eliminado';
      default: return a;
    }
  }

  etiquetaOrigen(s: string): string {
    switch (s) {
      case 'UI': return 'Pantalla';
      case 'BULK': return 'Carga masiva';
      case 'PUBLIC': return 'Link público';
      case 'API': return 'API';
      default: return s;
    }
  }

  icono(a: string): string {
    switch (a) {
      case 'CREATE': return 'add_circle';
      case 'UPDATE': return 'edit';
      case 'STATUS': return 'swap_horiz';
      default: return 'circle';
    }
  }

  clasePunto(a: string): string {
    switch (a) {
      case 'CREATE': return 'rhd-punto--crear';
      case 'UPDATE': return 'rhd-punto--editar';
      case 'STATUS': return 'rhd-punto--estado';
      default: return '';
    }
  }

  estado(e: string): string {
    switch (e) {
      case 'DRAFT': return 'Borrador';
      case 'SUBMITTED': return 'Enviado';
      case 'APPROVED': return 'Aprobado';
      case 'REJECTED': return 'Rechazado';
      default: return e;
    }
  }
}

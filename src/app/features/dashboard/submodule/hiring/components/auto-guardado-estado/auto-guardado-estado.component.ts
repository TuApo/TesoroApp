import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { EstadoAutoGuardado } from '../../shared/auto-guardado';

/**
 * Lo que queda en el sitio del antiguo botón "Guardar": dice si lo escrito ya
 * está guardado. Sin él, una pantalla sin botón se lee como una pantalla que no
 * guarda.
 */
@Component({
  selector: 'app-auto-guardado-estado',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="ag" [class.ag-error]="estado() === 'error'" role="status" aria-live="polite">
      @switch (estado()) {
        @case ('pendiente') { <mat-icon>edit</mat-icon><span>Se guarda al salir del campo</span> }
        @case ('guardando') { <mat-icon class="ag-gira">sync</mat-icon><span>Guardando…</span> }
        @case ('guardado') { <mat-icon>cloud_done</mat-icon><span>Guardado</span> }
        @case ('incompleto') { <mat-icon>info</mat-icon><span>{{ error() || 'Falta información para guardar' }}</span> }
        @case ('error') {
          <mat-icon>error_outline</mat-icon>
          <span>{{ error() || 'No se pudo guardar' }}</span>
          <button type="button" class="ag-reintentar" (click)="reintentar.emit()">Reintentar</button>
        }
        @default { <mat-icon>cloud_queue</mat-icon><span>Los cambios se guardan solos</span> }
      }
    </div>
  `,
  styles: [`
    :host { display: flex; justify-content: flex-end; }
    .ag {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      font-size: .78rem; color: var(--text-2); background: var(--surface-3);
    }
    .ag mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ag-error { color: #991B1B; color: light-dark(#991B1B, #eea0a0); background: #FEE2E2; background: light-dark(#FEE2E2, #371725); }
    .ag-reintentar {
      border: 0; background: transparent; color: inherit; font: inherit;
      font-weight: 700; text-decoration: underline; cursor: pointer; padding: 0 0 0 4px;
    }
    .ag-gira { animation: ag-gira 1s linear infinite; }
    @keyframes ag-gira { to { transform: rotate(360deg); } }
  `],
})
export class AutoGuardadoEstadoComponent {
  readonly estado = input<EstadoAutoGuardado>('inactivo');
  readonly error = input<string | null>(null);
  readonly reintentar = output<void>();
}
